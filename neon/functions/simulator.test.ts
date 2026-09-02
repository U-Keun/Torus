import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ReplayProof, verifyReplayProof } from "./simulator.js";

type NamedReplayProof = ReplayProof & { name: string };

const fixtureUrl = new URL("../../test-fixtures/replay-proofs.json", import.meta.url);
const { proofs } = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
  proofs: NamedReplayProof[];
};

describe("golden replay parity", () => {
  it.each(proofs)("verifies $name with the replay simulator", (proof) => {
    expect(verifyReplayProof(proof)).toEqual({
      ok: true,
      reason: null,
      actual: {
        score: proof.finalScore,
        level: proof.finalLevel,
        time: proof.finalTime,
        gameOn: false,
      },
    });
  });

  it.each(proofs)("rejects $name when all recorded inputs are omitted", (proof) => {
    expect(verifyReplayProof({ ...proof, inputs: [] }).ok).toBe(false);
  });

  it("treats same-time Skill input order as semantic", () => {
    const proof = proofs.find((entry) =>
      entry.name === "difficulty-1-same-timestamp-skill-burst"
    );
    expect(proof).toBeDefined();
    const burst = proof!.inputs.filter((input) => input.time === 35).reverse();
    const remaining = proof!.inputs.filter((input) => input.time !== 35);

    expect(verifyReplayProof({ ...proof!, inputs: [...burst, ...remaining] }).ok).toBe(false);
  });
});
