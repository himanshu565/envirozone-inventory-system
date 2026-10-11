# EnviroTrack — AI Implementation Prompt

> **Purpose:** Give this entire document to your coding agent (Cursor, Claude Code, GitHub Copilot, OpenCode, or another repo-aware coding AI) while it has the `envirozone-inventory-system` repository open. The agent should implement the changes in the actual codebase, not merely return suggestions.
>
> **Product direction:** Upgrade the existing inventory application into **EnviroTrack**, an industrial inventory, asset lifecycle, calibration, and maintenance operations platform for teams that manage environmental monitoring equipment, analyzers, sensors, instruments, and spare parts.

---

## 0. ROLE, MISSION, AND WORKING RULES

Act as a senior full-stack engineer, pragmatic software architect, database engineer, QA engineer, and product-minded technical lead. You are responsible for evolving this repository into a reliable, polished, demonstrable product that can be shown in a full-stack/software-engineering interview.

### Mission

Implement EnviroTrack by **extending the existing repository**. Preserve working features and architecture where possible. Add business workflows that are meaningfully more sophisticated than basic CRUD: inventory ledger consistency, safe concurrent stock changes, asset history, calibration and maintenance scheduling, role-based permissions, audit trails, operational analytics, reliable notifications, and an optional document-grounded AI maintenance assistant.

### Non-negotiable rules

1. **Inspect before editing.** Read the repository tree, root and workspace `package.json` files, Prisma schema and migrations, authentication/authorization implementation, API routes/controllers/services, frontend routes/components, Docker Compose, environment examples, tests, and documentation. Determine what already exists before creating anything.
2. **Do not assume missing functionality.** Make an audit matrix with each requested feature marked `existing`, `partial`, `missing`, or `broken`. Reuse and improve working implementations rather than duplicating them.
3. **Do not perform a wholesale rewrite.** The repository currently uses a workspace monorepo, a Next.js/React frontend, an Express/TypeScript API, Prisma/PostgreSQL, a shared auth package, and Docker Compose. Confirm the current implementation and versions before making changes. Respect the existing app structure and conventions.
4. **Keep changes additive and migration-safe.** Never drop production tables, erase user data, replace the database with an in-memory store, or reset a database to make a migration pass. Use additive Prisma migrations and provide a safe backfill plan when existing rows need new fields.
5. **Do not break existing routes, auth, seed data, or deployed configuration.** If a breaking API change is essential, document it, provide compatibility where practical, and update every affected client/test.
6. **Do not stop after producing a plan.** After the initial audit, make the code changes in small, coherent phases. Run tests, lint/type checks, Prisma validation/generation, and production builds that are available. Fix failures caused by your changes before claiming completion.
7. **No fake functionality.** A visible button must work. A dashboard metric must come from real database queries or clearly identified demo seed data. Do not add decorative charts with hardcoded numbers and present them as live analytics. Do not claim an email, AI, upload, export, or background task works unless it is wired up and tested.
8. **No secrets in source control.** Never hardcode API keys, JWT secrets, SMTP passwords, or production credentials. Update `.env.example` with safe placeholders only. Never print secrets into logs.
9. **Keep dependencies justified.** Prefer packages already installed. Add dependencies only when a clear need exists, and use versions compatible with the current project. Do not migrate frameworks or replace Prisma, PostgreSQL, or the existing auth system without a documented technical reason.
10. **Explain important engineering decisions.** Update documentation for database invariants, concurrency control, authorization, scheduled work, AI retrieval, and deployment. Prefer straightforward, testable code over unnecessary abstractions.
11. **Handle missing external services gracefully.** Core inventory and maintenance features must work even if an optional AI provider, SMTP server, or external file-storage provider is not configured. Show clear configuration status rather than crashing.
12. **Use realistic industrial workflows.** This is for environmental instruments and spare parts, not a generic product catalogue. Include serialised assets, locations, calibration certificates/dates, maintenance events, and field service use cases.

### Execution protocol

- Start by returning a concise repository audit and implementation plan, based on actual inspected files.
- Then immediately implement the highest-priority missing feature. Do not wait for approval unless a destructive or genuinely ambiguous decision is unavoidable.
- Work phase by phase. After each phase, run relevant checks and summarize files changed, migration impact, commands run, failures, and next work.
- If context or execution budget is limited, finish the current phase safely and leave a precise checklist for remaining phases. Never claim unfinished work is complete.

---

## 1. PRODUCT VISION

### Product name

**EnviroTrack — Industrial Asset & Inventory Operations Platform**

Keep the underlying repository/package names intact unless a rename is safe, necessary, and applied consistently. In the user-facing interface, use the EnviroTrack name and a professional product identity. Do not spend time renaming every internal package before business-critical functionality is implemented.

### Target users

Companies and teams that operate environmental monitoring devices and industrial instruments, such as gas analyzers, particulate-matter monitors, flow meters, water analysers, sensors, calibration equipment, and their replacement parts.

### Primary problems to solve

- Teams lose track of spare-parts quantities, stock movements, and item locations.
- Two operators may try to issue the final available unit at the same time.
- Equipment service and calibration due dates are easy to miss.
- It is difficult to trace who moved, issued, received, adjusted, or repaired an item.
- Stock-outs, dead stock, supplier lead time, and maintenance costs are not visible in one place.
- Technicians need reliable service history and manufacturer manuals when troubleshooting equipment.

### Product principles

- Correctness before cleverness.
- Every stock change has a traceable source and actor.
- A serialised asset and a quantity-based spare part are different concepts.
- Workflows have explicit states and validated transitions.
- Users only see data they are authorized to access.
- Important failures are visible, logged, and recoverable.
- AI is an assistant grounded in trusted documents, never the authority for stock quantities, permissions, or equipment safety decisions.

