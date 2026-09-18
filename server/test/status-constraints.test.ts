// Where the DM meets the closed columns (ADR #25): a status or a type the
// column does not accept is a 400 with a code, from every write path.
//
// The point of these cases is the ANSWER, not the constraint. The constraint
// alone would answer "CHECK constraint failed" as a 500, which tells the app
// nothing and the DM less; the store checks first and names the field, the
// value and the list, so the app can print a sentence and the entry stays as
// it was.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntryResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";
const NPC = "npcs/jorna";
const CHAPTER = "01-salzhafen";

async function read(rel: string): Promise<EntryResponse> {
  const res = await app.request(entriesUrl("beispiel", rel));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function patch(rel: string, body: unknown): Promise<Response> {
  return app.request(entriesUrl("beispiel", rel), {
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
async function refusal(rel: string, properties: Record<string, unknown>): Promise<Refusal> {
  const before = await read(rel);
  const res = await patch(rel, { rev: before.rev, properties });
  expect(res.status).toBe(400);
  // Nothing was written — the guard token has not moved.
  expect((await read(rel)).rev).toBe(before.rev);
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
    const body = await refusal(NPC, { status: "tot" });
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

  test("a value of the list is written, and clearing the field is allowed", async () => {
    const before = await read(SCENE);
    const res = await patch(SCENE, { rev: before.rev, properties: { status: "played" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as EntryResponse).properties.status).toBe("played");

    // `null` is not a foreign value: it clears the key, and the column falls
    // back to its default.
    const cleared = await read(SCENE);
    const next = await patch(SCENE, { rev: cleared.rev, properties: { status: null } });
    expect(next.status).toBe(200);
    expect(((await next.json()) as EntryResponse).properties.status).toBe("draft");
  });
});
