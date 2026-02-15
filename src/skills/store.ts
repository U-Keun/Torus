import {
  MAX_SKILL_NAME_LENGTH,
  MAX_SKILL_SEQUENCE_LENGTH,
  type Direction,
  type Skill,
} from "./types";

const SKILLS_STORAGE_KEY = "torus-skills-v1";
const MAX_SKILL_COUNT = 50;

export class SkillStore {
  constructor(
    private readonly storage: Storage = window.localStorage,
  ) {}

  public list(): Skill[] {
    return this.load()
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map((skill) => cloneSkill(skill));
  }

  public create(name: string, sequence: ReadonlyArray<Direction>, hotkey: string | null): Skill {
    const normalizedName = name.trim().slice(0, MAX_SKILL_NAME_LENGTH);
    if (normalizedName.length === 0) {
      throw new Error("Skill name is required.");
    }

    if (sequence.length === 0) {
      throw new Error("Skill sequence is required.");
    }

    if (sequence.length > MAX_SKILL_SEQUENCE_LENGTH) {
      throw new Error(`Sequence is too long (max ${MAX_SKILL_SEQUENCE_LENGTH} steps).`);
    }

    const now = new Date().toISOString();
    const skill: Skill = {
      id: this.createId(),
      name: normalizedName,
      sequence: [...sequence],
      hotkey,
      createdAt: now,
      updatedAt: now,
    };

    const existing = this.load();
    existing.unshift(skill);
    this.save(existing.slice(0, MAX_SKILL_COUNT));
    return cloneSkill(skill);
  }

  public remove(id: string): void {
    const next = this.load().filter((skill) => skill.id !== id);
    this.save(next);
  }

  public update(
    id: string,
    name: string,
    sequence: ReadonlyArray<Direction>,
    hotkey: string | null,
  ): Skill {
    const normalizedName = name.trim().slice(0, MAX_SKILL_NAME_LENGTH);
    if (normalizedName.length === 0) {
      throw new Error("Skill name is required.");
    }

    if (sequence.length === 0) {
      throw new Error("Skill sequence is required.");
    }

    if (sequence.length > MAX_SKILL_SEQUENCE_LENGTH) {
      throw new Error(`Sequence is too long (max ${MAX_SKILL_SEQUENCE_LENGTH} steps).`);
    }

    const existing = this.load();
    const targetIndex = existing.findIndex((skill) => skill.id === id);
    if (targetIndex < 0) {
      throw new Error("Skill not found.");
    }

    const previous = existing[targetIndex];
    const updated: Skill = {
      id: previous.id,
      name: normalizedName,
      sequence: [...sequence],
      hotkey,
      createdAt: previous.createdAt,
      updatedAt: new Date().toISOString(),
    };

    existing[targetIndex] = updated;
    this.save(existing);
    return cloneSkill(updated);
  }

  private load(): Skill[] {
    const raw = this.storage.getItem(SKILLS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      const skills: Skill[] = [];
      for (const row of parsed) {
        if (!isSkill(row)) {
          continue;
        }
        const validSequence = row.sequence.filter(isDirection).slice(0, MAX_SKILL_SEQUENCE_LENGTH);
        const validName = row.name.trim().slice(0, MAX_SKILL_NAME_LENGTH);
        if (validName.length === 0 || validSequence.length === 0) {
          continue;
        }
        skills.push({
          id: row.id,
          name: validName,
          sequence: validSequence,
          hotkey: isValidHotkeyCode(row.hotkey) ? row.hotkey : null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
      return skills;
    } catch {
      return [];
    }
  }

  private save(skills: Skill[]): void {
    try {
      this.storage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills));
    } catch {
      // Ignore local storage failures.
    }
  }

  private createId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function cloneSkill(skill: Skill): Skill {
  return {
    id: skill.id,
    name: skill.name,
    sequence: [...skill.sequence],
    hotkey: skill.hotkey,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function isDirection(direction: unknown): direction is Direction {
  return (
    direction === "left" ||
    direction === "right" ||
    direction === "autoHorizontal" ||
    direction === "autoHorizontalInverse" ||
    direction === "up" ||
    direction === "down"
  );
}

function isSkill(value: unknown): value is Skill {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    Array.isArray(row.sequence) &&
    (typeof row.hotkey === "string" || typeof row.hotkey === "undefined" || row.hotkey === null) &&
    typeof row.createdAt === "string" &&
    typeof row.updatedAt === "string"
  );
}

function isValidHotkeyCode(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9]*$/.test(value);
}
