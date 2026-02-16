export interface TorusDom {
  scoreEl: HTMLSpanElement;
  levelEl: HTMLSpanElement;
  poleCountEl: HTMLSpanElement;
  statusEl: HTMLSpanElement;
  gaugeFillEl: HTMLDivElement;
  difficultyEl: HTMLSelectElement;
  modeBtn: HTMLButtonElement;
  challengeInfoEl: HTMLSpanElement;
  boxStageEl: HTMLDivElement;
  boxGridEl: HTMLDivElement;
  flyingLayerEl: HTMLDivElement;
  poleGridEl: HTMLDivElement;
  scoreCardEl: HTMLDivElement;
  sideColumnEl: HTMLDivElement;
  boardStageCardEl: HTMLDivElement;
  keyCardEl: HTMLDivElement;
  keyPageBasicBtn: HTMLButtonElement;
  keyPageSkillsBtn: HTMLButtonElement;
  keyPageBasicEl: HTMLDivElement;
  keyPageSkillsEl: HTMLDivElement;
  keySkillsListEl: HTMLDivElement;
  scoreTitleEl: HTMLDivElement;
  scoreListEl: HTMLOListElement;
  globalScoreBtn: HTMLButtonElement;
  personalScoreBtn: HTMLButtonElement;
  dailyScoreBtn: HTMLButtonElement;
  submitPersonalBtn: HTMLButtonElement;
  submitConfirmModalEl: HTMLDivElement;
  submitConfirmMessageEl: HTMLParagraphElement;
  submitConfirmConfirmBtn: HTMLButtonElement;
  submitConfirmCancelBtn: HTMLButtonElement;
  themeChipEl: HTMLDivElement;
  themeCustomModalEl: HTMLDivElement;
  themeCustomDialogEl: HTMLDivElement;
  themeCustomCloseBtn: HTMLButtonElement;
  themeCustomFormEl: HTMLFormElement;
  themeColor0El: HTMLInputElement;
  themeColor1El: HTMLInputElement;
  themeColor2El: HTMLInputElement;
  themeColor3El: HTMLInputElement;
  themeColor4El: HTMLInputElement;
  themeTextColorEl: HTMLInputElement;
  themeGlazeColorEl: HTMLInputElement;
  themeGlowColorEl: HTMLInputElement;
  themeGlowAlphaEl: HTMLInputElement;
  themeGlowAlphaValueEl: HTMLSpanElement;
  themeCustomApplyBtn: HTMLButtonElement;
  themeCustomSaveBtn: HTMLButtonElement;
  themeCustomResetBtn: HTMLButtonElement;
  themeCustomMessageEl: HTMLParagraphElement;
  newBtn: HTMLButtonElement;
  resumeBtn: HTMLButtonElement;
  pauseBtn: HTMLButtonElement;
  quitBtn: HTMLButtonElement;
  themeBtn: HTMLButtonElement;
  skillsBtn: HTMLButtonElement;
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
  skillsModalEl: HTMLDivElement;
  skillsDialogEl: HTMLDivElement;
  skillsCloseBtn: HTMLButtonElement;
  skillsFormEl: HTMLFormElement;
  skillNameEl: HTMLInputElement;
  skillSequenceEl: HTMLInputElement;
  skillHotkeyEl: HTMLInputElement;
  skillCancelEditBtn: HTMLButtonElement;
  skillSaveBtn: HTMLButtonElement;
  skillFormMessageEl: HTMLParagraphElement;
  skillsListEl: HTMLUListElement;
  skillRunStatusEl: HTMLParagraphElement;
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
      <div class="theme-chip interactive-chip" id="theme-chip" role="button" tabindex="0" aria-label="Open theme customizer">Theme: -</div>
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
	        <span class="hud-sep">|</span>
	        <label class="select-wrap hud-difficulty-wrap">
	          Difficulty (9)
	          <select id="difficulty">
	            <option value="1">1 - Normal</option>
	            <option value="2">2 - Half-glazed / Rotate</option>
	            <option value="3">3 - Half-glazed / Flip</option>
	          </select>
	        </label>
	      </div>
	    </section>

    <section class="controls fade-in-delayed-2">
      <div class="controls-left">
        <button id="mode-btn">Mode: Classic</button>
        <span id="challenge-info" class="challenge-info">Classic mode</span>
      </div>
      <div class="controls-right">
        <button id="new-game">New (1)</button>
        <button id="resume-game">Resume (2)</button>
        <button id="pause-game">Pause (3)</button>
        <button id="quit-game">Quit (4)</button>
        <button id="theme-btn">Theme (5)</button>
        <button id="skills-btn">Skills (6)</button>
        <button id="toggle-score">Score Board (7)</button>
        <button id="toggle-key">Keys (8)</button>
      </div>
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
          <div class="score-head">
            <div class="board-header-row">
              <div class="score-toolbar">
                <div class="score-tabs" role="tablist" aria-label="Scoreboard Views">
                  <button id="global-score" class="score-tab active" type="button" aria-pressed="true">Global</button>
                  <button id="daily-score" class="score-tab" type="button" aria-pressed="false">Daily</button>
                  <button id="personal-score" class="score-tab" type="button" aria-pressed="false">Personal</button>
                </div>
                <button id="submit-personal" class="mini-btn score-submit-btn" type="button">Submit</button>
              </div>
            </div>
            <div id="score-title" class="board-header score-board-title">GLOBAL TOP 10</div>
          </div>
          <ol id="score-list" class="score-list"></ol>
        </section>

        <section class="key-card" id="key-card">
          <div class="key-card-head">
            <div class="board-header">Key Instructions</div>
            <div class="key-page-switch" role="tablist" aria-label="Key guide pages">
              <button
                id="key-page-basic-btn"
                class="mini-btn key-page-btn active"
                type="button"
                aria-pressed="true"
                title="Show basic controls"
              >1</button>
              <button
                id="key-page-skills-btn"
                class="mini-btn key-page-btn"
                type="button"
                aria-pressed="false"
                title="Show skill hotkeys"
              >2</button>
            </div>
          </div>
          <div class="key-pages">
            <div id="key-page-basic" class="key-list key-page">
              <p><code>←/→/↑/↓</code> or <code>j/l/i/k</code>: Move</p>
              <p><code>1</code>: New game</p>
              <p><code>2</code>: Resume</p>
              <p><code>3</code>: Pause</p>
              <p><code>4</code>: Reset</p>
              <p><code>5</code>: Theme</p>
              <p><code>Theme chip</code>: Open theme custom editor</p>
              <p><code>6</code>: Skills</p>
              <p><code>7</code>: Toggle scoreboard</p>
              <p><code>8</code>: Key page (<code>1 → 2 → hide</code>)</p>
              <p><code>9</code>: Difficulty cycle (<code>1 → 2 → 3 → 1</code>)</p>
            </div>
            <div id="key-page-skills" class="key-list key-page hidden">
              <div id="key-skills-list" class="key-skills-list"></div>
            </div>
          </div>
        </section>
      </aside>
    </main>

    <div id="gameover-modal" class="gameover-modal hidden" role="dialog" aria-modal="true" aria-labelledby="gameover-title">
      <div class="gameover-dialog">
        <h2 id="gameover-title">Game Over</h2>
        <p>Score <span id="gameover-score">0</span> · Level <span id="gameover-level">0</span></p>
        <label class="gameover-label" for="gameover-name">Name</label>
        <input id="gameover-name" maxlength="20" autocomplete="off" placeholder="Enter name (max 20 chars)" />
        <label class="gameover-submit" for="gameover-submit-db">
          <input id="gameover-submit-db" type="checkbox" />
          Submit to online Top 10
        </label>
        <p id="gameover-best-hint" class="gameover-hint"></p>
        <div class="gameover-actions">
          <button id="gameover-save" type="button">Save</button>
          <button id="gameover-skip" type="button">Skip</button>
        </div>
      </div>
    </div>

    <div id="submit-confirm-modal" class="gameover-modal hidden" role="dialog" aria-modal="true" aria-labelledby="submit-confirm-title">
      <div class="gameover-dialog submit-confirm-dialog">
        <h2 id="submit-confirm-title">Submit Score</h2>
        <p id="submit-confirm-message" class="submit-confirm-message">Checking your personal best record...</p>
        <div class="gameover-actions">
          <button id="submit-confirm-cancel" type="button">Cancel</button>
          <button id="submit-confirm-ok" type="button" disabled>Submit</button>
        </div>
      </div>
    </div>

    <div id="theme-custom-modal" class="gameover-modal hidden" role="dialog" aria-modal="true" aria-labelledby="theme-custom-title">
      <div id="theme-custom-dialog" class="gameover-dialog theme-custom-dialog">
        <div class="theme-custom-top">
          <h2 id="theme-custom-title">Theme Custom</h2>
          <button id="theme-custom-close" class="mini-btn" type="button">Close</button>
        </div>
        <p class="theme-custom-help">
          Edit your color palette, preview with <code>Apply</code>, and keep it with <code>Save</code>.
        </p>
        <form id="theme-custom-form" class="theme-custom-form">
          <div class="theme-torus-row">
            <label class="theme-color-field" for="theme-color-0">
              <span>Torus 0</span>
              <input id="theme-color-0" type="color" />
            </label>
            <label class="theme-color-field" for="theme-color-1">
              <span>Torus 1</span>
              <input id="theme-color-1" type="color" />
            </label>
            <label class="theme-color-field" for="theme-color-2">
              <span>Torus 2</span>
              <input id="theme-color-2" type="color" />
            </label>
            <label class="theme-color-field" for="theme-color-3">
              <span>Torus 3</span>
              <input id="theme-color-3" type="color" />
            </label>
            <label class="theme-color-field" for="theme-color-4">
              <span>Torus 4</span>
              <input id="theme-color-4" type="color" />
            </label>
          </div>

          <div class="theme-torus-sample" aria-hidden="true">
            <span class="theme-torus-sample-token c0">@@@</span>
            <span class="theme-torus-sample-token c1">@@@</span>
            <span class="theme-torus-sample-token c2">@@@</span>
            <span class="theme-torus-sample-token c3">@@@</span>
            <span class="theme-torus-sample-token c4">@@@</span>
          </div>

          <div class="theme-accent-row">
            <label class="theme-color-field" for="theme-text-color">
              <span>Text</span>
              <input id="theme-text-color" type="color" />
            </label>
            <label class="theme-color-field" for="theme-glaze-color">
              <span>Glaze</span>
              <input id="theme-glaze-color" type="color" />
            </label>
            <label class="theme-color-field" for="theme-glow-color">
              <span>Glow</span>
              <input id="theme-glow-color" type="color" />
            </label>
          </div>

          <label class="theme-range-field" for="theme-glow-alpha">
            <span>Glow Alpha</span>
            <div class="theme-range-wrap">
              <input id="theme-glow-alpha" type="range" min="0" max="100" step="1" />
              <span id="theme-glow-alpha-value">0%</span>
            </div>
          </label>

          <div class="theme-custom-actions">
            <button id="theme-custom-apply" type="button">Apply</button>
            <button id="theme-custom-save" type="submit">Save</button>
            <button id="theme-custom-reset" type="button">Reset</button>
          </div>
        </form>
        <p id="theme-custom-message" class="theme-custom-message"></p>
      </div>
    </div>

    <div id="skills-modal" class="gameover-modal hidden" role="dialog" aria-modal="true" aria-labelledby="skills-title">
      <div id="skills-dialog" class="gameover-dialog skills-dialog">
        <div class="skills-top">
          <h2 id="skills-title">Skills</h2>
          <button id="skills-close" class="mini-btn" type="button">Close</button>
        </div>
        <p class="skills-help">
          Create directional sequences with <code>L R U D ( )</code>, <code>j l i k</code>, or arrows. <code>(</code> and <code>)</code> are opposite dynamic horizontal directions (edge-aware pair). Hotkeys: press any keyboard key (duplicates are blocked).
        </p>
        <p id="skill-run-status" class="skills-run-status">Idle</p>
        <form id="skills-form" class="skills-form">
          <label class="gameover-label" for="skill-name">Name</label>
          <input id="skill-name" maxlength="20" autocomplete="off" placeholder="e.g. Left Sweep" />
          <label class="gameover-label" for="skill-sequence">Sequence</label>
          <input id="skill-sequence" maxlength="120" autocomplete="off" placeholder="L ( ) U D R or ←←↑↓→" />
          <label class="gameover-label" for="skill-hotkey">Hotkey (optional)</label>
          <input id="skill-hotkey" maxlength="40" autocomplete="off" placeholder="Press any key (e.g. Slash, Tab, F6)" />
          <div class="skills-form-actions">
            <button id="skill-cancel-edit" type="button" hidden>Cancel Edit</button>
            <button id="skill-save" type="submit">Save Skill</button>
          </div>
        </form>
        <p id="skill-form-message" class="skills-form-message"></p>
        <ul id="skills-list" class="skills-list"></ul>
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
    modeBtn: must<HTMLButtonElement>(container, "#mode-btn"),
    challengeInfoEl: must<HTMLSpanElement>(container, "#challenge-info"),
    boxStageEl: must<HTMLDivElement>(container, "#box-stage"),
    boxGridEl: must<HTMLDivElement>(container, "#box-grid"),
    flyingLayerEl: must<HTMLDivElement>(container, "#flying-layer"),
    poleGridEl: must<HTMLDivElement>(container, "#pole-grid"),
    scoreCardEl: must<HTMLDivElement>(container, "#score-card"),
    sideColumnEl: must<HTMLDivElement>(container, "#side-column"),
    boardStageCardEl: must<HTMLDivElement>(container, "#playfield-card"),
    keyCardEl: must<HTMLDivElement>(container, "#key-card"),
    keyPageBasicBtn: must<HTMLButtonElement>(container, "#key-page-basic-btn"),
    keyPageSkillsBtn: must<HTMLButtonElement>(container, "#key-page-skills-btn"),
    keyPageBasicEl: must<HTMLDivElement>(container, "#key-page-basic"),
    keyPageSkillsEl: must<HTMLDivElement>(container, "#key-page-skills"),
    keySkillsListEl: must<HTMLDivElement>(container, "#key-skills-list"),
    scoreTitleEl: must<HTMLDivElement>(container, "#score-title"),
    scoreListEl: must<HTMLOListElement>(container, "#score-list"),
    globalScoreBtn: must<HTMLButtonElement>(container, "#global-score"),
    personalScoreBtn: must<HTMLButtonElement>(container, "#personal-score"),
    dailyScoreBtn: must<HTMLButtonElement>(container, "#daily-score"),
    submitPersonalBtn: must<HTMLButtonElement>(container, "#submit-personal"),
    submitConfirmModalEl: must<HTMLDivElement>(container, "#submit-confirm-modal"),
    submitConfirmMessageEl: must<HTMLParagraphElement>(container, "#submit-confirm-message"),
    submitConfirmConfirmBtn: must<HTMLButtonElement>(container, "#submit-confirm-ok"),
    submitConfirmCancelBtn: must<HTMLButtonElement>(container, "#submit-confirm-cancel"),
    themeChipEl: must<HTMLDivElement>(container, "#theme-chip"),
    themeCustomModalEl: must<HTMLDivElement>(container, "#theme-custom-modal"),
    themeCustomDialogEl: must<HTMLDivElement>(container, "#theme-custom-dialog"),
    themeCustomCloseBtn: must<HTMLButtonElement>(container, "#theme-custom-close"),
    themeCustomFormEl: must<HTMLFormElement>(container, "#theme-custom-form"),
    themeColor0El: must<HTMLInputElement>(container, "#theme-color-0"),
    themeColor1El: must<HTMLInputElement>(container, "#theme-color-1"),
    themeColor2El: must<HTMLInputElement>(container, "#theme-color-2"),
    themeColor3El: must<HTMLInputElement>(container, "#theme-color-3"),
    themeColor4El: must<HTMLInputElement>(container, "#theme-color-4"),
    themeTextColorEl: must<HTMLInputElement>(container, "#theme-text-color"),
    themeGlazeColorEl: must<HTMLInputElement>(container, "#theme-glaze-color"),
    themeGlowColorEl: must<HTMLInputElement>(container, "#theme-glow-color"),
    themeGlowAlphaEl: must<HTMLInputElement>(container, "#theme-glow-alpha"),
    themeGlowAlphaValueEl: must<HTMLSpanElement>(container, "#theme-glow-alpha-value"),
    themeCustomApplyBtn: must<HTMLButtonElement>(container, "#theme-custom-apply"),
    themeCustomSaveBtn: must<HTMLButtonElement>(container, "#theme-custom-save"),
    themeCustomResetBtn: must<HTMLButtonElement>(container, "#theme-custom-reset"),
    themeCustomMessageEl: must<HTMLParagraphElement>(container, "#theme-custom-message"),
    newBtn: must<HTMLButtonElement>(container, "#new-game"),
    resumeBtn: must<HTMLButtonElement>(container, "#resume-game"),
    pauseBtn: must<HTMLButtonElement>(container, "#pause-game"),
    quitBtn: must<HTMLButtonElement>(container, "#quit-game"),
    themeBtn: must<HTMLButtonElement>(container, "#theme-btn"),
    skillsBtn: must<HTMLButtonElement>(container, "#skills-btn"),
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
    skillsModalEl: must<HTMLDivElement>(container, "#skills-modal"),
    skillsDialogEl: must<HTMLDivElement>(container, "#skills-dialog"),
    skillsCloseBtn: must<HTMLButtonElement>(container, "#skills-close"),
    skillsFormEl: must<HTMLFormElement>(container, "#skills-form"),
    skillNameEl: must<HTMLInputElement>(container, "#skill-name"),
    skillSequenceEl: must<HTMLInputElement>(container, "#skill-sequence"),
    skillHotkeyEl: must<HTMLInputElement>(container, "#skill-hotkey"),
    skillCancelEditBtn: must<HTMLButtonElement>(container, "#skill-cancel-edit"),
    skillSaveBtn: must<HTMLButtonElement>(container, "#skill-save"),
    skillFormMessageEl: must<HTMLParagraphElement>(container, "#skill-form-message"),
    skillsListEl: must<HTMLUListElement>(container, "#skills-list"),
    skillRunStatusEl: must<HTMLParagraphElement>(container, "#skill-run-status"),
  };
}

function must<T extends Element>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing element: ${selector}`);
  }
  return el;
}
