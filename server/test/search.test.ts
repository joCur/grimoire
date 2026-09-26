// Search + version tests, over the FTS5 index.
//
// Search is a query against the `search_fts` table, maintained by the store
// on every write (store/fts.ts). There is nothing to invalidate — a case
// gets a fresh in-memory database seeded from `fixtures/` and asks the
// endpoint.
//
// The two properties the reference queries below rely on are PREFIX terms (a
// half-typed query matches) and DIACRITIC FOLDING (the
// `unicode61 remove_diacritics 2` tokenizer). Fuzzy/typo tolerance is NOT
// part of the contract: prefix plus folding is what search offers, and
// genuine typo tolerance would need a trigram tokenizer and is a documented
// later option.

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
  const res = await app.request(`/api/campaigns/example/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { results: SearchResult[] };
  expect(Array.isArray(body.results)).toBe(true);
  return body.results;
}

/** Write one npc on its own resource (decisions/resources) — its fields flat. */
async function patchNpc(id: string, fields: Record<string, unknown>): Promise<Response> {
  const read = await app.request(`/api/campaigns/example/npcs/${id}`);
  const { rev } = (await read.json()) as { rev: number };
  return app.request(`/api/campaigns/example/npcs/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev, ...fields }),
  });
}

/** Write one location on its own resource — its fields flat. */
async function patchLocation(id: string, fields: Record<string, unknown>): Promise<Response> {
  const read = await app.request(`/api/campaigns/example/locations/${id}`);
  const { rev } = (await read.json()) as { rev: number };
  return app.request(`/api/campaigns/example/locations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev, ...fields }),
  });
}

/** Read one scene on its own resource — the write cases below need its guard token. */
async function readScene(id: string): Promise<{ rev: number; body: string }> {
  const res = await app.request(`/api/campaigns/example/scenes/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { rev: number; body: string };
}

// --- the query builder and the score transform ------------------------------

describe("ftsQuery", () => {
  test("every token becomes a quoted prefix term, ANDed", () => {
    expect(ftsQuery("light")).toBe('"light"*');
    expect(ftsQuery("lighthouse keeper")).toBe('"lighthouse"* "keeper"*');
    // punctuation is a separator, not a term
    expect(ftsQuery("  jorna,  harbour ")).toBe('"jorna"* "harbour"*');
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

describe("GET /api/campaigns/:campaign/search", () => {
  test("400 on missing or empty q", async () => {
    expect((await app.request("/api/campaigns/example/search")).status).toBe(400);
    expect((await app.request("/api/campaigns/example/search?q=")).status).toBe(400);
    expect((await app.request("/api/campaigns/example/search?q=%20%20")).status).toBe(400);
  });

  test("404 for an unknown campaign, 400 for an unsafe id", async () => {
    expect((await app.request("/api/campaigns/nope/search?q=Fenn")).status).toBe(404);
    expect((await app.request("/api/campaigns/..%2fexample/search?q=Fenn")).status).toBe(400);
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
    expect(await search("qxzvywunknown")).toEqual([]);
  });
});

// --- the reference queries -------------------------------------------------

describe("reference queries", () => {
  test("'jorna' puts the NPC first — title/ref outweigh a body mention", async () => {
    const results = await search("jorna");
    expect(results[0]).toMatchObject({
      kind: "npc",
      id: "jorna",
      title: "Harbourmaster Jorna",
    });
    // An npc is its own resource (decisions/resources): the hit names it by kind and id.
    expect(Object.hasOwn(results[0]!, "path")).toBe(false);
    // the scene that has her in `npcs:` and in its prose is found too, below her
    expect(results.some((r) => r.kind === "scene" && r.id === "lighthouse-arrival")).toBe(true);
  });

  test("'lightho' finds the chapter, the location and the campaign (prefix)", async () => {
    // Nobody types "Lighthouse" in full into ⌘K — prefix matching is what
    // makes a partial word enough.
    const results = await search("lightho");
    const byKind = new Map(results.map((r) => [r.kind, r]));
    // Every entity is its own resource (decisions/resources): a hit names its kind and id
    // and carries no address.
    expect(byKind.get("chapter")).toMatchObject({
      id: "01-salt-harbour",
      title: "Chapter 1: The Lighthouse of Salt Harbour",
    });
    expect(Object.hasOwn(byKind.get("chapter")!, "path")).toBe(false);
    expect(byKind.get("location")).toMatchObject({
      id: "lighthouse",
      title: "The Lighthouse of Salt Harbour",
    });
    expect(Object.hasOwn(byKind.get("location")!, "path")).toBe(false);
    expect(byKind.get("campaign")).toMatchObject({
      id: "example",
      title: "The Lighthouse of Salt Harbour",
    });
    expect(Object.hasOwn(byKind.get("campaign")!, "path")).toBe(false);
    // and the scene: no address either.
    const scene = results.find((r) => r.kind === "scene" && r.id === "lighthouse-arrival");
    expect(scene).toMatchObject({ id: "lighthouse-arrival", title: "Arrival at the Lighthouse" });
    expect(Object.hasOwn(scene!, "path")).toBe(false);
  });

  test("diacritics are folded both ways: 'cafe' finds a café in a field and 'café' a cafe", async () => {
    // The example campaign is plain ASCII, so the accented word is written here.
    const res = await patchLocation("lighthouse", {
      atmosphere: "Quieter than the café by the quay.",
    });
    expect(res.status).toBe(200);
    expect((await search("cafe")).some((r) => r.kind === "location" && r.id === "lighthouse")).toBe(
      true,
    );
    const cove = await patchLocation("cove", { atmosphere: "Louder than the cafe by the quay." });
    expect(cove.status).toBe(200);
    expect((await search("café")).some((r) => r.kind === "location" && r.id === "cove")).toBe(true);
  });

  test("a body match carries a snippet with context", async () => {
    const results = await search("spiral"); // only in the location body
    const location = results.find((r) => r.id === "lighthouse");
    expect(location).toBeDefined();
    expect(location!.snippet).toContain("spiral");
    expect(location!.snippet!.length).toBeLessThanOrEqual(140);
  });

  test("tag query: 'social' finds BOTH example scenes", async () => {
    const results = await search("social");
    const scenes = results.filter((r) => r.kind === "scene").map((r) => r.id);
    expect(scenes.sort()).toEqual(["lighthouse-arrival", "smuggler-captured"]);
  });

  test("glossary terms are indexed too: 'lighthouse keeper'", async () => {
    // A glossary term is its own entity (decisions/resources), so a hit names it by its
    // kind and its id like every other hit; the app opens the glossary page.
    const results = await search("lighthouse keeper");
    const entry = results.find((r) => r.kind === "glossary-term");
    expect(entry).toMatchObject({ id: "lighthouse-keeper", title: "lighthouse keeper" });
    // the explanation is the body, so a word of it finds the term too
    expect(
      (await search("capitalised")).some((r) => r.kind === "glossary-term"),
    ).toBe(true);
  });
});

// --- index maintenance ------------------------------------------------------

describe("the index follows every write", () => {
  test("a body written through the scene PATCH is searchable immediately", async () => {
    // The write and the index row are one transaction, so there is no window
    // in which the DM cannot find what they just typed.
    expect(await search("nightwatch")).toEqual([]);

    const entry = await readScene("lighthouse-arrival");
    const res = await app.request("/api/campaigns/example/scenes/lighthouse-arrival", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rev: entry.rev,
        body: `${entry.body}\n## Nightwatch\n\nSomeone keeps watch at the tower.\n`,
      }),
    });
    expect(res.status).toBe(200);

    const results = await search("nightwatch");
    expect(results.some((r) => r.kind === "scene" && r.id === "lighthouse-arrival")).toBe(true);
  });

  test("a field write re-indexes the name", async () => {
    expect(await search("cove-skipper")).toEqual([]);

    const res = await patchNpc("fenn", { name: "Cove-Skipper Fenn" });
    expect(res.status).toBe(200);

    const results = await search("cove-skipper");
    expect(results[0]).toMatchObject({ kind: "npc", id: "fenn", title: "Cove-Skipper Fenn" });
  });

  test("motivation and atmosphere are indexed, and a patch re-indexes them", async () => {
    // The seeded values: jorna's motivation names the autumn convoys, the
    // cove's atmosphere says there is no romance there.
    expect((await search("convoys")).some((r) => r.kind === "npc" && r.id === "jorna")).toBe(
      true,
    );
    expect((await search("romance")).some((r) => r.kind === "location" && r.id === "cove")).toBe(
      true,
    );

    const res = await patchNpc("jorna", { motivation: "Survive the storm surge." });
    expect(res.status).toBe(200);
    expect((await search("surge")).some((r) => r.id === "jorna")).toBe(true);
    expect((await search("convoys")).some((r) => r.id === "jorna")).toBe(false);
  });

  test("a field write does not un-index an npc's relationship note", async () => {
    // ONE rule for the indexed text of an npc: its motivation and its whole
    // text. A status change must not drop `## Relationships` out of the index.
    expect((await search("eyes")).some((r) => r.id === "fenn")).toBe(true);
    const res = await patchNpc("fenn", { status: "dead" });
    expect(res.status).toBe(200);
    expect((await search("eyes")).some((r) => r.id === "fenn")).toBe(true);
  });
});

// --- GET /api/campaigns/:campaign/version ---------------------------------------------

describe("GET /api/campaigns/:campaign/version", () => {
  async function version(): Promise<number> {
    const res = await app.request("/api/campaigns/example/version");
    expect(res.status).toBe(200);
    return ((await res.json()) as { version: number }).version;
  }

  test("polling alone never bumps; a write does (in the same transaction)", async () => {
    // The version counter of decisions/polling: with the database as the only
    // truth there is no external editor to watch, so the version is bumped BY
    // the write.
    const before = await version();
    expect(await version()).toBe(before);

    const res = await app.request("/api/campaigns/example/ideas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Note from the version test" }),
    });
    expect(res.status).toBe(201);
    expect(await version()).toBeGreaterThan(before);
  });

  test("404 for an unknown campaign", async () => {
    expect((await app.request("/api/campaigns/nope/version")).status).toBe(404);
  });
});
