# admin-service

Internal admin/backoffice API service. TypeScript, Express, Prisma.

## Stack

- **Runtime**: Node.js 20+, TypeScript (strict mode)
- **HTTP**: Express 5
- **Database**: SQLite via Prisma ORM (better-sqlite3 driver adapter) for local dev; the
  datasource is a plain Prisma schema, so swapping to Postgres/MySQL later is a config
  change, not a rewrite.
- **Auth**: JWT access + refresh tokens, bcrypt-hashed passwords
- **Validation**: zod
- **Logging**: pino (pretty-printed in dev)
- **Tests**: Vitest + supertest, run against a real (migrated, isolated) SQLite database

## Getting started

```bash
npm install
cp .env.example .env   # edit secrets if needed
npm run prisma:migrate # applies migrations to the local dev database
npm run dev             # starts the server with hot reload on :3000
```

## Scripts

| Script                            | Description                                                 |
| --------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                     | Run the server with hot reload (tsx watch)                  |
| `npm run build`                   | Compile TypeScript to `dist/`                               |
| `npm start`                       | Run the compiled server (`dist/server.js`)                  |
| `npm run lint` / `lint:fix`       | ESLint                                                      |
| `npm run format` / `format:check` | Prettier                                                    |
| `npm run typecheck`               | `tsc --noEmit`                                              |
| `npm test`                        | Run the test suite (Vitest, migrates a fresh test DB first) |
| `npm run prisma:migrate`          | Create/apply a dev migration                                |
| `npm run prisma:generate`         | Regenerate the Prisma client                                |

## API

| Method | Route            | Auth   | Description                              |
| ------ | ---------------- | ------ | ---------------------------------------- |
| GET    | `/health`        | none   | Liveness check                           |
| GET    | `/health/ready`  | none   | Readiness check (verifies DB connection) |
| POST   | `/auth/register` | none   | Create an account, returns tokens        |
| POST   | `/auth/login`    | none   | Authenticate, returns tokens             |
| POST   | `/auth/refresh`  | none   | Exchange a refresh token for a new pair  |
| GET    | `/auth/me`       | bearer | Returns the authenticated user           |
| GET    | `/users`         | admin  | List users (paginated; filter by role/isActive/search) |
| GET    | `/users/:id`     | admin  | Get a single user                        |
| PATCH  | `/users/:id`     | admin  | Update displayName/role/isActive         |
| DELETE | `/users/:id`     | admin  | Delete a user                            |
| GET    | `/audit-logs`    | admin  | List audit log entries (paginated; filter by action/targetType) |

Errors are returned as `{ "error": { "code": string, "message": string, "details"?: unknown } }`
with an appropriate HTTP status code.

Admin-only routes require a bearer token for a user with `role: "ADMIN"`; the auth endpoints
under `/auth/*` are additionally rate-limited. Admins cannot change their own role/active
status or delete their own account (avoids locking yourself out). Updates and deletes made
through `/users` write an entry to `/audit-logs`.

## Project layout

```
src/
  app.ts              Express app assembly (middleware, routers)
  server.ts            Process entrypoint, graceful shutdown
  config/              Env loading + validation (zod)
  common/               Shared error types, async handler, logger
  middleware/           Error handling, request logging, auth guard
  modules/
    health/             Liveness/readiness endpoints
    auth/                Register/login/refresh/me
    users/               Admin user management (list/get/update/delete)
    audit/               Admin audit log listing + recordAuditLog()
  db/                   Prisma client singleton
prisma/
  schema.prisma          Data model
  migrations/            SQL migrations
tests/                   Vitest + supertest integration tests
```

## Status

Actively under development. See commit history for progress; new modules are being added
incrementally per the roadmap below.

## Roadmap

A rough 14-day build plan. Each day adds a self-contained module with its own tests.

| Day | Focus                                                                     |
| --- | -------------------------------------------------------------------------- |
| 1   | ✅ Project scaffold, config/logger, Express app, Prisma + User model, auth (register/login/refresh/me), integration tests, CI |
| 2   | ✅ RBAC middleware, admin user management (list/get/update/delete), audit logging, auth rate limiting |
| 3   | Teams/organizations — multi-tenancy model, membership, invites |
| 4   | Fine-grained permissions — resource-scoped permission checks beyond role |
| 5   | API keys — service-to-service auth, issuance/rotation/revocation |
| 6   | Notifications — email templates, dev/mock transport, user preferences |
| 7   | File uploads — storage abstraction, avatar/attachment endpoints |
| 8   | Background jobs — queue, scheduled cleanup and maintenance tasks |
| 9   | Advanced search & filtering — query DSL, sorting, saved filters |
| 10  | Outbound webhooks — subscriptions, signed delivery, retries |
| 11  | Reporting APIs — aggregated stats/dashboards for admins |
| 12  | Observability — metrics endpoint, request tracing, audit log export |
| 13  | Hardening — security review pass, dependency audit, load testing |
| 14  | Polish & release — OpenAPI spec, versioning, deployment docs, v1.0 |

Status markers (✅ done, 🚧 in progress) are updated as work lands.
