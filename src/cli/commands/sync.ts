import { requireCleanWorkingTree, DirtyWorkingTreeError } from "../../git/status.ts";
import { injectMissingIds } from "../../git/rebase.ts";
import { getStackCommitsWithTrailers } from "../../git/commands.ts";

export async function syncCommand(): Promise<void> {
  try {
    // Check for uncommitted changes
    await requireCleanWorkingTree();

    // Get commits and check which need IDs
    const commits = await getStackCommitsWithTrailers();

    if (commits.length === 0) {
      console.log("✓ No commits in stack");
      return;
    }

    const missingCount = commits.filter((c) => !c.trailers["Taspr-Commit-Id"]).length;

    if (missingCount === 0) {
      console.log("✓ All commits have Taspr-Commit-Id");
      return;
    }

    // Add IDs via rebase
    console.log(`Adding IDs to ${missingCount} commit(s)...`);
    const result = await injectMissingIds();

    console.log(`✓ Added Taspr-Commit-Id to ${result.modifiedCount} commit(s)`);
  } catch (error) {
    if (error instanceof DirtyWorkingTreeError) {
      console.error("✗ Error: Cannot sync with uncommitted changes");
      console.error("");
      console.error("  You have:");
      if (error.status.hasStagedChanges) {
        console.error("    • staged changes");
      }
      if (error.status.hasUnstagedChanges) {
        console.error("    • unstaged changes");
      }
      console.error("");
      console.error("  Please commit or stash your changes first:");
      console.error("    git stash        # Temporarily save changes");
      console.error("    taspr sync       # Run sync");
      console.error("    git stash pop    # Restore changes");
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
