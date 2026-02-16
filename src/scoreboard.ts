import { invoke } from "@tauri-apps/api/core";

export interface SkillUsageEntry {
  name: string;
  hotkey: string | null;
  command: string | null;
}

interface RawSkillUsageEntry {
  name: string;
  hotkey: string | null;
  command?: string | null;
}

export interface ScoreEntry {
  user: string;
  score: number;
  level: number;
  date: string;
  skillUsage: SkillUsageEntry[];
}

export interface ScoreboardStore {
  top(limit?: number): Promise<ScoreEntry[]>;
  add(entry: ScoreEntry): Promise<void>;
  topPersonal(limit?: number): Promise<ScoreEntry[]>;
  addPersonal(entry: ScoreEntry): Promise<void>;
  topDaily(challengeKey: string, limit?: number): Promise<ScoreEntry[]>;
  addDaily(challengeKey: string, entry: ScoreEntry): Promise<void>;
}

class LocalEntryStore {
  constructor(
    private readonly storageKey: string,
    private readonly storage: Storage = window.localStorage,
    private readonly maxEntries = 300,
  ) {}

  public async top(limit = 10): Promise<ScoreEntry[]> {
    return this.sort(this.load()).slice(0, limit);
  }

  public async add(entry: ScoreEntry): Promise<void> {
    const scores = this.load();
    scores.push(entry);
    this.save(this.sort(scores).slice(0, this.maxEntries));
  }

  public merge(entries: ReadonlyArray<ScoreEntry>): void {
    const existing = this.load();
    const all = [...existing, ...entries];
    const deduped = new Map<string, ScoreEntry>();
    for (const row of all) {
      deduped.set(this.entryKey(row), row);
    }
    this.save(this.sort([...deduped.values()]).slice(0, this.maxEntries));
  }

  private load(): ScoreEntry[] {
    const raw = this.storage.getItem(this.storageKey);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((entry): entry is ScoreEntry => this.isScoreEntry(entry))
        .map((entry) => ({
          user: entry.user,
          score: entry.score,
          level: entry.level,
          date: entry.date,
          skillUsage: this.normalizeSkillUsage(entry.skillUsage),
        }));
    } catch {
      return [];
    }
  }

  private save(scores: ScoreEntry[]): void {
    this.storage.setItem(this.storageKey, JSON.stringify(scores));
  }

  private sort(scores: ScoreEntry[]): ScoreEntry[] {
    return [...scores].sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.level !== a.level) {
        return b.level - a.level;
      }
      return Date.parse(b.date) - Date.parse(a.date);
    });
  }

  private entryKey(entry: ScoreEntry): string {
    return `${entry.user}::${entry.score}::${entry.level}::${entry.date}::${JSON.stringify(entry.skillUsage)}`;
  }

  private isScoreEntry(entry: unknown): entry is ScoreEntry {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    const record = entry as Record<string, unknown>;
    return (
      typeof record.user === "string" &&
      typeof record.score === "number" &&
      typeof record.level === "number" &&
      typeof record.date === "string" &&
      (
        typeof record.skillUsage === "undefined" ||
        this.isSkillUsageArray(record.skillUsage)
      )
    );
  }

  private normalizeSkillUsage(raw: unknown): SkillUsageEntry[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((entry): entry is RawSkillUsageEntry => this.isSkillUsageEntry(entry))
      .map((entry) => ({
        name: entry.name.trim().slice(0, 20),
        hotkey: entry.hotkey ? entry.hotkey.trim().slice(0, 16) : null,
        command: normalizeSkillCommand(entry.command),
      }))
      .filter((entry) => entry.name.length > 0)
      .slice(0, 20);
  }

  private isSkillUsageArray(raw: unknown): raw is RawSkillUsageEntry[] {
    return Array.isArray(raw) && raw.every((entry) => this.isSkillUsageEntry(entry));
  }

  private isSkillUsageEntry(raw: unknown): raw is RawSkillUsageEntry {
    if (!raw || typeof raw !== "object") {
      return false;
    }
    const row = raw as Record<string, unknown>;
    return (
      typeof row.name === "string" &&
      (typeof row.hotkey === "string" || row.hotkey === null) &&
      (
        typeof row.command === "string" ||
        row.command === null ||
        typeof row.command === "undefined"
      )
    );
  }
}

class LocalOnlyScoreboardStore implements ScoreboardStore {
  constructor(
    private readonly globalStore: LocalEntryStore,
    private readonly personalStore: LocalEntryStore,
    private readonly resolveDailyStore: DailyStoreResolver,
  ) {}

  public top(limit = 10): Promise<ScoreEntry[]> {
    return this.globalStore.top(limit);
  }

  public add(entry: ScoreEntry): Promise<void> {
    return this.globalStore.add(entry);
  }

  public topPersonal(limit = 10): Promise<ScoreEntry[]> {
    return this.personalStore.top(limit);
  }

  public addPersonal(entry: ScoreEntry): Promise<void> {
    return this.personalStore.add(entry);
  }

  public topDaily(challengeKey: string, limit = 10): Promise<ScoreEntry[]> {
    return this.resolveDailyStore(challengeKey).top(limit);
  }

  public addDaily(challengeKey: string, entry: ScoreEntry): Promise<void> {
    return this.resolveDailyStore(challengeKey).add(entry);
  }
}

