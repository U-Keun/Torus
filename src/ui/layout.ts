export interface TorusDom {
  scoreEl: HTMLSpanElement;
  levelEl: HTMLSpanElement;
  poleCountEl: HTMLSpanElement;
  statusEl: HTMLSpanElement;
  gaugeFillEl: HTMLDivElement;
  difficultyEl: HTMLSelectElement;
  boxStageEl: HTMLDivElement;
  boxGridEl: HTMLDivElement;
  flyingLayerEl: HTMLDivElement;
  poleGridEl: HTMLDivElement;
  scoreCardEl: HTMLDivElement;
  sideColumnEl: HTMLDivElement;
  boardStageCardEl: HTMLDivElement;
  keyCardEl: HTMLDivElement;
  scoreTitleEl: HTMLDivElement;
  scoreListEl: HTMLOListElement;
  personalScoreBtn: HTMLButtonElement;
  themeChipEl: HTMLDivElement;
  newBtn: HTMLButtonElement;
  resumeBtn: HTMLButtonElement;
  pauseBtn: HTMLButtonElement;
  quitBtn: HTMLButtonElement;
  themeBtn: HTMLButtonElement;
  toggleScoreBtn: HTMLButtonElement;
  toggleKeyBtn: HTMLButtonElement;
  gameOverModalEl: HTMLDivElement;
  gameOverScoreEl: HTMLSpanElement;
  gameOverLevelEl: HTMLSpanElement;
  gameOverNameEl: HTMLInputElement;
  gameOverSubmitDbEl: HTMLInputElement;
  gameOverBestHintEl: HTMLParagraphElement;
  gameOverSaveBtn: HTMLButtonElement;
  gameOverSkipBtn: HTMLButtonElement;
}

const APP_TEMPLATE = `
  <div class="torus-shell">
    <header class="hero fade-in">
      <pre class="logo-art">@@@  /@\\  @@\\ @ @  /@@
 @   @ @  @ / @ @   \\
 @   \\@/  @ \\ \\@/  @@/</pre>
      <div class="hero-copy">
        <h1>Torus</h1>
      </div>
      <div class="theme-chip" id="theme-chip">Theme: -</div>
    </header>

    <section class="hud fade-in-delayed">
      <div class="hud-line">
        <span class="hud-key">Score</span>
        <span id="score" class="hud-value score-value">0</span>
        <span class="hud-sep">|</span>
        <span class="hud-key">Level</span>
        <span id="level" class="hud-value level-value">0</span>
        <span class="hud-sep">|</span>
        <span class="hud-key">Pole</span>
        <span id="pole-count" class="hud-value pole-value">0</span>
        <span class="hud-sep">|</span>
        <span class="hud-key">Status</span>
        <span id="status" class="hud-value status-value">Paused</span>
        <span class="hud-sep">|</span>
        <span class="hud-key">Gauge</span>
        <div class="gauge-wrap" title="Level gauge">
          <div id="gauge-fill" class="gauge-fill"></div>
        </div>
      </div>
    </section>

    <section class="controls fade-in-delayed-2">
      <label class="select-wrap">
        Difficulty
        <select id="difficulty">
          <option value="1">1 - Normal</option>
          <option value="2">2 - Half-glazed / Rotate</option>
          <option value="3">3 - Half-glazed / Flip</option>
        </select>
      </label>
      <button id="new-game">New (N)</button>
      <button id="resume-game">Resume (R)</button>
      <button id="pause-game">Pause (P)</button>
      <button id="theme-btn">Theme (C)</button>
      <button id="quit-game">Quit (Q)</button>
      <button id="toggle-score">Score Board (S)</button>
      <button id="toggle-key">Keys (H)</button>
    </section>

    <main class="arena fade-in-delayed-3">
      <section class="board-card board-stage-card" id="playfield-card">
        <div class="stacked-board">
          <div class="box-stage" id="box-stage">
            <div id="box-grid" class="box-grid"></div>
            <div id="flying-layer" class="flying-layer"></div>
          </div>
          <div class="pole-stage">
            <div id="pole-grid" class="pole-grid"></div>
          </div>
        </div>
      </section>

      <aside class="side-column" id="side-column">
        <section class="score-card" id="score-card">
          <div class="board-header-row">
            <div id="score-title" class="board-header">Top 10</div>
            <div class="score-actions">
              <button id="personal-score" class="mini-btn" type="button" aria-pressed="false">Personal</button>
            </div>
          </div>
          <ol id="score-list" class="score-list"></ol>
        </section>

        <section class="key-card" id="key-card">
          <div class="board-header">Key Instructions</div>
          <div class="key-list">
            <p><code>←/→/↑/↓</code> or <code>j/l/i/k</code>: Move</p>
            <p><code>n</code>: New game</p>
            <p><code>r</code>: Resume</p>
            <p><code>p</code>: Pause</p>
            <p><code>q</code>: Reset</p>
            <p><code>c</code>: Theme</p>
            <p><code>s</code>: Toggle scoreboard</p>
            <p><code>h</code>: Toggle key card</p>
            <p><code>1/2/3</code>: Difficulty</p>
          </div>
        </section>
      </aside>
    </main>

    <div id="gameover-modal" class="gameover-modal hidden" role="dialog" aria-modal="true" aria-labelledby="gameover-title">
      <div class="gameover-dialog">
        <h2 id="gameover-title">Game Over</h2>
        <p>Score <span id="gameover-score">0</span> · Level <span id="gameover-level">0</span></p>
        <label class="gameover-label" for="gameover-name">이름</label>
        <input id="gameover-name" maxlength="20" autocomplete="off" placeholder="이름 입력 (최대 20자)" />
        <label class="gameover-submit" for="gameover-submit-db">
          <input id="gameover-submit-db" type="checkbox" />
          온라인 Top10에 제출
        </label>
        <p id="gameover-best-hint" class="gameover-hint"></p>
        <div class="gameover-actions">
          <button id="gameover-save" type="button">기록하기</button>
          <button id="gameover-skip" type="button">건너뛰기</button>
        </div>
      </div>
    </div>
  </div>
`;

