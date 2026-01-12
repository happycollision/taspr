import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import { repoManager } from "../../tests/helpers/local-repo.ts";
import {
  getStackCommits,
  getMergeBase,
  getCurrentBranch,
  isDetachedHead,
  assertNotDetachedHead,
  hasUncommittedChanges,
} from "./commands.ts";
import { join } from "node:path";

const repos = repoManager();

describe("git/commands", () => {
  describe("getMergeBase", () => {
    test("returns merge-base with origin/main", async () => {
      const repo = await repos.create();

      const mergeBase = await getMergeBase({ cwd: repo.path });
      expect(mergeBase).toMatch(/^[a-f0-9]{40}$/);
    });
  });

  describe("getCurrentBranch", () => {
    test("returns current branch name", async () => {
      const repo = await repos.create();

      const branch = await getCurrentBranch({ cwd: repo.path });
      expect(branch).toBe("main");
    });

    test("returns 'HEAD' in detached HEAD state", async () => {
      const repo = await repos.create();

      // Create a commit and then checkout the commit hash (detached HEAD)
      await repo.branch("feature");
      await repo.commit();
      const headSha = (await $`git -C ${repo.path} rev-parse HEAD`.text()).trim();
      await $`git -C ${repo.path} checkout ${headSha}`.quiet();

      const branch = await getCurrentBranch({ cwd: repo.path });
      expect(branch).toBe("HEAD");
    });
  });

  describe("isDetachedHead", () => {
    test("returns false when on a branch", async () => {
      const repo = await repos.create();

      const detached = await isDetachedHead({ cwd: repo.path });
      expect(detached).toBe(false);
    });

    test("returns true in detached HEAD state", async () => {
      const repo = await repos.create();

      // Checkout a specific commit (detached HEAD)
      const headSha = (await $`git -C ${repo.path} rev-parse HEAD`.text()).trim();
      await $`git -C ${repo.path} checkout ${headSha}`.quiet();

      const detached = await isDetachedHead({ cwd: repo.path });
      expect(detached).toBe(true);
    });
  });

  describe("assertNotDetachedHead", () => {
    test("does not throw when on a branch", async () => {
      const repo = await repos.create();

      expect(assertNotDetachedHead({ cwd: repo.path })).resolves.toBeUndefined();
    });

    test("throws with helpful message in detached HEAD state", async () => {
      const repo = await repos.create();

      // Checkout a specific commit (detached HEAD)
      const headSha = (await $`git -C ${repo.path} rev-parse HEAD`.text()).trim();
      await $`git -C ${repo.path} checkout ${headSha}`.quiet();

      expect(assertNotDetachedHead({ cwd: repo.path })).rejects.toThrow(
        /Cannot perform this operation in detached HEAD state/,
      );
    });

    test("error message includes remediation steps", async () => {
      const repo = await repos.create();

      const headSha = (await $`git -C ${repo.path} rev-parse HEAD`.text()).trim();
      await $`git -C ${repo.path} checkout ${headSha}`.quiet();

      try {
        await assertNotDetachedHead({ cwd: repo.path });
        expect.unreachable("should have thrown");
      } catch (e) {
        const error = e as Error;
        expect(error.message).toContain("git checkout <branch-name>");
        expect(error.message).toContain("git checkout -b <new-branch-name>");
      }
    });
  });

  describe("getStackCommits", () => {
    test("returns empty array when no commits ahead of main", async () => {
      const repo = await repos.create();

      const commits = await getStackCommits({ cwd: repo.path });
      expect(commits).toEqual([]);
    });

    test("returns commits in oldest-to-newest order", async () => {
      const repo = await repos.create();

      await repo.branch("feature");
      await repo.commit();
      await repo.commit();
      await repo.commit();

      const commits = await getStackCommits({ cwd: repo.path });

      expect(commits).toHaveLength(3);

      // Each commit should have a valid hash
      for (const commit of commits) {
        expect(commit.hash).toMatch(/^[a-f0-9]{40}$/);
      }
    });

    test("correctly parses commit body with trailers", async () => {
      const repo = await repos.create();

      await repo.branch("feature");
      await repo.commit({
        trailers: {
          "Spry-Commit-Id": "a1b2c3d4",
          "Co-authored-by": "Someone <someone@example.com>",
        },
      });

      const commits = await getStackCommits({ cwd: repo.path });

      expect(commits).toHaveLength(1);
      const [commit] = commits;
      expect(commit?.body).toContain("Spry-Commit-Id: a1b2c3d4");
    });

    test("handles commits with special characters in subject", async () => {
      const repo = await repos.create();

      await repo.branch("feature");

      // Create commit directly since repo.commit doesn't support special chars in message
      await Bun.write(join(repo.path, "special.ts"), "// special");
      await $`git -C ${repo.path} add special.ts`.quiet();
      await $`git -C ${repo.path} commit -m "fix: handle \"quoted\" strings & <special> chars"`.quiet();

      const commits = await getStackCommits({ cwd: repo.path });

      expect(commits).toHaveLength(1);
      const [commit] = commits;
      expect(commit?.subject).toBe('fix: handle "quoted" strings & <special> chars');
    });
  });

  describe("hasUncommittedChanges", () => {
    test("returns false when working tree is clean", async () => {
      const repo = await repos.create();

      const hasChanges = await hasUncommittedChanges({ cwd: repo.path });
      expect(hasChanges).toBe(false);
    });

    test("returns true when there are uncommitted changes", async () => {
      const repo = await repos.create();

      await Bun.write(join(repo.path, "uncommitted.ts"), "// uncommitted");

      const hasChanges = await hasUncommittedChanges({ cwd: repo.path });
      expect(hasChanges).toBe(true);
    });
  });
});
