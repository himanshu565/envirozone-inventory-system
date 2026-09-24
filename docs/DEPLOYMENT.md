# Deployment Guide

This is a two-service deployment: `apps/api` (Express) and `apps/web` (Next.js) are
independent processes that talk to each other over HTTP, plus one PostgreSQL database
they share. Deploy them as two separate services — e.g. two containers, two platform
apps (Render/Railway/Fly for the API, Vercel or any Node host for the web app), or two
processes on one VM. They do not need to live on the same host.

See [PROJECT_GUIDE.md](./PROJECT_GUIDE.md) for *why* the project is shaped this way;
this doc is only about getting it running somewhere real.

## 1. Prerequisites

- Node.js 22.x (what this project is developed and tested against)
- A PostgreSQL 17 database reachable from wherever `apps/api` runs (the `docker-compose.yml`
  at the repo root is **local development only** — point `DATABASE_URL` at a managed
  Postgres instance in every real environment instead)

## 2. Environment variables

Copy each app's `.env.example` to `.env` (or set the equivalent variables in your
platform's config) and fill them in:

- [`apps/api/.env.example`](../apps/api/.env.example)
- [`apps/web/.env.example`](../apps/web/.env.example)

The one thing both files call out that's easy to miss: **`JWT_SECRET` must be the
identical value in both apps.** The API signs session tokens with it; the web app
verifies them with it. If they differ, every login will appear to succeed but the
user will look logged-out on every subsequent page load, with no error anywhere.

Generate a secret with:

```bash
openssl rand -hex 32
```

If `apps/web` and `apps/api` are deployed on different subdomains of the same parent
domain (e.g. `app.example.com` calling `api.example.com`), also set `COOKIE_DOMAIN` in
`apps/api`'s environment to the shared parent (e.g. `.example.com`) — otherwise the
session cookie the API sets won't be visible to the web app's server-side code, and
users will appear logged-out immediately after a successful login.

## 3. Install, build, migrate

From the repo root (this is an npm workspaces monorepo — one install covers everything):

```bash
npm install                # also runs `prisma generate` via apps/api's postinstall
npm run build               # builds apps/api (tsc) then apps/web (next build)
npm run migrate:deploy       # applies all Prisma migrations to DATABASE_URL
```

`migrate:deploy` runs `prisma migrate deploy`, which applies the versioned SQL files in
`apps/api/src/prisma/migrations/` in order. It does **not** touch data outside of what
those migrations specify, and it's safe to run on every deploy (already-applied
migrations are skipped). Do not use `prisma db push` in any real environment — see
[PROJECT_GUIDE.md §3.4](./PROJECT_GUIDE.md#34-migrations--the-history-of-the-schema-not-just-its-current-shape)
for why.

## 4. Seed the first admin account (first deploy only)

```bash
npm run seed -w apps/api
```

This is idempotent — safe to run again later, it just no-ops if an account with that
email already exists. **Before running it in production**, set `ADMIN_EMAIL` and
`ADMIN_PASSWORD` in `apps/api`'s environment (see `.env.example`) — otherwise it
creates `admin@envirozone.local` / `ChangeMe123!`, which is a fine default for local
dev and a real problem anywhere public.

## 5. Run

```bash
npm run start:api    # node dist/server.js, reads PORT (default 4000)
npm run start:web    # next start, reads PORT (Next's own default 3000)
```

(`npm start` at the root runs both concurrently, for a single-VM setup. Most platform
deployments will instead point each service's own start command — `npm run start -w
apps/api` / `npm run start -w apps/web` — directly at that service.)

Confirm the API is alive via `GET /health` (liveness) and ready via `GET /health/ready`
(liveness plus a database connectivity check). Use `/health/ready` for platform traffic
gating so an API process is not sent requests while its database is unavailable.

## 6. Production checklist

- [ ] `NODE_ENV=production` is set on the API — this gates the session cookie's
      `Secure` flag (HTTPS-only). Without it, cookies are sent over plain HTTP.
- [ ] `WEB_ORIGIN` on the API is set to the real web app URL — it defaults to
      `http://localhost:3000`, which will silently break CORS for a real deployment.
- [ ] `JWT_SECRET` matches exactly between both apps, and isn't a value that was ever
      committed to git or shared in plaintext.
- [ ] The seeded admin account's password has been changed from the seed script's
      default (see §4).
- [ ] HTTPS is terminated somewhere in front of both services (a platform's default,
      a load balancer, or a reverse proxy) — the app itself doesn't terminate TLS.
- [ ] The platform uses `GET /health` for liveness and `GET /health/ready` for readiness.
- [ ] The API's login rate limit is compatible with the deployment's NAT/proxy setup;
      configure trusted proxy handling at the edge if many users share one public IP.

## 7. Known gaps worth knowing before you ship

These are real, not oversights — see
[PROJECT_GUIDE.md §10](./PROJECT_GUIDE.md#10-whats-deliberately-missing) for the fuller
list, but the two most relevant to a first deployment:

- **No rate limiting on `/api/auth/login`.** Nothing currently throttles repeated
  login attempts — worth adding before exposing this publicly.
- **No automated tests or CI.** Every change to this codebase so far has been verified
  manually (typecheck, lint, and a real browser session). There's no pipeline that
  re-runs those checks on push.
