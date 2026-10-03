# DeliveryOS — Kuwait Delivery Management

Standalone restaurant order management and own-fleet dispatch for Talabat, Keeta and direct orders. English/Arabic React interface, FastAPI API and a separate SQLite database. It does not share code or data with the CRM, HRM, management or accounting products.

## Working in this first release

- Role-based login with branch-scoped access: administrator, manager, kitchen, dispatcher and rider.
- Manual orders and atomic CSV imports with duplicate detection.
- Unified order inbox, kitchen board, preparation timers and late-preparation alerts.
- Separate delivery responsibility for aggregator delivery versus the business's own fleet.
- Online rider availability, assignment/reassignment before pickup and a single active delivery per rider.
- Mobile rider view, readiness-checked pickup, delivery confirmation notes and failed-delivery reasons.
- Cancellation safeguards and operational audit history.
- Branch/team creation, platform/branch reports and CSV export; KWD amounts stored in fils.

## Explicit limitations

**Neither Talabat nor Keeta is connected.** All changes are local records, not platform acceptances, cancellations, refunds or delivery acknowledgements. No webhook endpoints or fabricated API adapters are exposed. Platform orders must continue to be handled in the official partner tools until an approved live integration is implemented.

Aggregator-delivered orders never create own-fleet jobs. Own-fleet aggregator records should only be entered when the store's contract permits merchant delivery. Platform customer details are not collected. There is no aggregator-rider tracking.

This is an initial operational foundation, not a production deployment or a completed settlement/refund product. Verified payouts, commission reconciliation, refund approval workflows, live GPS, mapping/routing, shifts, cash collection, push notifications, user deactivation/password recovery and reassignment after a failed delivery are not implemented yet. Financial reports show recorded order value, not paid revenue or amounts owed by the platforms. Dashboard data and reports include all loaded historical orders, rather than a date-filtered accounting period.

## Local setup

Requirements: Python 3.10+ and Node.js 22.13+ (Node.js 24 LTS recommended).

```sh
python3 -m venv backend/.venv
backend/.venv/bin/pip install --upgrade pip==26.2 setuptools==83.0.0
backend/.venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
```

Run the same-origin API and built frontend together:

```sh
cd backend
DMS_DEMO=1 DMS_DB_PATH=delivery-demo.db .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8010
```

Open port 8010. The demo is seeded only when `DMS_DEMO=1` and the database has no users. Seeded records are fictional and labeled as training data. Demo accounts: `admin`, `manager`, `kitchen`, `dispatch`, `rider`, `rider2`, `rider3`; password: `DevDemo!2026`. These credentials are exclusively for the isolated demo.

For Vite development, run `npm --prefix frontend run dev` alongside the API. Set `DMS_TRUSTED_ORIGINS` to include the exact frontend origin, such as `http://localhost:5173`, and restart the API. Vite proxies `/api` to port 8010.

### Empty, non-demo workspace

```sh
cd backend
DMS_DB_PATH=delivery.db .venv/bin/python -m app.bootstrap
```

The bootstrap command securely prompts for the first administrator's password; it refuses to run against a database that already has users. Create branches and branch-scoped team accounts through Administration. New riders start offline and must go online through their own account before dispatch.

### Configuration

| Variable | Purpose |
| --- | --- |
| `DMS_DB_PATH` | Database file path; defaults to `delivery.db`. Use distinct demo/test/real paths. |
| `DMS_DEMO` | Set to `1` only for fictional development data. Never enable for real operations. |
| `DMS_TRUSTED_ORIGINS` | Comma-separated exact browser origins accepted for mutations, including login. Defaults to `http://localhost,http://localhost:8010,http://127.0.0.1:8010`. Never derive these from request headers. |
| `DMS_COOKIE_SECURE` | Defaults to `1` outside demo mode. Keep `1` behind HTTPS. Set `0` only for HTTP local development. |

For a reverse-proxied preview, explicitly configure the browser's origin rather than trusting forwarded request headers. Replace local trusted origins with the application's actual HTTPS origin for deployment. No Supabase or other existing project credentials are used.

## Checks

```sh
cd backend
.venv/bin/ruff check app tests
.venv/bin/ruff format --check app tests
.venv/bin/mypy app
.venv/bin/python -m pytest -q
```

```sh
npm --prefix frontend run lint
npm --prefix frontend run format:check
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend audit
```

Automated API tests use temporary databases and never change the preview or real data. Optional dependency security check: install `pip-audit` in the backend virtual environment and run `.venv/bin/pip-audit`.

## CSV imports

Download the template from Orders → Import CSV. Exact columns:

```csv
branch_id,source,external_id,delivery_mode,customer_name,phone,area,address,item,quantity,total_kwd,prep_minutes,notes
```

Use `talabat`, `keeta` or `direct` for source, and `platform` or `own` for delivery responsibility. Direct orders require `own`. Own-fleet rows require customer name, a `+965` number with eight local digits, area and address. Platform rows must leave those four fields empty. Amounts allow three decimal places. Use the branch IDs visible in Administration. Import at most 500 rows/500 KB.

Each CSV row represents one order with one item; use manual entry for multi-item orders. The entire import is rolled back if any nonduplicate row is invalid or unauthorized. The same `(branch_id, source, external_id)` is skipped, including repeats within the file; existing records are never overwritten.

## State and security model

- Local kitchen flow: `new → accepted → preparing → ready → handed_over`. Before handover, authorized managers/admins can cancel with a reason.
- Platform delivery: kitchen staff confirm handover locally; no internal job exists.
- Own fleet: `pending → assigned → picked_up → delivered | failed`. Pickup requires a ready kitchen order and atomically marks it handed over. Delivery/failure requires a confirmation note/reason. Failed jobs are retained as terminal exceptions for managerial follow-up, not silently redispatched.
- Assignments use serialized write transactions and enforce online, branch-scoped riders with only one active job. Reassignment is allowed before pickup.
- Passwords use salted scrypt; session tokens are opaque and stored hashed, expire after eight hours, and use HttpOnly/SameSite cookies. Mutation requests require an exact trusted Origin and a per-session CSRF header. Sign-in attempts are rate-limited by direct client IP. Configure any reverse proxy carefully; do not blindly trust forwarded headers.
- Rider responses omit items, kitchen notes, order reference and monetary totals. Riders only see orders currently assigned to them. Kitchen responses omit customer delivery details. Operational changes are recorded in audit history.
- No file uploads or sensitive proof documents: proof of delivery is a short confirmation note.

SQLite/WAL is suitable for the initial single-service deployment. Production readiness requires approved integration testing, backup/restore verification, monitoring, data-retention policy, HTTPS/proxy configuration, user lifecycle controls and operational sign-off. For multiple API replicas, migrate transactions/constraints to a dedicated PostgreSQL database rather than sharing a SQLite file across machines.

## Future approved integrations

Talabat requires partner approval, NDA, staging access and vendor/chain mapping. Keeta publishes multiple API families; confirm the Kuwait account's enabled family before implementation. Build authenticated inbound events, replay protection, status mapping, retries and visibly separate local/pending/confirmed platform states. Do not infer that refund, settlement or customer-decryption endpoints are enabled for every account.

- Talabat: https://integration.talabat.com/en/documentation/
- Keeta: https://api-docs.mykeeta.com/apis/standard/docs/orderintegrationguide
- Keeta customer-data restrictions: https://api-docs.mykeeta.com/apis/opendelivery/order-api
