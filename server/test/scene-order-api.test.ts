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
import type {
  CampaignTree,
  Chapter,
  ChapterNode,
  Scene,
  SceneOrderResponse,
} from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";

const CAMPAIGN = "example";
const CHAPTER = "01-salt-harbour";

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

/** One chapter, from its own resource. */
async function chapter(id: string): Promise<Chapter> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/chapters/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Chapter;
}

/** One scene, from its own resource. */
async function scene(id: string): Promise<Scene> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/scenes/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Scene;
}

/** Patch one scene on its own resource against the rev it holds now. */
async function patchScene(id: string, fields: Record<string, unknown>): Promise<Response> {
  const before = await scene(id);
  return app.request(`/api/campaigns/${CAMPAIGN}/scenes/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: before.rev, ...fields }),
  });
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
async function createScene(title: string, chapter = CHAPTER): Promise<Scene> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/scenes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, chapter }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Scene;
}

async function createChapter(title: string): Promise<Chapter> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/chapters`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Chapter;
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
    expect(arrival?.location).toBe("lighthouse");
    expect(arrival?.locationName).toBe("The Lighthouse of Salt Harbour");
  });

  test("a new scene lands at the END of its chapter", async () => {
    await createScene("At the very end");
    expect(await sceneIds()).toEqual([ARRIVAL, CAPTURED, "at-the-very-end"]);
  });

  test("the position counts within the chapter, so a second chapter starts at 0", async () => {
    await createChapter("Second chapter");
    await createScene("First stranger", "second-chapter");
    await createScene("Second stranger", "second-chapter");
    // The campaign already has scenes, but this chapter's count starts over.
    expect(await sceneIds("second-chapter")).toEqual(["first-stranger", "second-stranger"]);
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
    await createScene("The latecomer");
    const saved = await reorder(["the-latecomer", ARRIVAL, CAPTURED]);
    expect(saved.scenes).toEqual(["the-latecomer", ARRIVAL, CAPTURED]);
    expect(await sceneIds()).toEqual(["the-latecomer", ARRIVAL, CAPTURED]);
  });

  test("an unknown chapter is a 404", async () => {
    const res = await putOrder([ARRIVAL], 1, "does-not-exist");
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
    await createChapter("Second chapter");
    await createScene("The stranger", "second-chapter");
    const body = await refused([ARRIVAL, CAPTURED, "the-stranger"]);
    expect(body.unknown).toEqual(["the-stranger"]);
    expect(body.missing).toEqual([]);
  });

  test("an id that does not exist at all", async () => {
    const body = await refused([ARRIVAL, CAPTURED, "does-not-exist"]);
    expect(body.unknown).toEqual(["does-not-exist"]);
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
    // The order is no field of the chapter — no chapter rides along.
    expect(body.chapter).toBeUndefined();
    expect(await sceneIds()).toEqual([CAPTURED, ARRIVAL]);
  });

  test("reordering moves NEITHER the scenes' `rev` NOR the chapter's", async () => {
    const chapterBefore = await chapter(CHAPTER);
    const arrivalBefore = await scene(ARRIVAL);
    const capturedBefore = await scene(CAPTURED);

    await reorder([CAPTURED, ARRIVAL]);

    // An open scene editor and an open chapter-text editor both still save:
    // the reorder is a write of neither (decisions/writes).
    expect((await scene(ARRIVAL)).rev).toBe(arrivalBefore.rev);
    expect((await scene(CAPTURED)).rev).toBe(capturedBefore.rev);
    expect((await chapter(CHAPTER)).rev).toBe(chapterBefore.rev);
  });

  test("editing the chapter's text does not invalidate an open reorder", async () => {
    const orderToken = (await chapterNode()).sceneOrderRev!;
    const before = await chapter(CHAPTER);
    const patched = await app.request(`/api/campaigns/${CAMPAIGN}/chapters/${CHAPTER}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: before.rev, body: "Something new.\n" }),
    });
    expect(patched.status).toBe(200);

    // The token the overview read before that edit still writes.
    const res = await putOrder([CAPTURED, ARRIVAL], orderToken);
    expect(res.status).toBe(200);
  });
});

describe("moving a scene between chapters", () => {
  test("it lands at the END of the chapter it arrives in", async () => {
    await createChapter("Second chapter");
    await createScene("The first one there", "second-chapter");
    await createScene("The second one there", "second-chapter");

    const tokens = async (): Promise<unknown[]> => [
      (await chapterNode()).sceneOrderRev,
      (await chapterNode("second-chapter")).sceneOrderRev,
    ];
    const tokensBefore = await tokens();
    const res = await patchScene(ARRIVAL, { chapter: "second-chapter" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Scene).chapter).toBe("second-chapter");

    expect(await sceneIds("second-chapter")).toEqual([
      "the-first-one-there",
      "the-second-one-there",
      ARRIVAL,
    ]);
    expect(await sceneIds()).toEqual([CAPTURED]);
    // Moving a scene writes the scene, not either chapter's order.
    expect(await tokens()).toEqual(tokensBefore);
  });

  test("a patch that leaves the chapter alone leaves the order alone", async () => {
    await createScene("The third");
    await reorder(["the-third", ARRIVAL, CAPTURED]);

    const res = await patchScene(ARRIVAL, { status: "played" });
    expect(res.status).toBe(200);
    expect(await sceneIds()).toEqual(["the-third", ARRIVAL, CAPTURED]);
  });
});
