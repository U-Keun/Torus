import { describe, expect, it } from "vitest";
import {
  MAX_REPLAY_INPUTS,
  normalizeReplayInputs,
  normalizeReplayProof,
} from "./replay-proof";

describe("normalizeReplayInputs", () => {
  it("filters invalid entries and out-of-order times", () => {
    expect(normalizeReplayInputs([
      { time: 2.9, move: "left" },
      { time: 1, move: "right" },
      { time: 3, move: "noop" },
      null,
      { time: 5.1, move: "up" },
    ])).toEqual([
      { time: 2, move: "left" },
      { time: 5, move: "up" },
    ]);
  });

  it("caps replay input count", () => {
    expect(normalizeReplayInputs([
      { time: 0, move: "left" },
      { time: 1, move: "right" },
      { time: 2, move: "up" },
    ], 2)).toEqual([
      { time: 0, move: "left" },
      { time: 1, move: "right" },
    ]);
  });
});

describe("normalizeReplayProof", () => {
  it("normalizes finite proof fields", () => {
    expect(normalizeReplayProof({
      version: 1,
      difficulty: 3,
      seed: -1,
      finalTime: 10.9,
      finalScore: 900.5,
      finalLevel: 2.2,
      inputs: [
        { time: 0, move: "down" },
      ],
    })).toEqual({
      version: 1,
      difficulty: 3,
      seed: 4_294_967_295,
      finalTime: 10,
      finalScore: 900,
      finalLevel: 2,
      inputs: [
        { time: 0, move: "down" },
      ],
    });
  });

  it("rejects unsupported proof shapes", () => {
    expect(normalizeReplayProof({ version: 2 })).toBeUndefined();
    expect(normalizeReplayProof({
      version: 1,
      difficulty: 4,
      seed: 1,
      finalTime: 1,
      finalScore: 0,
      finalLevel: 0,
      inputs: [],
    })).toBeUndefined();
    expect(normalizeReplayProof({
      version: 1,
      difficulty: 1,
      seed: Number.NaN,
      finalTime: 1,
      finalScore: 0,
      finalLevel: 0,
      inputs: [],
    })).toBeUndefined();
  });

  it("uses the shared maximum input cap by default", () => {
    const inputs = Array.from({ length: MAX_REPLAY_INPUTS + 1 }, (_, index) => ({
      time: index,
      move: "left",
    }));

    expect(normalizeReplayProof({
      version: 1,
      difficulty: 1,
      seed: 1,
      finalTime: MAX_REPLAY_INPUTS + 1,
      finalScore: 0,
      finalLevel: 0,
      inputs,
    })?.inputs).toHaveLength(MAX_REPLAY_INPUTS);
  });
});
