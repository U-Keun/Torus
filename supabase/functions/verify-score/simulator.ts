export type ReplayMove = "left" | "right" | "up" | "down";

export interface ReplayInputEvent {
  time: number;
  move: ReplayMove;
}

export interface ReplayProof {
  version: 1;
  difficulty: 1 | 2 | 3;
  seed: number;
  finalTime: number;
  finalScore: number;
  finalLevel: number;
  inputs: ReplayInputEvent[];
}

interface TorusCell {
  color: number;
  angle: number;
}

type PoleEntry = TorusCell | "pole" | null;

interface SimulationState {
  score: number;
  level: number;
  time: number;
  gameOn: boolean;
}

export interface ReplayVerificationResult {
  ok: boolean;
  reason: string | null;
  actual: {
    score: number;
    level: number;
    time: number;
    gameOn: boolean;
  };
}

const MAX_COLS = 128;
const MAX_REPLAY_INPUTS = 20_000;
const MAX_REPLAY_FINAL_TIME = 2_000_000;

class ReplaySimulator {
  private readonly gaugeTime = 20;
  private readonly flyingTorusSpeedFactor = 1;
  private readonly boxHeight = 20;
  private readonly scorePerTorus = 300;
  private readonly waitingTime = 10;
  private readonly levelUpTime = 5;
  private readonly numColors = 5;

  private numCols = 3;
  private poleHeight = 3;
  private polePos = 0;

  private box: (TorusCell | null)[][] = [];
  private pole: PoleEntry[][] = [];
  private flyingTori: (number | null)[] = [];
  private flyingToriHeight: number[] = [];
  private flyingToriWaiting: number[] = [];
  private numTori: number[] = [];

  private numToriInPole = 0;
  private score = 0;
  private level = 0;
  private levelGauge = 0;
  private time = 0;
  private gameOn = true;
  private randomSeedState = 0;
  private gameOverSnapshot: SimulationState | null = null;
  private difficulty: 1 | 2 | 3 = 1;

  public constructor(seed: number, difficulty: number) {
    this.randomSeedState = seed >>> 0;
    this.difficulty = difficulty === 2 || difficulty === 3 ? difficulty : 1;
    this.resetState();
    this.gameOn = true;
  }

  public getState(): SimulationState {
    return {
      score: this.score,
      level: this.level,
      time: this.time,
      gameOn: this.gameOn,
    };
  }

  public stepUntil(targetTime: number): void {
    while (this.gameOn && this.time < targetTime) {
      this.update();
    }
  }

  public finalizeAtCurrentTime(): void {
    if (!this.gameOn) {
      return;
    }
    if (this.hasOverflowColumn()) {
      this.setGameOver();
    }
  }

  public stepOneTickAndCaptureGameOverSnapshot(): SimulationState | null {
    this.gameOverSnapshot = null;
    this.update();
    if (!this.gameOverSnapshot) {
      return null;
    }
    return {
      score: this.gameOverSnapshot.score,
      level: this.gameOverSnapshot.level,
      time: this.gameOverSnapshot.time,
      gameOn: this.gameOverSnapshot.gameOn,
    };
  }

  public applyMove(move: ReplayMove): void {
    if (!this.gameOn) {
      return;
    }
    if (move === "left") {
      this.movePoleLeft();
      return;
    }
    if (move === "right") {
      this.movePoleRight();
      return;
    }
    if (move === "up") {
      if (this.getNumTori(this.polePos) < this.boxHeight && this.numToriInPole > 0) {
        this.boxInsertFromPole();
        this.poleDeleteTop();
        this.meltSameRows();
      }
      return;
    }
    if (this.getNumTori(this.polePos) > 0 && this.numToriInPole < this.poleHeight) {
      this.poleInsert();
      this.removeBottom(this.polePos);
      this.meltSameRows();
    }
  }

  private resetState(): void {
    this.numCols = 3;
    this.poleHeight = this.numCols;
    this.polePos = 0;

    this.box = this.make2d<TorusCell | null>(this.boxHeight, this.numCols, null);
    this.pole = this.make2d<PoleEntry>(this.poleHeight, this.numCols, null);

    this.flyingTori = Array.from({ length: this.numCols }, () => null);
    this.flyingToriHeight = Array.from({ length: this.numCols }, () => 0);
    this.flyingToriWaiting = Array.from({ length: this.numCols }, () => 0);
    this.numTori = Array.from({ length: this.numCols }, () => 0);

    this.numToriInPole = 0;
    this.score = 0;
    this.level = 0;
    this.levelGauge = 0;
    this.time = 0;
    this.initPole(0);
  }

