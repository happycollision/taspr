#!/usr/bin/env bun
/**
 * Debug script to see what key codes are being sent by the terminal.
 * Run with: bun src/tui/debug-keys.ts
 * Press keys to see their codes. Ctrl+C to exit.
 */

console.log("Press keys to see their codes. Ctrl+C to exit.\n");

process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on("data", (data: Buffer) => {
  const bytes = [...data];
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const dec = bytes.join(" ");
  const chars = data.toString().replace(
    // oxlint-disable-next-line no-control-regex
    /[\x00-\x1f]/g,
    (c) => `^${String.fromCharCode(c.charCodeAt(0) + 64)}`,
  );

  console.log(`Bytes: [${hex}] (${dec}) = "${chars}"`);

  // Exit on Ctrl+C
  if (bytes.length === 1 && bytes[0] === 3) {
    console.log("\nExiting...");
    process.exit(0);
  }
});
