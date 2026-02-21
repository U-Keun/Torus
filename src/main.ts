import "./styles.css";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  type Difficulty,
  type GameOverPayload,
  type GameSnapshot,
  type PersistedGameState,
  TorusGame,
} from "./game";
import {
  createScoreboardStore,
  type DailyAttemptForfeitResult,
  type DailyAttemptStartResult,
  type DailyBadgeStatus,
  type DailyChallengeSubmitResult,
  type DailyChallengeStatus,
  type DailyReplayProof,
  type ReplayInputEvent,
  type ReplayMove,
  type ScoreEntry,
  type SkillUsageEntry,
} from "./scoreboard";
import {
  cloneReplayInputs,
  MAX_REPLAY_INPUTS,
  normalizeReplayInputs,
  normalizeReplayProof,
} from "./replay-proof";
import { SkillRunner, type SkillRunnerState } from "./skills/runner";
import { SkillStore } from "./skills/store";
import {
  DEFAULT_SKILL_STEP_DELAY_MS,
  MAX_SKILL_NAME_LENGTH,
  directionSequenceToLabel,
  normalizeSkillHotkeyInput,
  parseDirectionSequence,
  skillHotkeyLabel,
  type Direction,
  type Skill,
} from "./skills/types";
import { mountTorusLayout } from "./ui/layout";
import { type GameStatus, TorusRenderer } from "./ui/renderer";
import { renderDailyBadgeIcon } from "./ui/badge-icons";
import { ThemeManager, type CustomThemeDraft } from "./ui/theme";

type ScoreboardView = "global" | "personal" | "daily";
type NonDailyScoreboardView = "global" | "personal";
type GameMode = "classic" | "daily";
type KeyGuidePage = "basic" | "skills";

interface PersistedSessionSnapshot {
  version: 1;
  savedAt: number;
  gameMode: GameMode;
  activeDailyChallengeKey: string | null;
  activeDailyAttemptToken: string | null;
  canResume: boolean;
  autoHorizontalDirection: "left" | "right";
  currentRunSkillUsage: SkillUsageEntry[];
  currentRunReplaySeed?: number | null;
  currentRunReplayInputs?: ReplayInputEvent[];
  currentRunReplayDifficulty?: Difficulty | null;
  currentDailyReplaySeed?: number | null;
  currentDailyReplayInputs?: ReplayInputEvent[];
  gameState: PersistedGameState;
}

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("Missing #app container");
}

const dom = mountTorusLayout(appRoot);
const renderer = new TorusRenderer(dom);
const themeManager = new ThemeManager(dom.themeChipEl);
const scoreboardStore = createScoreboardStore();
const skillStore = new SkillStore();
const LAST_USER_STORAGE_KEY = "torus-last-user-v1";
const DEVICE_BEST_STORAGE_KEY = "torus-device-best-v1";
const SUBMIT_DB_PREF_STORAGE_KEY = "torus-submit-db-pref-v1";
const LAST_UPDATE_CHECK_STORAGE_KEY = "torus-last-update-check-v1";
const GAME_MODE_STORAGE_KEY = "torus-game-mode-v1";
const SESSION_SNAPSHOT_STORAGE_KEY = "torus-session-snapshot-v1";
const MAC_APP_STORE_URL = "https://apps.apple.com/kr/app/t-rus/id6759029986?mt=12";
const MIN_SUPPORTED_MAC_VERSION = String(import.meta.env.VITE_MIN_SUPPORTED_MAC_VERSION ?? "").trim();
const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6;
const SESSION_AUTOSAVE_INTERVAL_MS = 3000;
const PERSONAL_SUBMIT_BUTTON_LABEL = "Submit";
const GLOBAL_SCORE_TITLE = "GLOBAL TOP 10";
const PERSONAL_SCORE_TITLE = "PERSONAL TOP 10";
const DAILY_SCORE_TITLE = "DAILY CHALLENGE TOP 10";
const DAILY_CHALLENGE_DIFFICULTY: Difficulty = 1;
const KEY_PAGE_FADE_MS = 220;
const SKILL_FORM_IDLE_TEXT = "Create a skill and optionally assign a hotkey.";
const THEME_CUSTOM_FORM_IDLE_TEXT = "Adjust colors and click Apply or Save.";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
let pendingGameOverPayload: GameOverPayload | null = null;
let pendingSubmitEntry: ScoreEntry | null = null;
let pendingSubmitReplayProof: DailyReplayProof | null = null;
let keyCardVisible = true;
let keyGuidePage: KeyGuidePage = "basic";
let canResume = false;
let savingGameOver = false;
let refreshingScoreboard = false;
let submittingPersonalBest = false;
let preparingPersonalSubmit = false;
let switchingScoreboardView = false;
let gameMode: GameMode = loadGameModePreference();
let scoreboardView: ScoreboardView = gameMode === "daily" ? "daily" : "global";
let nonDailyScoreboardView: NonDailyScoreboardView = "global";
let skills: Skill[] = skillStore.list();
let editingSkillId: string | null = null;
let activeGameStatus: GameStatus = "Paused";
let displayedScoreboardEntries: ScoreEntry[] = [];
let currentRunSkillUsage: SkillUsageEntry[] = [];
let pendingGameOverSkillUsage: SkillUsageEntry[] = [];
let currentRunReplaySeed: number | null = null;
let currentRunReplayInputs: ReplayInputEvent[] = [];
let currentRunReplayDifficulty: Difficulty | null = null;
let expandedScoreIndex: number | null = null;
let latestSnapshot: GameSnapshot | null = null;
let autoHorizontalDirection: "left" | "right" = "right";
let activeDailyChallengeKey: string | null = null;
let activeDailyAttemptToken: string | null = null;
let modeButtonResizeTimer: number | null = null;
let challengeInfoResizeTimer: number | null = null;
let keyPageFadeTimer: number | null = null;
let sessionAutosaveTimer: number | null = null;
let dailyChallengeStatus: DailyChallengeStatus | null = null;
let dailyBadgeStatus: DailyBadgeStatus | null = null;
let startingDailyChallenge = false;
let restoringSessionSnapshot = false;
let lastSessionSnapshotPayload = "";
let pendingSessionRestoreSnapshot: PersistedSessionSnapshot | null = null;
let updateNoticeDownloadUrl: string | null = null;
let noticeModalOnClose: (() => void) | null = null;
const SHARED_SCOREBOARD_LOADING_MESSAGE = "Loading global records";

const game = new TorusGame(
  (snapshot) => {
    latestSnapshot = snapshot;
    renderer.render(snapshot);
  },
  (payload) => onGameOver(payload),
);
const skillRunner = new SkillRunner(dispatchMove, {
  stepDelayMs: DEFAULT_SKILL_STEP_DELAY_MS,
  onStateChange: syncSkillRunnerUi,
});
game.setLastUser(loadLastUser());

themeManager.apply(0);
const savedCustomTheme = themeManager.loadSavedCustom();
if (savedCustomTheme) {
  themeManager.applyCustom(savedCustomTheme);
}
renderer.setStatus("Paused");
renderer.renderScoreboard([]);
renderSkillsList();
syncKeyGuidePageUi({ animate: false });
syncSkillRunnerUi(skillRunner.getState());
setSkillFormMessage(SKILL_FORM_IDLE_TEXT);
setThemeCustomMessage(THEME_CUSTOM_FORM_IDLE_TEXT);
syncGameModeUi();
if (gameMode === "daily") {
  void refreshDailyChallengeStatus();
}
void refreshDailyBadgeStatus();
syncScoreboardViewUi();
void refreshScoreboard();
if (gameMode === "daily") {
  setDifficulty(DAILY_CHALLENGE_DIFFICULTY);
} else {
  setDifficulty(parseDifficulty(dom.difficultyEl.value));
}
renderer.refreshLayout();
scheduleInitialLayoutStabilization();

bindUiControls();
bindKeyboardControls();
bindGameOverModal();
bindSubmitConfirmModal();
bindNoticeModal();
bindSessionRestoreModal();
bindThemeCustomModal();
bindSkillsModal();
bindScoreDrawerInteractions();
promptSessionRestoreIfAvailable();
startSessionAutosave();
void maybeCheckForUpdatesOnLaunch();

window.addEventListener("resize", () => {
  renderer.refreshLayout();
});

window.addEventListener("beforeunload", () => {
  saveSessionSnapshot(true);
  stopSessionAutosave();
  skillRunner.cancelAll();
  game.destroy();
});

function bindUiControls(): void {
  dom.difficultyEl.addEventListener("change", () => {
    if (gameMode === "daily") {
      dom.difficultyEl.value = String(DAILY_CHALLENGE_DIFFICULTY);
      return;
    }
    setDifficulty(parseDifficulty(dom.difficultyEl.value));
  });

  dom.modeBtn.addEventListener("click", () => {
    void toggleGameMode();
  });

  dom.newBtn.addEventListener("click", () => {
    startNewGame();
  });

  dom.resumeBtn.addEventListener("click", () => {
    resumeGame();
  });

  dom.pauseBtn.addEventListener("click", () => {
    pauseGame();
  });

  dom.resetBtn.addEventListener("click", () => {
    resetGame();
  });

  dom.themeBtn.addEventListener("click", () => {
    themeManager.cycle();
  });

  dom.themeChipEl.title = "Click to customize theme colors.";
  dom.themeChipEl.addEventListener("click", () => {
    toggleThemeCustomModal();
  });
  dom.themeChipEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    toggleThemeCustomModal();
    event.preventDefault();
  });

  dom.skillsBtn.addEventListener("click", () => {
    toggleSkillsModal();
  });

  dom.toggleScoreBtn.addEventListener("click", () => {
    renderer.toggleScoreboard();
  });

  dom.toggleKeyBtn.addEventListener("click", () => {
    toggleKeyCard();
  });

  dom.keyPageBasicBtn.addEventListener("click", () => {
    setKeyGuidePage("basic");
  });

  dom.keyPageSkillsBtn.addEventListener("click", () => {
    setKeyGuidePage("skills");
  });

  dom.globalScoreBtn.addEventListener("click", () => {
    void setScoreboardView("global");
  });

  dom.dailyScoreBtn.addEventListener("click", () => {
    void setScoreboardView("daily");
  });

  dom.personalScoreBtn.addEventListener("click", () => {
    void setScoreboardView("personal");
  });

  dom.submitPersonalBtn.addEventListener("click", () => {
    void openSubmitConfirmModal();
  });

  dom.updateNoticeLinkBtn.addEventListener("click", () => {
    void openUpdateNoticeDownload();
  });
}

function scheduleInitialLayoutStabilization(): void {
  window.requestAnimationFrame(() => {
    renderer.refreshLayout();
  });
  window.setTimeout(() => {
    renderer.refreshLayout();
  }, 220);
  if (document.fonts?.ready) {
    void document.fonts.ready.then(() => {
      renderer.refreshLayout();
    });
  }
}

function bindKeyboardControls(): void {
  const actionsByKey: Record<string, () => void> = {
    arrowleft: () => queueManualMove("left"),
    j: () => queueManualMove("left"),
    arrowright: () => queueManualMove("right"),
    l: () => queueManualMove("right"),
    arrowup: () => queueManualMove("up"),
    i: () => queueManualMove("up"),
    arrowdown: () => queueManualMove("down"),
    k: () => queueManualMove("down"),
    "1": () => startNewGame(),
    "2": () => resumeGame(),
    "3": () => pauseGame(),
    "4": () => resetGame(),
    "5": () => themeManager.cycle(),
    "6": () => toggleSkillsModal(),
    "7": () => renderer.toggleScoreboard(),
    "8": () => toggleKeyCard(),
    "9": () => cycleDifficulty(),
  };

  const actionsByCode: Record<string, () => void> = {
    ArrowLeft: () => queueManualMove("left"),
    KeyJ: () => queueManualMove("left"),
    ArrowRight: () => queueManualMove("right"),
    KeyL: () => queueManualMove("right"),
    ArrowUp: () => queueManualMove("up"),
    KeyI: () => queueManualMove("up"),
    ArrowDown: () => queueManualMove("down"),
    KeyK: () => queueManualMove("down"),
    Digit1: () => startNewGame(),
    Digit2: () => resumeGame(),
    Digit3: () => pauseGame(),
    Digit4: () => resetGame(),
    Digit5: () => themeManager.cycle(),
    Digit6: () => toggleSkillsModal(),
    Digit7: () => renderer.toggleScoreboard(),
    Digit8: () => toggleKeyCard(),
    Digit9: () => cycleDifficulty(),
    Numpad1: () => startNewGame(),
    Numpad2: () => resumeGame(),
    Numpad3: () => pauseGame(),
    Numpad4: () => resetGame(),
    Numpad5: () => themeManager.cycle(),
    Numpad6: () => toggleSkillsModal(),
    Numpad7: () => renderer.toggleScoreboard(),
    Numpad8: () => toggleKeyCard(),
    Numpad9: () => cycleDifficulty(),
  };

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (isSessionRestoreModalOpen()) {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
      }
      return;
    }

    if (isNoticeModalOpen()) {
      if (event.key === "Escape" || event.key === "Enter") {
        closeNoticeModal();
      }
      event.preventDefault();
      return;
    }

    if (isSubmitConfirmModalOpen()) {
      if (event.key === "Escape") {
        closeSubmitConfirmModal();
      } else if (event.key === "Enter") {
        void confirmSubmitPersonalBest();
      }
      event.preventDefault();
      return;
    }

    if (isThemeCustomModalOpen()) {
      if (event.key === "Escape") {
        closeThemeCustomModal();
        event.preventDefault();
      }
      return;
    }

    if (isSkillsModalOpen()) {
      if (event.key === "Escape" || (event.key === "6" && !isFormTarget(event.target))) {
        closeSkillsModal();
        event.preventDefault();
      }
      return;
    }

    if (isFormTarget(event.target)) {
      return;
    }

    if (pendingGameOverPayload) {
      return;
    }

    const hotkeySkill = findSkillByHotkey(event.code);
    if (hotkeySkill) {
      if (!event.repeat) {
        runSkillById(hotkeySkill.id, "hotkey");
      }
      event.preventDefault();
      return;
    }

    const action = actionsByCode[event.code] ?? actionsByKey[event.key.toLowerCase()];
    if (!action) {
      return;
    }

    action();
    event.preventDefault();
  });
}

