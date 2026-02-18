import type { Difficulty, GameSnapshot, PoleEntry, TorusCell } from "../game";
import type { ScoreEntry } from "../scoreboard";
import { renderGlobalRankTrophyIcon } from "./badge-icons";
import type { TorusDom } from "./layout";

export type GameStatus = "Paused" | "Running" | "Game Over";

interface ColorSpec {
  defaultColor?: string;
  perCharColor?: Map<number, string>;
}

interface ScoreboardRenderOptions {
  allowSkillImport?: boolean;
  showMeTag?: boolean;
  showGlobalRankBadge?: boolean;
  meBadge?: {
    label: string;
    title: string;
    iconMarkup?: string;
  };
}

export class TorusRenderer {
  private status: GameStatus = "Paused";
  private scoreVisible = true;
  private expandedScoreIndex: number | null = null;

  constructor(private readonly dom: TorusDom) {}

  public setStatus(status: GameStatus): void {
    this.status = status;
    this.dom.statusEl.textContent = status;
  }

  public render(snapshot: GameSnapshot): void {
    this.dom.scoreEl.textContent = String(snapshot.score);
    this.dom.levelEl.textContent = String(snapshot.level);
    this.dom.poleCountEl.textContent = `${snapshot.numToriInPole}/${snapshot.poleHeight}`;

    const gaugeRatio = snapshot.gaugeMax > 0
      ? snapshot.levelGauge / snapshot.gaugeMax
      : 0;
    this.dom.gaugeFillEl.style.width = `${Math.min(100, Math.max(0, gaugeRatio * 100))}%`;

    if (!snapshot.gameOn && this.status === "Running") {
      this.setStatus("Paused");
    }

    this.renderBox(snapshot);
    this.renderPole(snapshot);
    this.syncPanelHeights();
  }

  public refreshLayout(): void {
    this.syncPanelHeights();
  }

  public toggleScoreboard(): void {
    this.setScoreboardVisible(!this.scoreVisible);
  }

  public setScoreboardVisible(visible: boolean): void {
    this.scoreVisible = visible;
    this.dom.scoreCardEl.classList.toggle("hidden", !visible);
  }

  public renderScoreboard(
    entries: ReadonlyArray<ScoreEntry>,
    options: ScoreboardRenderOptions = {},
  ): void {
    const allowSkillImport = options.allowSkillImport !== false;
    const showMeTag = options.showMeTag === true;
    const showGlobalRankBadge = options.showGlobalRankBadge === true;
    const meBadge = options.meBadge;
    if (entries.length === 0) {
      this.dom.scoreListEl.innerHTML = '<li class="empty-row">No records yet</li>';
      return;
    }

    this.dom.scoreListEl.innerHTML = entries
      .map((row, index) => {
        const date = formatDate(row.date);
        const skillMark = row.skillUsage.length > 0 ? " · Skill" : "";
        const isExpanded = this.expandedScoreIndex === index;
        const meTag = showMeTag && row.isMe
          ? '<span class="score-me-tag" aria-label="My record">Me</span>'
          : "";
        const rankBadgeMarkup = showGlobalRankBadge && index < 3
          ? `<span class="score-rank-badge rank-${index + 1}" title="Global Rank #${index + 1}" aria-label="Global Rank ${index + 1}">${renderGlobalRankTrophyIcon(index + 1)}</span>`
          : "";
        const meBadgeMarkup = (
          showMeTag &&
          row.isMe &&
          meBadge
        )
          ? `<span class="score-me-badge" title="${escapeHtml(meBadge.title)}" aria-label="${escapeHtml(meBadge.title)}">${
            meBadge.iconMarkup
              ? meBadge.iconMarkup
              : `<span class="score-me-badge-text">${escapeHtml(meBadge.label)}</span>`
          }</span>`
          : "";
        const drawerBody = row.skillUsage.length === 0
          ? '<li class="empty">No skill information recorded.</li>'
          : row.skillUsage
            .map((usage, skillIndex) => {
              const command = usage.command ? usage.command : "-";
              const canImport = (
                allowSkillImport &&
                Boolean(usage.command && usage.command.trim().length > 0)
              );
              const importDisabledAttr = canImport ? "" : "disabled";
              const importTitle = canImport ? "Import skill" : "No command to import";
              const importButton = allowSkillImport
                ? `<button
                  type="button"
                  class="mini-btn score-drawer-import-btn"
                  data-action="import-skill"
                  data-score-index="${index}"
                  data-skill-index="${skillIndex}"
                  title="${importTitle}"
                  aria-label="${importTitle}"
                  ${importDisabledAttr}
                >${renderImportIconMarkup()}</button>`
                : "";
              return `<li class="score-drawer-skill-item">
                <div class="score-drawer-item-main">
                  <div class="score-drawer-item-name" title="${escapeHtml(usage.name)}">${escapeHtml(usage.name)}</div>
                  <div class="score-drawer-item-command" title="${escapeHtml(command)}">${escapeHtml(command)}</div>
                </div>
                ${importButton}
              </li>`;
            })
            .join("");
        return `<li class="score-row${isExpanded ? " expanded" : ""}" data-score-index="${index}" role="button" tabindex="0" aria-expanded="${isExpanded ? "true" : "false"}">
          <span class="name-wrap"><span class="name" title="${escapeHtml(row.user)}">${escapeHtml(row.user)}</span>${rankBadgeMarkup}${meTag}${meBadgeMarkup}</span>
          <span class="point">${row.score}</span>
          <span class="meta">Lv.${row.level} · ${date}${skillMark}</span>
          <div class="score-drawer">
            <div class="score-drawer-label">Skills Used</div>
            <ul class="score-drawer-list">${drawerBody}</ul>
          </div>
        </li>`;
      })
      .join("");
  }

