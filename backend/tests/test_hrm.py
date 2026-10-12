from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import connect
from app.hrm import MAX_DOCUMENT_SIZE, STAGES
from tests.test_operations import client, sign_in

__all__ = ["client"]

DAY = "2025-01-10"
PDF = b"%PDF-1.4\nFictional test passport; not a real document\n%%EOF"


def candidate(passport: str = "TEST-PASSPORT-1", branch: int = 1) -> dict[str, Any]:
    return {
        "branch_id": branch,
        "name": "Fictional Candidate",
        "nationality": "Test",
        "passport_number": passport,
        "phone": "+96550000000",
    }


def create(client: TestClient, passport: str = "TEST-PASSPORT-1", branch: int = 1) -> int:
    response = client.post("/api/hrm/employees", json=candidate(passport, branch))
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def upload(
    client: TestClient,
    employee: int,
    kind: str = "passport",
    content: bytes = PDF,
    filename: str = "passport.pdf",
    mime: str = "application/pdf",
) -> Any:
    return client.post(
        f"/api/hrm/employees/{employee}/documents",
        params={"kind": kind, "filename": filename},
        content=content,
        headers={"Content-Type": mime},
    )


def milestone(
    client: TestClient,
    employee: int,
    stage: str,
    details: dict[str, Any] | None = None,
    day: str = DAY,
    status: str = "completed",
) -> Any:
    return client.post(
        f"/api/hrm/employees/{employee}/stages/{stage}",
        json={
            "status": status,
            "occurred_on": day,
            "responsible": "Fictional HR",
            "notes": "Test milestone",
            "details": details or {},
        },
    )


def advance(client: TestClient, employee: int, through: str = "driving_licence") -> None:
    assert upload(client, employee).status_code == 201
    for stage in STAGES[: STAGES.index(through) + 1]:
        details = (
            {"reference": "123456789012"}
            if stage == "civil_id"
            else {"reference": "TEST-REFERENCE"}
            if stage in {"visa", "iqama", "driving_licence"}
            else {}
        )
        response = milestone(client, employee, stage, details)
        assert response.status_code == 200, response.text


def prepare_operations(client: TestClient, employee: int, suffix: str = "1") -> None:
    advance(client, employee)
    assert (
        milestone(
            client,
            employee,
            "accommodation",
            {"accommodation_address": "Training housing", "unit": "Room 1"},
        ).status_code
        == 200
    )
    assert (
        milestone(
            client,
            employee,
            "mobile",
            {"mobile_number": f"+96550000{int(suffix):03d}", "handset_id": f"HANDSET-{suffix}"},
        ).status_code
        == 200
    )
    assert (
        milestone(
            client,
            employee,
            "vehicle",
            {"vehicle_type": "motorbike", "vehicle_registration": f"TEST-{suffix}"},
        ).status_code
        == 200
    )


def terms(client: TestClient, employee: int, **kwargs: Any) -> Any:
    return client.post(
        f"/api/hrm/employees/{employee}/compensation",
        json={"basic_fils": 150125, "effective_from": DAY, "entries": [], **kwargs},
    )


@pytest.mark.parametrize("username", ["kitchen", "dispatch", "rider"])
def test_hrm_denies_delivery_roles(client: TestClient, username: str) -> None:
    sign_in(client)
    employee = create(client)
    document = upload(client, employee).json()["id"]
    sign_in(client, username)
    assert client.get("/api/hrm/employees").status_code == 403
    assert client.get(f"/api/hrm/employees/{employee}").status_code == 403
    assert client.get(f"/api/hrm/employees/{employee}/documents/{document}").status_code == 403
    assert client.post("/api/hrm/employees", json=candidate("NEW-PASS")).status_code == 403
    assert (
        client.post(f"/api/hrm/employees/{employee}/profile", json=candidate()).status_code == 403
    )
    assert terms(client, employee).status_code == 403
    assert milestone(client, employee, "selection").status_code == 403
    assert upload(client, employee).status_code == 403
    assert "hrm" not in client.get("/api/riders").text


