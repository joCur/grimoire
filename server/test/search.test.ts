// Search + version tests (issues #7/#8, ported to FTS5 in issue #57).
//
// Fuse.js and the in-memory index are gone: search is a query against the
// `search_fts` table, maintained by the store on every write (store/fts.ts).
// So there is nothing to invalidate any more — a case gets a fresh in-memory
// database seeded from `examples/` and asks the endpoint.
//
// The two properties the reference queries of issue #57 AK5 rely on are
// PREFIX terms (a half-typed query matches) and DIACRITIC FOLDING (the
// `unicode61 remove_diacritics 2` tokenizer). What is NOT here any more is
// fuzzy/typo tolerance — that was Fuse's, and its replacement is prefix plus
// folding; genuine typo tolerance would need a trigram tokenizer and is a
// documented later option.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SearchResult } from "@grimoire/shared";
import { app } from "../src/server";
import { ftsQuery, scoreFromRank } from "../src/store/search";
import { dropStore, seedStore } from "./support/store";

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

async function search(q: string): Promise<SearchResult[]> {
  const res = await app.request(`/api/beispiel/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { results: SearchResult[] };
  expect(Array.isArray(body.results)).toBe(true);
  return body.results;
}

/** GET /file, for the write cases below (they need the guard token). */
async function readFile(rel: string): Promise<{ rev: number; body: string }> {
  const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { rev: number; body: string };
}

// --- the query builder and the score transform ------------------------------

describe("ftsQuery", () => {
  test("every token becomes a quoted prefix term, ANDed", () => {
    expect(ftsQuery("leucht")).toBe('"leucht"*');
    expect(ftsQuery("lighthouse keeper")).toBe('"lighthouse"* "keeper"*');
    // punctuation is a separator, not a term
    expect(ftsQuery("  jorna,  hafen ")).toBe('"jorna"* "hafen"*');
  });

  test("FTS5 operators inside the input cannot become syntax", () => {
    // Everything a user may type — operators, colons, carets, stray quotes —
    // ends up INSIDE a quoted string, where FTS5 reads it as text.
    expect(ftsQuery("AND OR NOT")).toBe('"AND"* "OR"* "NOT"*');
    expect(ftsQuery('title:^"x*')).toBe('"title"* "x"*');
  });

  test("a query without a single usable token yields undefined", () => {
    // The endpoint answers an empty result list for these instead of letting
    // an empty MATCH expression reach SQLite.
    for (const junk of ["...", "-", "??? !!!", "   "]) {
      expect(ftsQuery(junk)).toBeUndefined();
    }
  });
});

describe("scoreFromRank", () => {
  test("bm25 (negative, lower is better) maps into 0..1 monotonically", () => {
    // The API's `score` contract is unchanged: 0 is a perfect match, values
    // grow toward 1 — so a STRONGER bm25 must produce a SMALLER score.
    const strong = scoreFromRank(-20);
    const weak = scoreFromRank(-0.5);
    expect(strong).toBeLessThan(weak);
    expect(strong).toBeGreaterThan(0);
    expect(weak).toBeLessThanOrEqual(1);
    // a non-negative rank (never produced by bm25, but harmless) saturates
    expect(scoreFromRank(0)).toBe(1);
    expect(scoreFromRank(5)).toBe(1);
  });
});

// --- the endpoint contract ---------------------------------------------------

describe("GET /api/:campaign/search", () => {
  test("400 on missing or empty q", async () => {
    expect((await app.request("/api/beispiel/search")).status).toBe(400);
    expect((await app.request("/api/beispiel/search?q=")).status).toBe(400);
    expect((await app.request("/api/beispiel/search?q=%20%20")).status).toBe(400);
  });

  test("404 for an unknown campaign, 400 for an unsafe id", async () => {
    expect((await app.request("/api/nope/search?q=Fenn")).status).toBe(404);
    expect((await app.request("/api/..%2fbeispiel/search?q=Fenn")).status).toBe(400);
  });

  test("results are capped at 20 and every score is a number in 0..1", async () => {
    // "e" as a prefix matches nearly everything the campaign has — the cap
    // and the score contract have to hold for a query like that too.
    const results = await search("e");
    expect(results.length).toBeLessThanOrEqual(20);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  test("a query of pure punctuation is an empty list, not an error", async () => {
    // No token survives tokenization, so there is nothing to MATCH — the
    // endpoint must answer 200 [] instead of pushing an empty expression at
    // SQLite (which would be a syntax error).
    expect(await search("...")).toEqual([]);
    expect(await search("#")).toEqual([]);
  });

  test("nonsense query yields empty results", async () => {
    expect(await search("qxzvywunbekannt")).toEqual([]);
  });
});

// --- the reference queries of issue #57 AK5 ---------------------------------

describe("reference queries (issue #57 AK5)", () => {
  test("'jorna' puts the NPC first — title/ref outweigh a body mention", async () => {
    const results = await search("jorna");
    expect(results[0]).toMatchObject({
      kind: "npc",
      id: "jorna",
      title: "Hafenmeisterin Jorna",
      path: "npcs/jorna",
    });
    // the scene that has her in `npcs:` and in its prose is found too, below her
    expect(results.some((r) => r.kind === "scene" && r.id === "lighthouse-arrival")).toBe(true);
  });

  test("'leucht' finds the chapter, the location and the campaign (prefix)", async () => {
    // Nobody types "Leuchtturm" in full into ⌘K — this is the property that
    // replaced Fuse's fuzziness.
    const results = await search("leucht");
    const byKind = new Map(results.map((r) => [r.kind, r]));
    expect(byKind.get("chapter")).toMatchObject({
      id: "01-salzhafen",
      title: "Kapitel 1: Der Leuchtturm von Salzhafen",
      path: "01-salzhafen/_chapter",
    });
    expect(byKind.get("location")).toMatchObject({
      id: "leuchtturm",
      title: "Der Leuchtturm von Salzhafen",
      path: "locations/leuchtturm",
    });
    expect(byKind.get("campaign")).toMatchObject({
      id: "beispiel",
      title: "Der Leuchtturm von Salzhafen",
      path: "_campaign",
    });
    // and the scene, whose path is derived from its ID now (store/paths)
    expect(results.find((r) => r.kind === "scene" && r.id === "lighthouse-arrival")).toMatchObject({
      id: "lighthouse-arrival",
      title: "Ankunft am Leuchtturm",
      path: "01-salzhafen/hafen/lighthouse-arrival",
    });
  });

  test("diacritics are folded: 'lampenol' finds the Lampenöl body", async () => {
    const results = await search("lampenol");
    expect(results.some((r) => r.kind === "location" && r.id === "leuchtturm")).toBe(true);
  });

  test("a body match carries a snippet with context", async () => {
    const results = await search("Lampenöl"); // only in the location body
    const location = results.find((r) => r.id === "leuchtturm");
    expect(location).toBeDefined();
    expect(location!.snippet).toContain("Lampenöl");
    expect(location!.snippet!.length).toBeLessThanOrEqual(140);
  });

  test("tag query: 'social' finds BOTH example scenes", async () => {
    const results = await search("social");
    const scenes = results.filter((r) => r.kind === "scene").map((r) => r.id);
    expect(scenes.sort()).toEqual(["lighthouse-arrival", "smuggler-captured"]);
  });

  test("glossary terms are indexed too: 'lighthouse keeper'", async () => {
    // New with the cutover — the glossary is a TABLE now (planning F6), so it
    // is a searchable kind instead of one opaque markdown file.
    const results = await search("lighthouse keeper");
    const entry = results.find((r) => r.kind === "glossary");
    expect(entry).toMatchObject({
      id: "lighthouse keeper",
      title: "lighthouse keeper",
      path: "glossary",
    });
    // the explanation is the body, so it is searchable from the German side
    expect(
      (await search("Leuchtturmwärter")).some((r) => r.kind === "glossary"),
    ).toBe(true);
  });
});

// --- index maintenance ------------------------------------------------------

describe("the index follows every write", () => {
  test("a body written through PUT /file is searchable immediately", async () => {
    // The guarantee that replaced invalidateCampaign(): the write and the
    // index row are one transaction, so there is no window in which the DM
    // cannot find what they just typed.
    const rel = "01-salzhafen/hafen/lighthouse-arrival";
    expect(await search("nachtwache")).toEqual([]);

    const file = await readFile(rel);
    const res = await app.request("/api/beispiel/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: rel,
        rev: file.rev,
        body: `${file.body}\n## Nachtwache\n\nJemand hält Wache am Turm.\n`,
      }),
    });
    expect(res.status).toBe(200);

    const results = await search("nachtwache");
    expect(results.some((r) => r.kind === "scene" && r.id === "lighthouse-arrival")).toBe(true);
  });

  test("a properties patch re-indexes title and tags", async () => {
    const rel = "npcs/fenn";
    expect(await search("bucht-kapitaen")).toEqual([]);

    const file = await readFile(rel);
    const res = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: rel,
        rev: file.rev,
        patch: { name: "Bucht-Kapitaen Fenn" },
      }),
    });
    expect(res.status).toBe(200);

    const results = await search("bucht-kapitaen");
    expect(results[0]).toMatchObject({ kind: "npc", id: "fenn", title: "Bucht-Kapitaen Fenn" });
  });

  test("a renamed entity is findable under its NEW id", async () => {
    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "jorna", newId: "hafenmeisterin" }),
    });
    expect(res.status).toBe(200);

    const byNewId = await search("hafenmeisterin");
    expect(byNewId.some((r) => r.kind === "npc" && r.id === "hafenmeisterin")).toBe(true);
    // the old id is gone as a REFERENCE — the display name still says Jorna,
    // so searching for her name keeps working (that is not an id).
    const byOldId = await search("jorna");
    expect(byOldId.some((r) => r.kind === "npc" && r.id === "jorna")).toBe(false);
    expect(byOldId.some((r) => r.kind === "npc" && r.id === "hafenmeisterin")).toBe(true);
  });

  test("a rename refreshes the index TITLE, not only the id", async () => {
    // The bug: the rename patched `entity_id`/`ref` of the index row and left
    // `title` behind. For a display name that was the id's fallback that
    // means search kept offering the OLD name and never the new one.
    const file = await readFile("npcs/fenn");
    // make the name the id's spelled-out fallback, as an authored file may
    const patch = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "npcs/fenn", rev: file.rev, patch: { name: "fenn" } }),
    });
    expect(patch.status).toBe(200);

    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "fenn", newId: "schmugglerkapitaen" }),
    });
    expect(res.status).toBe(200);

    const hits = await search("schmugglerkapitaen");
    expect(hits[0]).toMatchObject({ kind: "npc", id: "schmugglerkapitaen", title: "schmugglerkapitaen" });
    // and the stale title is not in the index any more
    expect((await search("fenn")).some((r) => r.title === "fenn")).toBe(false);
  });

  test("a properties patch does not un-index an npc's relationship note", async () => {
    // The two npc writers indexed different text (patch: the stripped body,
    // body save: the full one), so an unrelated status change dropped
    // `## Beziehungen` out of the index. ONE rule now: the full document.
    expect((await search("Blick")).some((r) => r.id === "fenn")).toBe(true);
    const file = await readFile("npcs/fenn");
    const res = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "npcs/fenn", rev: file.rev, patch: { status: "dead" } }),
    });
    expect(res.status).toBe(200);
    expect((await search("Blick")).some((r) => r.id === "fenn")).toBe(true);
  });
});

// --- GET /api/:campaign/version ---------------------------------------------

describe("GET /api/:campaign/version", () => {
  async function version(): Promise<number> {
    const res = await app.request("/api/beispiel/version");
    expect(res.status).toBe(200);
    return ((await res.json()) as { version: number }).version;
  }

  test("polling alone never bumps; a write does (in the same transaction)", async () => {
    // The counter replaced the chokidar watcher (DECISIONS #9): with the
    // database as the only truth there is no external editor left to watch,
    // so the version is bumped BY the write instead of by a file event.
    const before = await version();
    expect(await version()).toBe(before);

    const res = await app.request("/api/beispiel/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Notiz aus dem Versionstest" }),
    });
    expect(res.status).toBe(200);
    expect(await version()).toBeGreaterThan(before);
  });

  test("404 for an unknown campaign", async () => {
    expect((await app.request("/api/nope/version")).status).toBe(404);
  });
});
