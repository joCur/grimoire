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
import type { CampaignTree, EntryResponse } from "@grimoire/shared";
import { npcs, sceneNpcs } from "../src/db/schema";
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

const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";
const NPC = "npcs/fenn";

async function getFile(rel: string, campaign = "beispiel"): Promise<EntryResponse> {
  const res = await app.request(`/api/${campaign}/entry?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function fileStatus(rel: string, campaign = "beispiel"): Promise<number> {
  return (await app.request(`/api/${campaign}/entry?path=${encodeURIComponent(rel)}`)).status;
}

async function patchFm(
  rel: string,
  patch: Record<string, unknown>,
  /** The display name for the Ort `location` may create (issue #100). */
  locationName?: string,
): Promise<EntryResponse> {
  const before = await getFile(rel);
  const res = await app.request("/api/beispiel/properties", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, rev: before.rev, patch, locationName }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function putBody(rel: string, body: string): Promise<EntryResponse> {
  const before = await getFile(rel);
  const res = await app.request("/api/beispiel/entry", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, rev: before.rev, body }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
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
    expect(await fileStatus("npcs/holm")).toBe(404);
    await patchFm(SCENE, { npcs: ["jorna", "holm"] });

    const created = await getFile("npcs/holm");
    expect(created.kind).toBe("npc");
    // Nothing but the id: the id IS the display name until somebody types
    // one, and the status is the neutral default.
    expect(created.properties.id).toBe("holm");
    expect(created.properties.name).toBe("holm");
    expect(created.properties.status).toBe("unknown");
    expect(created.body.trim()).toBe("");
    // It is a normal entry: in the tree, patchable, and its own rev token.
    expect((await tree()).npcs.some((n) => n.id === "holm")).toBe(true);
    const named = await patchFm("npcs/holm", { name: "Holm", role: "Netzflicker" });
    expect(named.properties.name).toBe("Holm");
  });

  test("a scene's location — an unknown id gets its entry", async () => {
    expect(await fileStatus("locations/alte-mole")).toBe(404);
    await patchFm(SCENE, { location: "alte-mole" });
    const created = await getFile("locations/alte-mole");
    expect(created.properties.name).toBe("alte-mole");
    expect((await tree()).locations.some((l) => l.id === "alte-mole")).toBe(true);
  });

  test("locationName names the entry the patch CREATES (#100)", async () => {
    // The properties form takes free text in the Ort field, slugs it into
    // `location` and sends the typed text along: one write, and the new entry
    // is called what the DM typed instead of being called by its own id.
    expect(await fileStatus("locations/der-alte-hafen")).toBe(404);
    await patchFm(SCENE, { location: "der-alte-hafen" }, "Der alte Hafen");

    const created = await getFile("locations/der-alte-hafen");
    expect(created.kind).toBe("location");
    expect(created.properties.id).toBe("der-alte-hafen");
    expect(created.properties.name).toBe("Der alte Hafen");
    // It is a normal, otherwise EMPTY entry — the name is all it claims.
    expect(created.body.trim()).toBe("");
    // And the group the scene now sits in is headed by that name.
    const chapter = (await tree()).chapters.find((c) => c.id === "01-salzhafen");
    expect(chapter?.groups.find((g) => g.slug === "der-alte-hafen")?.name).toBe(
      "Der alte Hafen",
    );
  });

  test("locationName is used ONCE and never renames an existing Ort (#100)", async () => {
    // A name belongs to the location and is edited in its own dialog. Two
    // scenes spelling the same group differently must not fight over it, and
    // a scene that merely references „Leuchtturm" must not rewrite the name
    // somebody wrote — so the value is applied only on INSERT.
    expect((await getFile("locations/leuchtturm")).properties.name).toBe(
      "Der Leuchtturm von Salzhafen",
    );
    await patchFm(SCENE, { location: "leuchtturm", status: "played" }, "Leuchtturm");
    expect((await getFile("locations/leuchtturm")).properties.name).toBe(
      "Der Leuchtturm von Salzhafen",
    );

    // Same for one the patch created a moment ago: the second scene to name
    // it keeps the name the first one gave it.
    await patchFm(SCENE, { location: "der-alte-hafen" }, "Der alte Hafen");
    const other = "01-salzhafen/bucht/smuggler-captured";
    await patchFm(other, { location: "der-alte-hafen" }, "Der Alte HAFEN");
    expect((await getFile("locations/der-alte-hafen")).properties.name).toBe("Der alte Hafen");
  });

  test("a locationName that IS the id leaves the entry nameless (#100)", async () => {
    // The empty name means "fall back to the id" everywhere it is rendered,
    // so the row carries no redundant copy of its own key.
    await patchFm(SCENE, { location: "nordbucht" }, "nordbucht");
    expect((await getFile("locations/nordbucht")).properties.name).toBe("nordbucht");
  });

  test("locationName must be a string (#100)", async () => {
    const before = await getFile(SCENE);
    const res = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: SCENE,
        rev: before.rev,
        patch: { location: "alte-mole" },
        locationName: 7,
      }),
    });
    expect(res.status).toBe(400);
    expect(await fileStatus("locations/alte-mole")).toBe(404);
  });

  test("free text in location is a 400 — it is a reference, not a label (#100)", async () => {
    // The README's free-text exception is gone: `location` is the scene's
    // GROUP, so a value that cannot be an id cannot be a group. The body
    // carries the code the app has a sentence for, plus the slug it would
    // have used — and nothing is written.
    const before = await getFile(SCENE);
    const res = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: SCENE,
        rev: before.rev,
        patch: { location: "Der alte Hafen" },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "location_not_an_id",
      value: "Der alte Hafen",
      suggestion: "der-alte-hafen",
    });
    expect((await getFile(SCENE)).properties.location).toBe(before.properties.location);
    expect((await tree()).locations.some((l) => l.id === "der-alte-hafen")).toBe(false);
  });

  test("changing location MOVES the scene — group, address and entry (#100)", async () => {
    // The one write this ticket is about: the group is derived, so the patch
    // that sets `location` is also the patch that re-addresses the scene —
    // and it creates the entry the new group needs.
    const scene = "01-salzhafen/bucht/smuggler-captured";
    expect((await getFile(scene)).properties.location).toBe("bucht");

    const moved = await patchFm(scene, { location: "alte-raeucherkammer" });
    expect(moved.path).toBe("01-salzhafen/alte-raeucherkammer/smuggler-captured");
    // The OLD address still names the scene and answers with the new one —
    // the app replaces the URL with it (ADR #17).
    expect((await getFile(scene)).path).toBe(
      "01-salzhafen/alte-raeucherkammer/smuggler-captured",
    );
    expect((await getFile("locations/alte-raeucherkammer")).properties.name).toBe(
      "alte-raeucherkammer",
    );
    const chapter = (await tree()).chapters.find((c) => c.id === "01-salzhafen");
    expect(chapter?.groups.map((g) => g.slug).sort()).toEqual([
      "alte-raeucherkammer",
      "leuchtturm",
    ]);
  });

  test("clearing location puts the scene on chapter level", async () => {
    const scene = "01-salzhafen/bucht/smuggler-captured";
    const cleared = await patchFm(scene, { location: null });
    expect(cleared.path).toBe("01-salzhafen/smuggler-captured");
    const chapter = (await tree()).chapters.find((c) => c.id === "01-salzhafen");
    expect(chapter?.groups.map((g) => g.slug)).toEqual(["leuchtturm", ""]);
  });

  test("an unrelated patch does not materialise an existing NPC reference", async () => {
    // The npc half keeps the "only NEW references" rule: the list may hold
    // imported values, and a `PATCH { status }` re-sends all of them.
    const before = (await tree()).npcs.map((n) => n.id);
    await patchFm("01-salzhafen/bucht/smuggler-captured", { status: "played" });
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
    const created = await getFile("npcs/holm");
    expect(created.properties.name).toBe("holm");
    // The relation itself is unchanged — one-sided, as authored.
    expect((await getFile(NPC)).body).toContain("- holm: schuldet ihm Geld");
    expect((await getFile("npcs/holm")).body).not.toContain("Beziehungen");
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

      // The IMPORT closes it, not a pass after it: `scene_npcs.npc_id` is a
      // foreign key (ADR #18), so the entry has to exist by the time the
      // reference row is written — the backfill that used to do this
      // afterwards finds nothing left to create.
      expect(lastSeedBackfill()).toEqual([]);
      const created = await getFile("npcs/alte-fischerin");
      expect(created.properties.name).toBe("alte-fischerin");
      expect((await tree()).npcs.some((n) => n.id === "alte-fischerin")).toBe(true);
    } finally {
      await removeTempRoot(root);
    }
  });

  test("a clean campaign is untouched — but every location a scene names exists", async () => {
    // The npc backfill still finds nothing. `location: bucht` had no
    // `locations/bucht.md` in the example tree and now HAS an entry: since
    // issue #100 the value is the scene's group, and a group the campaign
    // cannot name is not a thing the import may leave behind.
    expect(lastSeedBackfill()).toEqual([]);
    expect(await fileStatus("locations/bucht")).toBe(200);
    expect((await getFile("locations/bucht")).properties.name).toBe("bucht");
  });
});

describe("the generator's apply step", () => {
  test("a scene draft creates its unknown npc — and the npc draft FILLS that row", async () => {
    // Order matters here: the scene is inserted first and creates the empty
    // `holm` row, so the npc draft in the SAME batch would have collided
    // with a row put there by itself. An empty row is not a conflict.
    await applyDrafts("beispiel", [
      {
        rel: "01-salzhafen/hafen/neue-szene",
        address: "01-salzhafen/hafen/neue-szene",
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
        rel: "npcs/holm",
        address: "npcs/holm",
        properties: { id: "holm", name: "Holm", status: "alive" },
        body: "\n## Will\n\nSeine Netze zurück.\n",
      },
    ]);
    const npc = await getFile("npcs/holm");
    expect(npc.properties.name).toBe("Holm");
    expect(npc.properties.status).toBe("alive");
    expect(npc.body).toContain("Seine Netze zurück.");
    // The scene's location got its empty row too.
    expect((await getFile("locations/bucht")).properties.name).toBe("bucht");
  });

  // The apply step re-runs neither the body validation nor the properties
  // form, so it had to grow the guards of both — and until it did, the
  // foreign-key failure came back through the conflict catch as „target
  // already exists", a conflict that was never there.
  test("400 for a relation counterpart that is a name, not an id", async () => {
    let status: unknown;
    let message = "";
    try {
      await applyDrafts("beispiel", [
        {
          rel: "npcs/holm",
          address: "npcs/holm",
          properties: { id: "holm", name: "Holm" },
          body: "\n## Beziehungen\n\n- Alte Freundin aus Waterdeep: sie schreiben sich\n",
        },
      ]);
      throw new Error("expected a 400");
    } catch (error) {
      status = (error as { status?: number }).status;
      message = (error as Error).message;
    }
    expect(status).toBe(400);
    expect(message).toContain("Beziehungen holds npc ids, not names");
    expect(await fileStatus("npcs/holm")).toBe(404);
  });

  test("400 for an npc or location draft whose chapter does not exist", async () => {
    // `chapter:` is an optional grouping note, and a chapter is never
    // created by naming it (ADR #14) — only a SCENE's chapter is.
    for (const draft of [
      {
        rel: "npcs/holm",
        address: "npcs/holm",
        properties: { id: "holm", name: "Holm", chapter: "99-nirgendwo" },
        body: "\n## Will\n\nSeine Netze zurück.\n",
      },
      {
        rel: "locations/moor",
        address: "locations/moor",
        properties: { id: "moor", name: "Moor", chapter: "99-nirgendwo" },
        body: "\n## Was hier ist\n\nNebel.\n",
      },
    ]) {
      await expect(applyDrafts("beispiel", [draft])).rejects.toThrow(/unknown chapter/);
    }
    expect(await fileStatus("npcs/holm")).toBe(404);
    expect(await fileStatus("locations/moor")).toBe(404);
  });

  test("a row that holds CONTENT is still a 409 conflict", async () => {
    const before = await getFile(NPC);
    await expect(
      applyDrafts("beispiel", [
        {
          rel: "npcs/fenn",
          address: "npcs/fenn",
          properties: { id: "fenn", name: "Anders" },
          body: "\n## Will\n\nAnderes.\n",
        },
      ]),
    ).rejects.toThrow(/already exist/);
    expect(await getFile(NPC)).toEqual(before);
  });
});

/** The location ids the tree lists, sorted — the groups a scene can sit in. */
async function treeLocations(): Promise<string[]> {
  return (await tree()).locations.map((l) => l.id).sort();
}

describe("the rename cascade", () => {
  test("a scene listing BOTH ids merges instead of failing on the primary key", async () => {
    // A scene that lists both `jorna` and `holm`, where `holm` is the EMPTY
    // entry a reference left behind (ADR #14): renaming jorna onto that id
    // has two ways to fail — the primary key of `scene_npcs`, and the empty
    // target row that cannot be deleted while the scene names it (ADR #18).
    // The rename merges instead of either.
    await patchFm(SCENE, { npcs: ["jorna", "holm"] });

    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "jorna", newId: "holm" }),
    });
    expect(res.status).toBe(200);
    // One entry left, not a constraint error and not a duplicate.
    expect((await getFile(SCENE)).properties.npcs).toEqual(["holm"]);
  });

  test("a location merge moves the scenes that sit under the empty target", async () => {
    // `bucht` is the empty entry the import created for a scene's `location`
    // (ADR #14/#17), and `scenes.location` is a foreign key with no delete
    // action (ADR #18) — so the empty row cannot simply be deleted out from
    // under the scene that names it. The rename moves the scene instead.
    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "location", oldId: "leuchtturm", newId: "bucht" }),
    });
    expect(res.status).toBe(200);
    // Both scenes sit under the merged location now, and it is the renamed
    // entry that survived — with the name the DM had written for it.
    expect((await getFile("locations/bucht")).properties.name).toBe(
      "Der Leuchtturm von Salzhafen",
    );
    expect(await fileStatus("locations/leuchtturm")).toBe(404);
    const tree = await treeLocations();
    expect(tree).toEqual(["bucht"]);
  });
});

describe("the audit of the #70 rules", () => {
  test("a STATUS the DM set makes an auto-created entry non-empty (409 on apply)", async () => {
    // The row was created by a reference and holds nothing else — but `dead`
    // is the one thing the live view acts on, and an apply that overwrites it
    // silently loses the only statement the entry ever made.
    await patchFm(SCENE, { npcs: ["jorna", "holm"] });
    await patchFm("npcs/holm", { status: "dead" });

    await expect(
      applyDrafts("beispiel", [
        {
          rel: "npcs/holm",
          address: "npcs/holm",
          properties: { id: "holm", name: "Holm", status: "alive" },
          body: "\n## Will\n\nEtwas.\n",
        },
      ]),
    ).rejects.toThrow(/already exist/);
    const untouched = await getFile("npcs/holm");
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
          rel: "npcs/holm",
          address: "npcs/holm",
          properties: { id: "holm", name: "Holm" },
          body: "\n## Will\n\nDas erste.\n",
        },
        {
          rel: "npcs/holm-2",
          address: "npcs/holm",
          properties: { id: "holm", name: "Holm anders" },
          body: "\n## Will\n\nDas zweite.\n",
        },
      ]);
      throw new Error("expected a conflict");
    } catch (error) {
      expect((error as Error).message).toMatch(/same target/);
      conflicts = (error as { extra?: { conflicts?: unknown } }).extra?.conflicts;
    }
    expect(conflicts).toEqual(["npcs/holm", "npcs/holm-2"]);
    // Nothing was written: the transaction rolled back.
    expect(await fileStatus("npcs/holm")).toBe(404);
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
    // The body carries the code the app has a sentence for, plus the slug it
    // would have used — the same shape the `location` refusal has, so the
    // chips input can offer the id instead of echoing an English sentence.
    expect(await res.json()).toMatchObject({
      code: "npc_ref_not_an_id",
      value: "Alte Fischerin",
      suggestion: "alte-fischerin",
    });
    // The scene is unchanged — no half-written list.
    expect((await getFile(SCENE)).properties.npcs).toEqual(before.properties.npcs);
  });

  test("a name no slug survives is refused with no proposal", async () => {
    const before = await getFile(SCENE);
    const res = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: SCENE, rev: before.rev, patch: { npcs: ["???"] } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    // Nothing to propose, so nothing is proposed: an id is never invented out
    // of nothing, and the app has a second sentence for exactly this.
    expect(body).toMatchObject({ code: "npc_ref_not_an_id", value: "???" });
    expect(body.suggestion).toBeUndefined();
  });

  test("…but STORED free text stays savable (the migration imports what is there)", async () => {
    // Exactly what a file era campaign can hold. Refusing it on the way out
    // would make such a scene unpatchable — an unrelated `PATCH { status }`
    // re-sends the whole list.
    //
    // The value has an ENTRY, because the reference is a foreign key (ADR
    // #18) and the boot repair gave every stored reference the entry it
    // names. What stays exempt is the SLUG rule: the id is no slug, the app
    // says so on the card, and nothing new joins it.
    const db = await getDb();
    db.insert(npcs).values({ campaignId: "beispiel", id: "Alte Fischerin", name: "" }).run();
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
    expect((await getFile("npcs/holm")).properties.name).toBe("holm");

    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "jorna", newId: "holm" }),
    });
    expect(res.status).toBe(200);
    // One reference left, and it is jorna's content that lives under the id.
    expect((await getFile(SCENE)).properties.npcs).toEqual(["holm"]);
    expect((await getFile("npcs/holm")).properties.name).toBe("Hafenmeisterin Jorna");
    expect(await fileStatus("npcs/jorna")).toBe(404);
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
    const inbox = await getFile("inbox");
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
