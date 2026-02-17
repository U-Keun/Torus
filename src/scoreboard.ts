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
  isMe?: boolean;
}

export interface DailyChallengeStatus {
  challengeKey: string;
  attemptsUsed: number;
  attemptsLeft: number;
  maxAttempts: number;
  canSubmit: boolean;
}

export interface DailyChallengeSubmitResult extends DailyChallengeStatus {
  accepted: boolean;
  improved: boolean;
}

export interface DailyBadgeStatus {
  currentStreak: number;
  maxStreak: number;
  highestBadgePower: number | null;
  highestBadgeDays: number | null;
  nextBadgePower: number | null;
  nextBadgeDays: number | null;
  daysToNextBadge: number | null;
}

export interface ScoreboardStore {
  top(limit?: number): Promise<ScoreEntry[]>;
  add(entry: ScoreEntry): Promise<void>;
  topPersonal(limit?: number): Promise<ScoreEntry[]>;
  addPersonal(entry: ScoreEntry): Promise<void>;
  topDaily(challengeKey: string, limit?: number): Promise<ScoreEntry[]>;
  addDaily(challengeKey: string, entry: ScoreEntry): Promise<DailyChallengeSubmitResult>;
  getDailyStatus(challengeKey: string): Promise<DailyChallengeStatus>;
  getDailyBadgeStatus(challengeKey: string): Promise<DailyBadgeStatus>;
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
    scores.push({ ...entry, isMe: entry.isMe === true });
    this.save(this.sort(scores).slice(0, this.maxEntries));
  }

  public merge(entries: ReadonlyArray<ScoreEntry>): void {
    const existing = this.load();
    const all = [...existing, ...entries];
    const deduped = new Map<string, ScoreEntry>();
    for (const row of all) {
      const key = this.entryKey(row);
      const current = deduped.get(key);
      if (current) {
        deduped.set(key, {
          ...row,
          isMe: current.isMe === true || row.isMe === true,
        });
        continue;
      }
      deduped.set(key, {
        ...row,
        isMe: row.isMe === true,
      });
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
          isMe: entry.isMe === true,
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
      (typeof record.isMe === "boolean" || typeof record.isMe === "undefined") &&
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
    private readonly storage: Storage = window.localStorage,
  ) {}

  public top(limit = 10): Promise<ScoreEntry[]> {
    return this.globalStore.top(limit);
  }

  public add(entry: ScoreEntry): Promise<void> {
    return this.globalStore.add({
      ...entry,
      isMe: true,
    });
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

  public async addDaily(
    challengeKey: string,
    entry: ScoreEntry,
  ): Promise<DailyChallengeSubmitResult> {
    const status = this.getLocalDailyStatus(challengeKey);
    if (!status.canSubmit) {
      return {
        ...status,
        accepted: false,
        improved: false,
      };
    }
    const currentBest = (await this.resolveDailyStore(challengeKey).top(1))[0] ?? null;
    const improved = isEntryBetter(entry, currentBest);
    await this.resolveDailyStore(challengeKey).add({
      ...entry,
      isMe: true,
    });
    const nextStatus = this.setLocalDailyAttempts(
      challengeKey,
      status.attemptsUsed + 1,
    );
    return {
      ...nextStatus,
      accepted: true,
      improved,
    };
  }

  public getDailyStatus(challengeKey: string): Promise<DailyChallengeStatus> {
    return Promise.resolve(this.getLocalDailyStatus(challengeKey));
  }

  public getDailyBadgeStatus(challengeKey: string): Promise<DailyBadgeStatus> {
    const normalized = normalizeChallengeKey(challengeKey);
    const keys = readAcceptedDailyChallengeKeys(this.storage);
    return Promise.resolve(computeDailyBadgeStatus(keys, normalized));
  }

  private getLocalDailyStatus(challengeKey: string): DailyChallengeStatus {
    const normalized = normalizeChallengeKey(challengeKey);
    const attemptsUsed = readDailyAttempts(this.storage, normalized);
    return toDailyChallengeStatus(normalized, attemptsUsed);
  }

  private setLocalDailyAttempts(challengeKey: string, attemptsUsed: number): DailyChallengeStatus {
    const normalized = normalizeChallengeKey(challengeKey);
    writeDailyAttempts(this.storage, normalized, attemptsUsed);
    return toDailyChallengeStatus(normalized, attemptsUsed);
  }
}

class TauriScoreboardStore implements ScoreboardStore {
  constructor(
    private readonly globalStore: LocalEntryStore,
    private readonly personalStore: LocalEntryStore,
    private readonly resolveDailyStore: DailyStoreResolver,
    private readonly supabaseUrl: string,
    private readonly supabaseAnonKey: string,
    private readonly storage: Storage = window.localStorage,
  ) {}

  public async top(limit = 10): Promise<ScoreEntry[]> {
    try {
      const rows = await invoke<ScoreEntry[]>("fetch_global_scores", {
        limit,
        supabaseUrl: this.supabaseUrl || null,
        supabaseAnonKey: this.supabaseAnonKey || null,
      });
      const mapped = this.normalizeRemoteRows(rows);
      this.globalStore.merge(mapped);
      return mapped.slice(0, limit);
    } catch (error) {
      console.warn("Failed to load scores from Tauri backend. Using local cache.", error);
      return this.globalStore.top(limit);
    }
  }

  public async add(entry: ScoreEntry): Promise<void> {
    await this.globalStore.add({
      ...entry,
      isMe: true,
    });
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

  public async topDaily(challengeKey: string, limit = 10): Promise<ScoreEntry[]> {
    try {
      const rows = await invoke<ScoreEntry[]>("fetch_daily_scores", {
        challengeKey,
        limit,
        supabaseUrl: this.supabaseUrl || null,
        supabaseAnonKey: this.supabaseAnonKey || null,
      });
      const mapped = this.normalizeRemoteRows(rows);
      this.resolveDailyStore(challengeKey).merge(mapped);
      return mapped.slice(0, limit);
    } catch (error) {
      console.warn("Failed to load daily scores from Tauri backend. Using local cache.", error);
      return this.resolveDailyStore(challengeKey).top(limit);
    }
  }

  public async addDaily(
    challengeKey: string,
    entry: ScoreEntry,
  ): Promise<DailyChallengeSubmitResult> {
    const result = await invoke<DailyChallengeSubmitResult>("submit_daily_score", {
      challengeKey,
      entry,
      supabaseUrl: this.supabaseUrl || null,
      supabaseAnonKey: this.supabaseAnonKey || null,
    });
    const normalized = normalizeDailyChallengeSubmitResult(result, challengeKey);
    if (normalized.accepted) {
      await this.resolveDailyStore(challengeKey).add({
        ...entry,
        isMe: true,
      });
      writeDailyAttempts(window.localStorage, normalized.challengeKey, normalized.attemptsUsed);
    }
    return normalized;
  }

  public async getDailyStatus(challengeKey: string): Promise<DailyChallengeStatus> {
    const status = await invoke<DailyChallengeStatus>("fetch_daily_status", {
      challengeKey,
      supabaseUrl: this.supabaseUrl || null,
      supabaseAnonKey: this.supabaseAnonKey || null,
    });
    return normalizeDailyChallengeStatus(status, challengeKey);
  }

  public getDailyBadgeStatus(challengeKey: string): Promise<DailyBadgeStatus> {
    const normalized = normalizeChallengeKey(challengeKey);
    const keys = readAcceptedDailyChallengeKeys(this.storage);
    return Promise.resolve(computeDailyBadgeStatus(keys, normalized));
  }

  private normalizeRemoteRows(rows: ReadonlyArray<ScoreEntry>): ScoreEntry[] {
    return rows
      .filter((entry): entry is ScoreEntry => this.isScoreEntry(entry))
      .map((entry) => ({
        user: entry.user,
        score: entry.score,
        level: entry.level,
        date: entry.date,
        skillUsage: this.normalizeSkillUsage(entry.skillUsage),
        isMe: entry.isMe === true,
      }));
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
      (typeof record.isMe === "boolean" || typeof record.isMe === "undefined") &&
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
    return new LocalOnlyScoreboardStore(
      globalStore,
      personalStore,
      resolveDailyStore,
      window.localStorage,
    );
  }

  return new TauriScoreboardStore(
    globalStore,
    personalStore,
    resolveDailyStore,
    supabaseUrl,
    supabaseAnonKey,
    window.localStorage,
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
const DAILY_CHALLENGE_MAX_ATTEMPTS = 3;
const DAILY_ATTEMPTS_STORAGE_PREFIX = "torus-daily-attempts-v1:";
const DAILY_BADGE_MAX_POWER = 9;

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

function dailyAttemptsStorageKey(challengeKey: string): string {
  return `${DAILY_ATTEMPTS_STORAGE_PREFIX}${challengeKey}`;
}

function readDailyAttempts(storage: Storage, challengeKey: string): number {
  try {
    const raw = storage.getItem(dailyAttemptsStorageKey(challengeKey));
    if (!raw) {
      return 0;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return clampAttempts(value);
  } catch {
    return 0;
  }
}

function writeDailyAttempts(storage: Storage, challengeKey: string, attemptsUsed: number): void {
  try {
    storage.setItem(dailyAttemptsStorageKey(challengeKey), String(clampAttempts(attemptsUsed)));
  } catch {
    // Ignore local storage failures.
  }
}

function clampAttempts(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(DAILY_CHALLENGE_MAX_ATTEMPTS, Math.max(0, Math.floor(value)));
}

function toDailyChallengeStatus(challengeKey: string, attemptsUsed: number): DailyChallengeStatus {
  const used = clampAttempts(attemptsUsed);
  const attemptsLeft = Math.max(0, DAILY_CHALLENGE_MAX_ATTEMPTS - used);
  return {
    challengeKey,
    attemptsUsed: used,
    attemptsLeft,
    maxAttempts: DAILY_CHALLENGE_MAX_ATTEMPTS,
    canSubmit: attemptsLeft > 0,
  };
}

function normalizeDailyChallengeStatus(
  raw: DailyChallengeStatus,
  fallbackChallengeKey: string,
): DailyChallengeStatus {
  const challengeKey = normalizeChallengeKey(raw.challengeKey || fallbackChallengeKey);
  return toDailyChallengeStatus(challengeKey, raw.attemptsUsed);
}

function normalizeDailyChallengeSubmitResult(
  raw: DailyChallengeSubmitResult,
  fallbackChallengeKey: string,
): DailyChallengeSubmitResult {
  const status = normalizeDailyChallengeStatus(raw, fallbackChallengeKey);
  return {
    ...status,
    accepted: raw.accepted === true,
    improved: raw.improved === true,
  };
}

function readAcceptedDailyChallengeKeys(storage: Storage): string[] {
  const keys = new Set<string>();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(DAILY_ATTEMPTS_STORAGE_PREFIX)) {
      continue;
    }
    const challengeKey = normalizeChallengeKey(key.slice(DAILY_ATTEMPTS_STORAGE_PREFIX.length));
    if (!isValidChallengeKey(challengeKey)) {
      continue;
    }
    const attempts = readDailyAttempts(storage, challengeKey);
    if (attempts > 0) {
      keys.add(challengeKey);
    }
  }
  return [...keys].sort((a, b) => compareChallengeKeys(a, b));
}

function computeDailyBadgeStatus(
  acceptedChallengeKeys: ReadonlyArray<string>,
  challengeKey: string,
): DailyBadgeStatus {
  const normalized = acceptedChallengeKeys
    .map((value) => normalizeChallengeKey(value))
    .filter((value) => isValidChallengeKey(value))
    .sort((a, b) => compareChallengeKeys(a, b));

  if (normalized.length === 0) {
    return badgeStatusFromStreaks(0, 0);
  }

  let maxStreak = 1;
  let currentRun = 1;
  let latestRun = 1;
  for (let index = 1; index < normalized.length; index += 1) {
    if (isNextChallengeDay(normalized[index - 1], normalized[index])) {
      currentRun += 1;
    } else {
      currentRun = 1;
    }
    if (currentRun > maxStreak) {
      maxStreak = currentRun;
    }
  }

  for (let index = normalized.length - 1; index > 0; index -= 1) {
    if (isNextChallengeDay(normalized[index - 1], normalized[index])) {
      latestRun += 1;
      continue;
    }
    break;
  }

  const latestKey = normalized[normalized.length - 1];
  const currentStreak = (
    latestKey === challengeKey || isNextChallengeDay(latestKey, challengeKey)
  )
    ? latestRun
    : 0;
  return badgeStatusFromStreaks(currentStreak, maxStreak);
}

function badgeStatusFromStreaks(currentStreak: number, maxStreak: number): DailyBadgeStatus {
  const highestBadgePower = resolveBadgePower(maxStreak);
  const highestBadgeDays = highestBadgePower === null ? null : 2 ** highestBadgePower;
  const nextBadgePower = highestBadgePower === null
    ? 0
    : highestBadgePower >= DAILY_BADGE_MAX_POWER
      ? null
      : highestBadgePower + 1;
  const nextBadgeDays = nextBadgePower === null ? null : 2 ** nextBadgePower;
  const daysToNextBadge = nextBadgeDays === null
    ? null
    : Math.max(0, nextBadgeDays - currentStreak);

  return {
    currentStreak,
    maxStreak,
    highestBadgePower,
    highestBadgeDays,
    nextBadgePower,
    nextBadgeDays,
    daysToNextBadge,
  };
}

function resolveBadgePower(streak: number): number | null {
  if (streak < 1) {
    return null;
  }
  let power = 0;
  while (power < DAILY_BADGE_MAX_POWER && (2 ** (power + 1)) <= streak) {
    power += 1;
  }
  return power;
}

function isNextChallengeDay(previous: string, next: string): boolean {
  const previousTs = challengeKeyToUtcTimestamp(previous);
  const nextTs = challengeKeyToUtcTimestamp(next);
  if (previousTs === null || nextTs === null) {
    return false;
  }
  return nextTs - previousTs === 24 * 60 * 60 * 1000;
}

function challengeKeyToUtcTimestamp(challengeKey: string): number | null {
  if (!isValidChallengeKey(challengeKey)) {
    return null;
  }
  const [yearRaw, monthRaw, dayRaw] = challengeKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return Date.UTC(year, month - 1, day);
}

function compareChallengeKeys(left: string, right: string): number {
  const leftTs = challengeKeyToUtcTimestamp(left);
  const rightTs = challengeKeyToUtcTimestamp(right);
  if (leftTs === null || rightTs === null) {
    return left.localeCompare(right);
  }
  return leftTs - rightTs;
}

function isValidChallengeKey(challengeKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(challengeKey);
}

function isEntryBetter(entry: ScoreEntry, best: ScoreEntry | null): boolean {
  if (!best) {
    return true;
  }
  if (entry.score !== best.score) {
    return entry.score > best.score;
  }
  return entry.level > best.level;
}