function startNewGame(): void {
  closeGameOverModal();
  closeSubmitConfirmModal();
  closeNoticeModal();
  closeThemeCustomModal();
  closeSkillsModal();
  collapseExpandedScoreRow();
  skillRunner.cancelAll();
  if (gameMode === "daily") {
    void startDailyChallengeGame();
    return;
  }
  autoHorizontalDirection = "right";
  currentRunSkillUsage = [];
  pendingGameOverSkillUsage = [];
  const difficulty = parseDifficulty(dom.difficultyEl.value);
  const replaySeed = createReplaySeed();
  currentRunReplaySeed = replaySeed;
  currentRunReplayInputs = [];
  currentRunReplayDifficulty = difficulty;
  activeDailyChallengeKey = null;
  activeDailyAttemptToken = null;
  game.startNewGame(difficulty, { randomSeed: replaySeed });
  canResume = true;
  setStatus("Running");
  saveSessionSnapshot(true);
}

function resumeGame(): void {
  if (pendingGameOverPayload || !canResume) {
    return;
  }
  game.resume();
  setStatus("Running");
  saveSessionSnapshot(true);
}

function pauseGame(): void {
  skillRunner.cancelAll();
  game.pause();
  setStatus("Paused");
  saveSessionSnapshot(true);
}

function resetGame(): void {
  closeGameOverModal();
  closeSubmitConfirmModal();
  closeNoticeModal();
  closeThemeCustomModal();
  closeSkillsModal();
  collapseExpandedScoreRow();
  skillRunner.cancelAll();
  autoHorizontalDirection = "right";
  currentRunSkillUsage = [];
  pendingGameOverSkillUsage = [];
  currentRunReplaySeed = null;
  currentRunReplayInputs = [];
  currentRunReplayDifficulty = null;
  if (gameMode === "daily" && activeDailyChallengeKey && activeDailyAttemptToken) {
    void scoreboardStore
      .forfeitDailyAttempt(activeDailyChallengeKey, activeDailyAttemptToken)
      .then((result) => {
        setDailyChallengeStatus(toDailyChallengeStatus(result));
      })
      .catch((error) => {
        console.warn("Failed to forfeit daily attempt on reset.", error);
      });
  }
  activeDailyChallengeKey = null;
  activeDailyAttemptToken = null;
  game.reset();
  canResume = false;
  setStatus("Paused");
  clearSessionSnapshot();
}

function setDifficulty(difficulty: Difficulty): void {
  dom.difficultyEl.value = String(difficulty);
  game.setDifficulty(difficulty);
}

function cycleDifficulty(): void {
  if (gameMode === "daily") {
    return;
  }
  const current = parseDifficulty(dom.difficultyEl.value);
  if (current === 1) {
    setDifficulty(2);
    return;
  }
  if (current === 2) {
    setDifficulty(3);
    return;
  }
  setDifficulty(1);
}

function setStatus(status: GameStatus): void {
  activeGameStatus = status;
  renderer.setStatus(status);
  syncModeButtonAvailability();
}

function isModeSwitchLocked(): boolean {
  return canResume && (activeGameStatus === "Running" || activeGameStatus === "Paused");
}

function syncModeButtonAvailability(): void {
  const locked = isModeSwitchLocked();
  dom.modeBtn.disabled = locked;
  if (locked) {
    dom.modeBtn.title = "Mode switching is disabled while a run is active or paused.";
    return;
  }

  dom.modeBtn.title = gameMode === "daily"
    ? "Daily Challenge uses a fixed seed and fixed difficulty."
    : "Classic mode uses normal random generation.";
}

function hasRecoverableDailyAttemptState(
  challengeKey: string,
  attemptToken: string,
): boolean {
  if (!canResume) {
    return false;
  }
  if (activeDailyChallengeKey !== challengeKey) {
    return false;
  }
  if (!activeDailyAttemptToken || activeDailyAttemptToken !== attemptToken) {
    return false;
  }
  if (currentRunReplaySeed === null) {
    return false;
  }
  return hasRecoverableGameState(game.exportState());
}

async function startDailyChallengeGame(): Promise<void> {
  if (startingDailyChallenge) {
    return;
  }
  startingDailyChallenge = true;
  const challenge = getCurrentDailyChallenge();
  try {
    let attemptResult = await scoreboardStore.startDailyAttempt(challenge.key);
    setDailyChallengeStatus(toDailyChallengeStatus(attemptResult));
    if (!attemptResult.accepted || !attemptResult.attemptToken) {
      const used = attemptResult.attemptsUsed;
      const max = attemptResult.maxAttempts;
      openNoticeModal("Daily Challenge", `No Daily Challenge attempts left for today (${used}/${max}).`);
      return;
    }

    if (
      attemptResult.resumed &&
      !hasRecoverableDailyAttemptState(challenge.key, attemptResult.attemptToken)
    ) {
      const forfeitResult = await scoreboardStore.forfeitDailyAttempt(
        challenge.key,
        attemptResult.attemptToken,
      );
      setDailyChallengeStatus(toDailyChallengeStatus(forfeitResult));
      activeDailyAttemptToken = null;
      if (!forfeitResult.accepted) {
        openNoticeModal("Daily Challenge", "Failed to clear stale Daily attempt. Please try again.");
        return;
      }
      attemptResult = await scoreboardStore.startDailyAttempt(challenge.key);
      setDailyChallengeStatus(toDailyChallengeStatus(attemptResult));
      if (!attemptResult.accepted || !attemptResult.attemptToken) {
        const used = attemptResult.attemptsUsed;
        const max = attemptResult.maxAttempts;
        openNoticeModal("Daily Challenge", `No Daily Challenge attempts left for today (${used}/${max}).`);
        return;
      }
    }

    activeDailyChallengeKey = challenge.key;
    activeDailyAttemptToken = attemptResult.attemptToken;

    if (
      attemptResult.resumed &&
      hasRecoverableDailyAttemptState(challenge.key, attemptResult.attemptToken)
    ) {
      game.resume();
      setStatus("Running");
      saveSessionSnapshot(true);
      return;
    }

    autoHorizontalDirection = "right";
    currentRunSkillUsage = [];
    pendingGameOverSkillUsage = [];
    currentRunReplaySeed = challenge.seed;
    currentRunReplayInputs = [];
    currentRunReplayDifficulty = challenge.difficulty;
    setDifficulty(challenge.difficulty);
    game.startNewGame(challenge.difficulty, { randomSeed: challenge.seed });
    canResume = true;
    setStatus("Running");
    saveSessionSnapshot(true);
  } catch (error) {
    console.warn("Failed to start daily challenge attempt.", error);
    openNoticeModal("Daily Challenge", "Failed to verify Daily Challenge attempts. Check network/Supabase and try again.");
  } finally {
    startingDailyChallenge = false;
  }
}

async function refreshDailyChallengeStatus(
  challengeKey: string = getCurrentDailyChallenge().key,
): Promise<DailyChallengeStatus | null> {
  try {
    const status = await scoreboardStore.getDailyStatus(challengeKey);
    setDailyChallengeStatus(status);
    return status;
  } catch (error) {
    console.warn("Failed to load daily challenge status.", error);
    setDailyChallengeStatus(null);
    return null;
  }
}

async function refreshDailyBadgeStatus(
  challengeKey: string = getCurrentDailyChallenge().key,
): Promise<DailyBadgeStatus | null> {
  try {
    const status = await scoreboardStore.getDailyBadgeStatus(challengeKey);
    setDailyBadgeStatus(status);
    return status;
  } catch (error) {
    console.warn("Failed to load daily badge status.", error);
    setDailyBadgeStatus(null);
    return null;
  }
}

async function toggleGameMode(): Promise<void> {
  if (isModeSwitchLocked()) {
    return;
  }
  gameMode = gameMode === "daily" ? "classic" : "daily";
  saveGameModePreference(gameMode);
  if (gameMode === "daily") {
    scoreboardView = "daily";
    setDifficulty(DAILY_CHALLENGE_DIFFICULTY);
  } else if (scoreboardView === "daily") {
    scoreboardView = nonDailyScoreboardView;
  }
  syncGameModeUi({ animateModeButton: true, animateChallengeInfo: true });
  if (gameMode === "daily") {
    void refreshDailyChallengeStatus();
    void refreshDailyBadgeStatus();
  } else {
    dailyChallengeStatus = null;
  }
  syncScoreboardViewUi();
  await refreshScoreboard();
}

function syncGameModeUi(
  options: { animateModeButton?: boolean; animateChallengeInfo?: boolean } = {},
): void {
  const challenge = getCurrentDailyChallenge();
  const dailyMode = gameMode === "daily";
  setModeButtonLabel(
    dailyMode ? "Mode: Daily" : "Mode: Classic",
    options.animateModeButton === true,
  );
  syncModeButtonAvailability();
  setChallengeInfoLabel(
    dailyMode ? formatDailyChallengeInfo(challenge) : "Classic mode",
    options.animateChallengeInfo === true,
  );
  dom.difficultyEl.disabled = dailyMode;
  if (dailyMode) {
    dom.difficultyEl.value = String(challenge.difficulty);
  }
  syncDailyBadgeUi();
}

function formatDailyChallengeInfo(challenge: DailyChallengeSpec): string {
  if (!dailyChallengeStatus || dailyChallengeStatus.challengeKey !== challenge.key) {
    return `Daily Challenge: ${challenge.key} · Difficulty ${challenge.difficulty}`;
  }
  return (
    `Daily Challenge: ${challenge.key} · ${dailyChallengeStatus.attemptsLeft}/` +
    `${dailyChallengeStatus.maxAttempts} attempts left`
  );
}

function setDailyBadgeStatus(status: DailyBadgeStatus | null): void {
  dailyBadgeStatus = status;
  syncDailyBadgeUi();
  if (scoreboardView === "global" || scoreboardView === "daily") {
    renderDisplayedScoreboard();
  }
}

function syncDailyBadgeUi(): void {
  const badge = dom.dailyBadgeEl;
  if (gameMode !== "daily") {
    badge.classList.add("hidden");
    badge.classList.remove("icon-badge");
    badge.innerHTML = "";
    badge.textContent = "";
    badge.title = "";
    return;
  }

  if (!dailyBadgeStatus || dailyBadgeStatus.highestBadgePower === null) {
    badge.classList.add("hidden");
    badge.classList.remove("icon-badge");
    badge.innerHTML = "";
    badge.textContent = "";
    badge.title = [
      "No badge earned yet.",
      "Daily badges are granted for consecutive successful Daily submissions.",
      "Thresholds: 1, 2, 4, 8, ..., 512 days.",
      `Current streak: ${formatDaysCount(dailyBadgeStatus?.currentStreak ?? 0)}.`,
    ].join("\n");
    badge.setAttribute("aria-label", "No daily streak badge earned yet");
    return;
  }

  const power = dailyBadgeStatus.highestBadgePower;
  const badgeDays = dailyBadgeStatus.highestBadgeDays ?? 2 ** power;
  badge.classList.remove("hidden");
  const iconMarkup = renderDailyBadgeIcon(power);
  if (iconMarkup) {
    badge.classList.add("icon-badge");
    badge.innerHTML = iconMarkup;
  } else {
    badge.classList.remove("icon-badge");
    badge.innerHTML = "";
    badge.textContent = `Badge 2^${power}`;
  }
  badge.title = formatDailyBadgeTooltip(dailyBadgeStatus, power, badgeDays);
  badge.setAttribute(
    "aria-label",
    `Daily streak badge 2 to the power of ${power}, ${badgeDays} day tier`,
  );
}

