export type Direction =
  | "left"
  | "right"
  | "up"
  | "down"
  | "autoHorizontal"
  | "autoHorizontalInverse";

export interface Skill {
  id: string;
  name: string;
  sequence: Direction[];
  hotkey: string | null;
  createdAt: string;
  updatedAt: string;
}

export const MAX_SKILL_NAME_LENGTH = 20;
export const MAX_SKILL_SEQUENCE_LENGTH = 40;
export const DEFAULT_SKILL_STEP_DELAY_MS = 110;
const MAX_SKILL_HOTKEY_CODE_LENGTH = 40;
const KEYBOARD_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

const TOKEN_TO_DIRECTION: Record<string, Direction> = {
  left: "left",
  l: "left",
  j: "left",
  right: "right",
  r: "right",
  "(": "autoHorizontal",
  ")": "autoHorizontalInverse",
  "@": "autoHorizontal",
  "#": "autoHorizontalInverse",
  up: "up",
  u: "up",
  i: "up",
  down: "down",
  d: "down",
  k: "down",
};

const CHAR_TO_DIRECTION: Record<string, Direction> = {
  L: "left",
  J: "left",
  R: "right",
  "(": "autoHorizontal",
  ")": "autoHorizontalInverse",
  "@": "autoHorizontal",
  "#": "autoHorizontalInverse",
  U: "up",
  I: "up",
  D: "down",
  K: "down",
  "\u2190": "left",
  "\u2192": "right",
  "\u2191": "up",
  "\u2193": "down",
};

export function parseDirectionSequence(raw: string): Direction[] {
  const input = raw.trim();
  if (input.length === 0) {
    throw new Error("Sequence is empty.");
  }

  const sequence: Direction[] = [];
  const tokens = input.split(/[\s,]+/).filter(Boolean);

  if (tokens.length > 1) {
    for (const token of tokens) {
      appendFromToken(token, sequence);
    }
  } else {
    appendFromToken(tokens[0], sequence);
  }

  if (sequence.length === 0) {
    throw new Error("No valid directions found.");
  }

  if (sequence.length > MAX_SKILL_SEQUENCE_LENGTH) {
    throw new Error(`Sequence is too long (max ${MAX_SKILL_SEQUENCE_LENGTH} steps).`);
  }

  return sequence;
}

export function directionSequenceToLabel(sequence: ReadonlyArray<Direction>): string {
  return sequence.map((direction) => directionToCode(direction)).join(" ");
}

export function normalizeSkillHotkeyInput(raw: string): string | null {
  const input = raw.trim();
  if (input.length === 0) {
    return null;
  }

  const upper = input.toUpperCase();

  if (/^[A-Z]$/.test(upper)) {
    return `Key${upper}`;
  }

  if (/^[0-9]$/.test(input)) {
    return `Digit${input}`;
  }

  if (/^F[0-9]{1,2}$/.test(upper)) {
    return upper;
  }

  if (/^KEY[A-Z]$/.test(upper)) {
    return `Key${upper.slice(3)}`;
  }

  if (/^DIGIT[0-9]$/.test(upper)) {
    return `Digit${upper.slice(5)}`;
  }

  if (!KEYBOARD_CODE_PATTERN.test(input)) {
    throw new Error("Press a keyboard key to set hotkey.");
  }

  const normalized = input.length > MAX_SKILL_HOTKEY_CODE_LENGTH
    ? input.slice(0, MAX_SKILL_HOTKEY_CODE_LENGTH)
    : input;
  return normalized;
}

export function skillHotkeyLabel(hotkey: string | null): string {
  if (!hotkey) {
    return "-";
  }

  if (hotkey.startsWith("Key")) {
    return hotkey.slice(3);
  }

  if (hotkey.startsWith("Digit")) {
    return hotkey.slice(5);
  }

  return hotkey;
}

function appendFromToken(token: string, sequence: Direction[]): void {
  const normalized = token.trim();
  if (normalized.length === 0) {
    return;
  }

  const lower = normalized.toLowerCase();
  const direct = TOKEN_TO_DIRECTION[lower];
  if (direct) {
    sequence.push(direct);
    return;
  }

  const compact = normalized.replace(/-/g, "");
  if (compact.length === 0) {
    throw new Error(`Invalid sequence token: "${token}"`);
  }

  for (const char of Array.from(compact)) {
    const mapped = CHAR_TO_DIRECTION[char.toUpperCase()] ?? CHAR_TO_DIRECTION[char];
    if (!mapped) {
      throw new Error(`Invalid sequence token: "${token}"`);
    }
    sequence.push(mapped);
    if (sequence.length > MAX_SKILL_SEQUENCE_LENGTH) {
      throw new Error(`Sequence is too long (max ${MAX_SKILL_SEQUENCE_LENGTH} steps).`);
    }
  }
}

function directionToCode(direction: Direction): string {
  if (direction === "left") {
    return "L";
  }
  if (direction === "right") {
    return "R";
  }
  if (direction === "autoHorizontal") {
    return "(";
  }
  if (direction === "autoHorizontalInverse") {
    return ")";
  }
  if (direction === "up") {
    return "U";
  }
  return "D";
}
