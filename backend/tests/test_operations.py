import csv
import io
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import connect
from app.main import app

ORIGIN = "http://localhost"
PASSWORD = "DevDemo!2026"
CSV_HEADERS = "branch_id,source,external_id,delivery_mode,customer_name,phone,area,address,item,quantity,total_kwd,prep_minutes,notes".split(
    ","
)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("DMS_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("DMS_DEMO", "1")
    monkeypatch.setenv("DMS_COOKIE_SECURE", "0")
    with TestClient(app, headers={"Origin": ORIGIN}) as test_client:
        yield test_client


def sign_in(client: TestClient, username: str = "admin") -> dict[str, Any]:
    response = client.post("/api/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    client.headers["X-CSRF-Token"] = data["csrf"]
    return data


def own_order(reference: str = "TEST-1", branch: int = 1) -> dict[str, Any]:
    return {
        "branch_id": branch,
        "source": "direct",
        "external_id": reference,
        "delivery_mode": "own",
        "customer_name": "Fictional Customer",
        "phone": "+96550000000",
        "area": "Sharq",
        "address": "Training address",
        "items": [{"name": "Shawarma", "quantity": 2}],
        "total_fils": 5500,
        "prep_minutes": 20,
        "notes": "No onions",
    }


def as_csv(rows: list[dict[str, Any]]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_HEADERS)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def csv_order(reference: str, branch: int = 1, amount: str = "5.500") -> dict[str, Any]:
    data = own_order(reference, branch)
    del data["items"], data["total_fils"]
    return {**data, "item": "Shawarma", "quantity": 2, "total_kwd": amount}


def test_authentication_csrf_and_session_revocation(client: TestClient) -> None:
    assert client.get("/api/orders").status_code == 401
    response = client.post("/api/login", json={"username": "admin", "password": PASSWORD})
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    token = response.json()["csrf"]
    assert client.post("/api/orders", json=own_order()).status_code == 403
    client.headers["X-CSRF-Token"] = token
    assert (
        client.post(
            "/api/orders", json=own_order(), headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    assert client.post("/api/logout", json={}).status_code == 200
    assert client.get("/api/me").status_code == 401


def test_login_origin_and_rate_limit(client: TestClient) -> None:
    credentials = {"username": "admin", "password": "incorrect"}
    assert (
        client.post(
            "/api/login", json=credentials, headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    for i in range(10):
        credentials["username"] = f"unknown-{i}"
        assert client.post("/api/login", json=credentials).status_code == 401
    assert (
        client.post("/api/login", json={"username": "admin", "password": PASSWORD}).status_code
        == 429
    )


def test_branch_scoping_and_role_permissions(client: TestClient) -> None:
    sign_in(client, "manager")
    assert all(o["branch_id"] == 1 for o in client.get("/api/orders").json())
    assert client.post("/api/orders", json=own_order(branch=2)).status_code == 403
    assert client.get("/api/orders/2/audit").status_code == 403
    assert client.get("/api/users").status_code == 403
    sign_in(client, "kitchen")
    assert client.post("/api/orders", json=own_order()).status_code == 403
    assert all(
        not o["phone"] and not o["address"] and not o["customer_name"]
        for o in client.get("/api/orders").json()
    )
    assert (
        client.post(
            "/api/orders/1/status", json={"status": "cancelled", "reason": "test"}
        ).status_code
        == 403
    )
    sign_in(client, "dispatch")
    assert client.post("/api/orders/1/status", json={"status": "accepted"}).status_code == 403


def test_order_validation_and_duplicate_ids(client: TestClient) -> None:
    sign_in(client)
    assert client.post("/api/orders", json={**own_order(), "total_fils": 5.5}).status_code == 422
    assert client.post("/api/orders", json={**own_order(), "phone": "123"}).status_code == 422
    assert client.post("/api/orders", json={**own_order(), "is_demo": 1}).status_code == 422
    assert client.post("/api/orders", json=own_order()).status_code == 201
    assert client.post("/api/orders", json=own_order()).status_code == 409
    assert client.post("/api/orders", json=own_order(branch=2)).status_code == 201
    assert (
        client.post(
            "/api/orders", json={**own_order("BAD"), "delivery_mode": "platform"}
        ).status_code
        == 422
    )


def test_platform_orders_never_enter_dispatch(client: TestClient) -> None:
    sign_in(client)
    data = {
        **own_order("PLATFORM-1"),
        "source": "talabat",
        "delivery_mode": "platform",
        "customer_name": "",
        "phone": "",
        "area": "",
        "address": "",
    }
    response = client.post("/api/orders", json=data)
    assert response.status_code == 201
    order = next(o for o in client.get("/api/orders").json() if o["id"] == response.json()["id"])
    assert order["job_id"] is None
    assert order["sync_status"] == "manual_only"
    assert (
        client.post(
            "/api/orders", json={**data, "external_id": "PLATFORM-2", "phone": "+96550000000"}
        ).status_code
        == 422
    )


def test_full_own_fleet_delivery_and_rider_privacy(client: TestClient) -> None:
    sign_in(client)
    order_id = client.post("/api/orders", json=own_order()).json()["id"]
    assert (
        client.post(f"/api/orders/{order_id}/status", json={"status": "ready"}).status_code == 409
    )
    for status in ["accepted", "preparing", "ready"]:
        assert (
            client.post(f"/api/orders/{order_id}/status", json={"status": status}).status_code
            == 200
        )
    assert (
        client.post(f"/api/orders/{order_id}/status", json={"status": "handed_over"}).status_code
        == 409
    )
    order = next(o for o in client.get("/api/orders").json() if o["id"] == order_id)
    job = order["job_id"]
    assert client.post(f"/api/jobs/{job}/assign", json={"rider_id": 5}).status_code == 200
    sign_in(client, "rider2")
    assert client.post(f"/api/jobs/{job}/status", json={"status": "picked_up"}).status_code == 403
    sign_in(client, "rider")
    rows = client.get("/api/orders").json()
    assert all(o["rider_id"] == 5 for o in rows)
    assert all(
        "total_fils" not in o and "items" not in o and "notes" not in o and "external_id" not in o
        for o in rows
    )
    assert client.post(f"/api/jobs/{job}/status", json={"status": "picked_up"}).status_code == 200
    assert client.post(f"/api/jobs/{job}/status", json={"status": "delivered"}).status_code == 422
    assert (
        client.post(
            f"/api/jobs/{job}/status",
            json={"status": "delivered", "proof": "Handed to fictional customer"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/jobs/{job}/status", json={"status": "delivered", "proof": "Repeat"}
        ).status_code
        == 409
    )
    sign_in(client)
    history = client.get(f"/api/orders/{order_id}/audit").json()
    assert any(a["detail"].get("to") == "delivered" for a in history)
    assert len(history) == 7
    sign_in(client, "kitchen")
    order = next(o for o in client.get("/api/orders").json() if o["id"] == order_id)
    assert not order["proof"]
    assert all(
        "proof" not in a["detail"] for a in client.get(f"/api/orders/{order_id}/audit").json()
    )


def test_readiness_and_rider_availability(client: TestClient) -> None:
    sign_in(client, "rider")
    assert client.post("/api/availability", json={"available": False}).status_code == 200
    sign_in(client)
    rows = client.get("/api/orders").json()
    ready = next(o for o in rows if o["external_id"] == "DEMO-1003")
    preparing = next(o for o in rows if o["external_id"] == "DEMO-1004")
    assert (
        client.post(f"/api/jobs/{ready['job_id']}/assign", json={"rider_id": 5}).status_code == 422
    )
    assert (
        client.post(f"/api/jobs/{ready['job_id']}/assign", json={"rider_id": 7}).status_code == 422
    )
    assert (
        client.post(f"/api/jobs/{preparing['job_id']}/assign", json={"rider_id": 6}).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/jobs/{preparing['job_id']}/status", json={"status": "picked_up"}
        ).status_code
        == 409
    )


def test_concurrent_assignment_prevents_double_booking(client: TestClient) -> None:
    sign_in(client)
    jobs = [
        o["job_id"]
        for o in client.get("/api/orders").json()
        if o["external_id"] in {"DEMO-1003", "DEMO-1006"}
    ]

    def assign(job: int) -> int:
        return client.post(f"/api/jobs/{job}/assign", json={"rider_id": 5}).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(assign, jobs))
    assert sorted(statuses) == [200, 409]
    with connect() as db:
        assert (
            db.execute(
                "SELECT COUNT(*) FROM jobs WHERE rider_id=5 AND status='assigned'"
            ).fetchone()[0]
            == 1
        )


def test_cancellation_releases_assignment_and_preserves_history(client: TestClient) -> None:
    sign_in(client)
    order = next(o for o in client.get("/api/orders").json() if o["external_id"] == "DEMO-1003")
    assert (
        client.post(f"/api/jobs/{order['job_id']}/assign", json={"rider_id": 5}).status_code == 200
    )
    assert (
        client.post(f"/api/orders/{order['id']}/status", json={"status": "cancelled"}).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/orders/{order['id']}/status",
            json={"status": "cancelled", "reason": "Training cancellation"},
        ).status_code
        == 200
    )
    with connect() as db:
        job = db.execute("SELECT * FROM jobs WHERE id=?", (order["job_id"],)).fetchone()
        assert job["status"] == "cancelled" and job["rider_id"] is None
    assert (
        client.post(f"/api/jobs/{order['job_id']}/assign", json={"rider_id": 5}).status_code == 409
    )
    history = client.get(f"/api/orders/{order['id']}/audit").json()
    assert history[0]["detail"]["reason"] == "Training cancellation"


def test_failed_delivery_remains_auditable_and_frees_rider(client: TestClient) -> None:
    sign_in(client)
    order = next(o for o in client.get("/api/orders").json() if o["external_id"] == "DEMO-1003")
    assert (
        client.post(f"/api/jobs/{order['job_id']}/assign", json={"rider_id": 5}).status_code == 200
    )
    assert (
        client.post(f"/api/jobs/{order['job_id']}/status", json={"status": "picked_up"}).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/orders/{order['id']}/status",
            json={"status": "cancelled", "reason": "Invalid post-pickup"},
        ).status_code
        == 409
    )
    assert (
        client.post(f"/api/jobs/{order['job_id']}/status", json={"status": "failed"}).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/jobs/{order['job_id']}/status",
            json={"status": "failed", "reason": "Customer unavailable"},
        ).status_code
        == 200
    )
    rider = next(r for r in client.get("/api/riders").json() if r["id"] == 5)
    assert rider["active_jobs"] == 0
    history = client.get(f"/api/orders/{order['id']}/audit").json()
    assert history[0]["detail"]["reason"] == "Customer unavailable"


def test_import_is_atomic_idempotent_and_exact_currency(client: TestClient) -> None:
    sign_in(client)
    content = as_csv([csv_order("CSV-1"), csv_order("CSV-1"), csv_order("CSV-2", amount="0.001")])
    assert client.post("/api/orders/import", json={"content": content}).json() == {
        "created": 2,
        "skipped": 1,
    }
    assert client.post("/api/orders/import", json={"content": content}).json() == {
        "created": 0,
        "skipped": 3,
    }
    order = next(o for o in client.get("/api/orders").json() if o["external_id"] == "CSV-2")
    assert order["total_fils"] == 1
    content = as_csv([csv_order("ROLLBACK"), csv_order("BAD", branch=999)])
    assert client.post("/api/orders/import", json={"content": content}).status_code == 422
    assert not any(o["external_id"] == "ROLLBACK" for o in client.get("/api/orders").json())
    sign_in(client, "manager")
    content = as_csv([csv_order("SCOPED-ROLLBACK"), csv_order("DENIED", branch=2)])
    assert client.post("/api/orders/import", json={"content": content}).status_code == 403
    assert not any(o["external_id"] == "SCOPED-ROLLBACK" for o in client.get("/api/orders").json())


@pytest.mark.parametrize("amount", ["5.0001", "-1", "NaN", "Infinity", ""])
def test_import_rejects_invalid_amounts(client: TestClient, amount: str) -> None:
    sign_in(client)
    assert (
        client.post(
            "/api/orders/import", json={"content": as_csv([csv_order("INVALID", amount=amount)])}
        ).status_code
        == 422
    )


def test_team_creation_permissions_and_passwords(client: TestClient) -> None:
    sign_in(client)
    data = {
        "username": "newrider",
        "name": "Test Rider",
        "password": " LeadingAndTrailingSpace ",
        "role": "rider",
        "branches": [1],
    }
    assert client.post("/api/users", json={**data, "branches": []}).status_code == 422
    assert client.post("/api/users", json={**data, "branches": [999]}).status_code == 422
    assert client.post("/api/users", json=data).status_code == 201
    assert client.post("/api/users", json=data).status_code == 409
    response = client.post(
        "/api/login", json={"username": "newrider", "password": data["password"]}
    )
    assert response.status_code == 200
    assert response.json()["user"]["available"] == 0
    assert client.get("/api/users").status_code == 403


def test_unknown_api_paths_do_not_return_frontend(client: TestClient) -> None:
    assert client.get("/api/not-real").status_code == 404
    assert client.get("/api/health").json()["integrations"] == "not_connected"
    assert client.get("/api/health").headers["cache-control"] == "no-store"