function formatDailyBadgeTooltip(
  status: DailyBadgeStatus,
  power: number,
  badgeDays: number,
): string {
  const lines = [
    `Highest badge: 2^${power} (${formatDaysCount(badgeDays)} tier).`,
    `Current streak: ${formatDaysCount(status.currentStreak)}.`,
    `Best streak: ${formatDaysCount(status.maxStreak)}.`,
  ];
  if (status.nextBadgePower !== null && status.nextBadgeDays !== null) {
    lines.push(
      `Next badge: 2^${status.nextBadgePower} (${formatDaysCount(status.nextBadgeDays)} tier), `
      + `${formatDaysCount(status.daysToNextBadge ?? 0)} left.`,
    );
  } else {
    lines.push("Top tier reached: 2^9 (512 days).");
  }
  lines.push("Rule: only successful Daily submissions count (strict consecutive days).");
  return lines.join("\n");
}

function formatDailyBadgeTooltipInline(
  status: DailyBadgeStatus,
  power: number,
  badgeDays: number,
): string {
  const parts = [
    `Highest badge: 2^${power} (${formatDaysCount(badgeDays)} tier)`,
    `Current streak: ${formatDaysCount(status.currentStreak)}`,
    `Best streak: ${formatDaysCount(status.maxStreak)}`,
  ];
  if (status.nextBadgePower !== null && status.nextBadgeDays !== null) {
    parts.push(
      `Next: 2^${status.nextBadgePower} (${formatDaysCount(status.nextBadgeDays)} tier), `
      + `${formatDaysCount(status.daysToNextBadge ?? 0)} left`,
    );
  } else {
    parts.push("Top tier reached: 2^9 (512 days)");
  }
  parts.push("Rule: successful Daily submissions only, strict consecutive days");
  return parts.join(" | ");
}

function formatDaysCount(value: number): string {
  return `${value} day${value === 1 ? "" : "s"}`;
}

function getScoreboardMeBadge(): { label: string; title: string; iconMarkup?: string } | undefined {
  if (scoreboardView !== "global" && scoreboardView !== "daily") {
    return undefined;
  }
  if (!dailyBadgeStatus || dailyBadgeStatus.highestBadgePower === null) {
    return undefined;
  }
  const power = dailyBadgeStatus.highestBadgePower;
  const badgeDays = dailyBadgeStatus.highestBadgeDays ?? 2 ** power;
  const iconMarkup = renderDailyBadgeIcon(power) ?? undefined;
  return {
    label: `2^${power}`,
    title: formatDailyBadgeTooltipInline(dailyBadgeStatus, power, badgeDays),
    iconMarkup,
  };
}

function setModeButtonLabel(label: string, animate: boolean): void {
  const button = dom.modeBtn;
  if (!animate) {
    if (modeButtonResizeTimer !== null) {
      window.clearTimeout(modeButtonResizeTimer);
      modeButtonResizeTimer = null;
    }
    button.classList.remove("mode-size-animating");
    button.style.width = "";
    button.textContent = label;
    return;
  }

  const currentLabel = button.textContent ?? "";
  if (currentLabel === label) {
    return;
  }

  if (modeButtonResizeTimer !== null) {
    window.clearTimeout(modeButtonResizeTimer);
    modeButtonResizeTimer = null;
  }

  const startWidth = button.getBoundingClientRect().width;
  button.style.width = `${startWidth}px`;
  button.textContent = label;
  button.style.width = "auto";
  const targetWidth = button.getBoundingClientRect().width;
  button.style.width = `${startWidth}px`;
  button.classList.add("mode-size-animating");
  void button.offsetWidth;
  button.style.width = `${targetWidth}px`;

  modeButtonResizeTimer = window.setTimeout(() => {
    button.classList.remove("mode-size-animating");
    button.style.width = "";
    modeButtonResizeTimer = null;
  }, 360);
}

function setChallengeInfoLabel(label: string, animate: boolean): void {
  const badge = dom.challengeInfoEl;
  if (!animate) {
    if (challengeInfoResizeTimer !== null) {
      window.clearTimeout(challengeInfoResizeTimer);
      challengeInfoResizeTimer = null;
    }
    badge.classList.remove("size-animating");
    badge.style.width = "";
    badge.textContent = label;
    return;
  }

  const currentLabel = badge.textContent ?? "";
  if (currentLabel === label) {
    return;
  }

  if (challengeInfoResizeTimer !== null) {
    window.clearTimeout(challengeInfoResizeTimer);
    challengeInfoResizeTimer = null;
  }

  const startWidth = badge.getBoundingClientRect().width;
  badge.style.width = `${startWidth}px`;
  badge.textContent = label;
  badge.style.width = "auto";
  const targetWidth = badge.getBoundingClientRect().width;
  badge.style.width = `${startWidth}px`;
  badge.classList.add("size-animating");
  void badge.offsetWidth;
  badge.style.width = `${targetWidth}px`;

  challengeInfoResizeTimer = window.setTimeout(() => {
    badge.classList.remove("size-animating");
    badge.style.width = "";
    challengeInfoResizeTimer = null;
  }, 360);
}

function dispatchMove(direction: Direction): void {
  if (direction === "left") {
    applyLoggedMove("left");
    return;
  }
  if (direction === "right") {
    applyLoggedMove("right");
    return;
  }
  if (direction === "autoHorizontal") {
    dispatchDynamicHorizontalMove("primary");
    return;
  }
  if (direction === "autoHorizontalInverse") {
    dispatchDynamicHorizontalMove("inverse");
    return;
  }
  if (direction === "up") {
    applyLoggedMove("up");
    return;
  }
  applyLoggedMove("down");
}

function dispatchDynamicHorizontalMove(
  variant: "primary" | "inverse",
): void {
  const snapshot = latestSnapshot;
  if (!snapshot || snapshot.numCols <= 1) {
    return;
  }

  let moveDirection = variant === "primary"
    ? autoHorizontalDirection
    : oppositeHorizontalDirection(autoHorizontalDirection);
  if (isHorizontalDirectionBlocked(snapshot.polePos, snapshot.numCols, moveDirection)) {
    autoHorizontalDirection = oppositeHorizontalDirection(autoHorizontalDirection);
    moveDirection = variant === "primary"
      ? autoHorizontalDirection
      : oppositeHorizontalDirection(autoHorizontalDirection);
  }

  if (moveDirection === "left") {
    applyLoggedMove("left");
    return;
  }
  applyLoggedMove("right");
}

function applyLoggedMove(move: ReplayMove): void {
  const snapshot = latestSnapshot;
  const gameState = snapshot ?? game.exportState();
  if (move === "left") {
    game.moveLeft();
  } else if (move === "right") {
    game.moveRight();
  } else if (move === "up") {
    game.moveUp();
  } else {
    game.moveDown();
  }
  appendRunReplayInput(gameState.time, move, gameState.gameOn);
}

function appendRunReplayInput(
  time: number,
  move: ReplayMove,
  gameOn: boolean,
): void {
  if (!gameOn || currentRunReplaySeed === null) {
    return;
  }
  if (currentRunReplayInputs.length >= MAX_REPLAY_INPUTS) {
    return;
  }
  currentRunReplayInputs.push({
    time: Math.max(0, Math.trunc(time)),
    move,
  });
}

function oppositeHorizontalDirection(
  direction: "left" | "right",
): "left" | "right" {
  return direction === "left" ? "right" : "left";
}

function isHorizontalDirectionBlocked(
  polePos: number,
  numCols: number,
  direction: "left" | "right",
): boolean {
  if (direction === "left") {
    return polePos <= 0;
  }
  return polePos >= numCols - 1;
}

function queueManualMove(direction: Direction): void {
  skillRunner.enqueueManualMove(direction);
}

function onGameOver(payload: GameOverPayload): void {
  skillRunner.cancelAll();
  closeSkillsModal();
  collapseExpandedScoreRow();
  pendingGameOverSkillUsage = cloneSkillUsageList(currentRunSkillUsage);
  setStatus("Game Over");
  canResume = false;
  pendingGameOverPayload = payload;
  clearSessionSnapshot();
  openGameOverModal(payload);
}

function parseDifficulty(raw: string): Difficulty {
  const value = Number(raw);
  if (value === 2 || value === 3) {
    return value;
  }
  return 1;
}

function isFormTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.tagName === "TEXTAREA"
  );
}

function toggleKeyCard(): void {
  if (!keyCardVisible) {
    setKeyGuidePage("basic", { animate: false });
    keyCardVisible = true;
    dom.keyCardEl.classList.remove("hidden");
    dom.sideColumnEl.classList.remove("key-hidden");
    renderer.refreshLayout();
    return;
  }

  if (keyGuidePage === "basic") {
    setKeyGuidePage("skills");
    return;
  }

  setKeyGuidePage("basic", { animate: false });
  keyCardVisible = false;
  dom.keyCardEl.classList.add("hidden");
  dom.sideColumnEl.classList.add("key-hidden");
  renderer.refreshLayout();
}

function setKeyGuidePage(
  page: KeyGuidePage,
  options: { animate?: boolean } = {},
): void {
  if (keyGuidePage === page) {
    return;
  }
  keyGuidePage = page;
  syncKeyGuidePageUi(options);
}

function syncKeyGuidePageUi(
  options: { animate?: boolean } = {},
): void {
  const basicPage = keyGuidePage === "basic";
  const nextPageEl = basicPage ? dom.keyPageBasicEl : dom.keyPageSkillsEl;
  const prevPageEl = basicPage ? dom.keyPageSkillsEl : dom.keyPageBasicEl;
  const shouldAnimate = options.animate !== false && keyCardVisible;
  dom.keyPageBasicBtn.classList.toggle("active", basicPage);
  dom.keyPageSkillsBtn.classList.toggle("active", !basicPage);
  dom.keyPageBasicBtn.setAttribute("aria-pressed", basicPage ? "true" : "false");
  dom.keyPageSkillsBtn.setAttribute("aria-pressed", basicPage ? "false" : "true");

  if (keyPageFadeTimer !== null) {
    window.clearTimeout(keyPageFadeTimer);
    keyPageFadeTimer = null;
  }
  dom.keyPageBasicEl.classList.remove("key-page-fade-in", "key-page-fade-out");
  dom.keyPageSkillsEl.classList.remove("key-page-fade-in", "key-page-fade-out");

  if (!shouldAnimate) {
    nextPageEl.classList.remove("hidden");
    prevPageEl.classList.add("hidden");
    return;
  }

  prevPageEl.classList.remove("hidden");
  nextPageEl.classList.remove("hidden");
  prevPageEl.classList.add("key-page-fade-out");
  nextPageEl.classList.add("key-page-fade-in");

  keyPageFadeTimer = window.setTimeout(() => {
    prevPageEl.classList.add("hidden");
    prevPageEl.classList.remove("key-page-fade-out");
    nextPageEl.classList.remove("key-page-fade-in");
    keyPageFadeTimer = null;
  }, KEY_PAGE_FADE_MS);
}

function renderKeyGuideSkillsPage(): void {
  if (skills.length === 0) {
    dom.keySkillsListEl.innerHTML = [
      '<p class="key-skills-empty">No skills yet.</p>',
      '<p class="key-skills-empty">Create one in <code>Skills (6)</code>.</p>',
    ].join("");
    return;
  }

  dom.keySkillsListEl.innerHTML = skills
    .map((skill) => {
      const hotkey = skill.hotkey
        ? `Key ${escapeHtml(skillHotkeyLabel(skill.hotkey))}`
        : "No hotkey";
      const sequence = escapeHtml(directionSequenceToLabel(skill.sequence));
      return `<div class="key-skill-entry">
        <p class="key-skill-top"><code>${hotkey}</code> · ${escapeHtml(skill.name)}</p>
        <p class="key-skill-sequence">${sequence}</p>
      </div>`;
    })
    .join("");
}

function bindGameOverModal(): void {
  dom.gameOverSaveBtn.addEventListener("click", () => {
    void saveGameOverScore();
  });

  dom.gameOverSkipBtn.addEventListener("click", () => {
    resetGame();
  });

  dom.gameOverNameEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void saveGameOverScore();
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      if (gameMode === "daily") {
        event.preventDefault();
        return;
      }
      resetGame();
      event.preventDefault();
    }
  });

  dom.gameOverModalEl.addEventListener("click", (event) => {
    if (event.target === dom.gameOverModalEl) {
      if (gameMode === "daily") {
        return;
      }
      resetGame();
    }
  });
}

