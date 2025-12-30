import { $ } from "bun";
import { ensureGhInstalled } from "./api.ts";

export interface LandResult {
  sha: string;
  prClosed: boolean;
}

export class PRNotFastForwardError extends Error {
  constructor(
    public prNumber: number,
    public reason: string,
  ) {
    super(`PR #${prNumber} cannot be fast-forwarded: ${reason}`);
    this.name = "PRNotFastForwardError";
  }
}

export class PRNotFoundError extends Error {
  constructor(public prNumber: number) {
    super(`PR #${prNumber} not found`);
    this.name = "PRNotFoundError";
  }
}

export interface PRInfo {
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  title: string;
}

export interface CreatePROptions {
  title: string;
  head: string;
  base: string;
  body?: string;
}

/**
 * Find an existing PR for a branch.
 * Returns null if no PR exists for the branch.
 */
export async function findPRByBranch(branchName: string): Promise<PRInfo | null> {
  await ensureGhInstalled();

  const result = await $`gh pr list --head ${branchName} --json number,url,state,title`
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    return null;
  }

  const prs = JSON.parse(result.stdout.toString()) as PRInfo[];

  if (prs.length === 0) {
    return null;
  }

  // Return first open PR, or first PR if none are open
  const openPR = prs.find((pr) => pr.state === "OPEN");
  return openPR || prs[0] || null;
}

/**
 * Create a new PR.
 */
export async function createPR(options: CreatePROptions): Promise<{ number: number; url: string }> {
  await ensureGhInstalled();

  const args = [
    "gh",
    "pr",
    "create",
    "--title",
    options.title,
    "--head",
    options.head,
    "--base",
    options.base,
  ];

  // Use --body="" syntax for empty body to avoid shell parsing issues
  if (options.body) {
    args.push("--body", options.body);
  } else {
    args.push("--body=");
  }

  const result = await $`${args}`;
  // gh pr create outputs the PR URL on success
  const url = result.stdout.toString().trim();

  // Extract PR number from URL (e.g., https://github.com/owner/repo/pull/123)
  const match = url.match(/\/pull\/(\d+)$/);
  if (!match?.[1]) {
    throw new Error(`Failed to parse PR URL: ${url}`);
  }

  return {
    number: parseInt(match[1], 10),
    url,
  };
}

/**
 * Land a PR by fast-forwarding the target branch to the PR's head commit.
 * This preserves commit hashes (no merge commits or squashing).
 *
 * The PR will be automatically closed by GitHub when the commits appear on the base branch.
 */
export async function landPR(prNumber: number, targetBranch: string = "main"): Promise<LandResult> {
  await ensureGhInstalled();

  // Get PR details
  const prResult = await $`gh pr view ${prNumber} --json headRefName,headRefOid,baseRefName,state`
    .quiet()
    .nothrow();

  if (prResult.exitCode !== 0) {
    const stderr = prResult.stderr.toString();
    if (stderr.includes("not found") || stderr.includes("Could not resolve")) {
      throw new PRNotFoundError(prNumber);
    }
    throw new Error(`Failed to get PR #${prNumber}: ${stderr}`);
  }

  const prData = JSON.parse(prResult.stdout.toString());

  if (prData.state !== "OPEN") {
    throw new PRNotFastForwardError(prNumber, `PR is ${prData.state.toLowerCase()}, not open`);
  }

  const headSha = prData.headRefOid;

  // Check if fast-forward is possible by verifying target branch is ancestor of head
  const canFF = await canFastForward(targetBranch, headSha);
  if (!canFF) {
    throw new PRNotFastForwardError(
      prNumber,
      `${targetBranch} is not an ancestor of the PR head. Rebase may be required.`,
    );
  }

  // Push the head commit to the target branch (fast-forward)
  const pushResult = await $`git push origin ${headSha}:refs/heads/${targetBranch}`
    .quiet()
    .nothrow();

  if (pushResult.exitCode !== 0) {
    const stderr = pushResult.stderr.toString();
    if (stderr.includes("non-fast-forward")) {
      throw new PRNotFastForwardError(prNumber, `${targetBranch} has diverged. Pull and retry.`);
    }
    throw new Error(`Failed to push to ${targetBranch}: ${stderr}`);
  }

  // GitHub automatically closes the PR when its commits appear on the base branch
  return { sha: headSha, prClosed: true };
}

/**
 * Check if a fast-forward merge is possible.
 * Returns true if targetBranch is an ancestor of headSha.
 */
async function canFastForward(targetBranch: string, headSha: string): Promise<boolean> {
  // Fetch latest from origin first
  await $`git fetch origin ${targetBranch}`.quiet().nothrow();

  // Check if origin/targetBranch is an ancestor of headSha
  const result = await $`git merge-base --is-ancestor origin/${targetBranch} ${headSha}`
    .quiet()
    .nothrow();

  return result.exitCode === 0;
}

/**
 * Delete a remote branch after landing.
 */
export async function deleteRemoteBranch(branchName: string): Promise<void> {
  await $`git push origin --delete ${branchName}`.quiet().nothrow();
}
