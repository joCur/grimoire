// `writeGenerated` — accepting a generator run — writes all of a request or
// none of it: a scene whose id is taken is the 409 that names it, checked
// inside the insert transaction, and a conflict anywhere in the batch writes
// none of it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignTree, SceneProposal } from "@grimoire/shared";
import { app } from "../src/server";
import { ApiError } from "../src/api-error";
import { writeGenerated } from "../src/store/generated";
import { dropStore, seedStore } from "./support/store";

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
