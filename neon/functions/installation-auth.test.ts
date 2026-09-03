import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ query: vi.fn() }));

import {
  authenticateInstallation,
  decodeInstallationSecret,
  enrollInstallation,
  installationEnrollmentEnabled,
  installationSecretDigest,
  installationUnauthorizedResponse,
  parseInstallationAuthorization,
} from "./installation-auth.js";

const installationId = "123e4567-e89b-42d3-a456-426614174000";
const clientUuid = installationId;
const requestId = "223e4567-e89b-42d3-a456-426614174001";
const secret = Buffer.alloc(32, 7);
const encodedSecret = secret.toString("base64url");

beforeEach(() => {
  process.env.INSTALLATION_TOKEN_PEPPER = "test-only-pepper";
});

afterEach(() => {
  delete process.env.INSTALLATION_TOKEN_PEPPER;
  delete process.env.INSTALLATION_ENROLLMENT_ENABLED;
});

describe("installation credential primitives", () => {
  it("accepts only canonical 32-byte base64url secrets and versioned authorization", () => {
    expect(decodeInstallationSecret(encodedSecret)).toEqual(secret);
    expect(decodeInstallationSecret(`${encodedSecret}=`)).toBeNull();
    expect(decodeInstallationSecret(Buffer.alloc(31).toString("base64url"))).toBeNull();
    expect(parseInstallationAuthorization(
      `TorusInstall ti1.${installationId}.${encodedSecret}`,
    )).toEqual({ installationId, secret });
    expect(parseInstallationAuthorization(
      `Bearer ti1.${installationId}.${encodedSecret}`,
    )).toBeNull();
    expect(parseInstallationAuthorization(
      `TorusInstall ti2.${installationId}.${encodedSecret}`,
    )).toBeNull();
  });

  it("uses an HMAC-SHA256 digest with the required server pepper", () => {
    expect(installationSecretDigest(secret)).toEqual(
      createHmac("sha256", "test-only-pepper").update(secret).digest(),
    );
    delete process.env.INSTALLATION_TOKEN_PEPPER;
    expect(() => installationSecretDigest(secret)).toThrow("INSTALLATION_TOKEN_PEPPER");
  });

  it("keeps enrollment disabled unless the gate is explicitly true", () => {
    expect(installationEnrollmentEnabled()).toBe(false);
    process.env.INSTALLATION_ENROLLMENT_ENABLED = "TRUE";
    expect(installationEnrollmentEnabled()).toBe(false);
    process.env.INSTALLATION_ENROLLMENT_ENABLED = "true";
    expect(installationEnrollmentEnabled()).toBe(true);
  });

  it("makes identical enrollment idempotent and rejects a different secret", async () => {
    const digest = installationSecretDigest(secret);
    const existingQuery = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ installation_id: installationId, client_uuid: clientUuid, secret_digest: digest }]);
    await expect(enrollInstallation(installationId, secret, existingQuery))
      .resolves.toBe("existing");

    const conflictQuery = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        installation_id: installationId,
        client_uuid: clientUuid,
        secret_digest: installationSecretDigest(Buffer.alloc(32, 8)),
      }]);
    await expect(enrollInstallation(installationId, secret, conflictQuery))
      .resolves.toBe("conflict");
  });
});

describe("installation authentication", () => {
  function request(headers: Record<string, string>): Request {
    return new Request("https://example.test/state", { method: "POST", headers });
  }

  const authorization = `TorusInstall ti1.${installationId}.${encodedSecret}`;

  it("provides the single generic 401 response used by protected routes", async () => {
    const response = installationUnauthorizedResponse();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
  });

  it("returns one generic failure shape for malformed and incorrect credentials", async () => {
    const runQuery = vi.fn();
    await expect(authenticateInstallation(request({ authorization: "bad" }), { runQuery }))
      .resolves.toEqual({ ok: false });
    expect(runQuery).not.toHaveBeenCalled();

    runQuery.mockResolvedValueOnce([{
      client_uuid: clientUuid,
      secret_digest: installationSecretDigest(Buffer.alloc(32, 8)),
    }]);
    await expect(authenticateInstallation(request({ authorization }), { runQuery }))
      .resolves.toEqual({ ok: false });
  });

  it("validates mutation freshness and atomically consumes a request id", async () => {
    const now = new Date("2026-01-02T12:00:00.000Z");
    const runQuery = vi.fn()
      .mockResolvedValueOnce([{ client_uuid: clientUuid, secret_digest: installationSecretDigest(secret) }])
      .mockResolvedValueOnce([{ installation_id: installationId }]);
    await expect(authenticateInstallation(request({
      authorization,
      "x-torus-timestamp": String(now.getTime() / 1000),
      "x-torus-request-id": requestId,
    }), { mutation: true, now, runQuery })).resolves.toEqual({ ok: true, installationId, clientUuid });
    expect(runQuery.mock.calls[1][0]).toContain("ON CONFLICT (installation_id, request_id) DO NOTHING");
    expect(runQuery.mock.calls[1][1]).toEqual([installationId, requestId, now]);
  });

  it("rejects stale timestamps and replayed request ids", async () => {
    const now = new Date("2026-01-02T12:00:00.000Z");
    const staleQuery = vi.fn().mockResolvedValue([{
      client_uuid: clientUuid,
      secret_digest: installationSecretDigest(secret),
    }]);
    await expect(authenticateInstallation(request({
      authorization,
      "x-torus-timestamp": String(now.getTime() / 1000 - 301),
      "x-torus-request-id": requestId,
    }), { mutation: true, now, runQuery: staleQuery })).resolves.toEqual({ ok: false });
    expect(staleQuery).toHaveBeenCalledTimes(1);

    const replayQuery = vi.fn()
      .mockResolvedValueOnce([{ client_uuid: clientUuid, secret_digest: installationSecretDigest(secret) }])
      .mockResolvedValueOnce([]);
    await expect(authenticateInstallation(request({
      authorization,
      "x-torus-timestamp": String(now.getTime() / 1000),
      "x-torus-request-id": requestId,
    }), { mutation: true, now, runQuery: replayQuery })).resolves.toEqual({ ok: false });
  });
});
