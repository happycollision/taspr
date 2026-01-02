import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createLocalRepo, type LocalRepo } from "../scenario/core.ts";
import { generateUniqueId } from "../../tests/helpers/unique-id.ts";
import { applyGroupSpec, parseGroupSpec } from "./group-rebase.ts";
import { getStackCommitsWithTrailers } from "./commands.ts";
import { parseStack } from "../core/stack.ts";

describe("group-rebase", () => {
  let repo: LocalRepo;

  beforeEach(async () => {
    repo = await createLocalRepo(
      { uniqueId: generateUniqueId() },
      { scenarioName: "group-rebase" },
    );
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  describe("parseGroupSpec", () => {
    test("parses empty spec", () => {
      const spec = parseGroupSpec('{"groups": []}');
      expect(spec.groups).toEqual([]);
      expect(spec.order).toBeUndefined();
    });

    test("parses spec with order", () => {
      const spec = parseGroupSpec('{"order": ["a", "b"], "groups": []}');
      expect(spec.order).toEqual(["a", "b"]);
    });

    test("parses spec with groups", () => {
      const spec = parseGroupSpec('{"groups": [{"commits": ["a", "b"], "name": "My Group"}]}');
      expect(spec.groups).toHaveLength(1);
      expect(spec.groups[0]!.commits).toEqual(["a", "b"]);
      expect(spec.groups[0]!.name).toBe("My Group");
    });

    test("throws on invalid JSON", () => {
      expect(() => parseGroupSpec("not json")).toThrow();
    });

    test("throws if groups is not an array", () => {
      expect(() => parseGroupSpec('{"groups": "not array"}')).toThrow("groups must be an array");
    });
  });

  describe("applyGroupSpec", () => {
    test("creates a single-commit group", async () => {
      // Create a branch with commits
      await repo.branch("feature");
      const hash1 = await repo.commit({ message: "First commit" });

      // Apply group spec
      const result = await applyGroupSpec(
        {
          groups: [{ commits: [hash1], name: "Single Commit Group" }],
        },
        { cwd: repo.path },
      );

      expect(result.success).toBe(true);

      // Verify trailers were added
      const commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      expect(commits).toHaveLength(1);

      const commit = commits[0]!;
      expect(commit.trailers["Taspr-Group-Start"]).toBeDefined();
      expect(commit.trailers["Taspr-Group-Title"]).toBe("Single Commit Group");
      expect(commit.trailers["Taspr-Group-End"]).toBe(commit.trailers["Taspr-Group-Start"]);
    });

    test("creates a multi-commit group", async () => {
      // Create a branch with commits
      await repo.branch("feature");
      const hash1 = await repo.commit({ message: "First commit" });
      const hash2 = await repo.commit({ message: "Second commit" });
      const hash3 = await repo.commit({ message: "Third commit" });

      // Apply group spec - group all 3 commits
      const result = await applyGroupSpec(
        {
          groups: [{ commits: [hash1, hash2, hash3], name: "Multi Commit Group" }],
        },
        { cwd: repo.path },
      );

      expect(result.success).toBe(true);

      // Verify trailers were added
      const commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      expect(commits).toHaveLength(3);

      // First commit should have Start and Title
      expect(commits[0]!.trailers["Taspr-Group-Start"]).toBeDefined();
      expect(commits[0]!.trailers["Taspr-Group-Title"]).toBe("Multi Commit Group");
      expect(commits[0]!.trailers["Taspr-Group-End"]).toBeUndefined();

      // Middle commit should have no group trailers
      expect(commits[1]!.trailers["Taspr-Group-Start"]).toBeUndefined();
      expect(commits[1]!.trailers["Taspr-Group-End"]).toBeUndefined();

      // Last commit should have End
      const groupId = commits[0]!.trailers["Taspr-Group-Start"];
      expect(commits[2]!.trailers["Taspr-Group-End"]).toBe(groupId);
      expect(commits[2]!.trailers["Taspr-Group-Start"]).toBeUndefined();
    });

    test("supports short hash references", async () => {
      await repo.branch("feature");
      const hash1 = await repo.commit({ message: "First commit" });

      // Use short hash (7 chars)
      const shortHash = hash1.slice(0, 7);

      const result = await applyGroupSpec(
        {
          groups: [{ commits: [shortHash], name: "Short Hash Group" }],
        },
        { cwd: repo.path },
      );

      expect(result.success).toBe(true);

      const commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      expect(commits[0]!.trailers["Taspr-Group-Title"]).toBe("Short Hash Group");
    });

    test("supports Taspr-Commit-Id references", async () => {
      await repo.branch("feature");
      await repo.commit({
        message: "First commit",
        trailers: { "Taspr-Commit-Id": "abc12345" },
      });

      // Reference by Taspr-Commit-Id
      const result = await applyGroupSpec(
        {
          groups: [{ commits: ["abc12345"], name: "ID Reference Group" }],
        },
        { cwd: repo.path },
      );

      expect(result.success).toBe(true);

      const commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      expect(commits[0]!.trailers["Taspr-Group-Title"]).toBe("ID Reference Group");
    });

    test("reorders commits when order is specified", async () => {
      await repo.branch("feature");
      const hash1 = await repo.commit({ message: "First" });
      const hash2 = await repo.commit({ message: "Second" });
      const hash3 = await repo.commit({ message: "Third" });

      // Reverse the order
      const result = await applyGroupSpec(
        {
          order: [hash3, hash2, hash1],
          groups: [],
        },
        { cwd: repo.path },
      );

      expect(result.success).toBe(true);

      // Verify order changed
      const commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      expect(commits).toHaveLength(3);

      // Order should now be: Third, Second, First
      expect(commits[0]!.subject).toContain("Third");
      expect(commits[1]!.subject).toContain("Second");
      expect(commits[2]!.subject).toContain("First");
    });

    test("reorders and groups in one operation", async () => {
      await repo.branch("feature");
      const hash1 = await repo.commit({ message: "First" });
      const hash2 = await repo.commit({ message: "Second" });
      const hash3 = await repo.commit({ message: "Third" });

      // Reorder to: Third, First, Second and group Third+First
      const result = await applyGroupSpec(
        {
          order: [hash3, hash1, hash2],
          groups: [{ commits: [hash3, hash1], name: "Reordered Group" }],
        },
        { cwd: repo.path },
      );

      expect(result.success).toBe(true);

      const commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      expect(commits).toHaveLength(3);

      // Verify order
      expect(commits[0]!.subject).toContain("Third");
      expect(commits[1]!.subject).toContain("First");
      expect(commits[2]!.subject).toContain("Second");

      // Verify group (Third and First)
      expect(commits[0]!.trailers["Taspr-Group-Start"]).toBeDefined();
      expect(commits[0]!.trailers["Taspr-Group-Title"]).toBe("Reordered Group");
      expect(commits[1]!.trailers["Taspr-Group-End"]).toBe(
        commits[0]!.trailers["Taspr-Group-Start"],
      );

      // Second should not be in the group
      expect(commits[2]!.trailers["Taspr-Group-Start"]).toBeUndefined();
      expect(commits[2]!.trailers["Taspr-Group-End"]).toBeUndefined();
    });

    test("does nothing when no changes needed", async () => {
      await repo.branch("feature");
      await repo.commit({ message: "First" });

      const result = await applyGroupSpec(
        {
          groups: [],
        },
        { cwd: repo.path },
      );

      expect(result.success).toBe(true);
    });

    test("validates parsed stack after grouping", async () => {
      await repo.branch("feature");
      const hash1 = await repo.commit({ message: "First" });
      const hash2 = await repo.commit({ message: "Second" });

      await applyGroupSpec(
        {
          groups: [{ commits: [hash1, hash2], name: "Valid Group" }],
        },
        { cwd: repo.path },
      );

      // parseStack should validate successfully
      const commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      const result = parseStack(commits);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.units).toHaveLength(1);
        expect(result.units[0]!.type).toBe("group");
        expect(result.units[0]!.title).toBe("Valid Group");
      }
    });

    test("throws on unknown commit reference", async () => {
      await repo.branch("feature");
      await repo.commit({ message: "First" });

      expect(
        applyGroupSpec(
          {
            groups: [{ commits: ["nonexistent"], name: "Bad Group" }],
          },
          { cwd: repo.path },
        ),
      ).rejects.toThrow('Unknown commit reference in group "Bad Group": nonexistent');
    });

    test("throws on non-contiguous group commits", async () => {
      await repo.branch("feature");
      const hash1 = await repo.commit({ message: "First" });
      await repo.commit({ message: "Second" }); // Middle commit, not in group
      const hash3 = await repo.commit({ message: "Third" });

      // Try to group commits 1 and 3, skipping commit 2
      expect(
        applyGroupSpec(
          {
            groups: [{ commits: [hash1, hash3], name: "Non-Contiguous Group" }],
          },
          { cwd: repo.path },
        ),
      ).rejects.toThrow('Group "Non-Contiguous Group" has non-contiguous commits');
    });

    test("replaces existing group trailers instead of accumulating", async () => {
      await repo.branch("feature");
      const hash1 = await repo.commit({ message: "First" });
      const hash2 = await repo.commit({ message: "Second" });

      // Apply first group
      const result1 = await applyGroupSpec(
        {
          groups: [{ commits: [hash1, hash2], name: "Original Group" }],
        },
        { cwd: repo.path },
      );
      expect(result1.success).toBe(true);

      // Get new hashes after rebase
      let commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      expect(commits).toHaveLength(2);
      const newHash1 = commits[0]!.hash;
      const newHash2 = commits[1]!.hash;

      // Verify first group was applied
      expect(commits[0]!.trailers["Taspr-Group-Title"]).toBe("Original Group");

      // Apply different group to same commits
      const result2 = await applyGroupSpec(
        {
          groups: [{ commits: [newHash1, newHash2], name: "New Group" }],
        },
        { cwd: repo.path },
      );
      expect(result2.success).toBe(true);

      // Verify trailers were replaced, not accumulated
      commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      expect(commits).toHaveLength(2);

      // Should only have the new group title, not both
      expect(commits[0]!.trailers["Taspr-Group-Title"]).toBe("New Group");

      // Check the commit message doesn't have duplicate trailers
      const { $ } = await import("bun");
      const message = await $`git -C ${repo.path} log -1 --format=%B ${commits[0]!.hash}`.text();
      const titleMatches = message.match(/Taspr-Group-Title:/g);
      expect(titleMatches).toHaveLength(1); // Only one title trailer
    });

    test("removes group trailers when no new groups specified", async () => {
      await repo.branch("feature");
      const hash1 = await repo.commit({ message: "First" });

      // Apply group
      await applyGroupSpec(
        {
          groups: [{ commits: [hash1], name: "Temporary Group" }],
        },
        { cwd: repo.path },
      );

      let commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      expect(commits[0]!.trailers["Taspr-Group-Title"]).toBe("Temporary Group");

      // Apply empty spec (should remove group trailers)
      await applyGroupSpec(
        {
          groups: [],
        },
        { cwd: repo.path },
      );

      // Verify trailers were removed
      commits = await getStackCommitsWithTrailers({ cwd: repo.path });
      expect(commits[0]!.trailers["Taspr-Group-Title"]).toBeUndefined();
      expect(commits[0]!.trailers["Taspr-Group-Start"]).toBeUndefined();
      expect(commits[0]!.trailers["Taspr-Group-End"]).toBeUndefined();
    });
  });
});
