# EnviroTrack — Copilot Implementation Chain

**Purpose:** Upgrade the existing Envirozone Inventory System into a production-grade industrial inventory and asset-operations product using GitHub Copilot Chat/Agent in VS Code.

**Repository:** `https://github.com/himanshu565/envirozone-inventory-system`

**Working principle:** One small phase at a time. Copilot must inspect the actual local files, implement real source changes, run checks, and report evidence. Do not ask Copilot to build the entire product in a single prompt.

---

## Before starting: protect the current repository

1. Stop any OpenCode session that is editing files.
2. Open the repository root in VS Code:
   `D:\Projects\inventory\envirozone-inventory-system`
3. Open the integrated PowerShell terminal and run:

   ```powershell
   git status --short --branch
   git diff --stat
   git diff -- apps/api
   git diff -- apps/web
   ```

4. Keep a copy of any changes you want to preserve. Do not reset the repository, run `git clean`, or use `git reset --hard`.
5. The project-level `opencode.json` was created for OpenCode. It is not needed by Copilot. Do not delete it until you have decided whether to keep it; it may remain untracked.
6. A previous stock-safety patch did not apply cleanly. Do not assume the stock-safety code or tests were installed just because a patch/installer was generated. Inspect the current files and Git diff first.

## Repository facts to verify locally

The public `main` branch has been observed with this structure, but the local working tree is authoritative:

- Root npm workspaces: `apps/*` and `packages/*`
- `apps/api`: Express + TypeScript + Prisma 7 + PostgreSQL adapter
- `apps/web`: Next.js frontend
- Shared authentication package: `packages/auth`
- Prisma schema: `apps/api/src/prisma/schema.prisma`
- Prisma config: `apps/api/prisma.config.ts`
- Stock routes: `apps/api/src/routes/stock.routes.ts`
- Stock calculation service: `apps/api/src/services/stock.service.ts`
- API package currently observed on public main has `dev`, `build`, `start`, `seed`, and `migrate:deploy` scripts, but no obvious test script. Re-inspect the local `package.json`; don't assume this is unchanged.

### Current stock semantics to verify

The observed `getCurrentStockByItemIds` implementation derives item stock from `StockTransaction` history:

- `INWARD`: adds the positive quantity
- `OUTWARD`: subtracts the positive quantity
- `ADJUSTMENT`: quantity is signed and added as-is

The observed route creates a `StockTransaction` and then calls `recordAudit` separately. The current stock summary is item-level; the `fromLocationId` and `toLocationId` values on a transaction do not, by themselves, establish a location-level balance ledger. Copilot must inspect the current local implementation and all other stock-writing paths before changing these rules.

---

# The workflow: execute these phases in order

## Phase 0 — Repository audit and baseline (no implementation edits)

Paste this into Copilot Chat in **Agent mode** with the repository root open:

```text
You are the senior engineer helping me upgrade this existing repository into EnviroTrack. For this phase, inspect only; do not edit files yet.

1. Confirm the workspace root and inspect the root package.json, apps/api/package.json, apps/web/package.json, Prisma configuration/schema, migration directory, stock routes, stock services, purchase-order receiving routes/services, audit service, authentication/authorization middleware, and existing tests.
2. Use actual paths discovered from the filesystem. The Prisma schema may be at apps/api/src/prisma/schema.prisma; verify it rather than guessing.
3. Run git status --short --branch and preserve all current local changes. Do not reset, clean, or overwrite files.
4. Record existing scripts and run only safe baseline checks that do not mutate the database. Do not run migrations, seeding, Docker volume deletion, or destructive commands in this phase.
5. Find every code path that creates a StockTransaction or changes stock-related data, not only the POST /stock/transactions route.
6. Explain the current stock ledger semantics, including how ADJUSTMENT quantities are represented and whether stock is item-level or location-level.
7. Report baseline results and propose the smallest safe first implementation phase. Do not create new documentation as a substitute for implementation.

Stop after the audit and report: actual file paths, existing scripts, baseline failures, stock-write locations, and the next recommended code change.
```

**Exit criteria:** The report names real local files and commands. You understand how stock is computed and every place it can be changed. No files are edited in this phase.

## Phase 1 — Verify the previous stock-safety attempt

Use this before attempting another implementation. Paste into Copilot:

