import { describe, expect, it } from "vitest";
import {
  MAX_SKILL_SEQUENCE_LENGTH,
  directionSequenceToLabel,
  normalizeSkillHotkeyInput,
  parseDirectionSequence,
  skillHotkeyLabel,
} from "./types";

describe("skill direction parsing", () => {
  it("parses spaced direction aliases", () => {
    expect(parseDirectionSequence("left right up down")).toEqual([
      "left",
      "right",
      "up",
      "down",
    ]);
  });

  it("parses compact commands and auto-horizontal markers", () => {
    const sequence = parseDirectionSequence("LRUD()");

    expect(sequence).toEqual([
      "left",
      "right",
      "up",
      "down",
      "autoHorizontal",
      "autoHorizontalInverse",
    ]);
    expect(directionSequenceToLabel(sequence)).toBe("L R U D ( )");
  });

  it("rejects invalid tokens", () => {
    expect(() => parseDirectionSequence("left nope")).toThrow(
      'Invalid sequence token: "nope"',
    );
  });

  it("rejects sequences beyond the maximum length", () => {
    expect(() => parseDirectionSequence("L".repeat(MAX_SKILL_SEQUENCE_LENGTH + 1)))
      .toThrow(`Sequence is too long (max ${MAX_SKILL_SEQUENCE_LENGTH} steps).`);
  });
});

describe("skill hotkeys", () => {
  it("normalizes common key labels to keyboard codes", () => {
    expect(normalizeSkillHotkeyInput("a")).toBe("KeyA");
    expect(normalizeSkillHotkeyInput("7")).toBe("Digit7");
    expect(normalizeSkillHotkeyInput("f12")).toBe("F12");
    expect(normalizeSkillHotkeyInput("keyq")).toBe("KeyQ");
    expect(normalizeSkillHotkeyInput("digit5")).toBe("Digit5");
  });

  it("formats hotkey labels for display", () => {
    expect(skillHotkeyLabel("KeyA")).toBe("A");
    expect(skillHotkeyLabel("Digit7")).toBe("7");
    expect(skillHotkeyLabel("F12")).toBe("F12");
    expect(skillHotkeyLabel(null)).toBe("-");
  });

  it("rejects non-keyboard-code text", () => {
    expect(() => normalizeSkillHotkeyInput("*")).toThrow(
      "Press a keyboard key to set hotkey.",
    );
  });
});
