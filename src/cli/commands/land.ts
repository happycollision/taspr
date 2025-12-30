import { getStackCommitsWithTrailers } from "../../git/commands.ts";
import { parseStack } from "../../core/stack.ts";
import { formatValidationError } from "../output.ts";
import { getBranchNameConfig, getBranchName } from "../../github/branches.ts";
import {
  findPRByBranch,
  landPR,
  deleteRemoteBranch,
  getPRMergeStatus,
  PRNotFastForwardError,
  PRNotFoundError,
  PRNotReadyError,
} from "../../github/pr.ts";
import type { PRUnit, EnrichedPRUnit } from "../../types.ts";

async function enrichUnitsWithPRInfo(units: PRUnit[]): Promise<EnrichedPRUnit[]> {
  const config = await getBranchNameConfig();

  return Promise.all(
    units.map(async (unit): Promise<EnrichedPRUnit> => {
      const branchName = getBranchName(unit.id, config);
      const pr = await findPRByBranch(branchName);

      if (pr) {
        return {
          ...unit,
          pr: {
            number: pr.number,
            url: pr.url,
            state: pr.state,
          },
        };
      }

      return unit;
    }),
  );
}

export async function landCommand(): Promise<void> {
  try {
    const commits = await getStackCommitsWithTrailers();

    if (commits.length === 0) {
      console.log("No commits in stack");
      return;
    }

    const result = parseStack(commits);

    if (!result.ok) {
      console.error(formatValidationError(result));
      process.exit(1);
    }

    const enrichedUnits = await enrichUnitsWithPRInfo(result.units);

    // Find bottom open PR with PR info (bottom of stack is first in array)
    const bottomPR = enrichedUnits.find(
      (u): u is EnrichedPRUnit & { pr: NonNullable<EnrichedPRUnit["pr"]> } =>
        u.pr?.state === "OPEN",
    );

    if (!bottomPR) {
      console.log("No open PRs in stack");
      return;
    }

    // Check if PR is ready to land (CI passing, reviews approved)
    const mergeStatus = await getPRMergeStatus(bottomPR.pr.number);

    if (!mergeStatus.isReady) {
      const reasons: string[] = [];
      if (mergeStatus.checksStatus === "failing") {
        reasons.push("CI checks are failing");
      } else if (mergeStatus.checksStatus === "pending") {
        reasons.push("CI checks are still running");
      }
      if (mergeStatus.reviewDecision === "changes_requested") {
        reasons.push("Changes have been requested");
      } else if (mergeStatus.reviewDecision === "review_required") {
        reasons.push("Review is required");
      }
      throw new PRNotReadyError(bottomPR.pr.number, reasons);
    }

    console.log(`Merging PR #${bottomPR.pr.number} (${bottomPR.title})...`);

    await landPR(bottomPR.pr.number);

    console.log(`✓ Merged PR #${bottomPR.pr.number} to main`);

    // Clean up the remote branch
    const config = await getBranchNameConfig();
    const branchName = getBranchName(bottomPR.id, config);
    await deleteRemoteBranch(branchName);
    console.log(`✓ Deleted remote branch ${branchName}`);
  } catch (error) {
    if (error instanceof PRNotFastForwardError) {
      console.error(`✗ PR #${error.prNumber} is not ready to land:`);
      console.error(`  • ${error.reason}`);
      console.error("\nRun 'taspr view' to see status.");
      process.exit(1);
    }

    if (error instanceof PRNotFoundError) {
      console.error(`✗ PR #${error.prNumber} not found`);
      process.exit(1);
    }

    if (error instanceof PRNotReadyError) {
      console.error(`✗ PR #${error.prNumber} is not ready to land:`);
      for (const reason of error.reasons) {
        console.error(`  • ${reason}`);
      }
      console.error("\nRun 'taspr view' to see status.");
      process.exit(1);
    }

    if (error instanceof Error) {
      console.error(`✗ Error: ${error.message}`);
    } else {
      console.error("✗ An unexpected error occurred");
    }
    process.exit(1);
  }
}
