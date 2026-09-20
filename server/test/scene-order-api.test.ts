// The order of the scenes inside a chapter: what the tree reads and what
// PUT /api/campaigns/:campaign/chapters/:chapter/scene-order writes.
//
// The order is a LIST of the chapter's, with the glossary's contract: whole
// list in, whole list out, and a guard token of its own. Two things below are
// watched hardest, because both are easy to get wrong — that a refused list
// writes NOTHING, and that a reorder moves no `rev` except the order's, so an
// editor open on a scene or on the chapter text is not dragged into a
// conflict by it.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignTree, ChapterNode, EntryResponse, SceneOrderResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";

const CAMPAIGN = "beispiel";
const CHAPTER = "01-salzhafen";

/** The two scenes the example campaign brings, in their stored order. */
const ARRIVAL = "lighthouse-arrival";
const CAPTURED = "smuggler-captured";

async function tree(): Promise<CampaignTree> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/tree`);
  expect(res.status).toBe(200);
  return (await res.json()) as CampaignTree;
}

async function chapterNode(id = CHAPTER): Promise<ChapterNode> {
  const node = (await tree()).chapters.find((c) => c.id === id);
  expect(node).toBeDefined();
  return node!;
}

async function sceneIds(id = CHAPTER): Promise<string[]> {
  return (await chapterNode(id)).scenes.map((s) => s.id);
}

async function entry(address: string): Promise<EntryResponse> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/entries/${address}`);
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

/** The address of a scene, as the tree currently reports it. */
async function addressOf(sceneId: string, chapter = CHAPTER): Promise<string> {
  const scene = (await chapterNode(chapter)).scenes.find((s) => s.id === sceneId);
  expect(scene).toBeDefined();
  return scene!.path;
}

async function putOrder(
  order: string[],
  rev: number,
  chapter = CHAPTER,
): Promise<Response> {
  return app.request(`/api/campaigns/${CAMPAIGN}/chapters/${chapter}/scene-order`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenes: order, rev }),
  });
}

/** Write `order` against the current token and return the fresh answer. */
async function reorder(order: string[], chapter = CHAPTER): Promise<SceneOrderResponse> {
  const node = await chapterNode(chapter);
  const res = await putOrder(order, node.sceneOrderRev!, chapter);
  expect(res.status).toBe(200);
  return (await res.json()) as SceneOrderResponse;
}

/** Create a scene through the ordinary create endpoint. */
async function createScene(title: string, chapter = CHAPTER): Promise<EntryResponse> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/scenes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, chapter }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as EntryResponse;
}

