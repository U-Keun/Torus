import { setButtonLabel } from "./button-loading";
import {
  createStorySurface,
  renderScoreboardView,
  SAMPLE_GLOBAL_SCORES,
  seedShell,
  type StoryScoreboardView,
  type StoryTone,
} from "./storybook-support";

interface GameOverStoryState {
  view: StoryScoreboardView;
  score: number;
  level: number;
  user: string;
  submitToGlobal: boolean;
  submitToggleDisabled: boolean;
  saveLabel: string;
  saveLoading: boolean;
  saveDisabled: boolean;
  skipHidden: boolean;
  skipDisabled: boolean;
  inputDisabled: boolean;
  hint: string;
  hintTone: StoryTone;
}

interface ManualSubmitStoryState {
  score: number;
  level: number;
  user: string;
  toolbarLabel: string;
  toolbarLoading: boolean;
  toolbarDisabled: boolean;
  confirmLabel: string;
  confirmLoading: boolean;
  confirmDisabled: boolean;
  cancelDisabled: boolean;
  message: string;
}

const meta = {
  title: "Submission/Score Sync",
  tags: ["autodocs"],
};

export default meta;

export const GameOverReadyForGlobalSync = {
  render: () =>
    renderGameOverStory({
      view: "global",
      score: 12400,
      level: 18,
      user: "Keunsong",
      submitToGlobal: true,
      submitToggleDisabled: false,
      saveLabel: "Save",
      saveLoading: false,
      saveDisabled: false,
      skipHidden: false,
      skipDisabled: false,
      inputDisabled: false,
      hint: "New device best score. (Previous: 11800 / Lv.17)",
      hintTone: "good",
    }),
};

export const GameOverSubmittingToGlobal = {
  render: () =>
    renderGameOverStory({
      view: "global",
      score: 12400,
      level: 18,
      user: "Keunsong",
      submitToGlobal: true,
      submitToggleDisabled: true,
      saveLabel: "Submitting",
      saveLoading: true,
      saveDisabled: true,
      skipHidden: false,
      skipDisabled: true,
      inputDisabled: true,
      hint: "Submitting your score to GLOBAL TOP 10...",
      hintTone: "info",
    }),
};

export const DailyChallengeSubmitting = {
  render: () =>
    renderGameOverStory({
      view: "daily",
      score: 9800,
      level: 14,
      user: "Keunsong",
      submitToGlobal: false,
      submitToggleDisabled: true,
      saveLabel: "Submitting",
      saveLoading: true,
      saveDisabled: true,
      skipHidden: true,
      skipDisabled: true,
      inputDisabled: true,
      hint: "Submitting your Daily score to Supabase...",
      hintTone: "info",
    }),
};

export const ManualSubmitReady = {
  render: () =>
    renderManualSubmitStory({
      score: 12400,
      level: 18,
      user: "Keunsong",
      toolbarLabel: "Submit",
      toolbarLoading: false,
      toolbarDisabled: false,
      confirmLabel: "Submit",
      confirmLoading: false,
      confirmDisabled: false,
      cancelDisabled: false,
      message: "Submit this record to GLOBAL TOP 10?\nKeunsong · 12400 pts · Lv.18",
    }),
};

export const ManualSubmitSubmitting = {
  render: () =>
    renderManualSubmitStory({
      score: 12400,
      level: 18,
      user: "Keunsong",
      toolbarLabel: "Submitting",
      toolbarLoading: true,
      toolbarDisabled: true,
      confirmLabel: "Submitting",
      confirmLoading: true,
      confirmDisabled: true,
      cancelDisabled: true,
      message: "Submitting your score to Supabase...",
    }),
};

export const ManualSubmitFailed = {
  render: () =>
    renderManualSubmitStory({
      score: 12400,
      level: 18,
      user: "Keunsong",
      toolbarLabel: "Retry",
      toolbarLoading: false,
      toolbarDisabled: false,
      confirmLabel: "Retry",
      confirmLoading: false,
      confirmDisabled: false,
      cancelDisabled: false,
      message: "Submission failed. Please try again.",
    }),
};

function renderGameOverStory(state: GameOverStoryState): HTMLDivElement {
  const surface = createStorySurface();
  seedShell(surface);
  renderScoreboardView(surface, {
    view: state.view,
    entries: SAMPLE_GLOBAL_SCORES,
  });

  surface.dom.gameOverModalEl.classList.remove("hidden");
  surface.dom.gameOverScoreEl.textContent = String(state.score);
  surface.dom.gameOverLevelEl.textContent = String(state.level);
  surface.dom.gameOverNameEl.value = state.user;
  surface.dom.gameOverNameEl.disabled = state.inputDisabled;
  surface.dom.gameOverSubmitDbEl.checked = state.submitToGlobal;
  surface.dom.gameOverSubmitDbEl.disabled = state.submitToggleDisabled;
  surface.dom.gameOverBestHintEl.className = resolveHintClassName(state.hintTone);
  surface.dom.gameOverBestHintEl.textContent = state.hint;
  surface.dom.gameOverSaveBtn.disabled = state.saveDisabled;
  setButtonLabel(surface.dom.gameOverSaveBtn, state.saveLabel, { loading: state.saveLoading });
  surface.dom.gameOverSkipBtn.hidden = state.skipHidden;
  surface.dom.gameOverSkipBtn.disabled = state.skipDisabled;

  return surface.canvas;
}

function renderManualSubmitStory(state: ManualSubmitStoryState): HTMLDivElement {
  const surface = createStorySurface();
  seedShell(surface);
  renderScoreboardView(surface, {
    view: "personal",
    entries: SAMPLE_GLOBAL_SCORES,
    showMeTag: false,
  });

  surface.dom.submitPersonalBtn.disabled = state.toolbarDisabled;
  setButtonLabel(surface.dom.submitPersonalBtn, state.toolbarLabel, { loading: state.toolbarLoading });
  surface.dom.submitConfirmModalEl.classList.remove("hidden");
  surface.dom.submitConfirmMessageEl.textContent = state.message;
  surface.dom.submitConfirmCancelBtn.disabled = state.cancelDisabled;
  surface.dom.submitConfirmConfirmBtn.disabled = state.confirmDisabled;
  setButtonLabel(surface.dom.submitConfirmConfirmBtn, state.confirmLabel, { loading: state.confirmLoading });
  surface.dom.scoreTitleEl.textContent = "PERSONAL TOP 10";
  surface.dom.scoreListEl.classList.remove("global-mode");

  return surface.canvas;
}

function resolveHintClassName(tone: StoryTone): string {
  if (tone === "good") {
    return "gameover-hint good";
  }
  if (tone === "warn") {
    return "gameover-hint warn";
  }
  return "gameover-hint";
}
