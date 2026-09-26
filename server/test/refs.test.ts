// `[[slug]]` body references, server side.
//
// The renderer resolves references in the browser; the SEARCH INDEX has to
// resolve them when it is written, or a body that only says `[[jorna]]` is
// never findable under "Hafenmeisterin Jorna". These cases pin the three
// halves of that: the expansion itself, the re-index of the REFERRING
// entities when a display name changes, and who counts as a referrer at all.


import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SearchResult } from "@grimoire/shared";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { expandCampaignBodyRefs, referrersOf } from "../src/store/refs";
import { dropStore, seedStore } from "./support/store";

/** A scene of the example campaign we overwrite with reference prose — its own resource. */
const SCENE = "/api/campaigns/beispiel/scenes/lighthouse-arrival";
/** The example chapter and the campaign, each its own resource too. */
const CHAPTER = "/api/campaigns/beispiel/chapters/01-salzhafen";
const CAMPAIGN = "/api/campaigns/beispiel";

/**
 * The seed's OWN reference to jorna: fenn's `## Beziehungen` names her as
 * `- [[jorna]]: …`, which is a body reference like any other mention. Every
 * expectation about who refers to jorna carries it, at the position the kind
 * order gives it (scene, npc, location, chapter, campaign).
 */
const FENN_REFERS_TO_JORNA = { kind: "npc", id: "fenn" } as const;

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

async function readBody(url: string): Promise<{ rev: number; body: string }> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return (await res.json()) as { rev: number; body: string };
}

/** Write the text of a scene, a chapter or the campaign — a `{ rev, body }` PATCH on its resource. */
async function writeBody(url: string, body: string): Promise<void> {
  const current = await readBody(url);
  const res = await app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: current.rev, body }),
  });
  expect(res.status).toBe(200);
}

/** Write fields of an npc — its own resource, fields flat, `body` among them (ADR #31). */
async function patchNpc(id: string, fields: Record<string, unknown>): Promise<void> {
  const url = `/api/campaigns/beispiel/npcs/${id}`;
  const npc = (await (await app.request(url)).json()) as { rev: number };
  const res = await app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: npc.rev, ...fields }),
  });
  expect(res.status).toBe(200);
}

/** Write fields of a location — its own resource, fields flat (ADR #31). */
async function patchLocation(id: string, fields: Record<string, unknown>): Promise<void> {
  const url = `/api/campaigns/beispiel/locations/${id}`;
  const location = (await (await app.request(url)).json()) as { rev: number };
  const res = await app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: location.rev, ...fields }),
  });
  expect(res.status).toBe(200);
}

/** Create a scene with an EXPLICIT id, so a slug can be claimed on purpose. */
async function createScene(title: string, chapter: string, id: string): Promise<void> {
  const res = await app.request("/api/campaigns/beispiel/scenes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, chapter, id }),
  });
  expect(res.status).toBe(201);
}

