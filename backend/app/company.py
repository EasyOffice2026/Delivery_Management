import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator

from .db import audit, connect, now, vehicle_key
from .hrm import STAGES
from .models import Input
from .security import check_branch, current_user, require_role

router = APIRouter(prefix="/api/company", tags=["Delivery company"])


class AggregatorInput(Input):
    name: str = Field(min_length=1, max_length=80)


class VehicleInput(Input):
    branch_id: int
    registration: str = Field(min_length=1, max_length=80)
    vehicle_type: Literal["car", "motorbike"]
    make_model: str = Field(default="", max_length=100)

    @field_validator("registration")
    @classmethod
    def valid_registration(cls, value: str) -> str:
        if not vehicle_key(value):
            raise ValueError("Enter a vehicle registration")
        return value


class VehicleStatus(Input):
    status: Literal["available", "maintenance", "retired"]


def operator(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    require_role(user, "admin", "manager", "dispatcher")
    return user


@router.get("/aggregators")
def aggregators(user: dict[str, Any] = Depends(operator)) -> list[dict[str, Any]]:
    with connect() as db:
        return [
            {"id": r["id"], "name": r["name"], "integration_status": "not_connected"}
            for r in db.execute("SELECT id,name FROM aggregators ORDER BY id")
        ]


@router.post("/aggregators", status_code=201)
def add_aggregator(
    data: AggregatorInput, user: dict[str, Any] = Depends(operator)
) -> dict[str, Any]:
    require_role(user, "admin")
    with connect(write=True) as db:
        if db.execute(
            "SELECT id FROM aggregators WHERE name_key=?", (data.name.casefold(),)
        ).fetchone():
            raise HTTPException(409, "This aggregator already exists")
        cursor = db.execute(
            "INSERT INTO aggregators(name,name_key,created_at) VALUES(?,?,?)",
            (data.name, data.name.casefold(), now()),
        )
        audit(db, user["id"], None, "aggregator_created", {"aggregator_id": cursor.lastrowid})
        return {"id": cursor.lastrowid, "name": data.name, "integration_status": "not_connected"}


@router.get("/drivers")
def drivers(user: dict[str, Any] = Depends(operator)) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute(
            "SELECT e.id,e.name,e.phone,e.branch_id,b.name AS branch_name FROM hr_employees e JOIN branches b ON b.id=e.branch_id ORDER BY e.id DESC"
        ).fetchall()
        result = []
        for row in rows:
            if user["role"] != "admin" and row["branch_id"] not in user["branches"]:
                continue
            states = {
                r["stage"]: r["status"]
                for r in db.execute(
                    "SELECT stage,status FROM hr_stages WHERE employee_id=?", (row["id"],)
                )
            }
            if user["role"] == "dispatcher" and states.get("operations") != "completed":
                continue
            details = {
                r["stage"]: json.loads(r["details"])
                for r in db.execute(
                    "SELECT stage,details FROM hr_stages WHERE employee_id=? AND status='completed' AND stage IN ('mobile','vehicle','operations')",
                    (row["id"],),
                )
            }
            result.append(
                {
                    **dict(row),
                    "code": f"DHR-{row['id']:05d}",
                    "current_stage": next(
                        (s for s in STAGES if states.get(s) != "completed"), "active"
                    ),
                    "completed_stages": sum(states.get(s) == "completed" for s in STAGES),
                    "mobile_number": details.get("mobile", {}).get("mobile_number", ""),
                    "vehicle_registration": details.get("vehicle", {}).get(
                        "vehicle_registration", ""
                    ),
                    "vehicle_type": details.get("vehicle", {}).get("vehicle_type", ""),
                    "aggregator": details.get("operations", {}).get("aggregator", ""),
                    "aggregator_rider_id": details.get("operations", {}).get(
                        "aggregator_rider_id", ""
                    ),
                }
            )
        return result


@router.get("/fleet")
def fleet(user: dict[str, Any] = Depends(operator)) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute(
            "SELECT v.id,v.branch_id,b.name AS branch_name,v.registration,v.vehicle_type,v.make_model,v.status,e.id AS driver_id,e.name AS driver_name FROM fleet_vehicles v JOIN branches b ON b.id=v.branch_id LEFT JOIN hr_resources r ON r.kind='vehicle' AND r.resource_key=v.registration_key LEFT JOIN hr_employees e ON e.id=r.employee_id ORDER BY v.id DESC"
        ).fetchall()
        result = []
        for row in rows:
            if user["role"] != "admin" and row["branch_id"] not in user["branches"]:
                continue
            item = dict(row)
            item["assigned"] = item["driver_id"] is not None
            if (
                user["role"] == "dispatcher"
                and item["assigned"]
                and not db.execute(
                    "SELECT 1 FROM hr_stages WHERE employee_id=? AND stage='operations' AND status='completed'",
                    (item["driver_id"],),
                ).fetchone()
            ):
                item["driver_id"], item["driver_name"] = None, None
            result.append(item)
        return result


@router.post("/fleet", status_code=201)
def add_vehicle(data: VehicleInput, user: dict[str, Any] = Depends(operator)) -> dict[str, int]:
    check_branch(user, data.branch_id)
    with connect(write=True) as db:
        if not db.execute("SELECT id FROM branches WHERE id=?", (data.branch_id,)).fetchone():
            raise HTTPException(422, "Unknown branch")
        key = vehicle_key(data.registration)
        if db.execute("SELECT id FROM fleet_vehicles WHERE registration_key=?", (key,)).fetchone():
            raise HTTPException(409, "This vehicle registration already exists")
        cursor = db.execute(
            "INSERT INTO fleet_vehicles(branch_id,registration,registration_key,vehicle_type,make_model,updated_at) VALUES(?,?,?,?,?,?)",
            (data.branch_id, data.registration, key, data.vehicle_type, data.make_model, now()),
        )
        audit(db, user["id"], None, "vehicle_created", {"vehicle_id": cursor.lastrowid})
        return {"id": int(cursor.lastrowid or 0)}


@router.post("/fleet/{vehicle_id}/status")
def vehicle_status(
    vehicle_id: int, data: VehicleStatus, user: dict[str, Any] = Depends(operator)
) -> dict[str, bool]:
    with connect(write=True) as db:
        row = db.execute("SELECT * FROM fleet_vehicles WHERE id=?", (vehicle_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Vehicle not found")
        check_branch(user, row["branch_id"])
        if (
            data.status == "retired"
            and db.execute(
                "SELECT employee_id FROM hr_resources WHERE kind='vehicle' AND resource_key=?",
                (row["registration_key"],),
            ).fetchone()
        ):
            raise HTTPException(409, "Reassign the driver before retiring this vehicle")
        db.execute(
            "UPDATE fleet_vehicles SET status=?,updated_at=? WHERE id=?",
            (data.status, now(), vehicle_id),
        )
        audit(
            db,
            user["id"],
            None,
            "vehicle_status_changed",
            {"vehicle_id": vehicle_id, "before": row["status"], "after": data.status},
        )
    return {"ok": True}
