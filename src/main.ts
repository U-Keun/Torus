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
let pendingGameOverPayload: GameOverPayload | null = null;
let keyCardVisible = true;
let canResume = false;
let savingGameOver = false;
let refreshingScoreboard = false;
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
    toggleScoreboardView();
  });
}

function bindKeyboardControls(): void {
  const actions: Record<string, () => void> = {
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

  window.addEventListener("keydown", (event) => {
    if (isFormTarget(event.target)) {
      return;
    }

    if (pendingGameOverPayload) {
      return;
    }

    const action = actions[event.key.toLowerCase()];
    if (!action) {
      return;
    }

    action();
    event.preventDefault();
  });
}

function startNewGame(): void {
  closeGameOverModal();
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

function openGameOverModal(payload: GameOverPayload): void {
  const lastUser = game.getLastUser().trim();
  savingGameOver = false;
  dom.gameOverSaveBtn.disabled = false;
  dom.gameOverSkipBtn.disabled = false;
  dom.gameOverScoreEl.textContent = String(payload.score);
  dom.gameOverLevelEl.textContent = String(payload.level);
  dom.gameOverNameEl.value = "";
  dom.gameOverNameEl.placeholder = lastUser.length > 0
    ? lastUser
    : "이름 입력 (최대 20자)";
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

function toggleScoreboardView(): void {
  scoreboardView = scoreboardView === "global" ? "personal" : "global";
  syncScoreboardViewUi();
  void refreshScoreboard();
}

function syncScoreboardViewUi(): void {
  const personalMode = scoreboardView === "personal";
  dom.scoreTitleEl.textContent = personalMode ? "Personal Top 10" : "Top 10";
  dom.personalScoreBtn.classList.toggle("active", personalMode);
  dom.personalScoreBtn.setAttribute("aria-pressed", personalMode ? "true" : "false");
  dom.personalScoreBtn.textContent = personalMode ? "Global" : "Personal";
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
      ? `새 기기 최고점입니다. (이전: ${best.score} / Lv.${best.level})`
      : "첫 기기 기록입니다.";
    return;
  }

  dom.gameOverSubmitDbEl.checked = false;
  dom.gameOverSubmitDbEl.disabled = true;
  dom.gameOverBestHintEl.className = "gameover-hint warn";
  dom.gameOverBestHintEl.textContent = best
    ? `현재 기기 최고점(${best.score} / Lv.${best.level})보다 낮아 DB 제출이 비활성화됩니다.`
    : "현재 점수는 기기 최고점이 아닙니다.";
}