---

## 2. PHASE 0 — CODEBASE AUDIT AND BASELINE

Before implementing features:

1. Print/inspect the repository tree, including `apps/`, `packages/`, `docs/`, Prisma schema/migrations, and all workspace manifests.
2. Identify current capabilities for authentication, users/roles, organisations, products/items, stock, suppliers, purchase orders, dispatch, audit logs, analytics, Redis, email, tests, and deployment.
3. Trace a current feature end to end: frontend page → API request → route/controller → business logic → Prisma query → database schema.
4. Locate the authorization checks and determine whether they are enforced on the server or only in the UI. Server-side enforcement is mandatory.
5. Identify how the app is configured, seeded, migrated, built, linted, tested, and deployed.
6. Run the current baseline checks before changing code. Record existing failures separately from failures caused by new work.
7. Create or update `docs/EnviroTrack_IMPLEMENTATION_PLAN.md` (use `docs/EnviroTrack_IMPLEMENTATION_PLAN.md` consistently) containing:
   - Existing feature audit matrix.
   - Current architecture diagram (Mermaid is acceptable).
   - Proposed/additive schema changes.
   - API and UI changes.
   - Implementation phases and dependencies.
   - Main risks and migration notes.

Do not spend the whole task on analysis: once the audit and safe plan exist, proceed with implementation.

---

## 3. CORE DOMAIN MODEL AND DATABASE DESIGN

First adapt the model names below to the actual Prisma schema. Reuse existing models where they express the same concept. Do not create duplicate tables/models with different names for the same business entity. These are target concepts and minimum fields, not an instruction to copy blindly.

### 3.1 Organisation / tenancy

Support the existing organisation/company boundary, or add one if the repository genuinely lacks it.

- `Organization`: id, name, slug, status, createdAt, updatedAt.
- `User`: existing identity fields plus organization membership/relationship where needed; status and lastLoginAt if compatible.
- Where users can belong to multiple organisations, use an explicit membership model instead of a single `organizationId` on the user.
- Every tenant-owned business record must be scoped to an organisation either directly or through a validated parent relationship.
- Enforce tenant isolation in **server-side queries and authorization**, not by trusting a client-provided organisation ID.
- Add indexes on tenant IDs and common tenant-scoped filters.

Do not create multi-tenant complexity if the current product already uses a clear single-company model and a complete migration would distract from safety. In that case, build the data-access layer so organisation isolation can be added cleanly later and document the limitation. If multi-tenancy is implemented, test cross-tenant reads and writes explicitly.

### 3.2 Inventory catalogue

Provide or strengthen the following concepts:

- `Item` / `Product`: id, SKU (unique within the appropriate scope), name, description, category, manufacturer, modelNumber, unitOfMeasure, trackingMode (`QUANTITY` or `SERIALIZED`), reorderPoint, targetStockLevel, defaultSupplierId if applicable, active/archive state, createdAt, updatedAt.
- `Category`: name, optional parent, description, active state.
- `Location`: organisation, name/code, type (warehouse, store, site, vehicle, technician, repair centre, quarantine), address/details, active state.
- `StockBalance` or an equivalent efficient representation: item + location + available/reserved/quarantined quantities. Enforce one balance per item/location (and lot, if lots are introduced).
- `Supplier`: company/contact details, lead time, notes, active state, tenant ownership.
- Optional `ItemDocument` / `Attachment`: safe metadata for a manual, certificate, invoice, or image; never store arbitrary executable uploads.

SKU uniqueness must be explicit. Choose whether SKU is globally unique or organisation-scoped based on the existing model, then enforce it with a database constraint.

### 3.3 Stock movement ledger — critical requirement

Introduce or strengthen an append-only `StockMovement` / ledger model. A movement must record at least:

- id and unique reference/transaction identifier;
- organisation/tenant scope;
- item and source/destination locations as applicable;
- movement type: opening balance, receipt, issue, transfer-out, transfer-in, adjustment-in, adjustment-out, reservation, release, return, write-off, or another explicitly documented type;
- quantity as a positive number, with direction/type determining the effect;
- actor/user, timestamp, reason, reference to request/order/work order where relevant;
- optional serial/lot references and notes;
- idempotency key or unique source reference for retry-sensitive operations.

**Rules:**

- Never silently edit or delete historical stock movements. Correct mistakes with a compensating movement and reason.
- Do not let the UI directly set arbitrary available stock. Use a validated stock receipt, issue, transfer, return, reservation, release, or adjustment command.
- Compute and reconcile balances from movements when practical. If the app keeps cached/current balances for performance, update them transactionally with the movement and provide a reconciliation utility/test.
- Use one well-defined unit convention. Validate positive quantities and handle decimal units only if the business domain requires them; otherwise use integers for countable parts.
- Transfers must be atomic: both source decrement and destination increment succeed or neither does.
- Adjustments require a reason and proper permission.
- Prevent negative stock by default. Any override must be an explicit, permission-gated, audited policy—not a hidden exception.
- If reservations are supported, distinguish on-hand, reserved, quarantined, and available quantities; document the stock invariant.

**Recommended invariant:** for every item/location, stored on-hand balance equals the sum of signed movements for that item/location. Available quantity cannot be negative unless a documented policy allows it. Do not count the source and destination sides of one transfer twice as net inventory.

### 3.4 Serialised assets and lifecycle

Keep quantity-based consumable items separate from individually tracked equipment. Reuse existing inventory/product concepts if applicable, but serialised equipment needs an individual record such as `Asset`:

