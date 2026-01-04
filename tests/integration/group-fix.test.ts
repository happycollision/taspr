import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import { repoManager } from "../helpers/local-repo.ts";
import { scenarios } from "../../src/scenario/definitions.ts";
import { runTaspr } from "./helpers.ts";

/**
 * Run taspr group --fix command.
 */
async function runGroupFix(
  cwd: string,
  mode?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const args = mode ? [`--fix=${mode}`] : ["--fix"];
  return runTaspr(cwd, "group", args);
}

/**
 * Get commit messages with trailers for verification.
 */
async function getCommitTrailers(cwd: string, count: number): Promise<string> {
  return await $`git -C ${cwd} log --format=%s%n%b--- HEAD~${count}..HEAD`.text();
}

describe("taspr group --fix", () => {
  const repos = repoManager();

  test("reports valid stack when no issues found", async () => {
    const repo = await repos.create();
    await scenarios.withGroups.setup(repo);

    const result = await runGroupFix(repo.path);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No invalid groups found");
    expect(result.stdout).toContain("Stack is valid");
  });

  test("fixes split group by dissolving in non-TTY mode", async () => {
    const repo = await repos.create();
    await scenarios.splitGroup.setup(repo);

    // Verify initial state has split group trailers
    const beforeTrailers = await getCommitTrailers(repo.path, 3);
    expect(beforeTrailers).toContain("Taspr-Group: group-split");

    // In non-TTY mode, --fix falls back to dissolve behavior
    const result = await runGroupFix(repo.path);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Split group");
    expect(result.stdout).toContain("dissolved");

    // Verify group trailers are removed
    const afterTrailers = await getCommitTrailers(repo.path, 3);
    expect(afterTrailers).not.toContain("Taspr-Group:");
    expect(afterTrailers).toContain("Taspr-Commit-Id"); // Should preserve commit IDs
  });

  test("fixes inconsistent group titles by normalizing in non-TTY mode", async () => {
    const repo = await repos.create();
    await scenarios.inconsistentGroupTitle.setup(repo);

    // Verify initial state has inconsistent titles
    const beforeTrailers = await getCommitTrailers(repo.path, 2);
    expect(beforeTrailers).toContain("Taspr-Group-Title: Title A");
    expect(beforeTrailers).toContain("Taspr-Group-Title: Title B");

    // In non-TTY mode, --fix normalizes to the most common title
    const result = await runGroupFix(repo.path);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Inconsistent group titles");
    expect(result.stdout).toContain("normalized");

    // Verify titles are now consistent (one of them should be used for both)
    const afterTrailers = await getCommitTrailers(repo.path, 2);
    // Either Title A or Title B should be used consistently
    const titleACount = (afterTrailers.match(/Taspr-Group-Title: Title A/g) || []).length;
    const titleBCount = (afterTrailers.match(/Taspr-Group-Title: Title B/g) || []).length;
    // One title should appear twice, the other zero times
    expect(titleACount + titleBCount).toBe(2); // Both commits should have titles
    expect(titleACount === 2 || titleBCount === 2).toBe(true);
    expect(afterTrailers).toContain("Taspr-Commit-Id"); // Should preserve commit IDs
  });

  test("handles empty stack gracefully", async () => {
    const repo = await repos.create();
    await scenarios.emptyStack.setup(repo);

    const result = await runGroupFix(repo.path);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No commits in stack");
  });

  test("handles stack without any group trailers", async () => {
    const repo = await repos.create();
    await scenarios.withTasprIds.setup(repo);

    const result = await runGroupFix(repo.path);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No invalid groups found");
  });

  test("--fix=dissolve removes split group trailers", async () => {
    const repo = await repos.create();
    await scenarios.splitGroup.setup(repo);

    const result = await runGroupFix(repo.path, "dissolve");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Split group");
    expect(result.stdout).toContain("dissolved");

    // Verify group trailers are removed
    const afterTrailers = await getCommitTrailers(repo.path, 3);
    expect(afterTrailers).not.toContain("Taspr-Group:");
    expect(afterTrailers).toContain("Taspr-Commit-Id"); // Should preserve commit IDs
  });
});
