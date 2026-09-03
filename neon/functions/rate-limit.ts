import { query, type DatabaseQuery } from "./db.js";

export const RATE_POLICIES = {
  enrollmentGlobal: { name: "enroll-global", limit: 120, windowSeconds: 60 },
  enrollmentInstallation: { name: "enroll-installation", limit: 3, windowSeconds: 600 },
  verifyScore: { name: "verify-score", limit: 10, windowSeconds: 60 },
  startDailyAttempt: { name: "start-daily-attempt", limit: 30, windowSeconds: 60 },
  forfeitDailyAttempt: { name: "forfeit-daily-attempt", limit: 30, windowSeconds: 60 },
  rollbackDailyAttempt: { name: "rollback-daily-attempt", limit: 30, windowSeconds: 60 },
  privateScores: { name: "private-scores", limit: 60, windowSeconds: 60 },
  privateStreak: { name: "private-streak", limit: 60, windowSeconds: 60 },
} as const;

export type RatePolicyName = keyof typeof RATE_POLICIES;
export interface RateLimitResult { allowed: boolean; retryAfter: number }

/**
 * Consume one PostgreSQL-backed fixed-window unit. The single upsert is atomic,
 * so concurrent Function instances cannot each admit the final unit.
 */
export async function consumeRateLimit(
  policyName: RatePolicyName,
  subjectKey: string,
  runQuery: DatabaseQuery = query,
): Promise<RateLimitResult> {
  const policy = RATE_POLICIES[policyName];
  const rows = await runQuery<{ request_count: number; retry_after: number }>(
    `WITH clock AS (
       SELECT clock_timestamp() AS now_at
     ), consumed AS (
       INSERT INTO public.server_rate_limit_buckets
         (policy, subject_key, bucket_start, request_count)
       SELECT $1, $2,
         to_timestamp(floor(extract(epoch FROM now_at) / $3) * $3), 1
       FROM clock
       ON CONFLICT (policy, subject_key, bucket_start)
       DO UPDATE SET request_count = public.server_rate_limit_buckets.request_count + 1
       RETURNING request_count, bucket_start
     )
     SELECT consumed.request_count,
       greatest(1, ceil(extract(epoch FROM
         (consumed.bucket_start + ($3 * interval '1 second')) - clock.now_at)))::int AS retry_after
     FROM consumed CROSS JOIN clock`,
    [policy.name, subjectKey, policy.windowSeconds],
  );
  const row = rows[0];
  if (!row) throw new Error("RATE_LIMIT_ACCOUNTING_FAILED");
  return { allowed: Number(row.request_count) <= policy.limit, retryAfter: Number(row.retry_after) };
}
