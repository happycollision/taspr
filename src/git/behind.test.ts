import { test, expect, afterEach, describe } from "bun:test";
import { $ } from "bun";
import { join } from "node:path";
import { createGitFixture, type GitFixture } from "../../tests/helpers/git-fixture.ts";
import { isStackBehindMain, getCommitsBehind } from "./behind.ts";

let fixture: GitFixture | null = null;

afterEach(async () => {
  if (fixture) {
    await fixture.cleanup();
    fixture = null;
  }
});

describe("git/behind", () => {
  describe("isStackBehindMain", () => {
    test("returns false when stack is up to date", async () => {
      fixture = await createGitFixture();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit");

      const result = await isStackBehindMain({ cwd: fixture.path });
      expect(result).toBe(false);
    });

    test("returns true when origin/main has new commits", async () => {
      fixture = await createGitFixture();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit");

      // Push a commit directly to origin/main (simulating another developer's work)
      // First, clone origin to a temp location and push from there
      await $`git -C ${fixture.originPath} config receive.denyCurrentBranch ignore`.quiet();

      // Create a commit directly in the bare repo by:
      // 1. Create a temporary worktree
      // 2. Make a commit there
      // 3. Push to main
      const tempWorktree = `${fixture.originPath}-worktree`;
      await $`git clone ${fixture.originPath} ${tempWorktree}`.quiet();
      await $`git -C ${tempWorktree} config user.email "other@example.com"`.quiet();
      await $`git -C ${tempWorktree} config user.name "Other User"`.quiet();
      await Bun.write(join(tempWorktree, "other-file.txt"), "Other content\n");
      await $`git -C ${tempWorktree} add .`.quiet();
      await $`git -C ${tempWorktree} commit -m "Commit from main"`.quiet();
      await $`git -C ${tempWorktree} push origin main`.quiet();

      // Clean up temp worktree
      await $`rm -rf ${tempWorktree}`.quiet();

      const result = await isStackBehindMain({ cwd: fixture.path });
      expect(result).toBe(true);
    });

    test("returns false when stack is ahead but not behind", async () => {
      fixture = await createGitFixture();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit 1");
      await fixture.commit("Feature commit 2");

      // Stack is ahead of main but not behind
      const result = await isStackBehindMain({ cwd: fixture.path });
      expect(result).toBe(false);
    });
  });

  describe("getCommitsBehind", () => {
    test("returns 0 when stack is up to date", async () => {
      fixture = await createGitFixture();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit");

      // Fetch first to ensure we have the latest
      await $`git -C ${fixture.path} fetch origin`.quiet();

      const count = await getCommitsBehind({ cwd: fixture.path });
      expect(count).toBe(0);
    });

    test("returns correct count when behind by N commits", async () => {
      fixture = await createGitFixture();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit");

      // Push multiple commits to origin/main
      const tempWorktree = `${fixture.originPath}-worktree`;
      await $`git clone ${fixture.originPath} ${tempWorktree}`.quiet();
      await $`git -C ${tempWorktree} config user.email "other@example.com"`.quiet();
      await $`git -C ${tempWorktree} config user.name "Other User"`.quiet();

      // Make 3 commits
      for (let i = 1; i <= 3; i++) {
        await Bun.write(join(tempWorktree, `file-${i}.txt`), `Content ${i}\n`);
        await $`git -C ${tempWorktree} add .`.quiet();
        await $`git -C ${tempWorktree} commit -m "Main commit ${i}"`.quiet();
      }
      await $`git -C ${tempWorktree} push origin main`.quiet();
      await $`rm -rf ${tempWorktree}`.quiet();

      // Fetch to get the new commits
      await $`git -C ${fixture.path} fetch origin`.quiet();

      const count = await getCommitsBehind({ cwd: fixture.path });
      expect(count).toBe(3);
    });

    test("returns correct count when diverged (both ahead and behind)", async () => {
      fixture = await createGitFixture();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit 1");
      await fixture.commit("Feature commit 2");

      // Push commits to origin/main (creating divergence)
      const tempWorktree = `${fixture.originPath}-worktree`;
      await $`git clone ${fixture.originPath} ${tempWorktree}`.quiet();
      await $`git -C ${tempWorktree} config user.email "other@example.com"`.quiet();
      await $`git -C ${tempWorktree} config user.name "Other User"`.quiet();

      await Bun.write(join(tempWorktree, "diverge.txt"), "Divergent content\n");
      await $`git -C ${tempWorktree} add .`.quiet();
      await $`git -C ${tempWorktree} commit -m "Divergent commit"`.quiet();
      await $`git -C ${tempWorktree} push origin main`.quiet();
      await $`rm -rf ${tempWorktree}`.quiet();

      // Fetch to get the divergent commit
      await $`git -C ${fixture.path} fetch origin`.quiet();

      // Stack is 2 ahead, 1 behind
      const count = await getCommitsBehind({ cwd: fixture.path });
      expect(count).toBe(1);
    });
  });
});
