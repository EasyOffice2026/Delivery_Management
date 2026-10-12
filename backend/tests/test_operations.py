from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import connect, init_db
from app.main import app

ORIGIN = "http://localhost"
PASSWORD = "DevDemo!2026"


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


def test_company_defaults_and_manual_platforms(client: TestClient) -> None:
    sign_in(client)
    assert client.get("/api/health").json()["integrations"] == "not_connected"
    platforms = client.get("/api/company/aggregators").json()
    assert [p["name"] for p in platforms] == ["Talabat", "Keeta", "Jahez", "Snoonu"]
    assert all(p["integration_status"] == "not_connected" for p in platforms)
    assert (
        client.post("/api/company/aggregators", json={"name": "Another partner"}).status_code == 201
    )
    assert (
        client.post("/api/company/aggregators", json={"name": "another PARTNER"}).status_code == 409
    )
    init_db()
    assert len(client.get("/api/company/aggregators").json()) == 5


def test_company_branches_roles_and_private_candidate_data(client: TestClient) -> None:
    assert client.get("/api/company/drivers").status_code == 401
    sign_in(client)
    for branch in (1, 2):
        response = client.post(
            "/api/hrm/employees",
            json={
                "name": f"Fictional {branch}",
                "branch_id": branch,
                "nationality": "Test",
                "passport_number": f"TEST-{branch}",
                "phone": "+96550000000",
            },
        )
        assert response.status_code == 201, response.text
    sign_in(client, "dispatch")
    rows = client.get("/api/company/drivers").json()
    assert rows == []  # Coordinators see working drivers only, not private candidates.
    assert client.get("/api/hrm/employees").status_code == 403
    assert client.post("/api/company/aggregators", json={"name": "Custom"}).status_code == 403
    sign_in(client, "manager")
    rows = client.get("/api/company/drivers").json()
    assert [row["branch_id"] for row in rows] == [1]
    assert "passport_number" not in str(rows) and "compensation" not in str(rows)
    assert len(client.get("/api/company/fleet").json()) == 2
    assert (
        client.post(
            "/api/company/fleet",
            json={"branch_id": 2, "vehicle_type": "car", "registration": "MANAGER-2"},
        ).status_code
        == 403
    )
    sign_in(client, "rider")
    assert client.get("/api/company/drivers").status_code == 403
    assert client.get("/api/company/fleet").status_code == 403


def test_fleet_validation_assignment_and_status(client: TestClient) -> None:
    sign_in(client)
    new = client.post(
        "/api/company/fleet",
        json={
            "branch_id": 1,
            "vehicle_type": "car",
            "registration": "KW-123  ",
            "make_model": "Test car",
        },
    )
    assert new.status_code == 201, new.text
    vehicle = new.json()["id"]
    assert (
        client.post(
            "/api/company/fleet",
            json={"branch_id": 2, "vehicle_type": "car", "registration": "kw123"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/company/fleet",
            json={"branch_id": 1, "vehicle_type": "car", "registration": "---"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/company/fleet",
            json={"branch_id": 500, "vehicle_type": "car", "registration": "NEW"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/company/fleet/{vehicle}/status", json={"status": "maintenance"}
        ).status_code
        == 200
    )
    assert client.get("/api/company/fleet").json()[0]["status"] == "maintenance"
    sign_in(client, "manager")
    assert (
        client.post(f"/api/company/fleet/{vehicle}/status", json={"status": "retired"}).status_code
        == 200
    )
    sign_in(client)
    assert (
        client.post(
            f"/api/company/fleet/{vehicle}/status", json={"status": "available"}
        ).status_code
        == 200
    )


def test_retired_restaurant_workflows_are_not_exposed(client: TestClient) -> None:
    sign_in(client)
    for path in ("/api/orders", "/api/orders/1", "/api/orders/1/history", "/api/riders"):
        assert client.get(path).status_code == 404
    for path in ("/api/orders", "/api/orders/import", "/api/orders/1/status", "/api/jobs/1/assign"):
        assert client.post(path, json={}).status_code in (404, 405)
    assert (
        client.post("/api/login", json={"username": "kitchen", "password": PASSWORD}).status_code
        == 401
    )
    assert all(user["role"] != "kitchen" for user in client.get("/api/users").json())


def test_old_company_records_are_not_destroyed_by_schema_upgrade(client: TestClient) -> None:
    sign_in(client)
    with connect(write=True) as db:
        db.execute(
            "INSERT INTO hr_employees(branch_id,name,nationality,passport_number,created_at,updated_at) VALUES(1,'Fictional retained','Test','MIGRATE-1','2025-01-01','2025-01-01')"
        )
        db.execute(
            "INSERT INTO hr_stages VALUES(1,'vehicle','completed','2025-01-01','Fictional','',?, '2025-01-01')",
            ('{"vehicle_type":"car","vehicle_registration":"RETAIN-1"}',),
        )
        db.execute("INSERT INTO hr_resources VALUES(1,'vehicle','retain-1')")
    init_db()
    retained = next(
        v for v in client.get("/api/company/fleet").json() if v["registration"] == "RETAIN-1"
    )
    assert retained["assigned"] and retained["driver_id"] == 1
    assert client.get("/api/hrm/employees/1").status_code == 200
