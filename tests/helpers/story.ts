/**
 * Story logging API for integration tests.
 *
 * Creates narrative markdown files during test runs that document
 * what each test demonstrates in plain English, followed by CLI output.
 *
 * Activated by setting TASPR_STORY_TEST_LOGGING=1 environment variable.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { CommandResult } from "../integration/helpers.ts";

/** ANSI escape code pattern for stripping colors */
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Story entry types */
type StoryEntry = { type: "narrate"; text: string } | { type: "command"; result: CommandResult };

/** Story section for a single test */
interface StorySection {
  testName: string;
  entries: StoryEntry[];
}

export interface Story {
  /** Start a new test story section */
  begin(testName: string): void;
  /** Add narrative text to the current story */
  narrate(text: string): void;
  /** Log a command result */
  log(result: CommandResult): void;
  /** End the current story section */
  end(): void;
  /** Write all stories to disk */
  flush(): Promise<void>;
}

/** Check if story logging is enabled */
function isEnabled(): boolean {
  return process.env.TASPR_STORY_TEST_LOGGING === "1";
}

/** Strip ANSI codes from text */
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** Sanitize test IDs from text */
function sanitizeTestId(text: string, testId?: string): string {
  if (!testId) return text;

  // Replace test ID in brackets (commit messages): [happy-penguin-x3f] -> (removed entirely)
  let result = text.replace(new RegExp(`\\s*\\[${escapeRegex(testId)}\\]`, "g"), "");

  // Replace test ID in branch names: feature-happy-penguin-x3f -> feature-{id}
  result = result.replace(new RegExp(`-${escapeRegex(testId)}`, "g"), "-{id}");

  // Replace standalone test ID occurrences
  result = result.replace(new RegExp(escapeRegex(testId), "g"), "{id}");

  return result;
}

/** Escape special regex characters */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Format a story section as markdown */
function formatSection(section: StorySection, testId?: string): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("");
  lines.push(`## ${section.testName}`);
  lines.push("");

  for (const entry of section.entries) {
    if (entry.type === "narrate") {
      lines.push(entry.text);
      lines.push("");
    } else {
      const { result } = entry;
      const sanitizedCommand = sanitizeTestId(result.command, testId);
      lines.push(`### \`${sanitizedCommand}\``);
      lines.push("");
      lines.push("```");
      // Combine stdout and stderr, prefer stdout
      const output = result.stdout || result.stderr;
      const sanitizedOutput = sanitizeTestId(stripAnsi(output.trim()), testId);
      if (sanitizedOutput) {
        lines.push(sanitizedOutput);
      }
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** Format a story section as markdown with ANSI colors preserved */
function formatSectionAnsi(section: StorySection, testId?: string): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("");
  lines.push(`## ${section.testName}`);
  lines.push("");

  for (const entry of section.entries) {
    if (entry.type === "narrate") {
      lines.push(entry.text);
      lines.push("");
    } else {
      const { result } = entry;
      const sanitizedCommand = sanitizeTestId(result.command, testId);
      lines.push(`### \`${sanitizedCommand}\``);
      lines.push("");
      lines.push("```");
      // Combine stdout and stderr, prefer stdout - keep ANSI codes
      const output = result.stdout || result.stderr;
      const sanitizedOutput = sanitizeTestId(output.trim(), testId);
      if (sanitizedOutput) {
        lines.push(sanitizedOutput);
      }
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Create a story logger for a test file.
 *
 * @param testFileName - Name of the test file (e.g., "sync.test.ts")
 * @param testId - Optional test ID to sanitize from output (e.g., "happy-penguin-x3f")
 */
export function createStory(testFileName: string, testId?: string): Story {
  const sections: StorySection[] = [];
  let currentSection: StorySection | null = null;

  // Derive output filename from test filename
  const baseName = testFileName.replace(/\.test\.ts$/, "").replace(/\.ts$/, "");

  return {
    begin(testName: string): void {
      if (!isEnabled()) return;

      currentSection = {
        testName,
        entries: [],
      };
    },

    narrate(text: string): void {
      if (!isEnabled() || !currentSection) return;

      currentSection.entries.push({ type: "narrate", text });
    },

    log(result: CommandResult): void {
      if (!isEnabled() || !currentSection) return;

      currentSection.entries.push({ type: "command", result });
    },

    end(): void {
      if (!isEnabled() || !currentSection) return;

      sections.push(currentSection);
      currentSection = null;
    },

    async flush(): Promise<void> {
      if (!isEnabled() || sections.length === 0) return;

      // Determine output directory (project root/test-logs)
      // import.meta.dir is tests/helpers, so go up two levels to project root
      const projectRoot = join(import.meta.dir, "../..");
      const outputDir = join(projectRoot, "test-logs");
      await mkdir(outputDir, { recursive: true });

      // Generate header
      const header = `# ${baseName} Stories\n\n`;

      // Generate markdown (clean)
      const mdContent = header + sections.map((s) => formatSection(s, testId)).join("\n");
      await writeFile(join(outputDir, `${baseName}.md`), mdContent);

      // Generate ANSI version (with colors)
      const ansiContent = header + sections.map((s) => formatSectionAnsi(s, testId)).join("\n");
      await writeFile(join(outputDir, `${baseName}.ansi`), ansiContent);
    },
  };
}
