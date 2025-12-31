import { test, expect, afterEach, describe } from "bun:test";
import { $ } from "bun";
import { join } from "node:path";
import { fixtureManager } from "../../tests/helpers/git-fixture.ts";
import {
  injectMissingIds,
  allCommitsHaveIds,
  countCommitsMissingIds,
  rebaseOntoMain,
  getConflictInfo,
  formatConflictError,
} from "./rebase.ts";
import { getStackCommitsWithTrailers } from "./commands.ts";

const fixtures = fixtureManager();
afterEach(() => fixtures.cleanup());

describe("git/rebase", () => {
  describe("injectMissingIds", () => {
    test("adds IDs to commits that don't have them", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-no-ids", { create: true });

      // Create commits without IDs
      await fixture.commit("First commit");
      await fixture.commit("Second commit");

      // Verify they don't have IDs
      const beforeCommits = await getStackCommitsWithTrailers({ cwd: fixture.path });
      expect(beforeCommits).toHaveLength(2);
      expect(beforeCommits[0]?.trailers["Taspr-Commit-Id"]).toBeUndefined();
      expect(beforeCommits[1]?.trailers["Taspr-Commit-Id"]).toBeUndefined();

      // Inject IDs
      const result = await injectMissingIds({ cwd: fixture.path });

      expect(result.modifiedCount).toBe(2);
      expect(result.rebasePerformed).toBe(true);

      // Verify they now have IDs
      const afterCommits = await getStackCommitsWithTrailers({ cwd: fixture.path });
      expect(afterCommits).toHaveLength(2);
      expect(afterCommits[0]?.trailers["Taspr-Commit-Id"]).toMatch(/^[0-9a-f]{8}$/);
      expect(afterCommits[1]?.trailers["Taspr-Commit-Id"]).toMatch(/^[0-9a-f]{8}$/);
    });

    test("preserves existing IDs", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-mixed", { create: true });

      // Create commits - one with ID, one without
      await fixture.commit("Has ID", { trailers: { "Taspr-Commit-Id": "existing1" } });
      await fixture.commit("No ID");

      const result = await injectMissingIds({ cwd: fixture.path });

      expect(result.modifiedCount).toBe(1);
      expect(result.rebasePerformed).toBe(true);

      const afterCommits = await getStackCommitsWithTrailers({ cwd: fixture.path });
      expect(afterCommits[0]?.trailers["Taspr-Commit-Id"]).toBe("existing1");
      expect(afterCommits[1]?.trailers["Taspr-Commit-Id"]).toMatch(/^[0-9a-f]{8}$/);
      expect(afterCommits[1]?.trailers["Taspr-Commit-Id"]).not.toBe("existing1");
    });

    test("no-op when all commits have IDs", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-all-ids", { create: true });

      await fixture.commit("Has ID 1", { trailers: { "Taspr-Commit-Id": "id111111" } });
      await fixture.commit("Has ID 2", { trailers: { "Taspr-Commit-Id": "id222222" } });

      const result = await injectMissingIds({ cwd: fixture.path });

      expect(result.modifiedCount).toBe(0);
      expect(result.rebasePerformed).toBe(false);

      // Verify IDs unchanged
      const commits = await getStackCommitsWithTrailers({ cwd: fixture.path });
      expect(commits[0]?.trailers["Taspr-Commit-Id"]).toBe("id111111");
      expect(commits[1]?.trailers["Taspr-Commit-Id"]).toBe("id222222");
    });

    test("no-op when stack is empty", async () => {
      const fixture = await fixtures.create();
      // No commits beyond merge-base

      const result = await injectMissingIds({ cwd: fixture.path });

      expect(result.modifiedCount).toBe(0);
      expect(result.rebasePerformed).toBe(false);
    });
  });

  describe("allCommitsHaveIds", () => {
    test("returns true when all commits have IDs", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-check-all", { create: true });

      await fixture.commit("Commit 1", { trailers: { "Taspr-Commit-Id": "id111111" } });
      await fixture.commit("Commit 2", { trailers: { "Taspr-Commit-Id": "id222222" } });

      const result = await allCommitsHaveIds({ cwd: fixture.path });
      expect(result).toBe(true);
    });

    test("returns false when some commits missing IDs", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-check-some", { create: true });

      await fixture.commit("Has ID", { trailers: { "Taspr-Commit-Id": "id111111" } });
      await fixture.commit("No ID");

      const result = await allCommitsHaveIds({ cwd: fixture.path });
      expect(result).toBe(false);
    });

    test("returns true for empty stack", async () => {
      const fixture = await fixtures.create();

      const result = await allCommitsHaveIds({ cwd: fixture.path });
      expect(result).toBe(true);
    });
  });

  describe("countCommitsMissingIds", () => {
    test("counts commits without IDs", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-count", { create: true });

      await fixture.commit("Has ID", { trailers: { "Taspr-Commit-Id": "id111111" } });
      await fixture.commit("No ID 1");
      await fixture.commit("No ID 2");

      const count = await countCommitsMissingIds({ cwd: fixture.path });
      expect(count).toBe(2);
    });

    test("returns 0 when all have IDs", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-count-all", { create: true });

      await fixture.commit("Has ID", { trailers: { "Taspr-Commit-Id": "id111111" } });

      const count = await countCommitsMissingIds({ cwd: fixture.path });
      expect(count).toBe(0);
    });
  });

  describe("rebaseOntoMain", () => {
    test("successfully rebases stack onto updated main", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-rebase", { create: true });
      await fixture.commit("Feature commit 1", { trailers: { "Taspr-Commit-Id": "feat0001" } });
      await fixture.commit("Feature commit 2", { trailers: { "Taspr-Commit-Id": "feat0002" } });

      // Update origin/main (simulating other developer's work)
      await fixture.updateOriginMain("Update on main");
      await $`git -C ${fixture.path} fetch origin`.quiet();

      // Rebase onto main
      const result = await rebaseOntoMain({ cwd: fixture.path });

      expect(result.success).toBe(true);
      expect(result.commitCount).toBe(2);
      expect(result.conflictFile).toBeUndefined();
    });

    test("preserves Taspr trailers through rebase", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-trailers", { create: true });
      await fixture.commit("Feature commit", { trailers: { "Taspr-Commit-Id": "preserve1" } });

      // Update origin/main
      await fixture.updateOriginMain("Main commit");
      await $`git -C ${fixture.path} fetch origin`.quiet();

      const result = await rebaseOntoMain({ cwd: fixture.path });
      expect(result.success).toBe(true);

      // Verify trailer was preserved
      const commits = await getStackCommitsWithTrailers({ cwd: fixture.path });
      expect(commits).toHaveLength(1);
      expect(commits[0]?.trailers["Taspr-Commit-Id"]).toBe("preserve1");
    });

    test("detects conflict and returns conflict file", async () => {
      const fixture = await fixtures.create();

      // Create a file that will conflict
      const conflictFile = "conflict.txt";
      await Bun.write(join(fixture.path, conflictFile), "Original content\n");
      await $`git -C ${fixture.path} add .`.quiet();
      await $`git -C ${fixture.path} commit -m "Add conflict file"`.quiet();
      await $`git -C ${fixture.path} push origin main`.quiet();

      // Create feature branch and modify the file
      await fixture.checkout("feature-conflict", { create: true });
      await Bun.write(join(fixture.path, conflictFile), "Feature content\n");
      await $`git -C ${fixture.path} add .`.quiet();
      await $`git -C ${fixture.path} commit -m "Feature change"`.quiet();

      // Update main with conflicting change
      await fixture.updateOriginMain("Main change", { [conflictFile]: "Main content\n" });
      await $`git -C ${fixture.path} fetch origin`.quiet();

      // Rebase should detect conflict
      const result = await rebaseOntoMain({ cwd: fixture.path });

      expect(result.success).toBe(false);
      expect(result.conflictFile).toBe(conflictFile);

      // Clean up the rebase state
      await $`git -C ${fixture.path} rebase --abort`.quiet().nothrow();
    });

    test("no-op when already up to date", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-uptodate", { create: true });
      await fixture.commit("Feature commit", { trailers: { "Taspr-Commit-Id": "uptodate1" } });

      // No changes to main, just fetch
      await $`git -C ${fixture.path} fetch origin`.quiet();

      const result = await rebaseOntoMain({ cwd: fixture.path });

      expect(result.success).toBe(true);
      expect(result.commitCount).toBe(1);
    });
  });

  describe("getConflictInfo", () => {
    test("returns null when not in a rebase", async () => {
      const fixture = await fixtures.create();
      await fixture.checkout("feature-no-rebase", { create: true });
      await fixture.commit("Normal commit");

      const info = await getConflictInfo({ cwd: fixture.path });
      expect(info).toBeNull();
    });

    test("returns conflict info during rebase conflict", async () => {
      const fixture = await fixtures.create();

      // Create a file that will conflict
      const conflictFile = "conflict-info.txt";
      await Bun.write(join(fixture.path, conflictFile), "Original content\n");
      await $`git -C ${fixture.path} add .`.quiet();
      await $`git -C ${fixture.path} commit -m "Add conflict file"`.quiet();
      await $`git -C ${fixture.path} push origin main`.quiet();

      // Create feature branch and modify the file
      await fixture.checkout("feature-conflict-info", { create: true });
      await Bun.write(join(fixture.path, conflictFile), "Feature content\n");
      await $`git -C ${fixture.path} add .`.quiet();
      await $`git -C ${fixture.path} commit -m "Feature modification"`.quiet();

      // Update main with conflicting change
      await fixture.updateOriginMain("Main modification", { [conflictFile]: "Main content\n" });
      await $`git -C ${fixture.path} fetch origin`.quiet();

      // Start rebase that will conflict
      await $`git -C ${fixture.path} rebase origin/main`.quiet().nothrow();

      // Now we should be in a conflict state
      const info = await getConflictInfo({ cwd: fixture.path });

      expect(info).not.toBeNull();
      expect(info?.files).toContain(conflictFile);
      expect(info?.currentCommit).toMatch(/^[0-9a-f]{8}$/);
      expect(info?.currentSubject).toBe("Feature modification");

      // Clean up
      await $`git -C ${fixture.path} rebase --abort`.quiet().nothrow();
    });

    test("lists multiple conflicting files", async () => {
      const fixture = await fixtures.create();

      // Create files that will conflict
      await Bun.write(join(fixture.path, "file1.txt"), "Original 1\n");
      await Bun.write(join(fixture.path, "file2.txt"), "Original 2\n");
      await $`git -C ${fixture.path} add .`.quiet();
      await $`git -C ${fixture.path} commit -m "Add files"`.quiet();
      await $`git -C ${fixture.path} push origin main`.quiet();

      // Create feature branch and modify both files
      await fixture.checkout("feature-multi-conflict", { create: true });
      await Bun.write(join(fixture.path, "file1.txt"), "Feature 1\n");
      await Bun.write(join(fixture.path, "file2.txt"), "Feature 2\n");
      await $`git -C ${fixture.path} add .`.quiet();
      await $`git -C ${fixture.path} commit -m "Modify both files"`.quiet();

      // Update main with conflicting changes
      await fixture.updateOriginMain("Main changes", {
        "file1.txt": "Main 1\n",
        "file2.txt": "Main 2\n",
      });
      await $`git -C ${fixture.path} fetch origin`.quiet();
      await $`git -C ${fixture.path} rebase origin/main`.quiet().nothrow();

      const info = await getConflictInfo({ cwd: fixture.path });

      expect(info).not.toBeNull();
      expect(info?.files).toHaveLength(2);
      expect(info?.files).toContain("file1.txt");
      expect(info?.files).toContain("file2.txt");

      // Clean up
      await $`git -C ${fixture.path} rebase --abort`.quiet().nothrow();
    });
  });

  describe("formatConflictError", () => {
    test("formats conflict info into readable error message", () => {
      const info = {
        files: ["src/auth.ts", "src/config.ts"],
        currentCommit: "abc12345",
        currentSubject: "Add authentication",
      };

      const message = formatConflictError(info);

      expect(message).toContain("abc12345");
      expect(message).toContain("Add authentication");
      expect(message).toContain("src/auth.ts");
      expect(message).toContain("src/config.ts");
      expect(message).toContain("git add");
      expect(message).toContain("git rebase --continue");
      expect(message).toContain("git rebase --abort");
    });
  });
});
