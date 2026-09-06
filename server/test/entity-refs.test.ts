// `[[slug]]` body references, server side (issue #68).
//
// The renderer resolves references in the browser; the SEARCH INDEX has to
// resolve them when it is written, or a body that only says `[[jorna]]` is
// never findable under "Hafenmeisterin Jorna". These cases pin the three
// halves of that: the expansion itself, the re-index of the REFERRING
// entities when a display name changes, and the rename cascade that drags
// `[[oldId]]` along.

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SearchResult } from "@grimoire/shared";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { expandBodyRefs, referrersOf } from "../src/store/refs";
import {
  dropStore,
  removeTempRoot,
  seedStore,
  tempCampaignRoot,
} from "./support/store";

/** A scene of the example campaign we overwrite with reference prose. */
const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

async function readFile(rel: string): Promise<{ mtimeMs: number; body: string }> {
  const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { mtimeMs: number; body: string };
}

async function writeBody(rel: string, body: string): Promise<void> {
  const file = await readFile(rel);
  const res = await app.request("/api/beispiel/file", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, mtimeMs: file.mtimeMs, body }),
  });
  expect(res.status).toBe(200);
}

async function patch(rel: string, p: Record<string, unknown>): Promise<void> {
  const file = await readFile(rel);
  const res = await app.request("/api/beispiel/frontmatter", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, mtimeMs: file.mtimeMs, patch: p }),
  });
  expect(res.status).toBe(200);
}

async function rename(payload: Record<string, unknown>): Promise<{ changed: string[] }> {
  const res = await app.request("/api/beispiel/rename", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { changed: string[] };
}

async function usageOf(
  kind: string,
  id: string,
): Promise<{ groups: { ref: string; count: number }[] }> {
  const res = await app.request(`/api/beispiel/usage?kind=${kind}&id=${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { groups: { ref: string; count: number }[] };
}

async function search(q: string): Promise<SearchResult[]> {
  const res = await app.request(`/api/beispiel/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: SearchResult[] }).results;
}

const findsScene = (results: SearchResult[]): boolean =>
  results.some((r) => r.kind === "scene" && r.id === "lighthouse-arrival");

describe("expandBodyRefs", () => {
  test("resolves the three kinds and leaves unknown slugs alone", async () => {
    const db = await getDb();
    expect(expandBodyRefs(db, "beispiel", "[[jorna]] am [[leuchtturm]].")).toBe(
      "Hafenmeisterin Jorna am Der Leuchtturm von Salzhafen.",
    );
    expect(expandBodyRefs(db, "beispiel", "Szene [[lighthouse-arrival]]")).toBe(
      "Szene Ankunft am Leuchtturm",
    );
    expect(expandBodyRefs(db, "beispiel", "Wer ist [[niemand]]?")).toBe("Wer ist [[niemand]]?");
  });

  test("a body without a reference is returned untouched", async () => {
    const db = await getDb();
    expect(expandBodyRefs(db, "beispiel", "Nur Prosa.")).toBe("Nur Prosa.");
  });

  test("code regions are indexed literally — the index says what the page shows", async () => {
    const db = await getDb();
    const body = "[[jorna]] winkt.\n\nDie Syntax: `[[jorna]]`.\n\n```\n[[jorna]]\n```\n";
    expect(expandBodyRefs(db, "beispiel", body)).toBe(
      "Hafenmeisterin Jorna winkt.\n\nDie Syntax: `[[jorna]]`.\n\n```\n[[jorna]]\n```\n",
    );
  });
});