- id, organisation, assetTag (unique in scope), serialNumber (unique when present in scope), item/model reference, manufacturer/model, purchase date/cost when known, warranty expiry, current location, status, assigned team/person, criticality, notes, createdAt, updatedAt.
- Status examples: `IN_STOCK`, `DEPLOYED`, `UNDER_MAINTENANCE`, `IN_CALIBRATION`, `QUARANTINED`, `RETIRED`, `LOST`. Define valid state transitions and avoid arbitrary client-supplied status changes.
- Equipment can move between locations, teams, and assigned technicians while retaining its complete history.
- Asset history should record assignment/location/status transitions, related work orders, service/calibration records, and associated documents.
- Do not use a quantity counter to represent individually tracked devices.

### 3.5 Maintenance, service and calibration

Add or strengthen:

**`MaintenancePlan`**
- Name, asset/item scope, maintenance type, interval (days/months or meter-based only if supported), next due date, grace period if needed, instructions, active status, assigned team/role.

**`WorkOrder`**
- Unique human-readable work-order number, title, description, priority, type (`PREVENTIVE`, `CORRECTIVE`, `CALIBRATION`, `INSPECTION`, `INSTALLATION`), linked asset(s) when supported, site/location, requester, assignee, status, due date, startedAt, completedAt, resolution, failure/cause, parts used, notes, and timestamps.
- Status workflow: `OPEN` → `ASSIGNED` → `IN_PROGRESS` → `WAITING_FOR_PARTS` (optional) → `COMPLETED`; allow `CANCELLED` with reason. Define permitted transitions in server-side business logic.
- Completing a work order should require an appropriate resolution/checklist and must not happen merely because the user changes a dropdown.
- Parts consumed must create stock issue movements linked to the work order. A failed work order transaction must not consume stock halfway.

**`CalibrationRecord`**
- Linked asset, calibration date, next due date, result/status (pass/fail/conditional), performed by, provider/lab, certificate number/file metadata, measured observations/notes, and audit timestamps.
- Failed calibration can move the asset into `QUARANTINED` or an appropriate unsafe-to-use state according to policy; do not allow the asset to remain deployable by accident.
- Calibration history is immutable; corrections should create a new record or audited correction rather than erase certification history.

**`MaintenanceEvent` / `AssetEvent`**
- Record service performed, findings, replaced parts, labour/cost where known, downtime start/end, technician, and follow-up work required.

### 3.6 Purchase orders and receiving

Reuse the repository's current purchase-order logic if it exists. Ensure the order has an explicit lifecycle, for example:

`DRAFT` → `SUBMITTED` → `APPROVED` → `PARTIALLY_RECEIVED` → `RECEIVED`, plus `CANCELLED` where valid.

- A purchase order includes supplier, line items, ordered quantity, received quantity, agreed cost/currency if supported, expected delivery date, creator and approver.
- Receiving must create stock receipt movements exactly once. Partial receipt must be supported if practical.
- Prevent receipt quantities from exceeding remaining order quantities unless an authorised, documented exception flow is implemented.
- Repeated receiving requests must not duplicate stock. Use database constraints, transaction-safe checks and/or idempotency keys.
- Keep approval separation when roles allow it; do not let UI-only restrictions be the only control.

### 3.7 Notifications and audit history

- `Notification`: recipient/scope, type, title, body, related entity/reference, createdAt, readAt, delivery status when external delivery is used.
- `AuditLog`: actor, action, entity type/id, organisation scope, timestamp, request/correlation ID, minimal before/after metadata for auditable changes, and reason where required.
- Never log passwords, auth tokens, API secrets, full sensitive documents, or unnecessary personal data.
- Prefer structured audit events from the service/business layer so writes cannot accidentally bypass logging.

### 3.8 Database quality

- Add foreign keys and uniqueness/check constraints wherever applicable.
- Add indexes based on actual list/report queries (tenant/org + created date/status/location, item SKU, asset tag/serial number, due dates, and relevant foreign keys).
- Avoid N+1 queries; use correct joins/includes and paginated queries.
- Store all timestamps consistently (UTC in the database; render local timezone in UI).
- Use decimal-safe types for money. Never use binary floating point for currency calculations.
- Keep Prisma migrations checked in. Verify fresh setup and upgrade from the current schema.

---

## 4. INVENTORY OPERATIONS AND CONCURRENCY SAFETY

This section is among the most important portfolio differentiators.

### 4.1 Required stock workflows

Implement functioning UI and API workflows for:

- Create/edit/archive catalogue items and categories.
- Manage warehouse/site/vehicle/repair-centre locations.
- Receive stock against a purchase order or as an audited standalone receipt where permitted.
- Issue parts to a technician, site, or work order.
- Transfer stock between locations.
- Return unused stock and process damaged/quarantined stock.
- Make stock adjustments only with a reason and required role.
- Reserve stock for a work order/order and release unused reservations.
- View movement ledger and per-location balances.
- Export filtered stock/movement reports where feasible.

### 4.2 Prevent race conditions

The server must be correct when two requests are issued at the same time. A client-side check such as “quantity is enough” is insufficient.

For issue/reservation/transfer commands:

1. Validate authentication, tenant scope, permission, input schema, location/item status, and idempotency key.
2. Start a database transaction.
3. Lock/update the relevant stock balance safely using the supported Prisma/PostgreSQL method, such as a conditional atomic update (`available >= requestedQuantity`) or a parameterized row-locking statement where justified.
4. Verify sufficient stock after obtaining the lock/performing the atomic update.
5. Write the stock movement(s), update balance(s), update associated order/work-order state, and create audit event atomically.
6. Commit only if all required operations succeed; otherwise roll back fully.
7. Return a clear, consistent conflict/validation response when stock is insufficient or a concurrent request wins.

Do not trust a prior `SELECT` followed by an unguarded `UPDATE`. Avoid unsafe raw SQL; if needed, use parameterized SQL and document why Prisma's normal API is insufficient.

### 4.3 Idempotency and retries

