import csv
import io
import json
import os
import secrets
import sqlite3
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .db import audit, connect, init_db, now
from .hrm import router as hrm_router
from .models import (
    Assignment,
    Availability,
    BranchInput,
    CSVInput,
    JobInput,
    Login,
    OrderInput,
    StatusInput,
    UserInput,
)
from .security import (
    check_branch,
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


app = FastAPI(title="Delivery Management System", lifespan=lifespan)
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
        if not row or not valid:
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


def accessible_order(db: sqlite3.Connection, order_id: int, user: dict[str, Any]) -> sqlite3.Row:
    order = db.execute(
        "SELECT o.*, j.id AS job_id, j.rider_id, j.status AS job_status, j.failure_reason, j.proof FROM orders o LEFT JOIN jobs j ON j.order_id=o.id WHERE o.id=?",
        (order_id,),
    ).fetchone()
    if order is None:
        raise HTTPException(404, "Order not found")
    check_branch(user, order["branch_id"])
    if user["role"] == "rider" and order["rider_id"] != user["id"]:
        raise HTTPException(403, "This delivery is not assigned to you")
    return order


def serialize_order(row: sqlite3.Row, user: dict[str, Any]) -> dict[str, Any]:
    result = dict(row)
    result["items"] = json.loads(result["items"])
    result["sync_status"] = "manual_only"
    if user["role"] == "kitchen" or result["delivery_mode"] == "platform":
        for field in ("customer_name", "phone", "area", "address"):
            result[field] = ""
    if user["role"] == "kitchen":
        result["proof"] = ""
    if user["role"] == "rider":
        for field in ("total_fils", "external_id", "items", "notes"):
            result.pop(field, None)
    return result


@app.get("/api/orders")
def orders(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute(
            "SELECT o.*, b.name AS branch_name, j.id AS job_id, j.rider_id, j.status AS job_status, j.failure_reason, j.proof, u.name AS rider_name FROM orders o JOIN branches b ON b.id=o.branch_id LEFT JOIN jobs j ON j.order_id=o.id LEFT JOIN users u ON u.id=j.rider_id ORDER BY o.created_at DESC"
        ).fetchall()
    return [
        serialize_order(r, user)
        for r in rows
        if (user["role"] == "admin" or r["branch_id"] in user["branches"])
        and (user["role"] != "rider" or r["rider_id"] == user["id"])
    ]


def insert_order(
    db: sqlite3.Connection, data: OrderInput, user: dict[str, Any], demo: bool = False
) -> int:
    check_branch(user, data.branch_id)
    if db.execute("SELECT id FROM branches WHERE id=?", (data.branch_id,)).fetchone() is None:
        raise HTTPException(422, "Unknown branch")
    fields = data.model_dump()
    fields["items"] = json.dumps(fields["items"])
    fields.update(created_at=now(), updated_at=now(), is_demo=int(demo))
    columns = ",".join(fields)
    placeholders = ",".join("?" for _ in fields)
    try:
        cursor = db.execute(
            f"INSERT INTO orders({columns}) VALUES({placeholders})", tuple(fields.values())
        )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "This branch/platform/order ID already exists") from exc
    order_id = cursor.lastrowid
    assert order_id is not None
    if data.delivery_mode == "own":
        db.execute("INSERT INTO jobs(order_id, updated_at) VALUES(?,?)", (order_id, now()))
    audit(
        db,
        user["id"],
        order_id,
        "order_created",
        {"source": data.source, "delivery_mode": data.delivery_mode},
    )
    return order_id


@app.post("/api/orders", status_code=201)
def add_order(data: OrderInput, user: dict[str, Any] = Depends(current_user)) -> dict[str, int]:
    require_role(user, "admin", "manager", "dispatcher")
    with connect(write=True) as db:
        return {"id": insert_order(db, data, user)}


@app.post("/api/orders/import")
def import_orders(data: CSVInput, user: dict[str, Any] = Depends(current_user)) -> dict[str, int]:
    require_role(user, "admin", "manager", "dispatcher")
    reader = csv.DictReader(io.StringIO(data.content.lstrip("\ufeff")))
    expected = {
        "branch_id",
        "source",
        "external_id",
        "delivery_mode",
        "customer_name",
        "phone",
        "area",
        "address",
        "item",
        "quantity",
        "total_kwd",
        "prep_minutes",
        "notes",
    }
    if set(reader.fieldnames or []) != expected or len(reader.fieldnames or []) != len(expected):
        raise HTTPException(422, "CSV headers must match the downloadable template")
    parsed: list[OrderInput] = []
    for index, row in enumerate(reader, start=2):
        if index > 501:
            raise HTTPException(422, "Import at most 500 orders at a time")
        try:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("Each row must have exactly the template columns")
            amount = Decimal(row["total_kwd"]) * 1000
            if not amount.is_finite() or amount != amount.to_integral_value():
                raise ValueError("Amounts must use at most three decimal places")
            parsed.append(
                OrderInput.model_validate(
                    {
                        **{
                            k: row[k]
                            for k in expected
                            - {"item", "quantity", "total_kwd", "prep_minutes", "branch_id"}
                        },
                        "branch_id": int(row["branch_id"]),
                        "prep_minutes": int(row["prep_minutes"]),
                        "items": [{"name": row["item"], "quantity": int(row["quantity"])}],
                        "total_fils": int(amount),
                    }
                )
            )
        except (ValueError, TypeError, InvalidOperation, KeyError, ValidationError) as exc:
            raise HTTPException(
                422, f"Invalid CSV row {index}: check values and required delivery details"
            ) from exc
    if not parsed:
        raise HTTPException(422, "CSV contains no orders")
    created, skipped = 0, 0
    with connect(write=True) as db:
        for item in parsed:
            check_branch(user, item.branch_id)
            existing = db.execute(
                "SELECT id FROM orders WHERE branch_id=? AND source=? AND external_id=?",
                (item.branch_id, item.source, item.external_id),
            ).fetchone()
            if existing:
                skipped += 1
                continue
            insert_order(db, item, user)
            created += 1
    return {"created": created, "skipped": skipped}


@app.post("/api/orders/{order_id}/status")
def order_status(
    order_id: int, data: StatusInput, user: dict[str, Any] = Depends(current_user)
) -> dict[str, bool]:
    require_role(user, "admin", "manager", "kitchen")
    transitions = {
        "new": "accepted",
        "accepted": "preparing",
        "preparing": "ready",
        "ready": "handed_over",
    }
    with connect(write=True) as db:
        order = accessible_order(db, order_id, user)
        if data.status == "cancelled":
            require_role(user, "admin", "manager")
            if not data.reason:
                raise HTTPException(422, "A cancellation reason is required")
            if order["status"] in {"cancelled", "handed_over"}:
                raise HTTPException(409, "This order cannot be cancelled at its current stage")
            db.execute(
                "UPDATE jobs SET status='cancelled', rider_id=NULL, updated_at=? WHERE order_id=?",
                (now(), order_id),
            )
        elif transitions.get(order["status"]) != data.status:
            raise HTTPException(409, "Invalid order status transition. Refresh and try again.")
        elif data.status == "handed_over" and order["delivery_mode"] == "own":
            raise HTTPException(
                409, "Own-fleet pickup must be confirmed from the rider delivery job"
            )
        db.execute(
            "UPDATE orders SET status=?, updated_at=? WHERE id=?", (data.status, now(), order_id)
        )
        audit(
            db,
            user["id"],
            order_id,
            "order_status_changed",
            {
                "from": order["status"],
                "to": data.status,
                "reason": data.reason,
                "platform_sync": "not_connected",
            },
        )
    return {"ok": True}


@app.get("/api/orders/{order_id}/audit")
def order_audit(
    order_id: int, user: dict[str, Any] = Depends(current_user)
) -> list[dict[str, Any]]:
    require_role(user, "admin", "manager", "kitchen", "dispatcher")
    with connect() as db:
        accessible_order(db, order_id, user)
        rows = db.execute(
            "SELECT a.id, a.event, a.detail, a.created_at, u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.order_id=? ORDER BY a.id DESC",
            (order_id,),
        ).fetchall()
    events = [{**dict(r), "detail": json.loads(r["detail"])} for r in rows]
    if user["role"] == "kitchen":
        for event in events:
            event["detail"].pop("proof", None)
    return events


@app.get("/api/riders")
def riders(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    require_role(user, "admin", "manager", "dispatcher")
    with connect() as db:
        rows = db.execute(
            "SELECT u.id,u.name,u.branches,u.available, COUNT(j.id) AS active_jobs FROM users u LEFT JOIN jobs j ON j.rider_id=u.id AND j.status IN ('assigned','picked_up') WHERE u.role='rider' AND u.active=1 GROUP BY u.id"
        ).fetchall()
    return [
        {**dict(r), "branches": json.loads(r["branches"])}
        for r in rows
        if user["role"] == "admin" or set(json.loads(r["branches"])) & set(user["branches"])
    ]


@app.post("/api/availability")
def availability(
    data: Availability, user: dict[str, Any] = Depends(current_user)
) -> dict[str, bool]:
    require_role(user, "rider")
    with connect(write=True) as db:
        db.execute("UPDATE users SET available=? WHERE id=?", (int(data.available), user["id"]))
        audit(db, user["id"], None, "rider_availability", {"available": data.available})
    return {"ok": True}


def accessible_job(db: sqlite3.Connection, job_id: int, user: dict[str, Any]) -> sqlite3.Row:
    row = db.execute("SELECT order_id FROM jobs WHERE id=?", (job_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Delivery job not found")
    return accessible_order(db, row["order_id"], user)


@app.post("/api/jobs/{job_id}/assign")
def assign(
    job_id: int, data: Assignment, user: dict[str, Any] = Depends(current_user)
) -> dict[str, bool]:
    require_role(user, "admin", "manager", "dispatcher")
    with connect(write=True) as db:
        order = accessible_job(db, job_id, user)
        if order["status"] in {"new", "cancelled", "handed_over"} or order["job_status"] not in {
            "pending",
            "assigned",
        }:
            raise HTTPException(
                409, "Only accepted, preparing or ready orders can be assigned before pickup"
            )
        rider = db.execute(
            "SELECT * FROM users WHERE id=? AND role='rider' AND active=1 AND available=1",
            (data.rider_id,),
        ).fetchone()
        if rider is None or order["branch_id"] not in json.loads(rider["branches"]):
            raise HTTPException(422, "Choose an online rider with access to this branch")
        busy = db.execute(
            "SELECT id FROM jobs WHERE rider_id=? AND status IN ('assigned','picked_up') AND id<>?",
            (data.rider_id, job_id),
        ).fetchone()
        if busy:
            raise HTTPException(409, "This rider already has an active delivery")
        db.execute(
            "UPDATE jobs SET rider_id=?, status='assigned', updated_at=? WHERE id=?",
            (data.rider_id, now(), job_id),
        )
        audit(
            db,
            user["id"],
            order["id"],
            "rider_assigned",
            {"previous_rider": order["rider_id"], "rider_id": data.rider_id},
        )
    return {"ok": True}


@app.post("/api/jobs/{job_id}/status")
def job_status(
    job_id: int, data: JobInput, user: dict[str, Any] = Depends(current_user)
) -> dict[str, bool]:
    require_role(user, "admin", "manager", "dispatcher", "rider")
    with connect(write=True) as db:
        order = accessible_job(db, job_id, user)
        previous = order["job_status"]
        allowed = (previous == "assigned" and data.status == "picked_up") or (
            previous == "picked_up" and data.status in {"delivered", "failed"}
        )
        if not allowed:
            raise HTTPException(409, "Invalid delivery status transition")
        if data.status == "picked_up":
            if order["status"] != "ready":
                raise HTTPException(409, "Kitchen must mark the order ready before pickup")
            db.execute(
                "UPDATE orders SET status='handed_over', updated_at=? WHERE id=?",
                (now(), order["id"]),
            )
        if data.status == "failed" and not data.reason:
            raise HTTPException(422, "A failed-delivery reason is required")
        if data.status == "delivered" and not data.proof:
            raise HTTPException(
                422, "Enter a delivery confirmation note (do not enter sensitive documents)"
            )
        db.execute(
            "UPDATE jobs SET status=?, failure_reason=?, proof=?, updated_at=? WHERE id=?",
            (data.status, data.reason, data.proof, now(), job_id),
        )
        audit(
            db,
            user["id"],
            order["id"],
            "delivery_status_changed",
            {"from": previous, "to": data.status, "reason": data.reason, "proof": data.proof},
        )
    return {"ok": True}


@app.get("/api/users")
def users(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    require_role(user, "admin")
    with connect() as db:
        rows = db.execute("SELECT * FROM users ORDER BY name").fetchall()
    return [public_user({**dict(r), "branches": json.loads(r["branches"])}) for r in rows]


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


app.include_router(hrm_router)

DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}")
def frontend(path: str) -> FileResponse:
    if path.startswith("api/") or not (DIST / "index.html").exists():
        raise HTTPException(404, "Not found. Build the frontend first.")
    return FileResponse(DIST / "index.html")
