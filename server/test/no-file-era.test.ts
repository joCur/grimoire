// The END-STATE check: nothing in the repo still works the way the storage
// did before the database was the truth.
//
// This is a test and not a review note because the file era left NAMES behind,
// and a name that is still in the tree is an invitation to write a second one
// like it. `parseMarkdown`, a `frontmatter` in a comment, an `extra` column, a
// `/file` in an API path, a `Datei` where an entry is meant — each of them says
// that an entry is a text with properties parsed out of it, which it has not
// been since ADR #13, #23 and #24.
//
// HOW IT READS: one rule per name, over `server/src`, `server/test`,
// `shared/src`, `shared/test`, `app/src`, `generator/`, `fixtures/` and
// `e2e/`. The tests are read along with the code: a helper called `getFile`
// teaches the next case to write a second one. A hit fails with the file, the
// line number and the line, so the fix is obvious from the failure alone.
// Exceptions live in ONE array below, each with its reason; `pendingRules`
// below that is the opposite list — names a follow-up removes, asserted to
// still BE there, so that step flips them from pending to forbidden
// deliberately instead of by accident.
//
// It walks the tree synchronously and skips `node_modules` and build output, so
// it costs a few milliseconds and runs in the normal suite.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root — this file sits in `server/test`. */
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

/** What is scanned, relative to the repository root. */
const ROOTS = [
  "server/src",
  "server/test",
  "shared/src",
  "shared/test",
  "app/src",
  "generator",
  "fixtures",
  "e2e",
];

/** Directories never entered, wherever they appear. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", "playwright-report"]);

/** Extensions read. Markdown is prose and is not scanned (see the exceptions). */
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".sql", ".css", ".html"]);

/** One forbidden name, and what its presence would mean. */
interface Rule {
  /** Stable id, used by an exception to name the rule it exempts. */
  id: string;
  /** What must not appear. */
  pattern: RegExp;
  /** Printed with a hit: what the name means and what replaces it. */
  meaning: string;
  /** Limit the rule to these root-relative path prefixes. */
  only?: string[];
  /** True when only COMMENT lines are read — for words that are fine in code. */
  commentsOnly?: boolean;
}

/**
 * A place a rule does not apply. `path` exempts a file or directory prefix,
 * `phrase` exempts a line containing that text — matched case-insensitively,
 * so an emphasised `THIS FILE` counts as well; `rule` narrows the exception to
 * one rule, and without it the path is not scanned at all.
 */
interface Exception {
  path?: string;
  phrase?: string;
  rule?: string;
  reason: string;
}