- Support an idempotency key or equivalent durable uniqueness for operations that must not be duplicated due to network retries (receiving purchase orders, issuing/reserving stock, completing work orders, external webhook processing).
- Persist the outcome or a unique source reference; do not keep the only idempotency state in process memory.
- The same key with the same request should return the original result or a consistent equivalent response; incompatible payload reuse should fail clearly.
- Add tests for duplicate requests and simultaneous requests.

### 4.4 Reconciliation

Create an admin/developer command or documented script that compares stored stock balances to the ledger, identifies discrepancies, and reports them without automatically making dangerous corrections. If safe automatic repair is implemented, require explicit confirmation, produce a compensating movement, and log the actor/reason.

---

## 5. AUTHENTICATION, AUTHORIZATION, AND SECURITY

First inspect the shared auth package and existing login/session/token strategy. Strengthen it rather than inventing an incompatible parallel auth system.

### Roles and permissions

Use existing roles if already established; otherwise provide a role/permission matrix with roles equivalent to:

- **Super Admin / Platform Admin:** platform configuration and organisation administration where multi-tenancy is supported.
- **Organisation Admin:** manage their organisation's users, catalogue, locations, suppliers, permissions, and configuration.
- **Inventory Manager:** receive/transfer/adjust stock, manage catalogue operations, and review inventory reports.
- **Storekeeper / Dispatch Operator:** approved stock receipts/issues/transfers and work-order material fulfilment; no unrestricted admin functions.
- **Technician:** view assigned work orders/assets, record service findings and parts consumed, upload permitted service/calibration documents.
- **Viewer / Auditor:** read-only access to permitted dashboards, history, reports, and audit trail.

Implement permissions as central server-side middleware/service checks. Keep the frontend's route/button hiding as usability, not security. A request made directly to the API must still be denied if the actor lacks permission.

### Security requirements

- Secure password hashing using the existing safe implementation.
- Validate every request body, query parameter, and path parameter with the repository's existing validation approach or a compatible schema validator.
- Use least-privilege CORS allowlists, secure cookie/token settings appropriate to the current auth design, rate limiting for login and sensitive actions, Helmet/security headers, and generic auth error messages where appropriate.
- Protect against mass assignment: allowlist writable fields and never spread untrusted request bodies directly into Prisma mutations.
- Prevent IDOR and cross-organisation access at every read and write.
- Avoid exposing stack traces or SQL details to clients in production.
- Validate uploads by type/size, generate server-side names, store outside executable paths or in safe object storage, and check download authorization. Do not trust the filename or MIME type alone.
- Use CSRF protection if the current cookie-based auth architecture requires it.
- Document secret rotation, database credentials, and safe deployment environment variables.

### Tests required

- Unauthenticated access to protected endpoints is denied.
- Every role has expected allow/deny behavior.
- User from Organisation A cannot read, mutate, export, or download Organisation B's data.
- A viewer cannot perform stock adjustments or privileged workflow transitions via direct API requests.

---

## 6. FRONTEND EXPERIENCE AND ROUTES

Keep the existing Next.js App Router (if confirmed) and component conventions. Build on existing styling and dependencies rather than adding another UI framework.

### Visual design

Create a professional, clean, high-quality B2B SaaS interface for industrial operations:

- Product identity: **EnviroTrack** with a restrained environmental/industrial visual language.
- Clear left navigation/sidebar, top bar, organisation/user menu, notifications, breadcrumbs, page titles, and consistent action placement.
- Responsive tables and detail views; desktop-first operations but usable at tablet/mobile widths.
- Consistent spacing, typography, forms, statuses, dates, empty states, confirmation dialogs, and inline validation.
- Accessible labels, keyboard focus, semantic markup, good contrast, and useful loading/empty/error states.
- Use charts only when sourced from API data. Tables and important actions should remain useful without charts.
- Avoid over-designed glassmorphism, oversized landing-page sections, decorative animations, and placeholder buttons. This is an operational web app.

### Required navigation and screens

Adapt to current route conventions; these are product screens, not necessarily exact URL names.

1. **Overview dashboard**
   - Stock items/SKUs, total available units, low-stock item count, open purchase orders, overdue work orders, calibration due soon, assets under maintenance, recent stock movements, and recent audit-worthy actions.
   - Include date/location/category/tenant filters where useful.
   - Every KPI must map to a real API query and have a clear definition.

2. **Inventory**
   - Item list with server-side pagination, search, sorting, filtering and archived state.
   - Item detail showing description, category, SKU, manufacturer/model, unit of measure, stock per location, reorder level, suppliers, movement ledger, and associated assets/documents.
   - Create/edit forms with validation and clear success/error feedback.

3. **Stock operations**
   - Separate workflows for receive, issue, transfer, return, reserve/release, and adjustment.
   - Preview affected location balances before submission where appropriate.
   - Show availability and useful validation messages without exposing other tenants' records.
   - Confirm high-impact actions and require reasons for adjustment/write-off.

4. **Assets**
   - Search/filter by asset tag, serial number, model, site/location, status, calibration due state, warranty, and assignment.
   - Asset detail timeline including assignments, transfers, service events, calibration outcomes, work orders, documents, and notes.
   - Explicit, permission-aware transition actions.

5. **Maintenance / Work orders**
   - Work-order list, filtering by status/priority/technician/site/due date.
   - Create, assign, start, pause/wait, complete, cancel with reason, record findings, attach permitted documents, and record parts used.
   - Board or grouped list by workflow status is useful if it remains accessible.
   - Prevent invalid transitions and validate completion requirements.

6. **Calibration**
   - Due soon, overdue, passed, failed/quarantined, and recently completed views.
   - Create calibration record, add certificate metadata/file, set next due date, and show asset history.
   - Clearly indicate potentially unsafe/expired equipment and prevent inappropriate reassignment/deployment.

