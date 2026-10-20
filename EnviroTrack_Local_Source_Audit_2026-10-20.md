# EnviroTrack Local Source Audit

**Audit snapshot:** 2026-10-20  
**Source:** `EnviroTrack-source-audit-20261020-213608.zip`  
**Repository recorded by bundle:** `D:\Projects\inventory\envirozone-inventory-system`  
**Scope:** Static review of the source files included in the bundle. No application build, runtime test suite, live database, or GitHub Actions run was executed as part of this review.

## Executive result

**EnviroTrack is not fully complete.** The bundle shows meaningful implementation beyond CRUD: stock-ledger guards, serializable transactions and retries, idempotency models/routes, location balances, purchase-order receiving, serialized assets, work orders, calibration records, notifications, reports, Docker configuration, CI workflow, and documentation.

However, several completion claims need evidence or code changes. The most important release blockers are:

1. The CI workflow does not provision PostgreSQL or set `STOCK_TEST_DATABASE_URL`, so the guarded PostgreSQL integration suites are configured to skip in CI rather than prove their behavior.
2. The AI “assistant” is a keyword-overlap retrieval prototype, not a complete document-ingestion + embedding/vector-retrieval RAG workflow; there is no corresponding assistant page in the included frontend.
3. Location-level balances are implemented, but location identifiers are still optional on non-transfer stock movements. Some accepted stock transactions update the item-level ledger without updating a location balance, so the two views can diverge.
4. Work-order status changes do not enforce an allowed transition matrix or require a resolution on completion. Calibration accepts an invalid `calibrationDate` by falling back to the current date.
5. The `viewReports` permission is defined but is not applied to report endpoints. Any authenticated role can access those routes, including a `VIEWER` whose permission matrix says `viewReports: false`.
6. Documentation is inconsistent with code: `docs/PROJECT_GUIDE.md` says there are no tests/CI and no audit reader, while tests/CI and an audit-log route/UI are present; `docs/EnviroTrack_Stock_Location_Decision.md` says location-balance implementation is still undecided even though location-balance code and migrations are present.

The bundle's local Git status says `main...origin/main` with no tracked diff. The only untracked files listed are `EnviroTrack_Copilot_Implementation_Chain.md` and `EnviroTrack_Create_Audit_Bundle.ps1`. Thus, at the recorded snapshot, the implementation changes were not showing as unstaged tracked-file changes; this does not prove that the runtime is healthy or tests passed.

## Phase-by-phase assessment

Statuses below are based on code presence and static inspection, not successful execution.

