import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import { repoManager } from "../helpers/local-repo.ts";
import { scenarios } from "../../src/scenario/definitions.ts";
import {
  addGroupTrailers,
  removeGroupTrailers,
  updateGroupTitle,
  mergeSplitGroup,
} from "../../src/git/group-rebase.ts";
import { getStackCommitsWithTrailers } from "../../src/git/commands.ts";
import { parseStack } from "../../src/core/stack.ts";

/**
 * Get commit trailers for verification.
 */
async function getCommitTrailers(cwd: string, count: number): Promise<string> {
  return await $`git -C ${cwd} log --format=%s%n%b--- HEAD~${count}..HEAD`.text();
}

describe("targeted group repair functions", () => {
  const repos = repoManager();

  describe("addGroupTrailers", () => {
    test("adds Taspr-Group and Taspr-Group-Title to a commit", async () => {
      const repo = await repos.create();
      await scenarios.multiCommitStack.setup(repo);

      // Get commits
      const commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      const firstCommit = commits[0];
      expect(firstCommit).toBeDefined();

      // Add group trailers to the first commit
      const result = await addGroupTrailers(
        firstCommit!.hash,
        "test-group-id",
        "Test Group Title",
        { cwd: repo.path },
      );
      expect(result.success).toBe(true);

      // Verify the trailers were added
      const afterTrailers = await getCommitTrailers(repo.path, 3);
      expect(afterTrailers).toContain("Taspr-Group: test-group-id");
      expect(afterTrailers).toContain("Taspr-Group-Title: Test Group Title");
    });
  });

  describe("removeGroupTrailers", () => {
    test("removes Taspr-Group and Taspr-Group-Title from a commit", async () => {
      const repo = await repos.create();
      await scenarios.withGroups.setup(repo);

      // Get commits and find one with group trailers
      const commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      const groupCommit = commits.find((c) => c.trailers["Taspr-Group"]);
      expect(groupCommit).toBeDefined();
      const groupId = groupCommit!.trailers["Taspr-Group"];
      expect(groupId).toBeDefined();

      // Remove the group trailers
      const result = await removeGroupTrailers(groupCommit!.hash, groupId!, { cwd: repo.path });
      expect(result.success).toBe(true);

      // Verify group trailers were removed from that commit
      const newCommits = await getStackCommitsWithTrailers({ cwd: repo.path });
      const updatedCommit = newCommits.find(
        (c) => c.subject === groupCommit!.subject && !c.trailers["Taspr-Group"],
      );
      expect(updatedCommit).toBeDefined();
      // Commit IDs should still be there
      expect(updatedCommit!.trailers["Taspr-Commit-Id"]).toBeDefined();
    });
  });

  describe("updateGroupTitle", () => {
    test("updates Taspr-Group-Title on a commit", async () => {
      const repo = await repos.create();
      await scenarios.inconsistentGroupTitle.setup(repo);

      // Get commits
      const commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      const commitWithTitleA = commits.find((c) => c.trailers["Taspr-Group-Title"] === "Title A");
      expect(commitWithTitleA).toBeDefined();

      // Update the title
      const result = await updateGroupTitle(commitWithTitleA!.hash, "Title A", "Unified Title", {
        cwd: repo.path,
      });
      expect(result.success).toBe(true);

      // Verify the title was updated
      const newCommits = await getStackCommitsWithTrailers({ cwd: repo.path });
      const updatedCommit = newCommits.find(
        (c) => c.trailers["Taspr-Group-Title"] === "Unified Title",
      );
      expect(updatedCommit).toBeDefined();
    });
  });

  describe("mergeSplitGroup", () => {
    test("reorders commits to merge a split group", async () => {
      const repo = await repos.create();
      await scenarios.splitGroup.setup(repo);

      // Verify the stack is initially invalid (split group)
      const commitsBefore = await getStackCommitsWithTrailers({ cwd: repo.path });
      const validationBefore = parseStack(commitsBefore);
      expect(validationBefore.ok).toBe(false);
      if (!validationBefore.ok) {
        expect(validationBefore.error).toBe("split-group");
      }

      // Merge the split group
      const result = await mergeSplitGroup("group-split", { cwd: repo.path });
      expect(result.success).toBe(true);

      // Verify the stack is now valid
      const commitsAfter = await getStackCommitsWithTrailers({ cwd: repo.path });
      const validationAfter = parseStack(commitsAfter);
      expect(validationAfter.ok).toBe(true);

      // Verify the group commits are now contiguous and ID is preserved
      if (validationAfter.ok) {
        // Group ID must be preserved (critical for branch/PR stability)
        const groupUnit = validationAfter.units.find(
          (u) => u.type === "group" && u.id === "group-split",
        );
        expect(groupUnit).toBeDefined();
        expect(groupUnit!.id).toBe("group-split");
        expect(groupUnit!.title).toBe("Split Group");
        expect(groupUnit!.commits).toHaveLength(2);
      }
    });
  });
});
