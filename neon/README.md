# Torus Neon compatibility API

This package hosts the Supabase-shaped HTTP routes used by the current Torus desktop client on one Neon Function.

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

Set the Torus backend base URL to the `torusapi` function invocation URL. During the compatibility phase, desktop builds use:

```text
VITE_SUPABASE_URL=<torusapi invocation URL without a trailing slash>
VITE_SUPABASE_ANON_KEY=neon-compat
```

The second value is only a nonsecret compatibility placeholder for existing clients. Never put a Neon connection string or database password in a `VITE_*` variable. The existing `/rest/v1/...` and `/functions/v1/verify-score` paths are appended unchanged. No secret is declared in `neon.ts`.

This first compatibility layer is public, like the prior anonymous Supabase reads and RPC calls. Score writes still require a valid replay, and daily state changes are guarded by attempt tokens in Postgres.
