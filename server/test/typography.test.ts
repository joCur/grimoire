// The typographic guard of the German quotation marks.
//
// A model can write a German quotation as the opening U+201E closed by an
// ASCII `"`. Inside a JSON string that `"` would end the string; the escaping
// is the TRANSPORT's job (the reply is a forced object and the body a string
// it serializes), so that breakage cannot happen. The MIXED spelling itself
// is ours to prevent: the model imitates what it reads, so nothing it reads
// may carry it.
//
// So this test forbids the mixed form everywhere the model can see it: the
// system prompts (`.md`), the few-shot REPLIES (`.json`) and the example
// campaign in `fixtures/`. A few-shot is one JSON object whose body is a
// single string, so a whole scene sits on one line — the rule still reads it
// correctly, because a correctly closed `„…“` cannot be crossed and the string
// delimiter always stands after it. The catalog carries the same guard over
// its VALUES (a raw scan of `de.ts` cannot tell a closing quotation mark from
// the TypeScript string delimiter) — see app/src/i18n/i18n.test.ts.
//
// The rule is deliberately narrow: an opening `„` followed, on the SAME line,
// by an ASCII `"`. Every quotation mark in these files opens and closes on one
// line, and an ASCII `"` that stands alone is code — a YAML string
// (`statblock: "Roll20: Fenn"`), a markup literal — and stays untouched.

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root — this module sits in server/test/. */
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

/** Every offending `<path>:<line>` of one source. */
async function offenders(source: string): Promise<string[]> {
  const text = await readFile(source, "utf8");
  return text
    .split("\n")
    .map((line, index) =>
      MIXED_QUOTES.test(line) ? `${path.relative(ROOT, source)}:${index + 1}` : "",
    )
    .filter((hit) => hit !== "");
}

describe("German quotation marks", () => {
  test("the rule catches the mixed spelling and passes the correct one", () => {
    expect(MIXED_QUOTES.test('he says „Salt Harbour" and means it')).toBe(true);
    expect(MIXED_QUOTES.test("he says „Salt Harbour“ and means it")).toBe(false);
    // An ASCII quote that is CODE, on a line without an opening quote.
    expect(MIXED_QUOTES.test('statblock: "Roll20: Fenn"')).toBe(false);
    // …and one that is code AFTER a properly closed quotation.
    expect(MIXED_QUOTES.test('„Fenn“ has statblock: "Roll20: Fenn"')).toBe(false);
  });

  test("no prompt and no few-shot mixes them", async () => {
    const files = await promptFiles(path.join(ROOT, "generator"), [".md", ".json"]);
    expect(files.length).toBeGreaterThan(5);
    const hits = (await Promise.all(files.map(offenders))).flat();
    expect(hits).toEqual([]);
  });

  test("nothing in the example campaign mixes them", async () => {
    const files = await promptFiles(path.join(ROOT, "fixtures"), [".json"]);
    expect(files.length).toBeGreaterThan(5);
    const hits = (await Promise.all(files.map(offenders))).flat();
    expect(hits).toEqual([]);
  });
});
