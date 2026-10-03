import json
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


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
                role TEXT NOT NULL CHECK(role IN ('admin','manager','kitchen','dispatcher','rider')),
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
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id),
                source TEXT NOT NULL CHECK(source IN ('talabat','keeta','direct')),
                external_id TEXT NOT NULL, delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('platform','own')),
                status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','accepted','preparing','ready','handed_over','cancelled')), customer_name TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '', items TEXT NOT NULL, total_fils INTEGER NOT NULL,
                notes TEXT NOT NULL DEFAULT '', prep_minutes INTEGER NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0,
                UNIQUE(branch_id, source, external_id)
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
                rider_id INTEGER REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','assigned','picked_up','delivered','failed','cancelled')),
                failure_reason TEXT NOT NULL DEFAULT '', proof TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id),
                actor_id INTEGER REFERENCES users(id), event TEXT NOT NULL,
                detail TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS jobs_rider ON jobs(rider_id, status);
            CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active ON jobs(rider_id) WHERE rider_id IS NOT NULL AND status IN ('assigned','picked_up');
            CREATE INDEX IF NOT EXISTS orders_branch ON orders(branch_id, created_at);
            CREATE INDEX IF NOT EXISTS audit_order ON audit(order_id, id);
        """)


def audit(
    db: sqlite3.Connection, actor: int | None, order: int | None, event: str, detail: dict[str, Any]
) -> None:
    db.execute(
        "INSERT INTO audit(order_id, actor_id, event, detail, created_at) VALUES(?,?,?,?,?)",
        (order, actor, event, json.dumps(detail), now()),
    )
