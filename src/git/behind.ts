import { $ } from "bun";
import type { GitOptions } from "./commands.ts";
import { getDefaultBranchRef } from "./config.ts";

/**
 * Check if the stack is behind origin/main.
 * Returns true if there are commits on origin/main that aren't in the current branch.
 */
export async function isStackBehindMain(options: GitOptions = {}): Promise<boolean> {
  const { cwd } = options;
  const defaultBranchRef = await getDefaultBranchRef();

  // Fetch latest from origin
  const fetchCmd = cwd
    ? $`git -C ${cwd} fetch origin`.quiet().nothrow()
    : $`git fetch origin`.quiet().nothrow();
  await fetchCmd;

  // Count commits that are on origin/main but not on HEAD
  const result = cwd
    ? await $`git -C ${cwd} rev-list HEAD..${defaultBranchRef} --count`.text()
    : await $`git rev-list HEAD..${defaultBranchRef} --count`.text();

  return parseInt(result.trim(), 10) > 0;
}

/**
 * Get the number of commits the stack is behind origin/main.
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
