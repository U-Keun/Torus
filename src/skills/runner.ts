import type { Direction, Skill } from "./types";

export interface SkillRunnerState {
  isSkillRunning: boolean;
  isProcessing: boolean;
  activeSkillName: string | null;
  remainingSkillMoves: number;
  queuedManualMoves: number;
}

interface SkillRunnerOptions {
  onStateChange?: (state: SkillRunnerState) => void;
}

export class SkillRunner {
  private readonly onStateChange?: (state: SkillRunnerState) => void;
  private activeSkillName: string | null = null;
  private skillQueue: Direction[] = [];

  constructor(
    private readonly dispatchMove: (direction: Direction) => void,
    options: SkillRunnerOptions = {},
  ) {
    this.onStateChange = options.onStateChange;
  }

  public getState(): SkillRunnerState {
    const isSkillRunning = this.activeSkillName !== null || this.skillQueue.length > 0;
    return {
      isSkillRunning,
      isProcessing: isSkillRunning,
      activeSkillName: this.activeSkillName,
      remainingSkillMoves: this.skillQueue.length,
      queuedManualMoves: 0,
    };
  }

  public runSkill(skill: Pick<Skill, "name" | "sequence">): boolean {
    if (this.getState().isProcessing || skill.sequence.length === 0) {
      return false;
    }

    this.activeSkillName = skill.name;
    this.skillQueue = [...skill.sequence];
    this.emitState();
    try {
      while (this.skillQueue.length > 0) {
        const move = this.skillQueue.shift();
        if (move) {
          this.dispatchMove(move);
        }
      }
    } finally {
      this.activeSkillName = null;
      this.skillQueue = [];
      this.emitState();
    }
    return true;
  }

  public enqueueManualMove(direction: Direction): void {
    this.dispatchMove(direction);
  }

  public cancelAll(): void {
    this.activeSkillName = null;
    this.skillQueue = [];
    this.emitState();
  }

  private emitState(): void {
    this.onStateChange?.(this.getState());
  }
}
