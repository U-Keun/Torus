export type ReplayMove = "left" | "right" | "up" | "down";

export interface ReplayInputEvent {
  time: number;
  move: ReplayMove;
}

export interface DailyReplayProof {
  version: 1;
  difficulty: 1 | 2 | 3;
  seed: number;
  finalTime: number;
  finalScore: number;
  finalLevel: number;
  inputs: ReplayInputEvent[];
}

export const MAX_REPLAY_INPUTS = 20_000;

export function cloneReplayInputs(
  events: ReadonlyArray<ReplayInputEvent>,
): ReplayInputEvent[] {
  return events.map((event) => ({
    time: event.time,
    move: event.move,
  }));
}

export function normalizeReplayInputs(
  raw: unknown,
  maxInputs: number = MAX_REPLAY_INPUTS,
): ReplayInputEvent[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: ReplayInputEvent[] = [];
  let lastTime = -1;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const move = record.move;
    const time = record.time;
    if (!isReplayMove(move) || typeof time !== "number" || !Number.isFinite(time)) {
      continue;
    }
    const normalizedTime = Math.max(0, Math.trunc(time));
    if (normalizedTime < lastTime) {
      continue;
    }
    normalized.push({
      time: normalizedTime,
      move,
    });
    lastTime = normalizedTime;
    if (normalized.length >= maxInputs) {
      break;
    }
  }

  return normalized;
}

export function normalizeReplayProof(
  raw: unknown,
  maxInputs: number = MAX_REPLAY_INPUTS,
): DailyReplayProof | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const version = record.version;
  const difficulty = record.difficulty;
  const seed = record.seed;
  const finalTime = record.finalTime;
  const finalScore = record.finalScore;
  const finalLevel = record.finalLevel;
  if (version !== 1) {
    return undefined;
  }
  if (difficulty !== 1 && difficulty !== 2 && difficulty !== 3) {
    return undefined;
  }
  if (
    typeof seed !== "number" ||
    !Number.isFinite(seed) ||
    typeof finalTime !== "number" ||
    !Number.isFinite(finalTime) ||
    typeof finalScore !== "number" ||
    !Number.isFinite(finalScore) ||
    typeof finalLevel !== "number" ||
    !Number.isFinite(finalLevel)
  ) {
    return undefined;
  }

  return {
    version: 1,
    difficulty,
    seed: Math.trunc(seed) >>> 0,
    finalTime: Math.max(0, Math.trunc(finalTime)),
    finalScore: Math.max(0, Math.trunc(finalScore)),
    finalLevel: Math.max(0, Math.trunc(finalLevel)),
    inputs: normalizeReplayInputs(record.inputs, maxInputs),
  };
}

function isReplayMove(value: unknown): value is ReplayMove {
  return value === "left" || value === "right" || value === "up" || value === "down";
}
