// The typographic guard of the German quotation marks.
//
// The PO case: a model wrote German quotation marks as the opening U+201E
// closed by an ASCII `"`. Inside a JSON string that `"` ended the string, and
// an otherwise perfect scene reply was unparseable. The escaping is the
// TRANSPORT's job now (the reply is a forced object and the body a string it
// serializes), so that particular breakage is gone; the MIXED spelling is
// not, and it is ours: the prompts, the few-shots and the example campaign
// wrote it that way throughout, and the model imitates what it reads.
//
// So this test forbids the mixed form everywhere the model can see it: the
// system prompts (`.md`), the few-shot REPLIES (`.json`) and
// the reference campaign in `examples/`. A few-shot is one JSON object whose
// body is a single string, so a whole scene sits on one line — the rule still
// reads it correctly, because a correctly closed `„…“` cannot be crossed and
// the string delimiter always stands after it. The catalog carries the same guard over its VALUES (a raw scan
// of `de.ts` cannot tell a closing quotation mark from the TypeScript string
// delimiter) — see app/src/i18n/i18n.test.ts.
//
// The rule is deliberately narrow: an opening `„` followed, on the SAME line,
// by an ASCII `"`. Every quotation mark in these files opens and closes on one
// line, and an ASCII `"` that stands alone is code — a YAML string
// (`statblock: "Roll20: Fenn"`), a markup literal — and stays untouched.

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root — this file sits in server/test/. */
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

/** `„` and, later on the same line, an ASCII `"` with no `“` in between. */
export const MIXED_QUOTES = /„[^“\n]*"/;

async function promptFiles(dir: string, extensions: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await promptFiles(full, extensions)));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

/** Every offending `<file>:<line>` of one file. */
async function offenders(file: string): Promise<string[]> {
  const text = await readFile(file, "utf8");
  return text
    .split("\n")
    .map((line, index) =>
      MIXED_QUOTES.test(line) ? `${path.relative(ROOT, file)}:${index + 1}` : "",
    )
    .filter((hit) => hit !== "");
}

describe("German quotation marks", () => {
  test("the rule catches the PO spelling and passes the correct one", () => {
    expect(MIXED_QUOTES.test('er sagt „Salzhafen" und meint es')).toBe(true);
    expect(MIXED_QUOTES.test("er sagt „Salzhafen“ und meint es")).toBe(false);
    // An ASCII quote that is CODE, on a line without an opening quote.
    expect(MIXED_QUOTES.test('statblock: "Roll20: Fenn"')).toBe(false);
    // …and one that is code AFTER a properly closed quotation.
    expect(MIXED_QUOTES.test('„Fenn“ hat statblock: "Roll20: Fenn"')).toBe(false);
  });

  test("no prompt and no few-shot mixes them", async () => {
    const files = await promptFiles(path.join(ROOT, "generator"), [".md", ".json"]);
    expect(files.length).toBeGreaterThan(5);
    const hits = (await Promise.all(files.map(offenders))).flat();
    expect(hits).toEqual([]);
  });

  test("no file of the example campaign mixes them", async () => {
    const files = await promptFiles(path.join(ROOT, "examples"), [".md"]);
    expect(files.length).toBeGreaterThan(5);
    const hits = (await Promise.all(files.map(offenders))).flat();
    expect(hits).toEqual([]);
  });
});