7. **Purchasing / Suppliers**
   - Supplier directory and supplier detail/history.
   - Purchase order lifecycle, line items, approval if supported by permissions, partial receiving, receipt history, and expected dates.
   - Ensure receiving is not possible twice for the same accepted quantity.

8. **Locations**
   - Manage warehouse, site, vehicle, technician, repair, and quarantine locations as permitted.
   - Show inventory/asset counts by location and movement history.

9. **Reports / Analytics**
   - Stock valuation only when cost data is trustworthy and currencies are handled correctly.
   - Low-stock and stock-out trends, movement volume, slow/non-moving stock, usage by site/item, supplier lead-time metrics, parts usage per work order, maintenance cost/downtime if captured, and calibration compliance.
   - Filters and CSV export for reports where feasible. Large data exports should be streamed/backgrounded if necessary.

10. **Notifications**
    - In-app notification centre with unread state and related entity links.
    - Due/overdue calibration, low-stock, overdue work orders, and purchase-order updates.
    - Reliable email can be added behind configuration; do not pretend email was sent if SMTP is absent or failed.

11. **Audit log**
    - Permission-protected, searchable and filterable table showing actor, action, entity, date, and safe details.
    - Do not let ordinary users edit/delete audit records.

12. **Organisation/users/settings**
    - Manage users and roles within current organisation. Add organisation management only if the tenancy design is actually implemented.
    - Basic preferences (timezone, notification preferences, low-stock thresholds if supported) with validation.

13. **AI Maintenance Assistant** (Phase 4, optional and feature-flagged)
    - Ask questions about approved equipment manuals, calibration procedures, and past service reports.
    - Show the sources used for each answer and allow users to open the cited document/chunk.
    - Do not make up a procedure when source evidence is missing; respond that the indexed sources do not support an answer.
    - Never allow AI to change stock, approve orders, change permissions, or close a work order autonomously.

### UI behavior requirements

- All lists have loading, empty, error, and retry states.
- Forms show field-level validation, disabled/submitting states, and useful server errors.
- Use confirmation dialogs for destructive/high-impact actions.
- Preserve filters/pagination when returning from a detail page where reasonable.
- Debounce search if necessary and cancel/stale-guard requests to avoid showing older query results.
- Avoid fetching full unbounded tables in the browser.
- Display dates and units clearly; do not silently convert quantities or timezone values.
- Ensure keyboard users can operate modals, dropdowns and primary workflows.

---

## 7. BACKEND API AND ARCHITECTURE

Follow the existing routing and service conventions. If code currently places all logic inside route handlers, incrementally extract business rules to testable service functions rather than undertaking a massive architecture migration.

### API design requirements

- Consistent versioning if the project already uses it; otherwise introduce a simple compatible convention such as `/api/v1` only after checking existing consumers.
- Consistent response/error format and HTTP status codes.
- Request validation before business logic.
- Server-side pagination, filtering, sorting with allowlisted sort fields, and search for list endpoints.
- Appropriate `400` for invalid input, `401` unauthenticated, `403` forbidden, `404` not found, `409` business conflict/concurrent stock conflict, and `500` generic unexpected failure.
- Central error handling with request/correlation IDs and structured logs.
- Never leak stack traces, credentials or internal database details in production responses.
- Keep domain logic in services, not scattered through React components or duplicated across API routes.

### Suggested resource groups

Adapt naming to current routes and avoid duplicate endpoints when equivalent ones exist.

- `/auth`, `/users`, `/organizations` (only if supported), `/roles`
- `/items`, `/categories`, `/locations`, `/suppliers`
- `/stock/balances`, `/stock/movements`, `/stock/receive`, `/stock/issue`, `/stock/transfer`, `/stock/adjust`, `/stock/reservations`, `/stock/reconcile`
- `/assets`, `/assets/:id/history`, `/assets/:id/documents`
- `/maintenance-plans`, `/work-orders`, `/work-orders/:id/assign`, `/work-orders/:id/status`, `/work-orders/:id/parts`, `/work-orders/:id/complete`
- `/calibrations`, `/calibrations/due`, `/calibrations/:id`
- `/purchase-orders`, `/purchase-orders/:id/approve`, `/purchase-orders/:id/receive`
- `/dashboard/summary`, `/reports/*`, `/notifications`, `/audit-logs`
- `/documents` and `/ai/maintenance-assistant` only if implemented and feature-flagged

These are design suggestions. Match the repository's current API conventions and avoid gratuitous renames.

### Background jobs and Redis

Inspect whether Redis is currently configured or used. If available and appropriate, use it for job queuing/caching/rate-limiting according to the current app design. Do not store the only record of stock transactions, idempotency, audit events, or workflow outcomes in Redis.

Appropriate background work includes due-date scanning, notification generation/delivery, large CSV export, document ingestion/embedding, and retention cleanup for non-audit temporary data. Jobs must be safe to retry and should have explicit failure handling. If adding a queue library, justify it and document worker startup/deployment. If a worker service is added, include it in local development and deployment instructions.

Do not make scheduled features depend on a developer browser tab being open. In production, ensure the scheduling trigger and worker actually run. Make duplicate scheduling safe.

---

## 8. OPERATIONAL ALERTS AND BUSINESS RULES

Implement due-date and threshold logic server-side, not only in frontend filters.

### Low-stock alerts

- Derive stock availability from the correct balance fields.
- Alert when available stock reaches/breaches reorder point, according to the chosen policy.
- Avoid generating a new notification every time a job runs for the same unresolved condition. Use deduplication or an alert state/cooldown.
- Resolve or close the alert when stock recovers.
- Permit configurable thresholds at item level, with organisation-level default if practical.

### Calibration reminders

