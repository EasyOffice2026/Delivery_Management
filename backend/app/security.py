import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from typing import Any

from fastapi import HTTPException, Request

from .db import connect

ROLES = {"admin", "manager", "kitchen", "dispatcher", "rider"}


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
    return f"scrypt${salt}${value.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    _, salt, expected = encoded.split("$")
    value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
    return hmac.compare_digest(value.hex(), expected)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def check_origin(request: Request) -> None:
    origins = os.getenv(
        "DMS_TRUSTED_ORIGINS", "http://localhost,http://localhost:8010,http://127.0.0.1:8010"
    )
    if request.headers.get("origin") not in {o.strip() for o in origins.split(",")}:
        raise HTTPException(403, "Untrusted origin")


def current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get("dms_session", "")
    with connect() as db:
        row = db.execute(
            """SELECT u.*, s.csrf FROM sessions s JOIN users u ON u.id=s.user_id
                            WHERE s.token_hash=? AND s.expires>? AND u.active=1""",
            (token_hash(token), time.time()),
        ).fetchone()
    if row is None:
        raise HTTPException(401, "Please sign in")
    user = dict(row)
    user["branches"] = json.loads(user["branches"])
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        check_origin(request)
        if not hmac.compare_digest(request.headers.get("x-csrf-token", ""), user["csrf"]):
            raise HTTPException(403, "Invalid CSRF token")
    return user


def require_role(user: dict[str, Any], *roles: str) -> None:
    if user["role"] not in roles:
        raise HTTPException(403, "This action is not permitted for your role")


def check_branch(user: dict[str, Any], branch_id: int) -> None:
    if user["role"] != "admin" and branch_id not in user["branches"]:
        raise HTTPException(403, "You do not have access to this branch")


def public_user(user: dict[str, Any] | sqlite3.Row) -> dict[str, Any]:
    return {key: user[key] for key in ("id", "username", "name", "role", "branches", "available")}
