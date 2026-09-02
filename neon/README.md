# Torus Neon API

This package is the current online leaderboard backend for Torus. It runs on one Neon Function and stores rankings and Daily Challenge state in Neon Postgres.

## Prerequisites

- Node.js 20 or newer. Node.js 24 best matches the deployed runtime.
- A Neon project in `aws-us-east-2`, the only Functions region during the beta.
- The latest Neon CLI, installed separately with `npm install -g neon@latest`.

Keeping the CLI outside this package avoids shipping deployment tooling with the server bundle.

## Local development

From this directory, install dependencies and link the intended Neon project:

```sh
npm install
neon link
```

Apply `migrations/0001_initial.sql` through the Neon SQL Editor or `psql` using the branch's unpooled migration connection. Then run:

```sh
neon dev
npm test
npm run typecheck
```

Use `GET /health` on the printed local URL to verify that the Function can query its linked database.

Neon injects `DATABASE_URL`. The app does not return or log it. The pool is created once and attached with `attachDatabasePool` for safe reuse by the long-lived Functions runtime.

## Deployment

```sh
neon deploy
```

Set the desktop app's public backend base URL to the deployed `torusapi` Function invocation URL without a trailing slash:

```text
VITE_API_BASE_URL=<torusapi invocation URL without a trailing slash>
```

`VITE_API_BASE_URL` is the only public frontend backend setting. It is not a secret. Never put a Neon connection string, `DATABASE_URL`, or database password in a `VITE_*` variable. No secret is declared in `neon.ts`.

The API intentionally keeps the established `/rest/v1/...` and `/functions/v1/verify-score` routes for compatibility with existing server behavior. This public API replaces the prior anonymous backend access. Score writes still require a valid replay, and daily state changes are guarded by attempt tokens in Postgres.
