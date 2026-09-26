// The status write. What matters is the payload (the rev must be the one of
// the scene the DM was looking at) and the 409 path — the server wrote
// NOTHING then, so the UI must re-read the scene and let the next attempt
// carry the fresh rev.

import { SCENE_STATUSES, type Scene, type SceneStatus } from "@grimoire/shared/scene";
import { afterEach, describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { translator } from "@/i18n/format";
import {
  isSceneDone,
  sceneStatusMeta,
  sceneStatusOptions,
  sceneStatusPatchBody,
  writeSceneStatus,
} from "./scene-status";

// The labels come from the catalog and the translator is passed in, so a test
// names the language it asserts instead of leaning on a default.
const t = translator("de");
const tEn = translator("en");

const SCENE = "ankunft-leuchtturm";

function sceneAt(rev: number, status: SceneStatus): Scene {
  return {
    id: SCENE,
    title: "Ankunft",
    type: "planned",
    chapter: "01-salzhafen",
    npcs: [],
    handouts: [],
    tags: [],
    status,
    body: "",
    rev,
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Answers the queued responses in order and records every request. */
function mockFetch(answers: Array<{ status: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const answer = answers.shift() ?? { status: 500, body: { error: "no answer queued" } };
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("sceneStatusPatchBody", () => {
  test("patches only `status`, with the rev of the loaded scene", () => {
    expect(sceneStatusPatchBody(1_700_000_000_123, "ready")).toEqual({
      rev: 1_700_000_000_123,
      status: "ready",
    });
  });

  test("no other field of the scene is touched", () => {
    const body = sceneStatusPatchBody(1, "played");
    expect(Object.keys(body)).toEqual(["rev", "status"]);
  });
});

describe("writeSceneStatus", () => {
  test("PATCHes the scene and returns the server's scene", async () => {
    const calls = mockFetch([{ status: 200, body: sceneAt(222, "ready") }]);
    const result = await writeSceneStatus("beispiel", SCENE, 111, "ready");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe(`/api/campaigns/beispiel/scenes/${SCENE}`);
    expect(calls[0]?.body).toEqual({ rev: 111, status: "ready" });
    expect(result.ok).toBe(true);
    expect(result.row?.rev).toBe(222);
  });

  test("409: nothing written, the scene is re-read for the fresh rev", async () => {
    const calls = mockFetch([
      { status: 409, body: { code: "rev_conflict", error: "scene changed", rev: 999 } },
      { status: 200, body: sceneAt(999, "draft") },
    ]);
    const result = await writeSceneStatus("beispiel", SCENE, 111, "ready");

    expect(result.ok).toBe(false);
    expect(result.row?.rev).toBe(999);
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.url).toBe(`/api/campaigns/beispiel/scenes/${SCENE}`);
  });

  test("the attempt after a conflict carries the rev the reload brought", async () => {
    mockFetch([
      { status: 409, body: { code: "rev_conflict", error: "scene changed", rev: 999 } },
      { status: 200, body: sceneAt(999, "draft") },
    ]);
    const conflict = await writeSceneStatus("beispiel", SCENE, 111, "ready");
    const fresh = conflict.row?.rev;

    const calls = mockFetch([{ status: 200, body: sceneAt(1000, "ready") }]);
    const retry = await writeSceneStatus("beispiel", SCENE, fresh ?? 0, "ready");

    expect(calls[0]?.body).toEqual({ rev: 999, status: "ready" });
    expect(retry.ok).toBe(true);
  });

  test("409 plus a failed reload: still a conflict, no scene to seed", async () => {
    mockFetch([
      { status: 409, body: { code: "rev_conflict", error: "scene changed", rev: 999 } },
      { status: 500, body: { error: "boom" } },
    ]);
    expect(await writeSceneStatus("beispiel", SCENE, 111, "ready")).toEqual({ ok: false });
  });

  test("every other failure throws (the control shows its quiet line)", async () => {
    mockFetch([{ status: 500, body: { error: "boom" } }]);
    await expect(writeSceneStatus("beispiel", SCENE, 111, "ready")).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe("status labels", () => {
  test("the menu offers exactly the known quartet, German and in lifecycle order", () => {
    expect(sceneStatusOptions(t).map((o) => o.value)).toEqual([
      "draft",
      "ready",
      "played",
      "dropped",
    ]);
    expect(sceneStatusOptions(t).map((o) => o.label)).toEqual([
      "Entwurf",
      "Bereit",
      "Gespielt",
      "Verworfen",
    ]);
  });

  test("and the same quartet in English", () => {
    expect(sceneStatusOptions(tEn).map((o) => o.label)).toEqual([
      "draft",
      "ready",
      "played",
      "dropped",
    ]);
  });

  test("a value from outside the four is not a status at all", () => {
    // The column is a CHECK constraint, so the database cannot hold anything
    // else (ADR #25) and there is no value left for the renderer to fall back
    // for — the type is what says so.
    // @ts-expect-error not one of draft | ready | played | dropped
    const foreign: SceneStatus = "verschollen";
    expect(SCENE_STATUSES as readonly string[]).not.toContain(foreign);
  });
});

// The split the live nav groups by.
describe("isSceneDone", () => {
  test("played and dropped are behind us", () => {
    expect(isSceneDone("played")).toBe(true);
    expect(isSceneDone("dropped")).toBe(true);
  });

  test("draft and ready are still planned", () => {
    expect(isSceneDone("draft")).toBe(false);
    expect(isSceneDone("ready")).toBe(false);
  });

});
