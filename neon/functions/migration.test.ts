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
