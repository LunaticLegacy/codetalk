#!/usr/bin/env node

import { printHelp, printSubcommandHelp, printVersion } from "./constants.js";
import {
  configure,
  initMap,
  scanRepo,
  writeMap,
  askCodebase,
  planChange,
  execution,
  rollbackTo,
  listBackups,
  checkMap
} from "./handlers.js";
import { parseOptions } from "./utils.js";

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const [command = "help", ...rest] = rawArgs;

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    printSubcommandHelp(command);
    return;
  }

  const options = parseOptions(rest);

  if (command === "version" || command === "--version" || command === "-V") {
    printVersion();
    return;
  }

  if (command === "init") {
    initMap(options);
    return;
  }

  if (command === "config") {
    await configure(options);
    return;
  }

  if (command === "scan") {
    await scanRepo(options);
    return;
  }

  if (command === "ask") {
    await askCodebase(options);
    return;
  }

  if (command === "plan") {
    await planChange(options);
    return;
  }

  if (command === "map") {
    writeMap(options);
    return;
  }

  if (command === "exec") {
    await execution(options);
    return;
  }

  if (command === "rollback") {
    const backupId = options.message || "";
    if (backupId === "--list" || !backupId) {
      const list = listBackups(options.cwd);
      if (list.length === 0) {
        console.log("No backups found.");
      } else {
        console.log("Available backups:");
        for (const b of list) {
          console.log(`  ${b.created}`);
        }
      }
      if (!backupId) {
        console.log('Usage: codetalk rollback <backup-id>  or  codetalk rollback --list');
      }
    } else {
      rollbackTo(options.cwd, backupId);
    }
    return;
  }

  if (command === "check") {
    checkMap(options);
    return;
  }

  console.error(`Unknown command: ${command}\nRun "codetalk help" for usage.`);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
