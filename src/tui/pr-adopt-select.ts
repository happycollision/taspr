/**
 * Single-select TUI component for choosing which PR to adopt when grouping.
 */

import {
  enableRawMode,
  parseKeypress,
  hideCursor,
  showCursor,
  write,
  isTTY,
  colors,
  ansi,
} from "./terminal.ts";

export interface PRAdoptOption {
  label: string;
  value: string | null; // PR ID to adopt, or null for "create new"
  prNumber?: number;
  prUrl?: string;
  description?: string;
}

export interface PRAdoptResult {
  /** The selected PR ID to adopt, or null for "create new" */
  adoptedId: string | null;
  /** Whether the user cancelled */
  cancelled: boolean;
}

/**
 * Render the PR adoption select UI.
 */
function render(options: PRAdoptOption[], cursor: number, title: string, context: string): string {
  const lines: string[] = [];

  // Context at top
  lines.push(colors.yellow(context));
  lines.push("");

  // Title and controls
  lines.push(colors.bold(title));
  lines.push(colors.dim("↑↓ navigate │ Enter confirm │ Esc cancel"));
  lines.push("");

  // Options with descriptions
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt) continue;
    const isCursor = i === cursor;

    const pointer = isCursor ? colors.cyan("→") : " ";
    const label = isCursor ? colors.cyan(opt.label) : opt.label;

    lines.push(`${pointer} ${label}`);

    // Show description/URL indented below
    if (opt.prUrl) {
      lines.push(`  ${colors.dim(opt.prUrl)}`);
    } else if (opt.description) {
      lines.push(`  ${colors.dim(opt.description)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Run an interactive single-select prompt for PR adoption.
 *
 * @param options - Array of options to select from
 * @param title - Title to display above options
 * @param context - Context message explaining the situation
 * @returns Selected PR ID to adopt, null for "create new", or cancelled
 */
export async function prAdoptSelect(
  options: PRAdoptOption[],
  title: string,
  context: string,
): Promise<PRAdoptResult> {
  if (!isTTY()) {
    // Non-interactive: default to first option (adopt existing PR)
    const firstOption = options[0];
    return { adoptedId: firstOption?.value ?? null, cancelled: false };
  }

  if (options.length === 0) {
    return { adoptedId: null, cancelled: false };
  }

  let cursor = 0;
  let lastLineCount = 0;

  const restoreMode = enableRawMode();
  hideCursor();

  const redraw = () => {
    // Clear previous output
    if (lastLineCount > 0) {
      write(ansi.cursorUp(lastLineCount - 1));
      write("\r" + ansi.clearToEnd);
    }

    const output = render(options, cursor, title, context);
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

        case "return": {
          cleanup();
          const selectedOption = options[cursor];
          resolve({
            adoptedId: selectedOption?.value ?? null,
            cancelled: false,
          });
          break;
        }

        case "escape":
        case "q":
          cleanup();
          resolve({ adoptedId: null, cancelled: true });
          break;

        default:
          // Ctrl+C
          if (key.ctrl && key.name === "c") {
            cleanup();
            resolve({ adoptedId: null, cancelled: true });
          }
          break;
      }
    };

    process.stdin.on("data", onData);
  });
}