```text
Compare the current local working tree with the intended stock-safety change. Do not assume any previous patch or installer succeeded.

1. Inspect git status and the current diffs for apps/api.
2. Inspect apps/api/src/routes/stock.routes.ts, apps/api/src/services/stock.service.ts, apps/api/src/services/audit.service.ts, the Prisma schema/config, and any stock-related tests/scripts that actually exist.
3. Determine whether the application currently prevents OUTWARD movements from taking item stock below zero.
4. Determine whether stock validation, transaction creation, and audit logging are atomic.
5. Verify whether every stock-writing path uses the same rules, especially purchase-order receiving.
6. Do not make edits in this phase. Do not run a migration or alter database data.

Return a concise PASS/FAIL/UNKNOWN table with file/line evidence. If any previous patch is incomplete, incompatible, or missing, describe the exact gap and wait for my approval before implementation.
```

**Exit criteria:** You know exactly what code is present and what still needs doing.

## Phase 2 — Correct stock movement safely

Proceed only after Phase 1 identifies a real gap and the intended business rule is confirmed. Main principle: the entire operation must be atomic and concurrency-safe, not just a separate `currentStock >= quantity` check before an insert.

Paste into Copilot:

```text
Implement the approved stock-safety change in the existing Express/TypeScript/Prisma/PostgreSQL codebase. Do not refactor unrelated features.

Requirements:
1. Preserve the existing ledger semantics: INWARD adds a positive quantity, OUTWARD subtracts a positive quantity, and ADJUSTMENT is signed. If the local code has different documented rules, stop and explain the difference before changing them.
2. Prevent an OUTWARD movement from taking computed stock below zero.
3. Make the read/validate/insert operation safe under concurrent requests. A simple balance read followed by an insert outside a shared transaction/locking strategy is not acceptable.
4. Inspect every StockTransaction writer first. Apply the invariant consistently or explain which other writer must be updated in a separate reviewed change.
5. Use the existing PostgreSQL/Prisma setup. Prefer a transaction and a database-level serialization strategy that is compatible with this schema. If using row locking, ensure all competing stock writers lock the same existing row for the same item. If using serializable isolation, handle retryable transaction conflicts deliberately. Do not invent Prisma APIs; check this project's Prisma 7 configuration and adapter behavior.
6. Write the StockTransaction and its audit log atomically where feasible. If recordAudit currently uses a global Prisma client, adapt it carefully to accept a transaction client or implement an equivalent transaction-scoped audit write without breaking other callers.
7. Return an appropriate client error for insufficient stock and a safe error for exhausted retries. Do not expose stack traces or database internals.
8. Validate quantity rules consistently and preserve existing authorization.
9. Do not add a new schema model or migration unless it is necessary and approved.
10. Make actual source edits. Afterward run the relevant type check/build and tests. Show the diff and commands/results.

Do not add mock stock balances or duplicate services. Stop if a required business rule is ambiguous instead of inventing it.
```

**Exit criteria:** The backend enforces the invariant in the actual write path, audit logging is not left inconsistent with a committed transaction, the change compiles, and relevant tests pass. Do not call this complete based only on code generation.

## Phase 3 — Test strategy and inventory correctness tests

The API package may not yet have a test runner. Copilot must inspect dependencies and scripts rather than assume Jest is installed. `tsx` and Node's built-in test runner may be suitable for the existing TypeScript setup, but Copilot must confirm compatibility first.

Prompt:

```text
Add focused tests for the stock rules using the test tools already in this repository. Do not install Jest/Mocha or another dependency without demonstrating why it is needed.

At minimum test:
- INWARD increases computed stock.
- OUTWARD decreases computed stock.
- Positive and negative ADJUSTMENT are applied as signed quantities.
- Insufficient stock is rejected.
- Invalid/zero quantities are rejected according to current business rules.
- Audit/transaction failure does not leave a partial stock mutation.
- Concurrent OUTWARD requests competing for the final units cannot oversell.
- Retry/serialization conflicts behave as expected.

Separate pure unit tests from PostgreSQL integration tests. Integration tests must use an explicitly configured disposable test database and must refuse to run if the URL looks like a production/development database. Do not reset a real database.

Add or correct the minimal package script only after inspecting package scripts and dependencies. Run each test command and report the actual results; distinguish unit tests from integration tests that were skipped due to missing infrastructure.
```

**Exit criteria:** Test commands are reproducible, unit tests pass, and concurrency is verified against PostgreSQL—not merely simulated in a unit test. If PostgreSQL integration tests are blocked, state that honestly and do not claim the race condition is proven fixed.

## Phase 4 — Duplicate-request protection / idempotency

Do this only after stock correctness is stable. Don't add generic idempotency to every route.

Prompt:

