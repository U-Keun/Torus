import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface ScoreEntry {
  user: string;
  score: number;
  level: number;
  date: string;
}

export interface ScoreboardStore {
  top(limit?: number): Promise<ScoreEntry[]>;
  add(entry: ScoreEntry): Promise<void>;
  topPersonal(limit?: number): Promise<ScoreEntry[]>;
  addPersonal(entry: ScoreEntry): Promise<void>;
}

interface ScoreRow {
  player_name: string;
  score: number;
  level: number;
  created_at: string;
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
    return `${entry.user}::${entry.score}::${entry.level}::${entry.date}`;
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
      typeof record.date === "string"
    );
  }
}

class LocalOnlyScoreboardStore implements ScoreboardStore {
  constructor(
    private readonly globalStore: LocalEntryStore,
    private readonly personalStore: LocalEntryStore,
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
}

class SupabaseScoreboardStore implements ScoreboardStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly globalStore: LocalEntryStore,
    private readonly personalStore: LocalEntryStore,
    private readonly table = "scores",
  ) {}

  public async top(limit = 10): Promise<ScoreEntry[]> {
    try {
      const { data, error } = await this.client
        .from(this.table)
        .select("player_name, score, level, created_at")
        .order("score", { ascending: false })
        .order("level", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error || !Array.isArray(data)) {
        console.warn("Failed to load scores from Supabase. Using local cache.", error);
        return this.globalStore.top(limit);
      }

      const mapped = data
        .filter((row): row is ScoreRow => this.isScoreRow(row))
        .map((row) => ({
          user: row.player_name,
          score: row.score,
          level: row.level,
          date: row.created_at,
        }));
      this.globalStore.merge(mapped);
      return mapped;
    } catch (error) {
      console.warn("Failed to load scores from Supabase. Using local cache.", error);
      return this.globalStore.top(limit);
    }
  }

  public async add(entry: ScoreEntry): Promise<void> {
    await this.globalStore.add(entry);
    try {
      const { error } = await this.client.from(this.table).insert({
        player_name: entry.user,
        score: entry.score,
        level: entry.level,
        created_at: entry.date,
      });
      if (error) {
        console.warn("Failed to save score to Supabase. Score kept locally.", error);
      }
    } catch (error) {
      console.warn("Failed to save score to Supabase. Score kept locally.", error);
    }
  }

  public topPersonal(limit = 10): Promise<ScoreEntry[]> {
    return this.personalStore.top(limit);
  }

  public addPersonal(entry: ScoreEntry): Promise<void> {
    return this.personalStore.add(entry);
  }

  private isScoreRow(entry: unknown): entry is ScoreRow {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return (
      typeof record.player_name === "string" &&
      typeof record.score === "number" &&
      typeof record.level === "number" &&
      typeof record.created_at === "string"
    );
  }
}

export function createScoreboardStore(): ScoreboardStore {
  const globalStore = new LocalEntryStore("torus-scores-v1", window.localStorage, 300);
  const personalStore = new LocalEntryStore("torus-personal-scores-v1", window.localStorage, 500);
  const supabaseUrl = readEnv("VITE_SUPABASE_URL");
  const supabaseAnonKey = readEnv("VITE_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.info("Supabase env is not configured. Using local scoreboard only.");
    return new LocalOnlyScoreboardStore(globalStore, personalStore);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  return new SupabaseScoreboardStore(supabase, globalStore, personalStore);
}

function readEnv(key: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string {
  const value = import.meta.env[key];
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
