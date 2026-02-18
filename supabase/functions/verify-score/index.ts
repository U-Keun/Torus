import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  type ReplayProof,
  verifyReplayProof,
} from "./simulator.ts";

type ScoreMode = "classic" | "daily";

interface SkillUsage {
  name: string;
  hotkey: string | null;
  command?: string | null;
}

interface ScoreEntryPayload {
  user: string;
  score: number;
  level: number;
  date: string;
  skillUsage?: SkillUsage[];
}

interface VerifyScorePayload {
  mode: ScoreMode;
  challengeKey: string;
  attemptToken?: string | null;
  clientUuid: string;
  entry: ScoreEntryPayload;
  replayProof: ReplayProof;
}

const CLASSIC_MODE: ScoreMode = "classic";
const DAILY_MODE: ScoreMode = "daily";
const CLASSIC_CHALLENGE_KEY = "classic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let payload: VerifyScorePayload;
  try {
    payload = await request.json() as VerifyScorePayload;
  } catch {
    return jsonResponse({ error: "INVALID_JSON" }, 400);
  }

  const parsed = validatePayload(payload);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400);
  }

  const replayResult = verifyReplayProof(parsed.payload.replayProof);
  if (!replayResult.ok) {
    const failure = {
      error: "REPLAY_VERIFICATION_FAILED",
      reason: replayResult.reason,
      actual: replayResult.actual,
      expected: {
        score: Math.trunc(parsed.payload.replayProof.finalScore),
        level: Math.trunc(parsed.payload.replayProof.finalLevel),
        time: Math.trunc(parsed.payload.replayProof.finalTime),
        difficulty: parsed.payload.replayProof.difficulty,
        inputCount: parsed.payload.replayProof.inputs.length,
      },
    };
    console.error("[verify-score] replay mismatch", {
      mode: parsed.payload.mode,
      challengeKey: parsed.payload.challengeKey,
      clientUuid: parsed.payload.clientUuid,
      failure,
    });
    return jsonResponse(failure, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "MISSING_SUPABASE_ENV" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const normalizedSkillUsage = normalizeSkillUsage(parsed.payload.entry.skillUsage);
  const normalizedScore = Math.trunc(parsed.payload.entry.score);
  const normalizedLevel = Math.trunc(parsed.payload.entry.level);

  let data: unknown = null;
  if (parsed.payload.mode === DAILY_MODE) {
    const dailyAttemptToken = parsed.payload.attemptToken ?? "";
    const { data: rpcData, error } = await admin.rpc("submit_daily_score", {
      p_client_uuid: parsed.payload.clientUuid,
      p_challenge_key: parsed.payload.challengeKey,
      p_attempt_token: dailyAttemptToken,
      p_player_name: parsed.payload.entry.user,
      p_score: normalizedScore,
      p_level: normalizedLevel,
      p_created_at: parsed.payload.entry.date,
      p_skill_usage: normalizedSkillUsage,
    });
    if (error) {
      const failure = {
        error: "RPC_SUBMIT_DAILY_SCORE_FAILED",
        detail: error.message,
        hint: error.hint ?? null,
        code: error.code ?? null,
      };
      console.error("[verify-score] submit_daily_score RPC failed", {
        challengeKey: parsed.payload.challengeKey,
        clientUuid: parsed.payload.clientUuid,
        failure,
      });
      return jsonResponse(failure, 400);
    }
    data = rpcData;
  } else {
    const { data: rpcData, error } = await admin.rpc("submit_global_score", {
      p_client_uuid: parsed.payload.clientUuid,
      p_player_name: parsed.payload.entry.user,
      p_score: normalizedScore,
      p_level: normalizedLevel,
      p_created_at: parsed.payload.entry.date,
      p_skill_usage: normalizedSkillUsage,
    });
    if (error) {
      const failure = {
        error: "RPC_SUBMIT_GLOBAL_SCORE_FAILED",
        detail: error.message,
        hint: error.hint ?? null,
        code: error.code ?? null,
      };
      console.error("[verify-score] submit_global_score RPC failed", {
        clientUuid: parsed.payload.clientUuid,
        failure,
      });
      return jsonResponse(failure, 400);
    }
    data = rpcData;
  }

  return jsonResponse(data ?? {});
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function validatePayload(
  payload: VerifyScorePayload,
): { ok: true; payload: VerifyScorePayload } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "INVALID_PAYLOAD" };
  }
  if (payload.mode !== CLASSIC_MODE && payload.mode !== DAILY_MODE) {
    return { ok: false, error: "INVALID_MODE" };
  }
  if (!isNonEmptyString(payload.clientUuid, 8, 80)) {
    return { ok: false, error: "INVALID_CLIENT_UUID" };
  }
  if (!payload.entry || typeof payload.entry !== "object") {
    return { ok: false, error: "INVALID_ENTRY" };
  }
  if (!isNonEmptyString(payload.entry.user, 1, 20)) {
    return { ok: false, error: "INVALID_PLAYER_NAME" };
  }
  if (!Number.isFinite(payload.entry.score) || payload.entry.score < 0) {
    return { ok: false, error: "INVALID_SCORE" };
  }
  if (!Number.isFinite(payload.entry.level) || payload.entry.level < 0) {
    return { ok: false, error: "INVALID_LEVEL" };
  }
  if (!isNonEmptyString(payload.entry.date, 1, 64)) {
    return { ok: false, error: "INVALID_CREATED_AT" };
  }
  if (!payload.replayProof || typeof payload.replayProof !== "object") {
    return { ok: false, error: "INVALID_REPLAY_PROOF" };
  }

  if (
    Math.trunc(payload.entry.score) !== Math.trunc(payload.replayProof.finalScore) ||
    Math.trunc(payload.entry.level) !== Math.trunc(payload.replayProof.finalLevel)
  ) {
    return { ok: false, error: "ENTRY_REPLAY_MISMATCH" };
  }

  if (payload.mode === CLASSIC_MODE) {
    if (payload.challengeKey !== CLASSIC_CHALLENGE_KEY) {
      return { ok: false, error: "INVALID_CHALLENGE_KEY" };
    }
  } else {
    if (!isDateKey(payload.challengeKey)) {
      return { ok: false, error: "INVALID_CHALLENGE_KEY" };
    }
    if (!isNonEmptyString(payload.attemptToken, 1, 256)) {
      return { ok: false, error: "INVALID_ATTEMPT_TOKEN" };
    }
  }

  return { ok: true, payload };
}

function isDateKey(value: unknown): boolean {
  return typeof value === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value.trim());
}

function isNonEmptyString(value: unknown, min: number, max: number): boolean {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function normalizeSkillUsage(raw: SkillUsage[] | undefined): SkillUsage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      name: String(entry.name ?? "").trim().slice(0, 20),
      hotkey: entry.hotkey ? String(entry.hotkey).trim().slice(0, 16) : null,
      command: entry.command ? String(entry.command).trim().slice(0, 120) : null,
    }))
    .filter((entry) => entry.name.length > 0)
    .slice(0, 20);
}
