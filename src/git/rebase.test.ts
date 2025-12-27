import { test, expect, afterEach, describe } from "bun:test";
import { createGitFixture, type GitFixture } from "../../tests/helpers/git-fixture.ts";
import { injectMissingIds, allCommitsHaveIds, countCommitsMissingIds } from "./rebase.ts";
import { getStackCommitsWithTrailers } from "./commands.ts";

let fixture: GitFixture | null = null;

afterEach(async () => {
  if (fixture) {
    await fixture.cleanup();
    fixture = null;
  }
});

describe("git/rebase", () => {
  describe("injectMissingIds", () => {
    test("adds IDs to commits that don't have them", async () => {
      fixture = await createGitFixture();
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
      fixture = await createGitFixture();
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
      fixture = await createGitFixture();
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
      fixture = await createGitFixture();
      // No commits beyond merge-base

      const result = await injectMissingIds({ cwd: fixture.path });

      expect(result.modifiedCount).toBe(0);
      expect(result.rebasePerformed).toBe(false);
    });
  });

  describe("allCommitsHaveIds", () => {
    test("returns true when all commits have IDs", async () => {
      fixture = await createGitFixture();
      await fixture.checkout("feature-check-all", { create: true });

      await fixture.commit("Commit 1", { trailers: { "Taspr-Commit-Id": "id111111" } });
      await fixture.commit("Commit 2", { trailers: { "Taspr-Commit-Id": "id222222" } });

      const result = await allCommitsHaveIds({ cwd: fixture.path });
      expect(result).toBe(true);
    });

    test("returns false when some commits missing IDs", async () => {
      fixture = await createGitFixture();
      await fixture.checkout("feature-check-some", { create: true });

      await fixture.commit("Has ID", { trailers: { "Taspr-Commit-Id": "id111111" } });
      await fixture.commit("No ID");

      const result = await allCommitsHaveIds({ cwd: fixture.path });
      expect(result).toBe(false);
    });

    test("returns true for empty stack", async () => {
      fixture = await createGitFixture();

      const result = await allCommitsHaveIds({ cwd: fixture.path });
      expect(result).toBe(true);
    });
  });

  describe("countCommitsMissingIds", () => {
    test("counts commits without IDs", async () => {
      fixture = await createGitFixture();
      await fixture.checkout("feature-count", { create: true });

      await fixture.commit("Has ID", { trailers: { "Taspr-Commit-Id": "id111111" } });
      await fixture.commit("No ID 1");
      await fixture.commit("No ID 2");

      const count = await countCommitsMissingIds({ cwd: fixture.path });
      expect(count).toBe(2);
    });

    test("returns 0 when all have IDs", async () => {
      fixture = await createGitFixture();
      await fixture.checkout("feature-count-all", { create: true });

      await fixture.commit("Has ID", { trailers: { "Taspr-Commit-Id": "id111111" } });

      const count = await countCommitsMissingIds({ cwd: fixture.path });
      expect(count).toBe(0);
    });
  });
});
