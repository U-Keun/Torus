import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  type DailyReplayProof,
  verifyDailyReplayProof,
} from "./simulator.ts";

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

interface VerifyDailyScorePayload {
  challengeKey: string;
  attemptToken: string;
  clientUuid: string;
  entry: ScoreEntryPayload;
  replayProof: DailyReplayProof;
}

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

  let payload: VerifyDailyScorePayload;
  try {
    payload = await request.json() as VerifyDailyScorePayload;
  } catch {
    return jsonResponse({ error: "INVALID_JSON" }, 400);
  }

  const parsed = validatePayload(payload);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400);
  }

  const replayResult = verifyDailyReplayProof(parsed.payload.replayProof);
  if (!replayResult.ok) {
    const failure = {
      error: "REPLAY_VERIFICATION_FAILED",
      reason: replayResult.reason,
      actual: replayResult.actual,
      expected: {
        score: Math.trunc(parsed.payload.replayProof.finalScore),
        level: Math.trunc(parsed.payload.replayProof.finalLevel),
        time: Math.trunc(parsed.payload.replayProof.finalTime),
        inputCount: parsed.payload.replayProof.inputs.length,
      },
    };
    console.error("[verify-daily-score] replay mismatch", failure);
    return jsonResponse(
      failure,
      400,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "MISSING_SUPABASE_ENV" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const rpcPayload = {
    p_client_uuid: parsed.payload.clientUuid,
    p_challenge_key: parsed.payload.challengeKey,
    p_attempt_token: parsed.payload.attemptToken,
    p_player_name: parsed.payload.entry.user,
    p_score: Math.trunc(parsed.payload.entry.score),
    p_level: Math.trunc(parsed.payload.entry.level),
    p_created_at: parsed.payload.entry.date,
    p_skill_usage: normalizeSkillUsage(parsed.payload.entry.skillUsage),
  };

  const { data, error } = await admin.rpc("submit_daily_score", rpcPayload);
  if (error) {
    const failure = {
      error: "RPC_SUBMIT_DAILY_SCORE_FAILED",
      detail: error.message,
      hint: error.hint ?? null,
      code: error.code ?? null,
    };
    console.error("[verify-daily-score] submit_daily_score RPC failed", {
      challengeKey: parsed.payload.challengeKey,
      clientUuid: parsed.payload.clientUuid,
      failure,
    });
    return jsonResponse(
      failure,
      400,
    );
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
  payload: VerifyDailyScorePayload,
): { ok: true; payload: VerifyDailyScorePayload } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "INVALID_PAYLOAD" };
  }
  if (!isDateKey(payload.challengeKey)) {
    return { ok: false, error: "INVALID_CHALLENGE_KEY" };
  }
  if (!isNonEmptyString(payload.attemptToken, 1, 256)) {
    return { ok: false, error: "INVALID_ATTEMPT_TOKEN" };
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
