import {
  createStorySurface,
  renderScoreboardView,
  SAMPLE_DAILY_ME_BADGE,
  SAMPLE_DAILY_SCORES,
  SAMPLE_GLOBAL_SCORES,
  SAMPLE_PERSONAL_SCORES,
  SAMPLE_SKILLS,
  seedShell,
  showDailyMode,
  showKeyGuideSkillsPage,
} from "./storybook-support";

const meta = {
  title: "Shell/Scoreboards",
  tags: ["autodocs"],
};

export default meta;

export const GlobalTop10 = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      status: "Paused",
      challengeInfo: "Classic mode",
    });
    renderScoreboardView(surface, {
      view: "global",
      entries: SAMPLE_GLOBAL_SCORES,
    });
    return surface.canvas;
  },
};

export const DailyChallengeTop10 = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      score: 9400,
      level: 13,
      pole: "4/8",
      status: "Paused",
      difficultyDisabled: true,
      modeLabel: "Mode: Daily",
      challengeInfo: "Daily Challenge: 2026-03-11 | 1/3 attempts left",
    });
    showDailyMode(surface, {
      power: 3,
      currentStreak: 6,
      maxStreak: 9,
      nextBadgePower: 4,
      nextBadgeDays: 16,
      daysToNextBadge: 10,
    });
    renderScoreboardView(surface, {
      view: "daily",
      entries: SAMPLE_DAILY_SCORES,
      meBadge: SAMPLE_DAILY_ME_BADGE,
    });
    return surface.canvas;
  },
};

export const PersonalTop10 = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      status: "Paused",
    });
    renderScoreboardView(surface, {
      view: "personal",
      entries: SAMPLE_PERSONAL_SCORES,
      showMeTag: false,
      showGlobalRankBadge: false,
    });
    return surface.canvas;
  },
};

export const LoadingRemoteScores = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      status: "Paused",
    });
    renderScoreboardView(surface, {
      view: "global",
      loadingMessage: "Loading global records",
    });
    return surface.canvas;
  },
};

export const KeyGuideSkillsPage = {
  render: () => {
    const surface = createStorySurface();
    seedShell(surface, {
      status: "Paused",
    });
    renderScoreboardView(surface, {
      view: "global",
      entries: SAMPLE_GLOBAL_SCORES,
    });
    showKeyGuideSkillsPage(surface, SAMPLE_SKILLS);
    return surface.canvas;
  },
};
