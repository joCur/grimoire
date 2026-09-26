// Referential integrity on the write paths.
//
// Every reference is a foreign key (db/schema.ts rule 3), so a reference
// names an entry that EXISTS — and nothing comes into existence because
// something mentioned it. These cases pin both halves on every write path
// that can introduce a reference:
//
//   * a `location`, an `npcs` entry and a `chapter` are refused with 400 and
//     their own code when they name nothing, and the write leaves no trace
//     (the scene of a log entry: its own tests);
//   * an entry is only ever created by a create endpoint or by accepting a
//     generator proposal;
//   * a mention in TEXT — a `## Relationships` line, `[[slug]]` in prose —
//     is neither: it stays visible text, with no entry and no error.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  CampaignTree,
  Location,
  Npc,
  NpcProposal,
  Scene,
  SceneProposal,
} from "@grimoire/shared";
import { app } from "../src/server";
import { writeGenerated } from "../src/store/generated";
import { dropStore, seedStore } from "./support/store";

const SCENE = "lighthouse-arrival";
const SCENE_B = "smuggler-captured";
const SCENES = "/api/campaigns/example/scenes";
const NPCS = "/api/campaigns/example/npcs";

/** A scene, read from its own resource (decisions/resources). */
async function getScene(id: string): Promise<Scene> {
  const res = await app.request(`${SCENES}/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Scene;
}

async function sceneStatus(id: string): Promise<number> {
  return (await app.request(`${SCENES}/${id}`)).status;
}

/** A scene write that is expected to go through — its fields flat, `body` among them. */
async function patchScene(id: string, fields: Record<string, unknown>): Promise<Scene> {
  const res = await patchSceneRes(id, fields);
  expect(res.status).toBe(200);
  return (await res.json()) as Scene;
}

/** The raw answer of a scene write — for the cases that are refused. */
async function patchSceneRes(id: string, fields: Record<string, unknown>): Promise<Response> {
  const before = await getScene(id);
  return app.request(`${SCENES}/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: before.rev, ...fields }),
  });
}

/** A proposed scene as a run hands it to the accept — the scene without its guard. */
function newScene(fields: Partial<SceneProposal> = {}): SceneProposal {
  return {
    id: "new-scene",
    title: "New Scene",
    type: "planned",
    chapter: "01-salt-harbour",
    npcs: [],
    handouts: [],
    tags: [],
    status: "draft",
    body: "\n## What happens\n\nSomething.\n",
    ...fields,
  };
}