export function mountTorusLayout(container: HTMLElement): TorusDom {
  container.innerHTML = APP_TEMPLATE;

  return {
    scoreEl: must<HTMLSpanElement>(container, "#score"),
    levelEl: must<HTMLSpanElement>(container, "#level"),
    poleCountEl: must<HTMLSpanElement>(container, "#pole-count"),
    statusEl: must<HTMLSpanElement>(container, "#status"),
    gaugeFillEl: must<HTMLDivElement>(container, "#gauge-fill"),
    difficultyEl: must<HTMLSelectElement>(container, "#difficulty"),
    boxStageEl: must<HTMLDivElement>(container, "#box-stage"),
    boxGridEl: must<HTMLDivElement>(container, "#box-grid"),
    flyingLayerEl: must<HTMLDivElement>(container, "#flying-layer"),
    poleGridEl: must<HTMLDivElement>(container, "#pole-grid"),
    scoreCardEl: must<HTMLDivElement>(container, "#score-card"),
    sideColumnEl: must<HTMLDivElement>(container, "#side-column"),
    boardStageCardEl: must<HTMLDivElement>(container, "#playfield-card"),
    keyCardEl: must<HTMLDivElement>(container, "#key-card"),
    scoreTitleEl: must<HTMLDivElement>(container, "#score-title"),
    scoreListEl: must<HTMLOListElement>(container, "#score-list"),
    personalScoreBtn: must<HTMLButtonElement>(container, "#personal-score"),
    themeChipEl: must<HTMLDivElement>(container, "#theme-chip"),
    newBtn: must<HTMLButtonElement>(container, "#new-game"),
    resumeBtn: must<HTMLButtonElement>(container, "#resume-game"),
    pauseBtn: must<HTMLButtonElement>(container, "#pause-game"),
    quitBtn: must<HTMLButtonElement>(container, "#quit-game"),
    themeBtn: must<HTMLButtonElement>(container, "#theme-btn"),
    toggleScoreBtn: must<HTMLButtonElement>(container, "#toggle-score"),
    toggleKeyBtn: must<HTMLButtonElement>(container, "#toggle-key"),
    gameOverModalEl: must<HTMLDivElement>(container, "#gameover-modal"),
    gameOverScoreEl: must<HTMLSpanElement>(container, "#gameover-score"),
    gameOverLevelEl: must<HTMLSpanElement>(container, "#gameover-level"),
    gameOverNameEl: must<HTMLInputElement>(container, "#gameover-name"),
    gameOverSubmitDbEl: must<HTMLInputElement>(container, "#gameover-submit-db"),
    gameOverBestHintEl: must<HTMLParagraphElement>(container, "#gameover-best-hint"),
    gameOverSaveBtn: must<HTMLButtonElement>(container, "#gameover-save"),
    gameOverSkipBtn: must<HTMLButtonElement>(container, "#gameover-skip"),
  };
}

function must<T extends Element>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing element: ${selector}`);
  }
  return el;
}