class TauriScoreboardStore implements ScoreboardStore {
  constructor(
    private readonly globalStore: LocalEntryStore,
    private readonly personalStore: LocalEntryStore,
    private readonly resolveDailyStore: DailyStoreResolver,
    private readonly supabaseUrl: string,
    private readonly supabaseAnonKey: string,
  ) {}

  public async top(limit = 10): Promise<ScoreEntry[]> {
    try {
      const rows = await invoke<ScoreEntry[]>("fetch_global_scores", {
        limit,
        supabaseUrl: this.supabaseUrl || null,
        supabaseAnonKey: this.supabaseAnonKey || null,
      });
      const mapped = rows
        .filter((entry): entry is ScoreEntry => this.isScoreEntry(entry))
        .map((entry) => ({
          user: entry.user,
          score: entry.score,
          level: entry.level,
          date: entry.date,
          skillUsage: this.normalizeSkillUsage(entry.skillUsage),
        }));
      this.globalStore.merge(mapped);
      return mapped.slice(0, limit);
    } catch (error) {
      console.warn("Failed to load scores from Tauri backend. Using local cache.", error);
      return this.globalStore.top(limit);
    }
  }

  public async add(entry: ScoreEntry): Promise<void> {
    await this.globalStore.add(entry);
    try {
      await invoke("submit_global_score", {
        entry,
        supabaseUrl: this.supabaseUrl || null,
        supabaseAnonKey: this.supabaseAnonKey || null,
      });
    } catch (error) {
      console.warn("Failed to save score through Tauri backend. Score kept locally.", error);
    }
  }

  public topPersonal(limit = 10): Promise<ScoreEntry[]> {
    return this.personalStore.top(limit);
  }

  public addPersonal(entry: ScoreEntry): Promise<void> {
    return this.personalStore.add(entry);
  }

  public topDaily(challengeKey: string, limit = 10): Promise<ScoreEntry[]> {
    return this.resolveDailyStore(challengeKey).top(limit);
  }

  public addDaily(challengeKey: string, entry: ScoreEntry): Promise<void> {
    return this.resolveDailyStore(challengeKey).add(entry);
  }

  private isScoreEntry(entry: unknown): entry is ScoreEntry {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return (
      typeof record.user === "string" &&
      typeof record.score === "number" &&
      typeof record.level === "number" &&
      typeof record.date === "string" &&
      (
        typeof record.skillUsage === "undefined" ||
        this.isSkillUsageArray(record.skillUsage)
      )
    );
  }

  private normalizeSkillUsage(raw: unknown): SkillUsageEntry[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((entry): entry is RawSkillUsageEntry => this.isSkillUsageEntry(entry))
      .map((entry) => ({
        name: entry.name.trim().slice(0, 20),
        hotkey: entry.hotkey ? entry.hotkey.trim().slice(0, 16) : null,
        command: normalizeSkillCommand(entry.command),
      }))
      .filter((entry) => entry.name.length > 0)
      .slice(0, 20);
  }

  private isSkillUsageArray(raw: unknown): raw is RawSkillUsageEntry[] {
    return Array.isArray(raw) && raw.every((entry) => this.isSkillUsageEntry(entry));
  }

  private isSkillUsageEntry(raw: unknown): raw is RawSkillUsageEntry {
    if (!raw || typeof raw !== "object") {
      return false;
    }
    const row = raw as Record<string, unknown>;
    return (
      typeof row.name === "string" &&
      (typeof row.hotkey === "string" || row.hotkey === null) &&
      (
        typeof row.command === "string" ||
        row.command === null ||
        typeof row.command === "undefined"
      )
    );
  }
}

export function createScoreboardStore(): ScoreboardStore {
  const globalStore = new LocalEntryStore("torus-scores-v1", window.localStorage, 100);
  const personalStore = new LocalEntryStore("torus-personal-scores-v1", window.localStorage, 100);
  const resolveDailyStore = createDailyStoreResolver(window.localStorage, 100);
  const supabaseUrl = readEnv("VITE_SUPABASE_URL");
  const supabaseAnonKey = readEnv("VITE_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.info("Supabase env is not configured. Global score sync is disabled.");
    return new LocalOnlyScoreboardStore(globalStore, personalStore, resolveDailyStore);
  }

  return new TauriScoreboardStore(
    globalStore,
    personalStore,
    resolveDailyStore,
    supabaseUrl,
    supabaseAnonKey,
  );
}

function readEnv(key: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string {
  const value = import.meta.env[key];
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeSkillCommand(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim().slice(0, 120);
  return value.length > 0 ? value : null;
}

type DailyStoreResolver = (challengeKey: string) => LocalEntryStore;

function createDailyStoreResolver(
  storage: Storage,
  maxEntries: number,
): DailyStoreResolver {
  const cache = new Map<string, LocalEntryStore>();
  return (challengeKey: string) => {
    const normalized = normalizeChallengeKey(challengeKey);
    const existing = cache.get(normalized);
    if (existing) {
      return existing;
    }
    const created = new LocalEntryStore(
      `torus-daily-scores-v1:${normalized}`,
      storage,
      maxEntries,
    );
    cache.set(normalized, created);
    return created;
  };
}

function normalizeChallengeKey(challengeKey: string): string {
  const trimmed = challengeKey.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return "unknown";
}