```text
Design and implement idempotency for the highest-risk stock mutation endpoint, using the existing stack and only after checking current API conventions.

1. Define an explicit key contract for the stock transaction creation endpoint.
2. Scope keys to the authenticated actor and operation (and organization/tenant if the actual schema supports that boundary).
3. A retry with the same key and equivalent request must not create a second stock movement or audit entry.
4. Reusing a key with a different request payload must return a clear conflict.
5. Persist the idempotency result and stock transaction atomically. Do not rely on in-memory maps or Redis alone for correctness.
6. Add an additive migration only if necessary. Inspect the migration history and the correct Prisma 7 configuration first.
7. Test repeated requests, conflicting payloads, simultaneous duplicate requests, rollback, and the existing behavior when no key is supplied.
8. Update API documentation only after behavior and tests are verified.

Do not modify unrelated routes or run destructive database commands. Show the migration and explain the deployment/backfill implications before applying it to any non-disposable database.
```

**Exit criteria:** Duplicate network retries cannot duplicate a stock movement under concurrency; migration safety is explained; automated tests pass.

## Phase 5 — Purchase-order receiving consistency

Prompt:

```text
Audit the existing purchase-order receipt workflow. Do not assume the path or state machine; find it in the repository.

Implement only the missing consistency rules:
- Validate permitted PO state transitions.
- Ensure received quantity cannot exceed the remaining ordered quantity unless current requirements explicitly allow it.
- Record receipt quantity, stock movement, received counters, PO status, and audit record in one transaction.
- Prevent duplicate receipt submissions from double-receiving stock.
- Preserve partial receiving if already supported.
- Ensure the stock-safety invariant is enforced by this path too.
- Add tests for partial receipt, complete receipt, duplicate request, over-receipt, invalid state, unauthorized use, and rollback.

Reuse existing models and services. Do not duplicate stock logic or redesign the schema without a written justification. Run tests and build; report actual results.
```

**Exit criteria:** Purchase receiving is atomic and repeat-safe and remains compatible with existing frontend behavior.

## Phase 6 — Decide whether inventory is item-level or location-level

Important: the current public implementation's stock calculation aggregates by item and transaction type. It does not derive a separate balance for each location. Transaction records do have source/destination location fields. Do not claim the current system supports location-level stock just because these fields exist.

Prompt:

```text
Audit current product requirements and the existing inventory UI to determine whether the product needs stock balances per location or a single total per item.

Produce a short decision document with:
- Current semantics and every current use of fromLocationId/toLocationId.
- Expected behavior of an inter-location transfer.
- Whether transfer movements should affect total stock, per-location stock, or both.
- The migration/backfill risks of introducing per-location balances.
- The API and UI changes required.

Do not make schema or UI changes yet. Ask for a decision if existing requirements do not determine the answer.
```

If location-level inventory is approved, implement as its own phase:

```text
Implement the approved location-aware stock model in small backward-compatible steps.

Requirements:
- Define exact balance semantics for receiving, issuing, adjustments, and transfers.
- Transfers must reduce the source and increase the destination without changing organization-wide total stock.
- Prevent a source location from going negative.
- Lock/serialize concurrent mutations for each affected item/location in a stable order to avoid deadlocks.
- Design safe migration/backfill from historical transactions; don't infer historical locations where data is missing.
- Update reports/API/UI and tests consistently.
- Do not apply the migration to an existing valuable database until a reviewed backup and rollback/recovery plan exist.
```

**Exit criteria:** The business semantics are approved before schema changes; totals reconcile; transfer tests prove source/destination correctness.

## Phase 7 — Audit trail and authorization hardening

Prompt:

```text
Audit authorization for stock, item, supplier, location, purchase-order, and audit-log endpoints.

For each mutation, verify server-side role/action authorization, validation of foreign keys, and that audit records reflect only committed changes. Check that users cannot access or change records by guessing IDs. Preserve the existing role model unless a concrete defect requires a change.

Add targeted tests for unauthorized access, forbidden actions, invalid related IDs, audit atomicity, and error responses. Do not change authentication/session architecture wholesale. Do not write secrets into logs. Run the relevant tests and build.
```

**Exit criteria:** Critical operations are server-authorized and tested; audit entries cannot be created without their business operation committing.

## Phase 8 — Asset lifecycle, maintenance, and calibration

Only start after core stock operations are safe.

Prompt:

```text
Design the smallest useful serialized-asset lifecycle extension for environmental monitoring equipment. First inspect existing models and product requirements; do not create models that duplicate current concepts.

Proposed capabilities, subject to code audit:
- A serialized physical asset linked to an item/model.
- Unique serial/asset identifier with correct scope.
- Current location and lifecycle status.
- Assignment/transfer/service/calibration history.
- Maintenance/calibration task with due date, status, assigned technician, outcome, and notes.
- Due-soon/overdue views and safe reminder scheduling only if infrastructure already supports it.

Present the proposed model/API/UI changes and migration impact before implementing. Then implement one workflow at a time, with authorization, audit events, validation, tests, and responsive UI states. Do not force consumables to become serialized assets.
```

