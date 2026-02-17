interface NumberedIconTextSpec {
  x: string;
  y: string;
  fontSize: string;
  fontWeight: string;
  strokeWidth: string;
  textAnchor?: "start" | "middle" | "end";
  dominantBaseline?: "middle" | "auto";
}

interface DailyBadgeIconSet {
  minPower: number;
  maxPower: number;
  bodyMarkup: string;
}

const SVG_BASE_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const NUMBER_FONT_FAMILY = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";

const DAILY_BADGE_TEXT_SPEC: NumberedIconTextSpec = {
  x: "3.1",
  y: "5.9",
  fontSize: "4.6",
  fontWeight: "400",
  strokeWidth: "0.55",
};

const DAILY_BADGE_ICON_SETS: ReadonlyArray<DailyBadgeIconSet> = [
  {
    minPower: 0,
    maxPower: 2,
    bodyMarkup: '<path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/><path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/><path d="M5 21h14"/>',
  },
  {
    minPower: 4,
    maxPower: 6,
    bodyMarkup: '<path d="M12 22v-5.172a2 2 0 0 0-.586-1.414L9.5 13.5"/><path d="M14.5 14.5 12 17"/><path d="M17 8.8A6 6 0 0 1 13.8 20H10A6.5 6.5 0 0 1 7 8a5 5 0 0 1 10 0z"/>',
  },
  {
    minPower: 7,
    maxPower: 9,
    bodyMarkup: '<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>',
  },
];

const RANK_TROPHY_TEXT_SPEC: NumberedIconTextSpec = {
  x: "12",
  y: "8.2",
  fontSize: "7.2",
  fontWeight: "500",
  strokeWidth: "0.6",
  textAnchor: "middle",
  dominantBaseline: "middle",
};

const RANK_TROPHY_BODY_MARKUP = '<path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978"/><path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978"/><path d="M18 9h1.5a1 1 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6 9H4.5a1 1 0 0 1 0-5H6"/>';

function renderNumberedIcon(
  className: string,
  number: number,
  textSpec: NumberedIconTextSpec,
  bodyMarkup: string,
): string {
  const textAnchorAttr = textSpec.textAnchor ? ` text-anchor="${textSpec.textAnchor}"` : "";
  const dominantBaselineAttr = textSpec.dominantBaseline
    ? ` dominant-baseline="${textSpec.dominantBaseline}"`
    : "";
  return `<svg class="${className}" ${SVG_BASE_ATTRS}><text x="${textSpec.x}" y="${textSpec.y}"${textAnchorAttr}${dominantBaselineAttr} font-size="${textSpec.fontSize}" font-weight="${textSpec.fontWeight}" font-family="${NUMBER_FONT_FAMILY}" fill="none" stroke="currentColor" stroke-width="${textSpec.strokeWidth}" paint-order="stroke" stroke-linecap="round" stroke-linejoin="round">${number}</text>${bodyMarkup}</svg>`;
}

export function renderDailyBadgeIcon(power: number): string | null {
  const safePower = Math.floor(power);
  const iconSet = DAILY_BADGE_ICON_SETS.find((set) => (
    safePower >= set.minPower && safePower <= set.maxPower
  ));
  if (!iconSet) {
    return null;
  }
  return renderNumberedIcon("daily-badge-icon", safePower, DAILY_BADGE_TEXT_SPEC, iconSet.bodyMarkup);
}

export function renderGlobalRankTrophyIcon(rank: number): string {
  const safeRank = Math.min(3, Math.max(1, Math.floor(rank)));
  return renderNumberedIcon("score-rank-icon", safeRank, RANK_TROPHY_TEXT_SPEC, RANK_TROPHY_BODY_MARKUP);
}
