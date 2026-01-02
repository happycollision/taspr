import { runGroupEditor } from "../../tui/group-editor.ts";
import { dissolveGroup, applyGroupSpec, parseGroupSpec } from "../../git/group-rebase.ts";
import { getStackCommitsWithTrailers } from "../../git/commands.ts";
import { parseStack } from "../../core/stack.ts";
import { formatValidationError } from "../output.ts";

export interface GroupCommandOptions {
  apply?: string;
}

/**
 * Main group command - launches the TUI editor or applies a spec.
 */
export async function groupCommand(options: GroupCommandOptions = {}): Promise<void> {
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
  const groups = units.filter((u) => u.type === "group");

  if (groups.length === 0) {
    console.log("No groups in the current stack.");
    return;
  }

  // If no groupId provided, list available groups
  if (!groupId) {
    console.log("Available groups:");
    for (const group of groups) {
      console.log(`  ${group.id}: "${group.title}" (${group.commits.length} commits)`);
    }
    console.log("");
    console.log("Usage: taspr group dissolve <group-id>");
    return;
  }

  // Find the group to dissolve
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

  console.log(`Dissolving group "${targetGroup.title}" (${targetGroup.id})...`);

  const result = await dissolveGroup(targetGroup.id);

  if (!result.success) {
    console.log(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log("✓ Group dissolved. Commits are now individual PRUnits.");
}
