import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TorusGame,
  type GameOverPayload,
  type GameSnapshot,
  type PersistedGameState,
} from "./game";

function createGame(): {
  game: TorusGame;
  gameOvers: GameOverPayload[];
  snapshots: GameSnapshot[];
} {
  const snapshots: GameSnapshot[] = [];
  const gameOvers: GameOverPayload[] = [];
  const game = new TorusGame(
    (snapshot) => snapshots.push(snapshot),
    (payload) => gameOvers.push(payload),
  );
  return { game, gameOvers, snapshots };
}

function runSeededExport(seed: number, ticks: number): PersistedGameState {
  vi.useFakeTimers();
  const { game } = createGame();
  game.startNewGame(1, { randomSeed: seed });
  vi.advanceTimersByTime(ticks * 100);
  const state = game.exportState();
  game.destroy();
  return state;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TorusGame", () => {
  it("produces deterministic seeded runs", () => {
    expect(runSeededExport(12345, 25)).toEqual(runSeededExport(12345, 25));
  });

  it("round-trips paused persisted state", () => {
    vi.useFakeTimers();
    const first = createGame();
    first.game.startNewGame(2, { randomSeed: 99 });
    vi.advanceTimersByTime(800);
    first.game.moveRight();
    first.game.pause();

    const exported = first.game.exportState();
    const second = createGame();

    expect(second.game.importState(exported)).toBe(true);
    expect(second.game.exportState()).toEqual(exported);

    first.game.destroy();
    second.game.destroy();
  });

  it("rejects invalid persisted state", () => {
    const { game } = createGame();
    const invalid = {
      ...game.exportState(),
      numCols: 2,
    };

    expect(game.importState(invalid)).toBe(false);

    game.destroy();
  });

  it("ignores movement while paused", () => {
    const { game, gameOvers } = createGame();
    const before = game.exportState();

    game.moveLeft();
    game.moveRight();
    game.moveUp();
    game.moveDown();

    expect(game.exportState()).toEqual(before);
    expect(gameOvers).toEqual([]);

    game.destroy();
  });
});
