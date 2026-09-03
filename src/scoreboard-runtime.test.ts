import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriMocks);

import { createScoreboardStore } from "./scoreboard";

describe("scoreboard runtime selection", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, value); },
    };
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
    window.localStorage.clear();
    tauriMocks.invoke.mockReset();
    tauriMocks.isTauri.mockReset();
  });

  it("keeps browser scoreboards local", async () => {
    tauriMocks.isTauri.mockReturnValue(false);
    await createScoreboardStore().top();
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it("uses Tauri commands without a JavaScript API URL", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.invoke.mockResolvedValue([]);
    await createScoreboardStore().top(7);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("fetch_global_scores", { limit: 7 });
    expect(tauriMocks.invoke.mock.calls[0]?.[1]).not.toHaveProperty("apiBaseUrl");
  });

  it("keeps every remote command payload free of an API origin", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "fetch_global_scores" || command === "fetch_daily_scores") return [];
      if (command === "start_daily_attempt") return {
        accepted: true, resumed: false, attemptToken: "attempt", challengeKey: "2026-01-02",
        attemptsUsed: 1, attemptsLeft: 2, maxAttempts: 3, canSubmit: true, hasActiveAttempt: true,
      };
      if (command === "submit_daily_score") return {
        accepted: true, improved: true, challengeKey: "2026-01-02",
        attemptsUsed: 1, attemptsLeft: 2, maxAttempts: 3, canSubmit: true, hasActiveAttempt: false,
      };
      if (command === "forfeit_daily_attempt" || command === "rollback_daily_attempt") return {
        accepted: true, challengeKey: "2026-01-02", attemptsUsed: 1,
        attemptsLeft: 2, maxAttempts: 3, canSubmit: true, hasActiveAttempt: false,
      };
      if (command === "fetch_daily_status") return {
        challengeKey: "2026-01-02", attemptsUsed: 0, attemptsLeft: 3,
        maxAttempts: 3, canSubmit: true, hasActiveAttempt: false,
      };
      if (command === "fetch_daily_badge_status") return {
        currentStreak: 0, maxStreak: 0, highestBadgePower: null, highestBadgeDays: null,
        nextBadgePower: 1, nextBadgeDays: 3, daysToNextBadge: 3,
      };
      return undefined;
    });
    const store = createScoreboardStore();
    const entry = { user: "Ada", score: 1, level: 1, date: "2026-01-02", skillUsage: [] };
    const proof = {
      version: 1 as const, difficulty: 1 as const, seed: 1, finalTime: 1,
      finalScore: 1, finalLevel: 1, inputs: [],
    };

    await store.add(entry, proof);
    await store.topDaily("2026-01-02", 5);
    await store.startDailyAttempt("2026-01-02");
    await store.addDaily("2026-01-02", "attempt", entry, proof);
    await store.forfeitDailyAttempt("2026-01-02", "attempt");
    await store.rollbackDailyAttempt("2026-01-02", "attempt");
    await store.getDailyStatus("2026-01-02");
    await store.getDailyBadgeStatus("2026-01-02");

    const remoteCommands = tauriMocks.invoke.mock.calls.map(([command, payload]) => {
      expect(payload).not.toHaveProperty("apiBaseUrl");
      return command;
    });
    expect(remoteCommands).toEqual([
      "submit_global_score",
      "fetch_daily_scores",
      "start_daily_attempt",
      "submit_daily_score",
      "forfeit_daily_attempt",
      "rollback_daily_attempt",
      "fetch_daily_status",
      "fetch_daily_badge_status",
    ]);
  });
});
