import { test, expect, afterEach } from "bun:test";
import { fixtureManager } from "./helpers/git-fixture.ts";
import { $ } from "bun";

const fixtures = fixtureManager();
afterEach(() => fixtures.cleanup());

test("creates a git repository with initial commit", async () => {
  const fixture = await fixtures.create();

  const result = await $`git -C ${fixture.path} log --oneline`.text();
  expect(result).toContain("Initial commit");
});

test("can create commits with trailers", async () => {
  const fixture = await fixtures.create();

  await fixture.commit("Add feature", {
    trailers: {
      "Taspr-Commit-Id": "abc12345",
    },
  });

  const result = await $`git -C ${fixture.path} log -1 --format=%B`.text();
  expect(result).toContain("Add feature");
  expect(result).toContain("Taspr-Commit-Id: abc12345");
});

test("updateOriginMain creates a commit on origin/main", async () => {
  const fixture = await fixtures.create();

  // Create feature branch
  await fixture.checkout("feature", { create: true });
  await fixture.commit("Feature commit");

  // Update origin/main
  await fixture.updateOriginMain("Main update", { "main-file.txt": "content\n" });

  // Fetch and verify
  await $`git -C ${fixture.path} fetch origin`.quiet();
  const log = await $`git -C ${fixture.path} log origin/main --oneline -2`.text();
  expect(log).toContain("Main update");
});
