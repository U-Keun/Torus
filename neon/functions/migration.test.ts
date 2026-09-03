import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../migrations/0002_installation_credentials.sql", import.meta.url), "utf8");

describe("installation credential migration", () => {
  it("stores only fixed-size digests and scopes nonces to an installation", () => {
    expect(sql).toContain("client_uuid text not null unique");
    expect(sql).toContain("octet_length(secret_digest) = 32");
    expect(sql).toContain("primary key (installation_id, request_id)");
    expect(sql).toContain("on delete cascade");
    expect(sql).not.toMatch(/\bsecret\s+text\b/i);
  });

  it("explicitly revokes PUBLIC access to both server-only tables", () => {
    expect(sql).toContain("revoke all on table public.installation_credentials from public;");
    expect(sql).toContain("revoke all on table public.installation_request_nonces from public;");
  });
});

const rateSql = readFileSync(new URL("../migrations/0003_server_rate_limits.sql", import.meta.url), "utf8");

describe("server rate limit migration", () => {
  it("keeps buckets server-only with an indexed bounded cleanup function", () => {
    expect(rateSql).toContain("revoke all on table public.server_rate_limit_buckets from public;");
    expect(rateSql).toContain("revoke all on function public.cleanup_server_rate_limit_buckets() from public;");
    expect(rateSql).toContain("revoke all on function public.cleanup_installation_request_nonces() from public;");
    expect(rateSql).toContain("consumed_at < clock_timestamp() - interval '10 minutes'");
    expect(rateSql).toContain("idx_server_rate_limit_buckets_cleanup");
    expect(rateSql).toMatch(/limit 500/i);
    expect(rateSql).toContain("security invoker");
  });
});


const attemptHashSql = readFileSync(
  new URL("../migrations/0004_daily_attempt_token_hash.sql", import.meta.url),
  "utf8",
);

describe("Daily attempt token hash migration", () => {
  it("backfills a fixed-size SHA-256 digest and drops the plaintext column", () => {
    expect(attemptHashSql).toContain("add column active_attempt_token_hash bytea");
    expect(attemptHashSql).toContain("octet_length(active_attempt_token_hash) = 32");
    expect(attemptHashSql).toContain("digest(active_attempt_token, 'sha256')");
    expect(attemptHashSql).toContain("drop column active_attempt_token;");
  });

  it("does not reissue an active capability without a matching resume proof", () => {
    expect(attemptHashSql).toContain("v_active_attempt_token_hash = digest(v_attempt_token, 'sha256')");
    expect(attemptHashSql).toContain("'attemptToken', v_attempt_token");
    expect(attemptHashSql).toMatch(/'accepted', false,[\s\S]*?'attemptToken', null,[\s\S]*?'hasActiveAttempt', true/);
  });

  it("stores only the digest of each newly generated capability", () => {
    expect(attemptHashSql).toContain("v_active_attempt_token_hash := digest(v_new_attempt_token, 'sha256')");
    expect(attemptHashSql).toContain("active_attempt_token_hash = v_active_attempt_token_hash");
    expect(attemptHashSql).toContain("'attemptToken', v_new_attempt_token");
  });

  it("checks digests for all consuming RPCs and keeps them server-only", () => {
    expect(attemptHashSql.match(/digest\(v_attempt_token, 'sha256'\)/g)).toHaveLength(4);
    expect(attemptHashSql.match(/active_attempt_token_hash = null/g)).toHaveLength(4);
    expect(attemptHashSql).toContain("create or replace function public.submit_global_score(");
    const afterPlaintextDrop = attemptHashSql.split("alter table public.scores drop column active_attempt_token;")[1];
    expect(afterPlaintextDrop).not.toMatch(/\bactive_attempt_token\b/);
    expect(attemptHashSql).toContain(
      "revoke all on function public.start_daily_attempt(text, text, text, text) from public;",
    );
  });
});
