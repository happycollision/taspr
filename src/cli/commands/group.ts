import { runGroupEditor } from "../../tui/group-editor.ts";
import {
  dissolveGroup,
  applyGroupSpec,
  parseGroupSpec,
  removeAllGroupTrailers,
  mergeSplitGroup,
  updateGroupTitle,
} from "../../git/group-rebase.ts";
import { getStackCommitsWithTrailers } from "../../git/commands.ts";
import { parseStack, type CommitWithTrailers } from "../../core/stack.ts";
import { formatValidationError } from "../output.ts";
import { multiSelect } from "../../tui/multi-select.ts";
import { repairSelect } from "../../tui/repair-select.ts";
import { isTTY } from "../../tui/terminal.ts";
import type { PRUnit, StackParseResult } from "../../types.ts";
import * as readline from "node:readline";

export interface GroupCommandOptions {
  apply?: string;
  fix?: boolean | string;
}

/**
 * Main group command - launches the TUI editor or applies a spec.
 */
export async function groupCommand(options: GroupCommandOptions = {}): Promise<void> {
  // Fix mode: repair invalid group trailers
  if (options.fix !== undefined) {
    const mode = typeof options.fix === "string" ? options.fix : undefined;
    await fixCommand(mode);
    return;
  }

  // Non-interactive mode: apply a JSON spec
  if (options.apply) {
    await applyCommand(options.apply);
    return;
  }

  // Interactive mode: launch TUI
  const result = await runGroupEditor();

  if (result.error) {
    process.exit(1);
  }
}

/**
 * Apply a group specification from JSON.
 *
 * Format:
 * {
 *   "order": ["commit1", "commit2", ...],  // optional - new order
 *   "groups": [
 *     {"commits": ["commit1", "commit2"], "name": "Group Name"}
 *   ]
 * }
 *
 * Commits can be referenced by:
 * - Full hash
 * - Short hash (7 or 8 chars)
 * - Taspr-Commit-Id
 */
