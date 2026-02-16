export interface ThemePalette {
  name: string;
  colors: [string, string, string, string, string];
  text: string;
  glow: string;
  glaze: string;
}

export interface CustomThemeDraft {
  colors: [string, string, string, string, string];
  text: string;
  glaze: string;
  glowColor: string;
  glowAlpha: number;
}

const CUSTOM_THEME_STORAGE_KEY = "torus-custom-theme-v1";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const RGBA_PATTERN =
  /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})(?:\s*[,/]\s*(\d*\.?\d+))?\s*\)$/i;
const DEFAULT_GLOW_ALPHA = 0.18;

export const TORUS_THEMES: readonly ThemePalette[] = [
  {
    name: "Original Warm",
    colors: ["#ee5a52", "#7dc7ff", "#ffd95e", "#29a6e8", "#6d6eff"],
    text: "#ffe2be",
    glow: "rgba(255, 226, 190, 0.18)",
    glaze: "#ffe2be",
  },
  {
    name: "Arcade Neon",
    colors: ["#ff2f2f", "#19b7ff", "#fef6dc", "#ff9800", "#a24bff"],
    text: "#ffe8c7",
    glow: "rgba(255, 176, 82, 0.2)",
    glaze: "#fff0d5",
  },
  {
    name: "CUD Friendly",
    colors: ["#ff4b00", "#fff100", "#03af7a", "#005aff", "#4dc4ff"],
    text: "#804000",
    glow: "rgba(122, 205, 255, 0.2)",
    glaze: "#fff8cc",
  },
  {
    name: "Classic Soft",
    colors: ["#ff8fc7", "#0a84ff", "#ffd60a", "#ac8e68", "#32d74b"],
    text: "#ffe2be",
    glow: "rgba(140, 180, 140, 0.18)",
    glaze: "#f4e8d5",
  },
];

export class ThemeManager {
  private currentIndex = 0;
  private activeDraft: CustomThemeDraft;
  private customActive = false;

  constructor(
    private readonly themeChipEl: HTMLElement,
    private readonly themes: readonly ThemePalette[] = TORUS_THEMES,
    private readonly root: HTMLElement = document.documentElement,
    private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = getSafeStorage(),
    private readonly customThemeStorageKey: string = CUSTOM_THEME_STORAGE_KEY,
  ) {
    if (this.themes.length === 0) {
      throw new Error("No theme is configured");
    }
    this.activeDraft = themeToDraft(this.themes[0]);
  }

  public apply(index: number): ThemePalette {
    const safeIndex = this.normalizeIndex(index);
    const theme = this.themes[safeIndex];
    this.applyThemeToRoot(theme, theme.name);
    this.activeDraft = themeToDraft(theme);
    this.customActive = false;
    this.currentIndex = safeIndex;
    return theme;
  }

  public applyCustom(draft: CustomThemeDraft): ThemePalette {
    const normalized = sanitizeCustomThemeDraft(draft, this.getPresetDraft());
    const customTheme = draftToTheme(normalized);
    this.applyThemeToRoot(customTheme, "Custom");
    this.activeDraft = cloneCustomThemeDraft(normalized);
    this.customActive = true;
    return customTheme;
  }

  public saveCustom(draft: CustomThemeDraft): ThemePalette {
    const theme = this.applyCustom(draft);
    this.setStorageValue(
      this.customThemeStorageKey,
      JSON.stringify(this.activeDraft),
    );
    return theme;
  }

  public clearCustom(): ThemePalette {
    this.removeStorageValue(this.customThemeStorageKey);
    return this.apply(this.currentIndex);
  }

