import { afterEach, describe, expect, it, vi } from "vitest";
import replayFixtures from "../test-fixtures/replay-proofs.json";
import { TorusGame, type Difficulty, type GameSnapshot } from "./game";
import type { ReplayMove } from "./replay-proof";

type GoldenProof = {
  name: string;
  version: 1;
  difficulty: Difficulty;
  seed: number;
  finalTime: number;
  finalScore: number;
  finalLevel: number;
  inputs: Array<{ time: number; move: ReplayMove }>;
};

const proofs = replayFixtures.proofs as GoldenProof[];

function applyMove(game: TorusGame, move: ReplayMove): void {
  if (move === "left") game.moveLeft();
  else if (move === "right") game.moveRight();
  else if (move === "up") game.moveUp();
  else game.moveDown();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("golden replay parity", () => {
  it("has valid, extensible fixtures for every difficulty", () => {
    const difficulties = new Set(proofs.map((proof) => proof.difficulty));
    expect(difficulties.has(1)).toBe(true);
    expect(difficulties.has(2)).toBe(true);
    expect(difficulties.has(3)).toBe(true);
    expect(new Set(proofs.map((proof) => proof.name)).size).toBe(proofs.length);

    for (const proof of proofs) {
      expect(proof.version).toBe(1);
      expect(Number.isInteger(proof.seed)).toBe(true);
      expect(Number.isInteger(proof.finalTime)).toBe(true);
      expect(proof.inputs.length).toBeLessThanOrEqual(20_000);
      let previousTime = -1;
      for (const input of proof.inputs) {
        expect(Number.isInteger(input.time)).toBe(true);
        expect(input.time).toBeGreaterThanOrEqual(previousTime);
        expect(input.time).toBeLessThanOrEqual(proof.finalTime);
        expect(["left", "right", "up", "down"]).toContain(input.move);
        previousTime = input.time;
      }
    }
  });

  it("includes an explicit immediate Skill burst in semantic order", () => {
    const skillProof = proofs.find((proof) =>
      proof.name === "difficulty-1-same-timestamp-skill-burst",
    );
    expect(skillProof?.inputs.filter((input) => input.time === 35).map((input) => input.move))
      .toEqual(["right", "down", "up", "left"]);
  });

  it.each(proofs)("replays $name through TorusGame", (proof) => {
    vi.useFakeTimers();
    let latestSnapshot: GameSnapshot | undefined;
    const game = new TorusGame(
      (snapshot) => { latestSnapshot = snapshot; },
      () => undefined,
    );

    game.startNewGame(proof.difficulty, { randomSeed: proof.seed });
    let replayTime = 0;
    for (const input of proof.inputs) {
      vi.advanceTimersByTime((input.time - replayTime) * 100);
      applyMove(game, input.move);
      replayTime = input.time;
    }
    vi.advanceTimersByTime((proof.finalTime - replayTime) * 100);
    expect(latestSnapshot).toMatchObject({
      time: proof.finalTime,
      gameOn: true,
    });

    // Game over is detected at the start of the callback after the board fills.
    // That callback leaves the proof time unchanged, matching verifyReplayProof.
    vi.advanceTimersByTime(100);

    expect(latestSnapshot).toMatchObject({
      score: proof.finalScore,
      level: proof.finalLevel,
      time: proof.finalTime,
      gameOn: false,
    });
    game.destroy();
  });
});
