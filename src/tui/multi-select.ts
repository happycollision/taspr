/**
 * Simple multi-select TUI component for selecting multiple items.
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

export interface MultiSelectOption<T> {
  label: string;
  value: T;
  hint?: string;
}

export interface MultiSelectResult<T> {
  selected: T[];
  cancelled: boolean;
}

/**
 * Render the multi-select UI.
 */
function render<T>(
  options: MultiSelectOption<T>[],
  selected: Set<number>,
  cursor: number,
  title: string,
): string {
  const lines: string[] = [];

  lines.push(colors.bold(title));
  lines.push(
    colors.dim("↑↓ navigate │ Space toggle │ a all │ n none │ Enter confirm │ Esc cancel"),
  );
  lines.push("");

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt) continue;
    const isSelected = selected.has(i);
    const isCursor = i === cursor;

    const checkbox = isSelected ? colors.green("[✓]") : colors.dim("[ ]");
    const pointer = isCursor ? colors.cyan("→") : " ";
    const label = isCursor ? colors.cyan(opt.label) : opt.label;
    const hint = opt.hint ? colors.dim(` (${opt.hint})`) : "";

    lines.push(`${pointer} ${checkbox} ${label}${hint}`);
  }

  lines.push("");
  const count = selected.size;
  lines.push(colors.dim(`${count} selected`));

  return lines.join("\n");
}

/**
 * Run an interactive multi-select prompt.
 *
 * @param options - Array of options to select from
 * @param title - Title to display above options
 * @returns Selected values, or empty array if cancelled
 */
export async function multiSelect<T>(
  options: MultiSelectOption<T>[],
  title: string = "Select items:",
): Promise<MultiSelectResult<T>> {
  if (!isTTY()) {
    // Non-interactive: return empty selection
    return { selected: [], cancelled: true };
  }

  if (options.length === 0) {
    return { selected: [], cancelled: false };
  }

  const selected = new Set<number>();
  let cursor = 0;
  let lastLineCount = 0;

  const restoreMode = enableRawMode();
  hideCursor();

  const redraw = () => {
    // Clear previous output by moving up and clearing each line
    if (lastLineCount > 0) {
      // Move cursor up to the first line of our output
      write(ansi.cursorUp(lastLineCount - 1));
      // Move to beginning of line and clear everything below
      write("\r" + ansi.clearToEnd);
    }

    const output = render(options, selected, cursor, title);
    write(output);
    lastLineCount = output.split("\n").length;
  };

  // Initial render
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
          if (selected.has(cursor)) {
            selected.delete(cursor);
          } else {
            selected.add(cursor);
          }
          redraw();
          break;

        case "a":
          // Select all
          for (let i = 0; i < options.length; i++) {
            selected.add(i);
          }
          redraw();
          break;

        case "n":
          // Select none
          selected.clear();
          redraw();
          break;

        case "return": {
          cleanup();
          const selectedValues = [...selected]
            .map((i) => options[i]?.value)
            .filter((v): v is T => v !== undefined);
          resolve({ selected: selectedValues, cancelled: false });
          break;
        }

        case "escape":
        case "q":
          cleanup();
          resolve({ selected: [], cancelled: true });
          break;

        default:
          // Ctrl+C
          if (key.ctrl && key.name === "c") {
            cleanup();
            resolve({ selected: [], cancelled: true });
          }
          break;
      }
    };

    process.stdin.on("data", onData);
  });
}
