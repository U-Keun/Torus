import { describe, expect, it } from "vitest";
import { MAX_SKILL_NAME_LENGTH, type Skill } from "./types";
import { SkillStore } from "./store";

const SKILLS_STORAGE_KEY = "torus-skills-v1";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  public get length(): number {
    return this.data.size;
  }

  public clear(): void {
    this.data.clear();
  }

  public getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  public key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  public removeItem(key: string): void {
    this.data.delete(key);
  }

  public setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("SkillStore", () => {
  it("creates, updates, and removes skills", () => {
    const store = new SkillStore(new MemoryStorage());
    const created = store.create(
      `  ${"A".repeat(MAX_SKILL_NAME_LENGTH + 5)}  `,
      ["left", "right"],
      "KeyA",
    );

    expect(created.name).toBe("A".repeat(MAX_SKILL_NAME_LENGTH));
    expect(store.list()).toHaveLength(1);

    const updated = store.update(created.id, "Updated", ["up"], null);

    expect(updated).toMatchObject({
      id: created.id,
      name: "Updated",
      sequence: ["up"],
      hotkey: null,
      createdAt: created.createdAt,
    });

    store.remove(created.id);

    expect(store.list()).toEqual([]);
  });

  it("ignores corrupted persisted data", () => {
    const storage = new MemoryStorage();
    storage.setItem(SKILLS_STORAGE_KEY, "not json");

    expect(new SkillStore(storage).list()).toEqual([]);
  });

  it("sanitizes loaded rows and invalid hotkeys", () => {
    const storage = new MemoryStorage();
    const rawSkill: Skill = {
      id: "skill-1",
      name: ` ${"B".repeat(MAX_SKILL_NAME_LENGTH + 5)} `,
      sequence: ["left", "not-a-direction" as never, "down"],
      hotkey: "Space!",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    };
    storage.setItem(SKILLS_STORAGE_KEY, JSON.stringify([rawSkill]));

    expect(new SkillStore(storage).list()).toEqual([
      {
        id: "skill-1",
        name: "B".repeat(MAX_SKILL_NAME_LENGTH),
        sequence: ["left", "down"],
        hotkey: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z",
      },
    ]);
  });

  it("returns clones so callers cannot mutate persisted skills", () => {
    const store = new SkillStore(new MemoryStorage());
    const created = store.create("Clone", ["left"], "KeyC");
    const listed = store.list();

    listed[0].name = "Mutated";
    listed[0].sequence.push("right");

    expect(store.list()[0]).toMatchObject({
      id: created.id,
      name: "Clone",
      sequence: ["left"],
    });
  });
});
