import "./styles.css";
import { type Difficulty, type GameOverPayload, TorusGame } from "./game";
import { createScoreboardStore, type ScoreEntry } from "./scoreboard";
import { mountTorusLayout } from "./ui/layout";
import { type GameStatus, TorusRenderer } from "./ui/renderer";
import { ThemeManager } from "./ui/theme";

type ScoreboardView = "global" | "personal";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("Missing #app container");
}

const dom = mountTorusLayout(appRoot);
const renderer = new TorusRenderer(dom);
const themeManager = new ThemeManager(dom.themeChipEl);
const scoreboardStore = createScoreboardStore();
const LAST_USER_STORAGE_KEY = "torus-last-user-v1";
const DEVICE_BEST_STORAGE_KEY = "torus-device-best-v1";
const SUBMIT_DB_PREF_STORAGE_KEY = "torus-submit-db-pref-v1";
const PERSONAL_SUBMIT_BUTTON_LABEL = "Submit";
const GLOBAL_SCORE_TITLE = "GLOBAL TOP 10";
const PERSONAL_SCORE_TITLE = "PERSONAL TOP 10";
let pendingGameOverPayload: GameOverPayload | null = null;
let pendingSubmitEntry: ScoreEntry | null = null;
let keyCardVisible = true;
let canResume = false;
let savingGameOver = false;
let refreshingScoreboard = false;
let submittingPersonalBest = false;
let preparingPersonalSubmit = false;
let switchingScoreboardView = false;
let scoreboardView: ScoreboardView = "global";

const game = new TorusGame(
  (snapshot) => renderer.render(snapshot),
  (payload) => onGameOver(payload),
);
game.setLastUser(loadLastUser());

themeManager.apply(0);
renderer.setStatus("Paused");
renderer.renderScoreboard([]);
syncScoreboardViewUi();
void refreshScoreboard();
setDifficulty(parseDifficulty(dom.difficultyEl.value));
renderer.refreshLayout();

bindUiControls();
bindKeyboardControls();
bindGameOverModal();
bindSubmitConfirmModal();

window.addEventListener("resize", () => {
  renderer.refreshLayout();
});

window.addEventListener("beforeunload", () => {
  game.destroy();
});

