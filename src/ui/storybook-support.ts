import type { ScoreEntry } from "../scoreboard";
import type { Skill } from "../skills/types";
import { directionSequenceToLabel, skillHotkeyLabel } from "../skills/types";
import { renderDailyBadgeIcon } from "./badge-icons";
import { mountTorusLayout, type TorusDom } from "./layout";
import { type GameStatus, TorusRenderer } from "./renderer";
import { type CustomThemeDraft, ThemeManager, TORUS_THEMES } from "./theme";

export type StoryScoreboardView = "global" | "personal" | "daily";
export type StoryTone = "info" | "good" | "warn";
export type SkillRunnerTone = "idle" | "active" | "queue";

export interface StorySurface {
  canvas: HTMLDivElement;
  dom: TorusDom;
  renderer: TorusRenderer;
  themeManager: ThemeManager;
}

interface ShellOptions {
  score?: number;
  level?: number;
  pole?: string;
  status?: GameStatus;
  gaugePercent?: number;
  difficulty?: 1 | 2 | 3;
  difficultyDisabled?: boolean;
  modeLabel?: string;
  challengeInfo?: string;
}

interface ScoreboardOptions {
  view: StoryScoreboardView;
  entries?: ReadonlyArray<ScoreEntry>;
  loadingMessage?: string;
  title?: string;
  allowSkillImport?: boolean;
  showMeTag?: boolean;
  showGlobalRankBadge?: boolean;
  meBadge?: {
    label: string;
    title: string;
    iconMarkup?: string;
  };
}

interface DailyBadgeOptions {
  power: number;
  currentStreak: number;
  maxStreak: number;
  nextBadgePower?: number | null;
  nextBadgeDays?: number | null;
  daysToNextBadge?: number | null;
}

interface ThemeModalOptions {
  draft?: CustomThemeDraft;
  message?: string;
  tone?: StoryTone;
}

interface SkillsModalOptions {
  skills: ReadonlyArray<Skill>;
  runnerText?: string;
  runnerTone?: SkillRunnerTone;
  processing?: boolean;
  formMessage?: string;
  formTone?: StoryTone;
  editingSkillId?: string | null;
}

export const SAMPLE_GLOBAL_SCORES: ScoreEntry[] = [
  {
    user: "TorusAce",
    score: 15800,
    level: 21,
    date: "2026-03-11T09:00:00.000Z",
    skillUsage: [],
  },
  {
    user: "Keunsong",
    score: 12400,
    level: 18,
    date: "2026-03-11T09:30:00.000Z",
    isMe: true,
    skillUsage: [
      {
        name: "Pole Sweep",
        hotkey: "Slash",
        command: "L ( ) U",
      },
    ],
  },
  {
    user: "AsciiFan",
    score: 11800,
    level: 17,
    date: "2026-03-11T10:10:00.000Z",
    skillUsage: [],
  },
];

export const SAMPLE_DAILY_SCORES: ScoreEntry[] = [
  {
    user: "DailyMaster",
    score: 9800,
    level: 14,
    date: "2026-03-11T08:10:00.000Z",
    skillUsage: [],
  },
  {
    user: "Keunsong",
    score: 9400,
    level: 13,
    date: "2026-03-11T08:40:00.000Z",
    isMe: true,
    skillUsage: [
      {
        name: "Quick Lift",
        hotkey: "KeyQ",
        command: "U U ( )",
      },
    ],
  },
  {
    user: "ArcPlayer",
    score: 9100,
    level: 13,
    date: "2026-03-11T09:05:00.000Z",
    skillUsage: [],
  },
];

export const SAMPLE_PERSONAL_SCORES: ScoreEntry[] = [
  {
    user: "Keunsong",
    score: 12400,
    level: 18,
    date: "2026-03-11T09:30:00.000Z",
    skillUsage: [],
  },
  {
    user: "Keunsong",
    score: 11800,
    level: 17,
    date: "2026-03-10T18:10:00.000Z",
    skillUsage: [],
  },
  {
    user: "Keunsong",
    score: 9600,
    level: 14,
    date: "2026-03-09T07:50:00.000Z",
    skillUsage: [],
  },
];

