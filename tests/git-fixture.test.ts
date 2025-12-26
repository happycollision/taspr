import { test, expect, afterEach } from "bun:test";
import { createGitFixture, type GitFixture } from "./helpers/git-fixture.ts";
import { $ } from "bun";

let fixture: GitFixture | null = null;

afterEach(async () => {
  if (fixture) {
    await fixture.cleanup();
    fixture = null;
  }
});

test("creates a git repository with initial commit", async () => {
  fixture = await createGitFixture();

  const result = await $`git -C ${fixture.path} log --oneline`.text();
  expect(result).toContain("Initial commit");
});

test("can create commits with trailers", async () => {
  fixture = await createGitFixture();

  await fixture.commit("Add feature", {
    trailers: {
      "Taspr-Commit-Id": "abc12345",
    },
  });

  const result = await $`git -C ${fixture.path} log -1 --format=%B`.text();
  expect(result).toContain("Add feature");
  expect(result).toContain("Taspr-Commit-Id: abc12345");
});
