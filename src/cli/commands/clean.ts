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
}

interface OrphanedBranch {
  name: string;
  reason: string;
}

/**
 * List all remote branches matching our taspr pattern.
 * Pattern: <prefix>/<username>/*
 */
async function listTasprBranches(
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
 * Find orphaned taspr branches that have been merged to the default branch.
 */
async function findOrphanedBranches(
  branchConfig: Awaited<ReturnType<typeof getBranchNameConfig>>,
  defaultBranch: string,
): Promise<OrphanedBranch[]> {
  // Fetch latest from origin first
  await $`git fetch origin`.quiet().nothrow();

  const branches = await listTasprBranches(branchConfig);
  const orphaned: OrphanedBranch[] = [];

  for (const branch of branches) {
    const sha = await getBranchHeadSha(branch);
    if (!sha) continue;

    const merged = await isCommitMerged(sha, defaultBranch);
    if (merged) {
      orphaned.push({
        name: branch,
        reason: `merged to ${defaultBranch}`,
      });
    }
  }

  return orphaned;
}

export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  try {
    const branchConfig = await getBranchNameConfig();
    const defaultBranch = await getDefaultBranch();

    console.log("Scanning for orphaned branches...\n");

    const orphaned = await findOrphanedBranches(branchConfig, defaultBranch);

    if (orphaned.length === 0) {
      console.log("✓ No orphaned branches found");
      return;
    }

    if (options.dryRun) {
      console.log(`Found ${orphaned.length} orphaned branch(es):`);
      for (const branch of orphaned) {
        console.log(`  ${branch.name} (${branch.reason})`);
      }
      console.log("\nRun without --dry-run to delete these branches.");
      return;
    }

    // Delete orphaned branches
    let deleted = 0;
    const errors: string[] = [];

    for (const branch of orphaned) {
      try {
        await deleteRemoteBranch(branch.name);
        deleted++;
      } catch (err) {
        errors.push(`  ${branch.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (deleted > 0) {
      console.log(`✓ Deleted ${deleted} orphaned branch(es):`);
      for (const branch of orphaned.slice(0, deleted)) {
        console.log(`  ${branch.name}`);
      }
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