function bindSubmitConfirmModal(): void {
  dom.submitConfirmCancelBtn.addEventListener("click", () => {
    closeSubmitConfirmModal();
  });

  dom.submitConfirmConfirmBtn.addEventListener("click", () => {
    void confirmSubmitPersonalBest();
  });

  dom.submitConfirmModalEl.addEventListener("click", (event) => {
    if (
      event.target === dom.submitConfirmModalEl &&
      !preparingPersonalSubmit &&
      !submittingPersonalBest
    ) {
      closeSubmitConfirmModal();
    }
  });
}

function bindNoticeModal(): void {
  dom.noticeOkBtn.addEventListener("click", () => {
    closeNoticeModal();
  });

  dom.noticeModalEl.addEventListener("click", (event) => {
    if (event.target === dom.noticeModalEl) {
      closeNoticeModal();
    }
  });
}

function bindSessionRestoreModal(): void {
  dom.sessionRestoreContinueBtn.addEventListener("click", () => {
    void confirmSessionRestoreContinue();
  });

  dom.sessionRestoreResetBtn.addEventListener("click", () => {
    void confirmSessionRestoreReset();
  });
}

function bindThemeCustomModal(): void {
  dom.themeCustomCloseBtn.addEventListener("click", () => {
    closeThemeCustomModal();
  });

  dom.themeCustomModalEl.addEventListener("click", (event) => {
    if (event.target === dom.themeCustomModalEl) {
      closeThemeCustomModal();
    }
  });

  dom.themeCustomFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    applyThemeFromForm({ persist: true });
  });

  dom.themeCustomApplyBtn.addEventListener("click", () => {
    applyThemeFromForm({ persist: false });
  });

  dom.themeCustomResetBtn.addEventListener("click", () => {
    themeManager.clearCustom();
    const presetDraft = themeManager.getActiveDraft();
    fillThemeForm(presetDraft);
    setThemeCustomMessage("Custom theme removed. Reverted to current preset.", "good");
  });

  const inputs: HTMLInputElement[] = [
    dom.themeColor0El,
    dom.themeColor1El,
    dom.themeColor2El,
    dom.themeColor3El,
    dom.themeColor4El,
    dom.themeTextColorEl,
    dom.themeGlazeColorEl,
    dom.themeGlowColorEl,
  ];
  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      if (dom.themeCustomMessageEl.classList.contains("warn")) {
        setThemeCustomMessage(THEME_CUSTOM_FORM_IDLE_TEXT);
      }
      syncThemeSamplesFromForm();
    });
  });

  dom.themeGlowAlphaEl.addEventListener("input", () => {
    syncThemeGlowAlphaLabel();
    if (dom.themeCustomMessageEl.classList.contains("warn")) {
      setThemeCustomMessage(THEME_CUSTOM_FORM_IDLE_TEXT);
    }
    syncThemeSamplesFromForm();
  });
}

function toggleThemeCustomModal(): void {
  if (isThemeCustomModalOpen()) {
    closeThemeCustomModal();
    return;
  }
  openThemeCustomModal();
}

function openThemeCustomModal(): void {
  if (pendingGameOverPayload || isSubmitConfirmModalOpen()) {
    return;
  }
  closeSkillsModal();
  fillThemeForm(themeManager.getActiveDraft());
  setThemeCustomMessage(THEME_CUSTOM_FORM_IDLE_TEXT);
  dom.themeCustomModalEl.classList.remove("hidden");
  dom.themeColor0El.focus();
}

function closeThemeCustomModal(): void {
  dom.themeCustomModalEl.classList.add("hidden");
}

function isThemeCustomModalOpen(): boolean {
  return !dom.themeCustomModalEl.classList.contains("hidden");
}

function fillThemeForm(draft: CustomThemeDraft): void {
  dom.themeColor0El.value = draft.colors[0];
  dom.themeColor1El.value = draft.colors[1];
  dom.themeColor2El.value = draft.colors[2];
  dom.themeColor3El.value = draft.colors[3];
  dom.themeColor4El.value = draft.colors[4];
  dom.themeTextColorEl.value = draft.text;
  dom.themeGlazeColorEl.value = draft.glaze;
  dom.themeGlowColorEl.value = draft.glowColor;
  dom.themeGlowAlphaEl.value = String(Math.round(clamp01(draft.glowAlpha) * 100));
  syncThemeGlowAlphaLabel();
  renderThemeSamples(draft);
}

function applyThemeFromForm(
  options: { persist: boolean },
): void {
  const draft = readThemeDraftFromForm();
  if (!draft) {
    return;
  }

  if (options.persist) {
    themeManager.saveCustom(draft);
    setThemeCustomMessage("Custom theme saved.", "good");
    return;
  }

  themeManager.applyCustom(draft);
  setThemeCustomMessage("Preview applied. Save to keep this theme.");
}

function syncThemeSamplesFromForm(): void {
  const draft = readThemeDraftFromForm({ silent: true });
  if (!draft) {
    return;
  }
  renderThemeSamples(draft);
}

function readThemeDraftFromForm(
  options: { silent?: boolean } = {},
): CustomThemeDraft | null {
  const color0 = normalizeHexColorInput(dom.themeColor0El.value);
  const color1 = normalizeHexColorInput(dom.themeColor1El.value);
  const color2 = normalizeHexColorInput(dom.themeColor2El.value);
  const color3 = normalizeHexColorInput(dom.themeColor3El.value);
  const color4 = normalizeHexColorInput(dom.themeColor4El.value);
  const text = normalizeHexColorInput(dom.themeTextColorEl.value);
  const glaze = normalizeHexColorInput(dom.themeGlazeColorEl.value);
  const glowColor = normalizeHexColorInput(dom.themeGlowColorEl.value);

  if (!color0 || !color1 || !color2 || !color3 || !color4 || !text || !glaze || !glowColor) {
    if (!options.silent) {
      setThemeCustomMessage("Invalid color value. Please use HEX color fields.", "warn");
    }
    return null;
  }

  const glowAlphaRaw = Number(dom.themeGlowAlphaEl.value);
  const glowAlpha = clamp01(Number.isFinite(glowAlphaRaw) ? glowAlphaRaw / 100 : 0);

  return {
    colors: [color0, color1, color2, color3, color4],
    text,
    glaze,
    glowColor,
    glowAlpha,
  };
}

function syncThemeGlowAlphaLabel(): void {
  const percentRaw = Number(dom.themeGlowAlphaEl.value);
  const percent = Number.isFinite(percentRaw)
    ? Math.min(100, Math.max(0, Math.round(percentRaw)))
    : 0;
  dom.themeGlowAlphaValueEl.textContent = `${percent}%`;
}

function renderThemeSamples(draft: CustomThemeDraft): void {
  const [r, g, b] = hexToRgb(draft.glowColor);
  const glowAlpha = clamp01(draft.glowAlpha);
  const glow = `rgba(${r}, ${g}, ${b}, ${toAlphaString(glowAlpha)})`;

  dom.themeCustomFormEl.style.setProperty("--torus-0", draft.colors[0]);
  dom.themeCustomFormEl.style.setProperty("--torus-1", draft.colors[1]);
  dom.themeCustomFormEl.style.setProperty("--torus-2", draft.colors[2]);
  dom.themeCustomFormEl.style.setProperty("--torus-3", draft.colors[3]);
  dom.themeCustomFormEl.style.setProperty("--torus-4", draft.colors[4]);
  dom.themeCustomFormEl.style.setProperty("--torus-text", draft.text);
  dom.themeCustomFormEl.style.setProperty("--torus-glaze", draft.glaze);
  dom.themeCustomFormEl.style.setProperty("--torus-glow", glow);
}

function bindScoreDrawerInteractions(): void {
  dom.scoreListEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const importButton = target.closest(
      'button[data-action="import-skill"][data-score-index][data-skill-index]',
    );
    if (importButton instanceof HTMLButtonElement) {
      const scoreIndex = Number(importButton.dataset.scoreIndex);
      const skillIndex = Number(importButton.dataset.skillIndex);
      if (Number.isInteger(scoreIndex) && Number.isInteger(skillIndex)) {
        importSkillFromScoreboard(scoreIndex, skillIndex);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const rowEl = target.closest("li[data-score-index]");
    if (!(rowEl instanceof HTMLLIElement)) {
      return;
    }

    const index = Number(rowEl.dataset.scoreIndex);
    if (!Number.isInteger(index) || index < 0) {
      return;
    }

    toggleExpandedScoreRow(index);
  });

  dom.scoreListEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.closest('button[data-action="import-skill"]')) {
      return;
    }

    const rowEl = target.closest("li[data-score-index]");
    if (!(rowEl instanceof HTMLLIElement)) {
      return;
    }

    const index = Number(rowEl.dataset.scoreIndex);
    if (!Number.isInteger(index) || index < 0) {
      return;
    }

    toggleExpandedScoreRow(index);
    event.preventDefault();
  });
}

function bindSkillsModal(): void {
  dom.skillsCloseBtn.addEventListener("click", () => {
    closeSkillsModal();
  });

  dom.skillsModalEl.addEventListener("click", (event) => {
    if (event.target === dom.skillsModalEl) {
      closeSkillsModal();
    }
  });

  dom.skillsFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSkillFromForm();
  });

  dom.skillHotkeyEl.addEventListener("keydown", (event) => {
    if (event.key === "Backspace" || event.key === "Delete") {
      dom.skillHotkeyEl.value = "";
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      dom.skillHotkeyEl.blur();
      event.preventDefault();
      return;
    }

    const code = event.code.trim();
    if (!code) {
      return;
    }

    dom.skillHotkeyEl.value = code;
    event.preventDefault();
  });

  dom.skillCancelEditBtn.addEventListener("click", () => {
    resetSkillForm();
    dom.skillNameEl.focus();
  });

  dom.skillsListEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const button = target.closest("button[data-action][data-skill-id]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const skillId = button.dataset.skillId;
    const action = button.dataset.action;
    if (!skillId || !action) {
      return;
    }

    if (action === "run") {
      runSkillById(skillId);
      return;
    }

    if (action === "edit") {
      beginSkillEdit(skillId);
      return;
    }

    if (action === "delete") {
      deleteSkillById(skillId);
    }
  });
}

function toggleSkillsModal(): void {
  if (isSkillsModalOpen()) {
    closeSkillsModal();
    return;
  }
  openSkillsModal();
}

function openSkillsModal(): void {
  if (pendingGameOverPayload || isSubmitConfirmModalOpen()) {
    return;
  }
  closeThemeCustomModal();
  dom.skillsModalEl.classList.remove("hidden");
  dom.skillNameEl.focus();
}

function closeSkillsModal(): void {
  dom.skillsModalEl.classList.add("hidden");
  resetSkillForm();
}

function isSkillsModalOpen(): boolean {
  return !dom.skillsModalEl.classList.contains("hidden");
}

function toggleExpandedScoreRow(index: number): void {
  if (index < 0 || index >= displayedScoreboardEntries.length) {
    return;
  }

  expandedScoreIndex = expandedScoreIndex === index
    ? null
    : index;
  renderer.setExpandedScoreIndex(expandedScoreIndex);
  applyExpandedScoreRowState();
}

function collapseExpandedScoreRow(): void {
  if (expandedScoreIndex === null) {
    return;
  }
  expandedScoreIndex = null;
  renderer.setExpandedScoreIndex(expandedScoreIndex);
  applyExpandedScoreRowState();
}

function renderDisplayedScoreboard(): void {
  renderer.setExpandedScoreIndex(expandedScoreIndex);
  renderer.renderScoreboard(displayedScoreboardEntries, {
    allowSkillImport: scoreboardView !== "personal",
    showMeTag: scoreboardView === "global" || scoreboardView === "daily",
    showGlobalRankBadge: scoreboardView === "global",
    meBadge: getScoreboardMeBadge(),
  });
  syncScoreRowAccessibility();
  applyExpandedScoreRowState();
}

function setDisplayedScoreboardRows(rows: ReadonlyArray<ScoreEntry>): void {
  displayedScoreboardEntries = rows.map((row) => cloneScoreEntry(row));
  if (
    expandedScoreIndex !== null &&
    expandedScoreIndex >= displayedScoreboardEntries.length
  ) {
    expandedScoreIndex = null;
  }
}

