// "Referencing creates" (issue #70).
//
// The DB model (#52/#13) says a referenced entity is never MISSING, only
// EMPTY: an npc without information is a row with an id and a name. The file
// era's answer was a permanent hole plus a "Stub anlegen" button. These cases
// pin the new rule on every write path that can introduce a reference, and
// the one boundary that stays: free text in `location` is still free text.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CampaignTree, FileResponse } from "@grimoire/shared";
import { sceneNpcs } from "../src/db/schema";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { applyDrafts } from "../src/store/write";
import {
  dropStore,
  lastSeedBackfill,
  removeTempRoot,
  seedStore,
  tempCampaignRoot,
} from "./support/store";

const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";
const NPC = "npcs/fenn.md";

async function getFile(rel: string, campaign = "beispiel"): Promise<FileResponse> {
  const res = await app.request(`/api/${campaign}/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function fileStatus(rel: string, campaign = "beispiel"): Promise<number> {
  return (await app.request(`/api/${campaign}/file?path=${encodeURIComponent(rel)}`)).status;
}

async function patchFm(rel: string, patch: Record<string, unknown>): Promise<FileResponse> {
  const before = await getFile(rel);
  const res = await app.request("/api/beispiel/properties", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, rev: before.rev, patch }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function putBody(rel: string, body: string): Promise<FileResponse> {
  const before = await getFile(rel);
  const res = await app.request("/api/beispiel/file", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, rev: before.rev, body }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function tree(): Promise<CampaignTree> {
  const res = await app.request("/api/beispiel/tree");
  expect(res.status).toBe(200);
  return (await res.json()) as CampaignTree;
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("a reference creates the entry it names", () => {
  test("a scene's npcs list: the new id has an EMPTY entry, not a hole", async () => {
    expect(await fileStatus("npcs/holm.md")).toBe(404);
    await patchFm(SCENE, { npcs: ["jorna", "holm"] });

    const created = await getFile("npcs/holm.md");
    expect(created.kind).toBe("npc");
    // Nothing but the id: the id IS the display name until somebody types
    // one, and the status is the neutral default.
    expect(created.properties.id).toBe("holm");
    expect(created.properties.name).toBe("holm");
    expect(created.properties.status).toBe("unknown");
    expect(created.body.trim()).toBe("");
    // It is a normal entry: in the tree, patchable, and its own rev token.
    expect((await tree()).npcs.some((n) => n.id === "holm")).toBe(true);
    const named = await patchFm("npcs/holm.md", { name: "Holm", role: "Netzflicker" });
    expect(named.properties.name).toBe("Holm");
  });

  test("a scene's location, when it is a slug", async () => {
    expect(await fileStatus("locations/bucht.md")).toBe(404);
    await patchFm(SCENE, { location: "bucht" });
    const created = await getFile("locations/bucht.md");
    expect(created.properties.name).toBe("bucht");
    expect((await tree()).locations.some((l) => l.id === "bucht")).toBe(true);
  });

  test("free text in location stays free text — no entry, no invented Ort", async () => {
    // The format allows a free string there (README). Spaces or capitals make
    // it unmistakably text, and text must not become an entity.
    await patchFm(SCENE, { location: "Der alte Hafen" });
    expect((await getFile(SCENE)).properties.location).toBe("Der alte Hafen");
    expect((await tree()).locations.some((l) => l.name === "Der alte Hafen")).toBe(false);
    await patchFm(SCENE, { location: "Nordbucht" });
    expect((await tree()).locations.some((l) => l.id === "Nordbucht")).toBe(false);
  });

  test("a scene's location is ensured on EVERY patch, changed or not", async () => {
    // The properties dialog promises "wird beim Speichern angelegt" for a
    // slug-shaped value. With the old "only NEW references" guard a save left
    // a dangling OLD slug exactly as it stood, and the hint lied about the
    // stock most likely to have one. `bucht` is such a slug in the examples.
    const scene = "01-salzhafen/hafen/smuggler-captured.md";
    expect((await getFile(scene)).properties.location).toBe("bucht");
    expect(await fileStatus("locations/bucht.md")).toBe(404);

    await patchFm(scene, { status: "played" });

    expect((await getFile("locations/bucht.md")).properties.name).toBe("bucht");
    expect((await tree()).locations.some((l) => l.id === "bucht")).toBe(true);
  });

  test("…while free text stays free text, however often it is patched", async () => {
    const scene = "01-salzhafen/hafen/smuggler-captured.md";
    await patchFm(scene, { location: "Der alte Hafen" });
    const before = (await tree()).locations.map((l) => l.id);
    await patchFm(scene, { status: "played" });
    expect((await tree()).locations.map((l) => l.id)).toEqual(before);
  });

  test("an unrelated patch does not materialise an existing NPC reference", async () => {
    // The npc half keeps the "only NEW references" rule: the list may hold
    // imported values, and a `PATCH { status }` re-sends all of them.
    const before = (await tree()).npcs.map((n) => n.id);
    await patchFm("01-salzhafen/hafen/smuggler-captured.md", { status: "played" });
    expect((await tree()).npcs.map((n) => n.id)).toEqual(before);
  });

  test("the counterpart of a ## Beziehungen line", async () => {
    const npc = await getFile(NPC);
    expect(npc.body).toContain("- jorna: alte Bekannte");
    await putBody(
      NPC,
      npc.body.replace(
        "- jorna: alte Bekannte; er weicht ihrem Blick aus",
        "- jorna: alte Bekannte; er weicht ihrem Blick aus\n- holm: schuldet ihm Geld",
      ),
    );
    const created = await getFile("npcs/holm.md");
    expect(created.properties.name).toBe("holm");
    // The relation itself is unchanged — one-sided, as authored.
    expect((await getFile(NPC)).body).toContain("- holm: schuldet ihm Geld");
    expect((await getFile("npcs/holm.md")).body).not.toContain("Beziehungen");
  });
});

describe("the seed pass for imported stock", () => {
  test("a dangling npc reference from the file era gets an empty entry", async () => {
    const root = await tempCampaignRoot();
    try {
      const scene = path.join(root, "beispiel", "01-salzhafen", "hafen", "ankunft-leuchtturm.md");
      const raw = await readFile(scene, "utf8");
      await writeFile(scene, raw.replace("npcs: [jorna]", "npcs: [jorna, alte-fischerin]"));
      await seedStore(root);

      // The pass reports what it created, so a run that changes data says so.
      expect(lastSeedBackfill()).toEqual(["beispiel/alte-fischerin"]);
      const created = await getFile("npcs/alte-fischerin.md");
      expect(created.properties.name).toBe("alte-fischerin");
      expect((await tree()).npcs.some((n) => n.id === "alte-fischerin")).toBe(true);
    } finally {
      await removeTempRoot(root);
    }
  });

  test("a clean campaign is untouched — and a slug-shaped location stays text", async () => {
    // `location: bucht` in the examples has no locations row and must KEEP
    // none: in that one field a slug is indistinguishable from free text, so
    // a blanket pass would invent Orte the DM never wrote.
    expect(lastSeedBackfill()).toEqual([]);
    expect(await fileStatus("locations/bucht.md")).toBe(404);
  });
});

describe("the generator's apply step", () => {
  test("a scene draft creates its unknown npc — and the npc draft FILLS that row", async () => {
    // Order matters here: the scene is inserted first and creates the empty
    // `holm` row, so the npc draft in the SAME batch would have collided
    // with a row put there by itself. An empty row is not a conflict.
    await applyDrafts("beispiel", [
      {
        rel: "01-salzhafen/hafen/neue-szene.md",
        address: "01-salzhafen/hafen/neue-szene.md",
        properties: {
          id: "neue-szene",
          title: "Neue Szene",
          npcs: ["holm"],
          location: "bucht",
          status: "draft",
        },
        body: "\n## Was passiert\n\nEtwas.\n",
      },
      {
        rel: "npcs/holm.md",
        address: "npcs/holm.md",
        properties: { id: "holm", name: "Holm", status: "alive" },
        body: "\n## Will\n\nSeine Netze zurück.\n",
      },
    ]);
    const npc = await getFile("npcs/holm.md");
    expect(npc.properties.name).toBe("Holm");
    expect(npc.properties.status).toBe("alive");
    expect(npc.body).toContain("Seine Netze zurück.");
    // The scene's location got its empty row too.
    expect((await getFile("locations/bucht.md")).properties.name).toBe("bucht");
  });

  test("a row that holds CONTENT is still a 409 conflict", async () => {
    const before = await getFile(NPC);
    await expect(
      applyDrafts("beispiel", [
        {
          rel: "npcs/fenn.md",
          address: "npcs/fenn.md",
          properties: { id: "fenn", name: "Anders" },
          body: "\n## Will\n\nAnderes.\n",
        },
      ]),
    ).rejects.toThrow(/already exist/);
    expect(await getFile(NPC)).toEqual(before);
  });
});

describe("the rename cascade", () => {
  test("a scene listing BOTH ids merges instead of failing on the primary key", async () => {
    // A scene that lists both `jorna` and a `holm` WITHOUT a row: renaming
    // jorna onto that id used to violate `scene_npcs`' primary key — a 500
    // out of a rename whose preview had just called it safe. The boot pass
    // makes that state unreachable through the API from now on, so the row
    // is put there directly: it is exactly what a database migrated before
    // this change can hold at the moment of the rename.
    const db = await getDb();
    db.insert(sceneNpcs)
      .values({
        campaignId: "beispiel",
        sceneId: "lighthouse-arrival",
        npcId: "holm",
        pos: 9,
      })
      .run();

    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "jorna", newId: "holm" }),
    });
    expect(res.status).toBe(200);
    // One entry left, not a constraint error and not a duplicate.
    expect((await getFile(SCENE)).properties.npcs).toEqual(["holm"]);
  });
});

describe("the audit of the #70 rules", () => {
  test("a STATUS the DM set makes an auto-created entry non-empty (409 on apply)", async () => {
    // The row was created by a reference and holds nothing else — but `dead`
    // is the one thing the live view acts on, and an apply that overwrites it
    // silently loses the only statement the entry ever made.
    await patchFm(SCENE, { npcs: ["jorna", "holm"] });
    await patchFm("npcs/holm.md", { status: "dead" });

    await expect(
      applyDrafts("beispiel", [
        {
          rel: "npcs/holm.md",
          address: "npcs/holm.md",
          properties: { id: "holm", name: "Holm", status: "alive" },
          body: "\n## Will\n\nEtwas.\n",
        },
      ]),
    ).rejects.toThrow(/already exist/);
    const untouched = await getFile("npcs/holm.md");
    expect(untouched.properties.status).toBe("dead");
    expect(untouched.properties.name).toBe("holm");
  });

  test("TWO drafts for one target are a 409, not last-write-win", async () => {
    // Since an empty row stopped being a conflict, the second draft no longer
    // hit the primary key: it filled the row the first had just written and
    // the review reported a clean apply for content it had dropped.
    let conflicts: unknown;
    try {
      await applyDrafts("beispiel", [
        {
          rel: "npcs/holm.md",
          address: "npcs/holm.md",
          properties: { id: "holm", name: "Holm" },
          body: "\n## Will\n\nDas erste.\n",
        },
        {
          rel: "npcs/holm-2.md",
          address: "npcs/holm.md",
          properties: { id: "holm", name: "Holm anders" },
          body: "\n## Will\n\nDas zweite.\n",
        },
      ]);
      throw new Error("expected a conflict");
    } catch (error) {
      expect((error as Error).message).toMatch(/same target/);
      conflicts = (error as { extra?: { conflicts?: unknown } }).extra?.conflicts;
    }
    expect(conflicts).toEqual(["npcs/holm-2.md", "npcs/holm.md"]);
    // Nothing was written: the transaction rolled back.
    expect(await fileStatus("npcs/holm.md")).toBe(404);
  });

  test("`npcs` takes ids, not names — a new free-text entry is a 400", async () => {
    const before = await getFile(SCENE);
    const res = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: SCENE,
        rev: before.rev,
        patch: { npcs: ["jorna", "Alte Fischerin"] },
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/npc ids, not names/);
    // The scene is unchanged — no half-written list.
    expect((await getFile(SCENE)).properties.npcs).toEqual(before.properties.npcs);
  });

  test("…but STORED free text stays savable (the migration imports what is there)", async () => {
    // Exactly what a file era campaign can hold. Refusing it on the way out
    // would make such a scene unpatchable — an unrelated `PATCH { status }`
    // re-sends the whole list.
    const db = await getDb();
    db.insert(sceneNpcs)
      .values({
        campaignId: "beispiel",
        sceneId: "lighthouse-arrival",
        npcId: "Alte Fischerin",
        pos: 9,
      })
      .run();

    const patched = await patchFm(SCENE, { status: "played" });
    expect(patched.properties.npcs).toContain("Alte Fischerin");
    // And it got no entry — free text is no reference.
    expect(await fileStatus("npcs/Alte Fischerin.md")).toBe(404);
  });

  test("an unknown `chapter` is a 400 for an npc too, not a silent dangling id", async () => {
    // A scene answered 400 while an npc stored the same typo unchecked — and
    // the properties dialog promised "wird angelegt" for both. Chapters are
    // the one kind that is NOT created by naming it (ADR #14).
    const before = await getFile(NPC);
    const res = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: NPC,
        rev: before.rev,
        patch: { chapter: "99-nirgendwo" },
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/unknown chapter/);
    expect((await getFile(NPC)).properties.chapter).toBe(before.properties.chapter);

    // An existing chapter is stored as before.
    expect((await patchFm(NPC, { chapter: "01-salzhafen" })).properties.chapter).toBe(
      "01-salzhafen",
    );
  });

  test("a rename MERGES into an empty auto-created row instead of answering 409", async () => {
    // The state the merge is for is now reachable through the API alone:
    // listing `holm` creates the empty row, and the old target check turned
    // exactly that into a 409 for a target with nothing to lose.
    await patchFm(SCENE, { npcs: ["jorna", "holm"] });
    expect((await getFile("npcs/holm.md")).properties.name).toBe("holm");

    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "jorna", newId: "holm" }),
    });
    expect(res.status).toBe(200);
    // One reference left, and it is jorna's content that lives under the id.
    expect((await getFile(SCENE)).properties.npcs).toEqual(["holm"]);
    expect((await getFile("npcs/holm.md")).properties.name).toBe("Hafenmeisterin Jorna");
    expect(await fileStatus("npcs/jorna.md")).toBe(404);
  });

  test("a rename onto a row with CONTENT is still a 409", async () => {
    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "jorna", newId: "fenn" }),
    });
    expect(res.status).toBe(409);
    expect((await getFile(NPC)).properties.name).toBe("Fenn");
  });
});

describe("empty is not missing", () => {
  test("an empty inbox is an empty document (200), not a missing one", async () => {
    const inbox = await getFile("inbox.md");
    expect(inbox.kind).toBe("inbox");
  });
});

describe("a patch never drops what the migration preserved", () => {
  test("a misshapen quickstats survives a properties patch", async () => {
    // The migration keeps a `quickstats:` the column cannot hold (a list
    // where the format wants a mapping) in `extra`, and the renderer shows
    // it. The first patch used to delete it — silently, against the
    // round-trip rule (schema.ts rule 1).
    const root = await tempCampaignRoot();
    try {
      const npc = path.join(root, "beispiel", "npcs", "fenn.md");
      const raw = await readFile(npc, "utf8");
      await writeFile(
        npc,
        raw.replace(/^quickstats:.*$/m, "quickstats: [ac 12, hp 9]"),
      );
      await seedStore(root);

      expect((await getFile(NPC)).properties.quickstats).toEqual(["ac 12", "hp 9"]);
      const patched = await patchFm(NPC, { role: "Anders" });
      expect(patched.properties.role).toBe("Anders");
      expect(patched.properties.quickstats).toEqual(["ac 12", "hp 9"]);
      // …and it is still there on the next read, not only in the answer.
      expect((await getFile(NPC)).properties.quickstats).toEqual(["ac 12", "hp 9"]);
    } finally {
      await removeTempRoot(root);
    }
  });
});
