import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import { repoManager } from "../helpers/local-repo.ts";
import { SKIP_GITHUB_TESTS, SKIP_CI_TESTS, runSync, runLand } from "./helpers.ts";

describe.skipIf(SKIP_GITHUB_TESTS)("GitHub Integration: land", () => {
  const repos = repoManager({ github: true });

  test.skipIf(SKIP_CI_TESTS)(
    "lands a single PR and deletes the branch",
    async () => {
      const repo = await repos.clone();
      await repo.branch("feature/land-test");
      await repo.commit("Add file to land");

      // Run taspr sync --open to create the PR
      const syncResult = await runSync(repo.path, { open: true });
      expect(syncResult.exitCode).toBe(0);
      expect(syncResult.stdout).toContain("Created");

      const pr = await repo.findPR("Add file to land");

      // Wait for CI to pass before landing
      await repo.github.waitForCI(pr.number, { timeout: 180000 });

      // Run taspr land
      const landResult = await runLand(repo.path);

      expect(landResult.exitCode).toBe(0);
      expect(landResult.stdout).toContain(`Merging PR #${pr.number}`);
      expect(landResult.stdout).toContain(`✓ Merged PR #${pr.number} to main`);
      expect(landResult.stdout).toContain(`✓ Deleted remote branch ${pr.headRefName}`);

      // Verify PR is now merged (closed)
      const prStatus =
        await $`gh pr view ${pr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(prStatus).state).toBe("MERGED");

      // Verify branch was deleted
      const branchGone = await repo.waitForBranchGone(pr.headRefName);
      expect(branchGone).toBe(true);

      // Verify the commit is now on main
      await repo.fetch();
      const mainLog = await $`git -C ${repo.path} log origin/main --oneline -5`.text();
      expect(mainLog).toContain("Add file to land");
    },
    { timeout: 200000 },
  );

  test.skipIf(SKIP_CI_TESTS)(
    "retargets next PR to main after landing, preventing it from being closed",
    async () => {
      const repo = await repos.clone();
      await repo.branch("feature/retarget-test");
      await repo.commit("First commit for retarget test");
      await repo.commit("Second commit for retarget test");
      await repo.commit("Third commit for retarget test");

      // Run taspr sync --open to create PRs for all commits
      const syncResult = await runSync(repo.path, { open: true });
      expect(syncResult.exitCode).toBe(0);

      // Get all PRs
      const firstPr = await repo.findPR("First commit for retarget test");
      const secondPr = await repo.findPR("Second commit for retarget test");
      const thirdPr = await repo.findPR("Third commit for retarget test");

      // Wait for CI to pass on all PRs
      await Promise.all([
        repo.github.waitForCI(firstPr.number, { timeout: 180000 }),
        repo.github.waitForCI(secondPr.number, { timeout: 180000 }),
        repo.github.waitForCI(thirdPr.number, { timeout: 180000 }),
      ]);

      // Step 1: Run taspr land (lands just the first PR)
      const landResult1 = await runLand(repo.path);
      expect(landResult1.exitCode).toBe(0);
      expect(landResult1.stdout).toContain(`✓ Merged PR #${firstPr.number} to main`);
      expect(landResult1.stdout).toContain(`Retargeting PR #${secondPr.number} to main`);

      // Wait a few seconds for GitHub to process
      await Bun.sleep(5000);

      // Verify first PR is MERGED (not just closed)
      const firstStatus =
        await $`gh pr view ${firstPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(firstStatus).state).toBe("MERGED");

      // Verify second PR is still OPEN (not closed due to base branch deletion)
      const secondStatus =
        await $`gh pr view ${secondPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state,baseRefName`.text();
      const secondData = JSON.parse(secondStatus);
      expect(secondData.state).toBe("OPEN");
      expect(secondData.baseRefName).toBe("main"); // Should have been retargeted

      // Verify third PR is still OPEN
      const thirdStatus =
        await $`gh pr view ${thirdPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(thirdStatus).state).toBe("OPEN");

      // Step 2: Run taspr land --all (should land remaining PRs)
      const landResult2 = await runLand(repo.path, { all: true });
      expect(landResult2.exitCode).toBe(0);
      expect(landResult2.stdout).toContain("✓ Merged 2 PR(s)");

      // Verify all PRs are MERGED (not CLOSED)
      const finalFirstStatus =
        await $`gh pr view ${firstPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(finalFirstStatus).state).toBe("MERGED");

      const finalSecondStatus =
        await $`gh pr view ${secondPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(finalSecondStatus).state).toBe("MERGED");

      const finalThirdStatus =
        await $`gh pr view ${thirdPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(finalThirdStatus).state).toBe("MERGED");
    },
    { timeout: 400000 },
  );

  test.skipIf(SKIP_CI_TESTS)(
    "fails to land when PR cannot be fast-forwarded",
    async () => {
      const repo = await repos.clone();
      await repo.branch("feature/land-conflict-test");
      await repo.commit("Add conflicting file");

      // Run taspr sync --open to create the PR
      const syncResult = await runSync(repo.path, { open: true });
      expect(syncResult.exitCode).toBe(0);

      const pr = await repo.findPR("Add conflicting file");

      // Wait for CI to pass first (so CI check doesn't fail before fast-forward check)
      await repo.github.waitForCI(pr.number, { timeout: 180000 });

      // Now push a different commit directly to main (simulating someone else merging)
      await repo.checkout("main");
      await $`git -C ${repo.path} pull origin main`.quiet();
      await repo.commit("Direct commit to main");
      await $`git -C ${repo.path} push origin main`.quiet();

      // Go back to feature branch
      const branches = await $`git -C ${repo.path} branch`.text();
      const featureBranch = branches
        .split("\n")
        .find((b) => b.includes("feature/land-conflict-test"));
      if (featureBranch) {
        await repo.checkout(featureBranch.trim().replace("* ", ""));
      }

      // Try to land - should fail because main has diverged
      const landResult = await runLand(repo.path);

      expect(landResult.exitCode).toBe(1);
      expect(landResult.stderr).toContain("is not ready to land");
      expect(landResult.stderr).toContain("Rebase may be required");
    },
    { timeout: 200000 },
  );

  test(
    "reports no open PRs when stack has no PRs",
    async () => {
      const repo = await repos.clone();
      await repo.branch("feature/no-pr-test");
      await repo.commit("Commit without PR");

      // Run sync WITHOUT --open (just adds IDs, no PR)
      const syncResult = await runSync(repo.path, { open: false });
      expect(syncResult.exitCode).toBe(0);

      // Try to land - should report no open PRs
      const landResult = await runLand(repo.path);

      expect(landResult.exitCode).toBe(0);
      expect(landResult.stdout).toContain("No open PRs in stack");
    },
    { timeout: 60000 },
  );

  test.skipIf(SKIP_CI_TESTS)(
    "fails to land when CI checks are failing",
    async () => {
      const repo = await repos.clone();
      await repo.branch("feature/ci-fail-land-test");
      await repo.commit("[FAIL_CI] Add file that should fail CI");

      // Run taspr sync --open to create the PR
      const syncResult = await runSync(repo.path, { open: true });
      expect(syncResult.exitCode).toBe(0);

      const pr = await repo.findPR("FAIL_CI");

      // Wait for CI to complete (and fail)
      await repo.github.waitForCI(pr.number, { timeout: 180000 });

      // Try to land - should fail because CI is failing
      const landResult = await runLand(repo.path);

      expect(landResult.exitCode).toBe(1);
      expect(landResult.stderr).toContain("is not ready to land");
      expect(landResult.stderr).toContain("CI checks are failing");
    },
    { timeout: 200000 },
  );
});

describe.skipIf(SKIP_GITHUB_TESTS)("GitHub Integration: land --all", () => {
  const repos = repoManager({ github: true });

  test.skipIf(SKIP_CI_TESTS)(
    "lands all consecutive ready PRs in a stack",
    async () => {
      const repo = await repos.clone();
      await repo.branch("feature/land-all-test");
      await repo.commit("First commit in stack");
      await repo.commit("Second commit in stack");
      await repo.commit("Third commit in stack");

      // Run taspr sync --open to create PRs for all commits
      const syncResult = await runSync(repo.path, { open: true });
      expect(syncResult.exitCode).toBe(0);

      // Get all PRs
      const stackPrs = await repo.findPRs("commit in stack");
      expect(stackPrs.length).toBe(3);

      // Wait for CI to pass on all PRs
      await Promise.all(
        stackPrs.map((pr) => repo.github.waitForCI(pr.number, { timeout: 180000 })),
      );

      // Run taspr land --all
      const landResult = await runLand(repo.path, { all: true });

      expect(landResult.exitCode).toBe(0);
      expect(landResult.stdout).toContain("✓ Merged 3 PR(s)");

      // Verify all PRs are now merged
      for (const pr of stackPrs) {
        const prStatus =
          await $`gh pr view ${pr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
        expect(JSON.parse(prStatus).state).toBe("MERGED");
      }

      // Verify the commits are now on main
      await repo.fetch();
      const mainLog = await $`git -C ${repo.path} log origin/main --oneline -10`.text();
      expect(mainLog).toContain("First commit in stack");
      expect(mainLog).toContain("Second commit in stack");
      expect(mainLog).toContain("Third commit in stack");
    },
    { timeout: 300000 },
  );

  test.skipIf(SKIP_CI_TESTS)(
    "stops at first non-ready PR when using --all",
    async () => {
      const repo = await repos.clone();
      await repo.branch("feature/land-all-stop");
      await repo.commit("First commit passes");
      await repo.commit("[FAIL_CI] Second commit fails");
      await repo.commit("Third commit passes");

      // Run taspr sync --open to create PRs for all commits
      const syncResult = await runSync(repo.path, { open: true });
      expect(syncResult.exitCode).toBe(0);

      // Get all PRs
      const firstPr = await repo.findPR("First commit passes");
      const secondPr = await repo.findPR("FAIL_CI");
      const thirdPr = await repo.findPR("Third commit passes");

      // Wait for CI to complete on all PRs
      await Promise.all([
        repo.github.waitForCI(firstPr.number, { timeout: 180000 }),
        repo.github.waitForCI(secondPr.number, { timeout: 180000 }),
        repo.github.waitForCI(thirdPr.number, { timeout: 180000 }),
      ]);

      // Run taspr land --all - should merge first, stop at second
      const landResult = await runLand(repo.path, { all: true });

      expect(landResult.exitCode).toBe(0);
      expect(landResult.stdout).toContain("✓ Merged 1 PR(s)");
      expect(landResult.stdout).toContain(`Stopping at PR #${secondPr.number}`);

      // Verify first PR is merged
      const firstStatus =
        await $`gh pr view ${firstPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(firstStatus).state).toBe("MERGED");

      // Verify second PR is still open
      const secondStatus =
        await $`gh pr view ${secondPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(secondStatus).state).toBe("OPEN");

      // Verify third PR is still open
      const thirdStatus =
        await $`gh pr view ${thirdPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(thirdStatus).state).toBe("OPEN");
    },
    { timeout: 300000 },
  );

  test.skipIf(SKIP_CI_TESTS)(
    "snapshots readiness at start and doesn't land PRs that become ready during execution",
    async () => {
      const repo = await repos.clone();
      await repo.branch("feature/snapshot-test");
      await repo.commit("First commit ready");
      await repo.commit("[FAIL_CI] Second not ready");

      // Run taspr sync --open
      const syncResult = await runSync(repo.path, { open: true });
      expect(syncResult.exitCode).toBe(0);

      // Get PRs
      const firstPr = await repo.findPR("First commit ready");
      const secondPr = await repo.findPR("FAIL_CI");

      // Wait for CI on both
      await Promise.all([
        repo.github.waitForCI(firstPr.number, { timeout: 180000 }),
        repo.github.waitForCI(secondPr.number, { timeout: 180000 }),
      ]);

      // Run land --all
      const landResult = await runLand(repo.path, { all: true });

      // Should only merge the first one
      expect(landResult.exitCode).toBe(0);
      expect(landResult.stdout).toContain("✓ Merged 1 PR(s)");

      // First should be merged
      const firstStatus =
        await $`gh pr view ${firstPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(firstStatus).state).toBe("MERGED");

      // Second should still be open (wasn't ready in snapshot)
      const secondStatus =
        await $`gh pr view ${secondPr.number} --repo ${repo.github.owner}/${repo.github.repo} --json state`.text();
      expect(JSON.parse(secondStatus).state).toBe("OPEN");
    },
    { timeout: 300000 },
  );

  test.skipIf(SKIP_CI_TESTS)(
    "reports no ready PRs when first PR is not ready",
    async () => {
      const repo = await repos.clone();
      await repo.branch("feature/not-ready");
      await repo.commit("[CI_SLOW_TEST] Commit with slow CI");

      // Run taspr sync --open
      const syncResult = await runSync(repo.path, { open: true });
      expect(syncResult.exitCode).toBe(0);

      const pr = await repo.findPR("CI_SLOW_TEST");

      // Wait for CI to start (so we know checks are being reported)
      await repo.github.waitForCIToStart(pr.number);

      // Run land --all (CI should still be running due to slow marker)
      const landResult = await runLand(repo.path, { all: true });

      // Should fail because first PR is not ready (CI still pending)
      expect(landResult.exitCode).toBe(1);
      expect(landResult.stderr).toContain("is not ready to land");
      expect(landResult.stderr).toContain("CI checks are still running");
    },
    { timeout: 120000 },
  );
});
