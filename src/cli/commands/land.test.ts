import { test, expect, afterEach, describe } from "bun:test";
import { $ } from "bun";
import { createGitFixture, type GitFixture } from "../../../tests/helpers/git-fixture.ts";
import { join } from "node:path";

let fixture: GitFixture | null = null;

afterEach(async () => {
  if (fixture) {
    await fixture.cleanup();
    fixture = null;
  }
});

// Helper to run taspr land in the fixture directory
async function runLand(cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await $`bun run ${join(import.meta.dir, "../index.ts")} land`
    .cwd(cwd)
    .nothrow()
    .quiet();
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
}

describe("cli/commands/land", () => {
  test("reports when stack is empty", async () => {
    fixture = await createGitFixture();
    // No commits beyond merge-base

    const result = await runLand(fixture.path);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No commits in stack");
  });

  test("reports when there are commits but no open PRs", async () => {
    fixture = await createGitFixture();
    await fixture.checkout("feature-no-prs", { create: true });

    // Create commits with IDs (so they're valid PR units)
    await fixture.commit("First commit", { trailers: { "Taspr-Commit-Id": "id111111" } });
    await fixture.commit("Second commit", { trailers: { "Taspr-Commit-Id": "id222222" } });

    const result = await runLand(fixture.path);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No open PRs in stack");
  });

  test("handles validation error for unclosed group", async () => {
    fixture = await createGitFixture();
    await fixture.checkout("feature-unclosed", { create: true });

    // Create a group start without a corresponding end
    await fixture.commit("Start group", {
      trailers: {
        "Taspr-Commit-Id": "id333333",
        "Taspr-Group-Start": "grp1",
        "Taspr-Group-Title": "My Group",
      },
    });

    const result = await runLand(fixture.path);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unclosed group");
  });

  // TODO: Add tests for actual landing once VCR-style testing is implemented
  // See: taspr-xtq (VCR-style testing for GitHub API calls)
  //
  // Tests needed:
  // - Land ready PR → success, branch deleted
  // - Land non-ready PR (not fast-forwardable) → error with reason
  // - PR not found → appropriate error message
});
