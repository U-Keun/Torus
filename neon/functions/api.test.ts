import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("./db.js", () => ({ query: queryMock }));

import app from "./api.js";

describe("Torus Neon compatibility API", () => {
  beforeEach(() => {
    queryMock.mockReset();
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
    queryMock.mockResolvedValueOnce([{ result: { accepted: true, attemptToken: "token" } }]);
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
    expect(queryMock).toHaveBeenCalledWith(
      "SELECT public.start_daily_attempt($1, $2, $3) AS result",
      ["device-12345678", "2026-01-02", "Ada"],
    );
  });

  it("rejects private attempt columns without an owner filter", async () => {
    const response = await app.request(
      "/rest/v1/scores?select=attempts_used,active_attempt_token&mode=eq.daily&challenge_key=eq.2026-01-02&limit=1",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_FILTER" });
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
});