describe("the index resolves references", () => {
  test("a scene that only holds the slug is findable under the name", async () => {
    await writeBody(SCENE, "## Flow\n\nAm Kai wartet [[jorna]]s Boot.\n");
    // The stored body keeps the SLUG — the format never stores names.
    expect((await readFile(SCENE)).body).toContain("[[jorna]]");
    expect(findsScene(await search("Hafenmeisterin"))).toBe(true);
  });

  test("an unresolved reference stays literal in the index (no invention)", async () => {
    await writeBody(SCENE, "## Flow\n\nNach [[niemand]] hat keiner gefragt.\n");
    expect(findsScene(await search("niemand"))).toBe(true);
  });

  test("renaming the display NAME re-indexes the referring scene", async () => {
    await writeBody(SCENE, "## Flow\n\nAm Kai wartet [[jorna]]s Boot.\n");
    expect(findsScene(await search("Salzhand"))).toBe(false);

    await patch("npcs/jorna.md", { name: "Jorna Salzhand" });

    // The scene's own row never changed — only what its indexed text says.
    expect((await readFile(SCENE)).body).toContain("[[jorna]]");
    expect(findsScene(await search("Salzhand"))).toBe(true);
    expect(findsScene(await search("Hafenmeisterin"))).toBe(false);
  });

  test("mutual references do not loop the re-index cascade", async () => {
    // Two entities that mention each other: the cascade latch (write.ts) is
    // what keeps this from ping-ponging forever.
    await writeBody(SCENE, "## Flow\n\n[[jorna]] und [[fenn]].\n");
    await writeBody("npcs/jorna.md", "## Will\n\nDass [[fenn]] verschwindet.\n");
    await writeBody("npcs/fenn.md", "## Will\n\nDass [[jorna]] schweigt.\n");
    await patch("npcs/fenn.md", { name: "Fenn Silberring" });
    expect((await search("Silberring")).some((r) => r.id === "jorna")).toBe(true);
  });
});

