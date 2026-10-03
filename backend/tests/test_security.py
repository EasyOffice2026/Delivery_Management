import time

import pytest
from fastapi.testclient import TestClient

from app.db import connect
from app.security import hash_password, token_hash, verify_password
from tests.test_operations import as_csv, client, csv_order, sign_in

__all__ = ["client"]


def test_password_hashes_are_salted_and_session_tokens_are_not_stored(client: TestClient) -> None:
    first = hash_password("TestExample!2026")
    second = hash_password("TestExample!2026")
    assert first != second
    assert verify_password("TestExample!2026", first)
    assert not verify_password("wrong-password", first)
    sign_in(client)
    cookie = client.cookies["dms_session"]
    with connect() as db:
        row = db.execute("SELECT token_hash FROM sessions").fetchone()
        assert row["token_hash"] == token_hash(cookie) and row["token_hash"] != cookie


@pytest.mark.parametrize("invalidator", ["expiry", "deactivation"])
def test_expired_sessions_and_inactive_users_lose_access(
    client: TestClient, invalidator: str
) -> None:
    sign_in(client)
    with connect(write=True) as db:
        if invalidator == "expiry":
            db.execute("UPDATE sessions SET expires=?", (time.time() - 1,))
        else:
            db.execute("UPDATE users SET active=0 WHERE username='admin'")
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/orders").status_code == 401


def test_only_admin_can_create_branches(client: TestClient) -> None:
    sign_in(client, "manager")
    data = {"name": "Third Demo Branch", "area": "Jahra"}
    assert client.post("/api/branches", json=data).status_code == 403
    sign_in(client)
    assert client.post("/api/branches", json=data).status_code == 201
    assert client.post("/api/branches", json=data).status_code == 409


def test_csv_header_and_row_shape_validation(client: TestClient) -> None:
    sign_in(client)
    valid = as_csv([csv_order("SHAPE")])
    for content in [
        "wrong,headers\n1,2",
        valid.replace(",notes", ",notes,notes"),
        valid.rstrip() + ",extra\n",
        valid.splitlines()[0] + "\n1,direct",
    ]:
        assert client.post("/api/orders/import", json={"content": content}).status_code == 422
