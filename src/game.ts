export type Difficulty = 1 | 2 | 3;

export interface TorusCell {
  color: number;
  angle: number;
}

export type PoleEntry = TorusCell | "pole" | null;

export interface FlyingTorus {
  col: number;
  color: number;
  height: number;
}

export interface GameSnapshot {
  box: ReadonlyArray<ReadonlyArray<TorusCell | null>>;
  pole: ReadonlyArray<ReadonlyArray<PoleEntry>>;
  flying: ReadonlyArray<FlyingTorus>;
  numCols: number;
  boxHeight: number;
  poleHeight: number;
  polePos: number;
  numToriInPole: number;
  numTori: ReadonlyArray<number>;
  score: number;
  level: number;
  levelGauge: number;
  gaugeMax: number;
  time: number;
  difficulty: Difficulty;
  gameOn: boolean;
}

export interface GameOverPayload {
  score: number;
  level: number;
}

interface NewGameOptions {
  randomSeed?: number;
}

export interface PersistedGameState {
  version: 1;
  numCols: number;
  poleHeight: number;
  polePos: number;
  box: (TorusCell | null)[][];
  pole: PoleEntry[][];
  flyingTori: (number | null)[];
  flyingToriHeight: number[];
  flyingToriWaiting: number[];
  numTori: number[];
  numToriInPole: number;
  score: number;
  level: number;
  levelGauge: number;
  time: number;
  gameOn: boolean;
  difficulty: Difficulty;
  gameSpeedMs: number;
  lastUser: string;
  randomMode: "default" | "seeded";
  randomSeedState: number;
}

export class TorusGame {
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
  private gameOn = false;
  private timer: number | null = null;
  private difficulty: Difficulty = 1;
  private gameSpeedMs = 100;
  private lastUser = "";
  private randomMode: "default" | "seeded" = "default";
  private randomSeedState = 0;
  private randomFn: () => number = Math.random;

  constructor(
    private readonly onRender: (snapshot: GameSnapshot) => void,
    private readonly onGameOver: (payload: GameOverPayload) => void,
  ) {
    this.resetState();
    this.emitRender();
  }

  public destroy(): void {
    this.pauseInternal();
  }

