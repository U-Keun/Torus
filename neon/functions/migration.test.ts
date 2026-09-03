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