async function search(q: string): Promise<SearchResult[]> {
  const res = await app.request(`/api/campaigns/beispiel/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: SearchResult[] }).results;
}

const findsScene = (results: SearchResult[]): boolean =>
  results.some((r) => r.kind === "scene" && r.id === "lighthouse-arrival");

describe("expandCampaignBodyRefs", () => {
  test("resolves the three kinds and leaves unknown slugs alone", async () => {
    const db = await getDb();
    expect(expandCampaignBodyRefs(db, "beispiel", "[[jorna]] am [[leuchtturm]].")).toBe(
      "Hafenmeisterin Jorna am Der Leuchtturm von Salzhafen.",
    );
    expect(expandCampaignBodyRefs(db, "beispiel", "Szene [[lighthouse-arrival]]")).toBe(
      "Szene Ankunft am Leuchtturm",
    );
    expect(expandCampaignBodyRefs(db, "beispiel", "Wer ist [[niemand]]?")).toBe("Wer ist [[niemand]]?");
  });

  test("a body without a reference is returned untouched", async () => {
    const db = await getDb();
    expect(expandCampaignBodyRefs(db, "beispiel", "Nur Prosa.")).toBe("Nur Prosa.");
  });

  test("code regions are indexed literally — the index says what the page shows", async () => {
    const db = await getDb();
    const body = "[[jorna]] winkt.\n\nDie Syntax: `[[jorna]]`.\n\n```\n[[jorna]]\n```\n";
    expect(expandCampaignBodyRefs(db, "beispiel", body)).toBe(
      "Hafenmeisterin Jorna winkt.\n\nDie Syntax: `[[jorna]]`.\n\n```\n[[jorna]]\n```\n",
    );
  });
});

describe("the index resolves references", () => {
  test("a scene that only holds the slug is findable under the name", async () => {
    await writeBody(SCENE, "## Flow\n\nAm Kai wartet [[jorna]]s Boot.\n");
    // The stored body keeps the SLUG — the format never stores names.
    expect((await readBody(SCENE)).body).toContain("[[jorna]]");
    expect(findsScene(await search("Hafenmeisterin"))).toBe(true);
  });

  test("an unresolved reference stays literal in the index (no invention)", async () => {
    await writeBody(SCENE, "## Flow\n\nNach [[niemand]] hat keiner gefragt.\n");
    expect(findsScene(await search("niemand"))).toBe(true);
  });

  test("renaming the display NAME re-indexes the referring scene", async () => {
    await writeBody(SCENE, "## Flow\n\nAm Kai wartet [[jorna]]s Boot.\n");
    expect(findsScene(await search("Salzhand"))).toBe(false);

    await patchNpc("jorna", { name: "Jorna Salzhand" });

    // The scene's own row never changed — only what its indexed text says.
    expect((await readBody(SCENE)).body).toContain("[[jorna]]");
    expect(findsScene(await search("Salzhand"))).toBe(true);
    expect(findsScene(await search("Hafenmeisterin"))).toBe(false);
  });

  test("mutual references do not loop the re-index cascade", async () => {
    // Two entities that mention each other: the cascade latch (write.ts) is
    // what keeps this from ping-ponging forever.
    await writeBody(SCENE, "## Flow\n\n[[jorna]] und [[fenn]].\n");
    await patchNpc("jorna", { body: "## Will\n\nDass [[fenn]] verschwindet.\n" });
    await patchNpc("fenn", { body: "## Will\n\nDass [[jorna]] schweigt.\n" });
    await patchNpc("fenn", { name: "Fenn Silberring" });
    expect((await search("Silberring")).some((r) => r.id === "jorna")).toBe(true);
  });
});

describe("referrersOf", () => {
  test("finds every body kind that mentions the slug", async () => {
    await writeBody(SCENE, "## Flow\n\n[[jorna]] wartet.\n");
    await patchLocation("leuchtturm", { body: "[[jorna]] hat den Schl\u00fcssel.\n" });
    await writeBody(CHAPTER, "## Ziel\n\n[[jorna]] zahlt.\n");
    const db = await getDb();
    expect(referrersOf(db, "beispiel", "jorna")).toEqual([
      { kind: "scene", id: "lighthouse-arrival" },
      FENN_REFERS_TO_JORNA,
      { kind: "location", id: "leuchtturm" },
      { kind: "chapter", id: "01-salzhafen" },
    ]);
  });

  test("a mention only inside code is no referrer at all", async () => {
    await writeBody(
      SCENE,
      "## Flow\n\nDie Syntax hei\u00dft `[[jorna]]`.\n\n```\n[[jorna]]\n```\n",
    );
    const db = await getDb();
    // The scene drops out; what stays is the seed's own relations line.
    expect(referrersOf(db, "beispiel", "jorna")).toEqual([FENN_REFERS_TO_JORNA]);
  });

  test("a shadowed slug is not hijacked: the OWNER's kind decides", async () => {
    // Two entities called `jorna`: the npc owns the slug (kind priority
    // npc > location > scene), so `[[jorna]]` in prose is the NPC.
    await createScene("Jorna", "01-salzhafen", "jorna");
    await patchLocation("leuchtturm", { body: "## Flow\n\nAm Kai wartet [[jorna]]s Boot.\n" });
    const db = await getDb();
    expect(expandCampaignBodyRefs(db, "beispiel", "[[jorna]]")).toBe("Hafenmeisterin Jorna");
    expect((await search("Hafenmeisterin")).some((r) => r.kind === "location")).toBe(true);
  });

  test("a reference in a motivation or an atmosphere is a referrer too", async () => {
    // The cards show these properties with the reference as a NAME, and the
    // index spells it out — so a rename has to find them.
    await patchNpc("fenn", { motivation: "Weg von [[jorna]], bevor sie fragt." });
    await patchLocation("bucht", { atmosphere: "Hier schaut [[jorna]] nie vorbei." });
    const db = await getDb();
    expect(referrersOf(db, "beispiel", "jorna")).toEqual([
      FENN_REFERS_TO_JORNA,
      { kind: "location", id: "bucht" },
    ]);

    await patchNpc("jorna", { name: "Jorna Salzhand" });
    const hits = await search("Salzhand");
    expect(hits.some((r) => r.kind === "location" && r.id === "bucht")).toBe(true);
  });

  test("the campaign body is a full reference site", async () => {
    await writeBody(CAMPAIGN, "Notiz: [[jorna]] ist bestechlich.\n");
    const db = await getDb();
    expect(referrersOf(db, "beispiel", "jorna")).toEqual([
      FENN_REFERS_TO_JORNA,
      { kind: "campaign", id: "beispiel" },
    ]);

    // A NAME change re-indexes the campaign row like any other referrer.
    await patchNpc("jorna", { name: "Jorna Salzhand" });
    expect((await search("Salzhand")).some((r) => r.kind === "campaign")).toBe(true);
  });
});

describe("the seed expands references (second pass)", () => {
  test("a seeded body is findable under the referenced NAME", async () => {
    // The seed writes one index row per object AS IT GOES, and a body can
    // reference a row that does not exist yet at that moment — so the
    // expansion is a second pass at the end of the load (db/seed.ts). This
    // case is what exercises it: the scene's body names jorna by reference,
    // and the search has to find it under her display name.
    await seedStore({
      scenes: [
        {
          id: "seeded-ref",
          title: "Referenz aus dem Seed",
          type: "planned",
          chapter: "01-salzhafen",
          npcs: [],
          handouts: [],
          tags: [],
          status: "draft",
          body: "\n## Flow\n\nAm Kai wartet [[jorna]]s Boot.\n",
        },
      ],
    });
    expect(
      (await search("Hafenmeisterin")).some((r) => r.kind === "scene" && r.id === "seeded-ref"),
    ).toBe(true);
  });
});
