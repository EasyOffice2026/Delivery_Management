# Delivery Management — Kuwait delivery company

A standalone delivery-company workspace for managing **drivers, cars, motorbikes and manual assignments** to Talabat, Keeta, Jahez, Snoonu and additional aggregators. This is **not** a restaurant or kitchen order-management system. There is no food ordering, preparation board, handover, restaurant sales reporting or kitchen role. Existing historical order data, if present in an older database, is retained but not exposed through this application or its API.

Talabat, Keeta, Jahez and Snoonu are **not connected**. Adding an aggregator or assigning a rider identifier is a local record only; this does not activate an account, sync deliveries, receive partner acknowledgements or verify government documents.

## Workspaces

- **Overview:** local counts of working drivers, people onboarding, fleet and aggregator partners. Counts are not live deliveries or financial results.
- **Drivers:** branch-scoped operational roster from Delivery HRM records; working drivers show their platform, vehicle and mobile. Fleet coordinators see only employees whose onboarding operations stage is complete. Candidate documents, passport numbers and salary are never included in this roster.
- **Fleet:** inventory of cars/motorbikes by branch, unique normalized registrations, availability, maintenance and retirement. A vehicle is automatically entered into the inventory if first assigned at the HRM vehicle milestone; the branch/type must match an existing registration, and vehicles under maintenance or retired cannot be newly assigned. Assigned vehicles cannot be retired until a manager reassigns the driver in HRM. Fleet updates are audited.
- **Aggregators:** directory seeded with Talabat, Keeta, Jahez and Snoonu. Administrators may add partners without code changes. Completed operations milestones must select a directory partner; each partner remains marked *Not connected*. A platform rider identifier, when present, cannot be assigned to more than one employee for the same platform.
- **Delivery HRM:** independent of HRM Basic, with private HR records and an 11-stage sequence: candidate/passport copy → visa → arrival → medical → Iqama/legal residency → Civil ID → driving licence → housing/accommodation → mobile → vehicle → start on an aggregator. Iqama and housing are separate stages. Compensation terms use integer KWD fils with basic salary and monthly/one-off benefits/deductions; this is **not payroll**. PDF/PNG/JPEG documents are private, authenticated and audited, with 5 MiB/file, 20 files and 25 MiB/employee limits, type/signature checks and no-store downloads. Use fictional documents in the demo.
- **Administration:** branches and access-controlled user accounts. HRM profiles are separate from login accounts; driver user accounts are not yet linked to HRM profiles, and a driver portal is not enabled.

Administrators manage all branches; managers see their assigned branches and HRM; fleet coordinators see branch operations and working drivers but not HRM, candidate profiles or compensation. Retired kitchen accounts cannot sign in. Every state-changing API request requires a valid CSRF token and a trusted Origin. Branch permissions and role checks are enforced on the API, not only in the interface.

## Run locally

Requirements: Python 3.12+, Node 24. Dependencies are pinned in `backend/requirements.txt` and `frontend/package-lock.json`.

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend install
npm --prefix frontend run build
cd backend
DMS_DEMO=1 DMS_DB_PATH=delivery-demo.db DMS_COOKIE_SECURE=0 \
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Open `http://127.0.0.1:8010`. The **fictional demo** seeds operations branches, four aggregator directory entries, three vehicles and operator accounts (`admin`, `manager`, `dispatch`); password: `DevDemo!2026`. Never use the demo flag for real operations. For HTTPS demos, set `DMS_COOKIE_SECURE=1` and configure `DMS_TRUSTED_ORIGINS` to the exact HTTPS origin; the demo account/password must never be deployed for production data.

For a non-demo installation, run `cd backend && .venv/bin/python -m app.bootstrap` once to create an administrator; configure HTTPS, `DMS_COOKIE_SECURE=1`, and exact `DMS_TRUSTED_ORIGINS`. SQLite/WAL is suitable for one service instance. Multiple replicas require a transactional shared database. Verify backup and restore, monitoring, retention/deletion, malware scanning, encrypted document storage and backups, access review and privacy compliance before entering real passports. Document signature checks are not malware scanning.

## Persistent HTTPS demo hosting

`Dockerfile` builds the frontend and serves it alongside FastAPI from one non-root container. `render.yaml` defines a separate Render demo service with one instance and a 1 GB persistent disk mounted at `/var/data`. SQLite and private document data remain in `/var/data/delivery.db`; do not mount an ephemeral filesystem or scale this service to multiple instances.

Set `DMS_TRUSTED_ORIGINS` to the service's exact HTTPS origin before allowing sign-in. Secure cookies are enabled. Automatic deploys are disabled so a branch push cannot silently replace the reviewed demo. This configuration enables **fictional demo accounts**, not production access; use no real personnel documents.

For an existing demo, create a consistent SQLite backup using the SQLite backup API, transfer it over authenticated SSH, and restore it before sharing the hosted URL. Preserve an untouched backup and compare record/document counts after migration. A service restart must retain the same database and records. Persistent disks are not a substitute for independently verified backups; complete the production safeguards above before real operations.

The smallest paid Render service plus 1 GB storage has a published base price of approximately USD 7.25/month, excluding overages and taxes. This is independent hosting, not a temporary tunnel through a Devin session.

## Checks

```bash
cd backend
.venv/bin/ruff check app tests
.venv/bin/ruff format --check app tests
.venv/bin/mypy app
.venv/bin/python -m pytest -q
.venv/bin/pip-audit

# From the repository root, using Node 24:
npm --prefix frontend run lint
npm --prefix frontend run format:check
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend audit
```

**Future work:** Approved aggregator partner access and staging validation, platform-specific permissions and status mapping, driver-account linking, operational trip records or imported delivery metrics, payroll payments, retention and privacy controls, and fleet lifecycle/maintenance history. None is simulated or represented as connected today.
