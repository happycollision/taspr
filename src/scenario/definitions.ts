/**
 * Pre-built scenario configurations for testing and interactive exploration.
 *
 * ## Key exports
 * - `scenarios` - Named scenarios object (use in tests: `scenarios.multiCommitStack`)
 * - `scenarioList` - Array of all scenarios (use for menus/iteration)
 *
 * ## Available scenarios
 * - `emptyStack` - Just main branch, no feature work
 * - `singleCommit` - One commit on feature branch (no ID)
 * - `multiCommitStack` - 3 commits stacked on feature branch
 * - `divergedMain` - Feature branch + upstream changes (needs rebase)
 * - `withTasprIds` - 2 commits with Taspr-Commit-Id trailers
 * - `mixedTrailerStack` - Some commits have IDs, some don't
 * - `conflictScenario` - Setup that will conflict on rebase
 * - `multipleBranches` - Two independent feature branches
 *
 * ## Usage in tests
 * ```ts
 * import { scenarios } from "../../src/scenario/definitions.ts";
 * import { repoManager } from "../../tests/helpers/local-repo.ts";
 *
 * const repos = repoManager();
 *
 * test("my test", async () => {
 *   const repo = await repos.create();
 *   await scenarios.multiCommitStack.setup(repo);
 *   // repo now has 3 commits on feature branch
 * });
 * ```
 *
 * ## Interactive runner
 * Run `bun run scenario --help` to see available scenarios
 * Run `bun run scenario <name>` to spin up a scenario interactively
 *
 * ## Related
 * - `src/scenario/core.ts` - Low-level repo creation
 * - `src/scenario/runner.ts` - Interactive scenario runner
 */

import { $ } from "bun";
import type { LocalRepo } from "./core.ts";

export interface ScenarioDefinition {
  name: string;
  description: string;
  setup: (repo: LocalRepo) => Promise<void>;
}

/**
 * Named scenarios for direct import in tests.
 */
export const scenarios = {
  /**
   * Empty stack - just the main branch with initial commit.
   * Good for testing empty state rendering.
   */
  emptyStack: {
    name: "empty-stack",
    description: "Empty stack (just main branch)",
    setup: async (_repo: LocalRepo) => {
      // No additional setup - just the initial commit on main
    },
  },

  /**
   * Single commit on a feature branch.
   * Basic stack display scenario.
   */
  singleCommit: {
    name: "single-commit",
    description: "Single commit on feature branch",
    setup: async (repo: LocalRepo) => {
      await repo.branch("feature");
      await repo.commit({ message: "Add feature" });
    },
  },

  /**
   * Multiple commits stacked on a feature branch.
   * Good for testing stack visualization with multiple items.
   */
  multiCommitStack: {
    name: "multi-commit-stack",
    description: "Multi-commit stack (3 commits on feature)",
    setup: async (repo: LocalRepo) => {
      await repo.branch("feature");
      await repo.commit({ message: "First change" });
      await repo.commit({ message: "Second change" });
      await repo.commit({ message: "Third change" });
    },
  },

  /**
   * Feature branch with upstream changes on main.
   * Simulates the "needs rebase" scenario.
   */
  divergedMain: {
    name: "diverged-main",
    description: "Feature branch with diverged origin/main (needs rebase)",
    setup: async (repo: LocalRepo) => {
      await repo.branch("feature");
      await repo.commit({ message: "Feature work" });
      await repo.commit({ message: "More feature work" });
      await repo.updateOriginMain("Upstream change on main");
      await repo.fetch();
    },
  },

  /**
   * Commits with Taspr-Commit-Id trailers already set.
   * For testing existing ID handling.
   */
  withTasprIds: {
    name: "with-taspr-ids",
    description: "Stack with Taspr-Commit-Id trailers",
    setup: async (repo: LocalRepo) => {
      await repo.branch("feature");
      await repo.commit({
        message: "First commit",
        trailers: { "Taspr-Commit-Id": "abc12345" },
      });
      await repo.commit({
        message: "Second commit",
        trailers: { "Taspr-Commit-Id": "def67890" },
      });
    },
  },

  /**
   * Setup for testing rebase conflict scenarios.
   * Creates a file that will conflict when rebasing.
   */
  conflictScenario: {
    name: "conflict-scenario",
    description: "Setup for rebase conflict testing",
    setup: async (repo: LocalRepo) => {
      // Create a file that will conflict
      await repo.commitFiles({ "shared.txt": "Original content\n" });
      await $`git -C ${repo.path} push origin main`.quiet();

      await repo.branch("feature");
      await repo.commitFiles({ "shared.txt": "Feature content\n" }, { message: "Feature change" });

      // Update main with conflicting content
      await repo.updateOriginMain("Main change", { "shared.txt": "Main content\n" });
      await repo.fetch();
    },
  },

  /**
   * Multiple independent feature branches.
   * For testing complex workflow visualization.
   */
  multipleBranches: {
    name: "multiple-branches",
    description: "Multiple feature branches for complex workflows",
    setup: async (repo: LocalRepo) => {
      await repo.branch("feature-a");
      await repo.commit({ message: "Feature A work" });

      await repo.checkout("main");
      await repo.branch("feature-b");
      await repo.commit({ message: "Feature B work" });
      await repo.commit({ message: "More Feature B work" });
    },
  },

  /**
   * Stack with mixed trailer states - some commits have IDs, some don't.
   * For testing ID injection and partial sync scenarios.
   */
  mixedTrailerStack: {
    name: "mixed-trailer-stack",
    description: "Stack with some commits missing Taspr-Commit-Id",
    setup: async (repo: LocalRepo) => {
      await repo.branch("feature");
      await repo.commit({
        message: "First commit with ID",
        trailers: { "Taspr-Commit-Id": "mix00001" },
      });
      await repo.commit({ message: "Second commit without ID" });
      await repo.commit({ message: "Third commit without ID" });
    },
  },
} satisfies Record<string, ScenarioDefinition>;

/**
 * Array of all scenarios for the interactive menu.
 */
export const scenarioList: ScenarioDefinition[] = Object.values(scenarios);
