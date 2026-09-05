#!/usr/bin/env bun
// The `grimoire` CLI (issue #54).
//
//   grimoire seed [dir]      import a markdown campaign tree into the database
//
// `seed` runs EXACTLY the code the boot path will run (Scheibe 2) — there is
// no separate seed importer to keep in sync (planning #52, PO decision F5).
// Its default source is `examples/`, which is what makes the example campaign
// the dev and E2E fixture without a second data format.
//
// Deliberately thin: argument parsing, a readable report, an exit code. The
// migration itself refuses to overwrite anything (see migrate-campaigns.ts),
// so the worst a mistyped invocation does is print "nothing to do".

import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { openDb } from "./db/client";
import { runInitialMigration } from "./db/migrate-campaigns";
import { migrationReport } from "./db/schema";
import { getDbFile } from "./config";

const PACKAGE_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Dev default: the committed example campaign (CLAUDE.md, "Arbeitsweise"). */
const DEFAULT_SOURCE = path.resolve(PACKAGE_DIR, "../examples");

const USAGE = `grimoire — Grimoire maintenance CLI

  grimoire seed [dir]   Import a markdown campaign tree into the database.
                        dir defaults to ${DEFAULT_SOURCE}
                        Target database: GRIMOIRE_DATA/grimoire.db
                        (currently ${getDbFile()})

  Options:
    --force             Import even when the database already holds data.
                        Rows are added, nothing is deleted — use it only on a
                        scratch database.
`;

async function seed(args: string[]): Promise<number> {
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const source = positional[0] === undefined ? DEFAULT_SOURCE : path.resolve(process.cwd(), positional[0]);
  const dbFile = getDbFile();

  const { db, client, close } = await openDb(dbFile);
  try {
    console.log(`grimoire seed`);
    console.log(`  source:  ${source}`);
    console.log(`  target:  ${dbFile}`);
    console.log(`  backend: ${client.backend}`);
    const outcome = await runInitialMigration(db, source, { force });
    if (!outcome.migrated) {
      const why = {
        "already-migrated": "the database is already migrated (meta.migrated_at is set)",
        "database-not-empty": "the database already holds campaigns and is never overwritten",
        "no-campaigns": "no campaign directory found in the source",
      }[outcome.skipped ?? "no-campaigns"];
      console.log(`  nothing to do — ${why}`);
      // The one skip a user may not have intended: content without any
      // migration marker. Say what the options are instead of leaving them
      // with a dead end.
      if (outcome.skipped === "database-not-empty") {
        console.log("");
        console.log("  This database holds campaign rows but no migration marker, so seeding");
        console.log("  it would mix two data sets. The file is left completely untouched.");
        console.log("  Your options:");
        console.log(`    · keep it — it already has content; nothing needs importing`);
        console.log(`    · import into a FRESH database:`);
        console.log(`        GRIMOIRE_DATA=<empty-dir> grimoire seed ${source}`);
        console.log(`    · start over from the files — move the database aside first:`);
        console.log(`        mv ${dbFile} ${dbFile}.bak && grimoire seed ${source}`);
        console.log(`    · add to it anyway (rows are added, nothing deleted): --force`);
      }
      return 0;
    }
    if (outcome.resumedFrom.length > 0) {
      // Per-campaign markers: an earlier run had already committed these.
      console.log(`  resumed — already migrated earlier: ${outcome.resumedFrom.join(", ")}`);
    }
    console.log(`  imported: ${outcome.campaigns.join(", ") || "(nothing left to do)"}`);
    if (outcome.reportEntries === 0) {
      console.log("  clean import — the migration report is empty");
      return 0;
    }
    console.log(
      `  ${outcome.reportEntries} report entr${outcome.reportEntries === 1 ? "y" : "ies"}, ` +
        `${outcome.unknownFiles} file(s) kept verbatim in unknown_files:`,
    );
    // THIS run's entries only. The table is cumulative — printing all of it
    // would present an earlier run's findings as if they just happened.
    for (const row of db
      .select()
      .from(migrationReport)
      .where(eq(migrationReport.runId, outcome.runId ?? ""))
      .all()) {
      console.log(`   · [${row.campaignId}] ${row.path}: ${row.reason}`);
    }
    // Degradation is not a failure (the files are untouched and the content is
    // preserved) — but it IS something to read, so it is not silent either.
    return 0;
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
