// Referential integrity on the write paths.
//
// Every reference is a foreign key (db/schema.ts rule 3), so a reference
// names an entry that EXISTS — and nothing comes into existence because
// something mentioned it. These cases pin both halves on every write path
// that can introduce a reference:
//
//   * a `location`, an `npcs` entry, a `chapter`, the scene of a quick note
//     and of a played-scenes list are refused with 400 and their own code
//     when they name nothing, and the write leaves no trace;
//   * an entry is only ever created by a create endpoint or by accepting a
//     generator proposal;
//   * a mention in TEXT — a `## Beziehungen` line, `[[slug]]` in prose —
//     is neither: it stays visible text, with no entry and no error.
//
// The gate that runs before the constraints exist — the check that names
// unresolvable references and aborts the start — is
// test/reference-preflight.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignTree, EntryResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { applyDrafts } from "../src/store/write";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";
const SCENE_B = "01-salzhafen/bucht/smuggler-captured";
const NPC = "npcs/fenn";

async function getFile(rel: string, campaign = "beispiel"): Promise<EntryResponse> {
  const res = await app.request(entriesUrl(campaign, rel));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function fileStatus(rel: string, campaign = "beispiel"): Promise<number> {
  return (await app.request(entriesUrl(campaign, rel))).status;
}

/** A properties patch that is expected to go through. */
async function patchFm(rel: string, patch: Record<string, unknown>): Promise<EntryResponse> {
  const res = await patchRes(rel, patch);
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

/** The raw answer of a properties patch — for the cases that are refused. */
async function patchRes(rel: string, patch: Record<string, unknown>): Promise<Response> {
  const before = await getFile(rel);
  return app.request(entriesUrl("beispiel", rel), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: before.rev, properties: patch }),
  });
}