  public renderScoreboardLoading(message: string): void {
    this.dom.scoreListEl.innerHTML =
      `<li class="empty-row loading-row" aria-live="polite">${escapeHtml(message)}<span class="loading-ellipsis" aria-hidden="true"></span></li>`;
  }

  public setExpandedScoreIndex(index: number | null): void {
    this.expandedScoreIndex = index;
  }

  private renderBox(snapshot: GameSnapshot): void {
    const cols = snapshot.numCols;
    this.dom.boxGridEl.style.gridTemplateColumns = `repeat(${cols}, var(--ascii-cell-width))`;

    const flyingByCol = new Map<number, { color: number; height: number }>();
    for (const flying of snapshot.flying) {
      flyingByCol.set(flying.col, { color: flying.color, height: flying.height });
    }

    const cells: string[] = [];
    for (let row = 0; row < snapshot.boxHeight; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        cells.push(this.renderBoxCellAt(snapshot, row, col, flyingByCol.get(col)));
      }
    }

    this.dom.boxGridEl.innerHTML = cells.join("");
    this.dom.flyingLayerEl.innerHTML = "";
  }

  private renderBoxCellAt(
    snapshot: GameSnapshot,
    row: number,
    col: number,
    flying: { color: number; height: number } | undefined,
  ): string {
    if (flying) {
      const baseRow = snapshot.boxHeight - flying.height;
      const relation = row - baseRow;
      if (relation >= -1 && relation <= 1) {
        return this.renderFlyingCell(flying.color, flying.height, relation, snapshot.difficulty);
      }
    }

    return this.renderStaticBoxCell(snapshot.box[row][col], snapshot.difficulty);
  }

  private renderFlyingCell(
    color: number,
    height: number,
    relation: number,
    difficulty: Difficulty,
  ): string {
    const phase = mod(height, 4);

    if (phase === 0) {
      if (relation === 0) {
        return renderAsciiCell(" @ @ ", {
          defaultColor: toColorCss(getTorusColorId(color, 4, 1, difficulty)),
        });
      }
      if (relation === -1) {
        return renderAsciiCell(" /@\\ ", {
          defaultColor: toColorCss(getTorusColorId(color, 4, 1, difficulty)),
        });
      }
      return renderAsciiCell(" \\@/ ", {
        defaultColor: toColorCss(getTorusColorId(color, 1, 1, difficulty)),
      });
    }

    if (phase === 1) {
      if (relation === 0) {
        return renderAsciiCell(" @@@ ", {
          defaultColor: toColorCss(getTorusColorId(color, 4, 1, difficulty)),
        });
      }
      return renderAsciiCell("     ");
    }

    if (phase === 2) {
      if (relation === 0) {
        return renderAsciiCell(" @ @ ", {
          defaultColor: toColorCss(getTorusColorId(color, 4, 1, difficulty)),
        });
      }
      if (relation === -1) {
        return renderAsciiCell(" /@\\ ", {
          defaultColor: toColorCss(getTorusColorId(color, 1, 1, difficulty)),
        });
      }
      return renderAsciiCell(" \\@/ ", {
        defaultColor: toColorCss(getTorusColorId(color, 4, 1, difficulty)),
      });
    }

    if (relation === 0) {
      return renderAsciiCell(" @@@ ", {
        defaultColor: toColorCss(getTorusColorId(color, 1, 1, difficulty)),
      });
    }

    return renderAsciiCell("     ");
  }

  private renderStaticBoxCell(entry: TorusCell | null, difficulty: Difficulty): string {
    if (entry === null) {
      return renderAsciiCell("     ");
    }

    if (entry.angle === -1) {
      return renderAsciiCell(" *** ", {
        defaultColor: toColorCss(getTorusColorId(entry.color, 1, 0, difficulty)),
      });
    }

    const perCharColor = new Map<number, string>();
    perCharColor.set(1, toColorCss(getTorusColorId(entry.color, entry.angle, 0, difficulty)));
    perCharColor.set(2, toColorCss(getTorusColorId(entry.color, entry.angle, 1, difficulty)));
    perCharColor.set(3, toColorCss(getTorusColorId(entry.color, entry.angle, 2, difficulty)));

    return renderAsciiCell(" @@@ ", { perCharColor });
  }

  private renderPole(snapshot: GameSnapshot): void {
    this.dom.poleGridEl.style.gridTemplateColumns = `repeat(${snapshot.numCols}, var(--ascii-cell-width))`;

    const cells: string[] = [];

    for (let row = 0; row < snapshot.poleHeight; row += 1) {
      for (let col = 0; col < snapshot.numCols; col += 1) {
        cells.push(this.renderPoleCell(snapshot.pole[row][col], snapshot.difficulty));
      }
    }

    for (let col = 0; col < snapshot.numCols; col += 1) {
      if (col === snapshot.polePos) {
        cells.push(renderAsciiCell(" --- ", { defaultColor: "var(--torus-text)" }, "cursor"));
      } else {
        cells.push(renderAsciiCell("     "));
      }
    }

    this.dom.poleGridEl.innerHTML = cells.join("");
  }

  private renderPoleCell(entry: PoleEntry, difficulty: Difficulty): string {
    if (entry === null) {
      return renderAsciiCell("     ");
    }

    if (entry === "pole") {
      return renderAsciiCell("  |  ", { defaultColor: "var(--torus-text)" }, "pole-marker");
    }

    return this.renderStaticBoxCell(entry, difficulty);
  }

  private syncPanelHeights(): void {
    const board = this.dom.boardStageCardEl;
    const side = this.dom.sideColumnEl;

    board.style.height = "";
    side.style.height = "";
    if (window.matchMedia("(max-width: 1100px)").matches) {
      return;
    }

    const target = Math.ceil(board.getBoundingClientRect().height);
    if (!Number.isFinite(target) || target <= 0) {
      return;
    }

    const arenaHeight = Math.floor(board.parentElement?.getBoundingClientRect().height ?? target);
    const clamped = Number.isFinite(arenaHeight) && arenaHeight > 0
      ? Math.min(target, arenaHeight)
      : target;

    side.style.height = `${clamped}px`;
  }
}