- Notify at configurable windows before due date and when overdue.
- Do not spam duplicate alerts daily; maintain a dedupe key or alert lifecycle.
- Show the asset, due date, site/location and permitted action.
- An overdue/failed calibration may require the asset to be blocked, quarantined or flagged, based on explicit policy.

### Work-order reminders

- Notify assignee/requester when assigned, nearing due, overdue, waiting for parts, completed, or cancelled where appropriate.
- Reassigning or completing work should not send contradictory stale notifications.

### Auditable high-impact operations

Stock adjustment, write-off, receipt, issue, transfer, reservation, release, approval, work-order completion, calibration result changes, asset retirement, user/role changes, and document access policy changes must be auditable as appropriate.

---

## 9. REPORTING AND DATA EXPORT

- Use parameterized, tenant-scoped database queries.
- Support pagination/filters for interactive reporting.
- Export only rows the requesting user is allowed to view.
- Add CSV export for items, balances, movements, assets, work orders, and calibration status where practical.
- Escape CSV cells that begin with spreadsheet formula characters (`=`, `+`, `-`, `@`) to reduce spreadsheet formula injection risk.
- Use stable column headers and clear units/timezone information.
- Do not build an elaborate reporting engine prematurely; start with the reports listed above and add more after core query correctness is tested.
- If PDF export is not already supported, prioritize useful CSV export and document PDF as a later enhancement unless the repository already has a safe PDF implementation.

---

## 10. AI MAINTENANCE ASSISTANT — GROUNDED RAG (PHASE 4)

This is a differentiator but **must not delay stock correctness, workflow integrity, testing, or deployment**. Implement only after core phases are stable.

### Use case

A technician asks questions such as:
- “What checks are documented for this analyser's calibration failure?”
- “Summarize the last three service records for asset AT-104.”
- “Which manual section describes the documented maintenance interval for this model?”

The assistant may answer only from documents and records the user is authorized to access.

### Ingestion flow

1. Allow authorized users to upload supported document types (for example PDF and plain text; add DOCX only if extraction is robust and tested).
2. Validate file size, content type and extension; protect against malicious or malformed files.
3. Extract text safely, retaining document title and useful page/section metadata.
4. Split text into overlapping chunks using documented chunk sizing/overlap; avoid splitting so aggressively that relevant instructions lose context.
5. Store document/chunk metadata, tenant scope, upload actor, processing status, content hash, extraction errors, and deletion/re-index lifecycle.
6. Generate embeddings with a provider adapter. Use a supported vector store (for example PostgreSQL with pgvector if operationally supported, or an explicit compatible vector database). Do not fake similarity search using arbitrary text matches while describing it as vector RAG.
7. Make ingestion retryable/idempotent using a content hash and ingestion status.
8. Do not send a customer's confidential documents to an external provider unless that provider is explicitly configured. Document the data path.

### Retrieval/answer flow

1. Authenticate the user and verify tenant/document permissions.
2. Validate the question and scope relevant assets/models/documents where provided.
3. Retrieve top relevant chunks using semantic retrieval and optional keyword filtering/hybrid search where useful.
4. Pass only permitted, relevant context to the LLM.
5. Return the answer with citations to document title and page/section/chunk reference.
6. If retrieved context is inadequate, say so instead of inventing an answer.
7. Treat documents as untrusted data, not instructions: prompt-injection content inside an uploaded manual must not override system policy, access control or tool permissions.
8. Log operational metadata, not full sensitive content by default. Add timeout, rate limits, token/document limits and useful errors.

### Safety boundaries

- AI must be read-only in its first implementation.
- Never make automatic changes to stock, equipment status, permissions, purchase orders, calibration outcomes or work-order completion.
- Make it clear that generated advice is a summary of indexed records/manuals and should not supersede manufacturer instructions or required safety procedures.
- Provide a configuration flag such as `AI_ASSISTANT_ENABLED=false` by default when required API/vector config is absent.
- Core platform should start and operate without AI keys configured.

### AI evaluation and tests

- Include a small set of test documents/questions with expected relevant sources.
- Test retrieved source relevance, citation presence, permission isolation, no-context refusal, document ingestion errors and provider timeouts.
- Test that a user cannot retrieve another tenant's manuals through prompt wording or filters.
- Document how to configure the provider, how data is processed, and how to disable the feature.

---

## 11. TESTING STRATEGY — REQUIRED

Use the project's existing test runner if available. If there is no meaningful test setup, introduce a minimal compatible test framework and document how to run it. Do not add superficial tests that merely assert `true`.

### Unit tests

- Quantity validation and available-stock calculations.
- Permitted stock movement types and transfer calculation.
- Work-order state machine and invalid transitions.
- Calibration due/overdue logic.
- Role/permission checks.
- Idempotency-key reuse behavior.
- Alert deduplication/resolution rules.

### Integration tests

- Receiving a purchase order creates the correct stock movement and balance.
- Partial receiving updates remaining quantities accurately.
- Duplicate receiving does not duplicate stock.
- Issue decrements stock and writes one ledger row atomically.
- Transfer updates both locations atomically.
- Insufficient stock returns a conflict and does not create partial movement rows.
- Two concurrent requests competing for the last unit cannot make available stock negative or issue more than exists.
- Work-order part consumption and work-order updates succeed/fail together.
- Failed calibration flags/quarantines the asset according to policy.
- Tenant scoping is applied to list, detail, mutation, report and document endpoints.
- Audit events exist for high-impact actions.

### Frontend tests

Test the highest-risk interactive workflows: form validation, stock issue conflict handling, transfer confirmation, work-order completion, calibration entry, permission-hidden controls, loading/error/empty states. Use existing tooling if present; do not create an oversized test harness just for the sake of coverage.

### End-to-end smoke flow