def test_hrm_auth_csrf_and_branch_isolation(client: TestClient) -> None:
    assert client.get("/api/hrm/employees").status_code == 401
    sign_in(client)
    employee = create(client, branch=2)
    document = upload(client, employee).json()["id"]
    sign_in(client, "manager")
    assert client.get("/api/hrm/employees").json() == []
    assert client.get(f"/api/hrm/employees/{employee}").status_code == 403
    assert client.get(f"/api/hrm/employees/{employee}/documents/{document}").status_code == 403
    assert client.post("/api/hrm/employees", json=candidate("OTHER", 2)).status_code == 403
    assert (
        client.post(f"/api/hrm/employees/{employee}/profile", json=candidate(branch=2)).status_code
        == 403
    )
    assert terms(client, employee).status_code == 403
    assert milestone(client, employee, "selection").status_code == 403
    assert upload(client, employee).status_code == 403
    local = create(client, "LOCAL-PASS")
    assert client.get(f"/api/hrm/employees/{local}").status_code == 200
    assert upload(client, local).status_code == 201
    assert terms(client, local).status_code == 200
    assert milestone(client, local, "selection").status_code == 200
    csrf = client.headers.pop("X-CSRF-Token")
    assert terms(client, local).status_code == 403
    assert upload(client, local).status_code == 403
    client.headers["X-CSRF-Token"] = csrf
    assert (
        client.post(
            "/api/hrm/employees",
            json=candidate("BAD-ORIGIN"),
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/hrm/employees/{local}/documents",
            params={"kind": "passport", "filename": "passport.pdf"},
            content=PDF,
            headers={"Origin": "https://evil.example", "Content-Type": "application/pdf"},
        ).status_code
        == 403
    )


def test_hrm_candidate_profile_and_audit(client: TestClient) -> None:
    sign_in(client)
    employee = create(client, "lower-case")
    detail = client.get(f"/api/hrm/employees/{employee}").json()
    assert detail["passport_number"] == "LOWER-CASE"
    assert detail["code"] == "DHR-00001"
    assert detail["current_stage"] == "selection"
    assert detail["completed_stages"] == 0
    assert [s["stage"] for s in detail["stages"]] == list(STAGES)
    assert all(s["status"] == "pending" for s in detail["stages"])
    assert client.post("/api/hrm/employees", json=candidate("LOWER-CASE")).status_code == 409
    assert (
        client.post("/api/hrm/employees", json={**candidate("NEW"), "is_admin": True}).status_code
        == 422
    )
    assert client.post("/api/hrm/employees", json=candidate("INVALID/FILE")).status_code == 422
    assert client.post("/api/hrm/employees", json=candidate("NEW", 9999)).status_code == 422
    assert (
        client.post("/api/hrm/employees", json={**candidate("NEW"), "name": "   "}).status_code
        == 422
    )
    assert client.get("/api/hrm/employees/9999").status_code == 404
    assert (
        client.post(
            f"/api/hrm/employees/{employee}/profile", json=candidate("lower-case", 2)
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/hrm/employees/{employee}/profile",
            json={**candidate("lower-case"), "name": "Corrected fictional name"},
        ).status_code
        == 200
    )
    detail = client.get(f"/api/hrm/employees/{employee}").json()
    assert detail["history"][0]["event"] == "profile_updated"
    assert detail["history"][0]["detail"]["before"]["name"] == "Fictional Candidate"
    assert detail["history"][0]["detail"]["after"]["name"] == "Corrected fictional name"


