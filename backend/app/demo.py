import json
from datetime import datetime, timedelta, timezone

from .db import audit, connect, now
from .security import hash_password

DEMO_PASSWORD = "DevDemo!2026"


def seed() -> None:
    with connect(write=True) as db:
        if db.execute("SELECT id FROM users LIMIT 1").fetchone():
            return
        for name, area in [("Kuwait City Kitchen", "Sharq"), ("Salmiya Kitchen", "Salmiya")]:
            db.execute("INSERT INTO branches(name,area) VALUES(?,?)", (name, area))
        accounts = [
            ("admin", "Demo Administrator", "admin", [1, 2]),
            ("manager", "Branch Manager", "manager", [1]),
            ("kitchen", "Kitchen Operator", "kitchen", [1, 2]),
            ("dispatch", "Fleet Dispatcher", "dispatcher", [1, 2]),
            ("rider", "Omar · Demo Rider", "rider", [1, 2]),
            ("rider2", "Fahad · Demo Rider", "rider", [1, 2]),
            ("rider3", "Ali · Demo Rider", "rider", [2]),
        ]
        password = hash_password(DEMO_PASSWORD)
        for username, name, role, branches in accounts:
            db.execute(
                "INSERT INTO users(username,name,password_hash,role,branches,available) VALUES(?,?,?,?,?,?)",
                (username, name, password, role, json.dumps(branches), int(role == "rider")),
            )
        examples = [
            ("talabat", "platform", "new", 1, "Chicken shawarma", 2750),
            ("keeta", "platform", "accepted", 2, "Family grill platter", 8900),
            ("direct", "own", "ready", 1, "Beef burger meal", 4250),
            ("talabat", "own", "preparing", 1, "Mixed shawarma box", 6200),
            ("keeta", "platform", "ready", 1, "Chicken rice bowl", 3500),
            ("keeta", "own", "ready", 2, "Falafel meal", 2100),
            ("direct", "own", "handed_over", 1, "Grill combo", 7800),
            ("talabat", "platform", "handed_over", 2, "Fresh juice & wrap", 2900),
        ]
        for i, (source, mode, status, branch, item, amount) in enumerate(examples):
            created = (datetime.now(timezone.utc) - timedelta(minutes=6 + i * 4)).isoformat()
            cursor = db.execute(
                "INSERT INTO orders(branch_id,source,external_id,delivery_mode,status,customer_name,phone,area,address,items,total_fils,notes,prep_minutes,created_at,updated_at,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                (
                    branch,
                    source,
                    f"DEMO-{1001 + i}",
                    mode,
                    status,
                    "Fictional Customer" if mode == "own" else "",
                    "+96550000000" if mode == "own" else "",
                    "Sharq" if mode == "own" else "",
                    "Demo address — Block 2, Street 4, Building 8" if mode == "own" else "",
                    json.dumps([{"name": item, "quantity": 1}]),
                    amount,
                    "Fictional training order. No aggregator connection.",
                    20,
                    created,
                    now(),
                ),
            )
            order_id = cursor.lastrowid
            audit(db, 1, order_id, "demo_order_created", {"status": status})
            if mode == "own":
                job_status = "delivered" if status == "handed_over" else "pending"
                db.execute(
                    "INSERT INTO jobs(order_id,rider_id,status,proof,updated_at) VALUES(?,?,?,?,?)",
                    (
                        order_id,
                        5 if job_status == "delivered" else None,
                        job_status,
                        "Demo delivery confirmation" if job_status == "delivered" else "",
                        now(),
                    ),
                )