Document and, where possible, automate this flow:

1. Log in as an authorised admin/storekeeper.
2. Create an item and location.
3. Receive 10 units.
4. Transfer 4 units to another location.
5. Issue 3 units to a work order.
6. Confirm balances are correct at both locations and every movement appears in history.
7. Try to issue more than the available balance and verify the request is rejected without changing stock.
8. Create an asset and calibration plan/record.
9. Generate a due/overdue alert using test dates or a deterministic test clock.
10. Confirm a viewer cannot perform a stock adjustment.

Tests should use isolated test data/database configuration. Never run destructive test cleanup against production.

---

## 12. PERFORMANCE AND RELIABILITY

- Use database pagination rather than loading all records into memory.
- Add indexes based on observed query paths and verify with query plans when feasible.
- Avoid duplicate requests and N+1 access patterns.
- Use Redis caching only for read-heavy data where staleness can be tolerated; define TTL/invalidation and do not cache authorization decisions in a way that leaks data.
- Do not cache volatile stock balances without a robust invalidation/correctness strategy. Correctness is more important than dashboard speed.
- For longer tasks such as document ingestion or large exports, use background processing rather than tying up a request indefinitely.
- Add request IDs/correlation IDs and structured logs with useful latency/status information.
- Add health/readiness checks that report the status of required dependencies without exposing credentials.
- Configure timeouts for external integrations and AI provider calls.
- Do not retry non-idempotent writes blindly. Retries must be protected by idempotency.
- Define backup and restore instructions for PostgreSQL; include a restoration smoke check if practical.

---

## 13. DEV EXPERIENCE, DOCKER, CI/CD, AND DEPLOYMENT

### Local setup

Keep local startup simple and consistent with the current workspaces. Update scripts only as needed.

- Verify root `npm run dev`, workspace installs, build scripts, Prisma generate/migrate scripts and seed scripts.
- Review Docker Compose for PostgreSQL and Redis configuration, health checks, volumes, and safe development credentials.
- Add persistent data volumes and `depends_on` health conditions where appropriate.
- Provide safe `.env.example` files for the root/apps that need them; avoid duplicating conflicting variables.
- Ensure migrations can be applied to a clean database and to an existing database with data.
- Use a clearly named development-only seed dataset, including realistic products, locations, suppliers, assets, service/calibration records, work orders and alerts. Never seed production credentials or real personal data.
- Ensure any demo account creation is explicitly development-only or uses environment-provided setup; do not quietly create an insecure public admin account in production.

### CI

Add or improve GitHub Actions if missing. A useful CI pipeline should:

1. Install dependencies reproducibly from the lockfile.
2. Run Prisma generate and schema validation.
3. Run lint and TypeScript type checks.
4. Run unit/integration tests using isolated test services/configuration.
5. Build the API and web workspaces.
6. Fail clearly when a stage fails and avoid exposing secrets in logs.

Do not claim that a deployment succeeds if no deploy credentials/environment are available. Build and validate locally, then document exact deployment configuration and smoke checks.

### Environment and deployment docs

Update the README to include architecture, features, stack, prerequisites, environment variables, local setup, migrations, seed/demo login setup, tests, Docker startup, deployment steps, health endpoints, backup/restore, and known limitations. Add a deployment checklist that covers HTTPS, secure cookies, CORS, database migrations, database backup, secrets, allowed origins, monitoring/logging, and optional service availability.

---

## 14. DEMO DATA AND PORTFOLIO QUALITY

Create a realistic seed scenario using clearly fictional sample data. Examples:

- Items: SOx analyzer filter kit, NOx analyzer pump assembly, PM sensor module, flow-meter gasket set, calibration gas regulator, sample tubing, water-analyser reagent pack.
- Locations: Central Warehouse, Field Store — North Site, Field Store — South Site, Repair Bench, Calibration Quarantine.
- Assets: fictional analyzer/sensor assets with asset tags and serial numbers, some deployed, one awaiting calibration, one under maintenance.
- Suppliers: fictional industrial-equipment suppliers.
- Work orders: calibration due, sensor fault diagnosis, pump replacement, preventive service.
- Stock history: a few opening receipts, transfers, work-order issues and returns so charts and timelines are meaningful.

Keep all demo data obviously fictional; do not expose real customer names or confidential company records. Ensure seeded data is consistent across stock balances and movement ledger. Provide one documented way to reset local demo data without risking non-development databases.

### Portfolio deliverables

- A clean README with a concise product pitch, feature list, architecture diagram, screenshots/GIFs only if real, setup, environment variables, tests and demo workflow.
- `docs/ARCHITECTURE.md` describing frontend/API/data flow and major decisions.
- `docs/DATABASE_AND_INVENTORY_INVARIANTS.md` documenting ledger/balance consistency, quantity rules, transaction boundaries, and reconciliation.
- `docs/SECURITY_AND_PERMISSIONS.md` documenting roles, tenant isolation, and security assumptions.
- `docs/RUNBOOK.md` with health checks, logs, migration process, backup/restore, common failures and recovery.
- `docs/AI_ASSISTANT.md` only if RAG is implemented.
- `.env.example` with comments for every new configuration value.
- CI checks and meaningful tests.
- A clear demo account strategy suitable for local evaluation.

Do not create fake screenshots, fake test badges, fake benchmark results or unsupported claims such as “handles one million users.”

---

## 15. IMPLEMENTATION PHASES AND PRIORITY

Implement in this order unless the repository audit discovers an existing dependency that requires a different sequence. Keep commits/changes conceptually separated if the environment supports commits; never create commits unless asked or the tools/task explicitly expect it.

### Phase 1 — Audit, stabilize, and protect the core (P0)

