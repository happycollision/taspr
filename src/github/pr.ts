import { $ } from "bun";
import { ensureGhInstalled } from "./api.ts";

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

  const result = await $`gh pr list --head ${branchName} --json number,url,state,title`.nothrow();

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

  if (options.body) {
    args.push("--body", options.body);
  } else {
    args.push("--body", "");
  }

  // Add --json to get structured output
  args.push("--json", "number,url");

  const result = await $`${args}`;
  const output = JSON.parse(result.stdout.toString());

  return {
    number: output.number,
    url: output.url,
  };
}
