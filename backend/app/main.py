import json
import os
import secrets
import sqlite3
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .company import router as company_router
from .db import audit, connect, init_db
from .hrm import router as hrm_router
from .models import BranchInput, Login, UserInput
from .security import (
    ROLES,
    check_origin,
    current_user,
    hash_password,
    public_user,
    require_role,
    token_hash,
    verify_password,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_db()
    if os.getenv("DMS_DEMO") == "1":
        from .demo import seed

        seed()
    yield


app = FastAPI(title="Delivery Company Management", lifespan=lifespan)
DUMMY_HASH = hash_password("not-a-real-user-password")


@app.middleware("http")
async def security_headers(request: Request, call_next: Any) -> Response:
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://app.devin.ai",
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "demo": os.getenv("DMS_DEMO") == "1", "integrations": "not_connected"}


@app.post("/api/login")
def login(data: Login, request: Request, response: Response) -> dict[str, Any]:
    check_origin(request)
    ip = request.client.host if request.client else "unknown"
    key = token_hash(ip)
    clock = time.time()
    failure = False
    with connect(write=True) as db:
        attempt = db.execute("SELECT * FROM login_attempts WHERE key=?", (key,)).fetchone()
        if attempt and clock - attempt["started"] < 300 and attempt["attempts"] >= 10:
            raise HTTPException(429, "Too many sign-in attempts. Try again in five minutes.")
        row = db.execute(
            "SELECT * FROM users WHERE username=? AND active=1", (data.username,)
        ).fetchone()
        valid = verify_password(data.password, row["password_hash"] if row else DUMMY_HASH)
        if not row or not valid or row["role"] not in ROLES:
            if not attempt or clock - attempt["started"] >= 300:
                db.execute("INSERT OR REPLACE INTO login_attempts VALUES(?,1,?)", (key, clock))
            else:
                db.execute("UPDATE login_attempts SET attempts=attempts+1 WHERE key=?", (key,))
            failure = True
        else:
            db.execute("DELETE FROM sessions WHERE expires<?", (clock,))
            db.execute("DELETE FROM login_attempts WHERE started<?", (clock - 300,))
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            db.execute(
                "INSERT INTO sessions VALUES(?,?,?,?)",
                (token_hash(token), row["id"], csrf, clock + 28800),
            )
            old = request.cookies.get("dms_session")
            if old:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(old),))
            user = dict(row)
            user["branches"] = json.loads(user["branches"])
    if failure:
        raise HTTPException(401, "Invalid username or password")
    secure = os.getenv("DMS_COOKIE_SECURE", "0" if os.getenv("DMS_DEMO") == "1" else "1") == "1"
    response.set_cookie(
        "dms_session", token, httponly=True, samesite="strict", secure=secure, max_age=28800
    )
    return {"user": public_user(user), "csrf": csrf}


@app.get("/api/me")
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"user": public_user(user), "csrf": user["csrf"]}


@app.post("/api/logout")
def logout(
    request: Request, response: Response, user: dict[str, Any] = Depends(current_user)
) -> dict[str, bool]:
    with connect(write=True) as db:
        db.execute(
            "DELETE FROM sessions WHERE token_hash=?",
            (token_hash(request.cookies.get("dms_session", "")),),
        )
    response.delete_cookie("dms_session")
    return {"ok": True}


@app.get("/api/branches")
def branches(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute("SELECT * FROM branches ORDER BY name").fetchall()
    return [dict(r) for r in rows if user["role"] == "admin" or r["id"] in user["branches"]]


@app.post("/api/branches", status_code=201)
def add_branch(data: BranchInput, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    require_role(user, "admin")
    try:
        with connect(write=True) as db:
            cursor = db.execute(
                "INSERT INTO branches(name,area) VALUES(?,?)", (data.name, data.area)
            )
            audit(db, user["id"], None, "branch_created", {"branch_id": cursor.lastrowid})
            return {"id": cursor.lastrowid, **data.model_dump()}
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "A branch with this name already exists") from exc


@app.get("/api/users")
def users(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    require_role(user, "admin")
    with connect() as db:
        rows = db.execute("SELECT * FROM users ORDER BY name").fetchall()
    return [
        public_user({**dict(r), "branches": json.loads(r["branches"])})
        for r in rows
        if r["role"] in ROLES
    ]


@app.post("/api/users", status_code=201)
def add_user(data: UserInput, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    require_role(user, "admin")
    with connect(write=True) as db:
        ids = {r["id"] for r in db.execute("SELECT id FROM branches")}
        if not set(data.branches) <= ids:
            raise HTTPException(422, "Unknown branch in user access")
        try:
            cursor = db.execute(
                "INSERT INTO users(username,name,password_hash,role,branches) VALUES(?,?,?,?,?)",
                (
                    data.username,
                    data.name,
                    hash_password(data.password),
                    data.role,
                    json.dumps(sorted(set(data.branches))),
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "This username already exists") from exc
        audit(
            db,
            user["id"],
            None,
            "user_created",
            {"user_id": cursor.lastrowid, "role": data.role, "branches": data.branches},
        )
    return {
        "id": cursor.lastrowid,
        "username": data.username,
        "name": data.name,
        "role": data.role,
        "branches": data.branches,
        "available": 0,
    }


app.include_router(company_router)
app.include_router(hrm_router)

DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}")
def frontend(path: str) -> FileResponse:
    if path.startswith("api/") or not (DIST / "index.html").exists():
        raise HTTPException(404, "Not found. Build the frontend first.")
    return FileResponse(DIST / "index.html")
