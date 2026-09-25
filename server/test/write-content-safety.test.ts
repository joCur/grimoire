// Two write paths that must write all of a request or none of it.
//
//   * `writeGenerated` — accepting a generator run: a scene whose id is taken
//     is the 409 that names it, checked inside the insert transaction, and a
//     conflict anywhere in the batch writes none of it.
//   * `POST /log` — a quick note's scene is a reference, so a `sceneId` that is
//     no slug is a 400 and appends nothing; a legal one lands in its own
//     column.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { CampaignTree, SceneProposal, SessionResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { ApiError } from "../src/api-error";
import { writeGenerated } from "../src/store/generated";
import { dropStore, seedStore } from "./support/store";

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

async function tree(): Promise<CampaignTree> {
  const res = await app.request("/api/campaigns/beispiel/tree");
  expect(res.status).toBe(200);
  return (await res.json()) as CampaignTree;
}

beforeEach(async () => {
  setSystemTime(new Date(2026, 7, 19, 21, 5));
  await seedStore();
});

afterEach(() => {
  setSystemTime();
  dropStore();
});

describe("writeGenerated — the conflict check is IN the insert transaction", () => {
  /** A proposed scene, as the generator hands it over — the scene without its guard. */
  function proposal(id: string): SceneProposal {
    return {
      id,
      title: id,
      type: "planned",
      chapter: "01-salzhafen",
      npcs: [],
      handouts: [],
      tags: [],
      status: "draft",
      body: "\n## Flow\n\nNeu.\n",
    };
  }

  test("an existing target is the documented 409 { scenes }, never a 500", async () => {
    // The check runs inside the insert transaction, so no target can appear
    // between "free" and "insert" and turn the answer into a primary-key
    // violation.
    let thrown: unknown;
    try {
      await writeGenerated("beispiel", { scenes: [proposal("lighthouse-arrival")] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    const api = thrown as ApiError;
    expect(api.status).toBe(409);
    // reported by the scene's id
    expect(api.extra?.scenes).toEqual(["lighthouse-arrival"]);
  });

  test("all or nothing: a conflict late in the batch writes none of it", async () => {
    const before = await tree();
    await expect(
      writeGenerated("beispiel", {
        scenes: [proposal("ganz-neu"), proposal("smuggler-captured")],
      }),
    ).rejects.toThrow();
    // not even the first, conflict-free scene landed
    expect(await tree()).toEqual(before);
  });
});

describe("POST /log — a note's scene is a reference, and a reference is a slug", () => {
  test("a sceneId outside the slug shape is refused, nothing appended", async () => {
    const start = await postJson("/api/campaigns/beispiel/session/start");
    expect(start.status).toBe(200);
    const before = (await start.json()) as SessionResponse;
    // (An EMPTY sceneId is not in this list: the route normalises it away to
    // "no scene", which is the same thing as omitting the key.)
    for (const sceneId of ["boom) und mehr", "a b", "Gross", "with/slash", "-lead"]) {
      const res = await postJson("/api/campaigns/beispiel/log", { text: "Notiz", sceneId });
      expect(res.status).toBe(400);
    }
    const unchanged = await app.request(`/api/campaigns/beispiel/sessions/${before.id}`);
    expect(await unchanged.json()).toEqual(before);
    // the legal form still works, and lands in its own column
    const ok = await postJson("/api/campaigns/beispiel/log", {
      text: "Notiz",
      sceneId: "lighthouse-arrival",
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as SessionResponse).log.at(-1)).toMatchObject({
      sceneId: "lighthouse-arrival",
      text: "Notiz",
    });
  });
});
