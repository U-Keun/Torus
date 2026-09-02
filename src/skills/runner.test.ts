import { describe, expect, it } from "vitest";
import { SkillRunner, type SkillRunnerState } from "./runner";
import type { Direction } from "./types";

describe("SkillRunner", () => {
  it("dispatches every skill move immediately in order", () => {
    const moves: Direction[] = [];
    const states: SkillRunnerState[] = [];
    const runner = new SkillRunner(
      (direction) => moves.push(direction),
      { onStateChange: (state) => states.push(state) },
    );

    const started = runner.runSkill({
      name: "Dash",
      sequence: ["left", "right", "up", "down"],
    });

    expect(started).toBe(true);
    expect(moves).toEqual(["left", "right", "up", "down"]);
    expect(runner.getState()).toMatchObject({
      isSkillRunning: false,
      isProcessing: false,
      activeSkillName: null,
      remainingSkillMoves: 0,
      queuedManualMoves: 0,
    });
    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({
      isSkillRunning: true,
      isProcessing: true,
      activeSkillName: "Dash",
      remainingSkillMoves: 4,
    });
    expect(states[1]).toMatchObject({
      isSkillRunning: false,
      isProcessing: false,
      activeSkillName: null,
      remainingSkillMoves: 0,
    });
  });

  it("dispatches manual moves immediately", () => {
    const moves: Direction[] = [];
    const runner = new SkillRunner((direction) => moves.push(direction));

    runner.enqueueManualMove("autoHorizontal");

    expect(moves).toEqual(["autoHorizontal"]);
    expect(runner.getState().queuedManualMoves).toBe(0);
  });

  it("rejects empty skills", () => {
    const moves: Direction[] = [];
    const runner = new SkillRunner((direction) => moves.push(direction));

    expect(runner.runSkill({ name: "Empty", sequence: [] })).toBe(false);
    expect(moves).toEqual([]);
  });
});
