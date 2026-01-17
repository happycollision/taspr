import { $ } from "bun";
import type { GitOptions } from "./commands.ts";
import { getDefaultBranchRef, getSpryConfig } from "./config.ts";

/**
 * Check if the stack is behind the default branch on the remote.
 * Returns true if there are commits on remote/defaultBranch that aren't in the current branch.
 */
export async function isStackBehindMain(options: GitOptions = {}): Promise<boolean> {
  const { cwd } = options;
  const config = await getSpryConfig();
  const defaultBranchRef = await getDefaultBranchRef();

  // Fetch latest from remote
  const fetchCmd = cwd
    ? $`git -C ${cwd} fetch ${config.remote}`.quiet().nothrow()
    : $`git fetch ${config.remote}`.quiet().nothrow();
  await fetchCmd;

  // Count commits that are on origin/main but not on HEAD
  const result = cwd
    ? await $`git -C ${cwd} rev-list HEAD..${defaultBranchRef} --count`.text()
    : await $`git rev-list HEAD..${defaultBranchRef} --count`.text();

  return parseInt(result.trim(), 10) > 0;
}

/**
 * Get the number of commits the stack is behind the remote default branch.
 * Does NOT fetch - call isStackBehindMain() first if you need fresh data.
 */
export async function getCommitsBehind(options: GitOptions = {}): Promise<number> {
  const { cwd } = options;
  const defaultBranchRef = await getDefaultBranchRef();

  const result = cwd
    ? await $`git -C ${cwd} rev-list HEAD..${defaultBranchRef} --count`.text()
    : await $`git rev-list HEAD..${defaultBranchRef} --count`.text();

  return parseInt(result.trim(), 10);
}