function bindUiControls(): void {
  dom.difficultyEl.addEventListener("change", () => {
    setDifficulty(parseDifficulty(dom.difficultyEl.value));
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

  dom.quitBtn.addEventListener("click", () => {
    resetGame();
  });

  dom.themeBtn.addEventListener("click", () => {
    themeManager.cycle();
  });

  dom.toggleScoreBtn.addEventListener("click", () => {
    renderer.toggleScoreboard();
  });

  dom.toggleKeyBtn.addEventListener("click", () => {
    toggleKeyCard();
  });

  dom.personalScoreBtn.addEventListener("click", () => {
    void toggleScoreboardView();
  });

  dom.submitPersonalBtn.addEventListener("click", () => {
    void openSubmitConfirmModal();
  });
}

function bindKeyboardControls(): void {
  const actionsByKey: Record<string, () => void> = {
    arrowleft: () => game.moveLeft(),
    j: () => game.moveLeft(),
    arrowright: () => game.moveRight(),
    l: () => game.moveRight(),
    arrowup: () => game.moveUp(),
    i: () => game.moveUp(),
    arrowdown: () => game.moveDown(),
    k: () => game.moveDown(),
    n: () => startNewGame(),
    r: () => resumeGame(),
    p: () => pauseGame(),
    q: () => resetGame(),
    c: () => themeManager.cycle(),
    s: () => renderer.toggleScoreboard(),
    h: () => toggleKeyCard(),
    "1": () => setDifficulty(1),
    "2": () => setDifficulty(2),
    "3": () => setDifficulty(3),
  };

  const actionsByCode: Record<string, () => void> = {
    ArrowLeft: () => game.moveLeft(),
    KeyJ: () => game.moveLeft(),
    ArrowRight: () => game.moveRight(),
    KeyL: () => game.moveRight(),
    ArrowUp: () => game.moveUp(),
    KeyI: () => game.moveUp(),
    ArrowDown: () => game.moveDown(),
    KeyK: () => game.moveDown(),
    KeyN: () => startNewGame(),
    KeyR: () => resumeGame(),
    KeyP: () => pauseGame(),
    KeyQ: () => resetGame(),
    KeyC: () => themeManager.cycle(),
    KeyS: () => renderer.toggleScoreboard(),
    KeyH: () => toggleKeyCard(),
    Digit1: () => setDifficulty(1),
    Digit2: () => setDifficulty(2),
    Digit3: () => setDifficulty(3),
    Numpad1: () => setDifficulty(1),
    Numpad2: () => setDifficulty(2),
    Numpad3: () => setDifficulty(3),
  };

  window.addEventListener("keydown", (event) => {
    if (isFormTarget(event.target)) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
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

    if (pendingGameOverPayload) {
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
  game.startNewGame(parseDifficulty(dom.difficultyEl.value));
  canResume = true;
  setStatus("Running");
}

function resumeGame(): void {
  if (pendingGameOverPayload || !canResume) {
    return;
  }
  game.resume();
  setStatus("Running");
}

function pauseGame(): void {
  game.pause();
  setStatus("Paused");
}

function resetGame(): void {
  closeGameOverModal();
  closeSubmitConfirmModal();
  game.reset();
  canResume = false;
  setStatus("Paused");
}

function setDifficulty(difficulty: Difficulty): void {
  dom.difficultyEl.value = String(difficulty);
  game.setDifficulty(difficulty);
}

function setStatus(status: GameStatus): void {
  renderer.setStatus(status);
}

function onGameOver(payload: GameOverPayload): void {
  setStatus("Game Over");
  canResume = false;
  pendingGameOverPayload = payload;
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
  keyCardVisible = !keyCardVisible;
  dom.keyCardEl.classList.toggle("hidden", !keyCardVisible);
  dom.sideColumnEl.classList.toggle("key-hidden", !keyCardVisible);
}

function bindGameOverModal(): void {
  dom.gameOverSaveBtn.addEventListener("click", () => {
    void saveGameOverScore();
  });

  dom.gameOverSkipBtn.addEventListener("click", () => {
    closeGameOverModal();
  });

  dom.gameOverNameEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void saveGameOverScore();
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      closeGameOverModal();
      event.preventDefault();
    }
  });

  dom.gameOverModalEl.addEventListener("click", (event) => {
    if (event.target === dom.gameOverModalEl) {
      closeGameOverModal();
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

function openGameOverModal(payload: GameOverPayload): void {
  closeSubmitConfirmModal();
  const lastUser = game.getLastUser().trim();
  savingGameOver = false;
  dom.gameOverSaveBtn.disabled = false;
  dom.gameOverSkipBtn.disabled = false;
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
  dom.gameOverSaveBtn.disabled = false;
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
  };
  await scoreboardStore.addPersonal(entry);
  const best = loadDeviceBestEntry();
  const isDeviceBest = isBetterThanBest(entry, best);
  if (isDeviceBest) {
    saveDeviceBestEntry(entry);
  }

  try {
    let shouldRefreshGlobal = false;
    if (dom.gameOverSubmitDbEl.checked && isDeviceBest) {
      await scoreboardStore.add(entry);
      await refreshGlobalTop10Data();
      shouldRefreshGlobal = true;
    }
    if (scoreboardView === "personal" || shouldRefreshGlobal) {
      await refreshScoreboard();
    }
    closeGameOverModal();
    game.reset();
    canResume = false;
    setStatus("Paused");
  } finally {
    if (!dom.gameOverModalEl.classList.contains("hidden")) {
      savingGameOver = false;
      dom.gameOverSaveBtn.disabled = false;
      dom.gameOverSkipBtn.disabled = false;
    }
  }
}

async function refreshScoreboard(): Promise<void> {
  if (refreshingScoreboard) {
    return;
  }

  refreshingScoreboard = true;

  try {
    const rows = scoreboardView === "personal"
      ? await scoreboardStore.topPersonal(10)
      : await scoreboardStore.top(10);
    renderer.renderScoreboard(rows);
  } finally {
    refreshingScoreboard = false;
  }
}

async function refreshGlobalTop10Data(): Promise<void> {
  const globalRows = await scoreboardStore.top(10);
  if (scoreboardView === "global") {
    renderer.renderScoreboard(globalRows);
  }
}

async function openSubmitConfirmModal(): Promise<void> {
  if (isSubmitConfirmModalOpen() || preparingPersonalSubmit || submittingPersonalBest) {
    return;
  }

  pendingSubmitEntry = null;
  preparingPersonalSubmit = true;
  dom.submitConfirmConfirmBtn.disabled = true;
  dom.submitConfirmConfirmBtn.textContent = "Submit";
  dom.submitConfirmCancelBtn.disabled = false;
  dom.submitConfirmMessageEl.textContent = "Checking your personal best record...";
  dom.submitConfirmModalEl.classList.remove("hidden");
  dom.submitConfirmCancelBtn.focus();

  try {
    const [bestPersonal] = await scoreboardStore.topPersonal(1);
    if (!isSubmitConfirmModalOpen()) {
      return;
    }

    if (!bestPersonal) {
      dom.submitConfirmMessageEl.textContent = "No personal record available to submit.";
      return;
    }

    pendingSubmitEntry = bestPersonal;
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

  submittingPersonalBest = true;
  dom.submitConfirmConfirmBtn.disabled = true;
  dom.submitConfirmCancelBtn.disabled = true;
  dom.submitConfirmConfirmBtn.textContent = "Submitting";
  dom.submitPersonalBtn.disabled = true;
  dom.submitPersonalBtn.textContent = "Submitting";

  try {
    await scoreboardStore.add(pendingSubmitEntry);
    dom.submitPersonalBtn.textContent = "Submitted";
    closeSubmitConfirmModal(true);
    await refreshGlobalTop10Data();
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
        dom.submitPersonalBtn.textContent = PERSONAL_SUBMIT_BUTTON_LABEL;
        dom.submitPersonalBtn.disabled = false;
      }
    }, 1200);
  }
}

function closeSubmitConfirmModal(force = false): void {
  if (submittingPersonalBest && !force) {
    return;
  }
  pendingSubmitEntry = null;
  preparingPersonalSubmit = false;
  dom.submitConfirmModalEl.classList.add("hidden");
  dom.submitConfirmConfirmBtn.disabled = true;
  dom.submitConfirmConfirmBtn.textContent = "Submit";
  dom.submitConfirmCancelBtn.disabled = false;
}

function isSubmitConfirmModalOpen(): boolean {
  return !dom.submitConfirmModalEl.classList.contains("hidden");
}

async function toggleScoreboardView(): Promise<void> {
  if (switchingScoreboardView) {
    return;
  }

  switchingScoreboardView = true;
  try {
    dom.scoreListEl.classList.add("view-fade-out");
    await delay(120);

    scoreboardView = scoreboardView === "global" ? "personal" : "global";
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
  const personalMode = scoreboardView === "personal";
  dom.scoreTitleEl.textContent = personalMode ? PERSONAL_SCORE_TITLE : GLOBAL_SCORE_TITLE;
  dom.personalScoreBtn.classList.toggle("active", personalMode);
  dom.personalScoreBtn.setAttribute("aria-pressed", personalMode ? "true" : "false");
  dom.personalScoreBtn.textContent = personalMode ? "Global" : "Personal";
  if (!submittingPersonalBest) {
    dom.submitPersonalBtn.textContent = PERSONAL_SUBMIT_BUTTON_LABEL;
    dom.submitPersonalBtn.disabled = false;
  }
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
    return {
      user: candidate.user,
      score: candidate.score,
      level: candidate.level,
      date: candidate.date,
    };
  } catch {
    return null;
  }
}

function saveDeviceBestEntry(entry: ScoreEntry): void {
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
  const best = loadDeviceBestEntry();
  const candidate: ScoreEntry = {
    user: "",
    score: payload.score,
    level: payload.level,
    date: new Date().toISOString(),
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