async function patchBody(rel: string, body: string): Promise<EntryResponse> {
  const before = await getFile(rel);
  const res = await app.request(entriesUrl("beispiel", rel), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: before.rev, body }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function post(rel: string, body: unknown): Promise<Response> {
  return app.request(`/api/campaigns/beispiel${rel}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** An entry created and left empty — the only way an empty one exists. */
async function createEmptyNpc(id: string): Promise<void> {
  const res = await post("/npcs", { name: id });
  expect(res.status).toBe(201);
  expect((await getFile(`npcs/${id}`)).properties.name).toBe(id);
}

async function tree(): Promise<CampaignTree> {
  const res = await app.request("/api/campaigns/beispiel/tree");
  expect(res.status).toBe(200);
  return (await res.json()) as CampaignTree;
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("a reference that names nothing is refused", () => {
  test("a scene's npcs list: 400 npc_unknown, and no entry appears", async () => {
    const before = await getFile(SCENE);
    const res = await patchRes(SCENE, { npcs: ["jorna", "holm"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "npc_unknown", value: "holm" });
    // Nothing was written — not the list, not an entry for the id.
    expect((await getFile(SCENE)).properties.npcs).toEqual(before.properties.npcs);
    expect(await fileStatus("npcs/holm")).toBe(404);
    expect((await tree()).npcs.some((n) => n.id === "holm")).toBe(false);
  });

  test("a NAME where an id belongs is the same refusal", async () => {
    // „Alte Fischerin" is no npc id, so it names nothing — one rule, one
    // sentence, instead of a second error about the shape of the value.
    const res = await patchRes(SCENE, { npcs: ["jorna", "Alte Fischerin"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "npc_unknown", value: "Alte Fischerin" });
  });

  test("a scene's location: 400 location_unknown, and no entry appears", async () => {
    const before = await getFile(SCENE);
    const res = await patchRes(SCENE, { location: "alte-mole" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "location_unknown", value: "alte-mole" });
    expect((await getFile(SCENE)).properties.location).toBe(before.properties.location);
    expect(await fileStatus("locations/alte-mole")).toBe(404);
  });

  test("free text in location stays the 400 that names the id to use", async () => {
    const before = await getFile(SCENE);
    const res = await patchRes(SCENE, { location: "Der alte Hafen" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "location_not_an_id",
      value: "Der alte Hafen",
      suggestion: "der-alte-hafen",
    });
    expect((await getFile(SCENE)).properties.location).toBe(before.properties.location);
    expect((await tree()).locations.some((l) => l.id === "der-alte-hafen")).toBe(false);
  });

  test("an unknown chapter: 400 chapter_unknown for a scene, an npc and an ort", async () => {
    for (const rel of [SCENE, NPC, "locations/leuchtturm"]) {
      const before = await getFile(rel);
      const res = await patchRes(rel, { chapter: "99-nirgendwo" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: "chapter_unknown",
        value: "99-nirgendwo",
      });
      expect((await getFile(rel)).properties.chapter).toBe(before.properties.chapter);
    }
    // An existing chapter is stored as before.
    expect((await patchFm(NPC, { chapter: "01-salzhafen" })).properties.chapter).toBe(
      "01-salzhafen",
    );
  });

  test("a scene's chapter cannot be removed at all — 400 chapter_required", async () => {
    // Clearing the Kapitel field in the dialog is the way to get here, so the
    // refusal carries a CODE: the app reads its own sentence off it and
    // disables „Speichern" instead of letting the save round-trip.
    const res = await patchRes(SCENE, { chapter: null });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "chapter_required" });
    // …and the scene still hangs where it did.
    expect((await getFile(SCENE)).properties.chapter).toBe("01-salzhafen");
  });

  test("a quick note's scene: 400 log_scene_unknown, and the log stays empty", async () => {
    expect((await post("/session/start", {})).status).toBe(200);
    const res = await post("/log", { text: "Etwas passiert", sceneId: "gibt-es-nicht" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "log_scene_unknown",
      value: "gibt-es-nicht",
    });
    const session = (await tree()).sessions[0];
    expect(session?.scenes_played).toEqual([]);
    // The note itself was not written either.
    expect((await getFile(`sessions/${session!.id}`)).body).not.toContain("Etwas passiert");
  });

  test("parentheses in the NOTE are text, not a reference", async () => {
    // The `- HH:MM (id) text` marker is a parse column of the log line, so a
    // note that happens to begin with „(…)" would otherwise name a scene
    // nobody meant. The text is kept whole and stores no scene — a note is
    // never refused over something the DM did not write as a reference.
    expect((await post("/session/start", {})).status).toBe(200);
    const res = await post("/log", { text: "(vermutlich) der Turmwärter lügt" });
    expect(res.status).toBe(200);
    const id = (await tree()).sessions[0]!.id;
    const session = await getFile(`sessions/${id}`);
    expect(session.body).toContain("(vermutlich) der Turmwärter lügt");
    expect(session.properties.scenes_played).toEqual([]);
  });

  test("a played-scenes list: 400 played_scene_unknown", async () => {
    expect((await post("/session/start", {})).status).toBe(200);
    const id = (await tree()).sessions[0]!.id;
    const rel = `sessions/${id}`;
    const res = await patchRes(rel, { scenes_played: ["lighthouse-arrival", "gibt-es-nicht"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "played_scene_unknown",
      value: "gibt-es-nicht",
    });
    // Not half of the list either — the transaction rolled back.
    expect((await getFile(rel)).properties.scenes_played).toEqual([]);
  });
});

describe("a reference that names an entry is stored", () => {
  test("an npc that exists joins the list", async () => {
    await createEmptyNpc("holm");
    const patched = await patchFm(SCENE, { npcs: ["jorna", "holm"] });
    expect(patched.properties.npcs).toEqual(["jorna", "holm"]);
  });

  test("changing location MOVES the scene — group and address", async () => {
    expect((await post("/locations", { name: "Alte Räucherkammer" })).status).toBe(201);
    expect((await getFile(SCENE_B)).properties.location).toBe("bucht");

    const moved = await patchFm(SCENE_B, { location: "alte-raeucherkammer" });
    expect(moved.path).toBe("01-salzhafen/alte-raeucherkammer/smuggler-captured");
    // The OLD address still names the scene and answers with the new one —
    // the app replaces the URL with it (ADR #17).
    expect((await getFile(SCENE_B)).path).toBe(
      "01-salzhafen/alte-raeucherkammer/smuggler-captured",
    );
    const chapter = (await tree()).chapters.find((c) => c.id === "01-salzhafen");
    expect(chapter?.groups.map((g) => g.slug).sort()).toEqual([
      "alte-raeucherkammer",
      "leuchtturm",
    ]);
  });

  test("clearing location puts the scene on chapter level", async () => {
    const cleared = await patchFm(SCENE_B, { location: null });
    expect(cleared.path).toBe("01-salzhafen/smuggler-captured");
    const chapter = (await tree()).chapters.find((c) => c.id === "01-salzhafen");
    expect(chapter?.groups.map((g) => g.slug)).toEqual(["leuchtturm", ""]);
  });

  test("an unrelated patch re-sends the stored references and is fine", async () => {
    const before = (await tree()).npcs.map((n) => n.id);
    const patched = await patchFm(SCENE_B, { status: "played" });
    expect(patched.properties.npcs).toEqual(["fenn"]);
    expect((await tree()).npcs.map((n) => n.id)).toEqual(before);
  });
});

describe("a mention in text is not a reference", () => {
  test("a `## Beziehungen` line names an unknown npc: no entry, no error", async () => {
    const npc = await getFile(NPC);
    const seeded = "- [[jorna]]: alte Bekannte; er weicht ihrem Blick aus";
    expect(npc.body).toContain(seeded);
    const written = await patchBody(
      NPC,
      npc.body.replace(seeded, `${seeded}\n- holm: schuldet ihm Geld`),
    );
    // The line is prose and comes back exactly as written.
    expect(written.body).toContain("- holm: schuldet ihm Geld");
    expect((await getFile(NPC)).body).toContain("- holm: schuldet ihm Geld");
    expect(await fileStatus("npcs/holm")).toBe(404);
  });

  test("an unknown `[[slug]]` in prose stays visible text", async () => {
    const scene = await getFile(SCENE);
    const written = await patchBody(SCENE, `${scene.body}\nWer ist [[niemand]]?\n`);
    expect(written.body).toContain("Wer ist [[niemand]]?");
    expect(await fileStatus("npcs/niemand")).toBe(404);
    expect((await tree()).npcs.some((n) => n.id === "niemand")).toBe(false);
  });
});