  private make2d<T>(rows: number, cols: number, fill: T): T[][] {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
  }

  private cloneTorus(torus: TorusCell | null): TorusCell | null {
    return torus ? { ...torus } : null;
  }

  private clonePoleEntry(entry: PoleEntry): PoleEntry {
    if (entry === null || entry === "pole") {
      return entry;
    }
    return { ...entry };
  }

  private nextSeededRandom(): number {
    this.randomSeedState = (this.randomSeedState + 0x6d2b79f5) >>> 0;
    let value = Math.imul(
      this.randomSeedState ^ (this.randomSeedState >>> 15),
      1 | this.randomSeedState,
    );
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  private randomTorus(): number {
    return Math.floor(this.nextSeededRandom() * this.numColors);
  }

  private update(): void {
    if (this.hasOverflowColumn()) {
      this.setGameOver();
    }

    if (!this.gameOn) {
      return;
    }

    this.deleteMeltedTori();
    this.updateFlyingTori();
    this.meltSameRows();
    this.increaseTime();

    if (this.levelGauge === this.levelUpTime * this.numCols) {
      this.increaseLevel();
      this.levelGauge = 0;
    }
  }

  private updateFlyingTori(): void {
    for (let col = 0; col < this.numCols; col += 1) {
      this.updateFlyingTorus(col);
    }
  }

  private updateFlyingTorus(col: number): void {
    const flying = this.flyingTori[col];
    if (flying !== null) {
      if (this.time % this.flyingTorusSpeedFactor === 0) {
        if (this.flyingToriHeight[col] > 2 + this.getNumTori(col)) {
          this.flyingToriHeight[col] -= 1;
        } else {
          this.insertFlyingTorus(col, flying);
          this.flyingTori[col] = null;
        }
      }
      return;
    }

    if (this.flyingToriWaiting[col] === this.waitingTime) {
      this.flyingTori[col] = this.randomTorus();
      this.flyingToriHeight[col] = this.boxHeight;
      this.flyingToriWaiting[col] = 0;
    } else {
      this.flyingToriWaiting[col] += 1;
    }
  }

  private insertFlyingTorus(col: number, color: number): void {
    const targetRow = this.boxHeight - this.getNumTori(col) - 1;
    if (targetRow < 0) {
      this.setGameOver();
      return;
    }
    const angle = (3 + this.flyingToriHeight[col]) % 4 < 2 ? 4 : 1;
    this.boxSetRaw(targetRow, col, { color, angle });
    this.increaseNumTori(col);
  }

  private initPole(pos: number): void {
    this.polePos = pos;
    for (let row = 0; row < this.poleHeight; row += 1) {
      for (let col = 0; col < this.numCols; col += 1) {
        this.poleSetRaw(row, col, col === pos ? "pole" : null);
      }
    }
  }

  private movePoleLeft(): void {
    if (this.polePos <= 0) {
      return;
    }
    const oldPos = this.polePos;
    const newPos = this.polePos - 1;
    for (let row = 0; row < this.poleHeight; row += 1) {
      this.poleSetRaw(row, newPos, this.poleGetRaw(row, oldPos));
      this.poleSetRaw(row, oldPos, null);
    }
    this.polePos = newPos;
  }

  private movePoleRight(): void {
    if (this.polePos >= this.numCols - 1) {
      return;
    }
    const oldPos = this.polePos;
    const newPos = this.polePos + 1;
    for (let row = 0; row < this.poleHeight; row += 1) {
      this.poleSetRaw(row, newPos, this.poleGetRaw(row, oldPos));
      this.poleSetRaw(row, oldPos, null);
    }
    this.polePos = newPos;
  }

  private boxSetRaw(row: number, col: number, value: TorusCell | null): void {
    this.box[row][col] = this.cloneTorus(value);
  }

  private boxGetRaw(row: number, col: number): TorusCell | null {
    return this.box[row][col];
  }

  private poleSetRaw(row: number, col: number, value: PoleEntry): void {
    this.pole[row][col] = this.clonePoleEntry(value);
  }

  private poleGetRaw(row: number, col: number): PoleEntry {
    return this.pole[row][col];
  }

  private isMeltedTorus(torus: TorusCell): boolean {
    return torus.angle === -1;
  }

  private boxGetEntry(row: number, col: number): number | null {
    const raw = this.boxGetRaw(row, col);
    if (raw === null) {
      return null;
    }
    if (this.isMeltedTorus(raw)) {
      return null;
    }
    return raw.color;
  }

  private isTorusCell(value: PoleEntry | TorusCell | null): value is TorusCell {
    return typeof value === "object" && value !== null;
  }

  private torusFlipped(torus: TorusCell | null): TorusCell | null {
    if (!torus) {
      return null;
    }
    return {
      color: torus.color,
      angle: (torus.angle + 3) % 6,
    };
  }

  private torusRotatedRight(torus: TorusCell | null): TorusCell | null {
    if (!torus) {
      return null;
    }
    return {
      color: torus.color,
      angle: (torus.angle + 5) % 6,
    };
  }

  private torusRotatedLeft(torus: TorusCell | null): TorusCell | null {
    if (!torus) {
      return null;
    }
    return {
      color: torus.color,
      angle: (torus.angle + 1) % 6,
    };
  }

  private toInsertToPole(torus: TorusCell | null): TorusCell | null {
    if (this.difficulty === 2) {
      return this.torusRotatedLeft(torus);
    }
    if (this.difficulty === 3) {
      return this.torusFlipped(torus);
    }
    return this.cloneTorus(torus);
  }

  private toInsertFromPole(torus: TorusCell | null): TorusCell | null {
    if (this.difficulty === 2) {
      return this.torusRotatedRight(torus);
    }
    return this.cloneTorus(torus);
  }

  private toGoDown(torus: TorusCell | null): TorusCell | null {
    if (this.difficulty === 2) {
      return this.torusRotatedLeft(torus);
    }
    return this.cloneTorus(torus);
  }

  private toGoUp(torus: TorusCell | null): TorusCell | null {
    if (this.difficulty === 2) {
      return this.torusRotatedRight(torus);
    }
    return this.cloneTorus(torus);
  }

  private poleGetTopTorus(): TorusCell | null {
    const raw = this.poleGetRaw(this.poleHeight - this.numToriInPole, this.polePos);
    if (!this.isTorusCell(raw)) {
      return null;
    }
    return this.toInsertFromPole(raw);
  }

  private poleInsert(): void {
    const source = this.boxGetRaw(this.boxHeight - 1, this.polePos);
    this.poleSetRaw(
      this.poleHeight - this.numToriInPole - 1,
      this.polePos,
      this.toInsertToPole(source),
    );
    this.increaseNumToriInPole();
  }

  private poleDeleteTop(): void {
    this.poleSetRaw(this.poleHeight - this.numToriInPole, this.polePos, "pole");
    this.decreaseNumToriInPole();
  }

  private boxInsertFromPole(): void {
    const col = this.polePos;
    const k = this.getNumTori(col);
    for (let r = 0; r < k; r += 1) {
      const rr = this.boxHeight - k - 1 + r;
      this.boxSetRaw(rr, col, this.toGoUp(this.boxGetRaw(rr + 1, col)));
    }
    this.boxSetRaw(this.boxHeight - 1, col, this.poleGetTopTorus());
    this.increaseNumTori(col);
  }

  private boxRemoveTorus(row: number, col: number): void {
    const k = row + 1 + this.getNumTori(col) - this.boxHeight;
    for (let r = 0; r < k - 1; r += 1) {
      const rr = row - r;
      this.boxSetRaw(rr, col, this.toGoDown(this.boxGetRaw(rr - 1, col)));
    }
    const rr = row - (k - 1);
    this.boxSetRaw(rr, col, null);
    this.decreaseNumTori(col);
  }

  private removeBottom(col: number): void {
    this.boxRemoveTorus(this.boxHeight - 1, col);
  }

  private getNumTori(col: number): number {
    return this.numTori[col];
  }

  private increaseNumTori(col: number): void {
    this.numTori[col] += 1;
  }

  private decreaseNumTori(col: number): void {
    this.numTori[col] -= 1;
  }

  private increaseNumToriInPole(): void {
    this.numToriInPole += 1;
  }

  private decreaseNumToriInPole(): void {
    this.numToriInPole -= 1;
  }

  private checkRow(row: number): boolean {
    const first = this.boxGetEntry(row, 0);
    if (first === null) {
      return false;
    }
    let same = 1;
    for (let col = 1; col < this.numCols; col += 1) {
      if (first === this.boxGetEntry(row, col)) {
        same += 1;
      }
    }
    return same === this.numCols;
  }

  private getMeltedTorus(torus: TorusCell): TorusCell {
    return { color: torus.color, angle: -1 };
  }

  private putMeltedTorusRow(row: number): void {
    for (let col = 0; col < this.numCols; col += 1) {
      const raw = this.boxGetRaw(row, col);
      if (raw) {
        this.boxSetRaw(row, col, this.getMeltedTorus(raw));
      }
    }
  }

  private deleteMeltedTorusInRow(row: number): void {
    for (let col = 0; col < this.numCols; col += 1) {
      const raw = this.boxGetRaw(row, col);
      if (raw && this.isMeltedTorus(raw)) {
        this.boxRemoveTorus(row, col);
      }
    }
  }

  private deleteMeltedTori(): void {
    for (let row = 0; row < this.boxHeight; row += 1) {
      this.deleteMeltedTorusInRow(row);
    }
  }

  private meltSameRows(): void {
    for (let row = 0; row < this.boxHeight; row += 1) {
      if (this.checkRow(row)) {
        this.increaseScore();
        this.putMeltedTorusRow(row);
      }
    }
  }

  private increaseScore(): void {
    this.score += this.scorePerTorus * this.numCols;
  }

  private increaseTime(): void {
    if (this.time % this.gaugeTime === 0) {
      this.levelGauge += 1;
    }
    this.time += 1;
  }

  private increaseLevel(): void {
    this.level += 1;
    if (this.poleHeight > 2) {
      this.decreasePoleHeight();
      return;
    }
    this.increaseBox();
    this.increasePole();
    this.increaseNumCols();
    this.increasePoleHeight();
  }

  private increaseBox(): void {
    for (let row = 0; row < this.boxHeight; row += 1) {
      this.box[row].push(null);
    }
  }

  private increasePole(): void {
    for (let row = 0; row < this.poleHeight; row += 1) {
      this.pole[row].push(null);
    }
  }

  private increaseNumCols(): void {
    this.numCols += 1;
    if (this.numCols > MAX_COLS) {
      this.setGameOver();
      return;
    }
    this.numTori.push(0);
    this.flyingTori.push(null);
    this.flyingToriHeight.push(0);
    this.flyingToriWaiting.push(0);
  }

  private decreasePoleHeight(): void {
    if (this.numToriInPole === this.poleHeight) {
      if (this.getNumTori(this.polePos) === this.boxHeight) {
        this.setGameOver();
        return;
      }
      if (this.getNumTori(this.polePos) < this.boxHeight && this.numToriInPole > 0) {
        this.boxInsertFromPole();
        this.poleDeleteTop();
      }
    }
    this.poleHeight -= 1;
    this.pole = this.pole.slice(1);
  }

  private increasePoleHeight(): void {
    const oldHeight = this.poleHeight;
    const newHeight = this.numCols;
    const newPole = this.make2d<PoleEntry>(newHeight, this.numCols, null);
    const gap = newHeight - oldHeight;
    for (let row = 0; row < newHeight; row += 1) {
      for (let col = 0; col < this.numCols; col += 1) {
        if (row < gap) {
          if (col === this.polePos) {
            newPole[row][col] = "pole";
          }
          continue;
        }
        const rr = row - gap;
        const source = this.pole[rr][col] ?? null;
        newPole[row][col] = this.clonePoleEntry(source);
      }
    }
    this.poleHeight = newHeight;
    this.pole = newPole;
  }

  private hasOverflowColumn(): boolean {
    for (let col = 0; col < this.numCols; col += 1) {
      if (this.getNumTori(col) === this.boxHeight) {
        return true;
      }
    }
    return false;
  }

  private setGameOver(): void {
    if (this.gameOn) {
      this.gameOn = false;
    }
    if (!this.gameOverSnapshot) {
      this.gameOverSnapshot = {
        score: this.score,
        level: this.level,
        time: this.time,
        gameOn: false,
      };
    }
  }
}

function isReplayMove(value: unknown): value is ReplayMove {
  return value === "left" || value === "right" || value === "up" || value === "down";
}

export function verifyReplayProof(
  proof: ReplayProof,
): ReplayVerificationResult {
  if (proof.version !== 1) {
    return fail("Unsupported replay proof version.", null);
  }
  if (proof.difficulty !== 1 && proof.difficulty !== 2 && proof.difficulty !== 3) {
    return fail("Invalid replay difficulty.", null);
  }
  if (!Number.isFinite(proof.seed)) {
    return fail("Invalid replay seed.", null);
  }
  if (!Number.isFinite(proof.finalTime) || proof.finalTime < 0) {
    return fail("Invalid replay final time.", null);
  }
  if (proof.finalTime > MAX_REPLAY_FINAL_TIME) {
    return fail("Replay final time exceeds limit.", null);
  }
  if (!Number.isFinite(proof.finalScore) || proof.finalScore < 0) {
    return fail("Invalid replay final score.", null);
  }
  if (!Number.isFinite(proof.finalLevel) || proof.finalLevel < 0) {
    return fail("Invalid replay final level.", null);
  }
  if (!Array.isArray(proof.inputs)) {
    return fail("Replay inputs must be an array.", null);
  }
  if (proof.inputs.length > MAX_REPLAY_INPUTS) {
    return fail("Replay input count exceeds limit.", null);
  }

  const normalizedFinalTime = Math.trunc(proof.finalTime);
  const simulator = new ReplaySimulator(
    Math.trunc(proof.seed) >>> 0,
    Math.trunc(proof.difficulty),
  );
  let lastInputTime = -1;
  for (const input of proof.inputs) {
    if (!Number.isFinite(input.time) || input.time < 0) {
      return fail("Replay input time is invalid.", simulator.getState());
    }
    if (!isReplayMove(input.move)) {
      return fail("Replay input move is invalid.", simulator.getState());
    }
    const eventTime = Math.trunc(input.time);
    if (eventTime < lastInputTime) {
      return fail("Replay inputs are out of order.", simulator.getState());
    }
    if (eventTime > normalizedFinalTime) {
      return fail("Replay input time exceeds final time.", simulator.getState());
    }
    simulator.stepUntil(eventTime);
    if (!simulator.getState().gameOn) {
      return fail("Replay ended before all inputs were consumed.", simulator.getState());
    }
    simulator.applyMove(input.move);
    lastInputTime = eventTime;
  }

  simulator.stepUntil(normalizedFinalTime);
  simulator.finalizeAtCurrentTime();
  let actual = simulator.getState();
  if (actual.gameOn) {
    const nextTickSnapshot = simulator.stepOneTickAndCaptureGameOverSnapshot();
    if (
      nextTickSnapshot &&
      nextTickSnapshot.time === normalizedFinalTime &&
      nextTickSnapshot.score === Math.trunc(proof.finalScore) &&
      nextTickSnapshot.level === Math.trunc(proof.finalLevel)
    ) {
      actual = nextTickSnapshot;
    }
  }
  if (actual.time !== normalizedFinalTime) {
    return fail("Replay final time mismatch.", actual);
  }
  if (actual.gameOn) {
    return fail("Replay is still running at final time.", actual);
  }
  if (actual.score !== Math.trunc(proof.finalScore)) {
    return fail("Replay final score mismatch.", actual);
  }
  if (actual.level !== Math.trunc(proof.finalLevel)) {
    return fail("Replay final level mismatch.", actual);
  }

  return {
    ok: true,
    reason: null,
    actual: {
      score: actual.score,
      level: actual.level,
      time: actual.time,
      gameOn: actual.gameOn,
    },
  };
}

function fail(
  reason: string,
  state: SimulationState | null,
): ReplayVerificationResult {
  return {
    ok: false,
    reason,
    actual: {
      score: state?.score ?? 0,
      level: state?.level ?? 0,
      time: state?.time ?? 0,
      gameOn: state?.gameOn ?? false,
    },
  };
}