async function applyCommand(json: string): Promise<void> {
  try {
    const spec = parseGroupSpec(json);

    console.log("Applying group spec...");
    if (spec.order) {
      console.log(`  Order: ${spec.order.length} commits`);
    }
    if (spec.groups.length > 0) {
      console.log(`  Groups: ${spec.groups.length}`);
      for (const g of spec.groups) {
        console.log(`    - "${g.name}" (${g.commits.length} commits)`);
      }
    }

    const result = await applyGroupSpec(spec);

    if (!result.success) {
      console.error(`✗ Error: ${result.error}`);
      if (result.conflictFile) {
        console.error(`  Conflict in: ${result.conflictFile}`);
      }
      process.exit(1);
    }

    console.log("✓ Group spec applied successfully.");
  } catch (err) {
    console.error(`✗ Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Dissolve a group by removing its trailers.
 * If no groupId is provided, shows an interactive multi-select.
 */
export async function dissolveCommand(groupId?: string): Promise<void> {
  // Get current stack
  const commits = await getStackCommitsWithTrailers();

  if (commits.length === 0) {
    console.log("No commits in stack.");
    return;
  }

  // Parse stack to find groups
  const validation = parseStack(commits);
  if (!validation.ok) {
    console.log(formatValidationError(validation));
    process.exit(1);
  }

  const units = validation.units;
  const groups = units.filter((u): u is PRUnit & { type: "group" } => u.type === "group");

  if (groups.length === 0) {
    console.log("No groups in the current stack.");
    return;
  }

  // If groupId provided, dissolve that specific group
  if (groupId) {
    const targetGroup = groups.find((g) => g.id === groupId || g.id.startsWith(groupId));

    if (!targetGroup) {
      console.log(`Group "${groupId}" not found.`);
      console.log("");
      console.log("Available groups:");
      for (const group of groups) {
        console.log(`  ${group.id}: "${group.title}"`);
      }
      process.exit(1);
    }

    await dissolveSingleGroup(targetGroup);
    return;
  }

  // No groupId provided - interactive mode
  if (!isTTY()) {
    // Non-interactive: list groups and exit
    console.log("Available groups:");
    for (const group of groups) {
      console.log(`  ${group.id}: "${group.title}" (${group.commits.length} commits)`);
    }
    console.log("");
    console.log("Usage: taspr group dissolve <group-id>");
    return;
  }

  // Interactive multi-select
  const options = groups.map((g) => ({
    label: `"${g.title}"`,
    value: g,
    hint: `${g.commits.length} commit${g.commits.length === 1 ? "" : "s"}`,
  }));

  const result = await multiSelect(options, "Select groups to dissolve:");

  if (result.cancelled || result.selected.length === 0) {
    console.log("No groups selected.");
    return;
  }

  // Dissolve selected groups
  for (const group of result.selected) {
    await dissolveSingleGroup(group);
  }
}

/**
 * Dissolve a single group.
 */
async function dissolveSingleGroup(group: PRUnit): Promise<void> {
  console.log(`Dissolving group "${group.title}" (${group.id})...`);

  const result = await dissolveGroup(group.id);

  if (!result.success) {
    console.log(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log(`✓ Group "${group.title}" dissolved.`);
}

/**
 * Fix invalid group trailers.
 * Interactive mode by default, or "dissolve" mode for non-interactive.
 */
async function fixCommand(mode?: string): Promise<void> {
  const commits = await getStackCommitsWithTrailers();

  if (commits.length === 0) {
    console.log("No commits in stack.");
    return;
  }

  // Check for validation errors
  const validation = parseStack(commits);

  if (validation.ok) {
    console.log("✓ No invalid groups found. Stack is valid.");
    return;
  }

  // Non-interactive dissolve mode
  if (mode === "dissolve" || !isTTY()) {
    await dissolveErrorGroup(commits, validation);
    return;
  }

  // Interactive repair mode
  switch (validation.error) {
    case "split-group":
      await repairSplitGroup(commits, validation);
      break;
    case "inconsistent-group-title":
      await repairInconsistentTitles(commits, validation);
      break;
  }
}

/**
 * Non-interactive dissolve: remove only the problematic group trailers.
 */
async function dissolveErrorGroup(
  commits: CommitWithTrailers[],
  validation: Exclude<StackParseResult, { ok: true }>,
): Promise<void> {
  // Show what's wrong
  console.log(formatValidationError(validation));
  console.log("");

  // Dissolve only the group(s) with errors
  switch (validation.error) {
    case "split-group": {
      // Remove group trailers from all commits in the split group
      console.log(`Dissolving group "${validation.group.title}"...`);
      const result = await dissolveGroup(validation.group.id);
      if (!result.success) {
        console.error(`✗ Error: ${result.error}`);
        process.exit(1);
      }
      console.log(`✓ Group "${validation.group.title}" dissolved.`);
      break;
    }

    case "inconsistent-group-title": {
      // Use the most common title
      const titleCounts = new Map<string, number>();
      for (const title of validation.titles.values()) {
        titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
      }
      let mostCommonTitle = "";
      let maxCount = 0;
      for (const [title, count] of titleCounts) {
        if (count > maxCount) {
          mostCommonTitle = title;
          maxCount = count;
        }
      }

      console.log(`Normalizing group titles to "${mostCommonTitle}"...`);

      // Update all commits with different titles
      for (const [hash, title] of validation.titles) {
        if (title !== mostCommonTitle) {
          const commit = commits.find((c) => c.hash === hash);
          if (commit) {
            const result = await updateGroupTitle(hash, title, mostCommonTitle);
            if (!result.success) {
              console.error(`✗ Error: ${result.error}`);
              process.exit(1);
            }
          }
        }
      }
      console.log("✓ Group titles normalized.");
      break;
    }
  }
}

/**
 * Format error summary for repair UI.
 */
function formatErrorSummary(validation: Exclude<StackParseResult, { ok: true }>): string {
  switch (validation.error) {
    case "split-group": {
      const commitList = validation.group.commits.map((h) => h.slice(0, 8)).join(", ");
      return `✗ Split group: "${validation.group.title}" (${validation.group.id.slice(0, 8)})\n  Commits [${commitList}] are not contiguous.\n  ${validation.interruptingCommits.length} commit(s) appear between group members.`;
    }
    case "inconsistent-group-title": {
      const titles = [...new Set(validation.titles.values())];
      return `✗ Inconsistent group titles for ${validation.groupId.slice(0, 8)}:\n  Found ${titles.length} different titles: ${titles.map((t) => `"${t}"`).join(", ")}`;
    }
  }
}

type SplitGroupValidation = {
  ok: false;
  error: "split-group";
  group: { id: string; title: string; commits: string[] };
  interruptingCommits: string[];
};

type InconsistentGroupTitleValidation = {
  ok: false;
  error: "inconsistent-group-title";
  groupId: string;
  titles: Map<string, string>;
};

/**
 * Repair a split group interactively.
 */
async function repairSplitGroup(
  _commits: CommitWithTrailers[],
  validation: SplitGroupValidation,
): Promise<void> {
  const errorSummary = formatErrorSummary(validation);

  type RepairAction = "merge" | "dissolve-group" | "dissolve-all";

  const options: Array<{ label: string; value: RepairAction; description: string }> = [
    {
      label: "Merge group commits",
      value: "merge",
      description: "Reorder commits to make the group contiguous again",
    },
    {
      label: "Dissolve this group",
      value: "dissolve-group",
      description: `Remove group trailers from "${validation.group.title}"`,
    },
    {
      label: "Dissolve all groups",
      value: "dissolve-all",
      description: "Remove ALL group trailers from the stack",
    },
  ];

  const result = await repairSelect(options, "Select repair action:", errorSummary);

  if (result.cancelled || !result.selected) {
    console.log("Repair cancelled.");
    return;
  }

  switch (result.selected) {
    case "merge": {
      console.log(`Reordering commits to merge group "${validation.group.title}"...`);
      const mergeResult = await mergeSplitGroup(validation.group.id);

      if (!mergeResult.success) {
        console.error(`✗ Error: ${mergeResult.error}`);
        if (mergeResult.conflictFile) {
          console.error(`  Conflict in: ${mergeResult.conflictFile}`);
        }
        process.exit(1);
      }

      console.log("✓ Group commits merged successfully.");
      break;
    }

    case "dissolve-group": {
      console.log(`Dissolving group "${validation.group.title}"...`);
      const dissolveResult = await dissolveGroup(validation.group.id);

      if (!dissolveResult.success) {
        console.error(`✗ Error: ${dissolveResult.error}`);
        process.exit(1);
      }

      console.log(`✓ Group "${validation.group.title}" dissolved.`);
      break;
    }

    case "dissolve-all": {
      console.log("Removing all group trailers...");
      const dissolveResult = await removeAllGroupTrailers();

      if (!dissolveResult.success) {
        console.error(`✗ Error: ${dissolveResult.error}`);
        process.exit(1);
      }

      console.log("✓ All group trailers removed.");
      break;
    }
  }
}

/**
 * Prompt for group title using readline.
 */
async function promptGroupTitle(defaultTitle: string, titles: string[]): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("\nExisting titles:");
    titles.forEach((t, i) => console.log(`  ${i + 1}. "${t}"`));
    console.log("");

    rl.question(`Enter title (or number to select) [${defaultTitle}]: `, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed) {
        resolve(defaultTitle);
        return;
      }
      // Check if it's a number selecting an existing title
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= titles.length) {
        resolve(titles[num - 1] || defaultTitle);
        return;
      }
      resolve(trimmed);
    });
  });
}

/**
 * Repair inconsistent group titles interactively.
 */
async function repairInconsistentTitles(
  commits: CommitWithTrailers[],
  validation: InconsistentGroupTitleValidation,
): Promise<void> {
  const errorSummary = formatErrorSummary(validation);

  type RepairAction = "normalize" | "dissolve-group" | "dissolve-all";

  const options: Array<{ label: string; value: RepairAction; description: string }> = [
    {
      label: "Normalize titles",
      value: "normalize",
      description: "Choose one title to apply to all commits in the group",
    },
    {
      label: "Dissolve this group",
      value: "dissolve-group",
      description: "Remove group trailers from all commits with this group ID",
    },
    {
      label: "Dissolve all groups",
      value: "dissolve-all",
      description: "Remove ALL group trailers from the stack",
    },
  ];

  const result = await repairSelect(options, "Select repair action:", errorSummary);

  if (result.cancelled || !result.selected) {
    console.log("Repair cancelled.");
    return;
  }

  switch (result.selected) {
    case "normalize": {
      // Get unique titles
      const uniqueTitles = [...new Set(validation.titles.values())];

      // Find the most common title as default
      const titleCounts = new Map<string, number>();
      for (const title of validation.titles.values()) {
        titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
      }
      let mostCommonTitle = uniqueTitles[0] || "";
      let maxCount = 0;
      for (const [title, count] of titleCounts) {
        if (count > maxCount) {
          mostCommonTitle = title;
          maxCount = count;
        }
      }

      // Prompt user for the title to use
      const chosenTitle = await promptGroupTitle(mostCommonTitle, uniqueTitles);

      console.log(`Normalizing all titles to "${chosenTitle}"...`);

      // Update all commits with different titles
      for (const [hash, title] of validation.titles) {
        if (title !== chosenTitle) {
          const commit = commits.find((c) => c.hash === hash);
          if (commit) {
            const updateResult = await updateGroupTitle(hash, title, chosenTitle);
            if (!updateResult.success) {
              console.error(`✗ Error updating ${hash.slice(0, 8)}: ${updateResult.error}`);
              process.exit(1);
            }
          }
        }
      }

      console.log("✓ Group titles normalized.");
      break;
    }

    case "dissolve-group": {
      console.log(`Dissolving group ${validation.groupId.slice(0, 8)}...`);
      const dissolveResult = await dissolveGroup(validation.groupId);

      if (!dissolveResult.success) {
        console.error(`✗ Error: ${dissolveResult.error}`);
        process.exit(1);
      }

      console.log("✓ Group dissolved.");
      break;
    }

    case "dissolve-all": {
      console.log("Removing all group trailers...");
      const dissolveResult = await removeAllGroupTrailers();

      if (!dissolveResult.success) {
        console.error(`✗ Error: ${dissolveResult.error}`);
        process.exit(1);
      }

      console.log("✓ All group trailers removed.");
      break;
    }
  }
}