export const SAMPLE_SKILLS: Skill[] = [
  {
    id: "skill-1",
    name: "Pole Sweep",
    sequence: ["left", "autoHorizontal", "autoHorizontalInverse", "up"],
    hotkey: "Slash",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt: "2026-03-10T09:00:00.000Z",
  },
  {
    id: "skill-2",
    name: "Quick Lift",
    sequence: ["up", "up", "right", "down"],
    hotkey: "KeyQ",
    createdAt: "2026-03-10T09:05:00.000Z",
    updatedAt: "2026-03-11T08:55:00.000Z",
  },
  {
    id: "skill-3",
    name: "Edge Return",
    sequence: ["autoHorizontalInverse", "down", "left", "up"],
    hotkey: null,
    createdAt: "2026-03-10T09:08:00.000Z",
    updatedAt: "2026-03-10T09:08:00.000Z",
  },
];

export const SAMPLE_CUSTOM_THEME: CustomThemeDraft = {
  colors: ["#ff6b57", "#53d6ff", "#ffe066", "#4da8ff", "#7a7cff"],
  text: "#fff0cf",
  glaze: "#fff2d8",
  glowColor: "#ff9b52",
  glowAlpha: 0.34,
};

export const SAMPLE_DAILY_ME_BADGE = {
  label: "2^3",
  title: "Highest badge: 2^3 (8 day tier) | Current streak: 6 days | Best streak: 9 days",
  iconMarkup: renderDailyBadgeIcon(3) ?? undefined,
};

export function createStorySurface(): StorySurface {
  const canvas = document.createElement("div");
  canvas.id = "app";
  canvas.style.width = "100%";
  canvas.style.height = "100vh";
  canvas.style.minHeight = "100vh";

  const dom = mountTorusLayout(canvas);
  const renderer = new TorusRenderer(dom);
  const themeManager = new ThemeManager(dom.themeChipEl, TORUS_THEMES, canvas);
  themeManager.apply(0);

  return {
    canvas,
    dom,
    renderer,
    themeManager,
  };
}

export function seedShell(surface: StorySurface, options: ShellOptions = {}): void {
  const {
    score = 12400,
    level = 18,
    pole = "3/8",
    status = "Paused",
    gaugePercent = 68,
    difficulty = 1,
    difficultyDisabled = false,
    modeLabel = "Mode: Classic",
    challengeInfo = "Classic mode",
  } = options;
  const { dom } = surface;

  dom.scoreEl.textContent = String(score);
  dom.levelEl.textContent = String(level);
  dom.poleCountEl.textContent = pole;
  dom.statusEl.textContent = status;
  dom.gaugeFillEl.style.width = `${Math.max(0, Math.min(100, gaugePercent))}%`;
  dom.difficultyEl.value = String(difficulty);
  dom.difficultyEl.disabled = difficultyDisabled;
  dom.modeBtn.textContent = modeLabel;
  dom.challengeInfoEl.textContent = challengeInfo;
  dom.updateNoticeEl.classList.add("hidden");
  dom.updateNoticeEl.classList.remove("required");
  dom.dailyBadgeEl.classList.add("hidden");
  dom.dailyBadgeEl.classList.remove("icon-badge");
  dom.dailyBadgeEl.innerHTML = "";
  dom.dailyBadgeEl.textContent = "";
}

export function renderScoreboardView(surface: StorySurface, options: ScoreboardOptions): void {
  const {
    view,
    entries = [],
    loadingMessage,
    title = resolveScoreboardTitle(view),
    allowSkillImport = view !== "personal",
    showMeTag = view === "global" || view === "daily",
    showGlobalRankBadge = view === "global",
    meBadge,
  } = options;
  const { dom, renderer } = surface;

  setScoreboardTabs(dom, view, title);
  if (loadingMessage) {
    renderer.renderScoreboardLoading(loadingMessage);
    return;
  }
  renderer.renderScoreboard(entries, {
    allowSkillImport,
    showMeTag,
    showGlobalRankBadge,
    meBadge,
  });
}

