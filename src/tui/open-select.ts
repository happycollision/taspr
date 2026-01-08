/**
 * Interactive TUI for selecting which commits/groups to open PRs for.
 * Shows existing PRs as locked, and allows toggling selection for new PRs.
 */

import {
  enableRawMode,
  parseKeypress,
  hideCursor,
  showCursor,
  write,
  isTTY,
  ansi,
  colors,
} from "./terminal.ts";

export interface OpenSelectOption {
  /** Unit ID */
  id: string;
  /** Display label (commit/group title) */
  label: string;
  /** Short hash or ID for display */
  shortId: string;
  /** Whether this unit already has a PR */
  hasPR: boolean;
  /** PR number if exists */
  prNumber?: number;
  /** Whether this is a temp commit (WIP, fixup!, etc.) */
  isTemp: boolean;
}

export interface OpenSelectResult {
  /** IDs of units to open PRs for */
  selectedIds: string[];
  /** Whether the user cancelled */
  cancelled: boolean;
}

/**
 * Render the open-select UI.
 */
function render(options: OpenSelectOption[], selected: Set<number>, cursor: number): string {
  const lines: string[] = [];

  lines.push(colors.bold("Select commits to open PRs for:"));
  lines.push(
    colors.dim("↑↓ navigate │ Space toggle │ a all │ n none │ Enter confirm │ Esc cancel"),
  );
  lines.push("");

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt) continue;
    const isSelected = selected.has(i);
    const isCursor = i === cursor;
    const isSelectable = !opt.hasPR && !opt.isTemp;

    let checkbox: string;
    let status = "";

    if (opt.hasPR) {
      // Already has PR - show as locked
      checkbox = colors.blue("[✓]");
      status = colors.blue(` (PR #${opt.prNumber})`);
    } else if (opt.isTemp) {
      // Temp commit - show as disabled
      checkbox = colors.dim("[·]");
      status = colors.dim(" (temp)");
    } else if (isSelected) {
      // Selected for PR creation
      checkbox = colors.green("[x]");
      status = colors.green(" (will create PR)");
    } else {
      // Not selected - branch only
      checkbox = colors.dim("[ ]");
      status = colors.dim(" (branch only)");
    }

    const pointer = isCursor ? colors.cyan("→") : " ";
    const shortId = colors.dim(`${opt.shortId}`);
    const label = isCursor && isSelectable ? colors.cyan(opt.label) : opt.label;

    lines.push(`${pointer} ${checkbox} ${shortId} ${label}${status}`);
  }

  lines.push("");

  // Count selectable items that are selected
  const selectableCount = options.filter((o, i) => !o.hasPR && !o.isTemp && selected.has(i)).length;
  const existingCount = options.filter((o) => o.hasPR).length;
  const tempCount = options.filter((o) => o.isTemp).length;

  const parts: string[] = [];
  if (selectableCount > 0) {
    parts.push(`${selectableCount} to create`);
  }
  if (existingCount > 0) {
    parts.push(`${existingCount} existing`);
  }
  if (tempCount > 0) {
    parts.push(`${tempCount} temp`);
  }
  lines.push(colors.dim(parts.length > 0 ? parts.join(", ") : "0 selected"));

  return lines.join("\n");
}

/**
 * Run an interactive prompt to select which commits to open PRs for.
 *
 * @param options - Array of options representing units
 * @returns Selected unit IDs, or empty array if cancelled
 */
export async function openSelect(options: OpenSelectOption[]): Promise<OpenSelectResult> {
  if (!isTTY()) {
    return { selectedIds: [], cancelled: true };
  }

  if (options.length === 0) {
    return { selectedIds: [], cancelled: false };
  }

  // Initially select all non-PR, non-temp commits
  const selected = new Set<number>();
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (opt && !opt.hasPR && !opt.isTemp) {
      selected.add(i);
    }
  }

  let cursor = 0;
  let lastLineCount = 0;

  const restoreMode = enableRawMode();
  hideCursor();

  const redraw = () => {
    if (lastLineCount > 0) {
      write(ansi.cursorUp(lastLineCount - 1));
      write("\r" + ansi.clearToEnd);
    }

    const output = render(options, selected, cursor);
    write(output);
    lastLineCount = output.split("\n").length;
  };

  redraw();

  return new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      showCursor();
      restoreMode();
      write("\n");
    };

    const onData = (data: Buffer) => {
      const key = parseKeypress(data);
      const currentOpt = options[cursor];

      switch (key.name) {
        case "up":
        case "k":
          cursor = cursor > 0 ? cursor - 1 : options.length - 1;
          redraw();
          break;

        case "down":
        case "j":
          cursor = cursor < options.length - 1 ? cursor + 1 : 0;
          redraw();
          break;

        case "space":
        case "x":
          // Only toggle if selectable (no existing PR and not temp)
          if (currentOpt && !currentOpt.hasPR && !currentOpt.isTemp) {
            if (selected.has(cursor)) {
              selected.delete(cursor);
            } else {
              selected.add(cursor);
            }
            redraw();
          }
          break;

        case "a":
          // Select all selectable
          for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            if (opt && !opt.hasPR && !opt.isTemp) {
              selected.add(i);
            }
          }
          redraw();
          break;

        case "n":
          // Deselect all (only affects selectable items)
          for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            if (opt && !opt.hasPR && !opt.isTemp) {
              selected.delete(i);
            }
          }
          redraw();
          break;

        case "return": {
          cleanup();
          const selectedIds = [...selected]
            .map((i) => options[i]?.id)
            .filter((id): id is string => id !== undefined);
          resolve({ selectedIds, cancelled: false });
          break;
        }

        case "escape":
        case "q":
          cleanup();
          resolve({ selectedIds: [], cancelled: true });
          break;

        default:
          if (key.ctrl && key.name === "c") {
            cleanup();
            resolve({ selectedIds: [], cancelled: true });
          }
          break;
      }
    };

    process.stdin.on("data", onData);
  });
}
