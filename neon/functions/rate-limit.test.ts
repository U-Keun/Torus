import { describe, expect, it, vi } from "vitest";
import type { DatabaseQuery } from "./db.js";

vi.mock("./db.js", () => ({ query: vi.fn() }));
import { consumeRateLimit, RATE_POLICIES } from "./rate-limit.js";

function countingQuery(): DatabaseQuery {
  let count = 0;
  return vi.fn(async () => [{ request_count: ++count, retry_after: 60 }]) as unknown as DatabaseQuery;
}

describe("PostgreSQL fixed-window rate limiter", () => {
  it("allows the exact limit and rejects limit plus one", async () => {
    const runQuery = countingQuery();
    for (let i = 0; i < RATE_POLICIES.verifyScore.limit; i++) {
      await expect(consumeRateLimit("verifyScore", "owner", runQuery))
        .resolves.toEqual({ allowed: true, retryAfter: 60 });
    }
    await expect(consumeRateLimit("verifyScore", "owner", runQuery))
      .resolves.toEqual({ allowed: false, retryAfter: 60 });
  });

  it("allows again when PostgreSQL returns the first count in a new bucket", async () => {
    const runQuery = vi.fn()
      .mockResolvedValueOnce([{ request_count: 11, retry_after: 1 }])
      .mockResolvedValueOnce([{ request_count: 1, retry_after: 60 }]) as unknown as DatabaseQuery;
    expect(await consumeRateLimit("verifyScore", "owner", runQuery)).toEqual({ allowed: false, retryAfter: 1 });
    expect(await consumeRateLimit("verifyScore", "owner", runQuery)).toEqual({ allowed: true, retryAfter: 60 });
  });

  it("uses one atomic upsert with a fixed policy and no client address", async () => {
    const mockQuery = vi.fn(async (_text: string, _values?: readonly unknown[]) => [{ request_count: 1, retry_after: 600 }]);
    const runQuery = mockQuery as unknown as DatabaseQuery;
    await consumeRateLimit("enrollmentInstallation", "installation-id", runQuery);
    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO public.server_rate_limit_buckets");
    expect(sql).toContain("ON CONFLICT (policy, subject_key, bucket_start)");
    expect(sql).toContain("DO UPDATE SET request_count");
    expect(sql).toContain("clock_timestamp()");
    expect(values).toEqual(["enroll-installation", "installation-id", 600]);
    expect(sql).not.toMatch(/x-forwarded-for|client_ip/i);
  });
});
