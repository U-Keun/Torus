import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, transactionMock, replayMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  transactionMock: vi.fn(),
  replayMock: vi.fn(),
}));

vi.mock("./db.js", () => ({ query: queryMock, transaction: transactionMock }));
vi.mock("./simulator.js", () => ({ verifyReplayProof: replayMock }));

import app from "./api.js";

const installationId = "123e4567-e89b-42d3-a456-426614174000";
const otherOwner = "323e4567-e89b-42d3-a456-426614174002";
const requestId = "223e4567-e89b-42d3-a456-426614174001";
const secret = Buffer.alloc(32, 7);
const authorization = `TorusInstall ti1.${installationId}.${secret.toString("base64url")}`;

function credentialRow(owner = installationId, storedSecret = secret) {
  return {
    client_uuid: owner,
    secret_digest: createHmac("sha256", "test-only-pepper").update(storedSecret).digest(),
  };
}

function mutationHeaders(overrides: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    authorization,
    "x-torus-timestamp": String(Math.trunc(Date.now() / 1000)),
    "x-torus-request-id": requestId,
    ...overrides,
  };
}

describe("Torus Neon compatibility API", () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (work) => work(queryMock));
    replayMock.mockReset();
    replayMock.mockReturnValue({ ok: true, reason: null, actual: {
      score: 0, level: 0, time: 0, gameOn: false,
    } });
    delete process.env.INSTALLATION_ENROLLMENT_ENABLED;
    delete process.env.INSTALLATION_AUTH_ENFORCED;
    delete process.env.INSTALLATION_TOKEN_PEPPER;
  });

  it("hides installation enrollment while the rollout gate is disabled", async () => {
    const response = await app.request("/v1/installations/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        installationId: "123e4567-e89b-42d3-a456-426614174000",
        secret: Buffer.alloc(32, 7).toString("base64url"),
      }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("creates an installation enrollment without returning its secret", async () => {
    process.env.INSTALLATION_ENROLLMENT_ENABLED = "true";
    process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
    const installationId = "123e4567-e89b-42d3-a456-426614174000";
    queryMock
      .mockResolvedValueOnce([]) // advisory lock
      .mockImplementationOnce(async (_text: string, values: unknown[]) => [
        { secret_digest: values[2] },
      ]);
    const response = await app.request("/v1/installations/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        installationId,
        secret: Buffer.alloc(32, 7).toString("base64url"),
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ installationId, enrolled: true });
    expect(queryMock.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
    expect(queryMock.mock.calls[0][1]).toEqual([installationId]);
    expect(queryMock.mock.calls[1][0]).toContain("ON CONFLICT DO NOTHING");
    expect(queryMock.mock.calls[1][1]).toEqual([
      installationId,
      installationId,
      expect.any(Buffer),
    ]);
  });

  it("returns 409 when an installation id is enrolled with a different secret", async () => {
    process.env.INSTALLATION_ENROLLMENT_ENABLED = "true";
    process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
    queryMock
      .mockResolvedValueOnce([]) // advisory lock
      .mockResolvedValueOnce([]) // insert conflict
      .mockResolvedValueOnce([{
        installation_id: installationId,
        client_uuid: installationId,
        secret_digest: Buffer.alloc(32, 1),
      }]);
    const response = await app.request("/v1/installations/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        installationId: "123e4567-e89b-42d3-a456-426614174000",
        secret: Buffer.alloc(32, 7).toString("base64url"),
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "INSTALLATION_CONFLICT" });
  });

  it("reports database-backed health", async () => {
    queryMock.mockResolvedValueOnce([{ ok: 1 }]);
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(queryMock).toHaveBeenCalledWith("SELECT 1 AS ok");
  });

  it("returns allowlisted score rows with compatibility CORS headers", async () => {
    queryMock.mockResolvedValueOnce([{ player_name: "Ada", score: 42, level: 3 }]);
    const response = await app.request(
      "/rest/v1/scores?select=player_name,score,level&mode=eq.classic&challenge_key=eq.classic&order=score.desc,level.desc,created_at.desc&limit=10",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual([{ player_name: "Ada", score: 42, level: 3 }]);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("FROM public.scores"),
      ["classic", "classic", 10],
    );
  });

  it("maps the daily start route to the fixed SQL function signature", async () => {
    queryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ result: { accepted: true, attemptToken: "token" } }]);
    const response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        p_client_uuid: "device-12345678",
        p_challenge_key: "2026-01-02",
        p_player_name: "Ada",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, attemptToken: "token" });
    expect(queryMock).toHaveBeenNthCalledWith(
      3,
      "SELECT public.start_daily_attempt($1, $2, $3) AS result",
      ["device-12345678", "2026-01-02", "Ada"],
    );
  });

  it("rejects private attempt columns without an owner filter", async () => {
    const response = await app.request(
      "/rest/v1/scores?select=attempts_used,active_attempt_token&mode=eq.daily&challenge_key=eq.2026-01-02&limit=1",
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects score metadata that does not match the replay proof", async () => {
    const response = await app.request("/functions/v1/verify-score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "classic",
        challengeKey: "classic",
        clientUuid: "device-12345678",
        entry: { user: "Ada", score: 10, level: 1, date: "2026-01-02T00:00:00Z" },
        replayProof: {
          version: 1,
          seed: 1,
          difficulty: 1,
          inputs: [],
          finalScore: 9,
          finalLevel: 1,
          finalTime: 0,
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ENTRY_REPLAY_MISMATCH" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects unknown routes without touching the database", async () => {
    const response = await app.request("/unknown");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("keeps headerless legacy mutations working while enforcement is disabled", async () => {
    queryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ result: { accepted: true } }]);
    const response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        p_client_uuid: "legacy-device-1234",
        p_challenge_key: "2026-01-02",
        p_player_name: "Ada",
      }),
    });
    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(queryMock).toHaveBeenNthCalledWith(3, expect.stringContaining("start_daily_attempt"), [
      "legacy-device-1234", "2026-01-02", "Ada",
    ]);
  });

  it("keeps headerless legacy private status reads working before enforcement", async () => {
    queryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ attempts_used: 1, active_attempt_token: "present" }]);
    const response = await app.request(
      "/rest/v1/scores?select=attempts_used,active_attempt_token&client_uuid=eq.legacy-device-1234&limit=1",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { attempts_used: 1, active_attempt_token: "present" },
    ]);
    expect(queryMock.mock.calls[2][1]).toEqual(["legacy-device-1234", 1]);
  });

  it("never permits a headerless request for an enrolled owner", async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ exists: true }]);
    const response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        p_client_uuid: installationId,
        p_challenge_key: "2026-01-02",
        p_player_name: "Ada",
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
    expect(transactionMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing credentials in enforced mode", undefined],
    ["malformed credentials", "bad"],
  ])("returns the same 401 for %s", async (_name, suppliedAuthorization) => {
    process.env.INSTALLATION_AUTH_ENFORCED = "true";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (suppliedAuthorization) headers.authorization = suppliedAuthorization;
    const response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST", headers,
      body: JSON.stringify({
        p_client_uuid: installationId,
        p_challenge_key: "2026-01-02",
        p_player_name: "Ada",
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
  });

  it("rejects wrong credentials, stale timestamps, and duplicate nonces uniformly", async () => {
    process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
    const body = JSON.stringify({
      p_client_uuid: installationId,
      p_challenge_key: "2026-01-02",
      p_player_name: "Ada",
    });

    queryMock.mockResolvedValueOnce([credentialRow(installationId, Buffer.alloc(32, 8))]);
    let response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST", headers: mutationHeaders(), body,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce([credentialRow()]);
    response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST",
      headers: mutationHeaders({ "x-torus-timestamp": String(Math.trunc(Date.now() / 1000) - 301) }),
      body,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(queryMock).toHaveBeenCalledTimes(1);

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce([credentialRow()]).mockResolvedValueOnce([]);
    response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST", headers: mutationHeaders(), body,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
  });

  it("uses the authenticated owner and one transaction query runner for a mutation", async () => {
    process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
    queryMock
      .mockResolvedValueOnce([credentialRow()]) // preflight credential
      .mockResolvedValueOnce([{ available: true }])
      .mockResolvedValueOnce([credentialRow()]) // transaction credential
      .mockResolvedValueOnce([{ installation_id: installationId }])
      .mockResolvedValueOnce([{ result: { accepted: true } }]);
    const response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST", headers: mutationHeaders(),
      body: JSON.stringify({
        p_client_uuid: installationId,
        p_challenge_key: "2026-01-02",
        p_player_name: "Ada",
      }),
    });
    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[4][1]).toEqual([installationId, "2026-01-02", "Ada"]);
  });

  it("rejects a cross-owner mutation with the generic 401 and never invokes its RPC", async () => {
    process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
    queryMock
      .mockResolvedValueOnce([credentialRow()])
      .mockResolvedValueOnce([{ available: true }])
      .mockResolvedValueOnce([credentialRow()])
      .mockResolvedValueOnce([{ installation_id: installationId }]);
    const response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST", headers: mutationHeaders(),
      body: JSON.stringify({
        p_client_uuid: otherOwner,
        p_challenge_key: "2026-01-02",
        p_player_name: "Ada",
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it("authenticates private score status reads and forces the exact owner", async () => {
    process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
    queryMock
      .mockResolvedValueOnce([credentialRow()])
      .mockResolvedValueOnce([{ attempts_used: 1, active_attempt_token: "present" }]);
    const response = await app.request(
      `/rest/v1/scores?select=attempts_used,active_attempt_token&client_uuid=eq.${installationId}&limit=1`,
      { headers: { authorization } },
    );
    expect(response.status).toBe(200);
    expect(queryMock.mock.calls[1][1]).toEqual([installationId, 1]);
  });

  it("rejects cross-owner private reads and authenticated exact-owner streak reads", async () => {
    process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
    queryMock.mockResolvedValueOnce([credentialRow()]);
    let response = await app.request(
      `/rest/v1/scores?select=attempts_used&client_uuid=eq.${otherOwner}&limit=1`,
      { headers: { authorization } },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce([credentialRow()]);
    response = await app.request(
      `/rest/v1/daily_streak_states?select=current_streak,max_streak&client_uuid=eq.${otherOwner}&limit=1`,
      { headers: { authorization } },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
  });

  it("keeps the daily streak leaderboard lookup anonymous", async () => {
    queryMock.mockResolvedValueOnce([{ client_uuid: installationId, max_streak: 3 }]);
    const response = await app.request(
      `/rest/v1/daily_streak_states?select=client_uuid,max_streak&client_uuid=in.(%22${installationId}%22)&limit=1`,
    );
    expect(response.status).toBe(200);
    expect(transactionMock).not.toHaveBeenCalled();
  });


  it("rejects a headerless enrolled owner before replay simulation", async () => {
    queryMock.mockResolvedValueOnce([{ exists: true }]);
    const response = await app.request("/functions/v1/verify-score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "classic",
        challengeKey: "classic",
        clientUuid: installationId,
        entry: { user: "Ada", score: 0, level: 0, date: "2026-01-02T00:00:00Z" },
        replayProof: {
          version: 1, seed: 1, difficulty: 1, inputs: [],
          finalScore: 0, finalLevel: 0, finalTime: 0,
        },
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(replayMock).not.toHaveBeenCalled();
  });

  it("rejects verify-score authentication before replay simulation", async () => {
    process.env.INSTALLATION_AUTH_ENFORCED = "true";
    const response = await app.request("/functions/v1/verify-score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "classic",
        challengeKey: "classic",
        clientUuid: installationId,
        entry: { user: "Ada", score: 0, level: 0, date: "2026-01-02T00:00:00Z" },
        replayProof: {
          version: 1, seed: 1, difficulty: 1, inputs: [],
          finalScore: 0, finalLevel: 0, finalTime: 0,
        },
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(replayMock).not.toHaveBeenCalled();
  });

  it("rechecks verify-score auth and consumes its nonce with the score RPC", async () => {
    process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
    queryMock
      .mockResolvedValueOnce([credentialRow()]) // pre-replay credential check
      .mockResolvedValueOnce([{ available: true }]) // nonce preflight
      .mockResolvedValueOnce([credentialRow()]) // transaction credential recheck
      .mockResolvedValueOnce([{ installation_id: installationId }])
      .mockResolvedValueOnce([{ result: { accepted: true } }]);
    const response = await app.request("/functions/v1/verify-score", {
      method: "POST", headers: mutationHeaders(),
      body: JSON.stringify({
        mode: "classic",
        challengeKey: "classic",
        clientUuid: installationId,
        entry: { user: "Ada", score: 0, level: 0, date: "2026-01-02T00:00:00Z" },
        replayProof: {
          version: 1, seed: 1, difficulty: 1, inputs: [],
          finalScore: 0, finalLevel: 0, finalTime: 0,
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(replayMock).toHaveBeenCalledOnce();
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls[4][0]).toContain("submit_global_score");
    expect(queryMock.mock.calls[4][1][0]).toBe(installationId);
  });


  it("serializes a legacy mutation lock, credential check, and RPC in order", async () => {
    queryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ result: { accepted: true } }]);
    const response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        p_client_uuid: "legacy-device-1234",
        p_challenge_key: "2026-01-02",
        p_player_name: "Ada",
      }),
    });
    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("installation_credentials"),
      expect.stringContaining("start_daily_attempt"),
    ]);
    expect(queryMock.mock.calls[0][1]).toEqual(["legacy-device-1234"]);
    expect(queryMock.mock.calls[1][1]).toEqual(["legacy-device-1234"]);
  });

  it("allows only the exact streak leaderboard shape to remain anonymous", async () => {
    let response = await app.request(
      "/rest/v1/daily_streak_states?select=current_streak,last_submission_key,updated_at&limit=10",
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(queryMock).not.toHaveBeenCalled();

    response = await app.request(
      `/rest/v1/daily_streak_states?select=client_uuid,current_streak&client_uuid=in.(%22${installationId}%22)&limit=10`,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("runs a headerless exact-owner streak detail read under the legacy owner lock", async () => {
    queryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ current_streak: 2, max_streak: 4 }]);
    const response = await app.request(
      "/rest/v1/daily_streak_states?select=current_streak,max_streak&client_uuid=eq.legacy-device-1234&limit=1",
    );
    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
    expect(queryMock.mock.calls[1][0]).toContain("installation_credentials");
    expect(queryMock.mock.calls[2][0]).toContain("daily_streak_states");
  });

  it.each([
    ["missing auth", {}, []],
    ["malformed auth", { authorization: "bad" }, []],
    ["stale timestamp", mutationHeaders({
      "x-torus-timestamp": String(Math.trunc(Date.now() / 1000) - 301),
    }), [[credentialRow()]]],
    ["replayed nonce", mutationHeaders(), [[credentialRow()], [{ available: false }]]],
  ])("returns 401 for %s before parsing an invalid mutation body", async (_name, headers, rows) => {
    process.env.INSTALLATION_AUTH_ENFORCED = "true";
    process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
    for (const result of rows as unknown[][]) queryMock.mockResolvedValueOnce(result);
    const response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers as Record<string, string>) },
      body: "{",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
  });

  it("preflights nonce availability without consuming it before validation", async () => {
    process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
    queryMock
      .mockResolvedValueOnce([credentialRow()])
      .mockResolvedValueOnce([{ available: true }]);
    const response = await app.request("/rest/v1/rpc/start_daily_attempt", {
      method: "POST", headers: mutationHeaders(), body: "{",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_JSON" });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1][0]).toContain("SELECT NOT EXISTS");
    expect(queryMock.mock.calls[1][0]).not.toContain("INSERT INTO");
    expect(transactionMock).not.toHaveBeenCalled();
  });

});
