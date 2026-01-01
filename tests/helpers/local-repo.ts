/**
 * Composable test primitives for taspr integration tests.
 *
 * Instead of a rigid fluent builder, these are small helpers that
 * can be mixed and matched as needed.
 */

import { $ } from "bun";
import { beforeAll, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createGitHubFixture, type GitHubFixture } from "./github-fixture.ts";
import { generateUniqueId } from "./unique-id.ts";

/** Mutable container for the current test's unique ID */
interface TestContext {
  uniqueId: string;
}

/**
 * A local git clone with helper methods.
 */
export interface LocalRepo {
  path: string;
  github: GitHubFixture;
  /** Unique identifier for this test - useful for finding PRs */
  readonly uniqueId: string;

  /** Create a commit with auto-generated file */
  commit(message: string): Promise<string>;

  /** Create a commit with specific files */
  commitFiles(message: string, files: Record<string, string>): Promise<string>;

  /** Create a new branch and switch to it. Automatically made unique. */
  branch(name: string): Promise<string>;

  /** Checkout existing branch */
  checkout(name: string): Promise<void>;

  /** Fetch from origin */
  fetch(): Promise<void>;

  /** Find PR by title substring */
  findPR(titleSubstring: string): Promise<{ number: number; title: string; headRefName: string }>;

  /** Find all PRs matching title */
  findPRs(
    titleSubstring: string,
  ): Promise<Array<{ number: number; title: string; headRefName: string }>>;

  /** Wait for branch to be deleted (handles GitHub eventual consistency) */
  waitForBranchGone(branchName: string, timeoutMs?: number): Promise<boolean>;

  /** Get current branch name */
  currentBranch(): Promise<string>;

  /** Clean up the repo */
  cleanup(): Promise<void>;
}

/**
 * Clone a GitHub repo and return a LocalRepo with helpers.
 */
async function cloneRepo(github: GitHubFixture, ctx: TestContext): Promise<LocalRepo> {
  const tmpResult = await $`mktemp -d`.text();
  const path = tmpResult.trim();

  await $`git clone ${github.repoUrl}.git ${path}`.quiet();
  await $`git -C ${path} config user.email "test@example.com"`.quiet();
  await $`git -C ${path} config user.name "Test User"`.quiet();

  let fileCounter = 0;

  async function findPRsImpl(
    titleSubstring: string,
  ): Promise<Array<{ number: number; title: string; headRefName: string }>> {
    const prList =
      await $`gh pr list --repo ${github.owner}/${github.repo} --state all --json number,title,headRefName`.text();
    const prs = JSON.parse(prList) as Array<{
      number: number;
      title: string;
      headRefName: string;
    }>;
    return prs.filter((p) => p.title.includes(titleSubstring));
  }

  return {
    path,
    github,
    // Getter so it always returns the current value from context
    get uniqueId() {
      return ctx.uniqueId;
    },

    async commit(message: string): Promise<string> {
      const filename = `file-${ctx.uniqueId}-${fileCounter++}.txt`;
      // Append uniqueId to commit message for easy PR discovery
      const fullMessage = `${message} [${ctx.uniqueId}]`;
      await Bun.write(join(path, filename), `Content for: ${message}\n`);
      await $`git -C ${path} add .`.quiet();
      await $`git -C ${path} commit -m ${fullMessage}`.quiet();
      return (await $`git -C ${path} rev-parse HEAD`.text()).trim();
    },

    async commitFiles(message: string, files: Record<string, string>): Promise<string> {
      for (const [filename, content] of Object.entries(files)) {
        await Bun.write(join(path, filename), content);
      }
      // Append uniqueId to commit message for easy PR discovery
      const fullMessage = `${message} [${ctx.uniqueId}]`;
      await $`git -C ${path} add .`.quiet();
      await $`git -C ${path} commit -m ${fullMessage}`.quiet();
      return (await $`git -C ${path} rev-parse HEAD`.text()).trim();
    },

    async branch(name: string): Promise<string> {
      const branchName = `${name}-${ctx.uniqueId}`;
      await $`git -C ${path} checkout -b ${branchName}`.quiet();
      return branchName;
    },

    async checkout(name: string): Promise<void> {
      await $`git -C ${path} checkout ${name}`.quiet();
    },

    async fetch(): Promise<void> {
      await $`git -C ${path} fetch origin`.quiet();
    },

    async findPR(
      titleSubstring: string,
    ): Promise<{ number: number; title: string; headRefName: string }> {
      const prs = await findPRsImpl(titleSubstring);
      const pr = prs[0];
      if (!pr) {
        throw new Error(`PR not found with title containing: ${titleSubstring}`);
      }
      return pr;
    },

    async findPRs(
      titleSubstring: string,
    ): Promise<Array<{ number: number; title: string; headRefName: string }>> {
      return findPRsImpl(titleSubstring);
    },

    async waitForBranchGone(branchName: string, timeoutMs = 5000): Promise<boolean> {
      const pollInterval = 500;
      const maxAttempts = Math.ceil(timeoutMs / pollInterval);

      for (let i = 0; i < maxAttempts; i++) {
        await Bun.sleep(pollInterval);
        const check =
          await $`gh api repos/${github.owner}/${github.repo}/branches/${branchName}`.nothrow();
        if (check.exitCode !== 0) {
          return true;
        }
      }
      return false;
    },

    async currentBranch(): Promise<string> {
      return (await $`git -C ${path} rev-parse --abbrev-ref HEAD`.text()).trim();
    },

    async cleanup(): Promise<void> {
      await rm(path, { recursive: true, force: true });
    },
  };
}