def test_hrm_sequential_milestones_dates_and_passport(client: TestClient) -> None:
    sign_in(client)
    employee = create(client)
    assert milestone(client, employee, "visa", {"reference": "VISA"}).status_code == 409
    assert milestone(client, employee, "selection").status_code == 422
    assert milestone(client, employee, "selection", status="in_progress").status_code == 200
    assert upload(client, employee, "other").status_code == 201
    assert milestone(client, employee, "selection").status_code == 422
    assert upload(client, employee).status_code == 201
    assert (
        milestone(
            client, employee, "selection", day=(date.today() + timedelta(days=3)).isoformat()
        ).status_code
        == 422
    )
    assert milestone(client, employee, "selection").status_code == 200
    assert milestone(client, employee, "selection", status="in_progress").status_code == 409
    assert milestone(client, employee, "visa").status_code == 422
    assert (
        milestone(client, employee, "visa", {"reference": "VISA"}, "2025-01-09").status_code == 422
    )
    assert (
        milestone(
            client, employee, "visa", {"reference": "VISA", "expires_on": "2025-01-09"}
        ).status_code
        == 422
    )
    assert (
        milestone(
            client, employee, "visa", {"reference": "VISA", "accommodation_address": "Wrong stage"}
        ).status_code
        == 422
    )
    assert (
        milestone(client, employee, "visa", {"reference": "VISA"}, "2025-01-11").status_code == 200
    )
    assert milestone(client, employee, "selection", day="2025-01-12").status_code == 422
    assert milestone(client, employee, "unknown").status_code == 422
    detail = client.get(f"/api/hrm/employees/{employee}").json()
    assert detail["current_stage"] == "arrival"
    assert detail["completed_stages"] == 2


def test_hrm_iqama_housing_civil_id_and_assignments(client: TestClient) -> None:
    sign_in(client)
    employee = create(client)
    advance(client, employee, "medical")
    assert milestone(client, employee, "iqama").status_code == 422
    assert (
        milestone(
            client, employee, "iqama", {"accommodation_address": "Housing is not Iqama"}
        ).status_code
        == 422
    )
    assert milestone(client, employee, "iqama", {"reference": "IQAMA-TEST"}).status_code == 200
    assert milestone(client, employee, "civil_id", {"reference": "123"}).status_code == 422
    assert milestone(client, employee, "civil_id", {"reference": "123456789012"}).status_code == 200
    assert (
        milestone(client, employee, "driving_licence", {"reference": "LICENCE-TEST"}).status_code
        == 200
    )
    assert milestone(client, employee, "accommodation").status_code == 422
    assert (
        milestone(
            client,
            employee,
            "accommodation",
            {"accommodation_address": "Fictional housing", "unit": "Bed 2"},
        ).status_code
        == 200
    )
    assert (
        milestone(client, employee, "mobile", {"mobile_number": "+96550000001"}).status_code == 422
    )
    assert (
        milestone(
            client, employee, "mobile", {"mobile_number": "50000001", "handset_id": "SERIAL"}
        ).status_code
        == 422
    )
    assert (
        milestone(
            client, employee, "mobile", {"mobile_number": "+96550000001", "handset_id": "SERIAL"}
        ).status_code
        == 200
    )
    assert (
        milestone(
            client, employee, "vehicle", {"vehicle_type": "truck", "vehicle_registration": "TEST"}
        ).status_code
        == 422
    )
    assert milestone(client, employee, "vehicle", {"vehicle_type": "car"}).status_code == 422
    assert (
        milestone(
            client, employee, "vehicle", {"vehicle_type": "car", "vehicle_registration": "TEST"}
        ).status_code
        == 200
    )