export function showDailyMode(surface: StorySurface, options: DailyBadgeOptions): void {
  const { dom } = surface;
  const badgeDays = 2 ** options.power;
  const nextBadgeDays = options.nextBadgeDays ?? null;
  const nextBadgePower = options.nextBadgePower ?? null;
  const daysToNextBadge = options.daysToNextBadge ?? null;
  const badgeMarkup = renderDailyBadgeIcon(options.power);

  dom.modeBtn.textContent = "Mode: Daily";
  dom.challengeInfoEl.textContent = "Daily Challenge: 2026-03-11 | 1/3 attempts left";
  dom.difficultyEl.value = "1";
  dom.difficultyEl.disabled = true;
  dom.dailyBadgeEl.classList.remove("hidden");
  if (badgeMarkup) {
    dom.dailyBadgeEl.classList.add("icon-badge");
    dom.dailyBadgeEl.innerHTML = badgeMarkup;
  } else {
    dom.dailyBadgeEl.classList.remove("icon-badge");
    dom.dailyBadgeEl.textContent = `Badge 2^${options.power}`;
  }
  dom.dailyBadgeEl.title = [
    `Highest badge: 2^${options.power} (${badgeDays} day tier).`,
    `Current streak: ${options.currentStreak} day${options.currentStreak === 1 ? "" : "s"}.`,
    `Best streak: ${options.maxStreak} day${options.maxStreak === 1 ? "" : "s"}.`,
    nextBadgePower !== null && nextBadgeDays !== null
      ? `Next badge: 2^${nextBadgePower} (${nextBadgeDays} day tier), ${daysToNextBadge ?? 0} left.`
      : "Top tier reached: 2^9 (512 days).",
  ].join("\n");
  dom.dailyBadgeEl.setAttribute(
    "aria-label",
    `Daily streak badge 2 to the power of ${options.power}, ${badgeDays} day tier`,
  );
}

export function showUpdateBanner(
  surface: StorySurface,
  message: string,
  options: { required?: boolean } = {},
): void {
  const { dom } = surface;
  dom.updateNoticeMessageEl.textContent = message;
  dom.updateNoticeEl.classList.remove("hidden");
  dom.updateNoticeEl.classList.toggle("required", options.required === true);
}

export function showNoticeDialog(surface: StorySurface, title: string, message: string): void {
  const { dom } = surface;
  dom.noticeTitleEl.textContent = title;
  dom.noticeMessageEl.textContent = message;
  dom.noticeModalEl.classList.remove("hidden");
}

export function showSessionRestoreDialog(surface: StorySurface, message: string): void {
  const { dom } = surface;
  dom.sessionRestoreMessageEl.textContent = message;
  dom.sessionRestoreModalEl.classList.remove("hidden");
}

export function showThemeModal(surface: StorySurface, options: ThemeModalOptions = {}): void {
  const { dom, themeManager } = surface;
  const draft = options.draft ?? SAMPLE_CUSTOM_THEME;
  themeManager.applyCustom(draft);
  fillThemeForm(dom, draft);
  setToneMessage(dom.themeCustomMessageEl, "theme-custom-message", options.message ?? "Preview applied. Save to keep this theme.", options.tone ?? "info");
  dom.themeCustomModalEl.classList.remove("hidden");
}

export function showSkillsModal(surface: StorySurface, options: SkillsModalOptions): void {
  const { dom } = surface;
  const {
    skills,
    runnerText = "Idle",
    runnerTone = "idle",
    processing = false,
    formMessage = "Create a skill and optionally assign a hotkey.",
    formTone = "info",
    editingSkillId = null,
  } = options;
  const editingSkill = editingSkillId
    ? skills.find((skill) => skill.id === editingSkillId) ?? null
    : null;

  dom.skillsModalEl.classList.remove("hidden");
  dom.skillRunStatusEl.textContent = runnerText;
  dom.skillRunStatusEl.className = "skills-run-status";
  if (runnerTone === "active") {
    dom.skillRunStatusEl.classList.add("active");
  } else if (runnerTone === "queue") {
    dom.skillRunStatusEl.classList.add("queue");
  }

  dom.skillsListEl.innerHTML = renderSkillsListMarkup(skills, processing);
  setToneMessage(dom.skillFormMessageEl, "skills-form-message", formMessage, formTone);
  if (editingSkill) {
    dom.skillNameEl.value = editingSkill.name;
    dom.skillSequenceEl.value = directionSequenceToLabel(editingSkill.sequence);
    dom.skillHotkeyEl.value = editingSkill.hotkey ? skillHotkeyLabel(editingSkill.hotkey) : "";
    dom.skillSaveBtn.textContent = "Update Skill";
    dom.skillCancelEditBtn.hidden = false;
  } else {
    dom.skillNameEl.value = "";
    dom.skillSequenceEl.value = "";
    dom.skillHotkeyEl.value = "";
    dom.skillSaveBtn.textContent = "Save Skill";
    dom.skillCancelEditBtn.hidden = true;
  }
}

