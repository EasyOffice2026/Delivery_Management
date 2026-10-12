import json
import os
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def vehicle_key(registration: str) -> str:
    return re.sub(r"[\s-]", "", registration).casefold()


@contextmanager
def connect(write: bool = False) -> Iterator[sqlite3.Connection]:
    db = sqlite3.connect(os.getenv("DMS_DB_PATH", "delivery.db"), timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        if write:
            db.execute("BEGIN IMMEDIATE")
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS branches (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, area TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name TEXT NOT NULL, password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin','manager','dispatcher','rider')),
                branches TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
                available INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
                csrf TEXT NOT NULL, expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_attempts (
                key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, started REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY, order_id INTEGER,
                actor_id INTEGER REFERENCES users(id), event TEXT NOT NULL,
                detail TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS audit_order ON audit(order_id, id);
            CREATE TABLE IF NOT EXISTS aggregators (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                name_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS fleet_vehicles (
                id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id),
                registration TEXT NOT NULL, registration_key TEXT NOT NULL UNIQUE,
                vehicle_type TEXT NOT NULL CHECK(vehicle_type IN ('car','motorbike')),
                make_model TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','maintenance','retired')),
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS hr_employees (
                id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id),
                name TEXT NOT NULL, nationality TEXT NOT NULL,
                passport_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
                phone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS hr_stages (
                employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
                stage TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('in_progress','completed')),
                occurred_on TEXT NOT NULL, responsible TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '', details TEXT NOT NULL,
                updated_at TEXT NOT NULL, PRIMARY KEY(employee_id,stage)
            );
            CREATE TABLE IF NOT EXISTS hr_compensation (
                employee_id INTEGER PRIMARY KEY REFERENCES hr_employees(id),
                basic_fils INTEGER NOT NULL CHECK(basic_fils >= 0),
                effective_from TEXT NOT NULL, entries TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS hr_resources (
                employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
                kind TEXT NOT NULL, resource_key TEXT NOT NULL,
                UNIQUE(kind,resource_key), UNIQUE(employee_id,kind)
            );
            CREATE TABLE IF NOT EXISTS hr_documents (
                id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
                kind TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL,
                size INTEGER NOT NULL, content BLOB NOT NULL,
                uploaded_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS hr_audit (
                id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
                actor_id INTEGER NOT NULL REFERENCES users(id), event TEXT NOT NULL,
                detail TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS hr_employees_branch ON hr_employees(branch_id);
            CREATE INDEX IF NOT EXISTS hr_documents_employee ON hr_documents(employee_id);
            CREATE INDEX IF NOT EXISTS hr_audit_employee ON hr_audit(employee_id,id);
        """)
        for name in ("Talabat", "Keeta", "Jahez", "Snoonu"):
            db.execute(
                "INSERT OR IGNORE INTO aggregators(name,name_key,created_at) VALUES(?,?,?)",
                (name, name.casefold(), now()),
            )
        for row in db.execute(
            "SELECT s.details,e.branch_id,e.id AS employee_id FROM hr_stages s JOIN hr_employees e ON e.id=s.employee_id WHERE s.stage='vehicle' AND s.status='completed'"
        ).fetchall():
            details = json.loads(row["details"])
            key = vehicle_key(details["vehicle_registration"])
            db.execute(
                "UPDATE hr_resources SET resource_key=? WHERE employee_id=? AND kind='vehicle'",
                (key, row["employee_id"]),
            )
            db.execute(
                "INSERT OR IGNORE INTO fleet_vehicles(branch_id,registration,registration_key,vehicle_type,updated_at) VALUES(?,?,?,?,?)",
                (
                    row["branch_id"],
                    details["vehicle_registration"],
                    key,
                    details["vehicle_type"],
                    now(),
                ),
            )
        for row in db.execute("SELECT details FROM hr_stages WHERE stage='operations'"):
            name = json.loads(row["details"]).get("aggregator", "").strip()
            if name:
                db.execute(
                    "INSERT OR IGNORE INTO aggregators(name,name_key,created_at) VALUES(?,?,?)",
                    (name, name.casefold(), now()),
                )


def audit(
    db: sqlite3.Connection, actor: int | None, order: int | None, event: str, detail: dict[str, Any]
) -> None:
    db.execute(
        "INSERT INTO audit(order_id, actor_id, event, detail, created_at) VALUES(?,?,?,?,?)",
        (order, actor, event, json.dumps(detail), now()),
    )
