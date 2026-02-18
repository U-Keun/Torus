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

interface RawReplayInputEvent {
  time: number;
  move: ReplayMove;
}

interface RawDailyReplayProof {
  version: number;
  difficulty: number;
  seed: number;
  finalTime: number;
  finalScore: number;
  finalLevel: number;
  inputs: ReadonlyArray<RawReplayInputEvent>;
}

export interface ScoreEntry {
  user: string;
  score: number;
  level: number;
  date: string;
  skillUsage: SkillUsageEntry[];
  isMe?: boolean;
  replayProof?: DailyReplayProof;
}

export interface DailyChallengeStatus {
  challengeKey: string;
  attemptsUsed: number;
  attemptsLeft: number;
  maxAttempts: number;
  canSubmit: boolean;
  hasActiveAttempt: boolean;
}

export interface DailyAttemptStartResult extends DailyChallengeStatus {
  accepted: boolean;
  resumed: boolean;
  attemptToken: string | null;
}

export interface DailyAttemptForfeitResult extends DailyChallengeStatus {
  accepted: boolean;
}

export interface DailyChallengeSubmitResult extends DailyChallengeStatus {
  accepted: boolean;
  improved: boolean;
}

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
  add(entry: ScoreEntry, replayProof: DailyReplayProof): Promise<void>;
  topPersonal(limit?: number): Promise<ScoreEntry[]>;
  addPersonal(entry: ScoreEntry): Promise<void>;
  topDaily(challengeKey: string, limit?: number): Promise<ScoreEntry[]>;
  startDailyAttempt(challengeKey: string): Promise<DailyAttemptStartResult>;
  addDaily(
    challengeKey: string,
    attemptToken: string,
    entry: ScoreEntry,
    replayProof: DailyReplayProof,
  ): Promise<DailyChallengeSubmitResult>;
  forfeitDailyAttempt(
    challengeKey: string,
    attemptToken: string,
  ): Promise<DailyAttemptForfeitResult>;
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
          replayProof: row.replayProof ?? current.replayProof,
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
          replayProof: normalizeReplayProof(entry.replayProof),
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

  public add(entry: ScoreEntry, _replayProof: DailyReplayProof): Promise<void> {
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

  public startDailyAttempt(challengeKey: string): Promise<DailyAttemptStartResult> {
    const normalized = normalizeChallengeKey(challengeKey);
    const status = this.getLocalDailyStatus(normalized);
    const activeAttemptToken = readDailyActiveAttemptToken(this.storage, normalized);
    if (activeAttemptToken) {
      return Promise.resolve({
        ...status,
        accepted: true,
        resumed: true,
        attemptToken: activeAttemptToken,
      });
    }
    if (!status.canSubmit) {
      return Promise.resolve({
        ...status,
        accepted: false,
        resumed: false,
        attemptToken: null,
      });
    }
    this.setLocalDailyAttempts(normalized, status.attemptsUsed + 1);
    const attemptToken = createLocalAttemptToken(normalized);
    writeDailyActiveAttemptToken(this.storage, normalized, attemptToken);
    const startedStatus = this.getLocalDailyStatus(normalized);
    return Promise.resolve({
      ...startedStatus,
      accepted: true,
      resumed: false,
      attemptToken,
    });
  }

  public async addDaily(
    challengeKey: string,
    attemptToken: string,
    entry: ScoreEntry,
    _replayProof: DailyReplayProof,
  ): Promise<DailyChallengeSubmitResult> {
    const normalized = normalizeChallengeKey(challengeKey);
    const status = this.getLocalDailyStatus(normalized);
    const activeAttemptToken = readDailyActiveAttemptToken(this.storage, normalized);
    if (!activeAttemptToken || activeAttemptToken !== attemptToken) {
      return {
        ...status,
        accepted: false,
        improved: false,
      };
    }
    const currentBest = (await this.resolveDailyStore(normalized).top(1))[0] ?? null;
    const improved = isEntryBetter(entry, currentBest);
    await this.resolveDailyStore(normalized).add({
      ...entry,
      isMe: true,
    });
    clearDailyActiveAttemptToken(this.storage, normalized);
    const nextStatus = this.getLocalDailyStatus(normalized);
    return {
      ...nextStatus,
      accepted: true,
      improved,
    };
  }

  public forfeitDailyAttempt(
    challengeKey: string,
    attemptToken: string,
  ): Promise<DailyAttemptForfeitResult> {
    const normalized = normalizeChallengeKey(challengeKey);
    const activeAttemptToken = readDailyActiveAttemptToken(this.storage, normalized);
    if (!activeAttemptToken || activeAttemptToken !== attemptToken) {
      return Promise.resolve({
        ...this.getLocalDailyStatus(normalized),
        accepted: false,
      });
    }
    clearDailyActiveAttemptToken(this.storage, normalized);
    return Promise.resolve({
      ...this.getLocalDailyStatus(normalized),
      accepted: true,
    });
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
    const hasActiveAttempt = Boolean(readDailyActiveAttemptToken(this.storage, normalized));
    return toDailyChallengeStatus(normalized, attemptsUsed, hasActiveAttempt);
  }

  private setLocalDailyAttempts(challengeKey: string, attemptsUsed: number): DailyChallengeStatus {
    const normalized = normalizeChallengeKey(challengeKey);
    writeDailyAttempts(this.storage, normalized, attemptsUsed);
    const hasActiveAttempt = Boolean(readDailyActiveAttemptToken(this.storage, normalized));
    return toDailyChallengeStatus(normalized, attemptsUsed, hasActiveAttempt);
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

  public async add(entry: ScoreEntry, replayProof: DailyReplayProof): Promise<void> {
    await this.globalStore.add({
      ...entry,
      isMe: true,
    });
    try {
      await invoke("submit_global_score", {
        entry,
        replayProof,
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

  public async startDailyAttempt(challengeKey: string): Promise<DailyAttemptStartResult> {
    const result = await invoke<DailyAttemptStartResult>("start_daily_attempt", {
      challengeKey,
      supabaseUrl: this.supabaseUrl || null,
      supabaseAnonKey: this.supabaseAnonKey || null,
    });
    return normalizeDailyAttemptStartResult(result, challengeKey);
  }

  public async addDaily(
    challengeKey: string,
    attemptToken: string,
    entry: ScoreEntry,
    replayProof: DailyReplayProof,
  ): Promise<DailyChallengeSubmitResult> {
    const result = await invoke<DailyChallengeSubmitResult>("submit_daily_score", {
      challengeKey,
      attemptToken,
      entry,
      replayProof,
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

  public async forfeitDailyAttempt(
    challengeKey: string,
    attemptToken: string,
  ): Promise<DailyAttemptForfeitResult> {
    const result = await invoke<DailyAttemptForfeitResult>("forfeit_daily_attempt", {
      challengeKey,
      attemptToken,
      supabaseUrl: this.supabaseUrl || null,
      supabaseAnonKey: this.supabaseAnonKey || null,
    });
    return normalizeDailyAttemptForfeitResult(result, challengeKey);
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
        typeof record.replayProof === "undefined" ||
        this.isReplayProof(record.replayProof)
      ) &&
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

  private isReplayProof(raw: unknown): raw is RawDailyReplayProof {
    if (!raw || typeof raw !== "object") {
      return false;
    }
    const row = raw as Record<string, unknown>;
    if (
      row.version !== 1 ||
      (row.difficulty !== 1 && row.difficulty !== 2 && row.difficulty !== 3) ||
      typeof row.seed !== "number" ||
      !Number.isFinite(row.seed) ||
      typeof row.finalTime !== "number" ||
      !Number.isFinite(row.finalTime) ||
      typeof row.finalScore !== "number" ||
      !Number.isFinite(row.finalScore) ||
      typeof row.finalLevel !== "number" ||
      !Number.isFinite(row.finalLevel)
    ) {
      return false;
    }
    return Array.isArray(row.inputs) && row.inputs.every((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const event = entry as Record<string, unknown>;
      return (
        typeof event.time === "number" &&
        Number.isFinite(event.time) &&
        (
          event.move === "left" ||
          event.move === "right" ||
          event.move === "up" ||
          event.move === "down"
        )
      );
    });
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

function normalizeReplayProof(raw: unknown): DailyReplayProof | undefined {
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
  const inputs = normalizeReplayInputs(record.inputs);
  return {
    version: 1,
    difficulty,
    seed: Math.trunc(seed) >>> 0,
    finalTime: Math.max(0, Math.trunc(finalTime)),
    finalScore: Math.max(0, Math.trunc(finalScore)),
    finalLevel: Math.max(0, Math.trunc(finalLevel)),
    inputs,
  };
}

function normalizeReplayInputs(raw: unknown): ReplayInputEvent[] {
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
    if (
      typeof time !== "number" ||
      !Number.isFinite(time) ||
      (move !== "left" && move !== "right" && move !== "up" && move !== "down")
    ) {
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
  }
  return normalized;
}

type DailyStoreResolver = (challengeKey: string) => LocalEntryStore;
const DAILY_CHALLENGE_MAX_ATTEMPTS = 3;
const DAILY_ATTEMPTS_STORAGE_PREFIX = "torus-daily-attempts-v1:";
const DAILY_ACTIVE_ATTEMPT_TOKEN_STORAGE_PREFIX = "torus-daily-active-attempt-token-v1:";
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

function dailyActiveAttemptTokenStorageKey(challengeKey: string): string {
  return `${DAILY_ACTIVE_ATTEMPT_TOKEN_STORAGE_PREFIX}${challengeKey}`;
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

function readDailyActiveAttemptToken(storage: Storage, challengeKey: string): string | null {
  try {
    const raw = storage.getItem(dailyActiveAttemptTokenStorageKey(challengeKey));
    if (!raw) {
      return null;
    }
    const token = raw.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function writeDailyActiveAttemptToken(
  storage: Storage,
  challengeKey: string,
  attemptToken: string,
): void {
  try {
    const token = attemptToken.trim();
    if (token.length === 0) {
      storage.removeItem(dailyActiveAttemptTokenStorageKey(challengeKey));
      return;
    }
    storage.setItem(dailyActiveAttemptTokenStorageKey(challengeKey), token);
  } catch {
    // Ignore local storage failures.
  }
}

function clearDailyActiveAttemptToken(storage: Storage, challengeKey: string): void {
  try {
    storage.removeItem(dailyActiveAttemptTokenStorageKey(challengeKey));
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

function toDailyChallengeStatus(
  challengeKey: string,
  attemptsUsed: number,
  hasActiveAttempt: boolean = false,
): DailyChallengeStatus {
  const used = clampAttempts(attemptsUsed);
  const attemptsLeft = Math.max(0, DAILY_CHALLENGE_MAX_ATTEMPTS - used);
  return {
    challengeKey,
    attemptsUsed: used,
    attemptsLeft,
    maxAttempts: DAILY_CHALLENGE_MAX_ATTEMPTS,
    canSubmit: attemptsLeft > 0,
    hasActiveAttempt,
  };
}

function normalizeDailyChallengeStatus(
  raw: DailyChallengeStatus,
  fallbackChallengeKey: string,
): DailyChallengeStatus {
  const challengeKey = normalizeChallengeKey(raw.challengeKey || fallbackChallengeKey);
  return toDailyChallengeStatus(
    challengeKey,
    raw.attemptsUsed,
    raw.hasActiveAttempt === true,
  );
}

function normalizeDailyAttemptStartResult(
  raw: DailyAttemptStartResult,
  fallbackChallengeKey: string,
): DailyAttemptStartResult {
  const status = normalizeDailyChallengeStatus(raw, fallbackChallengeKey);
  const token = typeof raw.attemptToken === "string" ? raw.attemptToken.trim() : "";
  return {
    ...status,
    accepted: raw.accepted === true,
    resumed: raw.resumed === true,
    attemptToken: token.length > 0 ? token : null,
  };
}

function normalizeDailyAttemptForfeitResult(
  raw: DailyAttemptForfeitResult,
  fallbackChallengeKey: string,
): DailyAttemptForfeitResult {
  const status = normalizeDailyChallengeStatus(raw, fallbackChallengeKey);
  return {
    ...status,
    accepted: raw.accepted === true,
  };
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

function createLocalAttemptToken(challengeKey: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${challengeKey}-${timestamp}-${random}`;
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
