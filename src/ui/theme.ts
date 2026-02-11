export interface ThemePalette {
  name: string;
  colors: [string, string, string, string, string];
  text: string;
  glow: string;
  glaze: string;
}

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

  constructor(
    private readonly themeChipEl: HTMLElement,
    private readonly themes: readonly ThemePalette[] = TORUS_THEMES,
    private readonly root: HTMLElement = document.documentElement,
  ) {}

  public apply(index: number): ThemePalette {
    const safeIndex = this.normalizeIndex(index);
    const theme = this.themes[safeIndex];

    this.root.style.setProperty("--torus-0", theme.colors[0]);
    this.root.style.setProperty("--torus-1", theme.colors[1]);
    this.root.style.setProperty("--torus-2", theme.colors[2]);
    this.root.style.setProperty("--torus-3", theme.colors[3]);
    this.root.style.setProperty("--torus-4", theme.colors[4]);
    this.root.style.setProperty("--torus-text", theme.text);
    this.root.style.setProperty("--torus-glow", theme.glow);
    this.root.style.setProperty("--torus-glaze", theme.glaze);

    this.currentIndex = safeIndex;
    this.themeChipEl.textContent = `Theme: ${theme.name}`;
    return theme;
  }

  public cycle(): ThemePalette {
    return this.apply(this.currentIndex + 1);
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
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