function renderAsciiCell(
  text: string,
  colorSpec: ColorSpec = {},
  extraClass?: string,
): string {
  const classNames = ["cell", "ascii"];
  if (extraClass) {
    classNames.push(extraClass);
  }

  const chars = Array.from(text.padEnd(5, " ").slice(0, 5));
  const content = chars
    .map((ch, index) => {
      const color = colorSpec.perCharColor?.get(index)
        ?? (ch === " " ? undefined : colorSpec.defaultColor);
      return renderAsciiChar(ch, color);
    })
    .join("");

  return `<div class="${classNames.join(" ")}">${content}</div>`;
}

function renderAsciiChar(ch: string, color?: string): string {
  const style = color ? ` style="color:${color}"` : "";
  const content = ch === " " ? "&nbsp;" : escapeHtml(ch);
  return `<span class="ch"${style}>${content}</span>`;
}

function getTorusColorId(
  color: number,
  angle: number,
  part: number,
  difficulty: Difficulty,
): number {
  if (difficulty === 1) {
    return color;
  }

  const halfGlazed = mod(angle + part + 5, 6) < 3;
  if (halfGlazed) {
    return color;
  }
  return 100;
}

function toColorCss(colorId: number): string {
  if (colorId === 100) {
    return "var(--torus-glaze)";
  }
  return colorVar(colorId);
}

function colorVar(color: number): string {
  const safe = Math.min(4, Math.max(0, color));
  return `var(--torus-${safe})`;
}

function mod(value: number, m: number): number {
  const r = value % m;
  if (r < 0) {
    return r + m;
  }
  return r;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderImportIconMarkup(): string {
  // Lucide "import" icon
  return `<svg class="score-drawer-import-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 3v12" />
    <path d="m8 11 4 4 4-4" />
    <path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
  </svg>`;
}