async function post(rel: string, body: unknown): Promise<Response> {
  return app.request(`/api/campaigns/example${rel}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** An npc, read from its own resource (decisions/resources). */
async function getNpc(id: string): Promise<Npc> {
  const res = await app.request(`${NPCS}/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Npc;
}

async function npcStatus(id: string): Promise<number> {
  return (await app.request(`${NPCS}/${id}`)).status;
}

/** The raw answer of an npc write — its fields flat, `body` among them. */
async function patchNpcRes(id: string, fields: Record<string, unknown>): Promise<Response> {
  const before = await getNpc(id);
  return app.request(`${NPCS}/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: before.rev, ...fields }),
  });
}

async function patchNpc(id: string, fields: Record<string, unknown>): Promise<Npc> {
  const res = await patchNpcRes(id, fields);
  expect(res.status).toBe(200);
  return (await res.json()) as Npc;
}

/** An npc created and left empty — the only way an empty one exists. */
async function createEmptyNpc(id: string): Promise<void> {
  const res = await post("/npcs", { name: id });
  expect(res.status).toBe(201);
  expect((await getNpc(id)).name).toBe(id);
}

/** A proposed npc as a run hands it to the accept — the npc without its guard. */
function holm(body: string, fields: Partial<NpcProposal> = {}): NpcProposal {
  return { id: "holm", name: "Holm", status: "alive", body, ...fields };
}

async function tree(): Promise<CampaignTree> {
  const res = await app.request("/api/campaigns/example/tree");
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
    const before = await getScene(SCENE);
    const res = await patchSceneRes(SCENE, { npcs: ["jorna", "holm"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "npc_unknown", value: "holm" });
    // Nothing was written — not the list, not an npc for the id.
    expect((await getScene(SCENE)).npcs).toEqual(before.npcs);
    expect(await npcStatus("holm")).toBe(404);
    expect((await tree()).npcs.some((n) => n.id === "holm")).toBe(false);
  });

  test("a NAME where an id belongs is the same refusal", async () => {
    // "Old Fisherwoman" is no npc id, so it names nothing — one rule, one
    // sentence, instead of a second error about the shape of the value.
    const res = await patchSceneRes(SCENE, { npcs: ["jorna", "Old Fisherwoman"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "npc_unknown", value: "Old Fisherwoman" });
  });

  test("a scene's location: 400 location_unknown, and no entry appears", async () => {
    const before = await getScene(SCENE);
    const res = await patchSceneRes(SCENE, { location: "old-pier" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "location_unknown", value: "old-pier" });
    expect((await getScene(SCENE)).location).toBe(before.location);
    expect((await app.request("/api/campaigns/example/locations/old-pier")).status).toBe(404);
  });

  test("free text in location stays the 400 that names the id to use", async () => {
    const before = await getScene(SCENE);
    const res = await patchSceneRes(SCENE, { location: "The Old Harbour" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "location_not_an_id",
      value: "The Old Harbour",
      suggestion: "the-old-harbour",
    });
    expect((await getScene(SCENE)).location).toBe(before.location);
    expect((await tree()).locations.some((l) => l.id === "the-old-harbour")).toBe(false);
  });

  test("an unknown chapter: 400 chapter_unknown for a scene and an npc", async () => {
    // (A location refuses it the same way on its own resource:
    // test/locations.test.ts.)
    const scene = await getScene(SCENE);
    const sceneRes = await patchSceneRes(SCENE, { chapter: "99-nowhere" });
    const npc = await getNpc("fenn");
    const npcRes = await patchNpcRes("fenn", { chapter: "99-nowhere" });
    for (const res of [sceneRes, npcRes]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: "chapter_unknown",
        value: "99-nowhere",
      });
    }
    expect((await getScene(SCENE)).chapter).toBe(scene.chapter);
    expect((await getNpc("fenn")).chapter).toBe(npc.chapter);
    // An existing chapter is stored as before.
    expect((await patchNpc("fenn", { chapter: "01-salt-harbour" })).chapter).toBe("01-salt-harbour");
  });

  test("a scene's chapter cannot be removed at all — 400 chapter_required", async () => {
    // Clearing the chapter field in the dialog is the way to get here, so the
    // refusal carries a CODE: the app reads its own sentence off it and
    // disables saving instead of letting the save round-trip.
    const res = await patchSceneRes(SCENE, { chapter: null });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "chapter_required" });
    // …and the scene still hangs where it did.
    expect((await getScene(SCENE)).chapter).toBe("01-salt-harbour");
  });
});

describe("a reference that names an entry is stored", () => {
  test("an npc that exists joins the list", async () => {
    await createEmptyNpc("holm");
    const patched = await patchScene(SCENE, { npcs: ["jorna", "holm"] });
    expect(patched.npcs).toEqual(["jorna", "holm"]);
  });

  test("changing location changes the meta line, and the scene keeps its place", async () => {
    expect((await post("/locations", { name: "Old Smokehouse" })).status).toBe(201);
    expect((await getScene(SCENE_B)).location).toBe("cove");

    const moved = await patchScene(SCENE_B, { location: "old-smokehouse" });
    expect(moved.location).toBe("old-smokehouse");
    const chapter = (await tree()).chapters.find((c) => c.id === "01-salt-harbour");
    const scene = chapter?.scenes.find((s) => s.id === "smuggler-captured");
    expect(scene?.location).toBe("old-smokehouse");
    expect(scene?.locationName).toBe("Old Smokehouse");
    // Only the location changed, so the scene keeps its place in the chapter.
    expect(chapter?.scenes.map((s) => s.id)).toEqual([
      "lighthouse-arrival",
      "smuggler-captured",
    ]);
  });

  test("clearing location leaves the scene without one", async () => {
    const cleared = await patchScene(SCENE_B, { location: null });
    expect(Object.hasOwn(cleared, "location")).toBe(false);
    const chapter = (await tree()).chapters.find((c) => c.id === "01-salt-harbour");
    const scene = chapter?.scenes.find((s) => s.id === "smuggler-captured");
    expect(scene?.location).toBeUndefined();
    expect(scene?.locationName).toBeUndefined();
  });

  test("an unrelated patch re-sends the stored references and is fine", async () => {
    const before = (await tree()).npcs.map((n) => n.id);
    const patched = await patchScene(SCENE_B, { status: "played" });
    expect(patched.npcs).toEqual(["fenn"]);
    expect((await tree()).npcs.map((n) => n.id)).toEqual(before);
  });
});

describe("a mention in text is not a reference", () => {
  test("a `## Relationships` line names an unknown npc: no entry, no error", async () => {
    const npc = await getNpc("fenn");
    const seeded = "- [[jorna]]: old acquaintance; he avoids her eyes";
    expect(npc.body).toContain(seeded);
    const written = await patchNpc("fenn", {
      body: npc.body.replace(seeded, `${seeded}\n- holm: owes him money`),
    });
    // The line is prose and comes back exactly as written.
    expect(written.body).toContain("- holm: owes him money");
    expect((await getNpc("fenn")).body).toContain("- holm: owes him money");
    expect(await npcStatus("holm")).toBe(404);
  });

  test("an unknown `[[slug]]` in prose stays visible text", async () => {
    const scene = await getScene(SCENE);
    const written = await patchScene(SCENE, { body: `${scene.body}\nWho is [[nobody]]?\n` });
    expect(written.body).toContain("Who is [[nobody]]?");
    expect(await npcStatus("nobody")).toBe(404);
    expect((await tree()).npcs.some((n) => n.id === "nobody")).toBe(false);
  });
});

