import getpass
import json
import os
import re

from .db import connect, init_db
from .security import hash_password


def main() -> None:
    if os.getenv("DMS_DEMO") == "1":
        raise SystemExit("Unset DMS_DEMO before creating a real administrator")
    username = input("Administrator username: ").strip()
    password = getpass.getpass("Administrator password (12+ characters): ")
    if not re.fullmatch(r"[a-zA-Z0-9_.-]{3,80}", username) or not 12 <= len(password) <= 200:
        raise SystemExit(
            "Use a 3–80 character username (letters, digits, _ . -) and a 12–200 character password"
        )
    init_db()
    with connect(write=True) as db:
        if db.execute("SELECT id FROM users LIMIT 1").fetchone():
            raise SystemExit("Database already has users; sign in as an administrator")
        db.execute(
            "INSERT INTO users(username,name,password_hash,role,branches) VALUES(?,?,?,?,?)",
            (username, "Administrator", hash_password(password), "admin", json.dumps([])),
        )
    print("Administrator created. Start the API with an explicit trusted origin and HTTPS cookies.")


if __name__ == "__main__":
    main()
