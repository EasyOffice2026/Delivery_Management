import json

from .db import connect, now, vehicle_key
from .security import hash_password

DEMO_PASSWORD = "DevDemo!2026"


def seed() -> None:
    with connect(write=True) as db:
        db.execute(
            "UPDATE branches SET name='Kuwait City Operations' WHERE name='Kuwait City Kitchen'"
        )
        db.execute("UPDATE branches SET name='Salmiya Operations' WHERE name='Salmiya Kitchen'")
        db.execute("UPDATE users SET active=0 WHERE username='kitchen' AND role='kitchen'")
        if not db.execute("SELECT id FROM users LIMIT 1").fetchone():
            for name, area in [
                ("Kuwait City Operations", "Sharq"),
                ("Salmiya Operations", "Salmiya"),
            ]:
                db.execute("INSERT INTO branches(name,area) VALUES(?,?)", (name, area))
            accounts = [
                ("admin", "Demo Administrator", "admin", [1, 2]),
                ("manager", "Operations Manager", "manager", [1]),
                ("dispatch", "Fleet Coordinator", "dispatcher", [1, 2]),
                ("rider", "Demo Driver Account", "rider", [1]),
            ]
            password = hash_password(DEMO_PASSWORD)
            for username, name, role, branches in accounts:
                db.execute(
                    "INSERT INTO users(username,name,password_hash,role,branches) VALUES(?,?,?,?,?)",
                    (username, name, password, role, json.dumps(branches)),
                )
        if not db.execute("SELECT id FROM fleet_vehicles LIMIT 1").fetchone():
            for branch, registration, kind, model in [
                (1, "DEMO-CAR-01", "car", "Fictional car"),
                (1, "DEMO-BIKE-01", "motorbike", "Fictional motorbike"),
                (2, "DEMO-BIKE-02", "motorbike", "Fictional motorbike"),
            ]:
                db.execute(
                    "INSERT INTO fleet_vehicles(branch_id,registration,registration_key,vehicle_type,make_model,updated_at) VALUES(?,?,?,?,?,?)",
                    (branch, registration, vehicle_key(registration), kind, model, now()),
                )