Suggested order after design approval:
1. Asset register + detail/history page.
2. Asset assignment/location transfer.
3. Maintenance/calibration tasks and completion history.
4. Due/overdue dashboard and notifications.

**Exit criteria:** One complete asset workflow works end-to-end; migrations are additive and validated; UI uses real API data.

## Phase 9 — Dashboard, reporting, and performance

Prompt:

```text
Audit existing dashboards and reporting before adding more cards or charts.

Prioritize accurate, explainable metrics derived from the trusted ledger:
- Stock by item and (if approved) location.
- Low/out-of-stock items based on minimumStock.
- Movements over a date range and by type.
- PO receipt progress.
- Assets by status and maintenance due/overdue if Phase 8 exists.

Use server-side pagination and validated sorting/filtering. Inspect query plans and indexes before adding indexes. Add caching only after measuring a real bottleneck and documenting invalidation. Ensure empty/loading/error states and CSV export if useful. Add tests showing reports reconcile to ledger data; then run build and relevant tests.
```

**Exit criteria:** Report totals reconcile with transaction history; common queries are measured; UI does not use placeholder metrics in place of real API results.

## Phase 10 — Production hardening

Prompt:

```text
Audit operational readiness without performing destructive operations.

Check and improve, where actually missing:
- Environment variable validation and safe .env.example values.
- PostgreSQL readiness health check and Redis PING health check if Redis is used by the app.
- Correct Docker service networking and health-based startup dependencies.
- Repeatable development seed data that is never enabled automatically in production.
- Prisma migration deploy flow for fresh and representative existing databases (use disposable databases for tests).
- CI checks: install, Prisma generation/validation, type check, lint, unit/integration tests, and builds using actual project scripts.
- Structured logs, request correlation, error responses, rate limits, headers, CORS/cookies, backups and restore documentation.
- README instructions for local setup, env vars, migrations, seed, test, Docker, deployment, and troubleshooting.

Do not mark checks PASS unless run. Do not print secret values. Do not reset/drop a valuable database. Provide a PASS/FAIL/BLOCKED evidence table.
```

**Exit criteria:** Local setup and CI are reproducible; migration safety and backup/restore are documented; check results are evidence-based.

## Phase 11 — AI maintenance-document assistant (last)

Only after the core application is secure and stable.

Prompt:

```text
Propose an optional RAG-based assistant for approved equipment manuals, calibration guides, and service documents. Do not implement it until I approve the architecture.

The design must include:
- Approved document ingestion and extraction.
- Chunk metadata with file/page/section references.
- Embeddings and vector storage selected based on existing infrastructure and costs.
- Tenant/role authorization before retrieval and at every document access boundary.
- Citation-bearing answers and a refusal/uncertain answer if retrieval evidence is insufficient.
- Retrieved text treated as untrusted input, never as system instructions.
- No autonomous stock issues, PO approvals, or asset mutations.
- Provider settings via environment variables; app still works if AI is unavailable.
- A small evaluation set including unanswerable questions, source correctness, relevance, latency, and cost.

Return architecture and a phased plan first; wait for approval before modifying the repository.
```

---

# The required Copilot loop for every phase

After Copilot edits files, use the terminal yourself to check the diff and run only commands known to exist in the local package scripts.

```powershell
git status --short --branch
git diff --check
git diff --stat
git diff -- apps/api
```

Then run the specific test/build/type-check commands Copilot identified from the actual `package.json` files. Don't assume a `test` script exists. Don't run `prisma migrate reset`, `git reset --hard`, `git clean -fd`, `docker compose down -v`, or any destructive command on a valuable local database.

For every Copilot response, require it to report:
1. What it changed (actual file paths).
2. Why the change was necessary.
3. Commands actually executed and their outputs/results.
4. Tests added versus tests actually run.
5. Migration/data impact.
6. Known limitations.
7. Suggested commit message.

Review the diff before committing. Commit each completed phase separately, for example:

- `fix: prevent invalid stock movements`
- `test: cover stock ledger invariants`
- `fix: make purchase order receiving atomic`
- `feat: add serialized asset lifecycle`
- `feat: add calibration and maintenance workflows`
- `test: add production readiness checks`

Do not continue to the next phase until the current phase's exit criteria are met.
