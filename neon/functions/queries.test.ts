import { describe, expect, it } from "vitest";
import { buildScoresQuery, buildStreakQuery } from "./queries.js";

describe("PostgREST compatibility queries", () => {
  it("binds score filters instead of interpolating them", () => {
    const query = buildScoresQuery(new URLSearchParams({
      select: "attempts_used,active_attempt_token",
      mode: "eq.daily",
      challenge_key: "eq.2026-01-02",
      client_uuid: "eq.owner-123456",
      limit: "1",
    }));
    expect(query.text).toContain("mode = $1");
    expect(query.text).toContain(
      "CASE WHEN active_attempt_token_hash IS NULL THEN NULL ELSE 'present' END AS active_attempt_token",
    );
    expect(query.text).not.toContain("owner-123456");
    expect(query.values).toEqual(["daily", "2026-01-02", "owner-123456", 1]);
  });

  it("accepts the client's quoted in filter as one array parameter", () => {
    const query = buildStreakQuery(new URLSearchParams({
      select: "client_uuid,max_streak",
      client_uuid: 'in.("owner-123456","owner-987654")',
      limit: "2048",
    }));
    expect(query.text).toContain("ANY($1::text[])");
    expect(query.values[0]).toEqual(["owner-123456", "owner-987654"]);
  });

  it("rejects non-allowlisted columns and sort expressions", () => {
    expect(() => buildScoresQuery(new URLSearchParams({ select: "client_uuid,password" })))
      .toThrow("INVALID_SELECT");
    expect(() => buildScoresQuery(new URLSearchParams({
      select: "score", order: "score.desc;drop table scores",
    }))).toThrow("INVALID_ORDER");
  });

  it("requires an owner filter before selecting private attempt state", () => {
    expect(() => buildScoresQuery(new URLSearchParams({
      select: "attempts_used,active_attempt_token",
      mode: "eq.daily",
      challenge_key: "eq.2026-01-02",
      limit: "1",
    }))).toThrow("INVALID_FILTER");
  });
});
