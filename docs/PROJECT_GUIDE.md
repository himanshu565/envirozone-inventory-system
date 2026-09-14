# Envirozone Inventory System — Project Guide

This is a walkthrough of the codebase as it exists today, written the way I'd explain it to
you in person: what each piece does, and — more importantly — **why** it was built that way
instead of some other, equally valid way. Software has many correct designs; the interesting
part is always the trade-off behind the one that was picked.

The project now covers the full core inventory workflow — master data (items, categories,
suppliers, locations), a stock ledger, purchase orders with receiving, org-wide settings, and
auth/RBAC — but it's still structured the way a much bigger production system would be. That's
deliberate: the patterns here (monorepo, shared packages, stateless auth, layered authorization,
audit logging, migrations) are exactly what you'd reach for at 10x or 100x the size. Learning
them now, while the codebase is still small enough to hold in your head, is much cheaper than
learning them under pressure on a large one.

---

## Table of contents

1. [The big picture](#1-the-big-picture)
2. [Monorepo structure — why three packages, not one](#2-monorepo-structure)
3. [The database layer](#3-the-database-layer)
4. [The shared `@envirozone/auth` package](#4-the-shared-envirozoneauth-package)
5. [The API app (`apps/api`)](#5-the-api-app-appsapi)
6. [The web app (`apps/web`)](#6-the-web-app-appsweb)
7. [Configuration files](#7-configuration-files)
8. [End-to-end walkthroughs](#8-end-to-end-walkthroughs)
9. [Production-grade patterns used here (glossary)](#9-production-grade-patterns-used-here-glossary)
10. [What's still missing (and why that's OK for now)](#10-whats-still-missing)

See also [DEPLOYMENT.md](./DEPLOYMENT.md) for how to actually ship this somewhere — this
guide is about *why* the code is shaped the way it is, not the deploy mechanics.

---

## 1. The big picture

```
Browser  <---->  apps/web (Next.js, port 3000)  <---->  apps/api (Express, port 4000)  <---->  PostgreSQL
                  "the UI"                                "the API"                             "the data"
```

Two independently-runnable applications, one shared library, one database. This is a
**split frontend/backend** architecture, as opposed to a single Next.js app doing everything
(UI + API routes + DB access in one process).

**Why split them at all?**

- **Independent scaling.** The API and the UI have completely different load profiles. In
  production you might run 10 copies of the API behind a load balancer and 2 copies of the
  web app, or deploy them on different infrastructure entirely (the API on a VM with direct DB
  access, the web app on a CDN-backed edge platform). A single combined app can't be scaled
  that way — you'd scale UI and business logic together even when only one needs it.
- **Independent deployment.** You can ship an API bug fix without rebuilding/redeploying the
  UI, and vice versa. Smaller blast radius per deploy.
- **A real client/server boundary forces good habits.** Because the browser talks to the API
  over plain HTTP (not function calls inside one process), every request has to be
  authenticated and validated as if it came from a stranger — which it might, since nothing
  stops someone from calling the API directly with `curl`. You can't accidentally leak a
  server-only secret into client code the way you can in some "full-stack framework" patterns,
  because the two codebases are physically separate.
- **The API becomes reusable.** A future mobile app, a reporting script, or an integration
  with another system can talk to the same API without touching the web app at all.

The trade-off you're paying for this: more moving parts (CORS, two `.env` files, cross-origin
cookies, two dev servers) than a single unified app would need. For a project of this size,
that's a deliberate bet that inventory-management systems tend to grow (more clients, more
integrations, need for API access) — worth confirming that's actually the direction this
project is headed, since if it's UI-only forever, a single Next.js app with API routes would
have been less ceremony.

---

## 2. Monorepo structure

```
envirozone-inventory-system/
├── apps/
│   ├── api/        Express + Prisma backend
│   └── web/        Next.js frontend
├── packages/
│   └── auth/        Code shared by both apps (session tokens, types)
├── docker-compose.yml   Local Postgres + Redis for development
└── package.json         The workspace root
```

This is an **npm workspaces monorepo**: one Git repository, one `package.json` at the root
that declares which folders are "workspaces", and `npm install` run once at the root links
everything together.

```json
// package.json (root)
"workspaces": ["apps/*", "packages/*"]
```

**Why a monorepo instead of three separate repos?**

- **Atomic changes across boundaries.** When you change the shape of a session token, that
  change touches the shared package *and* both apps that consume it. In a monorepo, that's one
  commit, one PR, one review, and it's impossible for the apps to drift out of sync with each
  other (you can't merge a web-app PR that references a field the auth package doesn't export
  yet). In separate repos, you'd need to publish the shared package first, then bump the
  version in two other repos — three PRs, three deploys, and a window where they can disagree.
- **Local shared packages, not published ones.** `packages/auth` isn't published to npm — it's
  consumed directly as source (`"main": "./src/index.ts"`). `npm install` at the root creates
  a symlink: `node_modules/@envirozone/auth -> packages/auth`. That means editing the shared
  package is instant for both consumers — no publish/bump/reinstall cycle, which matters a lot
  at this stage of a project where the shared contract is still changing weekly.
- **One `npm install`, one lockfile.** `package-lock.json` at the root pins *every* dependency
  version across all three packages consistently, so you can't end up with `apps/api` and
  `apps/web` silently using two different versions of the same library.

The cost: a monorepo needs tooling to run/build things per-package (`npm run dev -w apps/web`)
and, at larger scale, a build system (Turborepo, Nx) to avoid rebuilding everything on every
change. At three packages this project doesn't need that yet — see [`package.json`](../package.json)'s
`dev` script, which just runs both apps' dev servers concurrently via the `concurrently`
package. That's the simplest thing that works; reach for Turborepo/Nx when the "rebuild
everything" cost actually starts to hurt, not before.

---

## 3. The database layer

### 3.1 Why PostgreSQL

This is an inventory system: items, categories, suppliers, stock movements, purchase orders —
all strongly related, all needing transactional integrity (a stock transaction must either
fully commit — decrement stock *and* record the movement *and* update the PO — or not commit
at all). That's exactly what a relational database with ACID transactions is for. A
document/NoSQL store would fight you here: you'd end up hand-rolling the referential integrity
and consistency guarantees Postgres gives you for free.

### 3.2 Why Prisma (an ORM) instead of raw SQL

Look at [`schema.prisma`](../apps/api/src/prisma/schema.prisma) — it's the single source of
truth for the data model, written once, in TypeScript-adjacent syntax:

```prisma
model Item {
  id           Int     @id @default(autoincrement())
  itemCode     String  @unique
  name         String
  categoryId   Int
  category     Category @relation(fields: [categoryId], references: [id])
  ...
}
```

From this one file, Prisma generates:
1. **Migrations** — versioned SQL files that transform the DB schema step by step (see below).
2. **A fully-typed client** — `prisma.item.findMany({ where: { categoryId: 3 } })` is
   type-checked against the actual schema at compile time. If you rename a column in the
   schema and forget to update a query, `tsc` catches it before you ever run the code — this
   is the same class of bug that raw SQL string queries (`db.query("SELECT ...")`) simply
   cannot catch, because SQL-in-a-string is invisible to the type checker.

The trade-off: an ORM adds an abstraction layer, and very complex, performance-critical
queries sometimes need to drop to raw SQL anyway (Prisma supports that escape hatch via
`$queryRaw` when needed). For CRUD-heavy business apps like this one, the productivity and
safety win is worth it; you'd reconsider for an app that's mostly complex analytical queries.

### 3.3 Reading the schema — model by model

**`Category` / `Item`** — the master data. An `Item` belongs to one `Category`
(`onDelete: Restrict` is Prisma's default here, meaning you can't delete a category while
items still reference it — a deliberate guard rail against orphaning data by accident).

**`User`** — see [section 4](#4-the-shared-envirozoneauth-package) and
[section 5.6](#56-authentication--authorization) for the full auth story. Note `password`
stores a bcrypt *hash*, never the plaintext — see `lib/password.ts`.

```prisma
enum Role {
  ADMIN
  STORE_MANAGER
  ACCOUNTS
  VIEWER
}
```

Roles are a **Postgres enum**, not a free-text string column. Why: an enum is validated by the
database itself — it's structurally impossible to insert `role = "Admn"` (a typo) or
`role = "SUPERADMIN"` (a role that was never designed for) into the `User` table. A string
column would only be checked by your application code, and only if every single write path
remembered to check it.

**A real incident worth knowing about:** `ACCOUNTS` used to be `STAFF`. Renaming an enum value
sounds like a one-line schema edit, but it touches more than the schema file: `packages/auth`
has its own hand-written `Role` type (a second source of truth, by design — see
[section 4](#4-the-shared-envirozoneauth-package)), `lib/rbac.ts`'s permission matrix keys off
it, and both apps hardcode the role list for dropdowns/validation. All of those had to be
updated together. The trickier part was the database itself: Postgres has no `DROP VALUE` for
enums, and Prisma's own migration diff for a value rename is to *add* the new value and *drop*
the old one — which fails outright if any row still uses the value being dropped (and one did:
a real seeded user had `role = STAFF`). The safe fix was a hand-written migration using
`ALTER TYPE "Role" RENAME VALUE 'STAFF' TO 'ACCOUNTS'`, which relabels the enum value in place
by its internal identity rather than replacing it — existing rows (and the column's default)
update automatically, with no data loss and no migration you have to write by hand for every
row. See `apps/api/src/prisma/migrations/20260910180705_rename_staff_role_to_accounts/`.

**`Organization`** — deliberately modeled as a *singleton* table (see
`services/organization.service.ts` — there's always exactly one row, `id = 1`). Multi-tenant
SaaS systems have many organizations; this is a single-tenant, on-premise-style inventory
system for *one* company, so "the organization's settings" (name, logo, currency) live in one
row rather than a `organizationId` foreign key sprinkled across every other table. Simpler
schema, but it does mean this design can't become multi-tenant without a real migration later
— an accepted trade-off for the system this is.

**`Supplier` / `Location`** — reference data for where stock comes from and where it lives.
`Location.type` is an enum (`OFFICE | WAREHOUSE | SITE | OTHER`) for the same reason `Role` is:
a fixed, small, known set of categories should be enforced by the database, not just convention.

**`StockTransaction`** — the ledger. Every inward/outward/adjustment movement of stock is a
row here, never an update to a running total on `Item`. This is the **event-sourcing-lite /
ledger pattern**: instead of storing "current stock = 42" as a mutable number (which you'd
recompute by summing `StockTransaction` rows whenever you need the current balance), you get:
- A full audit trail for free — "why is stock at 42?" is answerable by reading history, not
  by trusting a number that could have been corrupted by a bug or a bad manual edit.
- No lost-update race conditions from two people adjusting stock at the same moment — each
  transaction is an independent insert, not a read-modify-write on a shared counter.

The cost is that reading "current stock" requires a `SUM()` query instead of one column read —
a fine trade for correctness in an inventory system, where "the numbers were wrong and we
don't know why" is a much worse failure mode than a slightly slower read.

**`PurchaseOrder` / `PurchaseOrderItem`** — a standard order-header/order-line pattern.
`PurchaseOrderItem.unitPrice` is `Decimal(12, 2)`, not `Float` — **never store money as a
floating-point number**. Floats can't represent decimal fractions like `0.10` exactly in
binary, so summing prices with floats accumulates rounding errors. `Decimal` is exact.

**`AuditLog`** — a generic "who did what to what" table (`action`, `entityType`, `entityId`,
`before`/`after` as JSON snapshots). This is intentionally schema-loose (JSON columns) because
an audit log needs to capture *any* entity's before/after state without a dedicated table per
entity type. See `services/audit.service.ts` — every mutating route calls it today (user, item,
category, supplier, location, stock transaction, purchase order, and organization changes all
write an entry), which is exactly the point of the generic shape: a table designed once didn't
need to change as seven more entity types started writing to it. The one gap: nothing reads
this table back yet — see [section 10](#10-whats-still-missing).

### 3.4 Migrations — the history of the schema, not just its current shape

```
apps/api/src/prisma/migrations/
├── 20260822110423_init/                                         (Category, Item, User, Supplier, Location, StockTransaction)
├── 20260831190016_add_organization_purchase_orders_audit_log/    (Organization, PurchaseOrder, PurchaseOrderItem, AuditLog)
├── 20260910180705_rename_staff_role_to_accounts/                 (hand-written — see 3.3)
└── migration_lock.toml
```

Each folder is a timestamped, hand-reviewable SQL file (`migration.sql`) generated by Prisma
from a diff between the previous schema and the current one. **This is the crucial idea**:
`schema.prisma` describes the *desired end state*, but the migrations folder is what actually
gets applied to a real database, in order, once each. That's what makes it safe to run the
same sequence against a fresh dev database, a staging database, and production, and know
they'll all end up identical.

The alternative — `prisma db push`, which just forces the database to match the schema file
directly with no history — is faster for early prototyping but **is not safe for production**:
it can silently drop columns/data to make the DB match the schema, and it leaves no record of
*how* the schema got from state A to state B, no way to roll back, and no way to review the
actual SQL before it runs. This project correctly uses real migrations
(`prisma migrate dev` / `prisma migrate deploy`) — I want to flag one real incident from
earlier in this project's life as the concrete lesson: the second migration
(`add_organization_purchase_orders_audit_log`) didn't exist yet even though those models had
already been added to `schema.prisma` — so a fresh database was missing the `AuditLog` table,
and the moment `users.routes.ts` tried to write an audit entry, it threw a 500 in production
code. **The schema file and the migrations folder can drift apart if you edit the schema but
forget to run `prisma migrate dev`** — the schema file alone is not the source of truth for
what's actually in any real database; the applied migrations are.

### 3.5 `prisma.config.ts` and the driver adapter

```ts
// apps/api/prisma.config.ts
export default defineConfig({
  schema: "src/prisma/schema.prisma",
  datasource: { url: env("DATABASE_URL") },
  migrations: { seed: "tsx src/prisma/seed.ts" },
});
```

This is Prisma's newer config format (Prisma 7), replacing fields that used to live directly
in `schema.prisma`. It also wires up `npx prisma db seed` to run the seed script automatically.

```ts
// apps/api/src/lib/db.ts
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
```

Two things worth understanding here:

1. **`@prisma/adapter-pg`** — Prisma can talk to Postgres either through its own bundled
   query engine binary, or through a driver adapter that hands queries to a plain Node.js
   `pg` client instead. The adapter approach is what makes Prisma work in edge/serverless
   runtimes (Cloudflare Workers, Vercel Edge Functions) that can't run a native binary, and
   it's generally the direction Prisma is moving. Since this API is a normal long-running
   Node process, either would work — the adapter was chosen to keep the door open for
   serverless deployment later without a rewrite.

2. **The `globalForPrisma` singleton trick:**
   ```ts
   const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };
   export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
   if (process.env.NODE_ENV !== "production") {
     globalForPrisma.prisma = prisma;
   }
   ```
   This exists to solve a *dev-only* problem: `tsx watch` (or Next.js's hot reload) re-executes
   your module files on every save, which would normally create a **new** `PrismaClient` — and
   therefore a new database connection pool — on every single file change, quickly exhausting
   Postgres's connection limit. Stashing the client on `globalThis` means the *module* gets
   re-evaluated on reload, but it finds the client already sitting on the global object and
   reuses it instead of creating a new one. In production, there's no watch-mode reloading, so
   this branch is skipped and a normal single instance is created per process.

### 3.6 `seed.ts` — bootstrapping the first user

```ts
const existing = await prisma.user.findUnique({ where: { email } });
if (existing) { console.log(...); return; }
// else create
```

Notice it's **idempotent** — checks whether the admin already exists before creating one. You
can run `npm run seed` repeatedly (e.g. every time you reset your local database) without
either erroring on a duplicate email or creating a second admin account. This is the *only*
mechanism that currently creates a user without already being logged in as an admin — by
design, since there's intentionally no public self-registration in a system where every
account needs an assigned role (see 5.7).

---

## 4. The shared `@envirozone/auth` package

```
packages/auth/
├── package.json      "main": "./src/index.ts"  — no build step, consumed as raw TS
└── src/
    ├── types.ts       Role, SessionPayload
    ├── session.ts     SESSION_COOKIE_NAME, createSessionToken, verifySessionToken
    └── index.ts        re-exports both
```

**Why this exists as a separate package, not just duplicated code:** both `apps/api` (issuing
and validating sessions) and `apps/web` (validating sessions to decide what to render / where
to redirect) need to agree, byte-for-byte, on: the cookie's name, the JWT signing algorithm,
and the shape of the payload inside it. If that logic were copy-pasted into both apps, a
future change to one copy (say, adding a new claim to the token, or switching algorithms) and
not the other would create a **silent, hard-to-diagnose failure**: the API would issue tokens
the web app can't parse, and users would appear logged-out on the web app immediately after a
successful login on the API — with no error message anywhere, because both sides technically
"succeeded" at their own (now-mismatched) job. Pulling the logic into one file that both
depend on makes that class of bug structurally impossible — there's only one implementation to
get right.

**Why it ships as raw TypeScript source with no build step**
(`"main": "./src/index.ts"`, no `dist/` folder, no `tsc` build for this package): both
consumers already have their own TypeScript transpilation pipelines — `tsx` for the API,
Turbopack for the web app — so there's no reason to make this package build itself into JS
first. It's a convenience only possible *because* this is a monorepo with local, unpublished
workspace packages; if this were published to npm for external consumers, you'd need a real
build step, since npm consumers can't be assumed to have a TypeScript toolchain that
understands `.ts` source directly. (Next.js needed one extra line to make this work —
`transpilePackages: ["@envirozone/auth"]` in `next.config.ts` — because unlike `tsx`, Next.js
does *not* transpile code pulled in from `node_modules`, including symlinked workspace
packages, unless told to.)

### `session.ts` — JWTs as the session mechanism

```ts
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}
```

This is a **stateless session**: all the information needed to know who's logged in
(`userId`, `email`, `role`) is encoded *inside* the token itself, cryptographically signed with
a server-only secret (`JWT_SECRET`). Verifying a session (`verifySessionToken`) means checking
the signature and expiry — no database lookup required. Compare that to a traditional
*stateful* session, where the cookie holds only an opaque ID and the server looks up the
session's data in a database or Redis on every request.

**Why stateless here:** it's simpler (no session table/store to manage, no extra DB round trip
on every authenticated request) and it's exactly what you need if the API is ever
horizontally scaled — *any* API instance can verify *any* token without needing shared session
storage, because the secret (not the session data) is the only thing that needs to be shared.

**The trade-off you're accepting:** you cannot revoke a single session early. If a user's
token leaks, or an admin needs to force-logout a compromised account, there is no way to
invalidate that one token before its 7-day expiry (`SESSION_DURATION_SECONDS = 60*60*24*7`) —
short of rotating `JWT_SECRET`, which would log out *every* user, not just one. A production
system that needs fine-grained revocation (force logout, "log out of all other devices")
typically adds a stateful layer on top — e.g. a `sessionVersion` column on `User`, bumped on
password change, checked against a claim in the token — rather than abandoning JWTs
altogether. Worth deciding whether this system needs that before it handles anything sensitive.

**Why `jose` instead of the more commonly-seen `jsonwebtoken` package:** `jose` is built on the
Web Crypto API, which means the *exact same code* works in Node.js, browsers, and edge
runtimes (Vercel Edge, Cloudflare Workers) without swapping libraries — relevant since
`apps/web`'s Next.js middleware (`proxy.ts`) can run on the edge runtime, where
`jsonwebtoken`'s Node-only crypto APIs aren't available.

```ts
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
```

Notice this **swallows every error into a plain `null`** rather than letting callers
distinguish "expired" from "tampered" from "malformed". That's deliberate: from the caller's
point of view (`requireAuth`, `proxy.ts`, `getSession()`), every failure mode has exactly one
correct response — treat the request as unauthenticated — so there's no reason to leak *why*
verification failed back to the client. (An attacker probing for "expired vs. invalid
signature" responses could use that distinction to learn things about the token format; a
uniform failure gives them nothing.)

---

## 5. The API app (`apps/api`)

```
apps/api/src/
├── server.ts               entry point — starts listening
├── app.ts                  the Express app itself (middleware + routes wired up)
├── lib/
│   ├── db.ts                Prisma client singleton
│   ├── password.ts          bcrypt hashing
│   ├── rbac.ts               role → permission matrix
│   └── list-query.ts         pagination/sorting query-string parsing
├── middleware/
│   └── auth.middleware.ts   requireAuth / requireRole / requireAction
├── routes/
│   ├── auth.routes.ts            /api/auth/{login,logout,me}
│   ├── users.routes.ts           /api/users (admin-only)
│   ├── categories.routes.ts      /api/categories (list, create)
│   ├── items.routes.ts           /api/items (full CRUD + computed currentStock)
│   ├── suppliers.routes.ts       /api/suppliers (list, create, update/deactivate)
│   ├── locations.routes.ts       /api/locations (list, create, update/deactivate)
│   ├── stock.routes.ts           /api/stock/{transactions,summary} — the ledger
│   ├── purchase-orders.routes.ts /api/purchase-orders (create, update, receive)
│   └── organization.routes.ts    /api/organization (singleton, admin-only writes)
├── services/
│   ├── audit.service.ts      writes to AuditLog
│   ├── organization.service.ts   singleton Organization row
│   └── stock.service.ts      current-stock and category-rollup aggregation (5.11)
└── prisma/                   schema, migrations, seed (see section 3)
```

### 5.1 `server.ts` vs `app.ts` — why two files for "the server"

```ts
// app.ts
export const app = express();
app.use(cors(...));
...
export default router; // (routes)
```
```ts
// server.ts
import { app } from "./app";
app.listen(PORT, () => console.log(...));
```

This split — the Express `app` object built and exported from one file, and `.listen()` called
from a separate, tiny entry-point file — is a standard pattern precisely so the app can be
**imported without starting a server**. It doesn't matter much here (there are no automated
tests yet), but it's what makes integration testing possible later: a test file can
`import { app } from "./app"` and drive it with a library like `supertest` (which sends fake
requests directly into the Express app object) without needing an actual open TCP port. If
`app.listen()` lived in the same file as the route definitions, every test run would need to
bind a real port, manage startup/shutdown, and risk port conflicts between parallel test runs.

### 5.2 Middleware order in `app.ts`

```ts
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.get("/health", ...);
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/items", itemsRoutes);
// ...one line per resource, same shape every time (5.10-5.13)
app.use(errorHandler); // must be last
```

Express middleware runs **in the order it's registered**, and this order is not arbitrary:

- **`cors` first** — must run before anything that could reject or process the request, so
  that even error responses carry the right CORS headers (otherwise the browser would hide the
  *actual* error behind a confusing "CORS error" instead). `credentials: true` is required
  because this app authenticates via cookies — without it, the browser refuses to send/receive
  cookies on cross-origin requests (the web app on `:3000` calling the API on `:4000` counts as
  cross-origin even though both are `localhost`, because origin = scheme + host + **port**).
- **`express.json()` before the routes** — parses the request body into `req.body` so route
  handlers can read it; routes registered before this middleware would see `req.body` as
  `undefined`.
- **The error-handling middleware is registered last, and takes 4 arguments** (`err, req, res,
  next`) — that 4-argument signature is how Express distinguishes an error handler from normal
  middleware. Express automatically routes any thrown/passed error to the *nearest* matching
  error handler, which is why it doesn't need to be manually wired into every route.

```ts
if (err instanceof SyntaxError && "body" in err) {
  res.status(400).json({ error: "Invalid JSON body" });
  return;
}
console.error(err);
res.status(500).json({ error: "Internal server error" });
```

This distinguishes **client mistakes** (malformed JSON in a request body — the client's fault,
correct response is `400 Bad Request`) from **server-side failures** (a bug, a DB outage — the
server's fault, correct response is `500`, and worth logging since *someone* needs to
investigate it). Collapsing both into a generic 500 would be actively misleading to API
consumers debugging their own request — and note the handler never leaks `err.message` or a
stack trace into the JSON response body, even for the 500 case, since that can expose internal
file paths or implementation details to whoever's calling the API.

### 5.3 `lib/password.ts` — never store or compare plaintext passwords

```ts
export async function hashPassword(password: string) {
  return bcrypt.hash(password, SALT_ROUNDS); // SALT_ROUNDS = 10
}
export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
```

Two things to internalize:
- **bcrypt is a *slow*, purpose-built hash** — unlike `sha256` or `md5`, which are designed to
  be *fast* (bad for passwords: fast hashes let an attacker who steals your password table try
  billions of guesses per second). bcrypt's `SALT_ROUNDS` parameter deliberately controls how
  slow it is, and that cost can be increased over time as hardware gets faster.
- **`bcrypt.hash` automatically generates and embeds a random salt** into its output string —
  that's why `verifyPassword` doesn't need a separate salt parameter; it's baked into `hash`
  itself. The salt's job is to make sure two users with the identical password get *different*
  stored hashes, so an attacker can't precompute one lookup table (a "rainbow table") that
  cracks every user in the table at once.

### 5.4 `lib/rbac.ts` — a permission matrix, not scattered `if (role === ...)` checks

```ts
const PERMISSIONS: Record<Role, Action[]> = {
  ADMIN: ["manageMasterData", "manageStock", "managePurchaseOrders", "manageUsers", "viewReports"],
  STORE_MANAGER: ["manageMasterData", "manageStock", "managePurchaseOrders", "viewReports"],
  ACCOUNTS: ["managePurchaseOrders", "viewReports"],
  VIEWER: [],
};
export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role].includes(action);
}
```

This models permissions as **actions** (`manageStock`, `viewReports`, ...) rather than baking
role checks directly into each route (`if (session.role !== "ADMIN" && session.role !==
"STORE_MANAGER") reject`). The difference matters as a system grows: with an action matrix,
"which roles can manage purchase orders" is answered by reading *one table in one file* —
without it, that answer is scattered across however many route files touch purchase orders,
and it's easy for one of them to drift (e.g. someone adds a new PO route and forgets that
`STORE_MANAGER` should also have access, or a role's permissions change and one call site
doesn't get updated). It's the same "single source of truth" idea as the shared auth package,
applied to authorization instead of authentication.

Notice `ACCOUNTS` can create and manage purchase orders but does **not** have `manageStock` —
it's deliberately a procurement/finance role, not a warehouse one. That split is exercised for
real by `purchase-orders.routes.ts` (5.13): creating a PO checks `managePurchaseOrders`, but
*receiving* one — which writes `StockTransaction` rows and actually moves inventory — checks
`manageStock` instead. An `ACCOUNTS` user can raise a PO and gets a `403` the moment they try to
mark it received; a `STORE_MANAGER` can do both. Same route file, two different actions checked
on two different endpoints, because they're two different real-world responsibilities.

### 5.5 `lib/list-query.ts` — pagination as a reusable contract

```ts
export function parseListQuery(searchParams: URLSearchParams): ListQuery { ... }
export function toPrismaPagination(query: ListQuery) {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}
export function toPrismaOrderBy(query, allowedSortFields, fallbackField) { ... }
export function toPaginationMeta(query, total): PaginationMeta { ... }
```

This was written *before* any list endpoint existed — scaffolding laid down ahead of items,
purchase orders, and the stock ledger specifically so every one of them would parse
`?page=&pageSize=&sortBy=&sortDir=&search=` the same way instead of four slightly different
reimplementations. That bet paid off: `items.routes.ts`, `purchase-orders.routes.ts`, and
`stock.routes.ts` (5.11, 5.13) all call the exact same four functions today. A couple of
details worth noticing:

- `pageSize` is clamped to `MAX_PAGE_SIZE = 100` — without a ceiling, a client (malicious or
  just buggy) could request `?pageSize=1000000` and force the API to load and serialize an
  enormous result set in one response, which is both a performance and an availability
  concern.
- `sortBy` is validated against an explicit **allow-list** (`allowedSortFields`) supplied by
  the caller, rather than being passed straight through to Prisma's `orderBy`. This closes off
  a class of bug where a client could pass an arbitrary/unintended column name — the route
  decides which columns are sortable, the query string can't expand that set.

### 5.6 Authentication & authorization — `middleware/auth.middleware.ts`

Three middleware factories, each answering a different question, layered on top of each other:

```ts
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const session = token ? await verifySessionToken(token) : null;
  if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }
  req.session = session;
  next();
}
```
**"Is anyone logged in?"** — reads the cookie, verifies the JWT (via the shared package),
attaches the decoded payload to `req.session` for downstream handlers, or short-circuits with
`401` if there's no valid session. This is the base layer every protected route needs.

```ts
export function requireRole(...roles: Role[]) {
  return (req, res, next) => {
    if (!req.session) { res.status(401)...; return; }
    if (!roles.includes(req.session.role)) { res.status(403)...; return; }
    next();
  };
}
```
**"Is this *specific* role allowed here?"** — a coarse-grained gate: `requireRole("ADMIN")` on
a route means only admins pass, full stop. Note this is a **factory** (a function that returns
a middleware function) so it can be parameterized per-route: `requireRole("ADMIN")` and
`requireRole("ADMIN", "STORE_MANAGER")` are both valid uses of the same code.

```ts
export function requireAction(action: Action) {
  return (req, res, next) => {
    if (!req.session) { res.status(401)...; return; }
    if (!can(req.session.role, action)) { res.status(403)...; return; }
    next();
  };
}
```
**"Is this role allowed to perform *this business action*?"** — the finer-grained sibling of
`requireRole`, built on the `rbac.ts` permission matrix instead of a hardcoded role list. Every
business route added since (items, suppliers, locations, stock, purchase orders) uses
`requireAction(...)` rather than `requireRole(...)`, precisely so that "who can manage stock" or
"who can manage purchase orders" stays answerable from one file (`rbac.ts`) instead of being
re-decided at every route. `requireRole` still has its place for things that are fundamentally
about identity rather than a business capability — user management is gated with
`requireRole("ADMIN")` in `users.routes.ts`, and organization settings the same way in
`organization.routes.ts` (5.14), because "can create other users" or "can change the company's
name and currency" are admin-only *identity* concerns, not delegable business actions.

**401 vs 403 — worth being precise about, since the codebase is:** `401 Unauthorized` means
"I don't know who you are" (no session, or an invalid one) — the correct client response is
"go log in". `403 Forbidden` means "I know exactly who you are, and the answer is no" — the
correct client response is "you're logged in, but you can't do this; don't retry, don't
re-login". Conflating them (returning 401 for a permission failure, say) would make a web UI
incorrectly redirect a legitimately logged-in user back to the login page instead of showing a
"you don't have permission" message.

### 5.7 `routes/auth.routes.ts` — login, logout, me

```ts
const user = await prisma.user.findUnique({ where: { email } });
if (!user || !(await verifyPassword(password, user.password))) {
  res.status(401).json({ error: "Invalid email or password" });
  return;
}
```

**The exact same error message and status code** is returned whether the email doesn't exist
*or* the password is wrong. This is a small but important **enumeration-attack defense**: if
"no such user" and "wrong password" returned different messages, an attacker could feed a list
of email addresses to the login endpoint and, from the differing responses, build a list of
which emails have real accounts on the system — even without ever guessing a single correct
password. One generic message closes that off entirely.

```ts
res.cookie(SESSION_COOKIE_NAME, token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  domain: process.env.COOKIE_DOMAIN || undefined,
  maxAge: SESSION_DURATION_SECONDS * 1000,
});
```

Every cookie option here is a deliberate security decision, not a default left untouched:
- **`httpOnly: true`** — makes the cookie invisible to JavaScript (`document.cookie` can't see
  it). This is the single biggest mitigation against **XSS (cross-site scripting)**: even if an
  attacker manages to inject a malicious script into the page (via some other vulnerability),
  that script still cannot read the session token and exfiltrate it, because the browser
  simply never exposes an `httpOnly` cookie to page scripts.
- **`secure: NODE_ENV === "production"`** — in production, the cookie is only ever sent over
  HTTPS, never plain HTTP (where it could be intercepted in transit). It's relaxed to `false`
  in development only because local dev typically runs over plain `http://localhost` with no
  TLS certificate.
- **`sameSite: "lax"`** — the browser withholds this cookie on most *cross-site* requests
  (e.g. a `<form>` on `evil.com` submitting to this API), which is the primary browser-level
  defense against **CSRF (cross-site request forgery)**. `"lax"` (rather than the stricter
  `"strict"`) still allows the cookie on top-level navigation *to* this site (e.g. clicking a
  link from an email), which is the right balance for a normal login flow.
- **`domain`** — see [section 4's revocation note](#4-the-shared-envirozoneauth-package) and
  the earlier fix in this project's history: left `undefined` (host-only cookie) in local dev
  since `apps/web` and `apps/api` share the literal hostname `localhost`; must be set to a
  shared parent domain (e.g. `.envirozone.app`) in production if the two apps are deployed on
  different subdomains, or the web app's server-side code will never see the cookie the API
  sets, and users will appear logged-out immediately after a successful login.

`logout` clears the same cookie (same options, so the browser matches it) rather than trying
to invalidate the JWT server-side — consistent with the stateless-session trade-off discussed
in section 4: there's nothing server-side *to* invalidate.

`GET /me` is gated by `requireAuth` and just echoes back `req.session` — the decoded token
contents. This is what lets the frontend ask "who am I, right now, according to my cookie?"
without re-sending credentials.

### 5.8 `routes/users.routes.ts` — the admin-only user-management API

```ts
router.use(requireAuth, requireRole("ADMIN"));
```

Every route in this file is gated at the router level, once, rather than repeating
`requireAuth, requireRole("ADMIN")` on each individual route — the same "single source of
truth" instinct as the RBAC matrix, applied at the routing layer: it's structurally impossible
to add a new route to this file and *forget* to protect it.

```ts
if (!name || !email || !password) { res.status(400)...; return; }
if (password.length < 8) { res.status(400)...; return; }
if (!ROLES.includes(role as Role)) { res.status(400)...; return; }
const existing = await prisma.user.findUnique({ where: { email } });
if (existing) { res.status(409).json({ error: "A user with this email already exists" }); return; }
```

Validation happens **before** touching the database, and in a specific order: cheap
in-memory checks (are the required fields even present, is the password long enough, is the
role one of the four valid values) run first, and only once those pass does the code make a
database round trip to check for an existing email. This "fail fast, fail cheap" ordering
avoids wasting a DB query on a request that was already invalid — with a `pageSize=1000000`-style
attack in mind, this also matters at scale: cheap validation should never be gated behind an
expensive operation.

`409 Conflict` (not `400`) for a duplicate email is the correct status code specifically because
the *request itself* is well-formed — the conflict is with existing *state* on the server, which
is exactly what 409 means.

```ts
await recordAudit({
  actorId: req.session!.userId,
  action: "user.create",
  entityType: "User",
  entityId: user.id,
  after: { id: user.id, name: user.name, email: user.email, role: user.role },
});
```

Every user creation is recorded to the `AuditLog` table — *who* (the admin's `userId`, from
their own session) created *what* (the new user's id/name/email/role), *when* (the row's
`createdAt`). In a system where user accounts control access to inventory/financial data,
being able to answer "who created this account, and when" later is a real operational and
compliance need, not a nice-to-have. Note the audit write deliberately does **not** include the
password — even the hash — in the `after` snapshot; audit logs should never carry credential
material, even hashed.

The response objects throughout this file (and `auth.routes.ts`) are hand-built —
`{ id, name, email, role }` — rather than simply returning the full Prisma `user` row. That's
not laziness; it's how `password` (the bcrypt hash) never leaves the server, even by accident.
This is a pattern worth internalizing: **explicitly listing what a response includes is safer
than an allow-*everything* default that later has to be remembered as needing exceptions.**

### 5.9 `services/` — why a service layer, even a thin one

```ts
// audit.service.ts
export async function recordAudit(input: RecordAuditInput) {
  return prisma.auditLog.create({ data: { ...input } });
}
```

Right now, `recordAudit` and `getOrganization`/`updateOrganization` are barely more than
one-line wrappers around a Prisma call — it might look like unnecessary indirection. The reason
to still put them in a `services/` layer rather than calling `prisma.auditLog.create(...)`
directly from route files: routes should describe *HTTP concerns* (parsing the request,
choosing a status code, shaping the response), and services should describe *business
operations* (what "recording an audit entry" or "getting the org's settings" means). As soon
as either of these grows real logic — say, audit entries eventually get pushed to an external
log aggregator in addition to the DB, or `getOrganization` starts validating currency codes —
that logic goes in exactly one place, and every route that calls it gets the improvement for
free, instead of the logic needing to be duplicated (or, more likely, only added to *some* of
the call sites) if it had been written inline everywhere.

`organization.service.ts`'s `upsert` pattern (`update: {}, create: { id: 1, name: "Envirozone" }`)
is the standard way to implement "get-or-create" for a singleton row atomically — it can't race
with itself creating two rows, the way a manual "check if it exists, then create" would under
concurrent requests.

### 5.10 `items.routes.ts` / `categories.routes.ts` — master data, and the shape every list endpoint follows

Every route that lists something follows the same skeleton now: `parseListQuery` the query
string, build a Prisma `where` from an optional `search` term, run the `findMany` and `count`
in parallel with `Promise.all`, and return `{ data, pagination }`. Once you've read one of these
(`items.routes.ts` is the fullest example — search, sort, pagination, and a computed field, all
in one handler), you've effectively read the shape of `suppliers`, `locations`, and
`purchase-orders` too.

The one thing `items.routes.ts` does that the simpler resources don't:

```ts
const stockByItem = await getCurrentStockByItemIds(items.map((item) => item.id));
const data = items.map((item) => ({ ...item, currentStock: stockByItem.get(item.id) ?? 0 }));
```

`currentStock` isn't a column — it's computed on every read from the `StockTransaction` ledger
(5.11) and attached to each item in the response. This is the direct consequence of the
event-sourcing-lite decision on `StockTransaction` (section 3.3): there's no mutable "quantity"
field to just select, so every place that needs to *show* stock has to ask the ledger for it.

`Category` deliberately has no `PATCH` or `DELETE` route, and `Item` has full CRUD. That's not
an oversight — a category is closer to a tag (create it, use it, rename it rarely) than an
entity with a lifecycle, so the extra endpoints weren't built until something needed them.

### 5.11 `stock.routes.ts` / `services/stock.service.ts` — turning the ledger into a number

The ledger pattern (section 3.3) means "current stock" has to be *computed*, not read. That
computation lives in one place — `stock.service.ts` — so it's identical everywhere it's needed:
the items list (5.10), the category-level summary, and the dashboard's low-stock widget.

```ts
const grouped = await prisma.stockTransaction.groupBy({
  by: ["itemId", "type"],
  where: { itemId: { in: itemIds } },
  _sum: { quantity: true },
});
```

One `groupBy` query gets the summed quantity per item *per transaction type*, instead of
fetching every row and reducing in application code — the aggregation happens in Postgres,
which is the difference between a query that scales and one that doesn't as the ledger grows.
Turning those sums into a single "current stock" number needs a sign convention, and this is
worth being explicit about because it's not obvious from the schema alone: `INWARD` and
`OUTWARD` quantities are always entered as positive numbers (the API rejects a negative one for
these two types) and the *type* supplies the sign — `+quantity` for inward, `-quantity` for
outward. `ADJUSTMENT` is different: its quantity carries its own sign, because a stock-count
correction can go either direction (`+3` for "found extra on the shelf", `-3` for "found
damaged"), and forcing a fixed sign onto a correction that's inherently bidirectional would
just move the ambiguity into `remarks` text instead of resolving it.

`POST /api/stock/transactions` is gated on `manageStock`, not `manageMasterData` — recording a
physical stock movement is a different responsibility from editing what an item *is*, and the
two are given to different roles for exactly that reason (5.4).

### 5.12 `suppliers.routes.ts` / `locations.routes.ts` — deactivate, don't delete

Both models have an `isActive` boolean in the schema, and neither route file has a `DELETE`
endpoint. That's deliberate, not missing: a `Supplier` or `Location` referenced by historical
`StockTransaction` rows can't be deleted without either breaking that history or cascading the
delete into the ledger — and silently losing ledger rows is exactly the failure mode the ledger
pattern exists to prevent (section 3.3). Toggling `isActive` gets you the real-world effect
("stop offering this in dropdowns for new transactions") without touching anything that already
happened. `PATCH` on both routes accepts a partial update *and* the `isActive` toggle through
the same endpoint, rather than a separate `/deactivate` route — it's just another field being
set.

### 5.13 `purchase-orders.routes.ts` — the fullest write path in the app

A purchase order has a real lifecycle (`DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED`, or
`CANCELLED` at any point), and one endpoint here is worth reading closely: `POST
/:id/receive`. Recording a receipt has to do three things *together* — update how much of each
line item has been received, append `StockTransaction` rows for the physical movement, and
recompute the order's status — and none of those three should happen without the other two, so
the whole thing runs inside `prisma.$transaction(...)`. If the process crashed halfway through
without that, you could end up with stock recorded as received but the PO still showing `SENT`,
or vice versa — a state no valid sequence of real-world events could produce.

```ts
if (poItem.quantityReceived + quantity > poItem.quantityOrdered) {
  res.status(400).json({ error: `Cannot receive more than ordered for item ${poItem.itemId}` });
}
```

Over-receiving is rejected outright rather than silently allowed — a receipt that doesn't match
what was ordered is far more likely to be a data-entry mistake than a legitimate case, and the
cost of asking the user to double-check is much lower than the cost of a stock count that's now
wrong for a reason nobody will remember in a month.

```ts
const fullyReceived = items.every((i) => i.quantityReceived >= i.quantityOrdered);
const status = fullyReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : order.status;
```

Status isn't something a user sets by hand when receiving stock — it's *derived* from the line
items every time a receipt is recorded. That's the same instinct as the ledger pattern applied
one level up: trust computed state over a value someone has to remember to update. (The status
field is still directly editable via `PATCH /:id` for the parts of the lifecycle that aren't
about receiving — moving a `DRAFT` to `SENT`, or cancelling an order — where there's no
underlying data to derive it from.)

Every `StockTransaction` created by a receipt carries `purchaseOrderId`, closing the loop the
schema was built for: the ledger doesn't just say "8 units came in", it says "8 units came in,
*because of this specific order*" — answerable later without cross-referencing anything by hand.

### 5.14 `organization.routes.ts` — reusing the singleton pattern for settings

The route is thin on purpose — `getOrganization`/`updateOrganization` already existed in
`services/organization.service.ts` (5.9) before any route called them, so this file is close to
pure HTTP glue. `GET` is open to anyone authenticated (the org's name/currency are the kind of
thing every screen might eventually want to show), but `PATCH` is gated `requireRole("ADMIN")`
rather than `requireAction("manageMasterData")` — changing the company's own name, currency, or
contact details is an identity-level decision about the business itself, not a delegable
day-to-day operation, which is the same distinction section 5.6 draws for user management.

---

## 6. The web app (`apps/web`)

```
apps/web/src/
├── app/
│   ├── layout.tsx                    root HTML shell, fonts (theme-agnostic — see 6.4)
│   ├── (auth)/login/page.tsx         login page (public)
│   └── (app)/                        every authenticated page — one shared layout, one auth gate
│       ├── layout.tsx                 the shell: Sidebar + TopBar + redirect-if-no-session (6.4)
│       ├── page.tsx                   dashboard (6.5)
│       ├── inventory/page.tsx         items + categories (6.6)
│       ├── stock/page.tsx             ledger, suppliers, locations, category summary (6.7)
│       ├── purchase-orders/
│       │   ├── page.tsx                list + create
│       │   └── [id]/page.tsx           detail + receive (6.8)
│       ├── users/page.tsx             admin-only, extra page-level role check (6.2)
│       └── settings/page.tsx          admin-only, organization settings (6.9)
├── components/
│   ├── sidebar.tsx, top-bar.tsx       the app shell (6.4)
│   ├── dashboard.tsx
│   ├── users-manager.tsx, inventory-manager.tsx
│   ├── stock/                        four components composed by stock/page.tsx (6.7)
│   ├── purchase-orders/
│   └── settings/
├── lib/
│   ├── api.ts                  API_URL constant
│   └── auth.ts                 getSession() — server-side session read
└── proxy.ts                     Next.js middleware — the auth gate
```

This is a **Next.js App Router** app. The single most important thing to understand about App
Router before anything else makes sense: every component is a **Server Component by default**
— it runs only on the server, is never shipped to the browser as JS, and can directly access
server-only things like cookies or environment secrets. A component only becomes a **Client
Component** — hydrated and interactive in the browser — when it's explicitly marked
`"use client"` at the top of the file. This project uses that split very deliberately.

### 6.1 `proxy.ts` — the front gate

```ts
const PUBLIC_PATHS = ["/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.includes(pathname);
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (session && isPublicPath) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
```

This is Next.js **middleware** — it runs on *every* matching request, before any page renders,
on the edge runtime (fast, no full Node.js startup). It's the single choke point that decides,
for every page in this app: is the visitor logged in, and are they allowed to be on this
particular page?

- **No session + not on `/login`** → bounced to `/login`, and the *original* path is preserved
  as a `?from=` query param, so the login page could (once wired up — it doesn't use it yet)
  send the user back to whatever they were actually trying to reach instead of always landing
  on the home page after login.
- **Has a session but is sitting on `/login`** → redirected to `/`. There's no reason for an
  already-authenticated user to see the login form.
- **`PUBLIC_PATHS.includes(pathname)`** — an *exact* match, not `pathname.startsWith("/login")`.
  That distinction matters: `startsWith` would have also classified a hypothetical future route
  like `/login-history` as "public" (since it starts with the string `"/login"`), silently
  exposing a page that should have required auth. Prefix matching for a supposedly-fixed list
  of public routes is a footgun precisely because "prefix of X" is a much bigger, fuzzier set
  than "is X" — always ask whether you actually mean "equals" before reaching for `startsWith`
  on a security-relevant check.
- **The `matcher`** excludes `/api/*` (irrelevant here since API calls go to a *different*
  origin/port entirely, but harmless to exclude), Next's own static asset routes, and the
  favicon — none of those are "pages" a user navigates to, so running the auth check against
  them would be pure overhead.

This middleware verifies the JWT itself (via `@envirozone/auth`) — it does **not** call the
API to ask "is this session valid?". That's the whole point of stateless JWTs (section 4):
verification only needs the shared secret, so the web app's own server process can do it
directly, with no network round trip to the API on every single page navigation.

### 6.2 `lib/auth.ts` — `getSession()`, the server-component equivalent

```ts
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
```

This is what a **Server Component** page calls to find out who's logged in — reading the
cookie directly via Next's `cookies()` API and verifying it the same way `proxy.ts` does. The
`(app)` layout (6.4) already calls it once, to redirect anyone with no session before rendering
the shell at all — genuinely redundant with `proxy.ts` for "is anyone logged in", since that
question is already answered before the page even starts rendering. But it's **not** redundant
for the *second* question a couple of pages ask — `/users` and `/settings` both need "is this
specifically an admin?", which `proxy.ts` has no way to know:

```ts
// app/(app)/users/page.tsx
const session = await getSession();
if (session?.role !== "ADMIN") redirect("/");
```

`proxy.ts` only knows a *generic* list of public vs. protected paths — it doesn't know that
`/users` specifically requires the `ADMIN` role. That's a **page-level** authorization check,
deliberately layered on top of the **route-level** authentication check middleware already
did. This is "defense in depth" applied to authorization: even if `proxy.ts`'s matcher were
ever misconfigured, or a new protected route were added and its role requirement forgotten
at the middleware layer, the page itself still refuses to render for the wrong role. Relying
on exactly one layer to get everything right, forever, is fragile; two independent layers that
both have to fail for a real bypass to occur is much sturdier — and this same principle is
also why the **API** independently re-checks `requireRole("ADMIN")` on `/api/users` itself
(section 5.8), rather than trusting that "well, the web UI only shows this page to admins" is
enough. **The web app's page gating is a UX nicety, not a security boundary** — nothing stops
someone from calling the API directly with `curl` and a stolen cookie, bypassing the web app
entirely, which is exactly why the API's own `requireRole` check is the check that actually
matters; the page-level one just avoids showing an admin-only UI to someone who's going to get
a 403 from every button in it anyway.

### 6.3 Client components — the `"use client"` boundary

```tsx
"use client";
...
await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
```

(That's `top-bar.tsx`'s logout handler — every interactive piece of this app, from the sidebar
nav to every manager component, is marked `"use client"` for the same reason.) They need
**interactivity**: `onClick` handlers, `useState` for form fields and loading states,
`useEffect` to fetch data after the component mounts in the browser. Server Components can't do
any of that — they run once, on the server, and produce static HTML; there's no "component
instance" left alive afterward to attach an event handler to.

Notice the pattern: **the browser calls the API directly** (`fetch(`${API_URL}/...`,
{ credentials: "include" })`), not through a Next.js API route that proxies to the backend.
`credentials: "include"` tells the browser to attach the session cookie to this cross-origin
request (without it, the browser would silently omit the cookie, and every request would look
unauthenticated). This is the direct consequence of the split-frontend/backend decision from
section 1: the web app's *server* doesn't need to be a relay for every API call, because the
browser is perfectly capable of talking to the API's origin on its own, cookie and all — the
web app's server is only involved for the parts that genuinely need it (rendering pages,
reading the session cookie to decide what to render).

`users-manager.tsx` is the fuller example — a controlled form (`useState` per field) that
`POST`s to `/api/users`, followed by re-fetching the list (`loadUsers()`) on success rather than
manually splicing the new user into local state. That's a deliberate simplicity choice: it
costs one extra network request, but it guarantees the displayed list is always exactly what
the server has — no risk of the UI's local copy silently drifting from reality (e.g. if the
server applied some transformation, or another admin created a user in the same moment). Every
other manager component added since (inventory, stock, purchase orders, settings) follows the
identical shape: `useState` for the list, a `load...()` function called once on mount and again
after every successful mutation, a separate `useState` for the form. It's worth knowing this
pattern trips one specific ESLint rule — `react-hooks/set-state-in-effect` flags the mount-time
`useEffect(() => { loadX(); }, [])` call in every one of these components, because calling
`setState` synchronously inside an effect can, in general, cause cascading renders. It's a
deliberate, accepted exception here rather than a bug: the alternative (fetching in a Server
Component and passing data down) would fight the "browser calls the API directly" pattern this
whole section is about, and the cascading-render risk the rule warns about doesn't apply to a
one-shot mount-time fetch.

### 6.4 The `(app)` shell — `layout.tsx`, `sidebar.tsx`, `top-bar.tsx`

Every authenticated page lives under the `(app)` route group (a Next.js convention: the
parentheses mean the folder organizes routes without adding a path segment — `(app)/inventory`
is still just `/inventory`), sharing one `layout.tsx` that does three things once instead of
seven times: reads the session, redirects to `/login` if there isn't one, and renders the
`Sidebar` + `TopBar` shell around whatever page is active. Before this existed, session-reading
and the page-level admin checks (6.2) were the only auth logic on each page; now the *generic*
"is anyone logged in" check lives in exactly one file, and each page only has to add the
page-specific check on top (`/users` and `/settings` still check `role === "ADMIN"` themselves
— the shared layout has no way to know that's required for those two paths specifically).

`Sidebar` is deliberately styled independent of the rest of the app's theme — a fixed dark
teal background regardless of light/dark mode — which is itself downstream of a real decision:
this app doesn't follow the OS `prefers-color-scheme` at all anymore. It used to (Tailwind's
`dark:` variants, applied throughout), until the design intentionally moved to a single
committed light theme — every `dark:` class was stripped, and `globals.css`'s
`prefers-color-scheme: dark` media query was removed with it. A dark sidebar next to an
otherwise-light app isn't a leftover from that; it's a common enterprise-dashboard convention
(persistent dark nav rail, light content area) applied on purpose, unrelated to the app's own
light/dark story.

`TopBar` derives the page title from the current pathname (a small `TITLES` lookup, with a
prefix match so `/purchase-orders/42` still resolves to "Purchase Orders") rather than each
page passing its own title down — one more place where "add a new page" means "add one line",
not "update N files that all need to agree."

### 6.5 The dashboard — `dashboard.tsx`

The stat cards, the low-stock alert table, and the "recently added items" table all come from
**one** fetch: `GET /api/items?pageSize=100&sortBy=createdAt&sortDir=desc`. Rather than a
separate request per widget, the dashboard fetches the largest page the API allows (5.5's
`MAX_PAGE_SIZE`) once and derives everything client-side — `recentItems` is just the first five,
`lowStockItems` is the same array filtered to `currentStock < minimumStock` and sorted by how
far under. That's a real trade-off, not a free lunch: on an inventory with more than 100 items,
both widgets become a preview of the *most recent* 100 rather than a guaranteed-complete answer
— acceptable for a dashboard glance, not acceptable as a substitute for the Inventory page's own
paginated, complete view.

Color is used as a second channel of meaning throughout, not just decoration: blue marks
primary/items-related things, emerald marks anything category-related, amber marks the one
metric meant to draw the eye (`Low stock`, which also turns its own number red when the count
is above zero). That convention is set here and reused verbatim in Inventory and Stock (6.6,
6.7) — a category pill is emerald *everywhere* in the app, not just on the dashboard.

### 6.6 Inventory — `inventory-manager.tsx`

The items table's `currentStock` column reuses the exact red-below-minimum highlight the
dashboard uses — the same comparison (`currentStock < minimumStock`), styled the same way,
because it's the same fact and a user shouldn't have to learn two different visual languages
for it depending on which page they're on. `Item.description` is shown as a small muted line
under the item's name rather than as its own table column — it's often long free text, and a
dedicated column either truncates it uselessly or blows out the table's width; a secondary line
(with the full text in a `title` tooltip) reads naturally without either problem.

### 6.7 Stock — `components/stock/`

One page (`stock/page.tsx`) composes four independent components — `CategoryStockSummary`,
`StockMovements` (the record-a-movement form plus the ledger table), `SuppliersManager`,
`LocationsManager` — each fetching its own data. That independence caused a real bug worth
knowing about: adding a new supplier through `SuppliersManager` didn't make it appear in
`StockMovements`'s "Supplier" dropdown until a full page reload, because the two components had
no way to know about each other's writes. The fix is a small shared-refresh-signal pattern in
`stock-manager.tsx` — a `useState` counter (`optionsVersion`) that `SuppliersManager` and
`LocationsManager` bump via an `onChange` callback after every successful create/update, which
`StockMovements` watches as a `useEffect` dependency to refetch its dropdown options. It's the
minimum plumbing needed to keep independently-fetching sibling components honest about each
other's writes, without reaching for a shared state library for four components.

### 6.8 Purchase orders — list + detail

Two routes, matching the two things you do with a PO: `/purchase-orders` lists them and creates
new ones (dynamic line items — an "Add line" button appends another item/quantity/price row to
local form state before submit); `/purchase-orders/[id]` is where you actually manage one —
status, notes, and the receive form. Each line item's "receive now" input is capped at
`quantityOrdered - quantityReceived` in the UI, mirroring the same guard the API enforces
server-side (5.13) — the UI check is a courtesy that prevents an obviously-invalid submission
before it round-trips to the server; the API's own check is the one that actually matters,
same "UI convenience vs. server-side enforcement" split as 6.2's page-level admin gating.

### 6.9 Settings — `organization-settings.tsx`

Follows the same self-contained-component pattern as everything else in this section, gated the
same two ways `/users` is (6.2): the page redirects non-admins server-side, and the sidebar
simply never renders the "Settings" link for them — belt and suspenders, with the API's own
`requireRole("ADMIN")` on `PATCH /api/organization` (5.14) as the check that actually can't be
bypassed by curling the API directly.

---

## 7. Configuration files

### `apps/api/tsconfig.json`
```json
"module": "commonjs",
"moduleResolution": "node",
```
The API runs under Node via `tsx`, so it's configured for CommonJS module resolution — the
traditional Node.js module system. (Worth knowing: earlier in this project, `moduleResolution`
was accidentally changed to `"bundler"`, which is only valid alongside `"module": "es2015"` or
later — TypeScript rejected that combination outright, `tsc` couldn't compile the project. It's
a good illustration of why these two settings have to be chosen as a matched pair, not
independently.)

### `apps/web/tsconfig.json`
```json
"module": "esnext",
"moduleResolution": "bundler",
```
The opposite pairing, correctly — Next.js bundles the app with Turbopack/webpack, which
understands modern ES module syntax and does its own resolution, so `"bundler"` resolution
(which mimics how bundlers actually resolve imports, including `package.json` `"exports"`
maps) is the appropriate choice here, unlike the API's plain Node runtime.

### `apps/web/next.config.ts`
```ts
transpilePackages: ["@envirozone/auth"],
```
Covered in section 4 — Next.js doesn't transpile TypeScript found in `node_modules` by
default (for good reason: most of what's in `node_modules` is already-compiled JS, and
transpiling all of it on every build would be slow), so workspace packages consumed as raw
`.ts` source need to be explicitly opted in.

### `docker-compose.yml`
```yaml
services:
  db:
    image: postgres:17-alpine
    ports: ["5433:5432"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```
This is **local development infrastructure only** — it gives you a disposable, reproducible
Postgres + Redis without installing either natively on your machine. (The host port is `5433`,
not Postgres's default `5432`, specifically to avoid colliding with an unrelated Postgres
container from a different project that was already occupying `5432` on this machine — a good
reminder that `docker-compose.yml`'s port mappings are a *local* convenience, not something an
app should ever hardcode elsewhere; the API only knows the DB's location through
`DATABASE_URL` in `.env`, never through this file directly.) Redis is provisioned but nothing
in the codebase uses it yet — likely reserved for a future need like caching or rate-limiting.
In production, you would not run the database in Docker Compose next to the app — you'd point
`DATABASE_URL` at a managed database service instead; this file has no role in production at
all.

### `.env` files (not committed to git — see `.gitignore`)
Each app has its own, documented in full in [`apps/api/.env.example`](../apps/api/.env.example)
and [`apps/web/.env.example`](../apps/web/.env.example) — copy each to `.env` and fill it in.
The one thing worth calling out here rather than just in the example file: `JWT_SECRET` must be
the **identical** value in both apps — it's how the web app verifies tokens the API signed, and
if they diverge, login will appear to succeed with no error anywhere while every subsequent page
load looks logged-out. `apps/web`'s vars are also where the `NEXT_PUBLIC_` prefix matters: only
env vars prefixed that way are ever bundled into client-side JavaScript and sent to the browser
(`NEXT_PUBLIC_API_URL` needs it; `JWT_SECRET` deliberately does not — it must never reach the
browser). See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full list of what each app needs in a
real deployment beyond local dev.

---

## 8. End-to-end walkthroughs

### 8.1 Logging in

1. Browser: user fills in the form on `/login` ([`login/page.tsx`](../apps/web/src/app/(auth)/login/page.tsx),
   a client component) and submits.
2. Browser calls `fetch("http://localhost:4000/api/auth/login", { credentials: "include", body: {...} })`
   directly — no Next.js server involvement at all for this step.
3. API (`auth.routes.ts`): looks up the user by email, compares the password against the
   bcrypt hash (`verifyPassword`), and — on success — signs a JWT (`createSessionToken`,
   from `@envirozone/auth`) containing `{ userId, email, role }`.
4. API responds with `Set-Cookie: session=<jwt>; HttpOnly; SameSite=Lax; ...` plus a small JSON
   body (`{ id, name, email, role }`) the UI uses to update its own state immediately.
5. Browser stores the cookie (scoped to whatever `domain`/host was set — see 5.7) and the login
   page calls `router.push("/")`.
6. That navigation to `/` is intercepted by `proxy.ts` on the web app's server, which reads the
   *same* cookie (now present, since the browser sends it on requests to whatever domain it's
   scoped for) straight out of the request, verifies it with the shared package, sees a valid
   session, and lets the request through to render the home page.
7. `page.tsx` (a server component) calls `getSession()` to read `email`/`role` out of the
   cookie again, server-side, to render "Signed in as ...".

### 8.2 An admin creating a new user

1. Admin is on `/users` — `users/page.tsx` (server component) already checked
   `session.role === "ADMIN"` before rendering anything (section 6.2).
2. `users-manager.tsx` (client component) `useEffect`s on mount, calling
   `GET /api/users` with `credentials: "include"` to populate the table.
3. API: `router.use(requireAuth, requireRole("ADMIN"))` on `users.routes.ts` runs first —
   verifies the cookie, then checks the role is exactly `ADMIN` — *before* the `GET /` handler
   ever runs.
4. Admin fills the create-user form, submits → `POST /api/users` with `{ name, email,
   password, role }`.
5. API validates (required fields → password length → valid role enum value → email not
   already taken, in that cheap-to-expensive order — section 5.8), hashes the password
   (`hashPassword`), creates the `User` row, writes an `AuditLog` entry (`recordAudit`), and
   responds `201` with the safe subset of fields (no password hash).
6. UI clears the form and calls `loadUsers()` again to refresh the table from the server's
   actual current state.

### 8.3 An unauthenticated visitor hitting any protected page

1. Browser requests `/` (or `/users`, or anything not `/login`) with no session cookie.
2. `proxy.ts` runs first, finds no valid session, and the path isn't in `PUBLIC_PATHS` →
   redirects to `/login?from=/`.
3. The page component (`page.tsx`) never even executes — the redirect happens in middleware,
   before rendering starts.

### 8.4 Receiving a purchase order — the one flow that touches everything

Worth walking through end to end because it's where the ledger pattern (3.3), the RBAC action
split (5.4, 5.11), and the atomic-transaction decision (5.13) all show up in the same request.

1. A `STORE_MANAGER` is on `/purchase-orders/7`, a `PARTIALLY_RECEIVED` order for 20 units of
   an item, 8 already received (6.8). They enter `12` in that line's "receive now" field and
   click **Record receipt**.
2. Browser calls `POST /api/purchase-orders/7/receive` with `{ receipts: [{ itemId, quantity: 12 }] }`.
3. API: `requireAction("manageStock")` runs first — this is *not* `managePurchaseOrders`, so an
   `ACCOUNTS` user who could see and even create this PO would get a `403` here (5.4, 5.11).
4. The handler re-validates server-side that `8 + 12` doesn't exceed the `20` ordered (never
   trusting the UI's own cap from 6.8), then opens `prisma.$transaction(...)`.
5. Inside that transaction: `PurchaseOrderItem.quantityReceived` becomes `20`; a new
   `StockTransaction` row is created — `type: INWARD`, `quantity: 12`, `purchaseOrderId: 7`,
   `supplierId` copied from the PO, `referenceNumber` set to the PO's own number; the order's
   items are re-checked and, since every line is now fully received, `status` is set to
   `RECEIVED`. All three writes commit together or not at all.
6. `recordAudit(...)` writes a `purchaseOrder.receive` entry — `before`/`after` status, and
   which items were received in what quantity — to `AuditLog` (3.3, 5.9). Nothing reads this
   back yet (10), but it's there.
7. Response includes the updated order. The UI re-fetches and re-renders: the status badge
   flips to `RECEIVED`, the "receive now" input for that line disappears (`remaining` is now
   `0`), and the next time anyone opens `/inventory` or the dashboard, `currentStock` for that
   item is `12` higher — not because anything told it to be, but because it's recomputed from
   the ledger (5.11) every time it's read, and the ledger now has one more row in it.

---

## 9. Production-grade patterns used here (glossary)

A quick-reference list of the *ideas*, independent of this specific codebase, worth
recognizing anywhere you see them:

- **Stateless authentication (JWT sessions)** — session data lives in a signed token the
  client holds, not in server-side storage; trades easy horizontal scaling for the inability
  to revoke a single session early.
- **Layered authorization (defense in depth)** — the same "is this allowed?" question gets
  asked more than once, at different layers (edge middleware → page component → API route
  middleware), so a mistake at any *one* layer isn't a full bypass.
- **Role-based vs. action-based access control** — `requireRole` (coarse: "which roles") vs.
  `requireAction`/`can()` (fine: "which roles can do *this specific thing*", defined once in
  a matrix) — the latter scales better as the number of business capabilities grows.
- **The ledger/event-sourcing-lite pattern** — `StockTransaction` as append-only history
  instead of a mutable running total, trading a `SUM()` at read time for a full audit trail
  and no lost-update races.
- **Audit logging** — a dedicated, generically-shaped table recording who changed what, when,
  separate from the entities being changed.
- **Migrations as the database's source of truth** — versioned, reviewable SQL, applied in
  order, vs. `db push`'s "force the DB to match right now, no history, can silently drop data".
- **Singleton client / connection pooling** — one `PrismaClient` instance reused across
  requests (and, in dev, across hot reloads via `globalThis`), instead of opening a new DB
  connection pool per request.
- **Explicit response shaping** — hand-picking exactly which fields a response includes
  (`{ id, name, email, role }`) rather than returning a full DB row and hoping sensitive
  columns get filtered out elsewhere.
- **Fail-fast, cheap-first validation** — check inexpensive things (are required fields
  present, is a string the right shape) before expensive ones (a database round trip).
- **Monorepo + workspace-local shared packages** — one repository, one source of truth for
  code shared between otherwise-independent apps, without needing to publish/version that
  code externally.
- **Environment-driven configuration** — secrets and per-environment values (`DATABASE_URL`,
  `JWT_SECRET`, `COOKIE_DOMAIN`) live in `.env` files outside version control, never
  hardcoded, so the same code runs correctly in dev, staging, and production by swapping
  configuration, not code.
- **Derived state over stored state** — `Item.currentStock` and `PurchaseOrder.status` are both
  computed from other rows every time they're read, never stored as a value something has to
  remember to keep in sync (5.11, 5.13). Costs a query at read time; buys the guarantee that the
  value shown is never stale relative to the data it's derived from.
- **Soft deactivation over deletion for referenced reference data** — `Supplier`/`Location`
  toggle `isActive` rather than being deleted, because history (`StockTransaction` rows) can
  point at them; "no longer offered" and "never existed" are different facts, and only one of
  them is safe to represent by removing a row (5.12).
- **Multi-step writes wrapped in a database transaction** — when an operation has to update more
  than one thing consistently (PO receiving: line items, ledger rows, and order status all at
  once), `prisma.$transaction(...)` makes it commit atomically — no state a crash mid-operation
  could leave behind that no real sequence of events would ever produce (5.13).
- **A hand-written migration for what the ORM's diff tool can't express safely** — Prisma will
  generate a migration for an enum value rename, but its default diff (drop the old value, add
  the new one) fails outright against rows still using it. `ALTER TYPE ... RENAME VALUE` is a
  single safe statement for exactly this case, and it's fine — expected, even — to write SQL by
  hand when the tool's default output is the wrong shape for what you're actually doing (3.3).

---

## 10. What's still missing

Being honest about the current state, so nothing here is mistaken for an oversight rather than
a "not built yet." The core business workflow is done now — items, categories, suppliers,
locations, the stock ledger, purchase orders (including receiving), organization settings, and
RBAC all exist and are exercised end to end. What's left is mostly operational hardening, not
missing features:

- **`viewReports` is a dead permission** — it's in `rbac.ts`'s matrix, assigned to `ADMIN`,
  `STORE_MANAGER`, and `ACCOUNTS`, and checked by exactly zero routes. This is the same state
  `managePurchaseOrders` was in until this project's purchase-orders feature got built — worth
  reading as "the next business feature, already reserved a permission" rather than dead code to
  delete. There's no dedicated reports view yet; the dashboard's stat cards and low-stock table
  are the closest thing today, and they don't check this permission at all (they're visible to
  every authenticated role).
- **The audit log has no reader** — `recordAudit` is called from every mutating route (3.3,
  5.9), so the *data* — who changed what, when — is all there, sitting in `AuditLog`. Nothing
  reads it back: no `GET` route, no admin page. It's being recorded for a future that hasn't
  arrived yet, not being recorded for no reason.
- **No rate limiting** — `/api/auth/login` has no protection against a brute-force
  password-guessing script hammering it. Now that this project is meant to actually be deployed
  (see [DEPLOYMENT.md](./DEPLOYMENT.md)), this is the single most important gap left to close.
- **No session revocation** — see section 4; a compromised token is valid until it expires,
  with no "log out everywhere" mechanism yet.
- **No automated tests, no CI** — the `server.ts`/`app.ts` split (5.1) was specifically built to
  make integration testing straightforward later; nothing exercises that possibility yet, and
  nothing runs `tsc`/lint/migration checks automatically on a push or PR. Every verification
  this project has had so far has been a human (or an agent) running the checks by hand each
  time — that doesn't scale past one contributor for long.
- **No password reset / email verification flow** — an admin creates every account with a
  password directly (5.8); there's no "forgot password" or email-confirmation story.
- **No structured logging or monitoring** — errors go to `console.error`; nothing is shipped to
  an aggregator, and there's no request logging beyond Express's defaults.
- **Dependencies need periodic re-auditing, not a one-time check** — this project shipped with a
  *critical* unauthenticated-RCE advisory sitting in its exact pinned Next.js version for a
  while before anyone ran `npm audit` and caught it (now patched — see `DEPLOYMENT.md`'s git
  history). `npm audit` costs nothing to run and nothing here runs it automatically; it should
  become a CI check the moment CI exists, not something that depends on someone remembering.

None of these are wrong to be missing at this stage — they're the next things to reach for, in
roughly the order a real production rollout would force them into priority. See
[DEPLOYMENT.md](./DEPLOYMENT.md#7-known-gaps-worth-knowing-before-you-ship) for the subset of
this list that specifically matters before a first deploy.