describe("referrersOf and the rename cascade", () => {
  test("finds every body kind that mentions the slug", async () => {
    await writeBody(SCENE, "## Flow\n\n[[jorna]] wartet.\n");
    await writeBody("locations/leuchtturm.md", "[[jorna]] hat den Schlüssel.\n");
    await writeBody("01-salzhafen/_chapter.md", "## Ziel\n\n[[jorna]] zahlt.\n");
    const db = await getDb();
    expect(referrersOf(db, "beispiel", "jorna")).toEqual([
      { kind: "scene", id: "lighthouse-arrival" },
      { kind: "location", id: "leuchtturm" },
      { kind: "chapter", id: "01-salzhafen" },
    ]);
  });

  test("a mention only inside code is no referrer at all", async () => {
    await writeBody(SCENE, "## Flow\n\nDie Syntax heißt `[[jorna]]`.\n\n```\n[[jorna]]\n```\n");
    const db = await getDb();
    expect(referrersOf(db, "beispiel", "jorna")).toEqual([]);
  });

  test("GET /usage counts prose mentions as reference sites", async () => {
    await writeBody(SCENE, "## Flow\n\n[[jorna]] wartet.\n");
    const res = await app.request("/api/beispiel/usage?kind=npc&id=jorna");
    expect(res.status).toBe(200);
    const usage = (await res.json()) as { groups: { ref: string; count: number }[] };
    expect(usage.groups.find((g) => g.ref === "bodyRefs")?.count).toBe(1);
  });

  test("an id rename rewrites `[[oldId]]` and re-indexes the referrer", async () => {
    await writeBody(SCENE, "## Flow\n\nAm Kai wartet [[jorna]]s Boot.\n");
    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "jorna", newId: "jorna-salzhand" }),
    });
    expect(res.status).toBe(200);

    const body = (await readFile(SCENE)).body;
    expect(body).toContain("[[jorna-salzhand]]");
    expect(body).not.toContain("[[jorna]]");
    // Still findable under the (unchanged) display name.
    expect(findsScene(await search("Hafenmeisterin"))).toBe(true);
  });

  test("a rename leaves a quoted `[[slug]]` in code byte-identical", async () => {
    const body = "## Flow\n\n[[jorna]] winkt.\n\nDie Syntax: `[[jorna]]`.\n";
    await writeBody(SCENE, body);
    await rename({ kind: "npc", oldId: "jorna", newId: "jorna-salzhand" });
    expect((await readFile(SCENE)).body).toBe(
      "## Flow\n\n[[jorna-salzhand]] winkt.\n\nDie Syntax: `[[jorna]]`.\n",
    );
  });

  test("a shadowed slug is not hijacked: the OWNER's kind decides", async () => {
    // Two entities called `jorna`: the npc owns the slug (kind priority
    // npc > location > scene), so `[[jorna]]` in prose is the NPC.
    await rename({ kind: "scene", oldId: "lighthouse-arrival", newId: "jorna" });
    const prose = "## Flow\n\nAm Kai wartet [[jorna]]s Boot.\n";
    await writeBody("locations/leuchtturm.md", prose);

    // The USAGE report follows the same rule: the sentence is the npc's.
    const sceneUsage = await usageOf("scene", "jorna");
    expect(sceneUsage.groups.find((g) => g.ref === "bodyRefs")).toBeUndefined();
    const npcUsage = await usageOf("npc", "jorna");
    expect(npcUsage.groups.find((g) => g.ref === "bodyRefs")?.count).toBe(1);

    // Renaming the SHADOWED scene must not touch that prose.
    await rename({ kind: "scene", oldId: "jorna", newId: "jorna-szene" });
    expect((await readFile("locations/leuchtturm.md")).body).toBe(prose);

    // Renaming the OWNER still does.
    await rename({ kind: "npc", oldId: "jorna", newId: "jorna-npc" });
    expect((await readFile("locations/leuchtturm.md")).body).toContain("[[jorna-npc]]s Boot");
  });

  test("the campaign body is a full reference site (name and id rename)", async () => {
    await writeBody("_campaign.md", "Notiz: [[jorna]] ist bestechlich.\n");
    const db = await getDb();
    expect(referrersOf(db, "beispiel", "jorna")).toEqual([{ kind: "campaign", id: "beispiel" }]);

    // A NAME change re-indexes the campaign row like any other referrer.
    await patch("npcs/jorna.md", { name: "Jorna Salzhand" });
    expect((await search("Salzhand")).some((r) => r.kind === "campaign")).toBe(true);

    // …and an ID rename drags the slug in the note along, counted in the
    // preview and reported as a changed path.
    const usage = await usageOf("npc", "jorna");
    expect(usage.groups.find((g) => g.ref === "bodyRefs")?.count).toBe(1);
    const plan = await rename({ kind: "npc", oldId: "jorna", newId: "jorna-b" });
    expect(plan.changed).toContain("_campaign.md");
    expect((await readFile("_campaign.md")).body).toContain("[[jorna-b]]");
  });

  test("a dry run rewrites nothing but reports the site", async () => {
    await writeBody(SCENE, "## Flow\n\n[[jorna]] wartet.\n");
    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "jorna", newId: "j2", dryRun: true }),
    });
    expect(res.status).toBe(200);
    const plan = (await res.json()) as { changed: string[] };
    expect(plan.changed).toContain(SCENE);
    expect((await readFile(SCENE)).body).toContain("[[jorna]]");
  });
});

describe("the import expands references (second pass)", () => {
  test("a freshly imported body is findable under the referenced name", async () => {
    // The import writes one index row per entity AS IT GOES, and a body can
    // reference an entity whose row does not exist yet at that moment — so
    // the expansion is a second pass at the end of the import
    // (db/migrate-campaigns.ts). This case is the only one that exercises it:
    // examples/ itself carries no reference (the format contract stays
    // untouched), so the scene comes from a temp copy of the tree.
    const root = await tempCampaignRoot();
    try {
      await writeFile(
        path.join(root, "beispiel", "01-salzhafen", "hafen", "imported-ref.md"),
        [
          "---",
          "id: imported-ref",
          "title: Importierte Referenz",
          "type: planned",
          "chapter: 01-salzhafen",
          "status: draft",
          "---",
          "",
          "## Flow",
          "",
          "Am Kai wartet [[jorna]]s Boot.",
          "",
        ].join("\n"),
        "utf8",
      );
      await seedStore(root);
      expect(
        (await search("Hafenmeisterin")).some((r) => r.kind === "scene" && r.id === "imported-ref"),
      ).toBe(true);
    } finally {
      await removeTempRoot(root);
    }
  });
});
