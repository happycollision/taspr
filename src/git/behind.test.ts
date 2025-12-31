import { test, expect, afterEach, describe } from "bun:test";
import { $ } from "bun";
import { fixtureManager } from "../../tests/helpers/git-fixture.ts";
import { isStackBehindMain, getCommitsBehind } from "./behind.ts";

const fixtures = fixtureManager();
afterEach(() => fixtures.cleanup());

describe("git/behind", () => {
  describe("isStackBehindMain", () => {
    test("returns false when stack is up to date", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit");

      const result = await isStackBehindMain({ cwd: fixture.path });
      expect(result).toBe(false);
    });

    test("returns true when origin/main has new commits", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit");

      // Push a commit to origin/main (simulating another developer's work)
      await fixture.updateOriginMain("Commit from main");

      const result = await isStackBehindMain({ cwd: fixture.path });
      expect(result).toBe(true);
    });

    test("returns false when stack is ahead but not behind", async () => {
      const fixture = await fixtures.create();
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
      const fixture = await fixtures.create();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit");

      // Fetch first to ensure we have the latest
      await $`git -C ${fixture.path} fetch origin`.quiet();

      const count = await getCommitsBehind({ cwd: fixture.path });
      expect(count).toBe(0);
    });

    test("returns correct count when behind by N commits", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit");

      // Push multiple commits to origin/main
      for (let i = 1; i <= 3; i++) {
        await fixture.updateOriginMain(`Main commit ${i}`);
      }

      // Fetch to get the new commits
      await $`git -C ${fixture.path} fetch origin`.quiet();

      const count = await getCommitsBehind({ cwd: fixture.path });
      expect(count).toBe(3);
    });

    test("returns correct count when diverged (both ahead and behind)", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-branch", { create: true });
      await fixture.commit("Feature commit 1");
      await fixture.commit("Feature commit 2");

      // Push commit to origin/main (creating divergence)
      await fixture.updateOriginMain("Divergent commit");

      // Fetch to get the divergent commit
      await $`git -C ${fixture.path} fetch origin`.quiet();

      // Stack is 2 ahead, 1 behind
      const count = await getCommitsBehind({ cwd: fixture.path });
      expect(count).toBe(1);
    });
  });
});
