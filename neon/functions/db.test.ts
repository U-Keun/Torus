import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@neon/functions", () => ({ attachDatabasePool: vi.fn() }));
vi.mock("pg", () => ({
  Pool: class MockPool {
    connect = mocks.connect;
    query = vi.fn();
  },
}));

process.env.DATABASE_URL = "postgres://test:test@example.test/test";
const { transaction } = await import("./db.js");

describe("database transactions", () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.release.mockReset();
    mocks.connect.mockReset();
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
  });

  it("rolls back a nonce and mutation together when the business RPC fails", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ installation_id: "id" }] }) // auth + nonce
      .mockRejectedValueOnce(new Error("RPC_FAILED")) // business RPC
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(transaction(async (runQuery) => {
      await runQuery("INSERT NONCE");
      await runQuery("SELECT RPC()");
    })).rejects.toThrow("RPC_FAILED");

    expect(mocks.clientQuery.mock.calls.map((call) => call[0])).toEqual([
      "BEGIN", "INSERT NONCE", "SELECT RPC()", "ROLLBACK",
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("commits successful work on the same checked-out client", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ result: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(transaction((runQuery) => runQuery("SELECT RPC()")))
      .resolves.toEqual([{ result: 1 }]);
    expect(mocks.clientQuery.mock.calls.map((call) => call[0])).toEqual([
      "BEGIN", "SELECT RPC()", "COMMIT",
    ]);
  });
});
