#!/usr/bin/env bun
/**
 * Interactive scenario runner entry point.
 *
 * Usage: bun run scenario
 */

import { $ } from "bun";
import { runScenarioRunner } from "./runner.ts";

$`bun run build`.nothrow().quiet();

runScenarioRunner().catch((err) => {
  console.error("Scenario runner failed:", err);
  process.exit(1);
});
