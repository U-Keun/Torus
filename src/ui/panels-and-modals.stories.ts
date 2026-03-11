import {
  createStorySurface,
  SAMPLE_CUSTOM_THEME,
  SAMPLE_GLOBAL_SCORES,
  SAMPLE_SKILLS,
  renderScoreboardView,
  seedShell,
  showNoticeDialog,
  showSessionRestoreDialog,
  showSkillsModal,
  showThemeModal,
  showUpdateBanner,
} from "./storybook-support";

const meta = {
  title: "Shell/Panels And Modals",
  tags: ["autodocs"],
};

export default meta;

export const ThemeCustomizerPreview = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      status: "Paused",
    });
    renderScoreboardView(surface, {
      view: "global",
      entries: SAMPLE_GLOBAL_SCORES,
    });
    showThemeModal(surface, {
      draft: SAMPLE_CUSTOM_THEME,
      message: "Preview applied. Save to keep this theme.",
      tone: "info",
    });
    return surface.canvas;
  },
};

export const ThemeCustomizerValidationError = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      status: "Paused",
    });
    renderScoreboardView(surface, {
      view: "global",
      entries: SAMPLE_GLOBAL_SCORES,
    });
    showThemeModal(surface, {
      draft: SAMPLE_CUSTOM_THEME,
      message: "Invalid color value. Please use HEX color fields.",
      tone: "warn",
    });
    surface.dom.themeColor2El.value = "#12";
    return surface.canvas;
  },
};

export const SkillsModalEmpty = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      status: "Paused",
    });
    renderScoreboardView(surface, {
      view: "global",
      entries: SAMPLE_GLOBAL_SCORES,
    });
    showSkillsModal(surface, {
      skills: [],
      runnerText: "Idle",
      formMessage: "Create a skill and optionally assign a hotkey.",
      formTone: "info",
    });
    return surface.canvas;
  },
};

export const SkillsModalEditingWhileRunning = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      status: "Running",
    });
    renderScoreboardView(surface, {
      view: "global",
      entries: SAMPLE_GLOBAL_SCORES,
    });
    showSkillsModal(surface, {
      skills: SAMPLE_SKILLS,
      runnerText: 'Running "Pole Sweep" (2 left)',
      runnerTone: "active",
      processing: true,
      formMessage: 'Editing "Quick Lift".',
      formTone: "info",
      editingSkillId: "skill-2",
    });
    return surface.canvas;
  },
};

export const UpdateRequiredBanner = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      status: "Paused",
    });
    renderScoreboardView(surface, {
      view: "global",
      entries: SAMPLE_GLOBAL_SCORES,
    });
    showUpdateBanner(surface, "Update required: v1.6.6+ (current v1.6.5)", {
      required: true,
    });
    return surface.canvas;
  },
};

export const SessionRestorePrompt = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      score: 7600,
      level: 12,
      pole: "2/8",
      status: "Paused",
    });
    renderScoreboardView(surface, {
      view: "global",
      entries: SAMPLE_GLOBAL_SCORES,
    });
    showSessionRestoreDialog(
      surface,
      "A Daily Challenge run from 3/11/2026, 6:42:11 PM was found. Continue from that state?",
    );
    return surface.canvas;
  },
};

export const NoticeDialog = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      status: "Paused",
    });
    renderScoreboardView(surface, {
      view: "global",
      entries: SAMPLE_GLOBAL_SCORES,
    });
    showNoticeDialog(
      surface,
      "Daily Challenge",
      "No Daily Challenge attempts left for today (3/3).",
    );
    return surface.canvas;
  },
};