def test_hrm_compensation_fils_and_frequencies(client: TestClient) -> None:
    sign_in(client)
    employee = create(client)
    for invalid in (1.5, True, -1, "150125", 100_000_001):
        assert terms(client, employee, basic_fils=invalid).status_code == 422
    assert (
        terms(
            client,
            employee,
            entries=[
                {"kind": "deduction", "name": "Bad", "amount_fils": 150126, "frequency": "monthly"}
            ],
        ).status_code
        == 422
    )
    entries = [
        {"kind": "benefit", "name": "Food", "amount_fils": 25500, "frequency": "monthly"},
        {
            "kind": "deduction",
            "name": "Agreed deduction",
            "amount_fils": 10125,
            "frequency": "monthly",
        },
        {"kind": "deduction", "name": "One-off", "amount_fils": 300000, "frequency": "one_off"},
    ]
    assert terms(client, employee, entries=entries).status_code == 200
    detail = client.get(f"/api/hrm/employees/{employee}").json()
    assert detail["compensation"]["basic_fils"] == 150125
    assert detail["compensation"]["entries"] == entries
    assert detail["compensation"]["monthly_net_fils"] == 165500
    assert terms(client, employee, basic_fils=160125).status_code == 200
    history = client.get(f"/api/hrm/employees/{employee}").json()["history"][0]
    assert history["detail"]["before"]["basic_fils"] == 150125
    assert history["detail"]["after"]["basic_fils"] == 160125


def test_hrm_operations_need_current_terms_and_valid_documents(client: TestClient) -> None:
    sign_in(client)
    employee = create(client)
    prepare_operations(client, employee)
    assert milestone(client, employee, "operations", {"aggregator": "Keeta"}).status_code == 422
    assert terms(client, employee, effective_from="2025-01-11").status_code == 200
    assert milestone(client, employee, "operations", {"aggregator": "Keeta"}).status_code == 422
    assert terms(client, employee).status_code == 200
    assert milestone(client, employee, "operations").status_code == 422
    assert (
        milestone(
            client,
            employee,
            "driving_licence",
            {"reference": "LICENCE", "expires_on": "2025-01-10"},
        ).status_code
        == 200
    )
    assert (
        milestone(
            client, employee, "operations", {"aggregator": "Keeta"}, day="2025-01-11"
        ).status_code
        == 422
    )
    assert (
        milestone(client, employee, "operations", {"aggregator": "Other platform"}).status_code
        == 200
    )
    detail = client.get(f"/api/hrm/employees/{employee}").json()
    assert detail["current_stage"] == "active"
    assert detail["completed_stages"] == 11


def test_hrm_assignment_conflicts_rollback_and_release(client: TestClient) -> None:
    sign_in(client)
    first, second = create(client), create(client, "SECOND-PASS")
    prepare_operations(client, first, "1")
    prepare_operations(client, second, "2")
    assert (
        milestone(
            client, second, "mobile", {"mobile_number": "+96550000001", "handset_id": "DIFFERENT"}
        ).status_code
        == 409
    )
    assert (
        milestone(
            client, second, "mobile", {"mobile_number": "+96550000003", "handset_id": "handset-1"}
        ).status_code
        == 409
    )
    with connect() as db:
        assert (
            dict(
                db.execute(
                    "SELECT kind,resource_key FROM hr_resources WHERE employee_id=?", (second,)
                ).fetchall()
            )["mobile"]
            == "+96550000002"
        )
    assert (
        milestone(
            client, second, "vehicle", {"vehicle_type": "car", "vehicle_registration": "test 1"}
        ).status_code
        == 409
    )
    assert terms(client, first).status_code == terms(client, second).status_code == 200
    assignment = {"aggregator": "Keeta", "aggregator_rider_id": "RIDER-1"}
    assert milestone(client, first, "operations", assignment).status_code == 200
    assert (
        milestone(
            client, second, "operations", {"aggregator": "keeta", "aggregator_rider_id": "rider-1"}
        ).status_code
        == 409
    )
    assert milestone(client, first, "operations", {"aggregator": "Keeta"}).status_code == 200
    assert milestone(client, second, "operations", assignment).status_code == 200
    assert (
        milestone(
            client, first, "mobile", {"mobile_number": "+96550000003", "handset_id": "NEW"}
        ).status_code
        == 200
    )
    assert (
        milestone(
            client, second, "mobile", {"mobile_number": "+96550000001", "handset_id": "HANDSET-1"}
        ).status_code
        == 200
    )


