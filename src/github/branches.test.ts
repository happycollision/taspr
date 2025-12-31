import { describe, test, expect, afterEach } from "bun:test";
import { $ } from "bun";
import { fixtureManager } from "../../tests/helpers/git-fixture.ts";
import { getBranchName, pushBranch, type BranchNameConfig } from "./branches.ts";

const fixtures = fixtureManager();
afterEach(() => fixtures.cleanup());

describe("github/branches", () => {
  describe("getBranchName", () => {
    test("generates branch name with default prefix", () => {
      const config: BranchNameConfig = { prefix: "taspr", username: "testuser" };
      expect(getBranchName("abc12345", config)).toBe("taspr/testuser/abc12345");
    });

    test("generates branch name with custom prefix", () => {
      const config: BranchNameConfig = { prefix: "stacked", username: "msims" };
      expect(getBranchName("deadbeef", config)).toBe("stacked/msims/deadbeef");
    });
  });

  describe("pushBranch", () => {
    test("pushes a commit to a new branch", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-push-test", { create: true });

      const commitHash = await fixture.commit("Test commit");

      // Push to a new branch in origin
      await pushBranch(commitHash, "taspr/testuser/test123", false, { cwd: fixture.path });

      // Verify the branch exists in origin
      const result =
        await $`git -C ${fixture.originPath} branch --list taspr/testuser/test123`.text();
      expect(result.trim()).toBe("taspr/testuser/test123");
    });

    test("updates an existing branch", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-update-test", { create: true });

      const firstCommit = await fixture.commit("First commit");
      await pushBranch(firstCommit, "taspr/testuser/update123", false, { cwd: fixture.path });

      const secondCommit = await fixture.commit("Second commit");
      await pushBranch(secondCommit, "taspr/testuser/update123", true, { cwd: fixture.path });

      // Verify the branch points to the second commit
      const result =
        await $`git -C ${fixture.originPath} rev-parse taspr/testuser/update123`.text();
      expect(result.trim()).toBe(secondCommit);
    });

    test("force push overwrites divergent history", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-force-test", { create: true });

      const commit1 = await fixture.commit("Commit 1");
      await pushBranch(commit1, "taspr/testuser/force123", false, { cwd: fixture.path });

      // Create a different commit (simulating a rebase)
      await $`git -C ${fixture.path} reset --hard HEAD~1`.quiet();
      const commit2 = await fixture.commit("Different commit");

      // Force push should succeed
      await pushBranch(commit2, "taspr/testuser/force123", true, { cwd: fixture.path });

      const result = await $`git -C ${fixture.originPath} rev-parse taspr/testuser/force123`.text();
      expect(result.trim()).toBe(commit2);
    });
  });
});
