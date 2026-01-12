/**
 * Git version-aware tests.
 *
 * These tests adapt based on the installed git version:
 * - Git 2.40+: Tests verify that version check passes
 * - Git < 2.40: Tests verify that sp commands fail gracefully with helpful error
 */

import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import { checkGitVersion, MIN_GIT_VERSION } from "../src/git/plumbing.ts";

interface GitVersionInfo {
  major: number;
  minor: number;
  patch: number;
  full: string;
  meetsMinimum: boolean;
}

async function getGitVersionInfo(): Promise<GitVersionInfo> {
  const output = await $`git --version`.text();
  const match = output.match(/git version (\d+)\.(\d+)\.(\d+)/);

  if (!match) {
    throw new Error(`Could not parse git version from: ${output}`);
  }

  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);
  const patch = parseInt(match[3]!, 10);
  const full = `${major}.${minor}.${patch}`;
  const meetsMinimum = major > 2 || (major === 2 && minor >= 40);

  return { major, minor, patch, full, meetsMinimum };
}

// Get version info once at module load
const versionInfoPromise = getGitVersionInfo();

describe("git version detection", () => {
  test("correctly parses git version", async () => {
    const info = await versionInfoPromise;

    expect(info.major).toBeGreaterThanOrEqual(2);
    expect(info.minor).toBeGreaterThanOrEqual(0);
    expect(info.full).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("MIN_GIT_VERSION is 2.40.0", () => {
    expect(MIN_GIT_VERSION).toBe("2.40.0");
  });
});

describe("git 2.40+ (supported version)", async () => {
  const info = await versionInfoPromise;

  test.skipIf(!info.meetsMinimum)(`checkGitVersion passes with git ${info.full}`, async () => {
    const result = await checkGitVersion();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe("git < 2.40 (unsupported version)", async () => {
  const info = await versionInfoPromise;

  test.skipIf(info.meetsMinimum)(`checkGitVersion returns error for git ${info.full}`, async () => {
    const result = await checkGitVersion();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.version).toBe(info.full);
      expect(result.minRequired).toBe(MIN_GIT_VERSION);
    }
  });

  test.skipIf(info.meetsMinimum)("sp view shows helpful error message", async () => {
    // Run sp view and capture the error output
    const result = await $`bun run src/cli/index.ts view`.nothrow().quiet();

    // Should fail
    expect(result.exitCode).not.toBe(0);

    // Error message should be helpful
    const output = result.stderr.toString() + result.stdout.toString();
    expect(output).toContain("2.40");
    expect(output).toContain(info.full);
  });
});

// Print version info for CI logs
test("log git version info", async () => {
  const info = await versionInfoPromise;

  console.log(`\n📋 Git Version Info:`);
  console.log(`   Version: ${info.full}`);
  console.log(`   Meets minimum (2.40+): ${info.meetsMinimum ? "✅ Yes" : "❌ No"}`);

  if (!info.meetsMinimum) {
    console.log(`   ⚠️  Running with unsupported git version`);
  }

  expect(true).toBe(true);
});
