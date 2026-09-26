// Where the DM meets the closed columns (decisions/constraints): a status or a type the
// column does not accept is a 400 with a code, from every write path.
//
// The point of these cases is the ANSWER, not the constraint. The constraint
// alone would answer "CHECK constraint failed" as a 500, which tells the app
// nothing and the DM less; the store checks first and names the field, the
// value and the list, so the app can print a sentence and the row stays as
// it was.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Chapter, Npc, Scene } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";

/** A chapter, a scene and an npc are their own resources (decisions/resources): their fields travel flat. */
const SCENE = "/api/campaigns/beispiel/scenes/lighthouse-arrival";
const CHAPTER = "/api/campaigns/beispiel/chapters/01-salzhafen";
const NPC_URL = "/api/campaigns/beispiel/npcs/jorna";

async function read(url: string): Promise<{ rev: number }> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return (await res.json()) as { rev: number };
}

async function patch(url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface Refusal {
  code: string;
  error: string;
  value: string;
  allowed: string[];
  kind?: string;
}

/** PATCH one field to a foreign value and read the refusal. */
async function refusal(url: string, fields: Record<string, unknown>): Promise<Refusal> {
  const before = await read(url);
  const res = await patch(url, { rev: before.rev, ...fields });
  expect(res.status).toBe(400);
  // Nothing was written — the guard token has not moved.
  expect((await read(url)).rev).toBe(before.rev);
  return (await res.json()) as Refusal;
}

describe("a foreign status or type is a 400", () => {
  beforeEach(async () => {
    await seedStore();
  });
  afterEach(() => {
    dropStore();
  });

  test("a scene status outside the four positions", async () => {
    const body = await refusal(SCENE, { status: "halbfertig" });
    expect(body.code).toBe("status_not_allowed");
    expect(body.kind).toBe("scene");
    expect(body.value).toBe("halbfertig");
    expect(body.allowed).toEqual(["draft", "ready", "played", "dropped"]);
    // The English `error` stays as the technical fallback next to the code.
    expect(body.error).toContain("halbfertig");
  });

  test("a scene type outside the two kinds — its own code", async () => {
    const body = await refusal(SCENE, { type: "optional" });
    expect(body.code).toBe("scene_type_not_allowed");
    expect(body.value).toBe("optional");
    expect(body.allowed).toEqual(["planned", "contingency"]);
  });

  test("an npc status outside the four positions", async () => {
    const before = (await (await app.request(NPC_URL)).json()) as Npc;
    const res = await app.request(NPC_URL, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: before.rev, status: "tot" }),
    });
    expect(res.status).toBe(400);
    expect(((await (await app.request(NPC_URL)).json()) as Npc).rev).toBe(before.rev);
    const body = (await res.json()) as Refusal;
    expect(body.code).toBe("status_not_allowed");
    expect(body.kind).toBe("npc");
    expect(body.allowed).toEqual(["alive", "dead", "missing", "unknown"]);
  });

  test("a chapter status outside the three positions", async () => {
    const body = await refusal(CHAPTER, { status: "begonnen" });
    expect(body.code).toBe("status_not_allowed");
    expect(body.kind).toBe("chapter");
    expect(body.allowed).toEqual(["planned", "active", "done"]);
  });

  test("a value of the list is written; a chapter's status can be cleared", async () => {
    const before = await read(SCENE);
    const res = await patch(SCENE, { rev: before.rev, status: "played" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Scene).status).toBe("played");

    // `null` is not a foreign value: on a chapter it clears the status.
    const chapter = await read(CHAPTER);
    const next = await patch(CHAPTER, { rev: chapter.rev, status: null });
    expect(next.status).toBe(200);
    expect(Object.hasOwn((await next.json()) as Chapter, "status")).toBe(false);
  });
});