- Audit existing app and establish baseline checks.
- Resolve broken existing workflows that block the core inventory application.
- Strengthen validation and error handling.
- Implement/complete the stock movement ledger and balance consistency rules.
- Make receipt, issue, transfer, adjustment, return, and reservation operations transactional and permission-protected.
- Add idempotency for retry-sensitive operations.
- Add audit history for high-impact stock events.
- Add critical integration tests including concurrent issue/last-unit tests.

**Exit gate:** Existing app builds; migrations work; stock can be received/issued/transferred correctly; insufficient and concurrent stock requests cannot create negative stock or partial ledger writes; tests prove it.

### Phase 2 — Asset lifecycle and maintenance (P1)

- Add serialised assets and asset movement/history where missing.
- Add work orders and explicit server-side status transitions.
- Link parts consumed on work orders to stock movements.
- Add calibration plans/records, due-state views, and quarantine/unsafe-to-deploy behavior.
- Add location and asset timelines.
- Add role-aware frontend screens and tests.

**Exit gate:** A technician can receive an assigned work order, record service, consume available parts safely, complete the work order with resolution, and retain auditable history; calibration outcomes change asset availability correctly.

### Phase 3 — Operations and production readiness (P1)

- Complete purchase order lifecycle and duplicate-safe partial receiving.
- Add low-stock/calibration/work-order alerts with deduplication.
- Add dashboard metrics and first set of report filters/CSV exports.
- Harden tenant/role authorization and document it.
- Add health checks, structured logs, CI pipeline, Docker reliability, and deployment/runbook docs.

**Exit gate:** Local setup is repeatable; tests/lint/type checks/build pass; important metrics are data-backed; alerts are deduplicated; security and demo workflows are documented.

### Phase 4 — AI maintenance assistant (P2, optional feature flag)

- Add document upload/extraction/status tracking.
- Add chunking and provider abstraction for embeddings/LLM.
- Add permission-scoped retrieval, cited answers, no-context behavior and timeout/error handling.
- Add AI evaluation tests and docs.
- Ensure the entire core application works with AI disabled.

**Exit gate:** A user can ask a supported question over an uploaded document and see source citations; unsupported questions do not receive invented answers; cross-tenant/document leakage is tested; missing API config does not break the app.

### Phase 5 — Polish and evidence (P2)

- Accessibility, responsive details, clearer empty/error/loading states.
- Improve list query performance after measuring.
- Record a real demo walkthrough and capture real screenshots after the application runs.
- Update README and portfolio documentation from the actual final implementation.

---

## 16. ACCEPTANCE CRITERIA — DO NOT MARK COMPLETE WITHOUT EVIDENCE

### Product behavior

- [ ] Existing authentication still works.
- [ ] Role/permission enforcement exists on the API, not only in the UI.
- [ ] Item/location/asset/work-order/calibration records can be managed through working UI flows.
- [ ] All stock-changing workflows create auditable ledger movements.
- [ ] Stock balance updates and ledger writes are atomic.
- [ ] Transfer out/in is atomic across both locations.
- [ ] Race-condition tests prove concurrent issue requests cannot oversell available stock.
- [ ] Duplicate request/receiving tests prove stock is not counted twice.
- [ ] Work-order completion and parts consumption remain transactionally consistent.
- [ ] Calibration due/failed states are visible and apply the defined equipment policy.
- [ ] Dashboard values come from actual database queries/seed records.
- [ ] Main lists use server-side pagination/search/filtering.
- [ ] All visible buttons/actions work or are explicitly disabled with an explanation.
- [ ] Errors, empty states, form validation, and success feedback are implemented.
- [ ] Tenant data boundaries are tested if multi-tenancy exists.
- [ ] Optional integrations fail gracefully when they are not configured.

### Engineering quality

- [ ] Prisma schema validates and client generation succeeds.
- [ ] Migrations work from a clean database and preserve existing data in the upgrade path.
- [ ] Tests cover critical business rules and failure cases.
- [ ] Type check/lint/build pass, or any pre-existing unrelated failure is clearly documented.
- [ ] No secrets or real customer data are added to source control.
- [ ] Docker/local setup works from documented commands.
- [ ] CI runs the relevant validation steps.
- [ ] README and architecture/runbook docs reflect the actual implementation.
- [ ] AI assistant, if enabled, cites permitted source documents and has refusal behavior for unsupported questions.

### Required final report from the coding agent

When implementation stops, provide:

1. **What was implemented:** by phase and feature.
2. **Files changed:** grouped by frontend, API, schema/migrations, tests, infrastructure, docs.
3. **Database changes:** migration names, new fields/tables/indexes/constraints, and safe rollout/backfill notes.
4. **Commands actually run:** tests, Prisma checks, lint, type checks, builds, Docker commands.
5. **Results:** pass/fail for each, including exact failures and whether they pre-existed.
6. **Manual test instructions:** a concise flow using the demo data.
7. **Environment variables:** new values to add to `.env` (never include secrets).
8. **Known limitations:** what remains incomplete or is not production-ready.
9. **Suggested next phase:** only after the current phase is tested.

Never report a test/build as passing unless it was run and passed.

---

## 17. FIRST ACTION TO TAKE NOW

Start by inspecting the repository and preparing the feature audit described in Phase 0. Then implement **Phase 1 (P0) end to end**, including schema/migrations, API/service logic, frontend workflows, and critical tests. Do not spend the first pass on the AI assistant or cosmetic UI redesign before inventory correctness is established.

When Phase 1 passes its exit gate, continue with Phase 2 and Phase 3 using the same rules. Implement Phase 4 only after the core platform is stable, and keep it optional/configurable.

**The desired outcome is a credible engineering product—not a large collection of disconnected screens.** Correct domain workflows, data integrity, security, tests, deployment, and clear documentation matter more than raw feature count.
