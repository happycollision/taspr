#!/usr/bin/env bun
import { Command } from "commander";
import { viewCommand } from "./commands/view.ts";

const program = new Command();

program.name("taspr").description("CLI tool for managing stacked PRs on GitHub").version("0.1.0");

program.command("view").description("View the current stack of commits").action(viewCommand);

program
  .command("sync")
  .description("Sync commits and push to GitHub as PRs")
  .option("--open", "Open PRs for new branches")
  .action(() => {
    console.log("sync command not yet implemented");
  });

program
  .command("land")
  .description("Merge PRs to main")
  .argument("[id]", "Specific PR unit ID to land")
  .option("--all", "Land all mergeable PRs")
  .action(() => {
    console.log("land command not yet implemented");
  });

program
  .command("group")
  .description("Group management commands")
  .argument("<action>", "Action: create, edit, dissolve")
  .action(() => {
    console.log("group command not yet implemented");
  });

program.parse();