const EXCEPTIONS: readonly Exception[] = [
  {
    path: "server/src/db/migrations",
    reason: "a released migration never changes again — the file era is its history, not its code",
  },
  {
    path: "server/src/static-files.ts",
    reason: "the static-file server genuinely serves FILES — the built app's assets",
  },
  {
    path: "server/test/no-file-era.test.ts",
    reason: "this test names every forbidden name in order to forbid it",
  },
  {
    phrase: "fixtures/",
    rule: "campaigns-dir",
    reason: "the fixture entries are files on disk and are addressed as such",
  },
  {
    phrase: "/api/campaigns/",
    rule: "campaigns-dir",
    reason: "`campaigns` is a URL segment of the API, not a data directory",
  },
  {
    phrase: "/campaigns/:campaign",
    rule: "campaigns-dir",
    reason: "the same URL segment, as a route pattern",
  },
  {
    phrase: "document order",
    rule: "entry-is-not-a-document",
    reason: "the order the blocks of a body stand in, which is what the renderer walks",
  },
  {
    phrase: "document level",
    rule: "entry-is-not-a-document",
    reason: "the same structure seen from the top: a block that sits in no section",
  },
  {
    phrase: "document-start",
    rule: "entry-is-not-a-document",
    reason: "the browser timing an init script runs at, spelled the way the browser does",
  },
  {
    path: "app/src/lib/blocks.test.ts",
    rule: "file-word-for-an-entry",
    reason: "the roundtrip case reads the fixture JSON from disk and names it by file",
  },
  {
    phrase: "this file",
    rule: "file-word-for-an-entry",
    reason: "the module the comment stands in, not an entry",
  },
  {
    phrase: "spec file",
    rule: "file-word-for-an-entry",
    reason: "a `*.e2e.ts` of the suite — a file the test runner picks up",
  },
  {
    phrase: "fixture file",
    rule: "file-word-for-an-entry",
    reason: "`fixtures/beispiel/<stem>.json` on disk, the input the seed run reads",
  },
  {
    phrase: "database file",
    rule: "file-word-for-an-entry",
    reason: "`GRIMOIRE_DATA/grimoire.db`, the one file the store opens (ADR #13)",
  },
  {
    phrase: "prompt file",
    rule: "file-word-for-an-entry",
    reason: "a `generator/*.md` prompt asset, read from disk on the first run",
  },
  {
    phrase: "static-files",
    rule: "file-word-for-an-entry",
    reason: "the module that serves the built app's assets — real files over HTTP",
  },
  {
    phrase: "schema file",
    rule: "file-word-for-an-entry",
    reason: "`shared/schema/*.json`, the JSON schemas the consistency test reads from disk",
  },
  {
    path: "server/test/typography.test.ts",
    rule: "file-word-for-an-entry",
    reason: "it walks the prompt and fixture files on disk and reports the offenders by path",
  },
  {
    path: "server/test/static-files.test.ts",
    rule: "file-word-for-an-entry",
    reason: "it builds a dist directory of real assets and asks the server to serve them",
  },
  {
    phrase: "sql.raw",
    rule: "raw-list-column",
    reason: "drizzle's escape hatch for a value that goes into a table DEFINITION",
  },
  {
    phrase: "raw `sql`",
    rule: "raw-list-column",
    reason: "the same escape hatch, named in prose: a hand-written SQL template",
  },
  {
    phrase: "raw client",
    rule: "raw-list-column",
    reason: "the SQLite client under the drizzle handle, which the pre-flights run on",
  },
  {
    phrase: "raw-text patcher",
    rule: "raw-list-column",
    reason: "the write path that existed before properties were columns, named as history",
  },
];

/**
 * Every name the file era left behind. The ids are referenced by the
 * exceptions above; the `meaning` is what a failure prints.
 */