  public setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    this.gameSpeedMs = 100;
    this.emitRender();
  }

  public getDifficulty(): Difficulty {
    return this.difficulty;
  }

  public startNewGame(difficulty: Difficulty, options: NewGameOptions = {}): void {
    this.setDifficulty(difficulty);
    if (typeof options.randomSeed === "number") {
      this.configureSeededRandom(options.randomSeed >>> 0);
    } else {
      this.configureDefaultRandom();
    }
    this.resetState();
    this.gameOn = true;
    this.startTimer();
    this.emitRender();
  }

  public resume(): void {
    if (this.gameOn) {
      return;
    }
    this.gameOn = true;
    this.startTimer();
    this.emitRender();
  }

  public pause(): void {
    this.pauseInternal();
    this.emitRender();
  }

  public reset(): void {
    this.pauseInternal();
    this.resetState();
    this.emitRender();
  }

  public moveLeft(): void {
    if (!this.gameOn) {
      return;
    }
    this.movePoleLeft();
    this.emitRender();
  }

  public moveRight(): void {
    if (!this.gameOn) {
      return;
    }
    this.movePoleRight();
    this.emitRender();
  }

  public moveUp(): void {
    if (!this.gameOn) {
      return;
    }
    if (this.getNumTori(this.polePos) < this.boxHeight && this.numToriInPole > 0) {
      this.boxInsertFromPole();
      this.poleDeleteTop();
      this.meltSameRows();
      this.emitRender();
    }
  }

  public moveDown(): void {
    if (!this.gameOn) {
      return;
    }
    if (
      this.getNumTori(this.polePos) > 0 &&
      this.numToriInPole < this.poleHeight
    ) {
      this.poleInsert();
      this.removeBottom(this.polePos);
      this.meltSameRows();
      this.emitRender();
    }
  }

  public getLastUser(): string {
    return this.lastUser;
  }

  public setLastUser(user: string): void {
    this.lastUser = user;
  }

  public exportState(): PersistedGameState {
    return {
      version: 1,
      numCols: this.numCols,
      poleHeight: this.poleHeight,
      polePos: this.polePos,
      box: this.box.map((row) => row.map((entry) => this.cloneTorus(entry))),
      pole: this.pole.map((row) => row.map((entry) => this.clonePoleEntry(entry))),
      flyingTori: [...this.flyingTori],
      flyingToriHeight: [...this.flyingToriHeight],
      flyingToriWaiting: [...this.flyingToriWaiting],
      numTori: [...this.numTori],
      numToriInPole: this.numToriInPole,
      score: this.score,
      level: this.level,
      levelGauge: this.levelGauge,
      time: this.time,
      gameOn: this.gameOn,
      difficulty: this.difficulty,
      gameSpeedMs: this.gameSpeedMs,
      lastUser: this.lastUser,
      randomMode: this.randomMode,
      randomSeedState: this.randomSeedState >>> 0,
    };
  }

  public importState(state: PersistedGameState): boolean {
    if (!this.isPersistedState(state)) {
      return false;
    }

    this.pauseInternal();

    this.numCols = state.numCols;
    this.poleHeight = state.poleHeight;
    this.polePos = state.polePos;
    this.box = state.box.map((row) => row.map((entry) => this.cloneTorus(entry)));
    this.pole = state.pole.map((row) => row.map((entry) => this.clonePoleEntry(entry)));
    this.flyingTori = [...state.flyingTori];
    this.flyingToriHeight = [...state.flyingToriHeight];
    this.flyingToriWaiting = [...state.flyingToriWaiting];
    this.numTori = [...state.numTori];
    this.numToriInPole = state.numToriInPole;
    this.score = state.score;
    this.level = state.level;
    this.levelGauge = state.levelGauge;
    this.time = state.time;
    this.difficulty = state.difficulty;
    this.gameSpeedMs = state.gameSpeedMs;
    this.lastUser = state.lastUser;
    this.gameOn = state.gameOn;

    if (state.randomMode === "seeded") {
      this.configureSeededRandom(state.randomSeedState >>> 0);
    } else {
      this.configureDefaultRandom();
    }

    if (this.gameOn) {
      this.startTimer();
    }

    this.emitRender();
    return true;
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
    this.gameOn = false;

    this.initPole(0);
  }

  private configureDefaultRandom(): void {
    this.randomMode = "default";
    this.randomSeedState = 0;
    this.randomFn = Math.random;
  }

  private configureSeededRandom(seed: number): void {
    this.randomMode = "seeded";
    this.randomSeedState = seed >>> 0;
    this.randomFn = () => this.nextSeededRandom();
  }

  private nextSeededRandom(): number {
    this.randomSeedState = (this.randomSeedState + 0x6d2b79f5) >>> 0;
    let value = Math.imul(this.randomSeedState ^ (this.randomSeedState >>> 15), 1 | this.randomSeedState);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  private isPersistedState(state: PersistedGameState): boolean {
    if (state.version !== 1) {
      return false;
    }
    if (![1, 2, 3].includes(state.difficulty)) {
      return false;
    }
    if (state.randomMode !== "default" && state.randomMode !== "seeded") {
      return false;
    }
    if (!Number.isInteger(state.numCols) || state.numCols < 3 || state.numCols > 128) {
      return false;
    }
    if (!Number.isInteger(state.poleHeight) || state.poleHeight < 1 || state.poleHeight > state.numCols) {
      return false;
    }
    if (!Number.isInteger(state.polePos) || state.polePos < 0 || state.polePos >= state.numCols) {
      return false;
    }
    if (!Array.isArray(state.box) || state.box.length !== this.boxHeight) {
      return false;
    }
    if (!Array.isArray(state.pole) || state.pole.length !== state.poleHeight) {
      return false;
    }
    if (!Array.isArray(state.flyingTori) || state.flyingTori.length !== state.numCols) {
      return false;
    }
    if (!Array.isArray(state.flyingToriHeight) || state.flyingToriHeight.length !== state.numCols) {
      return false;
    }
    if (!Array.isArray(state.flyingToriWaiting) || state.flyingToriWaiting.length !== state.numCols) {
      return false;
    }
    if (!Array.isArray(state.numTori) || state.numTori.length !== state.numCols) {
      return false;
    }

    for (const row of state.box) {
      if (!Array.isArray(row) || row.length !== state.numCols) {
        return false;
      }
      for (const entry of row) {
        if (entry === null) {
          continue;
        }
        if (
          typeof entry !== "object" ||
          !Number.isFinite(entry.color) ||
          !Number.isFinite(entry.angle)
        ) {
          return false;
        }
      }
    }
    for (const row of state.pole) {
      if (!Array.isArray(row) || row.length !== state.numCols) {
        return false;
      }
      for (const entry of row) {
        if (entry === null || entry === "pole") {
          continue;
        }
        if (
          typeof entry !== "object" ||
          !Number.isFinite(entry.color) ||
          !Number.isFinite(entry.angle)
        ) {
          return false;
        }
      }
    }
    for (const value of state.flyingTori) {
      if (value !== null && !Number.isFinite(value)) {
        return false;
      }
    }
    for (const value of state.flyingToriHeight) {
      if (!Number.isFinite(value)) {
        return false;
      }
    }
    for (const value of state.flyingToriWaiting) {
      if (!Number.isFinite(value)) {
        return false;
      }
    }
    for (const value of state.numTori) {
      if (!Number.isFinite(value)) {
        return false;
      }
    }
    if (!Number.isInteger(state.numToriInPole) || state.numToriInPole < 0 || state.numToriInPole > state.poleHeight) {
      return false;
    }
    if (!Number.isFinite(state.score) || !Number.isFinite(state.level) || !Number.isFinite(state.levelGauge) || !Number.isFinite(state.time)) {
      return false;
    }
    if (typeof state.gameOn !== "boolean") {
      return false;
    }
    if (!Number.isFinite(state.gameSpeedMs) || state.gameSpeedMs <= 0) {
      return false;
    }
    if (typeof state.lastUser !== "string") {
      return false;
    }
    if (!Number.isFinite(state.randomSeedState)) {
      return false;
    }
    return true;
  }

  private make2d<T>(rows: number, cols: number, fill: T): T[][] {
    return Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => fill),
    );
  }

  private startTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
    }
    this.timer = window.setInterval(() => {
      this.update();
    }, this.gameSpeedMs);
  }

  private pauseInternal(): void {
    this.gameOn = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private emitRender(): void {
    this.onRender(this.createSnapshot());
  }

  private createSnapshot(): GameSnapshot {
    return {
      box: this.box.map((row) => row.map((entry) => this.cloneTorus(entry))),
      pole: this.pole.map((row) => row.map((entry) => this.clonePoleEntry(entry))),
      flying: this.flyingTori
        .map((color, col) => {
          if (color === null) {
            return null;
          }
          return { col, color, height: this.flyingToriHeight[col] };
        })
        .filter((entry): entry is FlyingTorus => entry !== null),
      numCols: this.numCols,
      boxHeight: this.boxHeight,
      poleHeight: this.poleHeight,
      polePos: this.polePos,
      numToriInPole: this.numToriInPole,
      numTori: [...this.numTori],
      score: this.score,
      level: this.level,
      levelGauge: this.levelGauge,
      gaugeMax: this.levelUpTime * this.numCols,
      time: this.time,
      difficulty: this.difficulty,
      gameOn: this.gameOn,
    };
  }

  private clonePoleEntry(entry: PoleEntry): PoleEntry {
    if (entry === null || entry === "pole") {
      return entry;
    }
    return { ...entry };
  }

  private cloneTorus(torus: TorusCell | null): TorusCell | null {
    return torus ? { ...torus } : null;
  }

  private update(): void {
    for (let col = 0; col < this.numCols; col += 1) {
      if (this.gameOn && this.getNumTori(col) === this.boxHeight) {
        this.gameOver();
      }
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

    if (this.gameOn) {
      this.emitRender();
    }
  }

  private gameOver(): void {
    if (!this.gameOn && this.timer === null) {
      return;
    }
    this.pauseInternal();
    this.onGameOver({ score: this.score, level: this.level });
    this.emitRender();
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
      this.gameOver();
      return;
    }

    const angle = (3 + this.flyingToriHeight[col]) % 4 < 2 ? 4 : 1;
    this.boxSetRaw(targetRow, col, { color, angle });
    this.increaseNumTori(col);
  }

  private randomTorus(): number {
    return Math.floor(this.randomFn() * this.numColors);
  }

  private boxSetRaw(row: number, col: number, value: TorusCell | null): void {
    this.box[row][col] = this.cloneTorus(value);
  }

  private boxGetRaw(row: number, col: number): TorusCell | null {
    return this.box[row][col];
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

  private poleGetRaw(row: number, col: number): PoleEntry {
    return this.pole[row][col];
  }

  private poleSetRaw(row: number, col: number, value: PoleEntry): void {
    this.pole[row][col] = this.clonePoleEntry(value);
  }

  private initPole(pos: number): void {
    this.polePos = pos;
    for (let row = 0; row < this.poleHeight; row += 1) {
      for (let col = 0; col < this.numCols; col += 1) {
        if (col === pos) {
          this.poleSetRaw(row, col, "pole");
        } else {
          this.poleSetRaw(row, col, null);
        }
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

  private isTorusCell(entry: PoleEntry | TorusCell | null): entry is TorusCell {
    return (
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.color === "number" &&
      typeof entry.angle === "number"
    );
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
    const raw = this.poleGetRaw(
      this.poleHeight - this.numToriInPole,
      this.polePos,
    );
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
    this.poleSetRaw(
      this.poleHeight - this.numToriInPole,
      this.polePos,
      "pole",
    );
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

  private isMeltedTorus(torus: TorusCell): boolean {
    return torus.angle === -1;
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
    this.numTori.push(0);
    this.flyingTori.push(null);
    this.flyingToriHeight.push(0);
    this.flyingToriWaiting.push(0);
  }

  private decreasePoleHeight(): void {
    if (this.numToriInPole === this.poleHeight) {
      if (this.getNumTori(this.polePos) === this.boxHeight) {
        this.gameOver();
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
        } else {
          const rr = row - gap;
          const source = this.pole[rr][col] ?? null;
          newPole[row][col] = this.clonePoleEntry(source);
        }
      }
    }

    this.pole = newPole;
    this.poleHeight = newHeight;
  }
}