  public loadSavedCustom(): CustomThemeDraft | null {
    const raw = this.getStorageValue(this.customThemeStorageKey);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return deserializeCustomThemeDraft(parsed, this.getPresetDraft());
    } catch {
      return null;
    }
  }

  public cycle(): ThemePalette {
    return this.apply(this.currentIndex + 1);
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  public getActiveDraft(): CustomThemeDraft {
    return cloneCustomThemeDraft(this.activeDraft);
  }

  public getPresetDraft(index: number = this.currentIndex): CustomThemeDraft {
    const preset = this.themes[this.normalizeIndex(index)];
    return themeToDraft(preset);
  }

  public isCustomActive(): boolean {
    return this.customActive;
  }

  private applyThemeToRoot(theme: ThemePalette, label: string): void {
    this.root.style.setProperty("--torus-0", theme.colors[0]);
    this.root.style.setProperty("--torus-1", theme.colors[1]);
    this.root.style.setProperty("--torus-2", theme.colors[2]);
    this.root.style.setProperty("--torus-3", theme.colors[3]);
    this.root.style.setProperty("--torus-4", theme.colors[4]);
    this.root.style.setProperty("--torus-text", theme.text);
    this.root.style.setProperty("--torus-glow", theme.glow);
    this.root.style.setProperty("--torus-glaze", theme.glaze);
    this.themeChipEl.textContent = `Theme: ${label}`;
  }

  private getStorageValue(key: string): string | null {
    if (!this.storage) {
      return null;
    }
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private setStorageValue(key: string, value: string): void {
    if (!this.storage) {
      return;
    }
    try {
      this.storage.setItem(key, value);
    } catch {
      // Ignore storage write failures.
    }
  }

  private removeStorageValue(key: string): void {
    if (!this.storage) {
      return;
    }
    try {
      this.storage.removeItem(key);
    } catch {
      // Ignore storage remove failures.
    }
  }

  private normalizeIndex(index: number): number {
    const size = this.themes.length;
    if (size === 0) {
      throw new Error("No theme is configured");
    }

    const raw = index % size;
    if (raw < 0) {
      return raw + size;
    }
    return raw;
  }
}

function getSafeStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function themeToDraft(theme: ThemePalette): CustomThemeDraft {
  const glow = parseGlow(theme.glow, theme.text);
  return {
    colors: [
      normalizeHexColor(theme.colors[0]) ?? "#ee5a52",
      normalizeHexColor(theme.colors[1]) ?? "#7dc7ff",
      normalizeHexColor(theme.colors[2]) ?? "#ffd95e",
      normalizeHexColor(theme.colors[3]) ?? "#29a6e8",
      normalizeHexColor(theme.colors[4]) ?? "#6d6eff",
    ],
    text: normalizeHexColor(theme.text) ?? "#ffe2be",
    glaze: normalizeHexColor(theme.glaze) ?? "#ffe2be",
    glowColor: glow.color,
    glowAlpha: glow.alpha,
  };
}

function draftToTheme(draft: CustomThemeDraft): ThemePalette {
  const [r, g, b] = hexToRgb(draft.glowColor);
  const alpha = clamp01(draft.glowAlpha);
  return {
    name: "Custom",
    colors: draft.colors,
    text: draft.text,
    glaze: draft.glaze,
    glow: `rgba(${r}, ${g}, ${b}, ${toAlphaString(alpha)})`,
  };
}

function deserializeCustomThemeDraft(
  raw: unknown,
  fallback: CustomThemeDraft,
): CustomThemeDraft | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as Partial<CustomThemeDraft>;
  const hasAnyField = (
    "colors" in source ||
    "text" in source ||
    "glaze" in source ||
    "glowColor" in source ||
    "glowAlpha" in source
  );
  if (!hasAnyField) {
    return null;
  }
  return sanitizeCustomThemeDraft(source, fallback);
}

function sanitizeCustomThemeDraft(
  source: Partial<CustomThemeDraft>,
  fallback: CustomThemeDraft,
): CustomThemeDraft {
  const colorsSource = Array.isArray(source.colors) ? source.colors : fallback.colors;
  return {
    colors: [
      normalizeHexColor(colorsSource[0]) ?? fallback.colors[0],
      normalizeHexColor(colorsSource[1]) ?? fallback.colors[1],
      normalizeHexColor(colorsSource[2]) ?? fallback.colors[2],
      normalizeHexColor(colorsSource[3]) ?? fallback.colors[3],
      normalizeHexColor(colorsSource[4]) ?? fallback.colors[4],
    ],
    text: normalizeHexColor(source.text) ?? fallback.text,
    glaze: normalizeHexColor(source.glaze) ?? fallback.glaze,
    glowColor: normalizeHexColor(source.glowColor) ?? fallback.glowColor,
    glowAlpha: clamp01(
      typeof source.glowAlpha === "number"
        ? source.glowAlpha
        : fallback.glowAlpha,
    ),
  };
}

function cloneCustomThemeDraft(draft: CustomThemeDraft): CustomThemeDraft {
  return {
    colors: [
      draft.colors[0],
      draft.colors[1],
      draft.colors[2],
      draft.colors[3],
      draft.colors[4],
    ],
    text: draft.text,
    glaze: draft.glaze,
    glowColor: draft.glowColor,
    glowAlpha: draft.glowAlpha,
  };
}

function parseGlow(
  value: string,
  fallbackColor: string,
): { color: string; alpha: number } {
  const rgba = RGBA_PATTERN.exec(value.trim());
  if (rgba) {
    const r = clampRgb(Number(rgba[1]));
    const g = clampRgb(Number(rgba[2]));
    const b = clampRgb(Number(rgba[3]));
    const alpha = rgba[4] ? clamp01(Number(rgba[4])) : DEFAULT_GLOW_ALPHA;
    return {
      color: rgbToHex(r, g, b),
      alpha,
    };
  }

  const directColor = normalizeHexColor(value);
  if (directColor) {
    return {
      color: directColor,
      alpha: DEFAULT_GLOW_ALPHA,
    };
  }

  return {
    color: normalizeHexColor(fallbackColor) ?? "#ffe2be",
    alpha: DEFAULT_GLOW_ALPHA,
  };
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const candidate = value.trim();
  if (!HEX_COLOR_PATTERN.test(candidate)) {
    return null;
  }
  return candidate.toLowerCase();
}

function hexToRgb(color: string): [number, number, number] {
  const safeColor = normalizeHexColor(color) ?? "#ffffff";
  const hex = safeColor.slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(clampRgb(r))}${toHex(clampRgb(g))}${toHex(clampRgb(b))}`;
}

function toHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

function clampRgb(value: number): number {
  if (!Number.isFinite(value)) {
    return 255;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_GLOW_ALPHA;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function toAlphaString(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}
