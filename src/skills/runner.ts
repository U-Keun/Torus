import type { Direction, Skill } from "./types";

export interface SkillRunnerState {
  isSkillRunning: boolean;
  isProcessing: boolean;
  activeSkillName: string | null;
  remainingSkillMoves: number;
  queuedManualMoves: number;
}

interface SkillRunnerOptions {
  stepDelayMs?: number;
  onStateChange?: (state: SkillRunnerState) => void;
}

export class SkillRunner {
  private readonly stepDelayMs: number;
  private readonly onStateChange?: (state: SkillRunnerState) => void;
  private timer: number | null = null;
  private activeSkillName: string | null = null;
  private skillQueue: Direction[] = [];
  private manualQueue: Direction[] = [];

  constructor(
    private readonly dispatchMove: (direction: Direction) => void,
    options: SkillRunnerOptions = {},
  ) {
    this.stepDelayMs = Math.max(40, options.stepDelayMs ?? 110);
    this.onStateChange = options.onStateChange;
  }

  public getState(): SkillRunnerState {
    const isSkillRunning = this.activeSkillName !== null || this.skillQueue.length > 0;
    const isProcessing = isSkillRunning || this.manualQueue.length > 0 || this.timer !== null;
    return {
      isSkillRunning,
      isProcessing,
      activeSkillName: this.activeSkillName,
      remainingSkillMoves: this.skillQueue.length,
      queuedManualMoves: this.manualQueue.length,
    };
  }

  public runSkill(skill: Pick<Skill, "name" | "sequence">): boolean {
    if (this.getState().isProcessing || skill.sequence.length === 0) {
      return false;
    }

    this.activeSkillName = skill.name;
    this.skillQueue = [...skill.sequence];
    this.emitState();
    this.scheduleNextTick();
    return true;
  }

  public enqueueManualMove(direction: Direction): void {
    const state = this.getState();
    if (state.isSkillRunning) {
      this.manualQueue.push(direction);
      this.emitState();
      return;
    }

    if (state.isProcessing) {
      this.manualQueue.push(direction);
      this.emitState();
      return;
    }

    this.dispatchMove(direction);
  }

  public cancelAll(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.activeSkillName = null;
    this.skillQueue = [];
    this.manualQueue = [];
    this.emitState();
  }

  private scheduleNextTick(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = window.setTimeout(() => {
      this.tick();
    }, this.stepDelayMs);
  }

  private tick(): void {
    this.timer = null;

    if (this.skillQueue.length > 0) {
      const move = this.skillQueue.shift();
      if (move) {
        this.dispatchMove(move);
      }
      if (this.skillQueue.length === 0) {
        this.activeSkillName = null;
      }
    } else if (this.manualQueue.length > 0) {
      const move = this.manualQueue.shift();
      if (move) {
        this.dispatchMove(move);
      }
    }

    const shouldContinue = this.skillQueue.length > 0 || this.manualQueue.length > 0;
    this.emitState();
    if (shouldContinue) {
      this.scheduleNextTick();
    }
  }

  private emitState(): void {
    this.onStateChange?.(this.getState());
  }
}
