#!/usr/bin/env bun
// The `grimoire` CLI.
//
//   grimoire seed [dir]      load JSON campaign entries into the database
//
// The server boots EMPTY — a fresh installation has no content, and creating
// a campaign in the app is the normal way to start. `seed` is for the
// development and test data: it loads the committed `fixtures/` tree, where a
// directory is a campaign and each file in it is one entry in the shape the
// API speaks (db/seed.ts).
//
// Deliberately thin: argument parsing, a readable report, an exit code. A
// database that already holds campaigns is refused rather than mixed with a
// second data set.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDbEmpty, openDb } from "./db/client";
import { seedFixtures } from "./db/seed";
import { getDbFile } from "./config";

const PACKAGE_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The committed fixture campaigns (CLAUDE.md, "Arbeitsweise"). */
const DEFAULT_SOURCE = path.resolve(PACKAGE_DIR, "../fixtures");

const USAGE = `grimoire — Grimoire maintenance CLI

  grimoire seed [dir]   Load JSON campaign entries into the database.
                        One subdirectory per campaign, one file per entry.
                        dir defaults to ${DEFAULT_SOURCE}
                        Target database: GRIMOIRE_DATA/grimoire.db
                        (currently ${getDbFile()})

  Options:
    --force             Seed even when the database already holds campaigns.
                        Rows are added, nothing is deleted — use it only on a
                        scratch database.
`;

async function seed(args: string[]): Promise<number> {
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const source =
    positional[0] === undefined ? DEFAULT_SOURCE : path.resolve(process.cwd(), positional[0]);
  const dbFile = getDbFile();

  const { db, close } = await openDb(dbFile);
  try {
    if (!force && !isDbEmpty(db)) {
      console.log("this database already holds campaigns and is never overwritten.");
      console.log("  · seed into a FRESH database:  GRIMOIRE_DATA=<empty-dir> grimoire seed");
      console.log("  · add to this one anyway (rows are added, nothing deleted): --force");
      return 0;
    }
    for (const outcome of await seedFixtures(db, source)) {
      console.log(
        `seeded: ${outcome.campaignId} (${outcome.entries} ` +
          `${outcome.entries === 1 ? "entry" : "entries"})`,
      );
    }
    return 0;
  } catch (error) {
    console.error(`seed failed: ${error instanceof Error ? error.message : error}`);
    return 1;
  } finally {
    close();
  }
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "seed":
      return seed(args);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    default:
      console.error(`unknown command: ${command}\n`);
      console.error(USAGE);
      return 2;
  }
}

process.exitCode = await main();