const RULES: readonly Rule[] = [
  {
    id: "parse-markdown",
    pattern: /\bparseMarkdown\b/,
    meaning: "nothing parses properties out of a text any more (ADR #24)",
  },
  {
    id: "render-raw",
    pattern: /\brenderRaw\b/,
    meaning: "an entry is not rendered to one text — `properties` and `body` stand for themselves",
  },
  {
    id: "compose-entry",
    pattern: /\bcomposeEntry\b/,
    meaning: "there is no text to compose an entry into",
  },
  {
    id: "yaml-dependency",
    pattern: /js-yaml/,
    meaning: "properties are columns, so nothing reads or writes YAML",
  },
  {
    id: "gray-matter",
    pattern: /gray-matter/,
    meaning: "same as above — the frontmatter reader is gone",
  },
  {
    id: "frontmatter",
    pattern: /frontmatter/i,
    meaning: "the word for properties-in-front-of-a-text; entries have `properties`",
  },
  {
    id: "parsed-file",
    pattern: /\bParsedFile\b/,
    meaning: "`EntryResponse` replaced it — an entry was never a parsed file",
  },
  {
    id: "read-parsed-file",
    pattern: /\breadParsedFile\b/,
    meaning: "the store reads a ROW, through server/src/store/read.ts",
  },
  {
    id: "parse-glossary-body",
    pattern: /\bparseGlossaryBody\b/,
    meaning: "the glossary is a list of rows, not a text to parse",
  },
  {
    id: "parse-relations-section",
    pattern: /\bparseRelationsSection\b/,
    meaning: "an npc's `## Beziehungen` is prose; nothing is derived from body text",
  },
  {
    id: "unknown-files",
    pattern: /\bunknown_files\b/,
    meaning: "the importer's bookkeeping table — there is nothing to import from",
  },
  {
    id: "migration-report",
    pattern: /\bmigration_report\b/,
    meaning: "the same bookkeeping, dropped with it",
  },
  {
    id: "extra-column",
    pattern: /\bextra:\s*text\(|\.extra\b/,
    meaning: "the catch-all column is gone — a key the contract does not name has no field",
    // Scoped to the storage layer: `ApiError.extra` is an error body, and a
    // form's `extra` field is a form's business.
    only: ["server/src/db", "server/src/store"],
  },
  {
    id: "injected-keys",
    pattern: /(?<![A-Za-z0-9_])_(?:campaign|chapter)\b/,
    meaning: "the keys the reader used to inject into properties; addressing answers this now",
  },
  {
    id: "file-endpoint",
    pattern: /\/api\/[^"'`\s]*\/file/,
    meaning: "the API addresses ENTRIES — `/entries/<address>`, never a file",
  },
  {
    // The one rule that is AHEAD of the tree: the app still carries
    // `fmString`, `fmStringArray`, `fmQuickstats` and a `fm-` id prefix in its
    // properties helpers, and the rename happens on the app's side. So this
    // case fails until the two halves meet — encoded now, because a rule
    // written after the rename is a rule nobody asked for.
    id: "fm-prefix",
    pattern: /\bfm(?=[A-Z_]|\b)/,
    meaning: "`fm` was the frontmatter; the half is called `properties`",
  },
  {
    // Singular only: "the format documents" is the verb, not the noun. The
    // word also has two meanings that are NOT an entry, and the pattern tells
    // them apart instead of exempting whole trees: the DOM object, written
    // `document.` or `documentElement` or quoted as code, and the block order
    // of a body, which the exceptions above name as the phrases "document
    // order", "document level" and the browser's "document-start".
    id: "entry-is-not-a-document",
    pattern: /(?<![.`])\b[Dd]ocument\b(?![.`]|Element)/,
    meaning: "an entry has properties and a text — it is not a document",
    commentsOnly: true,
  },
  {
    // German file vocabulary, on EVERY line: there is no DOM `Datei` and no
    // markdown `Dokument`, so a hit is always about an entry — including one
    // in a prompt or a label, which is exactly where it would reach the DM.
    id: "entry-is-not-a-file",
    pattern: /[Dd]okument|[Dd]atei/,
    meaning: "an entry is an Eintrag with Eigenschaften and Text — never a Datei",
  },
  {
    // The English word, over the WHOLE repo. Nothing reads or writes an entry
    // on disk any more, so "file" is either a real file — a module, a spec, a
    // fixture, the database, a prompt asset, the app build, each named by one
    // of the phrase exceptions above — or an entry called by the wrong name.
    id: "file-word-for-an-entry",
    pattern: /\bfiles?\b/i,
    meaning: "an entry has properties, a body and an address — it is not a file",
  },
  {
    // The status degrade the app used to carry: `status` is a CHECK constraint
    // of its column and the preflight refuses a database holding anything else
    // (ADR #25), so a foreign value cannot reach a renderer at all. A fallback
    // for one would be dead code that reads like a rule, and it would come
    // back with these words — they are the ones the removed branches used.
    id: "status-degrade-fallback",
    pattern: /unknown status value|raw label/i,
    meaning: "status is an enum — a value from outside the list has no fallback to render",
    only: ["app/src"],
  },
  {
    // The three LISTS lost their entry address (ADR #26): a session, the
    // inbox and the glossary are tables with their own endpoints, so these
    // addresses name nothing and answer 404 like any other unknown one. A
    // reader that still reaches for one is reaching for the parse that is
    // gone.
    id: "list-entry-address",
    pattern: /entries\/(?:glossary|inbox|sessions)/,
    meaning: "a list has no entry address — it answers its own endpoint (ADR #26)",
    // SCOPED, on purpose, until the app's half of this lands: the app tree
    // still reads these addresses, and flipping the rule for `app/src` in the
    // same step would fail a suite the app engineer has not reached yet. The
    // integration step widens the scope to the whole tree.
    only: ["server/src", "shared/src", "fixtures", "generator"],
  },
  {
    // The 400 that refused a `body` for one of those three addresses. With
    // the address gone there is nothing to refuse a body FOR, so the code is
    // unreachable — it stays in the append-only code list with a note, and
    // no write path may name it again.
    id: "body-not-editable",
    pattern: /body_not_editable/,
    meaning: "no address carries a list any more, so no write can be refused one",
    // SCOPED, on purpose, until the app's half of this lands: the app tree
    // still reads these addresses, and flipping the rule for `app/src` in the
    // same step would fail a suite the app engineer has not reached yet. The
    // integration step widens the scope to the whole tree.
    only: ["server/src", "fixtures", "generator"],
  },
  {
    // `raw` held the markdown line beside a log or inbox row — two truths
    // about one note, and the line was the one the reader used. Migration
    // 0018 dropped the column; a reference to it in the storage layer would
    // be the parse coming back.
    id: "raw-list-column",
    pattern: /\braw\s*:|\.raw\b|`raw`|"raw"/,
    meaning: "a log or inbox row is columns only — there is no line beside them",
    only: ["server/src/db/schema.ts", "server/src/store"],
  },
  {
    id: "chokidar",
    pattern: /chokidar/,
    meaning: "there is no external editor to watch; `campaigns.version` is bumped by the writer",
  },
  {
    // `campaigns` is also a URL segment of the API — `/campaigns/:campaign` is
    // every address in the app — and that one is fine. What is forbidden is
    // `campaigns/` as a DIRECTORY, so the line has to reach for the file
    // system or for the data directory alongside it.
    id: "campaigns-dir",
    pattern:
      /(?:path\.(?:join|resolve)|readdirSync|readFileSync|writeFileSync|existsSync|mkdirSync|GRIMOIRE_DATA|dataDir)[^\n]*campaigns/,
    meaning: "`campaigns/` is not a data directory — the database is the only storage (ADR #13)",
  },
];

/**
 * Names a FOLLOW-UP removes, asserted to still be there. Each is a stopgap
 * that outlives this step, and flipping one into `RULES` is then a conscious
 * line in that step's diff rather than a rule that quietly started passing.
 */
const pendingRules: ReadonlyArray<{ pattern: RegExp; goes: string }> = [
  {
    pattern: /\bparseLogEntries\b/,
    goes: "the app still parses a session's log out of its text; the rows are the truth",
  },
];

/** One scanned line. */
interface Line {
  file: string;
  number: number;
  text: string;
}

/** Every scanned line of the tree, in walk order. */
function scannedLines(): Line[] {
  const lines: Line[] = [];
  const walk = (relative: string): void => {
    const absolute = path.join(ROOT, relative);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      return; // a root that does not exist yet is not a failure
    }
    if (stats.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(path.join(relative, name));
      }
      return;
    }
    if (!EXTENSIONS.has(path.extname(relative))) return;
    const text = readFileSync(absolute, "utf8");
    text.split("\n").forEach((line, index) => {
      lines.push({ file: relative, number: index + 1, text: line });
    });
  };
  for (const root of ROOTS) walk(root);
  return lines;
}