| Phase | Assessment | Evidence / remaining work |
|---|---|---|
| 0. Repository audit and baseline | **Partial** | Architecture and implementation-plan material exists, but no current feature audit matrix/baseline result file is present in the bundle. Runtime/build/database baseline checks were not performed by this audit. |
| 1. Verify stock-safety implementation | **Implemented in code; not runtime-verified** | `stock.routes.ts` validates quantities, checks item-level stock, uses a Serializable transaction, retries `P2034` conflicts, and writes the audit/idempotency row in the transaction. Other stock writers exist in purchase-order receiving and work-order parts, so all paths must continue to be tested together. |
| 2. Correct stock movement safely | **Partial** | Serializable transaction and row-locking helpers exist. Location balance consistency is not guaranteed when a transaction omits the relevant location. No live PostgreSQL test was executed during this audit. |
| 3. Testing strategy and inventory tests | **Partial** | Unit tests and PostgreSQL integration test files exist. The CI workflow does not start PostgreSQL or set `STOCK_TEST_DATABASE_URL`; integration suites use `test.skip` when that variable is missing. The stock route's concurrent test helpers are not a replacement for exercising the HTTP endpoint itself. `authorization.test.ts` is not listed among the CI test commands. |
| 4. Idempotency | **Partial** | Durable unique-key models, hashing, route handling, and tests exist for stock and PO receiving. The header is optional; requests without it intentionally create independent operations. No frontend code in the bundle sends `Idempotency-Key`, so UI retries aren't protected by this feature by default. |
| 5. Purchase-order receiving | **Mostly implemented; needs real integration run** | State checks, partial receipt counters, idempotency support, serializable transaction, stock movements, and audit writes exist. Tests cover partial/complete receipt, duplicate keyed receipt, over-receipt, invalid state, and authorization. Tests aren't shown as having run against PostgreSQL. Location remains optional when receiving, which matters if per-location balances are authoritative. |
| 6. Location-level inventory decision and implementation | **Partial / inconsistent** | `LocationStockBalance`, `location-stock.service.ts`, `/api/stock/balances`, location reporting, migrations, and a guarded backfill script exist. But `INWARD`, `OUTWARD`, and `ADJUSTMENT` requests may omit locations; `getLocationChanges()` then returns no balance change while the stock transaction is still created. `docs/EnviroTrack_Stock_Location_Decision.md` is stale because it still says a decision is required and the current code doesn't update balances. The backfill has not been run/verified here and safely stops when old transactions cannot be assigned. |
| 7. Audit trail and authorization | **Partial** | A centralized role/action matrix, auth middleware, audit route/UI, and transaction-scoped audit writes for important operations exist. However, `viewReports` is not enforced in `reports.routes.ts` (the router only applies `requireAuth`); the viewer role can therefore call reports even though `can("VIEWER", "viewReports")` is false. Core business records also have no consistent tenant scoping; this is not multi-tenant-ready if that is a required product goal. |
| 8. Asset lifecycle, maintenance, calibration | **Partial** | Serialized assets, status fields, asset history endpoint, work orders, parts consumption, calibration records, schema models, UI pages, and an integration test file exist. `MaintenancePlan` is present only in the schema; no API route/UI workflow uses it. Work-order status can be changed to any valid enum without validating transitions, and completion doesn't require resolution. Asset status transitions are also unrestricted. An invalid `calibrationDate` falls back to `new Date()` instead of being rejected. Certificate number metadata exists, but the bundle doesn't show an actual certificate file upload/extraction workflow. |
| 9. Dashboard, reporting, performance | **Partial** | Reports/dashboard and unit tests exist, but some report handlers load all matching rows and sort/page in application memory (`/stock/items`, `/stock/locations`); movement totals load all matching transactions. `classifyStock()` treats stock equal to `minimumStock` as healthy while notification scanning treats it as low stock. CSV cells are quoted but formula-leading values are not neutralized against spreadsheet formula injection. |
| 10. Production hardening | **Partial** | CI workflow, Docker Compose, API health/readiness endpoints, seed guardrails, deployment docs, login rate limiting and environment validation are present. But CI currently doesn't provide the database URL used by integration tests and doesn't define PostgreSQL service containers; its integration commands can silently skip. Compose publishes Postgres and Redis ports on all host interfaces and uses a hardcoded development password; docs call this local-only, but loopback binding/environment-based configuration would be safer. Migrations have not been proven on fresh and representative existing databases in this audit. Redis is explicitly documented as not used by the application today. |
| 11. AI maintenance-document assistant | **Incomplete prototype** | Knowledge-document/chunk tables, a protected API endpoint, chunking, citations, and optional provider call exist. In the inspected service, retrieval uses simple term overlap; stored `embedding` fields are not generated or queried. The document endpoint accepts caller-supplied `sourceText`, rather than uploading and parsing a PDF/file, and no AI assistant UI/page exists in the frontend bundle. No RAG evaluation tests are present. Do not claim full RAG is complete. |

## Priority findings with precise source locations

### P0 — Make CI run the integration tests for real

- `.github/workflows/ci.yml` defines a `DATABASE_URL` but no PostgreSQL `services:` container.
- The workflow does not set `STOCK_TEST_DATABASE_URL`.
- `apps/api/test/stock-ledger.integration.test.ts`, `purchase-order-receiving.integration.test.ts`, and `serialized-assets.integration.test.ts` deliberately use `test.skip` when `STOCK_TEST_DATABASE_URL` is absent.
- Consequently, those CI steps can report success while skipping the very database integration and concurrency checks they are meant to verify.

**Fix:** provision a dedicated PostgreSQL service in CI, create/use a separate disposable test database, set `STOCK_TEST_DATABASE_URL`, apply migrations to that test database only, and fail CI if the integration suites unexpectedly skip.

### P0 — Enforce report permissions

- `apps/api/src/lib/rbac.ts` says `VIEWER` does not have `viewReports`.
- `apps/api/test/authorization.test.ts` confirms `can("VIEWER", "viewReports") === false`.
- `apps/api/src/routes/reports.routes.ts` applies `router.use(requireAuth)` but does not use `requireAction("viewReports")`.

**Fix:** apply the permission to report endpoints and add HTTP-level allow/deny tests for ADMIN, STORE_MANAGER, ACCOUNTS, and VIEWER according to the intended permission matrix. Review the report navigation visibility as a UX improvement; server enforcement is mandatory.

### P0 — Decide and enforce location balance rules

