import { Hono } from "hono";
import { query } from "./db.js";
import { buildScoresQuery, buildStreakQuery } from "./queries.js";
import {
  decodeInstallationSecret,
  enrollInstallation,
  installationEnrollmentEnabled,
  isInstallationId,
} from "./installation-auth.js";
import { type ReplayProof, verifyReplayProof } from "./simulator.js";

const app = new Hono();
const MAX_BODY_BYTES = 2_000_000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-torus-timestamp, x-torus-request-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

app.use("*", async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(corsHeaders)) c.header(name, value);
});
app.options("*", (c) => c.text("ok"));

app.get("/health", async (c) => {
  await query("SELECT 1 AS ok");
  return c.json({ ok: true });
});

app.get("/rest/v1/scores", async (c) => {
  const sql = buildScoresQuery(new URL(c.req.url).searchParams);
  return c.json(await query(sql.text, sql.values));
});

app.get("/rest/v1/daily_streak_states", async (c) => {
  const sql = buildStreakQuery(new URL(c.req.url).searchParams);
  return c.json(await query(sql.text, sql.values));
});

type JsonObject = Record<string, unknown>;

app.post("/v1/installations/enroll", async (c) => {
  // Return the same response as an unknown route until enrollment is explicitly
  // enabled. This prevents installations from being claimed before rollout.
  if (!installationEnrollmentEnabled()) return c.json({ error: "NOT_FOUND" }, 404);

  const body = await readObject(c.req.raw);
  if (!isInstallationId(body.installationId)) {
    throw new HttpError("INVALID_INSTALLATION_ID", 400);
  }
  const clientUuid = requiredString(body.clientUuid, "INVALID_CLIENT_UUID", 8, 80);
  const secret = decodeInstallationSecret(body.secret);
  if (!secret) throw new HttpError("INVALID_INSTALLATION_SECRET", 400);

  const result = await enrollInstallation(
    body.installationId.toLowerCase(),
    clientUuid,
    secret,
  );
  if (result === "conflict") return c.json({ error: "INSTALLATION_CONFLICT" }, 409);
  return c.json({
    installationId: body.installationId.toLowerCase(),
    enrolled: result === "created",
  }, result === "created" ? 201 : 200);
});

app.post("/rest/v1/rpc/start_daily_attempt", async (c) => {
  const body = await readObject(c.req.raw);
  const clientUuid = requiredString(body.p_client_uuid, "INVALID_CLIENT_UUID", 8, 80);
  const challengeKey = dateKey(body.p_challenge_key);
  const playerName = optionalString(body.p_player_name, 20) ?? "Pending";
  return c.json(await rpc("start_daily_attempt", [clientUuid, challengeKey, playerName]));
});

for (const name of ["forfeit_daily_attempt", "rollback_daily_attempt"] as const) {
  app.post(`/rest/v1/rpc/${name}`, async (c) => {
    const body = await readObject(c.req.raw);
    const clientUuid = requiredString(body.p_client_uuid, "INVALID_CLIENT_UUID", 8, 80);
    const challengeKey = dateKey(body.p_challenge_key);
    const token = requiredString(body.p_attempt_token, "INVALID_ATTEMPT_TOKEN", 1, 256);
    return c.json(await rpc(name, [clientUuid, challengeKey, token]));
  });
}

interface SkillUsage {
  name: string;
  hotkey: string | null;
  command: string | null;
}
interface VerifyPayload {
  mode: "classic" | "daily";
  challengeKey: string;
  attemptToken?: string | null;
  clientUuid: string;
  entry: { user: string; score: number; level: number; date: string; skillUsage?: SkillUsage[] };
  replayProof: ReplayProof;
}

app.post("/functions/v1/verify-score", async (c) => {
  const parsed = validateVerifyPayload(await readObject(c.req.raw));
  const replay = verifyReplayProof(parsed.replayProof);
  if (!replay.ok) {
    return c.json({
      error: "REPLAY_VERIFICATION_FAILED",
      reason: replay.reason,
      actual: replay.actual,
      expected: {
        score: Math.trunc(parsed.replayProof.finalScore),
        level: Math.trunc(parsed.replayProof.finalLevel),
        time: Math.trunc(parsed.replayProof.finalTime),
        difficulty: parsed.replayProof.difficulty,
        inputCount: parsed.replayProof.inputs.length,
      },
    }, 400);
  }

  const skills = normalizeSkillUsage(parsed.entry.skillUsage);
  const args = parsed.mode === "daily"
    ? [parsed.clientUuid, parsed.challengeKey, parsed.attemptToken, parsed.entry.user,
      Math.trunc(parsed.entry.score), Math.trunc(parsed.entry.level), parsed.entry.date, JSON.stringify(skills)]
    : [parsed.clientUuid, parsed.entry.user, Math.trunc(parsed.entry.score),
      Math.trunc(parsed.entry.level), parsed.entry.date, JSON.stringify(skills)];
  const result = await rpc(parsed.mode === "daily" ? "submit_daily_score" : "submit_global_score", args);
  return c.json(result ?? {});
});

