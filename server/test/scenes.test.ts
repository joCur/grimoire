// The scene resource (decisions/resources): `GET …/scenes`, `GET` and `PATCH
// …/scenes/:id`, `POST …/scenes`, every field of a scene flat — `body` among
// them — beside its `rev`, and every write checked against the scene's
// schema. A scene lies flat under its campaign; the address it once had
// under its chapter names nothing.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignTree, Scene } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

const SCENES = "/api/campaigns/example/scenes";
const ARRIVAL = `${SCENES}/lighthouse-arrival`;
const CAPTURED = `${SCENES}/smuggler-captured`;

async function getScene(url = ARRIVAL): Promise<Scene> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return (await res.json()) as Scene;
}

async function send(method: string, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const patchScene = (body: Record<string, unknown>, url = ARRIVAL): Promise<Response> =>
  send("PATCH", url, body);
const createScene = (body: Record<string, unknown>): Promise<Response> =>
  send("POST", SCENES, body);

async function chapterScenes(chapter: string): Promise<string[]> {
  const tree = (await (await app.request("/api/campaigns/example/tree")).json()) as CampaignTree;
  return tree.chapters.find((node) => node.id === chapter)?.scenes.map((s) => s.id) ?? [];
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("reading a scene", () => {
  test("GET answers every field flat — no kind, no path, no properties", async () => {
    const arrival = await getScene();
    expect(arrival).toEqual({
      id: "lighthouse-arrival",
      title: "Arrival at the Lighthouse",
      type: "planned",
      chapter: "01-salt-harbour",
      location: "lighthouse",
      npcs: ["jorna"],
      handouts: ["Map of Salt Harbour"],
      tags: ["social", "travel"],
      status: "ready",
      body: arrival.body,
      rev: arrival.rev,
    });
    // The reference scene arrives with its callouts, character for character.
    expect(arrival.body).toContain("> [!readaloud] The tower rises black");
    expect(arrival.body).toContain("> | d6 | What the surf washes up |");
  });

  test("an optional field that holds something is there; the lists are always there", async () => {
    const captured = await getScene(CAPTURED);
    expect(captured.type).toBe("contingency");
    expect(captured.trigger).toBe("The characters are spotted while scouting the cove");
    expect(captured.handouts).toEqual([]);
    expect(captured.body).toContain("## If: they lie");
  });

  test("the list answers every scene in its own shape, in the chapter's order", async () => {
    const res = await app.request(SCENES);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Scene[];
    expect(list.map((scene) => scene.id)).toEqual(["lighthouse-arrival", "smuggler-captured"]);
    expect(list[0]).toEqual(await getScene());
  });

  test("404 for an unknown scene or campaign", async () => {
    expect((await app.request(`${SCENES}/does-not-exist`)).status).toBe(404);
    expect((await app.request("/api/campaigns/nowhere/scenes/lighthouse-arrival")).status).toBe(
      404,
    );
  });

  test("the entry address of a scene names nothing — GET and PATCH are 404", async () => {
    const before = await getScene();
    for (const address of [
      "01-salt-harbour/lighthouse/lighthouse-arrival",
      "01-salt-harbour/lighthouse-arrival",
    ]) {
      const url = entriesUrl("example", address);
      expect((await app.request(url)).status).toBe(404);
      const res = await send("PATCH", url, { rev: before.rev, body: "Overwritten.\n" });
      expect(res.status).toBe(404);
    }
    expect(await getScene()).toEqual(before);
  });
});

describe("writing a scene", () => {
  test("only the named fields change; `null` clears an optional one", async () => {
    const before = await getScene(CAPTURED);
    const res = await patchScene(
      { rev: before.rev, status: "played", trigger: null, location: null },
      CAPTURED,
    );
    expect(res.status).toBe(200);
    const after = (await res.json()) as Scene;
    expect(after.status).toBe("played");
    expect(Object.hasOwn(after, "trigger")).toBe(false);
    expect(Object.hasOwn(after, "location")).toBe(false);
    expect(after.npcs).toEqual(before.npcs);
    expect(after.tags).toEqual(before.tags);
    expect(after.body).toBe(before.body);
    expect(after.rev).toBe(before.rev + 1);
    expect(await getScene(CAPTURED)).toEqual(after);
  });

  test("the body is a field like the others — written with the lists in one step", async () => {
    const before = await getScene();
    const res = await patchScene({
      rev: before.rev,
      npcs: ["fenn", "jorna"],
      handouts: [],
      tags: ["combat"],
      body: "\n## Flow\n\nCompletely rewritten.",
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Scene;
    expect(after.npcs).toEqual(["fenn", "jorna"]);
    expect(after.handouts).toEqual([]);
    expect(after.tags).toEqual(["combat"]);
    // A body gets its closing newline, and nothing else about it changes.
    expect(after.body).toBe("\n## Flow\n\nCompletely rewritten.\n");
    expect(after.rev).toBe(before.rev + 1);
    expect(await getScene()).toEqual(after);
  });

  test("unknown callouts and headings survive a write verbatim", async () => {
    const before = await getScene(CAPTURED);
    const body = "\n## Entirely Our Own\n\n> [!weather] Fog over the cove\n\n### Sub-Title\n";
    const after = (await (await patchScene({ rev: before.rev, body }, CAPTURED)).json()) as Scene;
    expect(after.body).toBe(body);
    const back = (await (
      await patchScene({ rev: after.rev, body: before.body }, CAPTURED)
    ).json()) as Scene;
    expect(back).toEqual({ ...before, rev: before.rev + 2 });
  });

  test("400 for a field a scene does not have — named, and nothing written", async () => {
    const before = await getScene();
    for (const extra of [
      { name: "X" },
      { properties: { title: "X" } },
      { kind: "scene" },
      { path: "01-salt-harbour/lighthouse-arrival" },
      { pos: 0 },
    ]) {
      const res = await patchScene({ rev: before.rev, ...extra });
      expect(res.status).toBe(400);
      const key = Object.keys(extra)[0]!;
      expect(((await res.json()) as { error: string }).error).toContain(key);
    }
    expect((await getScene()).rev).toBe(before.rev);
  });

  test("400 for a value of the wrong shape, naming the field — nothing written", async () => {
    const before = await getScene();
    for (const [key, value] of [
      ["title", 7],
      ["title", null],
      ["npcs", "jorna"],
      ["tags", null],
      ["handouts", [1]],
      ["body", 3],
    ] as const) {
      const res = await patchScene({ rev: before.rev, [key]: value });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(key);
    }
    expect((await patchScene({ title: "without rev" })).status).toBe(400);
    expect((await getScene()).rev).toBe(before.rev);
  });

  test("a status or a type outside its list is a 400 with the code the app has a sentence for", async () => {
    const before = await getScene();
    const status = await patchScene({ rev: before.rev, status: "finished" });
    expect(status.status).toBe(400);
    expect(await status.json()).toMatchObject({ code: "status_not_allowed", kind: "scene" });
    const type = await patchScene({ rev: before.rev, type: "optional" });
    expect(type.status).toBe(400);
    expect(await type.json()).toMatchObject({ code: "scene_type_not_allowed" });
    expect((await getScene()).rev).toBe(before.rev);
  });

  test("the chapter can change but never be cleared", async () => {
    const before = await getScene();
    const res = await patchScene({ rev: before.rev, chapter: null });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "chapter_required" });
    expect(await getScene()).toEqual(before);
  });

  test("every reference has to name something — 400 with the create-this-first code", async () => {
    const before = await getScene();
    for (const [fields, code] of [
      [{ chapter: "99-nowhere" }, "chapter_unknown"],
      [{ location: "nowhere" }, "location_unknown"],
      [{ npcs: ["jorna", "nobody"] }, "npc_unknown"],
      [{ location: "The Lighthouse" }, "location_not_an_id"],
    ] as const) {
      const res = await patchScene({ rev: before.rev, ...fields });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code });
    }
    expect(await getScene()).toEqual(before);
  });

  test("a scene that changes chapter lands at the end of the new one", async () => {
    const chapter = await send("POST", "/api/campaigns/example/chapters", {
      title: "Second Chapter",
    });
    expect(chapter.status).toBe(201);
    expect((await createScene({ title: "The First There", chapter: "second-chapter" })).status).toBe(
      201,
    );
    const before = await getScene();
    const res = await patchScene({ rev: before.rev, chapter: "second-chapter" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Scene).chapter).toBe("second-chapter");
    expect(await chapterScenes("second-chapter")).toEqual(["the-first-there", "lighthouse-arrival"]);
    expect(await chapterScenes("01-salt-harbour")).toEqual(["smuggler-captured"]);
  });

  test("the id may be echoed, never changed; an empty patch writes nothing", async () => {
    const before = await getScene();
    expect((await patchScene({ rev: before.rev, id: "arrival" })).status).toBe(400);
    const echoed = await patchScene({ rev: before.rev, id: "lighthouse-arrival", status: "played" });
    expect(echoed.status).toBe(200);
    const empty = await patchScene({ rev: before.rev + 1 });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ code: "nothing_to_write" });
    expect((await getScene()).rev).toBe(before.rev + 1);
  });

  test("a stale rev is 409 with the current scene; force writes only what it carries", async () => {
    const read = await getScene();
    // Somebody else changes the status while the editor is open.
    expect((await patchScene({ rev: read.rev, status: "played" })).status).toBe(200);

    const refused = await patchScene({ rev: read.rev, body: "\n## Flow\n\nToo late.\n" });
    expect(refused.status).toBe(409);
    const conflict = (await refused.json()) as { code: string; rev: number; scene: Scene };
    expect(conflict.code).toBe("rev_conflict");
    expect(conflict.scene.status).toBe("played");
    expect(conflict.rev).toBe(conflict.scene.rev);

    // The save-anyway action writes the text, and nothing else.
    const forced = await patchScene({
      rev: read.rev,
      body: "\n## Flow\n\nSaved anyway.\n",
      force: true,
    });
    expect(forced.status).toBe(200);
    const written = (await forced.json()) as Scene;
    expect(written.body).toBe("\n## Flow\n\nSaved anyway.\n");
    expect(written.status).toBe("played");
  });

  test("404 for an unknown scene", async () => {
    expect((await patchScene({ rev: 1, title: "X" }, `${SCENES}/does-not-exist`)).status).toBe(404);
  });

  test("the search index follows a new title, and the hit carries no address", async () => {
    const before = await getScene();
    expect((await patchScene({ rev: before.rev, title: "Night at the Tower" })).status).toBe(200);
    const res = await app.request("/api/campaigns/example/search?q=Night");
    const { results } = (await res.json()) as { results: Array<Record<string, unknown>> };
    const hit = results.find((r) => r.kind === "scene" && r.id === "lighthouse-arrival");
    expect(hit?.title).toBe("Night at the Tower");
    expect(Object.hasOwn(hit!, "path")).toBe(false);
  });
});

