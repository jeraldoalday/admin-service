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

Errors are returned as `{ "error": { "code": string, "message": string, "details"?: unknown } }`
with an appropriate HTTP status code.

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
  db/                   Prisma client singleton
prisma/
  schema.prisma          Data model
  migrations/            SQL migrations
tests/                   Vitest + supertest integration tests
```

## Status

Actively under development. See commit history for progress; new modules (RBAC, user
management, audit logging, and more) are being added incrementally.