async function createChapter(title: string): Promise<EntryResponse> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/chapters`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as EntryResponse;
}

beforeEach(async () => {
  await seedStore();
});

afterAll(() => {
  dropStore();
});

describe("the tree reads the stored order", () => {
  test("the chapter lists its scenes by `pos`, with its own guard token", async () => {
    const node = await chapterNode();
    expect(node.scenes.map((s) => s.id)).toEqual([ARRIVAL, CAPTURED]);
    expect(node.sceneOrderRev).toBe(1);
  });

  test("a scene names its location as an id AND as a display name", async () => {
    const [arrival] = (await chapterNode()).scenes;
    expect(arrival?.location).toBe("leuchtturm");
    expect(arrival?.locationName).toBe("Der Leuchtturm von Salzhafen");
  });

  test("a new scene lands at the END of its chapter", async () => {
    await createScene("Ganz zum Schluss");
    expect(await sceneIds()).toEqual([ARRIVAL, CAPTURED, "ganz-zum-schluss"]);
  });

  test("the position counts within the chapter, so a second chapter starts at 0", async () => {
    await createChapter("Zweites Kapitel");
    await createScene("Erste Fremde", "zweites-kapitel");
    await createScene("Zweite Fremde", "zweites-kapitel");
    // The campaign already has scenes, but this chapter's count starts over.
    expect(await sceneIds("zweites-kapitel")).toEqual(["erste-fremde", "zweite-fremde"]);
    // …and the first chapter is untouched by them.
    expect(await sceneIds()).toEqual([ARRIVAL, CAPTURED]);
  });
});

describe("PUT …/chapters/:chapter/scene-order", () => {
  test("the order is read back exactly as it was written", async () => {
    const saved = await reorder([CAPTURED, ARRIVAL]);
    expect(saved.scenes).toEqual([CAPTURED, ARRIVAL]);
    expect(saved.rev).toBe(2);
    expect(await sceneIds()).toEqual([CAPTURED, ARRIVAL]);
    expect((await chapterNode()).sceneOrderRev).toBe(2);
  });

  test("a third scene can be moved to the front", async () => {
    await createScene("Der Nachzügler");
    const saved = await reorder(["der-nachzuegler", ARRIVAL, CAPTURED]);
    expect(saved.scenes).toEqual(["der-nachzuegler", ARRIVAL, CAPTURED]);
    expect(await sceneIds()).toEqual(["der-nachzuegler", ARRIVAL, CAPTURED]);
  });

  test("an unknown chapter is a 404", async () => {
    const res = await putOrder([ARRIVAL], 1, "gibt-es-nicht");
    expect(res.status).toBe(404);
  });
});

describe("a list that is not exactly the chapter's scenes is refused whole", () => {
  /** Assert the 400 and that the stored order and its token did not move. */
  async function refused(order: string[]): Promise<Record<string, unknown>> {
    const before = await chapterNode();
    const res = await putOrder(order, before.sceneOrderRev!);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("scene_order_mismatch");
    // Nothing was written: same order, same token.
    const after = await chapterNode();
    expect(after.scenes.map((s) => s.id)).toEqual(before.scenes.map((s) => s.id));
    expect(after.sceneOrderRev).toBe(before.sceneOrderRev);
    return body;
  }

  test("a MISSING scene — a partial order would have to invent positions", async () => {
    const body = await refused([CAPTURED]);
    expect(body.missing).toEqual([ARRIVAL]);
    expect(body.unknown).toEqual([]);
    expect(body.duplicate).toEqual([]);
  });

  test("a scene from ANOTHER chapter", async () => {
    await createChapter("Zweites Kapitel");
    await createScene("Die Fremde", "zweites-kapitel");
    const body = await refused([ARRIVAL, CAPTURED, "die-fremde"]);
    expect(body.unknown).toEqual(["die-fremde"]);
    expect(body.missing).toEqual([]);
  });

  test("an id that does not exist at all", async () => {
    const body = await refused([ARRIVAL, CAPTURED, "gibt-es-nicht"]);
    expect(body.unknown).toEqual(["gibt-es-nicht"]);
  });

  test("a scene named TWICE — and the one it crowds out is reported with it", async () => {
    const body = await refused([ARRIVAL, ARRIVAL]);
    expect(body.duplicate).toEqual([ARRIVAL]);
    expect(body.missing).toEqual([CAPTURED]);
  });

  test("an empty list for a chapter that has scenes", async () => {
    const body = await refused([]);
    expect(body.missing).toEqual([ARRIVAL, CAPTURED]);
  });
});

describe("the guard", () => {
  test("a stale token is a 409 carrying the current one, and writes nothing", async () => {
    const stale = (await chapterNode()).sceneOrderRev!;
    await reorder([CAPTURED, ARRIVAL]);

    const res = await putOrder([ARRIVAL, CAPTURED], stale);
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("rev_conflict");
    expect(body.rev).toBe(2);
    // The order is a list, not an entry — no `entry` rides along (ADR #26).
    expect(body.entry).toBeUndefined();
    expect(await sceneIds()).toEqual([CAPTURED, ARRIVAL]);
  });

  test("reordering moves NEITHER the scenes' `rev` NOR the chapter entry's", async () => {
    const chapterBefore = await entry(CHAPTER);
    const arrivalBefore = await entry(await addressOf(ARRIVAL));
    const capturedBefore = await entry(await addressOf(CAPTURED));

    await reorder([CAPTURED, ARRIVAL]);

    // An open scene editor and an open chapter-text editor both still save:
    // the reorder is not a write of either entry (ADR #23).
    expect((await entry(await addressOf(ARRIVAL))).rev).toBe(arrivalBefore.rev);
    expect((await entry(await addressOf(CAPTURED))).rev).toBe(capturedBefore.rev);
    expect((await entry(CHAPTER)).rev).toBe(chapterBefore.rev);
  });

  test("editing the chapter's text does not invalidate an open reorder", async () => {
    const orderToken = (await chapterNode()).sceneOrderRev!;
    const chapter = await entry(CHAPTER);
    const patched = await app.request(`/api/campaigns/${CAMPAIGN}/entries/${CHAPTER}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: chapter.rev, body: "## Ziel des Kapitels\n\nEtwas Neues.\n" }),
    });
    expect(patched.status).toBe(200);

    // The token the overview read before that edit still writes.
    const res = await putOrder([CAPTURED, ARRIVAL], orderToken);
    expect(res.status).toBe(200);
  });
});

describe("moving a scene between chapters", () => {
  test("it lands at the END of the chapter it arrives in", async () => {
    await createChapter("Zweites Kapitel");
    await createScene("Die Erste Dort", "zweites-kapitel");
    await createScene("Die Zweite Dort", "zweites-kapitel");

    const address = await addressOf(ARRIVAL);
    const before = await entry(address);
    const res = await app.request(`/api/campaigns/${CAMPAIGN}/entries/${address}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: before.rev, properties: { chapter: "zweites-kapitel" } }),
    });
    expect(res.status).toBe(200);

    expect(await sceneIds("zweites-kapitel")).toEqual([
      "die-erste-dort",
      "die-zweite-dort",
      ARRIVAL,
    ]);
    expect(await sceneIds()).toEqual([CAPTURED]);
  });

  test("a patch that leaves the chapter alone leaves the order alone", async () => {
    await createScene("Der Dritte");
    await reorder(["der-dritte", ARRIVAL, CAPTURED]);

    const address = await addressOf(ARRIVAL);
    const before = await entry(address);
    const res = await app.request(`/api/campaigns/${CAMPAIGN}/entries/${address}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: before.rev, properties: { status: "played" } }),
    });
    expect(res.status).toBe(200);
    expect(await sceneIds()).toEqual(["der-dritte", ARRIVAL, CAPTURED]);
  });
});
