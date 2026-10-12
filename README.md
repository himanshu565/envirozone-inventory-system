# EnviroZone Inventory

EnviroZone Inventory is an Express/Prisma/PostgreSQL API with a Next.js web
application for stock, purchase orders, locations, audit logs, and serialized
assets.

## Prerequisites

- Node.js 22
- npm
- PostgreSQL 17, or Docker Desktop for local PostgreSQL

## Local setup

```bash
npm ci
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env.local
```

Set a random `JWT_SECRET` in both env files. `DATABASE_URL` must point to the
same PostgreSQL database for the API and Prisma commands. `WEB_ORIGIN` must
match the browser origin used by the web app.

For disposable local infrastructure:

```bash
docker compose up -d db redis
npm run migrate:deploy
npm run seed -w apps/api
```

Redis is included for future infrastructure needs but is not currently used by
the application. Do not configure application behavior to depend on it yet.

## Development

```bash
npm run dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- API liveness: `GET /health`
- API readiness: `GET /health/ready`

## Environment variables

See [`apps/api/.env.example`](apps/api/.env.example) and
[`apps/web/.env.example`](apps/web/.env.example). Required API values are
`DATABASE_URL`, `JWT_SECRET`, and `WEB_ORIGIN`. The API validates them before
opening its listening socket. Production requires an HTTPS `WEB_ORIGIN`.

## Migrations and seed

Use versioned migrations only:

```bash
npm run migrate:deploy
```

Never use `prisma db push` against a valuable database. The seed command is
explicit and idempotent:

```bash
npm run seed -w apps/api
```

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` before seeding any
non-local environment. The seed command is never run automatically by the API.

## Tests and builds

```bash
npm run typecheck -w apps/api
npm run lint -w apps/web
npm run test:stock-ledger -w apps/api
npm run test:reports -w apps/api
npm run build
```

PostgreSQL integration tests require `STOCK_TEST_DATABASE_URL`. It must be a
separate local disposable database whose name contains `test`, `ci`, `tmp`, or
`temp`; the tests refuse development or production-looking URLs.

## Deployment and backups

Read [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) before deploying. Take a
reviewed PostgreSQL backup and verify restore procedures before applying
additive migrations to a valuable database. Deploy migrations before deploying
code that requires their schema.

## Troubleshooting

- `GET /health` succeeds but `GET /health/ready` fails: verify PostgreSQL is
  running and `DATABASE_URL` is reachable.
- Startup reports a missing environment variable: copy the relevant example
  file and set `DATABASE_URL`, `JWT_SECRET`, and `WEB_ORIGIN`.
- Login appears immediately logged out: confirm the same `JWT_SECRET` is set in
  both apps and review cookie domain/HTTPS settings.
- Integration tests skip: configure a safe disposable
  `STOCK_TEST_DATABASE_URL`; never point it at `DATABASE_URL`.