- `apps/api/src/services/location-stock.service.ts` adjusts location balances only for provided `LocationChange[]`.
- `apps/api/src/services/location-stock.service.ts:getLocationChanges()` returns `[]` for an INWARD without `toLocationId`, an OUTWARD without `fromLocationId`, and an ADJUSTMENT without `toLocationId`.
- `apps/api/src/routes/stock.routes.ts` still creates a transaction even if `locationChanges` is empty.
- PO receiving and work-order part consumption also allow omitted locations.
- `apps/api/src/prisma/backfill-location-balances.ts` refuses to apply if historical transactions cannot safely be allocated, which is appropriate, but no successful dry-run/apply evidence is included.

**Fix:** formally decide whether every item balance is location-owned. If yes, require valid location IDs for new stock-changing operations, define a safe policy for historical NULL locations, reconcile item totals against location balances, and test all three write paths. Do not guess historical locations. If not, remove or clearly define the location balance feature rather than presenting it as authoritative.

### P1 — Correct workflows

- `apps/api/src/routes/work-orders.routes.ts`, `PATCH /:id/status`, validates that a status is a known enum but does not enforce allowed status transitions. It permits e.g. changing a terminal status back to an active status. Completion sets `completedAt` but resolution is optional.
- `apps/api/src/routes/calibrations.routes.ts` sets `calibrationDate = parseDate(...) ?? new Date()`. A malformed supplied date therefore becomes “now” instead of a `400` validation error.
- `apps/api/src/routes/notifications.routes.ts` deduplicates calibration notices by the same generic link `/calibrations`. Once one recent calibration alert exists for a user, other assets' calibration notices can be suppressed during the same 24-hour window.
- Notifications run only when `/api/notifications/scan` is called; the included UI calls it manually. No scheduler/worker is present in the included source. This is not a scheduled production alerting system.

### P1 — Finish the AI assistant rather than calling it RAG

- `apps/api/src/services/knowledge.service.ts` chunks text but uses `score()` based on term overlap for retrieval.
- Its `embedding` field is not used for vector retrieval and no embedding creation provider is implemented in the inspected service.
- `apps/api/src/routes/knowledge.routes.ts` expects JSON `sourceText`; it does not implement file upload or extraction.
- There is no knowledge/assistant frontend page in the bundle's `apps/web/src/app` or sidebar.
- No AI evaluation test suite is included.

The safe next implementation should keep AI disabled by default until the application has approved file ingestion, real embeddings/vector retrieval, permission-aware citations, evaluation tests and a frontend workflow.

## Documentation and repository hygiene

1. `docs/PROJECT_GUIDE.md` contains stale claims in its “What's still missing” section: it says there are no automated tests/CI and no audit-log reader, while the bundle contains test files, a CI workflow, an audit route and an audit-log UI.
2. `docs/EnviroTrack_Stock_Location_Decision.md` says the location decision is still required and describes the old item-only model, while the current code has location balances and transfer updates. Update it to reflect the decision actually made, or remove/revert the implementation if the decision was not approved.
3. `docs/tata.ts` is an incomplete/non-buildable React snippet in a docs folder and appears unrelated to EnviroTrack.
4. `docs/test.md` contains placeholder/gibberish text.
5. The bundle's Git status lists `EnviroTrack_Copilot_Implementation_Chain.md` and `EnviroTrack_Create_Audit_Bundle.ps1` as untracked. These are tooling/docs, not application implementation.

Do not remove the stray files automatically until the owner confirms whether they are needed.

## Verification status and limitations

This report is a **static source audit**. It did not execute:

- `npm ci`
- Prisma generation or schema validation
- Type checking or Next.js build
- Unit or integration tests
- Docker health checks
- Fresh/existing-database migration tests
- GitHub Actions

Therefore no build, test, runtime, or migration check should be marked PASS solely from this report. Code and test files being present is evidence of implementation intent, not proof they execute successfully.

## Recommended immediate sequence

1. **Fix CI PostgreSQL integration testing**, so future checks actually exercise the database.
2. **Fix the report authorization gap** and add API-level tests; run the auth tests in CI.
3. **Finalize location-owned inventory semantics** and require location data consistently if using per-location balances.
4. Add state-transition and date validation for work orders/assets/calibration; fix calibration notification deduplication and define a scheduler.
5. Reconcile stale docs and remove/review the two junk files.
6. Finish the AI feature only after it has actual upload/extraction, embeddings/vector retrieval, frontend UI and evaluation tests.
7. Run fresh database migrations and upgrade migrations against disposable PostgreSQL databases, then run all builds/tests and record actual results.

**Bottom line:** Phases 1–5 have substantial code but still need real integration evidence; Phase 6 is inconsistent; Phases 7–10 are partial; Phase 11 is not a complete RAG assistant yet. The next highest-value task is getting the CI database integration suites to run instead of skip.