describe("the generator's apply step", () => {
  test("a scene draft and the stub it needs land in one batch, in any order", async () => {
    // The batch is inserted in REFERENCE order, not in the order the review
    // lists it: the npc and the location the scene names go in first.
    await applyDrafts("beispiel", [
      {
        rel: "01-salzhafen/hafen/neue-szene",
        address: "01-salzhafen/hafen/neue-szene",
        properties: {
          id: "neue-szene",
          title: "Neue Szene",
          npcs: ["holm"],
          location: "alte-mole",
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
      {
        rel: "locations/alte-mole",
        address: "locations/alte-mole",
        properties: { id: "alte-mole", name: "Alte Mole" },
        body: "\n## Beim ersten Betreten\n\nMorsch.\n",
      },
    ]);
    const npc = await getFile("npcs/holm");
    expect(npc.properties.name).toBe("Holm");
    expect(npc.properties.status).toBe("alive");
    expect((await getFile("locations/alte-mole")).properties.name).toBe("Alte Mole");
    const scene = await getFile("01-salzhafen/alte-mole/neue-szene");
    expect(scene.properties.npcs).toEqual(["holm"]);
  });

  test("a draft that names an entry the batch does not bring is refused", async () => {
    await expect(
      applyDrafts("beispiel", [
        {
          rel: "01-salzhafen/hafen/neue-szene",
          address: "01-salzhafen/hafen/neue-szene",
          properties: { id: "neue-szene", title: "Neue Szene", npcs: ["holm"], status: "draft" },
          body: "\n## Was passiert\n\nEtwas.\n",
        },
      ]),
    ).rejects.toThrow(/unknown npc/);
    // Nothing of the batch was written.
    expect(await fileStatus("01-salzhafen/hafen/neue-szene")).toBe(404);
    expect(await fileStatus("npcs/holm")).toBe(404);
  });

  test("an EMPTY entry is filled by the draft for its id", async () => {
    await createEmptyNpc("holm");
    await applyDrafts("beispiel", [
      {
        rel: "npcs/holm",
        address: "npcs/holm",
        properties: { id: "holm", name: "Holm", status: "alive" },
        body: "\n## Will\n\nSeine Netze zurück.\n",
      },
    ]);
    const npc = await getFile("npcs/holm");
    expect(npc.properties.name).toBe("Holm");
    expect(npc.body).toContain("Seine Netze zurück.");
  });

  test("an entry that holds CONTENT is still a 409 conflict", async () => {
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

  test("a STATUS the DM set makes an empty entry non-empty (409 on apply)", async () => {
    // `dead` is the one thing the live view acts on, and an apply that
    // overwrites it silently loses the only statement the entry ever made.
    await createEmptyNpc("holm");
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

  test("a PRIMARY KEY collision is still the documented 409", async () => {
    // The conflict check runs on the draft's ADDRESS; the id the row gets
    // comes from the properties. A draft whose address is free while its id
    // is taken slips past the check and hits the primary key — which the
    // apply translates back to the documented answer instead of a 500.
    //
    // The translation is NARROW on purpose: it means „the target is taken"
    // and nothing else, so a reference that names nothing stays the 400 with
    // its own code (the cases at the top of this file) rather than becoming a
    // 409 about entries that are not there.
    await expect(
      applyDrafts("beispiel", [
        {
          rel: "01-salzhafen/hafen/neue-szene",
          address: "01-salzhafen/hafen/neue-szene",
          properties: {
            id: "lighthouse-arrival",
            title: "Noch eine Ankunft",
            chapter: "01-salzhafen",
            status: "draft",
          },
          body: "\n## Was passiert\n\nEtwas.\n",
        },
      ]),
    ).rejects.toMatchObject({ status: 409, message: "target entries already exist" });
    // The scene that was already there is untouched.
    expect((await getFile(SCENE)).properties.title).toBe("Ankunft am Leuchtturm");
  });

  test("TWO drafts for one target are a 409, not last-write-win", async () => {
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
});

describe("empty is not missing", () => {
  test("an empty inbox is an empty entry (200), not a missing one", async () => {
    const inbox = await getFile("inbox");
    expect(inbox.kind).toBe("inbox");
  });
});