describe("the generator's apply step", () => {
  test("a proposed scene and the npc it needs land in one batch", async () => {
    // The batch is inserted in REFERENCE order, not in the order the review
    // lists it: the npc and the location the scene names go in first.
    await writeGenerated("example", {
      scenes: [newScene({ npcs: ["holm"], location: "old-pier" })],
      npcs: [holm("\nWants his nets back.\n")],
      locations: [
        { id: "old-pier", name: "Old Pier", body: "\n## On first entering\n\nRotten.\n" },
      ],
    });
    const npc = await getNpc("holm");
    expect(npc.name).toBe("Holm");
    expect(npc.status).toBe("alive");
    const res = await app.request("/api/campaigns/example/locations/old-pier");
    expect(((await res.json()) as Location).name).toBe("Old Pier");
    const scene = await getScene("new-scene");
    expect(scene.npcs).toEqual(["holm"]);
    expect(scene.location).toBe("old-pier");
  });

  test("a scene that names an npc the batch does not bring is refused", async () => {
    await expect(
      writeGenerated("example", { scenes: [newScene({ npcs: ["holm"] })] }),
    ).rejects.toThrow(/unknown npc/);
    // Nothing of the batch was written.
    expect(await sceneStatus("new-scene")).toBe(404);
    expect(await npcStatus("holm")).toBe(404);
  });

  test("an EMPTY npc is filled by the proposal for its id", async () => {
    await createEmptyNpc("holm");
    await writeGenerated("example", { npcs: [holm("\nWants his nets back.\n")] });
    const npc = await getNpc("holm");
    expect(npc.name).toBe("Holm");
    expect(npc.body).toContain("Wants his nets back.");
  });

  test("an npc that holds CONTENT is still a 409 conflict, named by its id", async () => {
    const before = await getNpc("fenn");
    await expect(
      writeGenerated("example", {
        npcs: [{ id: "fenn", name: "Other", status: "alive", body: "\nSomething else.\n" }],
      }),
    ).rejects.toMatchObject({ status: 409, extra: { npcs: ["fenn"] } });
    expect(await getNpc("fenn")).toEqual(before);
  });

  test("a STATUS the DM set makes an empty npc non-empty (409 on apply)", async () => {
    // `dead` is the one thing the live view acts on, and an apply that
    // overwrites it silently loses the only statement the npc ever made.
    await createEmptyNpc("holm");
    await patchNpc("holm", { status: "dead" });

    await expect(
      writeGenerated("example", { npcs: [holm("\nSomething.\n")] }),
    ).rejects.toThrow(/already exist/);
    const untouched = await getNpc("holm");
    expect(untouched.status).toBe("dead");
    expect(untouched.name).toBe("holm");
  });

  test("a scene that already exists is the documented 409, named by its id", async () => {
    await expect(
      writeGenerated("example", {
        scenes: [newScene({ id: "lighthouse-arrival", title: "Another Arrival" })],
      }),
    ).rejects.toMatchObject({ status: 409, extra: { scenes: ["lighthouse-arrival"] } });
    // The scene that was already there is untouched.
    expect((await getScene(SCENE)).title).toBe("Arrival at the Lighthouse");
  });

  test("TWO proposals for one target are a 409, not last-write-win", async () => {
    let conflicts: unknown;
    try {
      await writeGenerated("example", {
        scenes: [newScene(), newScene({ title: "New Scene, different" })],
        npcs: [holm("\nThe first.\n"), holm("\nThe second.\n", { name: "Holm, different" })],
      });
      throw new Error("expected a conflict");
    } catch (error) {
      expect((error as Error).message).toMatch(/same target/);
      conflicts = (error as { extra?: unknown }).extra;
    }
    expect(conflicts).toMatchObject({ scenes: ["new-scene"], npcs: ["holm"] });
    // Nothing was written: the transaction rolled back.
    expect(await sceneStatus("new-scene")).toBe(404);
    expect(await npcStatus("holm")).toBe(404);
  });
});