const RPC_ARITY = {
  start_daily_attempt: 3,
  forfeit_daily_attempt: 3,
  rollback_daily_attempt: 3,
  submit_daily_score: 8,
  submit_global_score: 6,
} as const;
type RpcName = keyof typeof RPC_ARITY;

async function rpc(name: RpcName, values: unknown[]): Promise<unknown> {
  if (values.length !== RPC_ARITY[name]) throw new Error("INVALID_RPC_ARGUMENTS");
  const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
  // The function identifier and arity come only from the closed allowlist above.
  const rows = await query<{ result: unknown }>(
    `SELECT public.${name}(${placeholders}) AS result`, values,
  );
  return rows[0]?.result ?? null;
}

async function readObject(request: Request): Promise<JsonObject> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new HttpError("PAYLOAD_TOO_LARGE", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new HttpError("PAYLOAD_TOO_LARGE", 413);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as JsonObject;
  } catch {
    throw new HttpError("INVALID_JSON", 400);
  }
}

function validateVerifyPayload(raw: JsonObject): VerifyPayload {
  if (raw.mode !== "classic" && raw.mode !== "daily") throw new HttpError("INVALID_MODE", 400);
  const clientUuid = requiredString(raw.clientUuid, "INVALID_CLIENT_UUID", 8, 80);
  if (!raw.entry || typeof raw.entry !== "object" || Array.isArray(raw.entry)) throw new HttpError("INVALID_ENTRY", 400);
  const entry = raw.entry as JsonObject;
  const user = requiredString(entry.user, "INVALID_PLAYER_NAME", 1, 20);
  if (typeof entry.score !== "number" || !Number.isFinite(entry.score) || entry.score < 0) throw new HttpError("INVALID_SCORE", 400);
  if (typeof entry.level !== "number" || !Number.isFinite(entry.level) || entry.level < 0) throw new HttpError("INVALID_LEVEL", 400);
  const date = requiredString(entry.date, "INVALID_CREATED_AT", 1, 64);
  if (!raw.replayProof || typeof raw.replayProof !== "object" || Array.isArray(raw.replayProof)) {
    throw new HttpError("INVALID_REPLAY_PROOF", 400);
  }
  const replayProof = raw.replayProof as unknown as ReplayProof;
  if (Math.trunc(entry.score) !== Math.trunc(replayProof.finalScore) ||
      Math.trunc(entry.level) !== Math.trunc(replayProof.finalLevel)) {
    throw new HttpError("ENTRY_REPLAY_MISMATCH", 400);
  }
  const challengeKey = raw.mode === "classic"
    ? requiredString(raw.challengeKey, "INVALID_CHALLENGE_KEY", 7, 7)
    : dateKey(raw.challengeKey);
  if (raw.mode === "classic" && challengeKey !== "classic") throw new HttpError("INVALID_CHALLENGE_KEY", 400);
  const attemptToken = raw.mode === "daily"
    ? requiredString(raw.attemptToken, "INVALID_ATTEMPT_TOKEN", 1, 256)
    : null;
  return {
    mode: raw.mode, challengeKey, attemptToken, clientUuid,
    entry: { user, score: entry.score, level: entry.level, date,
      skillUsage: Array.isArray(entry.skillUsage) ? entry.skillUsage as SkillUsage[] : undefined },
    replayProof,
  };
}

function requiredString(value: unknown, code: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new HttpError(code, 400);
  }
  return value.trim();
}
function optionalString(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim().length > max) throw new HttpError("INVALID_ARGUMENT", 400);
  return value.trim() || null;
}
function dateKey(value: unknown): string {
  const key = requiredString(value, "INVALID_CHALLENGE_KEY", 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new HttpError("INVALID_CHALLENGE_KEY", 400);
  return key;
}
function normalizeSkillUsage(raw: SkillUsage[] | undefined): SkillUsage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === "object").map((item) => ({
    name: String(item.name ?? "").trim().slice(0, 20),
    hotkey: item.hotkey ? String(item.hotkey).trim().slice(0, 16) : null,
    command: item.command ? String(item.command).trim().slice(0, 120) : null,
  })).filter((item) => item.name.length > 0).slice(0, 20);
}

class HttpError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 404 | 409 | 413) { super(message); }
}

app.notFound((c) => c.json({ error: "NOT_FOUND" }, 404));
app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  if (["INVALID_SELECT", "INVALID_LIMIT", "INVALID_FILTER", "INVALID_MODE", "INVALID_ORDER",
    "INVALID_CHALLENGE_KEY", "INVALID_CLIENT_UUID", "INVALID_QUERY_PARAMETER"].includes(error.message)) {
    return c.json({ error: error.message }, 400);
  }
  const knownDatabaseError = ["INVALID_CLIENT_UUID", "INVALID_PLAYER_NAME", "INVALID_CHALLENGE_KEY",
    "CHALLENGE_KEY_MISMATCH", "INVALID_ATTEMPT_TOKEN", "NO_ATTEMPTS_LEFT"]
    .find((code) => error.message.includes(code));
  if (knownDatabaseError) return c.json({ error: knownDatabaseError }, 400);
  console.error("Torus API request failed", { name: error.name });
  return c.json({ error: "INTERNAL_ERROR" }, 500);
});

export default app;