def test_hrm_document_privacy_download_and_audit(client: TestClient) -> None:
    sign_in(client)
    employee = create(client)
    response = upload(client, employee, filename="جواز تجريبي.pdf")
    assert response.status_code == 201
    document = response.json()["id"]
    path = f"/api/hrm/employees/{employee}/documents/{document}"
    detail = client.get(f"/api/hrm/employees/{employee}").json()
    assert "content" not in detail["documents"][0]
    assert PDF.decode() not in client.get("/api/hrm/employees").text
    download = client.get(path)
    assert download.status_code == 200
    assert download.content == PDF
    assert download.headers["content-type"] == "application/octet-stream"
    assert download.headers["content-disposition"].startswith("attachment; filename*=UTF-8''")
    assert download.headers["cache-control"] == "no-store"
    assert download.headers["x-content-type-options"] == "nosniff"
    assert download.headers["content-security-policy"] == "default-src 'none'; sandbox"
    history = client.get(f"/api/hrm/employees/{employee}").json()["history"]
    assert [h["event"] for h in history[:2]] == ["document_downloaded", "document_uploaded"]
    other = create(client, "OTHER-PASS")
    assert client.get(f"/api/hrm/employees/{other}/documents/{document}").status_code == 404
    assert client.get(f"/api/hrm/employees/{employee}/documents/9999").status_code == 404
    sign_in(client, "rider")
    assert client.get(path).status_code == 403
    client.cookies.clear()
    assert client.get(path).status_code == 401


@pytest.mark.parametrize(
    "kind,filename,mime,content,status",
    [
        ("passport", "../file.pdf", "application/pdf", PDF, 422),
        ("passport", "file\\name.pdf", "application/pdf", PDF, 422),
        ("passport", "file\n.pdf", "application/pdf", PDF, 422),
        ("passport", "file.html", "application/pdf", PDF, 422),
        ("passport", "file.pdf", "text/html", PDF, 422),
        ("passport", "file.pdf", "application/pdf", b"not-pdf", 422),
        ("passport", "file.png", "image/png", PDF, 422),
        ("unknown", "file.pdf", "application/pdf", PDF, 422),
        ("passport", "file.PNG", "image/png", b"\x89PNG\r\n\x1a\nTEST", 201),
        ("passport", "file.jpeg", "image/jpeg", b"\xff\xd8\xffTEST", 201),
    ],
)
def test_hrm_document_validation(
    client: TestClient, kind: str, filename: str, mime: str, content: bytes, status: int
) -> None:
    sign_in(client)
    employee = create(client)
    assert upload(client, employee, kind, content, filename, mime).status_code == status


def test_hrm_document_size_and_count_limits(client: TestClient) -> None:
    sign_in(client)
    employee = create(client)
    assert upload(client, employee, content=b"%PDF-" + bytes(MAX_DOCUMENT_SIZE)).status_code == 413
    assert client.get(f"/api/hrm/employees/{employee}").json()["documents"] == []
    for _ in range(20):
        assert upload(client, employee).status_code == 201
    assert upload(client, employee).status_code == 409
    other = create(client, "LARGE-PASS")
    large = b"%PDF-" + bytes(MAX_DOCUMENT_SIZE - 5)
    for _ in range(5):
        assert upload(client, other, content=large).status_code == 201
    assert upload(client, other).status_code == 409


def test_hrm_concurrent_vehicle_assignment(client: TestClient) -> None:
    sign_in(client)
    first, second = create(client), create(client, "SECOND-PASS")
    prepare_operations(client, first, "1")
    prepare_operations(client, second, "2")

    def assign(employee: int) -> int:
        return int(
            milestone(
                client,
                employee,
                "vehicle",
                {"vehicle_type": "car", "vehicle_registration": "SHARED-TEST"},
            ).status_code
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(assign, [first, second]))
    assert sorted(results) == [200, 409]
    with connect() as db:
        assert (
            db.execute(
                "SELECT COUNT(*) FROM hr_resources WHERE kind='vehicle' AND resource_key='sharedtest'"
            ).fetchone()[0]
            == 1
        )
