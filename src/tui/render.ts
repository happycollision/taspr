import type { TUIState, GroupValidationResult } from "./state.ts";
import { getGroupSummary, getConflict, validateGroupsContiguous } from "./state.ts";
import { colors } from "./terminal.ts";

const SEPARATOR = "─".repeat(55);

/**
 * Render the entire TUI screen.
 */
export function renderScreen(state: TUIState, defaultBranch: string): string {
  const lines: string[] = [];

  // Validate groups
  const validation = validateGroupsContiguous(state);

  // Header
  const modeIndicator = state.moveMode !== null ? colors.yellow(" [MOVE MODE]") : "";
  lines.push(`Group Editor - ${state.commits.length} commits${modeIndicator}`);
  lines.push("");

  // Origin indicator
  lines.push(`  → ${defaultBranch}`);
  lines.push("");

  // Commits
  for (let i = 0; i < state.commits.length; i++) {
    lines.push(renderCommitLine(state, i, validation));
  }

  lines.push("");
  lines.push(SEPARATOR);

  // Group summary
  lines.push(getGroupSummary(state));

  // Validation error
  if (!validation.valid && validation.error) {
    lines.push(colors.red(`⚠ ${validation.error}`));
  }

  // Help line
  lines.push(renderHelpLine(state, validation));

  return lines.join("\n");
}

/**
 * Render a single commit line.
 */
function renderCommitLine(
  state: TUIState,
  index: number,
  validation: GroupValidationResult,
): string {
  const commit = state.commits[index];
  if (!commit) {
    return "";
  }
  const group = state.groups.get(index) ?? null;
  const isCursor = index === state.cursor;
  const isMoving = index === state.moveMode;
  const isInvalidGroup = !validation.valid && group === validation.invalidGroup;

  // Build the line parts
  const parts: string[] = [];

  // Cursor/move indicator
  if (isMoving) {
    parts.push(colors.yellow("»"));
  } else if (isCursor) {
    parts.push(colors.cyan("→"));
  } else {
    parts.push(" ");
  }

  // Group indicator
  if (group !== null) {
    if (isInvalidGroup) {
      parts.push(` ${colors.red(group)}`);
    } else {
      parts.push(` ${colors.magenta(group)}`);
    }
  } else {
    parts.push(" ─");
  }

  // Commit hash
  const hashDisplay = commit.commitId || commit.shortHash;
  parts.push(` ${colors.dim(hashDisplay)}`);

  // Subject (truncated if needed)
  const prefixLen = 4 + hashDisplay.length + 2; // "» A hash  "
  const maxSubjectLen = Math.max(20, 70 - prefixLen);
  let subject = commit.subject;
  if (subject.length > maxSubjectLen) {
    subject = subject.slice(0, maxSubjectLen - 1) + "…";
  }

  // Apply styling based on state
  if (isMoving) {
    parts.push(`  ${colors.yellow(subject)}`);
  } else if (isCursor) {
    parts.push(`  ${colors.brightWhite(subject)}`);
  } else {
    parts.push(`  ${subject}`);
  }

  // Conflict indicator (if this commit is being moved past another)
  if (state.moveMode !== null && state.moveMode !== index) {
    const movingCommit = state.commits[state.moveMode];
    if (movingCommit) {
      const conflict = getConflict(state, movingCommit.hash, commit.hash);
      if (conflict) {
        if (conflict.status === "conflict") {
          parts.push(colors.red(`  ✗ CONFLICT`));
          if (conflict.files && conflict.files.length > 0) {
            parts.push(colors.dim(` (${conflict.files[0]})`));
          }
        } else if (conflict.status === "warning") {
          parts.push(colors.yellow(`  ⚠️`));
          if (conflict.files && conflict.files.length > 0) {
            parts.push(colors.dim(` (${conflict.files.join(", ")})`));
          }
        }
      }
    }
  }

  return parts.join("");
}

/**
 * Render the help line at the bottom.
 */
function renderHelpLine(state: TUIState, validation: GroupValidationResult): string {
  if (state.moveMode !== null) {
    return colors.dim("↑↓ swap position │ Space exit move mode │ ←→ disabled");
  }

  if (!validation.valid) {
    return (
      colors.dim("↑↓ navigate │ Space move mode │ ←→ group │ ") +
      colors.red("Enter disabled") +
      colors.dim(" │ Esc cancel")
    );
  }

  return colors.dim("↑↓ navigate │ Space move mode │ ←→ group │ Enter confirm │ Esc cancel");
}

/**
 * Render the group name input screen.
 */
export function renderGroupNameInput(
  groupLetter: string,
  commitCount: number,
  currentInput: string,
  cursorPos: number,
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`Enter name for group ${colors.magenta(groupLetter)} (${commitCount} commits):`);
  lines.push("");

  // Input field with cursor
  const beforeCursor = currentInput.slice(0, cursorPos);
  const atCursor = currentInput[cursorPos] || " ";
  const afterCursor = currentInput.slice(cursorPos + 1);

  lines.push(`  > ${beforeCursor}${colors.inverse(atCursor)}${afterCursor}`);
  lines.push("");
  lines.push(colors.dim("Enter to confirm │ Esc to cancel"));

  return lines.join("\n");
}

/**
 * Render a confirmation dialog.
 */
export function renderConfirmDialog(message: string, action: string): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(message);
  lines.push("");
  lines.push(`  ${colors.green("y")} - Yes, ${action}`);
  lines.push(`  ${colors.red("n")} - No, cancel`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Render an error message.
 */
export function renderError(message: string): string {
  return `\n${colors.red("✗ Error:")} ${message}\n`;
}

/**
 * Render a success message.
 */
export function renderSuccess(message: string): string {
  return `\n${colors.green("✓")} ${message}\n`;
}

/**
 * Render progress indicator.
 */
export function renderProgress(message: string): string {
  return `\n${colors.cyan("⏳")} ${message}\n`;
}

/**
 * Render empty stack message.
 */
export function renderEmptyStack(defaultBranch: string): string {
  return `\nNo commits ahead of ${defaultBranch}\n\nNothing to group.\n`;
}

/**
 * Render non-TTY error.
 */
export function renderNonTTYError(): string {
  return colors.red(
    "\n✗ Error: This command requires an interactive terminal.\n" +
      "  The group editor cannot run in non-interactive mode.\n",
  );
}
