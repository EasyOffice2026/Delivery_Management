import json
import re
import sqlite3
from datetime import date, datetime
from typing import Any, Literal
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import Field, model_validator

from .db import connect, now
from .models import Input
from .security import check_branch, current_user, require_role

STAGES = (
    "selection",
    "visa",
    "arrival",
    "medical",
    "iqama",
    "civil_id",
    "driving_licence",
    "accommodation",
    "mobile",
    "vehicle",
    "operations",
)
StageName = Literal[
    "selection",
    "visa",
    "arrival",
    "medical",
    "iqama",
    "civil_id",
    "driving_licence",
    "accommodation",
    "mobile",
    "vehicle",
    "operations",
]
DocumentKind = Literal[
    "passport", "visa", "medical", "iqama", "civil_id", "driving_licence", "other"
]
MAX_DOCUMENT_SIZE = 5 * 1024 * 1024
router = APIRouter(prefix="/api/hrm", tags=["Delivery HRM"])


class EmployeeInput(Input):
    branch_id: int
    name: str = Field(min_length=1, max_length=160)
    nationality: str = Field(min_length=1, max_length=80)
    passport_number: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9-]+$")
    phone: str = Field(default="", max_length=20, pattern=r"^$|^\+[0-9]{7,15}$")


class CompensationEntry(Input):
    kind: Literal["benefit", "deduction"]
    name: str = Field(min_length=1, max_length=100)
    amount_fils: int = Field(ge=0, le=100_000_000, strict=True)
    frequency: Literal["monthly", "one_off"]


class CompensationInput(Input):
    basic_fils: int = Field(ge=0, le=100_000_000, strict=True)
    effective_from: date
    entries: list[CompensationEntry] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def valid_terms(self) -> "CompensationInput":
        if monthly_net(self.basic_fils, [e.model_dump() for e in self.entries]) < 0:
            raise ValueError("Monthly deductions cannot exceed basic salary plus monthly benefits")
        return self


class StageDetails(Input):
    reference: str = Field(default="", max_length=100)
    expires_on: date | None = None
    accommodation_address: str = Field(default="", max_length=500)
    unit: str = Field(default="", max_length=100)
    mobile_number: str = Field(default="", max_length=20, pattern=r"^$|^\+965[0-9]{8}$")
    handset_id: str = Field(default="", max_length=80)
    vehicle_type: Literal["", "car", "motorbike"] = ""
    vehicle_registration: str = Field(default="", max_length=80)
    aggregator: str = Field(default="", max_length=80)
    aggregator_rider_id: str = Field(default="", max_length=100)


class StageInput(Input):
    status: Literal["in_progress", "completed"]
    occurred_on: date
    responsible: str = Field(min_length=1, max_length=100)
    notes: str = Field(default="", max_length=1000)
    details: StageDetails = Field(default_factory=StageDetails)


def monthly_net(basic: int, entries: list[dict[str, Any]]) -> int:
    return basic + sum(
        e["amount_fils"] * (1 if e["kind"] == "benefit" else -1)
        for e in entries
        if e["frequency"] == "monthly"
    )


