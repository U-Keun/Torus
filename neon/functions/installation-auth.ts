import { createHmac, timingSafeEqual } from "node:crypto";
import { query, type DatabaseQuery } from "./db.js";

export const INSTALLATION_AUTH_SCHEME = "TorusInstall";
export const INSTALLATION_AUTH_VERSION = "ti1";
export const INSTALLATION_TIMESTAMP_HEADER = "x-torus-timestamp";
export const INSTALLATION_REQUEST_ID_HEADER = "x-torus-request-id";
export const INSTALLATION_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type Query = DatabaseQuery;

export interface InstallationToken {
  installationId: string;
  secret: Buffer;
}

export type AuthenticationResult =
  | { ok: true; installationId: string; clientUuid: string }
  | { ok: false };

export function installationUnauthorizedResponse(): Response {
  return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
}

export function isInstallationId(value: unknown): value is string {
  return typeof value === "string" && value === value.toLowerCase() && UUID_V4_PATTERN.test(value);
}

export function decodeInstallationSecret(value: unknown): Buffer | null {
  if (typeof value !== "string" || !SECRET_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) return null;
  return decoded;
}

export function parseInstallationAuthorization(value: string | null): InstallationToken | null {
  if (!value) return null;
  const match = /^TorusInstall ti1\.([^.]+)\.([^.]+)$/.exec(value);
  if (!match || !isInstallationId(match[1])) return null;
  const secret = decodeInstallationSecret(match[2]);
  return secret ? { installationId: match[1].toLowerCase(), secret } : null;
}

export function installationSecretDigest(secret: Uint8Array, pepper = installationTokenPepper()): Buffer {
  return createHmac("sha256", pepper).update(secret).digest();
}

export function installationEnrollmentEnabled(value = process.env.INSTALLATION_ENROLLMENT_ENABLED): boolean {
  return value === "true";
}

export function installationAuthEnforced(value = process.env.INSTALLATION_AUTH_ENFORCED): boolean {
  return value === "true";
}

export function installationAuthApplies(request: Request): boolean {
  return installationAuthEnforced() || request.headers.has("authorization");
}


export async function lockInstallationOwner(
  clientUuid: string,
  runQuery: Query,
): Promise<void> {
  // The fixed namespace separates this protocol from other advisory-lock users.
  // Hash collisions only serialize unrelated owners; they cannot bypass safety.
  await runQuery(
    "SELECT pg_advisory_xact_lock(1414484565, hashtext($1))",
    [clientUuid],
  );
}

export async function preflightInstallationMutation(
  request: Request,
  options: { now?: Date; runQuery?: Query } = {},
): Promise<AuthenticationResult> {
  const runQuery = options.runQuery ?? query;
  const auth = await authenticateInstallation(request, { runQuery });
  if (!auth.ok) return auth;

  const timestamp = validRequestTimestamp(
    request.headers.get(INSTALLATION_TIMESTAMP_HEADER),
    options.now ?? new Date(),
  );
  const requestId = request.headers.get(INSTALLATION_REQUEST_ID_HEADER);
  if (!timestamp || !isInstallationId(requestId)) return { ok: false };

  const rows = await runQuery<{ available: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM public.installation_request_nonces
       WHERE installation_id = $1 AND request_id = $2
     ) AS available`,
    [auth.installationId, requestId.toLowerCase()],
  );
  return rows[0]?.available === true ? auth : { ok: false };
}

export async function enrollInstallation(
  installationId: string,
  secret: Uint8Array,
  runQuery: Query = query,
): Promise<"created" | "existing" | "conflict"> {
  // A public legacy client UUID cannot prove ownership. Use the fresh,
  // unguessable installation ID as the authenticated owner identity instead.
  const clientUuid = installationId;
  const digest = installationSecretDigest(secret);
  const inserted = await runQuery<{ secret_digest: Buffer }>(
    `INSERT INTO public.installation_credentials (installation_id, client_uuid, secret_digest)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING secret_digest`,
    [installationId, clientUuid, digest],
  );
  if (inserted.length === 1) return "created";

  // Use a second statement so a concurrent winning insert is visible after the
  // unique-index wait completes. Either identifier conflict must fail closed.
  const rows = await runQuery<{ installation_id: string; client_uuid: string; secret_digest: Buffer }>(
    `SELECT installation_id, client_uuid, secret_digest
     FROM public.installation_credentials
     WHERE installation_id = $1 OR client_uuid = $2`,
    [installationId, clientUuid],
  );
  if (rows.length !== 1) return "conflict";
  const row = rows[0];
  const stored = Buffer.from(row.secret_digest);
  if (
    row.installation_id !== installationId ||
    row.client_uuid !== clientUuid ||
    stored.length !== digest.length ||
    !timingSafeEqual(stored, digest)
  ) {
    return "conflict";
  }
  return "existing";
}

export async function authenticateInstallation(
  request: Request,
  options: { mutation?: boolean; now?: Date; runQuery?: Query } = {},
): Promise<AuthenticationResult> {
  const token = parseInstallationAuthorization(request.headers.get("authorization"));
  if (!token) return { ok: false };

  const runQuery = options.runQuery ?? query;
  const rows = await runQuery<{ client_uuid: string; secret_digest: Buffer }>(
    `SELECT client_uuid, secret_digest FROM public.installation_credentials
     WHERE installation_id = $1 AND token_version = 'ti1' AND revoked_at IS NULL`,
    [token.installationId],
  );
  const expected = rows[0] ? Buffer.from(rows[0].secret_digest) : null;
  const actual = installationSecretDigest(token.secret);
  if (!expected || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false };
  }

  if (options.mutation) {
    const timestamp = validRequestTimestamp(
      request.headers.get(INSTALLATION_TIMESTAMP_HEADER),
      options.now ?? new Date(),
    );
    const requestId = request.headers.get(INSTALLATION_REQUEST_ID_HEADER);
    if (!timestamp || !isInstallationId(requestId)) return { ok: false };

    const consumed = await runQuery<{ installation_id: string }>(
      `WITH consumed AS (
         INSERT INTO public.installation_request_nonces
           (installation_id, request_id, request_timestamp)
         VALUES ($1, $2, $3)
         ON CONFLICT (installation_id, request_id) DO NOTHING
         RETURNING installation_id
       )
       UPDATE public.installation_credentials AS credentials
       SET last_authenticated_at = now()
       FROM consumed
       WHERE credentials.installation_id = consumed.installation_id
         AND credentials.token_version = 'ti1'
         AND credentials.revoked_at IS NULL
       RETURNING credentials.installation_id`,
      [token.installationId, requestId.toLowerCase(), timestamp],
    );
    if (consumed.length !== 1) return { ok: false };
  }

  return {
    ok: true,
    installationId: token.installationId,
    clientUuid: rows[0].client_uuid,
  };
}

function installationTokenPepper(): string {
  const pepper = process.env.INSTALLATION_TOKEN_PEPPER;
  if (!pepper || pepper.trim().length === 0) {
    throw new Error("INSTALLATION_TOKEN_PEPPER is not configured");
  }
  return pepper;
}

function validRequestTimestamp(raw: string | null, now: Date): Date | null {
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const milliseconds = Number(raw) * 1000;
  if (!Number.isSafeInteger(milliseconds)) return null;
  const timestamp = new Date(milliseconds);
  return Math.abs(now.getTime() - milliseconds) <= INSTALLATION_TIMESTAMP_TOLERANCE_MS
    ? timestamp
    : null;
}
