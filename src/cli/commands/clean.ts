import { $ } from "bun";
import { getBranchNameConfig } from "../../github/branches.ts";
import {
  getDefaultBranch,
  DependencyError,
  GitHubAuthError,
  ConfigurationError,
} from "../../github/api.ts";
import { deleteRemoteBranch } from "../../github/pr.ts";

export interface CleanOptions {
  dryRun?: boolean;
  force?: boolean;
  unsafe?: boolean;
}

type OrphanedReason = "sha-merged" | "commit-id-landed";

interface OrphanedBranch {
  name: string;
  reason: OrphanedReason;
  displayReason: string;
}

/**
 * List all remote branches matching our spry pattern.
 * Pattern: <prefix>/<username>/*
 */
async function listSpryBranches(
  branchConfig: Awaited<ReturnType<typeof getBranchNameConfig>>,
): Promise<string[]> {
  const result =
    await $`git branch -r --list "origin/${branchConfig.prefix}/${branchConfig.username}/*"`
      .quiet()
      .nothrow();

  if (result.exitCode !== 0 || !result.stdout.toString().trim()) {
    return [];
  }

  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b)
    .map((b) => b.replace(/^origin\//, "")); // Remove "origin/" prefix
}

/**
 * Check if a commit is reachable from the default branch (i.e., merged).
 */
async function isCommitMerged(commitSha: string, defaultBranch: string): Promise<boolean> {
  const result = await $`git merge-base --is-ancestor ${commitSha} origin/${defaultBranch}`
    .quiet()
    .nothrow();
  return result.exitCode === 0;
}

/**
 * Check if a Spry-Commit-Id exists in the default branch.
 * This handles the case where a commit was modified (e.g., squash merge, amended)
 * but the trailer was preserved.
 */
async function isCommitIdInDefaultBranch(
  commitId: string,
  defaultBranch: string,
): Promise<boolean> {
  const pattern = `Spry-Commit-Id: ${commitId}`;
  const result = await $`git log --grep=${pattern} --oneline origin/${defaultBranch} -1`
    .quiet()
    .nothrow();
  return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
}

/**
 * Extract the commit ID from a spry branch name.
 * Branch format: <prefix>/<username>/<commit-id>
 */
function extractCommitIdFromBranch(branchName: string): string | null {
  const parts = branchName.split("/");
  return parts.length >= 3 ? (parts[parts.length - 1] ?? null) : null;
}

/**
 * Get the HEAD commit SHA of a remote branch.
 */
async function getBranchHeadSha(branchName: string): Promise<string | null> {
  const result = await $`git rev-parse origin/${branchName}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.toString().trim();
}

/**
 * Find orphaned spry branches that have been merged to the default branch.
 * Detects both:
 * 1. Branches whose exact commit SHA is reachable from main (fast-forward merge)
 * 2. Branches whose Spry-Commit-Id trailer exists in main (squash/amended merge)
 */
async function findOrphanedBranches(
  branchConfig: Awaited<ReturnType<typeof getBranchNameConfig>>,
  defaultBranch: string,
): Promise<OrphanedBranch[]> {
  // Fetch latest from origin first
  await $`git fetch origin`.quiet().nothrow();

  const branches = await listSpryBranches(branchConfig);
  const orphaned: OrphanedBranch[] = [];

  for (const branch of branches) {
    const sha = await getBranchHeadSha(branch);
    if (!sha) continue;

    // First check: is the exact commit SHA merged?
    const shaMerged = await isCommitMerged(sha, defaultBranch);
    if (shaMerged) {
      orphaned.push({
        name: branch,
        reason: "sha-merged",
        displayReason: `merged to ${defaultBranch}`,
      });
      continue;
    }

    // Second check: does the commit-id trailer exist in main?
    // This handles squash merges, amended commits, etc.
    const commitId = extractCommitIdFromBranch(branch);
    if (commitId) {
      const trailerFound = await isCommitIdInDefaultBranch(commitId, defaultBranch);
      if (trailerFound) {
        orphaned.push({
          name: branch,
          reason: "commit-id-landed",
          displayReason: `commit-id landed in ${defaultBranch} (original content may differ)`,
        });
      }
    }
  }

  return orphaned;
}

export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  try {
    // Validate flag combinations
    if (options.force && options.dryRun) {
      console.error("✗ Cannot use --force with --dry-run");
      process.exit(1);
    }

    const branchConfig = await getBranchNameConfig();
    const defaultBranch = await getDefaultBranch();

    // --unsafe implies --dry-run unless --force is also specified
    const isDryRun = options.dryRun || (options.unsafe && !options.force);
    const includeUnsafe = options.unsafe;

    console.log("Scanning for orphaned branches...\n");

    const orphaned = await findOrphanedBranches(branchConfig, defaultBranch);

    // Separate safe (SHA-merged) from unsafe (commit-id only) branches
    const safeBranches = orphaned.filter((b) => b.reason === "sha-merged");
    const unsafeBranches = orphaned.filter((b) => b.reason === "commit-id-landed");

    // Handle --force without --unsafe: nothing extra to force
    if (
      options.force &&
      !options.unsafe &&
      safeBranches.length === 0 &&
      unsafeBranches.length > 0
    ) {
      console.log("✓ No merged branches found");
      console.log(`\n💡 Found ${unsafeBranches.length} branch(es) matched by commit-id only.`);
      console.log("   Use --unsafe --force to delete these (original content may differ).");
      return;
    }

    if (options.force && !options.unsafe && unsafeBranches.length === 0) {
      if (safeBranches.length === 0) {
        console.log("✓ No orphaned branches found (nothing to force)");
      }
      // If there are safe branches but no unsafe ones, --force has no effect
      // Continue to delete safe branches normally
    }

    if (safeBranches.length === 0 && (!includeUnsafe || unsafeBranches.length === 0)) {
      console.log("✓ No orphaned branches found");
      return;
    }

    if (isDryRun) {
      // Dry run: just list what would be deleted
      if (safeBranches.length > 0) {
        console.log(`Found ${safeBranches.length} merged branch(es):`);
        for (const branch of safeBranches) {
          console.log(`  ${branch.name} (${branch.displayReason})`);
        }
      }

      if (includeUnsafe && unsafeBranches.length > 0) {
        if (safeBranches.length > 0) console.log("");
        console.log(`Found ${unsafeBranches.length} branch(es) matched by commit-id (unsafe):`);
        for (const branch of unsafeBranches) {
          console.log(`  ${branch.name} (${branch.displayReason})`);
        }
      }

      console.log("\nRun without --dry-run to delete branches.");
      if (includeUnsafe && unsafeBranches.length > 0) {
        console.log("Use --unsafe --force to also delete branches matched by commit-id.");
      } else if (!includeUnsafe && unsafeBranches.length > 0) {
        console.log(
          `💡 ${unsafeBranches.length} additional branch(es) found by commit-id. Use --unsafe to include them.`,
        );
      }
      return;
    }

    // Delete branches
    let deleted = 0;
    const errors: string[] = [];

    // Always delete safe branches
    for (const branch of safeBranches) {
      try {
        await deleteRemoteBranch(branch.name);
        deleted++;
        console.log(`✓ Deleted ${branch.name}`);
      } catch (err) {
        errors.push(`  ${branch.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Delete unsafe branches only if --unsafe --force
    if (includeUnsafe && options.force) {
      for (const branch of unsafeBranches) {
        try {
          await deleteRemoteBranch(branch.name);
          deleted++;
          console.log(`✓ Deleted ${branch.name} (unsafe)`);
        } catch (err) {
          errors.push(`  ${branch.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Summary
    console.log("");
    if (deleted > 0) {
      console.log(`✓ Deleted ${deleted} orphaned branch(es)`);
    }

    if (!includeUnsafe && unsafeBranches.length > 0) {
      console.log(
        `\n💡 ${unsafeBranches.length} additional branch(es) found by commit-id. Use --unsafe --force to delete them.`,
      );
    }

    if (errors.length > 0) {
      console.log(`\n⚠ Failed to delete ${errors.length} branch(es):`);
      for (const err of errors) {
        console.log(err);
      }
    }
  } catch (error) {
    if (error instanceof DependencyError) {
      console.error(`✗ Missing dependency:\n${error.message}`);
      process.exit(1);
    }

    if (error instanceof GitHubAuthError) {
      console.error(`✗ GitHub authentication error:\n${error.message}`);
      process.exit(1);
    }

    if (error instanceof ConfigurationError) {
      console.error(`✗ Configuration error:\n${error.message}`);
      process.exit(1);
    }

    if (error instanceof Error) {
      console.error(`✗ Error: ${error.message}`);
    } else {
      console.error("✗ An unexpected error occurred");
    }
    process.exit(1);
  }
}