function importSkillFromScoreboard(scoreIndex: number, skillIndex: number): void {
  const row = displayedScoreboardEntries[scoreIndex];
  const usage = row?.skillUsage?.[skillIndex];
  if (!row || !usage) {
    return;
  }

  const name = usage.name.trim().slice(0, MAX_SKILL_NAME_LENGTH);
  const command = usage.command ? usage.command.trim() : "";
  if (name.length === 0 || command.length === 0) {
    openNoticeModal("Skills", "This skill cannot be imported because command data is missing.");
    return;
  }

  let sequence: Direction[] = [];
  try {
    sequence = parseDirectionSequence(command);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid skill command.";
    openNoticeModal("Skills", `Failed to import "${name}". ${message}`);
    return;
  }

  const sequenceLabel = directionSequenceToLabel(sequence);
  const alreadyExists = skills.some((skill) => (
    skill.name === name &&
    directionSequenceToLabel(skill.sequence) === sequenceLabel
  ));
  if (alreadyExists) {
    openNoticeModal("Skills", `"${name}" is already in your skill list.`);
    return;
  }

  const hotkeyInput = window.prompt(
    `Import "${name}"\n\nSet hotkey now (optional).\nExamples: KeyZ, Digit1, Slash, Tab, F6\n\nLeave blank for none.`,
    "",
  );
  if (hotkeyInput === null) {
    return;
  }

  let hotkey: string | null = null;
  try {
    hotkey = normalizeSkillHotkeyInput(hotkeyInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid hotkey.";
    openNoticeModal("Skills", message);
    return;
  }

  if (hotkey && skills.some((skill) => skill.hotkey === hotkey)) {
    openNoticeModal("Skills", `"${skillHotkeyLabel(hotkey)}" is already used by another skill.`);
    return;
  }

  try {
    const created = skillStore.create(name, sequence, hotkey);
    skills = skillStore.list();
    renderSkillsList();

    const hotkeyMessage = created.hotkey
      ? ` (hotkey: ${skillHotkeyLabel(created.hotkey)})`
      : "";
    const message = `Imported "${created.name}"${hotkeyMessage}.`;
    if (isSkillsModalOpen()) {
      setSkillFormMessage(message, "good");
    } else {
      openNoticeModal("Skills", message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import skill.";
    openNoticeModal("Skills", message);
  }
}

function applyExpandedScoreRowState(): void {
  const rows = dom.scoreListEl.querySelectorAll<HTMLLIElement>("li.score-row");
  rows.forEach((row) => {
    const index = Number(row.dataset.scoreIndex);
    const isExpanded = (
      Number.isInteger(index) &&
      expandedScoreIndex === index
    );
    row.classList.toggle("expanded", isExpanded);
    row.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  });
}

function saveSkillFromForm(): void {
  const name = dom.skillNameEl.value.trim().slice(0, MAX_SKILL_NAME_LENGTH);
  if (name.length === 0) {
    setSkillFormMessage("Skill name is required.", "warn");
    dom.skillNameEl.focus();
    return;
  }

  let sequence: Direction[] = [];
  try {
    sequence = parseDirectionSequence(dom.skillSequenceEl.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid direction sequence.";
    setSkillFormMessage(message, "warn");
    dom.skillSequenceEl.focus();
    return;
  }

  let hotkey: string | null = null;
  try {
    hotkey = normalizeSkillHotkeyInput(dom.skillHotkeyEl.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid hotkey.";
    setSkillFormMessage(message, "warn");
    dom.skillHotkeyEl.focus();
    return;
  }

  if (hotkey && skills.some((entry) => entry.hotkey === hotkey && entry.id !== editingSkillId)) {
    setSkillFormMessage(`"${skillHotkeyLabel(hotkey)}" is already used by another skill.`, "warn");
    dom.skillHotkeyEl.focus();
    return;
  }

  try {
    if (editingSkillId) {
      const updated = skillStore.update(editingSkillId, name, sequence, hotkey);
      skills = skillStore.list();
      renderSkillsList();
      const hotkeyMessage = updated.hotkey ? ` / hotkey ${skillHotkeyLabel(updated.hotkey)}` : "";
      setSkillFormMessage(
        `Updated "${updated.name}" (${updated.sequence.length} steps${hotkeyMessage}).`,
        "good",
      );
      resetSkillForm(true);
      dom.skillNameEl.focus();
      return;
    }

    const created = skillStore.create(name, sequence, hotkey);
    skills = skillStore.list();
    renderSkillsList();
    const hotkeyMessage = created.hotkey ? ` / hotkey ${skillHotkeyLabel(created.hotkey)}` : "";
    setSkillFormMessage(
      `Saved "${created.name}" (${created.sequence.length} steps${hotkeyMessage}).`,
      "good",
    );
    resetSkillForm(true);
    dom.skillNameEl.focus();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save skill.";
    if (message === "Skill not found.") {
      resetSkillForm(true);
    }
    setSkillFormMessage(message, "warn");
  }
}

function beginSkillEdit(skillId: string): void {
  const skill = skills.find((entry) => entry.id === skillId);
  if (!skill) {
    setSkillFormMessage("Skill not found.", "warn");
    return;
  }

  editingSkillId = skill.id;
  dom.skillNameEl.value = skill.name;
  dom.skillSequenceEl.value = directionSequenceToLabel(skill.sequence);
  dom.skillHotkeyEl.value = skillHotkeyLabel(skill.hotkey) === "-"
    ? ""
    : skillHotkeyLabel(skill.hotkey);
  dom.skillSaveBtn.textContent = "Update Skill";
  dom.skillCancelEditBtn.hidden = false;
  setSkillFormMessage(`Editing "${skill.name}".`, "info");
  dom.skillNameEl.focus();
}

function runSkillById(skillId: string, source: "ui" | "hotkey" = "ui"): void {
  const skill = skills.find((entry) => entry.id === skillId);
  if (!skill) {
    if (source === "ui" || isSkillsModalOpen()) {
      setSkillFormMessage("Skill not found.", "warn");
    }
    return;
  }

  const started = skillRunner.runSkill(skill);
  if (!started) {
    if (source === "ui" || isSkillsModalOpen()) {
      setSkillFormMessage("Another sequence is still running.", "warn");
    }
    return;
  }

  if (source === "ui" || isSkillsModalOpen()) {
    setSkillFormMessage(`Running "${skill.name}".`, "good");
  }
  markSkillUsed(skill);
  syncSkillRunnerUi(skillRunner.getState());
}

function findSkillByHotkey(code: string): Skill | null {
  if (!code) {
    return null;
  }
  return skills.find((skill) => skill.hotkey === code) ?? null;
}

function markSkillUsed(skill: Skill): void {
  if (activeGameStatus !== "Running") {
    return;
  }

  const name = skill.name.trim().slice(0, 20);
  if (name.length === 0) {
    return;
  }

  const hotkey = skill.hotkey ? skill.hotkey.trim().slice(0, 16) : null;
  const command = directionSequenceToLabel(skill.sequence).trim().slice(0, 120);
  const exists = currentRunSkillUsage.some((entry) => (
    entry.name === name &&
    entry.hotkey === hotkey &&
    entry.command === command
  ));
  if (exists) {
    return;
  }

  currentRunSkillUsage.push({ name, hotkey, command });
}

function deleteSkillById(skillId: string): void {
  const skill = skills.find((entry) => entry.id === skillId);
  if (!skill) {
    return;
  }
  const wasEditing = editingSkillId === skillId;

  skillStore.remove(skillId);
  skills = skillStore.list();
  renderSkillsList();
  if (wasEditing) {
    resetSkillForm(true);
  }
  setSkillFormMessage(`Deleted "${skill.name}".`, "good");
}

function resetSkillForm(keepMessage = false): void {
  editingSkillId = null;
  dom.skillNameEl.value = "";
  dom.skillSequenceEl.value = "";
  dom.skillHotkeyEl.value = "";
  dom.skillSaveBtn.textContent = "Save Skill";
  dom.skillCancelEditBtn.hidden = true;
  if (!keepMessage) {
    setSkillFormMessage(SKILL_FORM_IDLE_TEXT);
  }
}

function renderSkillsList(): void {
  renderKeyGuideSkillsPage();
  const shouldAnimateResize = isSkillsModalOpen();
  const previousHeight = shouldAnimateResize
    ? dom.skillsDialogEl.getBoundingClientRect().height
    : 0;
  const state = skillRunner.getState();
  if (skills.length === 0) {
    dom.skillsListEl.innerHTML = '<li class="skills-empty">No skills yet.</li>';
    if (shouldAnimateResize) {
      animateSkillsDialogResize(previousHeight);
    }
    return;
  }

  dom.skillsListEl.innerHTML = skills
    .map((skill) => {
      const sequence = directionSequenceToLabel(skill.sequence);
      const hotkeyLabel = skillHotkeyLabel(skill.hotkey);
      const hotkeyMeta = skill.hotkey ? ` \u00b7 Key ${escapeHtml(hotkeyLabel)}` : "";
      const runDisabledAttr = state.isProcessing ? "disabled" : "";
      const editDisabledAttr = state.isProcessing ? "disabled" : "";
      return `<li class="skill-row">
        <div class="skill-row-top">
          <span class="skill-name">${escapeHtml(skill.name)}</span>
          <span class="skill-step">${skill.sequence.length} steps${hotkeyMeta}</span>
        </div>
        <div class="skill-sequence">${escapeHtml(sequence)}</div>
        <div class="skill-actions">
          <button type="button" data-action="run" data-skill-id="${escapeHtml(skill.id)}" ${runDisabledAttr}>Run</button>
          <button type="button" data-action="edit" data-skill-id="${escapeHtml(skill.id)}" ${editDisabledAttr}>Edit</button>
          <button type="button" data-action="delete" data-skill-id="${escapeHtml(skill.id)}">Delete</button>
        </div>
      </li>`;
    })
    .join("");

  if (shouldAnimateResize) {
    animateSkillsDialogResize(previousHeight);
  }
}

function animateSkillsDialogResize(previousHeight: number): void {
  if (previousHeight <= 0) {
    return;
  }

  const dialog = dom.skillsDialogEl;
  const nextHeight = dialog.getBoundingClientRect().height;
  if (Math.abs(nextHeight - previousHeight) < 2) {
    return;
  }

  dialog.style.height = `${previousHeight}px`;
  dialog.style.transition = "height 320ms cubic-bezier(0.22, 1, 0.36, 1)";
  void dialog.offsetWidth;
  dialog.style.height = `${nextHeight}px`;

  window.setTimeout(() => {
    dialog.style.height = "";
    dialog.style.transition = "";
  }, 340);
}

function syncSkillRunnerUi(state: SkillRunnerState): void {
  const statuses: string[] = [];
  if (state.isSkillRunning && state.activeSkillName) {
    statuses.push(`Running "${state.activeSkillName}" (${state.remainingSkillMoves} left)`);
  }
  if (state.queuedManualMoves > 0) {
    statuses.push(`Manual queue: ${state.queuedManualMoves}`);
  }
  if (statuses.length === 0) {
    statuses.push("Idle");
  }

  dom.skillRunStatusEl.textContent = statuses.join(" | ");
  dom.skillRunStatusEl.className = "skills-run-status";
  if (state.isSkillRunning) {
    dom.skillRunStatusEl.classList.add("active");
  } else if (state.queuedManualMoves > 0) {
    dom.skillRunStatusEl.classList.add("queue");
  }

  const runButtons = dom.skillsListEl.querySelectorAll<HTMLButtonElement>('button[data-action="run"]');
  runButtons.forEach((button) => {
    button.disabled = state.isProcessing;
  });
  const editButtons = dom.skillsListEl.querySelectorAll<HTMLButtonElement>('button[data-action="edit"]');
  editButtons.forEach((button) => {
    button.disabled = state.isProcessing;
  });
}

function setSkillFormMessage(
  message: string,
  tone: "info" | "good" | "warn" = "info",
): void {
  dom.skillFormMessageEl.textContent = message;
  dom.skillFormMessageEl.className = "skills-form-message";
  if (tone === "good") {
    dom.skillFormMessageEl.classList.add("good");
    return;
  }
  if (tone === "warn") {
    dom.skillFormMessageEl.classList.add("warn");
  }
}

function setThemeCustomMessage(
  message: string,
  tone: "info" | "good" | "warn" = "info",
): void {
  dom.themeCustomMessageEl.textContent = message;
  dom.themeCustomMessageEl.className = "theme-custom-message";
  if (tone === "good") {
    dom.themeCustomMessageEl.classList.add("good");
    return;
  }
  if (tone === "warn") {
    dom.themeCustomMessageEl.classList.add("warn");
  }
}

function openGameOverModal(payload: GameOverPayload): void {
  closeSubmitConfirmModal();
  closeNoticeModal();
  closeThemeCustomModal();
  closeSkillsModal();
  const lastUser = game.getLastUser().trim();
  savingGameOver = false;
  dom.gameOverSaveBtn.disabled = false;
  dom.gameOverSkipBtn.hidden = gameMode === "daily";
  dom.gameOverSkipBtn.disabled = gameMode === "daily";
  dom.gameOverScoreEl.textContent = String(payload.score);
  dom.gameOverLevelEl.textContent = String(payload.level);
  dom.gameOverNameEl.value = "";
  dom.gameOverNameEl.placeholder = lastUser.length > 0
    ? lastUser
    : "Enter name (max 20 chars)";
  dom.gameOverSubmitDbEl.checked = loadSubmitDbPreference();
  updateGameOverSubmissionHint(payload);
  dom.gameOverModalEl.classList.remove("hidden");
  dom.gameOverNameEl.focus();
}

function closeGameOverModal(): void {
  savingGameOver = false;
  pendingGameOverPayload = null;
  pendingGameOverSkillUsage = [];
  dom.gameOverSaveBtn.disabled = false;
  dom.gameOverSkipBtn.hidden = false;
  dom.gameOverSkipBtn.disabled = false;
  dom.gameOverModalEl.classList.add("hidden");
}

async function saveGameOverScore(): Promise<void> {
  if (savingGameOver) {
    return;
  }
  if (!pendingGameOverPayload) {
    closeGameOverModal();
    return;
  }
  savingGameOver = true;
  dom.gameOverSaveBtn.disabled = true;
  dom.gameOverSkipBtn.disabled = true;

  const name = dom.gameOverNameEl.value.trim() || game.getLastUser().trim();
  if (name.length === 0) {
    if (gameMode === "daily") {
      dom.gameOverBestHintEl.className = "gameover-hint warn";
      dom.gameOverBestHintEl.textContent = "Name is required to submit a Daily Challenge record.";
      savingGameOver = false;
      dom.gameOverSaveBtn.disabled = false;
      dom.gameOverSkipBtn.disabled = true;
      dom.gameOverNameEl.focus();
      return;
    }
    closeGameOverModal();
    return;
  }

  const user = name.slice(0, 20);
  game.setLastUser(user);
  saveLastUser(user);
  saveSubmitDbPreference(dom.gameOverSubmitDbEl.checked);
  const entry: ScoreEntry = {
    user,
    score: pendingGameOverPayload.score,
    level: pendingGameOverPayload.level,
    date: new Date().toISOString(),
    skillUsage: cloneSkillUsageList(pendingGameOverSkillUsage),
  };
  let runReplayProof: DailyReplayProof | null = null;
  try {
    runReplayProof = buildRunReplayProof(entry);
  } catch (error) {
    console.warn("Missing replay proof for this run. Global submission will be unavailable.", error);
  }

  const personalEntry = runReplayProof ? { ...entry, replayProof: runReplayProof } : entry;
  await scoreboardStore.addPersonal(personalEntry);
  const best = loadDeviceBestEntry();
  const isDeviceBest = runReplayProof ? isBetterThanBest(personalEntry, best) : false;
  if (isDeviceBest && personalEntry.replayProof) {
    saveDeviceBestEntry(personalEntry);
  }

  try {
    let shouldRefreshGlobal = false;
    let shouldSubmitGlobalFromDaily = false;
    if (gameMode === "daily") {
      const challengeKey = activeDailyChallengeKey ?? getCurrentDailyChallenge().key;
      const attemptToken = activeDailyAttemptToken;
      if (!attemptToken) {
        throw new Error("Missing Daily attempt token. Start a new Daily Challenge.");
      }
      if (!runReplayProof) {
        throw new Error("Missing replay proof for Daily Challenge.");
      }
      const dailyResult = await scoreboardStore.addDaily(
        challengeKey,
        attemptToken,
        entry,
        runReplayProof,
      );
      setDailyChallengeStatus(toDailyChallengeStatus(dailyResult));
      await refreshDailyBadgeStatus(dailyResult.challengeKey);
      if (!dailyResult.accepted) {
        throw new Error(
          `Daily submission was rejected (${dailyResult.attemptsUsed}/${dailyResult.maxAttempts} attempts used).`,
        );
      }
      activeDailyAttemptToken = null;
      shouldSubmitGlobalFromDaily = dailyResult.improved;
    }
    if (shouldSubmitGlobalFromDaily) {
      if (!runReplayProof) {
        throw new Error("Missing replay proof for global sync.");
      }
      await submitEntryToGlobalAndRefresh(entry, runReplayProof);
      shouldRefreshGlobal = true;
    } else if (dom.gameOverSubmitDbEl.checked && isDeviceBest) {
      if (!runReplayProof) {
        throw new Error("Missing replay proof for global submission.");
      }
      await submitEntryToGlobalAndRefresh(entry, runReplayProof);
      shouldRefreshGlobal = true;
    }
    if (
      scoreboardView === "personal" ||
      scoreboardView === "daily" ||
      shouldRefreshGlobal
    ) {
      await refreshScoreboard();
    }
    closeGameOverModal();
    game.reset();
    canResume = false;
    currentRunSkillUsage = [];
    currentRunReplaySeed = null;
    currentRunReplayInputs = [];
    currentRunReplayDifficulty = null;
    activeDailyChallengeKey = null;
    activeDailyAttemptToken = null;
    setStatus("Paused");
    clearSessionSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit score.";
    dom.gameOverBestHintEl.className = "gameover-hint warn";
    dom.gameOverBestHintEl.textContent = message;
  } finally {
    if (!dom.gameOverModalEl.classList.contains("hidden")) {
      savingGameOver = false;
      dom.gameOverSaveBtn.disabled = false;
      dom.gameOverSkipBtn.disabled = gameMode === "daily";
    }
  }
}

async function refreshScoreboard(): Promise<void> {
  if (refreshingScoreboard) {
    return;
  }

  refreshingScoreboard = true;
  const targetView = scoreboardView;
  if (targetView === "global" || targetView === "daily") {
    renderer.renderScoreboardLoading(SHARED_SCOREBOARD_LOADING_MESSAGE);
    dom.scoreListEl.classList.remove("view-fade-out");
  }

  try {
    const rows = await fetchScoreboardRows(targetView);
    setDisplayedScoreboardRows(rows);
    renderDisplayedScoreboard();
  } finally {
    refreshingScoreboard = false;
  }
}

async function refreshGlobalTop10Data(): Promise<void> {
  if (scoreboardView === "global") {
    renderer.renderScoreboardLoading(SHARED_SCOREBOARD_LOADING_MESSAGE);
  }
  const globalRows = await scoreboardStore.top(10);
  setDisplayedScoreboardRows(globalRows);
  if (scoreboardView === "global") {
    renderDisplayedScoreboard();
  }
}

function setDailyChallengeStatus(status: DailyChallengeStatus | null): void {
  dailyChallengeStatus = status;
  if (status && !status.hasActiveAttempt) {
    activeDailyAttemptToken = null;
  }
  syncGameModeUi();
}

function toDailyChallengeStatus(
  result: DailyChallengeStatus | DailyChallengeSubmitResult | DailyAttemptStartResult | DailyAttemptForfeitResult,
): DailyChallengeStatus {
  return {
    challengeKey: result.challengeKey,
    attemptsUsed: result.attemptsUsed,
    attemptsLeft: result.attemptsLeft,
    maxAttempts: result.maxAttempts,
    canSubmit: result.canSubmit,
    hasActiveAttempt: result.hasActiveAttempt === true,
  };
}

async function submitEntryToGlobalAndRefresh(
  entry: ScoreEntry,
  replayProof: DailyReplayProof,
): Promise<void> {
  await scoreboardStore.add(entry, replayProof);
  await refreshGlobalTop10Data();
}

async function fetchScoreboardRows(view: ScoreboardView): Promise<ScoreEntry[]> {
  if (view === "personal") {
    return scoreboardStore.topPersonal(10);
  }
  if (view === "daily") {
    return scoreboardStore.topDaily(getCurrentDailyChallenge().key, 10);
  }
  return scoreboardStore.top(10);
}

async function openSubmitConfirmModal(): Promise<void> {
  if (scoreboardView === "daily") {
    return;
  }
  if (isSubmitConfirmModalOpen() || preparingPersonalSubmit || submittingPersonalBest) {
    return;
  }
  closeThemeCustomModal();
  closeSkillsModal();
  collapseExpandedScoreRow();

  pendingSubmitEntry = null;
  pendingSubmitReplayProof = null;
  preparingPersonalSubmit = true;
  dom.submitConfirmConfirmBtn.disabled = true;
  dom.submitConfirmConfirmBtn.textContent = "Submit";
  dom.submitConfirmCancelBtn.disabled = false;
  dom.submitConfirmMessageEl.textContent = "Checking your device best record...";
  dom.submitConfirmModalEl.classList.remove("hidden");
  dom.submitConfirmCancelBtn.focus();

  try {
    const bestPersonal = loadDeviceBestEntry();
    if (!isSubmitConfirmModalOpen()) {
      return;
    }

    if (!bestPersonal) {
      dom.submitConfirmMessageEl.textContent = "No device best record available to submit.";
      return;
    }

    if (!bestPersonal.replayProof) {
      dom.submitConfirmMessageEl.textContent =
        "This device best record was saved before replay verification. Play a new run to submit.";
      return;
    }

    pendingSubmitEntry = bestPersonal;
    pendingSubmitReplayProof = bestPersonal.replayProof;
    dom.submitConfirmMessageEl.textContent =
      `Submit this record to GLOBAL TOP 10?\n${bestPersonal.user} · ${bestPersonal.score} pts · Lv.${bestPersonal.level}`;
    dom.submitConfirmConfirmBtn.disabled = false;
    dom.submitConfirmConfirmBtn.focus();
  } catch (error) {
    console.warn("Failed to prepare personal best score submission.", error);
    dom.submitConfirmMessageEl.textContent = "Failed to check records. Please try again.";
  } finally {
    preparingPersonalSubmit = false;
  }
}

async function confirmSubmitPersonalBest(): Promise<void> {
  if (preparingPersonalSubmit || submittingPersonalBest) {
    return;
  }
  if (!pendingSubmitEntry) {
    closeSubmitConfirmModal();
    return;
  }
  if (!pendingSubmitReplayProof) {
    dom.submitConfirmMessageEl.textContent =
      "Missing replay proof for this record. Play a new run and try again.";
    return;
  }

  submittingPersonalBest = true;
  dom.submitConfirmConfirmBtn.disabled = true;
  dom.submitConfirmCancelBtn.disabled = true;
  dom.submitConfirmConfirmBtn.textContent = "Submitting";
  dom.submitPersonalBtn.disabled = true;
  dom.submitPersonalBtn.textContent = "Submitting";

  try {
    await submitEntryToGlobalAndRefresh(pendingSubmitEntry, pendingSubmitReplayProof);
    dom.submitPersonalBtn.textContent = "Submitted";
    closeSubmitConfirmModal(true);
  } catch (error) {
    console.warn("Failed to submit personal best score.", error);
    dom.submitPersonalBtn.textContent = "Retry";
    dom.submitConfirmMessageEl.textContent = "Submission failed. Please try again.";
    dom.submitConfirmConfirmBtn.disabled = false;
    dom.submitConfirmCancelBtn.disabled = false;
    dom.submitConfirmConfirmBtn.textContent = "Retry";
  } finally {
    submittingPersonalBest = false;
    window.setTimeout(() => {
      if (!submittingPersonalBest) {
        syncScoreboardViewUi();
      }
    }, 1200);
  }
}

function closeSubmitConfirmModal(force = false): void {
  if (submittingPersonalBest && !force) {
    return;
  }
  pendingSubmitEntry = null;
  pendingSubmitReplayProof = null;
  preparingPersonalSubmit = false;
  dom.submitConfirmModalEl.classList.add("hidden");
  dom.submitConfirmConfirmBtn.disabled = true;
  dom.submitConfirmConfirmBtn.textContent = "Submit";
  dom.submitConfirmCancelBtn.disabled = false;
}

function isSubmitConfirmModalOpen(): boolean {
  return !dom.submitConfirmModalEl.classList.contains("hidden");
}

function openNoticeModal(title: string, message: string, onClose?: () => void): void {
  if (isNoticeModalOpen() && noticeModalOnClose) {
    const previousOnClose = noticeModalOnClose;
    noticeModalOnClose = null;
    previousOnClose();
  }
  noticeModalOnClose = onClose ?? null;
  dom.noticeTitleEl.textContent = title.trim().slice(0, 60) || "Notice";
  dom.noticeMessageEl.textContent = message;
  dom.noticeModalEl.classList.remove("hidden");
  dom.noticeOkBtn.focus();
}

function openNoticeModalAndWait(title: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    openNoticeModal(title, message, resolve);
  });
}

function closeNoticeModal(): void {
  if (!isNoticeModalOpen()) {
    return;
  }
  dom.noticeModalEl.classList.add("hidden");
  const onClose = noticeModalOnClose;
  noticeModalOnClose = null;
  if (onClose) {
    onClose();
  }
}

function isNoticeModalOpen(): boolean {
  return !dom.noticeModalEl.classList.contains("hidden");
}

async function setScoreboardView(nextView: ScoreboardView): Promise<void> {
  if (scoreboardView === nextView) {
    return;
  }
  await switchScoreboardView(() => {
    scoreboardView = nextView;
    if (nextView === "global" || nextView === "personal") {
      nonDailyScoreboardView = nextView;
    }
  });
}

async function switchScoreboardView(applyViewChange: () => void): Promise<void> {
  if (switchingScoreboardView) {
    return;
  }

  switchingScoreboardView = true;
  try {
    dom.scoreListEl.classList.add("view-fade-out");
    await delay(120);

    applyViewChange();
    expandedScoreIndex = null;
    syncScoreboardViewUi();
    await refreshScoreboard();

    dom.scoreListEl.classList.remove("view-fade-out");
    dom.scoreListEl.classList.remove("view-fade-in");
    void dom.scoreListEl.offsetWidth;
    dom.scoreListEl.classList.add("view-fade-in");
    window.setTimeout(() => {
      dom.scoreListEl.classList.remove("view-fade-in");
    }, 180);
  } finally {
    dom.scoreListEl.classList.remove("view-fade-out");
    switchingScoreboardView = false;
  }
}

function syncScoreboardViewUi(): void {
  const globalMode = scoreboardView === "global";
  const personalMode = scoreboardView === "personal";
  const dailyMode = scoreboardView === "daily";
  const challenge = getCurrentDailyChallenge();
  if (dailyMode) {
    dom.scoreTitleEl.textContent = `${DAILY_SCORE_TITLE} · ${challenge.key}`;
  } else if (personalMode) {
    dom.scoreTitleEl.textContent = PERSONAL_SCORE_TITLE;
  } else {
    dom.scoreTitleEl.textContent = GLOBAL_SCORE_TITLE;
  }
  dom.scoreListEl.classList.toggle("global-mode", globalMode);
  dom.globalScoreBtn.classList.toggle("active", globalMode);
  dom.personalScoreBtn.classList.toggle("active", personalMode);
  dom.dailyScoreBtn.classList.toggle("active", dailyMode);
  dom.globalScoreBtn.setAttribute("aria-pressed", globalMode ? "true" : "false");
  dom.personalScoreBtn.setAttribute("aria-pressed", personalMode ? "true" : "false");
  dom.dailyScoreBtn.setAttribute("aria-pressed", dailyMode ? "true" : "false");

  dom.submitPersonalBtn.title = dailyMode
    ? "Daily Challenge runs are auto-submitted. Use GLOBAL/PERSONAL tabs for manual submit."
    : "";
  if (!submittingPersonalBest) {
    dom.submitPersonalBtn.textContent = PERSONAL_SUBMIT_BUTTON_LABEL;
    dom.submitPersonalBtn.disabled = dailyMode;
  }
}

function syncScoreRowAccessibility(): void {
  const rows = dom.scoreListEl.querySelectorAll<HTMLLIElement>("li.score-row");
  rows.forEach((row) => {
    row.setAttribute("tabindex", "0");
    row.setAttribute("role", "button");
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeHexColorInput(value: string): string | null {
  const candidate = value.trim();
  if (!HEX_COLOR_PATTERN.test(candidate)) {
    return null;
  }
  return candidate.toLowerCase();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function hexToRgb(color: string): [number, number, number] {
  const safeColor = normalizeHexColorInput(color) ?? "#ffffff";
  const hex = safeColor.slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return [r, g, b];
}

function toAlphaString(value: number): string {
  return (Math.round(clamp01(value) * 1000) / 1000).toString();
}

function normalizeSkillUsage(raw: unknown): SkillUsageEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is SkillUsageEntry => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const row = entry as Record<string, unknown>;
      return (
        typeof row.name === "string" &&
        (typeof row.hotkey === "string" || row.hotkey === null) &&
        (
          typeof row.command === "string" ||
          row.command === null ||
          typeof row.command === "undefined"
        )
      );
    })
    .map((entry) => ({
      name: entry.name.trim().slice(0, 20),
      hotkey: entry.hotkey ? entry.hotkey.trim().slice(0, 16) : null,
      command: normalizeSkillCommand(entry.command),
    }))
    .filter((entry) => entry.name.length > 0)
    .slice(0, 20);
}

function cloneSkillUsageList(usages: ReadonlyArray<SkillUsageEntry>): SkillUsageEntry[] {
  return usages.map((usage) => ({
    name: usage.name,
    hotkey: usage.hotkey,
    command: usage.command,
  }));
}

function normalizeReplaySeed(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }
  return Math.trunc(raw) >>> 0;
}

function normalizeReplayDifficulty(raw: unknown): Difficulty | null {
  if (raw === 1 || raw === 2 || raw === 3) {
    return raw;
  }
  return null;
}

function resolveSnapshotReplaySeed(snapshot: PersistedSessionSnapshot): number | null {
  const raw = typeof snapshot.currentRunReplaySeed !== "undefined"
    ? snapshot.currentRunReplaySeed
    : snapshot.currentDailyReplaySeed;
  return normalizeReplaySeed(raw);
}

function resolveSnapshotReplayInputs(snapshot: PersistedSessionSnapshot): ReplayInputEvent[] {
  const raw = typeof snapshot.currentRunReplayInputs !== "undefined"
    ? snapshot.currentRunReplayInputs
    : snapshot.currentDailyReplayInputs;
  return normalizeReplayInputs(raw);
}

function resolveSnapshotReplayDifficulty(snapshot: PersistedSessionSnapshot): Difficulty | null {
  if (typeof snapshot.currentRunReplayDifficulty !== "undefined") {
    return normalizeReplayDifficulty(snapshot.currentRunReplayDifficulty);
  }
  return normalizeReplayDifficulty(snapshot.gameState?.difficulty);
}

function buildRunReplayProof(entry: ScoreEntry): DailyReplayProof {
  if (currentRunReplaySeed === null) {
    throw new Error("Missing replay seed for current run.");
  }
  const replayDifficulty = currentRunReplayDifficulty ?? 1;
  const snapshot = latestSnapshot ?? game.exportState();
  return {
    version: 1,
    difficulty: replayDifficulty,
    seed: currentRunReplaySeed >>> 0,
    finalTime: Math.max(0, Math.trunc(snapshot.time)),
    finalScore: Math.max(0, Math.trunc(entry.score)),
    finalLevel: Math.max(0, Math.trunc(entry.level)),
    inputs: cloneReplayInputs(currentRunReplayInputs),
  };
}

function cloneScoreEntry(entry: ScoreEntry): ScoreEntry {
  return {
    user: entry.user,
    score: entry.score,
    level: entry.level,
    date: entry.date,
    badgePower: entry.badgePower ?? null,
    badgeMaxStreak: entry.badgeMaxStreak ?? null,
    skillUsage: cloneSkillUsageList(entry.skillUsage),
    isMe: entry.isMe === true,
    replayProof: entry.replayProof ? {
      version: 1,
      difficulty: entry.replayProof.difficulty,
      seed: entry.replayProof.seed,
      finalTime: entry.replayProof.finalTime,
      finalScore: entry.replayProof.finalScore,
      finalLevel: entry.replayProof.finalLevel,
      inputs: cloneReplayInputs(entry.replayProof.inputs),
    } : undefined,
  };
}

function normalizeSkillCommand(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim().slice(0, 120);
  return value.length > 0 ? value : null;
}

interface DailyChallengeSpec {
  key: string;
  seed: number;
  difficulty: Difficulty;
}

function getCurrentDailyChallenge(now: Date = new Date()): DailyChallengeSpec {
  const key = now.toISOString().slice(0, 10);
  return {
    key,
    seed: hashStringToSeed(`torus-daily-${key}`),
    difficulty: DAILY_CHALLENGE_DIFFICULTY,
  };
}

function hashStringToSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createReplaySeed(): number {
  if (typeof window.crypto?.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    window.crypto.getRandomValues(buffer);
    return buffer[0] >>> 0;
  }
  return Math.trunc(Math.random() * 4294967296) >>> 0;
}

function loadGameModePreference(): GameMode {
  try {
    return window.localStorage.getItem(GAME_MODE_STORAGE_KEY) === "daily"
      ? "daily"
      : "classic";
  } catch {
    return "classic";
  }
}

function saveGameModePreference(mode: GameMode): void {
  try {
    window.localStorage.setItem(GAME_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage errors and continue with current mode.
  }
}

function startSessionAutosave(): void {
  if (sessionAutosaveTimer !== null) {
    window.clearInterval(sessionAutosaveTimer);
  }
  sessionAutosaveTimer = window.setInterval(() => {
    saveSessionSnapshot();
  }, SESSION_AUTOSAVE_INTERVAL_MS);
}

function stopSessionAutosave(): void {
  if (sessionAutosaveTimer === null) {
    return;
  }
  window.clearInterval(sessionAutosaveTimer);
  sessionAutosaveTimer = null;
}

function saveSessionSnapshot(force = false): void {
  if (restoringSessionSnapshot || pendingSessionRestoreSnapshot) {
    return;
  }
  if (!canResume || pendingGameOverPayload) {
    clearSessionSnapshot();
    return;
  }

  const gameState = game.exportState();
  if (!hasRecoverableGameState(gameState)) {
    clearSessionSnapshot();
    return;
  }
  if (
    gameMode === "daily" &&
    (!activeDailyChallengeKey || !activeDailyAttemptToken || currentRunReplaySeed === null)
  ) {
    clearSessionSnapshot();
    return;
  }

  const snapshot: PersistedSessionSnapshot = {
    version: 1,
    savedAt: Date.now(),
    gameMode,
    activeDailyChallengeKey: activeDailyChallengeKey,
    activeDailyAttemptToken: activeDailyAttemptToken,
    canResume,
    autoHorizontalDirection,
    currentRunSkillUsage: cloneSkillUsageList(currentRunSkillUsage),
    currentRunReplaySeed,
    currentRunReplayInputs: cloneReplayInputs(currentRunReplayInputs),
    currentRunReplayDifficulty,
    gameState,
  };
  const payload = JSON.stringify(snapshot);
  if (!force && payload === lastSessionSnapshotPayload) {
    return;
  }

  try {
    window.localStorage.setItem(SESSION_SNAPSHOT_STORAGE_KEY, payload);
    lastSessionSnapshotPayload = payload;
  } catch {
    // Ignore storage errors and continue gameplay.
  }
}

function clearSessionSnapshot(): void {
  lastSessionSnapshotPayload = "";
  try {
    window.localStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  } catch {
    // Ignore storage errors and continue gameplay.
  }
}

function promptSessionRestoreIfAvailable(): void {
  const snapshot = loadSessionSnapshot();
  if (!snapshot) {
    return;
  }
  if (!snapshot.canResume || !hasRecoverableGameState(snapshot.gameState)) {
    clearSessionSnapshot();
    return;
  }

  if (snapshot.gameMode === "daily") {
    const todayKey = getCurrentDailyChallenge().key;
    if (
      snapshot.activeDailyChallengeKey !== todayKey ||
      !snapshot.activeDailyAttemptToken ||
      resolveSnapshotReplaySeed(snapshot) === null
    ) {
      clearSessionSnapshot();
      return;
    }
  }

  pendingSessionRestoreSnapshot = snapshot;
  openSessionRestoreModal(snapshot);
}

async function confirmSessionRestoreContinue(): Promise<void> {
  const snapshot = pendingSessionRestoreSnapshot;
  if (!snapshot) {
    return;
  }
  pendingSessionRestoreSnapshot = null;
  closeSessionRestoreModal();
  applySessionSnapshot(snapshot);
}

async function confirmSessionRestoreReset(): Promise<void> {
  const snapshot = pendingSessionRestoreSnapshot;
  pendingSessionRestoreSnapshot = null;
  closeSessionRestoreModal();
  if (!snapshot) {
    return;
  }

  const todayKey = getCurrentDailyChallenge().key;
  if (
    snapshot.gameMode === "daily" &&
    snapshot.activeDailyChallengeKey === todayKey &&
    snapshot.activeDailyChallengeKey &&
    snapshot.activeDailyAttemptToken
  ) {
    try {
      const result = await scoreboardStore.forfeitDailyAttempt(
        snapshot.activeDailyChallengeKey,
        snapshot.activeDailyAttemptToken,
      );
      setDailyChallengeStatus(toDailyChallengeStatus(result));
      await refreshDailyBadgeStatus(snapshot.activeDailyChallengeKey);
    } catch (error) {
      console.warn("Failed to forfeit pending daily attempt from recovery snapshot.", error);
    }
  }
  clearSessionSnapshot();
}

function applySessionSnapshot(snapshot: PersistedSessionSnapshot): void {
  if (snapshot.gameMode === "daily") {
    gameMode = "daily";
    scoreboardView = "daily";
  } else {
    gameMode = "classic";
    if (scoreboardView === "daily") {
      scoreboardView = nonDailyScoreboardView;
    }
  }

  restoringSessionSnapshot = true;
  const imported = game.importState(snapshot.gameState);
  restoringSessionSnapshot = false;
  if (!imported) {
    clearSessionSnapshot();
    return;
  }

  if (snapshot.gameState.gameOn) {
    game.pause();
  }
  canResume = true;
  activeDailyChallengeKey = snapshot.gameMode === "daily"
    ? snapshot.activeDailyChallengeKey
    : null;
  activeDailyAttemptToken = snapshot.gameMode === "daily"
    ? snapshot.activeDailyAttemptToken
    : null;
  autoHorizontalDirection = snapshot.autoHorizontalDirection;
  currentRunSkillUsage = normalizeSkillUsage(snapshot.currentRunSkillUsage);
  currentRunReplaySeed = resolveSnapshotReplaySeed(snapshot);
  currentRunReplayInputs = resolveSnapshotReplayInputs(snapshot);
  currentRunReplayDifficulty = resolveSnapshotReplayDifficulty(snapshot);
  pendingGameOverPayload = null;
  pendingGameOverSkillUsage = [];
  setStatus("Paused");
  saveGameModePreference(gameMode);
  syncGameModeUi();
  syncScoreboardViewUi();
  if (gameMode === "daily" && activeDailyChallengeKey) {
    void refreshDailyChallengeStatus(activeDailyChallengeKey);
    void refreshDailyBadgeStatus(activeDailyChallengeKey);
  }
  saveSessionSnapshot(true);
}

function openSessionRestoreModal(snapshot: PersistedSessionSnapshot): void {
  dom.sessionRestoreMessageEl.textContent = formatSessionRestoreMessage(snapshot);
  dom.sessionRestoreModalEl.classList.remove("hidden");
  dom.sessionRestoreContinueBtn.focus();
}

function closeSessionRestoreModal(): void {
  dom.sessionRestoreModalEl.classList.add("hidden");
}

function isSessionRestoreModalOpen(): boolean {
  return !dom.sessionRestoreModalEl.classList.contains("hidden");
}

function formatSessionRestoreMessage(snapshot: PersistedSessionSnapshot): string {
  const savedAt = new Date(snapshot.savedAt);
  const savedAtLabel = Number.isNaN(savedAt.getTime())
    ? "-"
    : savedAt.toLocaleString();
  const modeLabel = snapshot.gameMode === "daily" ? "Daily Challenge" : "Classic";
  return `A ${modeLabel} run from ${savedAtLabel} was found. Continue from that state?`;
}

function loadSessionSnapshot(): PersistedSessionSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SESSION_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedSessionSnapshot(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isPersistedSessionSnapshot(raw: unknown): raw is PersistedSessionSnapshot {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const candidate = raw as Record<string, unknown>;
  const replaySeedCurrentValid = (
    typeof candidate.currentRunReplaySeed === "undefined" ||
    typeof candidate.currentRunReplaySeed === "number" ||
    candidate.currentRunReplaySeed === null
  );
  const replaySeedLegacyValid = (
    typeof candidate.currentDailyReplaySeed === "undefined" ||
    typeof candidate.currentDailyReplaySeed === "number" ||
    candidate.currentDailyReplaySeed === null
  );
  const replaySeedValid = replaySeedCurrentValid && replaySeedLegacyValid;
  const replayInputsCurrentValid = (
    typeof candidate.currentRunReplayInputs === "undefined" ||
    Array.isArray(candidate.currentRunReplayInputs)
  );
  const replayInputsLegacyValid = (
    typeof candidate.currentDailyReplayInputs === "undefined" ||
    Array.isArray(candidate.currentDailyReplayInputs)
  );
  const replayInputsValid = replayInputsCurrentValid && replayInputsLegacyValid;
  const replayDifficultyValid = (
    typeof candidate.currentRunReplayDifficulty === "undefined" ||
    typeof candidate.currentRunReplayDifficulty === "number" ||
    candidate.currentRunReplayDifficulty === null
  );
  return (
    candidate.version === 1 &&
    typeof candidate.savedAt === "number" &&
    (candidate.gameMode === "classic" || candidate.gameMode === "daily") &&
    (typeof candidate.activeDailyChallengeKey === "string" || candidate.activeDailyChallengeKey === null) &&
    (typeof candidate.activeDailyAttemptToken === "string" || candidate.activeDailyAttemptToken === null) &&
    typeof candidate.canResume === "boolean" &&
    (candidate.autoHorizontalDirection === "left" || candidate.autoHorizontalDirection === "right") &&
    Array.isArray(candidate.currentRunSkillUsage) &&
    replaySeedValid &&
    replayInputsValid &&
    replayDifficultyValid &&
    !!candidate.gameState
  );
}

function hasRecoverableGameState(gameState: PersistedGameState): boolean {
  if (gameState.score > 0 || gameState.level > 0 || gameState.time > 0) {
    return true;
  }
  if (gameState.numToriInPole > 0) {
    return true;
  }
  if (gameState.numTori.some((count) => count > 0)) {
    return true;
  }
  return gameState.flyingTori.some((entry) => entry !== null);
}

function loadLastUser(): string {
  try {
    const raw = window.localStorage.getItem(LAST_USER_STORAGE_KEY);
    if (!raw) {
      return "";
    }
    return raw.trim().slice(0, 20);
  } catch {
    return "";
  }
}

function saveLastUser(user: string): void {
  try {
    window.localStorage.setItem(LAST_USER_STORAGE_KEY, user);
  } catch {
    // Ignore storage failures and continue saving score.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function loadSubmitDbPreference(): boolean {
  try {
    return window.localStorage.getItem(SUBMIT_DB_PREF_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveSubmitDbPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(SUBMIT_DB_PREF_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore preference storage errors.
  }
}

function loadDeviceBestEntry(): ScoreEntry | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_BEST_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.user !== "string" ||
      typeof candidate.score !== "number" ||
      typeof candidate.level !== "number" ||
      typeof candidate.date !== "string"
    ) {
      return null;
    }
    const replayProof = normalizeStoredReplayProof(candidate.replayProof);
    if (!replayProof) {
      try {
        window.localStorage.removeItem(DEVICE_BEST_STORAGE_KEY);
      } catch {
        // Ignore storage cleanup errors.
      }
      return null;
    }
    return {
      user: candidate.user,
      score: candidate.score,
      level: candidate.level,
      date: candidate.date,
      skillUsage: normalizeSkillUsage(candidate.skillUsage),
      replayProof,
    };
  } catch {
    return null;
  }
}

function normalizeStoredReplayProof(raw: unknown): DailyReplayProof | undefined {
  return normalizeReplayProof(raw, MAX_REPLAY_INPUTS);
}

function saveDeviceBestEntry(entry: ScoreEntry): void {
  if (!entry.replayProof) {
    return;
  }
  try {
    window.localStorage.setItem(DEVICE_BEST_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage errors and continue gameplay.
  }
}

function isBetterThanBest(entry: ScoreEntry, best: ScoreEntry | null): boolean {
  if (!best) {
    return true;
  }
  if (entry.score !== best.score) {
    return entry.score > best.score;
  }
  if (entry.level !== best.level) {
    return entry.level > best.level;
  }
  return false;
}

function updateGameOverSubmissionHint(payload: GameOverPayload): void {
  if (gameMode === "daily") {
    dom.gameOverSubmitDbEl.checked = false;
    dom.gameOverSubmitDbEl.disabled = true;
    dom.gameOverBestHintEl.className = "gameover-hint good";
    const challenge = getCurrentDailyChallenge();
    const status = dailyChallengeStatus && dailyChallengeStatus.challengeKey === challenge.key
      ? dailyChallengeStatus
      : null;
    dom.gameOverBestHintEl.textContent = status
      ? `Daily Challenge submits automatically. Attempts left today: ${status.attemptsLeft}. If this run becomes your Daily best, it also syncs to Global.`
      : "Daily Challenge submits automatically. Daily best is also synced to Global.";
    return;
  }

  if (currentRunReplaySeed === null) {
    dom.gameOverSubmitDbEl.checked = false;
    dom.gameOverSubmitDbEl.disabled = true;
    dom.gameOverBestHintEl.className = "gameover-hint warn";
    dom.gameOverBestHintEl.textContent =
      "Replay data is missing for this run, so GLOBAL submission is disabled.";
    return;
  }

  const best = loadDeviceBestEntry();
  const candidate: ScoreEntry = {
    user: "",
    score: payload.score,
    level: payload.level,
    date: new Date().toISOString(),
    skillUsage: [],
  };
  const isDeviceBest = isBetterThanBest(candidate, best);

  if (isDeviceBest) {
    dom.gameOverSubmitDbEl.disabled = false;
    dom.gameOverBestHintEl.className = "gameover-hint good";
    dom.gameOverBestHintEl.textContent = best
      ? `New device best score. (Previous: ${best.score} / Lv.${best.level})`
      : "This is your first device record.";
    return;
  }

  dom.gameOverSubmitDbEl.checked = false;
  dom.gameOverSubmitDbEl.disabled = true;
  dom.gameOverBestHintEl.className = "gameover-hint warn";
  dom.gameOverBestHintEl.textContent = best
    ? `Lower than this device best (${best.score} / Lv.${best.level}), so DB submission is disabled.`
    : "Current score is not your device best.";
}

async function maybeCheckForUpdatesOnLaunch(): Promise<void> {
  if (import.meta.env.DEV || !isTauri()) {
    return;
  }
  hideUpdateNotice();

  const isMac = isMacDesktopPlatform();
  if (isMac && MIN_SUPPORTED_MAC_VERSION.length > 0) {
    const currentVersion = await getCurrentAppVersionSafe();
    if (currentVersion && compareAppVersions(currentVersion, MIN_SUPPORTED_MAC_VERSION) < 0) {
      showUpdateNotice(
        `Update required: v${MIN_SUPPORTED_MAC_VERSION}+ (current v${currentVersion})`,
        MAC_APP_STORE_URL,
        true,
      );
      return;
    }
  }

  if (!shouldCheckForUpdatesNow()) {
    return;
  }

  markUpdateCheckTimestamp();

  let update: Update | null = null;
  try {
    update = await check();
    if (!update) {
      return;
    }

    if (isMac) {
      showUpdateNotice(
        `New version v${update.version} is available (current v${update.currentVersion}).`,
        MAC_APP_STORE_URL,
      );
      return;
    }

    const approved = window.confirm(
      `A new version of Torus is available.\n\nCurrent: v${update.currentVersion}\nLatest: v${update.version}\n\nInstall now? The app will restart after installation.`,
    );
    if (!approved) {
      return;
    }

    await update.downloadAndInstall();
    await openNoticeModalAndWait(
      "Update",
      `Torus v${update.version} has been installed. The app will now restart.`,
    );
    await relaunch();
  } catch (error) {
    console.warn("Failed to check/install app updates.", error);
  } finally {
    if (update) {
      try {
        await update.close();
      } catch {
        // Ignore updater resource cleanup errors.
      }
    }
  }
}

function shouldCheckForUpdatesNow(): boolean {
  try {
    const raw = window.localStorage.getItem(LAST_UPDATE_CHECK_STORAGE_KEY);
    if (!raw) {
      return true;
    }
    const lastCheckedAt = Number(raw);
    if (!Number.isFinite(lastCheckedAt)) {
      return true;
    }
    return Date.now() - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markUpdateCheckTimestamp(): void {
  try {
    window.localStorage.setItem(LAST_UPDATE_CHECK_STORAGE_KEY, String(Date.now()));
  } catch {
    // Ignore storage errors and continue update checks.
  }
}

async function getCurrentAppVersionSafe(): Promise<string | null> {
  try {
    return await getVersion();
  } catch (error) {
    console.warn("Failed to read current app version.", error);
    return null;
  }
}

function isMacDesktopPlatform(): boolean {
  const platform = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return platform.toLowerCase().includes("mac");
}

function compareAppVersions(left: string, right: string): number {
  const leftParts = parseAppVersionParts(left);
  const rightParts = parseAppVersionParts(right);
  if (!leftParts || !rightParts) {
    return 0;
  }

  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }
  return 0;
}

function parseAppVersionParts(version: string): number[] | null {
  const normalized = version.trim().replace(/^v/i, "").split("-")[0] ?? "";
  if (normalized.length === 0) {
    return null;
  }

  const parts = normalized.split(".");
  const parsed: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (!Number.isFinite(value)) {
      return null;
    }
    parsed.push(value);
  }
  return parsed;
}

function showUpdateNotice(message: string, downloadUrl: string, required = false): void {
  updateNoticeDownloadUrl = downloadUrl;
  dom.updateNoticeMessageEl.textContent = message;
  dom.updateNoticeEl.classList.toggle("required", required);
  dom.updateNoticeEl.classList.remove("hidden");
}

function hideUpdateNotice(): void {
  updateNoticeDownloadUrl = null;
  dom.updateNoticeMessageEl.textContent = "";
  dom.updateNoticeEl.classList.remove("required");
  dom.updateNoticeEl.classList.add("hidden");
}

async function openUpdateNoticeDownload(): Promise<void> {
  if (!updateNoticeDownloadUrl) {
    return;
  }
  try {
    await openUrl(updateNoticeDownloadUrl);
  } catch (error) {
    console.warn("Failed to open update download link.", error);
    openNoticeModal("Update", `Open this link to update: ${updateNoticeDownloadUrl}`);
  }
}
