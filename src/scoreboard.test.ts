import { describe, expect, it } from "vitest";
import { computeDailyBadgeStatus } from "./scoreboard";

function dailyKeys(start: string, count: number): string[] {
  const [year, month, day] = start.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const next = new Date(date.getTime() + index * 24 * 60 * 60 * 1000);
    return next.toISOString().slice(0, 10);
  });
}

describe("computeDailyBadgeStatus", () => {
  it("returns an empty streak status without accepted days", () => {
    expect(computeDailyBadgeStatus([], "2026-03-01")).toMatchObject({
      currentStreak: 0,
      maxStreak: 0,
      highestBadgePower: null,
      nextBadgePower: 0,
      daysToNextBadge: 1,
    });
  });

  it("resets the current streak after a gap while retaining max streak", () => {
    expect(computeDailyBadgeStatus([
      "2026-03-01",
      "2026-03-02",
      "2026-03-04",
    ], "2026-03-05")).toMatchObject({
      currentStreak: 1,
      maxStreak: 2,
      highestBadgePower: 1,
      nextBadgePower: 2,
      daysToNextBadge: 3,
    });
  });

  it("counts month and leap-day boundaries as consecutive", () => {
    expect(computeDailyBadgeStatus([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ], "2024-03-02")).toMatchObject({
      currentStreak: 3,
      maxStreak: 3,
      highestBadgePower: 1,
      daysToNextBadge: 1,
    });

    expect(computeDailyBadgeStatus([
      "2026-01-31",
      "2026-02-01",
    ], "2026-02-02")).toMatchObject({
      currentStreak: 2,
      maxStreak: 2,
    });
  });

  it("resolves badge thresholds from the max streak", () => {
    expect(computeDailyBadgeStatus(dailyKeys("2026-01-01", 8), "2026-01-08"))
      .toMatchObject({
        currentStreak: 8,
        maxStreak: 8,
        highestBadgePower: 3,
        highestBadgeDays: 8,
        nextBadgePower: 4,
        nextBadgeDays: 16,
        daysToNextBadge: 8,
      });
  });

  it("ignores impossible date keys", () => {
    expect(computeDailyBadgeStatus(["2026-02-31"], "2026-03-01"))
      .toMatchObject({
        currentStreak: 0,
        maxStreak: 0,
      });
  });
});