def hr_user(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    require_role(user, "admin", "manager")
    return user


def employee(db: sqlite3.Connection, employee_id: int, user: dict[str, Any]) -> sqlite3.Row:
    row = db.execute("SELECT * FROM hr_employees WHERE id=?", (employee_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Employee not found")
    check_branch(user, row["branch_id"])
    return row


def record(
    db: sqlite3.Connection, employee_id: int, actor_id: int, event: str, detail: dict[str, Any]
) -> None:
    db.execute(
        "INSERT INTO hr_audit(employee_id,actor_id,event,detail,created_at) VALUES(?,?,?,?,?)",
        (employee_id, actor_id, event, json.dumps(detail), now()),
    )
    db.execute("UPDATE hr_employees SET updated_at=? WHERE id=?", (now(), employee_id))


def summary(db: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    states = {
        r["stage"]: r["status"]
        for r in db.execute("SELECT stage,status FROM hr_stages WHERE employee_id=?", (row["id"],))
    }
    term = db.execute("SELECT * FROM hr_compensation WHERE employee_id=?", (row["id"],)).fetchone()
    compensation = None if term is None else {**dict(term), "entries": json.loads(term["entries"])}
    if compensation is not None:
        compensation["monthly_net_fils"] = monthly_net(
            compensation["basic_fils"], compensation["entries"]
        )
    return {
        **dict(row),
        "code": f"DHR-{row['id']:05d}",
        "current_stage": next((s for s in STAGES if states.get(s) != "completed"), "active"),
        "completed_stages": sum(states.get(s) == "completed" for s in STAGES),
        "compensation": compensation,
    }


@router.get("/employees")
def list_employees(user: dict[str, Any] = Depends(hr_user)) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute("SELECT * FROM hr_employees ORDER BY id DESC").fetchall()
        return [
            summary(db, r)
            for r in rows
            if user["role"] == "admin" or r["branch_id"] in user["branches"]
        ]


@router.post("/employees", status_code=201)
def create_employee(data: EmployeeInput, user: dict[str, Any] = Depends(hr_user)) -> dict[str, int]:
    check_branch(user, data.branch_id)
    with connect(write=True) as db:
        if not db.execute("SELECT id FROM branches WHERE id=?", (data.branch_id,)).fetchone():
            raise HTTPException(422, "Unknown branch")
        try:
            cursor = db.execute(
                "INSERT INTO hr_employees(branch_id,name,nationality,passport_number,phone,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (
                    data.branch_id,
                    data.name,
                    data.nationality,
                    data.passport_number.upper(),
                    data.phone,
                    now(),
                    now(),
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                409, "An employee with this passport number already exists"
            ) from exc
        employee_id = int(cursor.lastrowid or 0)
        record(db, employee_id, user["id"], "candidate_created", {})
    return {"id": employee_id}


@router.get("/employees/{employee_id}")
def get_employee(employee_id: int, user: dict[str, Any] = Depends(hr_user)) -> dict[str, Any]:
    with connect() as db:
        row = employee(db, employee_id, user)
        stages = {
            r["stage"]: {**dict(r), "details": json.loads(r["details"])}
            for r in db.execute("SELECT * FROM hr_stages WHERE employee_id=?", (employee_id,))
        }
        documents = [
            dict(r)
            for r in db.execute(
                "SELECT id,kind,filename,mime,size,created_at FROM hr_documents WHERE employee_id=? ORDER BY id DESC",
                (employee_id,),
            )
        ]
        history = [
            {**dict(r), "detail": json.loads(r["detail"])}
            for r in db.execute(
                "SELECT h.id,h.event,h.detail,h.created_at,u.name AS actor FROM hr_audit h JOIN users u ON u.id=h.actor_id WHERE h.employee_id=? ORDER BY h.id DESC",
                (employee_id,),
            )
        ]
        return {
            **summary(db, row),
            "stages": [{"stage": s, "status": "pending", **stages.get(s, {})} for s in STAGES],
            "documents": documents,
            "history": history,
        }


@router.post("/employees/{employee_id}/profile")
def update_employee(
    employee_id: int, data: EmployeeInput, user: dict[str, Any] = Depends(hr_user)
) -> dict[str, bool]:
    with connect(write=True) as db:
        row = employee(db, employee_id, user)
        if data.branch_id != row["branch_id"]:
            raise HTTPException(
                409, "Branch transfers require a separate approved transfer workflow"
            )
        try:
            db.execute(
                "UPDATE hr_employees SET name=?,nationality=?,passport_number=?,phone=? WHERE id=?",
                (
                    data.name,
                    data.nationality,
                    data.passport_number.upper(),
                    data.phone,
                    employee_id,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                409, "An employee with this passport number already exists"
            ) from exc
        record(
            db,
            employee_id,
            user["id"],
            "profile_updated",
            {"before": dict(row), "after": data.model_dump()},
        )
    return {"ok": True}


@router.post("/employees/{employee_id}/compensation")
def save_compensation(
    employee_id: int, data: CompensationInput, user: dict[str, Any] = Depends(hr_user)
) -> dict[str, bool]:
    with connect(write=True) as db:
        employee(db, employee_id, user)
        previous = db.execute(
            "SELECT * FROM hr_compensation WHERE employee_id=?", (employee_id,)
        ).fetchone()
        terms = data.model_dump(mode="json")
        db.execute(
            "INSERT INTO hr_compensation VALUES(?,?,?,?,?) ON CONFLICT(employee_id) DO UPDATE SET basic_fils=excluded.basic_fils,effective_from=excluded.effective_from,entries=excluded.entries,updated_at=excluded.updated_at",
            (
                employee_id,
                data.basic_fils,
                data.effective_from.isoformat(),
                json.dumps(terms["entries"]),
                now(),
            ),
        )
        record(
            db,
            employee_id,
            user["id"],
            "compensation_updated",
            {
                "before": None
                if previous is None
                else {**dict(previous), "entries": json.loads(previous["entries"])},
                "after": terms,
            },
        )
    return {"ok": True}


def validate_completion(
    db: sqlite3.Connection, employee_id: int, stage: str, data: StageInput
) -> None:
    details = data.details
    if (
        stage == "selection"
        and not db.execute(
            "SELECT id FROM hr_documents WHERE employee_id=? AND kind='passport'", (employee_id,)
        ).fetchone()
    ):
        raise HTTPException(422, "Upload the candidate's passport copy before completing selection")
    if stage in {"visa", "iqama", "civil_id", "driving_licence"} and not details.reference:
        raise HTTPException(422, "Enter the issued document number/reference")
    if stage == "civil_id" and not re.fullmatch(r"[0-9]{12}", details.reference):
        raise HTTPException(422, "Enter a 12-digit Civil ID number")
    if stage == "accommodation" and not details.accommodation_address:
        raise HTTPException(422, "Enter the accommodation address")
    if stage == "mobile" and not (details.mobile_number and details.handset_id):
        raise HTTPException(422, "Enter the Kuwait mobile number and handset identifier")
    if stage == "vehicle" and not (
        details.vehicle_type and re.sub(r"[\s-]", "", details.vehicle_registration)
    ):
        raise HTTPException(422, "Select a car or motorbike and enter its registration")
    if stage == "operations":
        if not details.aggregator:
            raise HTTPException(422, "Enter the assigned aggregator")
        term = db.execute(
            "SELECT effective_from FROM hr_compensation WHERE employee_id=?", (employee_id,)
        ).fetchone()
        if term is None or term["effective_from"] > data.occurred_on.isoformat():
            raise HTTPException(
                422, "Record compensation terms effective by the operations start date"
            )
        expired = db.execute(
            "SELECT details FROM hr_stages WHERE employee_id=? AND stage IN ('iqama','civil_id','driving_licence')",
            (employee_id,),
        ).fetchall()
        if any(
            (json.loads(r["details"]).get("expires_on") or "9999-12-31")
            < data.occurred_on.isoformat()
            for r in expired
        ):
            raise HTTPException(422, "A recorded document expires before the operations start date")


@router.post("/employees/{employee_id}/stages/{stage}")
def update_stage(
    employee_id: int, stage: StageName, data: StageInput, user: dict[str, Any] = Depends(hr_user)
) -> dict[str, bool]:
    if (
        data.occurred_on > datetime.now(ZoneInfo("Asia/Kuwait")).date()
        and data.status == "completed"
    ):
        raise HTTPException(422, "A completed milestone cannot be dated in the future")
    if data.details.expires_on and data.details.expires_on < data.occurred_on:
        raise HTTPException(422, "Expiry cannot precede the milestone date")
    allowed = {
        "visa": {"reference", "expires_on"},
        "medical": {"reference"},
        "iqama": {"reference", "expires_on"},
        "civil_id": {"reference", "expires_on"},
        "driving_licence": {"reference", "expires_on"},
        "accommodation": {"accommodation_address", "unit"},
        "mobile": {"mobile_number", "handset_id"},
        "vehicle": {"vehicle_type", "vehicle_registration"},
        "operations": {"aggregator", "aggregator_rider_id"},
    }.get(stage, set())
    details = {k: v for k, v in data.details.model_dump(mode="json").items() if v not in ("", None)}
    if set(details) - allowed:
        raise HTTPException(422, "Details do not belong to this milestone")
    with connect(write=True) as db:
        employee(db, employee_id, user)
        states = {
            r["stage"]: dict(r)
            for r in db.execute("SELECT * FROM hr_stages WHERE employee_id=?", (employee_id,))
        }
        index = STAGES.index(stage)
        if any(states.get(s, {}).get("status") != "completed" for s in STAGES[:index]):
            raise HTTPException(409, "Complete earlier onboarding milestones first")
        previous = states.get(stage)
        if previous and previous["status"] == "completed" and data.status != "completed":
            raise HTTPException(409, "A completed milestone cannot be reopened")
        completed_dates = [
            (s, states[s]["occurred_on"])
            for s in STAGES
            if states.get(s, {}).get("status") == "completed" and s != stage
        ]
        if any(
            (STAGES.index(s) < index and d > data.occurred_on.isoformat())
            or (STAGES.index(s) > index and d < data.occurred_on.isoformat())
            for s, d in completed_dates
        ):
            raise HTTPException(422, "Milestone dates must follow the onboarding sequence")
        if data.status == "completed":
            validate_completion(db, employee_id, stage, data)
        resources = {
            "mobile": [
                ("mobile", data.details.mobile_number),
                ("handset", data.details.handset_id.casefold()),
            ],
            "vehicle": [
                ("vehicle", re.sub(r"[\s-]", "", data.details.vehicle_registration).casefold())
            ],
            "operations": [
                (
                    "aggregator_account",
                    f"{data.details.aggregator.casefold()}:{data.details.aggregator_rider_id.casefold()}"
                    if data.details.aggregator_rider_id
                    else "",
                )
            ],
        }.get(stage, [])
        try:
            for kind, key in resources:
                db.execute(
                    "DELETE FROM hr_resources WHERE employee_id=? AND kind=?", (employee_id, kind)
                )
                if key and data.status == "completed":
                    db.execute("INSERT INTO hr_resources VALUES(?,?,?)", (employee_id, kind, key))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                409, "This mobile, handset, vehicle or aggregator account is already assigned"
            ) from exc
        payload = data.model_dump(mode="json")
        payload["details"] = details
        db.execute(
            "INSERT INTO hr_stages VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(employee_id,stage) DO UPDATE SET status=excluded.status,occurred_on=excluded.occurred_on,responsible=excluded.responsible,notes=excluded.notes,details=excluded.details,updated_at=excluded.updated_at",
            (
                employee_id,
                stage,
                data.status,
                data.occurred_on.isoformat(),
                data.responsible,
                data.notes,
                json.dumps(details),
                now(),
            ),
        )
        record(
            db,
            employee_id,
            user["id"],
            "milestone_updated",
            {
                "stage": stage,
                "before": None
                if previous is None
                else {**previous, "details": json.loads(previous["details"])},
                "after": payload,
            },
        )
    return {"ok": True}


@router.post("/employees/{employee_id}/documents", status_code=201)
async def upload_document(
    employee_id: int,
    request: Request,
    kind: DocumentKind,
    filename: str = Query(min_length=1, max_length=160),
    user: dict[str, Any] = Depends(hr_user),
) -> dict[str, int]:
    with connect() as db:
        employee(db, employee_id, user)
    if re.search(r"[\x00-\x1f\x7f/\\]", filename):
        raise HTTPException(422, "Invalid document filename")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_DOCUMENT_SIZE:
            raise HTTPException(413, "Document must be at most 5 MiB")
        content.extend(chunk)
    mime = request.headers.get("content-type", "").split(";", 1)[0]
    signatures = {
        "application/pdf": b"%PDF-",
        "image/png": b"\x89PNG\r\n\x1a\n",
        "image/jpeg": b"\xff\xd8\xff",
    }
    if mime not in signatures or not content.startswith(signatures[mime]):
        raise HTTPException(422, "Upload a PDF, PNG or JPEG with a matching content type")
    extensions = {
        "application/pdf": (".pdf",),
        "image/png": (".png",),
        "image/jpeg": (".jpg", ".jpeg"),
    }
    if not filename.casefold().endswith(extensions[mime]):
        raise HTTPException(422, "Filename extension must match the document type")
    with connect(write=True) as db:
        employee(db, employee_id, user)
        quota = db.execute(
            "SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS size FROM hr_documents WHERE employee_id=?",
            (employee_id,),
        ).fetchone()
        if quota["count"] >= 20 or quota["size"] + len(content) > 25 * 1024 * 1024:
            raise HTTPException(409, "Employee document limit reached (20 files / 25 MiB)")
        cursor = db.execute(
            "INSERT INTO hr_documents(employee_id,kind,filename,mime,size,content,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (employee_id, kind, filename, mime, len(content), bytes(content), user["id"], now()),
        )
        record(
            db,
            employee_id,
            user["id"],
            "document_uploaded",
            {"document_id": cursor.lastrowid, "kind": kind},
        )
    return {"id": int(cursor.lastrowid or 0)}


@router.get("/employees/{employee_id}/documents/{document_id}")
def download_document(
    employee_id: int, document_id: int, user: dict[str, Any] = Depends(hr_user)
) -> Response:
    with connect(write=True) as db:
        employee(db, employee_id, user)
        row = db.execute(
            "SELECT * FROM hr_documents WHERE id=? AND employee_id=?", (document_id, employee_id)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Document not found")
        record(db, employee_id, user["id"], "document_downloaded", {"document_id": document_id})
    return Response(
        content=bytes(row["content"]),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(row['filename'], safe='')}",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