const LINES = scannedLines();

/** A comment line — the only kind the word rules read. */
function isComment(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("--")
  );
}

/** The exceptions that apply to one rule — path prefixes and phrases. */
function exemptions(rule: Rule): { paths: string[]; phrases: string[] } {
  const mine = EXCEPTIONS.filter((e) => e.rule === undefined || e.rule === rule.id);
  return {
    paths: mine.flatMap((e) => (e.path === undefined ? [] : [e.path])),
    phrases: mine.flatMap((e) => (e.phrase === undefined ? [] : [e.phrase])),
  };
}

/** Every line one rule hits, as `<file>:<line> <text>`. */
function hits(rule: Rule): string[] {
  const { paths, phrases } = exemptions(rule);
  return LINES.filter((line) => {
    if (paths.some((prefix) => line.file === prefix || line.file.startsWith(`${prefix}/`))) {
      return false;
    }
    if (rule.only !== undefined && !rule.only.some((prefix) => line.file.startsWith(prefix))) {
      return false;
    }
    if (rule.commentsOnly === true && !isComment(line.text)) return false;
    if (!rule.pattern.test(line.text)) return false;
    const lowered = line.text.toLowerCase();
    return !phrases.some((phrase) => lowered.includes(phrase.toLowerCase()));
  }).map((line) => `${line.file}:${line.number} ${line.text.trim()}`);
}

describe("no rest of the file era", () => {
  test("the tree is actually being read", () => {
    // A walk that finds nothing would make every case below pass.
    expect(LINES.length).toBeGreaterThan(20_000);
    expect(new Set(LINES.map((line) => line.file.split("/")[0])).size).toBeGreaterThan(3);
  });

  for (const rule of RULES) {
    test(`${rule.id}: ${rule.meaning}`, () => {
      expect(hits(rule)).toEqual([]);
    });
  }
});

describe("the stopgaps a follow-up removes are still there", () => {
  for (const pending of pendingRules) {
    test(`still present until ${pending.goes}`, () => {
      const found = LINES.filter((line) => pending.pattern.test(line.text));
      expect(found.length).toBeGreaterThan(0);
    });
  }
});