describe("creating a scene", () => {
  test("from the title: the id is derived, the scene is a draft at the end of its chapter", async () => {
    const res = await createScene({ title: "The Latecomer", chapter: "01-salt-harbour" });
    expect(res.status).toBe(201);
    const scene = (await res.json()) as Scene;
    expect(scene).toEqual({
      id: "the-latecomer",
      title: "The Latecomer",
      type: "planned",
      chapter: "01-salt-harbour",
      npcs: [],
      handouts: [],
      tags: [],
      status: "draft",
      body: "",
      rev: scene.rev,
    });
    expect(await getScene(`${SCENES}/the-latecomer`)).toEqual(scene);
    expect(await chapterScenes("01-salt-harbour")).toEqual([
      "lighthouse-arrival",
      "smuggler-captured",
      "the-latecomer",
    ]);
  });

  test("the chapter is required and has to exist", async () => {
    expect((await createScene({ title: "Somewhere" })).status).toBe(400);
    const unknown = await createScene({ title: "Somewhere", chapter: "99-nowhere" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: "chapter_unknown" });
  });

  test("a taken id is a 409 with a free proposal and no address — nothing is written", async () => {
    const before = await getScene();
    const res = await createScene({
      title: "Arrival",
      chapter: "01-salt-harbour",
      id: "lighthouse-arrival",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      code: "slug_taken",
      kind: "scene",
      id: "lighthouse-arrival",
      suggestion: "lighthouse-arrival-2",
    });
    expect(Object.hasOwn(body, "path")).toBe(false);
    expect(await getScene()).toEqual(before);
  });

  test("400 for a key the create does not take, and for a missing title", async () => {
    expect(
      (await createScene({ title: "Holm", chapter: "01-salt-harbour", status: "ready" })).status,
    ).toBe(400);
    expect((await createScene({ chapter: "01-salt-harbour" })).status).toBe(400);
    expect((await createScene({ title: "   ", chapter: "01-salt-harbour" })).status).toBe(400);
    expect(
      (await createScene({ title: "Holm", chapter: "01-salt-harbour", id: "Not A Slug" })).status,
    ).toBe(400);
  });
});