export interface RepoManagerOptions {
  /** Set up GitHub fixture with beforeAll/beforeEach/afterEach hooks */
  github?: boolean;
}

export interface RepoManager {
  /** Clone a repo (uses internal github fixture if github option was set) */
  clone(github?: GitHubFixture): Promise<LocalRepo>;
  /** Clean up all repos */
  cleanup(): Promise<void>;
  /** The GitHub fixture (only available if github option was set) */
  github: GitHubFixture | null;
  /** Current test's unique ID (e.g., "happy-penguin-x3f") - regenerated each test */
  uniqueId: string;
}

/**
 * Manages multiple repos with automatic cleanup.
 *
 * Usage (simple):
 *   const repos = repoManager();
 *   afterEach(() => repos.cleanup());
 *
 *   test("...", async () => {
 *     const repo = await repos.clone(github);
 *     // ...
 *   });
 *
 * Usage (with github fixture auto-setup):
 *   const repos = repoManager({ github: true });
 *   // beforeAll, beforeEach, afterEach are called automatically
 *
 *   test("...", async () => {
 *     const repo = await repos.clone();
 *     // repos.github is available
 *     // repos.uniqueId is "happy-penguin-x3f" or similar
 *   });
 */
export function repoManager(options?: RepoManagerOptions): RepoManager {
  const activeRepos: LocalRepo[] = [];
  let githubFixture: GitHubFixture | null = null;
  const ctx: TestContext = { uniqueId: generateUniqueId() };

  if (options?.github) {
    beforeAll(async () => {
      githubFixture = await createGitHubFixture();
    });

    beforeEach(async () => {
      // Generate fresh unique ID for each test
      ctx.uniqueId = generateUniqueId();
      await githubFixture?.reset();
    });

    afterEach(async () => {
      await githubFixture?.reset();
      for (const repo of activeRepos) {
        await repo.cleanup();
      }
      activeRepos.length = 0;
    });
  }

  return {
    async clone(github?: GitHubFixture): Promise<LocalRepo> {
      const fixture = github ?? githubFixture;
      if (!fixture) {
        throw new Error(
          "No GitHub fixture available. Either pass one to clone() or use repoManager({ github: true })",
        );
      }
      const repo = await cloneRepo(fixture, ctx);
      activeRepos.push(repo);
      return repo;
    },

    async cleanup(): Promise<void> {
      for (const repo of activeRepos) {
        await repo.cleanup();
      }
      activeRepos.length = 0;
    },

    get github(): GitHubFixture | null {
      return githubFixture;
    },

    get uniqueId(): string {
      return ctx.uniqueId;
    },
  };
}
