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

Apply the SQL files in `migrations/` in numeric order through the Neon SQL Editor or `psql` using the branch's unpooled migration connection. Then run:

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

## Daily attempt capability storage

Migration `0004_daily_attempt_token_hash.sql` replaces the plaintext Daily attempt token column with a fixed-size SHA-256 digest. Existing active tokens are hashed during migration. New attempts use 32 random bytes and return the raw hex capability only once. The database stores only its digest.

To resume an active attempt, send the locally held raw token as the optional `p_attempt_token` field to `POST /rest/v1/rpc/start_daily_attempt`. A matching token is echoed back with `resumed: true`. If an active attempt exists but the proof is missing or wrong, the response has `accepted: false`, `attemptToken: null`, and `hasActiveAttempt: true`. The server does not disclose, rotate, or reissue the capability. Score submission, forfeiture, and rollback hash the supplied token before comparing it and clear the stored digest when they consume the attempt.

During the compatibility rollout, a headerless legacy client can still start a fresh attempt and submit it during the same running session. After an app restart, that client cannot recover an active token that it did not retain. Authenticated new clients retain the raw token and can prove possession to preserve resume behavior. The current desktop session snapshot still uses `localStorage`; moving the attempt token into the native installation credential vault is a separate follow-up hardening task.

## Installation credentials (rollout foundation)

Migration `0002_installation_credentials.sql` adds server-only installation credentials and consumed request IDs. Direct `PUBLIC` access to both tables is revoked.

Configure `INSTALLATION_TOKEN_PEPPER` as a server secret before using installation authentication. It is required to derive the stored HMAC-SHA256 digest and must not be exposed to clients or placed in a `VITE_*` variable. Credentials and secrets must never be logged. Keep the pepper stable: changing it invalidates all enrolled credentials.

Enrollment is closed by default. `POST /v1/installations/enroll` behaves like an unknown route unless `INSTALLATION_ENROLLMENT_ENABLED=true`. Enable enrollment only during the coordinated client rollout. The JSON request is:

```json
{
  "installationId": "123e4567-e89b-42d3-a456-426614174000",
  "secret": "<32 random bytes encoded as unpadded base64url>"
}
```

The fresh installation ID also becomes the authenticated `clientUuid`. Existing public client UUIDs cannot prove ownership, so they are retained only for local matching of historical leaderboard rows and are never claimable through enrollment. Repeating the same ID and secret is idempotent; reusing the ID with a different secret returns `409`. The server stores only `HMAC-SHA256(INSTALLATION_TOKEN_PEPPER, secret)` and never returns the secret.

Authenticated requests use this exact authorization form:

```text
Authorization: TorusInstall ti1.<installationId>.<secret>
```

Authenticated state mutations also require a fresh Unix timestamp in whole seconds (within five minutes) and a UUID request ID:

```text
X-Torus-Timestamp: 1767355200
X-Torus-Request-Id: 223e4567-e89b-42d3-a456-426614174001
```

Each `(installationId, requestId)` pair is consumed atomically. Reuse, stale metadata, malformed credentials, incorrect credentials, and owner mismatches all produce the same `401 {"error":"UNAUTHORIZED"}` response. Enrolled owners must authenticate private Daily attempt-status reads and mutations even before global enforcement. Headerless legacy owners continue to work while enforcement is disabled, but they cannot claim or downgrade an enrolled identity. Enrollment and each headerless legacy access phase take the same owner-keyed transaction advisory lock. Legacy rate accounting commits separately from the business operation, which acquires the lock and checks credential state again. If enrollment wins between those phases, the final check rejects the legacy operation. This closes the enrollment-versus-legacy downgrade race without refunding request cost on business failure.

Roll out in this order:

1. Configure a stable `INSTALLATION_TOKEN_PEPPER` while `INSTALLATION_AUTH_ENFORCED` remains unset or `false`.
2. Deploy migrations `0002` and `0003` plus the Function with rate limits, then set `INSTALLATION_ENROLLMENT_ENABLED=true` and release clients that enroll, store the secret in native secure storage, and authenticate private reads and mutations.
3. Keep enrollment enabled for legitimate first-run installations. Treat its flag as an emergency kill switch, not a normal migration-window switch.
4. Confirm adoption, then set `INSTALLATION_AUTH_ENFORCED=true`. Missing authentication on mutations now returns the same generic `401` as invalid authentication.

Public score leaderboards remain anonymous. For compatibility, only a Daily streak request selecting exactly `client_uuid,max_streak` with an `in.(...)` owner filter remains anonymous. Other streak projections require an exact owner: legacy owners use the atomic compatibility transaction before enforcement, while authenticated or enforced requests must bind that owner to the credential.

This is bearer authentication and relies on HTTPS plus native secret storage. The timestamp and request ID reject an exact duplicate request ID; they do not sign the method, path, headers, or body. Possession of the bearer secret grants the installation's full authority, so these headers do not protect against a stolen bearer token. Credential recheck, nonce consumption, and the protected database mutation run on one checked-out connection in one transaction, so a failed operation rolls the nonce back.

Migration `0003` adds a bounded cleanup function for consumed request IDs. It deletes at most 500 nonce rows older than 10 minutes per call and uses `idx_installation_request_nonces_consumed_at`.


## Server rate limits

Migration `0003_server_rate_limits.sql` adds the server-only PostgreSQL fixed-window buckets. PostgreSQL is the shared authority across Function instances. The API does not use `X-Forwarded-For` or process memory. Policies and route keys are a closed server allowlist:

- enrollment global: **120 requests/minute**, before body parsing;
- enrollment installation ID: **3 requests/10 minutes**, after validating the ID;
- authenticated score verification: **10 requests/minute per credential and route**, after auth but before replay simulation;
- authenticated Daily mutations: **30 requests/minute per credential and route**;
- private score and streak status: **60 requests/minute per owner and route**.

The limits admit exactly the stated count. The next request gets `429 {"error":"RATE_LIMITED"}` and a whole-second `Retry-After` header. Rejected requests still consume a count. Enrollment accounting occurs outside the enrollment transaction, so invalid secrets and enrollment conflicts are also retained. Mutation authentication preflight happens before charging a credential bucket. Rate accounting happens before the business transaction, so a failed or rolled-back mutation does not refund it.

During optional-auth rollout, headerless legacy mutations are limited only after their claimed UUID can be parsed. That UUID is public, spoofable, and bypassable, so this is transitional abuse reduction rather than an identity boundary. Remove this path by enabling `INSTALLATION_AUTH_ENFORCED`. Public leaderboard reads remain subject to Neon platform limits for now.

Do not put bearer secrets, authorization headers, request IDs, or other tokens in rate-limit keys. The current keys are only fixed constants, installation IDs, and claimed legacy owner UUIDs.

At least hourly, call both `select public.cleanup_server_rate_limit_buckets();` and `select public.cleanup_installation_request_nonces();` using a server database role. Each call uses its cleanup index and deletes at most 500 expired rows. Repeat each call until it returns `0` to drain a backlog without an unbounded request-path delete.