export function showKeyGuideSkillsPage(surface: StorySurface, skills: ReadonlyArray<Skill>): void {
  const { dom } = surface;
  dom.keyPageBasicBtn.classList.remove("active");
  dom.keyPageBasicBtn.setAttribute("aria-pressed", "false");
  dom.keyPageSkillsBtn.classList.add("active");
  dom.keyPageSkillsBtn.setAttribute("aria-pressed", "true");
  dom.keyPageBasicEl.classList.add("hidden");
  dom.keyPageSkillsEl.classList.remove("hidden");
  dom.keySkillsListEl.innerHTML = renderKeySkillsMarkup(skills);
}

function resolveScoreboardTitle(view: StoryScoreboardView): string {
  if (view === "personal") {
    return "PERSONAL TOP 10";
  }
  if (view === "daily") {
    return "DAILY CHALLENGE TOP 10 | 2026-03-11";
  }
  return "GLOBAL TOP 10";
}

function setScoreboardTabs(dom: TorusDom, view: StoryScoreboardView, title: string): void {
  const globalMode = view === "global";
  const personalMode = view === "personal";
  const dailyMode = view === "daily";

  dom.globalScoreBtn.classList.toggle("active", globalMode);
  dom.personalScoreBtn.classList.toggle("active", personalMode);
  dom.dailyScoreBtn.classList.toggle("active", dailyMode);
  dom.globalScoreBtn.setAttribute("aria-pressed", globalMode ? "true" : "false");
  dom.personalScoreBtn.setAttribute("aria-pressed", personalMode ? "true" : "false");
  dom.dailyScoreBtn.setAttribute("aria-pressed", dailyMode ? "true" : "false");
  dom.scoreTitleEl.textContent = title;
  dom.scoreListEl.classList.toggle("global-mode", globalMode);
}

function setToneMessage(
  element: HTMLParagraphElement,
  baseClass: string,
  message: string,
  tone: StoryTone,
): void {
  element.textContent = message;
  element.className = baseClass;
  if (tone === "good") {
    element.classList.add("good");
  } else if (tone === "warn") {
    element.classList.add("warn");
  }
}

function fillThemeForm(dom: TorusDom, draft: CustomThemeDraft): void {
  dom.themeColor0El.value = draft.colors[0];
  dom.themeColor1El.value = draft.colors[1];
  dom.themeColor2El.value = draft.colors[2];
  dom.themeColor3El.value = draft.colors[3];
  dom.themeColor4El.value = draft.colors[4];
  dom.themeTextColorEl.value = draft.text;
  dom.themeGlazeColorEl.value = draft.glaze;
  dom.themeGlowColorEl.value = draft.glowColor;
  dom.themeGlowAlphaEl.value = String(Math.round(draft.glowAlpha * 100));
  dom.themeGlowAlphaValueEl.textContent = `${Math.round(draft.glowAlpha * 100)}%`;
}

function renderSkillsListMarkup(skills: ReadonlyArray<Skill>, processing: boolean): string {
  if (skills.length === 0) {
    return '<li class="skills-empty">No skills yet.</li>';
  }
  return skills
    .map((skill) => {
      const sequence = directionSequenceToLabel(skill.sequence);
      const hotkey = skill.hotkey ? ` | Key ${skillHotkeyLabel(skill.hotkey)}` : "";
      const disabledAttr = processing ? "disabled" : "";
      return `<li class="skill-row">
        <div class="skill-row-top">
          <span class="skill-name">${escapeHtml(skill.name)}</span>
          <span class="skill-step">${skill.sequence.length} steps${escapeHtml(hotkey)}</span>
        </div>
        <div class="skill-sequence">${escapeHtml(sequence)}</div>
        <div class="skill-actions">
          <button type="button" data-action="run" ${disabledAttr}>Run</button>
          <button type="button" data-action="edit" ${disabledAttr}>Edit</button>
          <button type="button" data-action="delete">Delete</button>
        </div>
      </li>`;
    })
    .join("");
}

function renderKeySkillsMarkup(skills: ReadonlyArray<Skill>): string {
  if (skills.length === 0) {
    return [
      '<p class="key-skills-empty">No skills yet.</p>',
      '<p class="key-skills-empty">Create one in <code>Skills (6)</code>.</p>',
    ].join("");
  }
  return skills
    .map((skill) => {
      const hotkey = skill.hotkey ? `Key ${skillHotkeyLabel(skill.hotkey)}` : "No hotkey";
      return `<div class="key-skill-entry">
        <p class="key-skill-top"><code>${escapeHtml(hotkey)}</code> | ${escapeHtml(skill.name)}</p>
        <p class="key-skill-sequence">${escapeHtml(directionSequenceToLabel(skill.sequence))}</p>
      </div>`;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
