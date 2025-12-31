import { test, expect, afterEach, describe } from "bun:test";
import { $ } from "bun";
import { fixtureManager } from "../../tests/helpers/git-fixture.ts";
import {
  getStackCommits,
  getMergeBase,
  getCurrentBranch,
  hasUncommittedChanges,
} from "./commands.ts";
import { join } from "node:path";

const fixtures = fixtureManager();
afterEach(() => fixtures.cleanup());

describe("git/commands", () => {
  describe("getMergeBase", () => {
    test("returns merge-base with origin/main", async () => {
      const fixture = await fixtures.create();

      const mergeBase = await getMergeBase({ cwd: fixture.path });
      expect(mergeBase).toMatch(/^[a-f0-9]{40}$/);
    });
  });

  describe("getCurrentBranch", () => {
    test("returns current branch name", async () => {
      const fixture = await fixtures.create();

      const branch = await getCurrentBranch({ cwd: fixture.path });
      expect(branch).toBe("main");
    });
  });

  describe("getStackCommits", () => {
    test("returns empty array when no commits ahead of main", async () => {
      const fixture = await fixtures.create();

      const commits = await getStackCommits({ cwd: fixture.path });
      expect(commits).toEqual([]);
    });

    test("returns commits in oldest-to-newest order", async () => {
      const fixture = await fixtures.create();

      await fixture.checkout("feature-test", { create: true });
      await fixture.commit("First commit");
      await fixture.commit("Second commit");
      await fixture.commit("Third commit");

      const commits = await getStackCommits({ cwd: fixture.path });

      expect(commits).toHaveLength(3);
      const [first, second, third] = commits;
      expect(first?.subject).toBe("First commit");
      expect(second?.subject).toBe("Second commit");
      expect(third?.subject).toBe("Third commit");

      // Each commit should have a valid hash
      for (const commit of commits) {
        expect(commit.hash).toMatch(/^[a-f0-9]{40}$/);
      }
    });

    test("correctly parses commit body with trailers", async () => {
      const fixture = await fixtures.create();

      await fixture.checkout("feature-body-test", { create: true });
      await fixture.commit("Add feature X", {
        trailers: {
          "Taspr-Commit-Id": "a1b2c3d4",
          "Co-authored-by": "Someone <someone@example.com>",
        },
      });

      const commits = await getStackCommits({ cwd: fixture.path });

      expect(commits).toHaveLength(1);
      const [commit] = commits;
      expect(commit?.subject).toBe("Add feature X");
      expect(commit?.body).toContain("Taspr-Commit-Id: a1b2c3d4");
    });

    test("handles commits with special characters in subject", async () => {
      const fixture = await fixtures.create();

      await fixture.checkout("feature-special-chars", { create: true });

      // Create commit directly since fixture.commit doesn't support special chars in message
      await Bun.write(join(fixture.path, "special.ts"), "// special");
      await $`git -C ${fixture.path} add special.ts`.quiet();
      await $`git -C ${fixture.path} commit -m "fix: handle \"quoted\" strings & <special> chars"`.quiet();

      const commits = await getStackCommits({ cwd: fixture.path });

      expect(commits).toHaveLength(1);
      const [commit] = commits;
      expect(commit?.subject).toBe('fix: handle "quoted" strings & <special> chars');
    });
  });

  describe("hasUncommittedChanges", () => {
    test("returns false when working tree is clean", async () => {
      const fixture = await fixtures.create();

      const hasChanges = await hasUncommittedChanges({ cwd: fixture.path });
      expect(hasChanges).toBe(false);
    });

    test("returns true when there are uncommitted changes", async () => {
      const fixture = await fixtures.create();

      await Bun.write(join(fixture.path, "uncommitted.ts"), "// uncommitted");

      const hasChanges = await hasUncommittedChanges({ cwd: fixture.path });
      expect(hasChanges).toBe(true);
    });
  });
});
