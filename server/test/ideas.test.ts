// The idea resource (decisions/resources): `GET/POST …/ideas`, `GET/PATCH …/ideas/:id`,
// every field of an idea flat — `{ id, text, done, rev }`. An idea is written
// once; ticking it off is a PATCH of its `done` against its own `rev`, and
// its text never changes.
//
// Every case runs against its OWN in-memory database, seeded from the
// committed JSON fixtures by the real loader (test/support/store.ts); the
// example campaign brings one open idea.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Idea } from "@grimoire/shared/idea";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { seedCampaign } from "../src/db/seed";
import { dropStore, seedStore } from "./support/store";

const IDEAS = "/api/campaigns/beispiel/ideas";
const SEEDED: Idea = {
  id: "dorfschmied",
  text: "Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug #thread",
  done: false,
  rev: 1,
};
const SEEDED_URL = `${IDEAS}/${SEEDED.id}`;

async function send(method: string, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json<T>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const answer = await res;
  expect(answer.status).toBe(status);
  return (await answer.json()) as T;
}

const listIdeas = (url = IDEAS) => json<Idea[]>(app.request(url));
const createIdea = (body: unknown, url = IDEAS) => send("POST", url, body);
const patchIdea = (body: unknown, url = SEEDED_URL) => send("PATCH", url, body);

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("reading ideas", () => {
  test("GET answers every field flat, and the list every idea in its order", async () => {
    expect(await json<Idea>(app.request(SEEDED_URL))).toEqual(SEEDED);
    expect(await listIdeas()).toEqual([SEEDED]);
  });

  test("a campaign without ideas answers an empty list, not a 404", async () => {
    seedCampaign(await getDb(), { campaign: { id: "frischling", name: "", body: "", glossaryIntro: "" } });
    expect(await listIdeas("/api/campaigns/frischling/ideas")).toEqual([]);
  });

  test("404 for an unknown idea or campaign", async () => {
    expect((await app.request(`${IDEAS}/no-such-id`)).status).toBe(404);
    expect((await app.request("/api/campaigns/nope/ideas")).status).toBe(404);
    expect((await createIdea({ text: "x" }, "/api/campaigns/nope/ideas")).status).toBe(404);
  });

  test("the inbox and its tick-off action name nothing", async () => {
    expect((await app.request("/api/campaigns/beispiel/inbox")).status).toBe(404);
    expect((await send("POST", "/api/campaigns/beispiel/inbox", { text: "x" })).status).toBe(404);
    const tick = await send("POST", "/api/campaigns/beispiel/review/inbox-done", { id: SEEDED.id });
    expect(tick.status).toBe(404);
    expect(await listIdeas()).toEqual([SEEDED]);
  });
});

describe("throwing an idea in", () => {
  test("a new idea is open, stands at the end, and has an id of its own", async () => {
    const created = await json<Idea>(createIdea({ text: "Schmied beobachten #thread" }), 201);
    expect(created).toEqual({
      id: expect.any(String),
      text: "Schmied beobachten #thread",
      done: false,
      rev: 1,
    });
    expect(await listIdeas()).toEqual([SEEDED, created]);
  });

  test("two ideas with the same text are two ideas with two ids", async () => {
    const first = await json<Idea>(createIdea({ text: "Doppelt" }), 201);
    const second = await json<Idea>(createIdea({ text: "Doppelt" }), 201);
    expect(first.id).not.toBe(second.id);
    await json<Idea>(patchIdea({ rev: 1, done: true }, `${IDEAS}/${second.id}`));
    const doubles = (await listIdeas()).filter((idea) => idea.text === "Doppelt");
    expect(doubles.map((idea) => idea.done)).toEqual([false, true]);
  });

  test("the text is one line: trimmed, inner newlines folded", async () => {
    const created = await json<Idea>(createIdea({ text: "  eins\n zwei " }), 201);
    expect(created.text).toBe("eins zwei");
  });

  test("400 for empty or missing text and for an unknown key — naming it", async () => {
    expect((await createIdea({ text: "  " })).status).toBe(400);
    expect((await createIdea({})).status).toBe(400);
    const unknown = await createIdea({ text: "x", done: true });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toContain("done");
    expect(await listIdeas()).toEqual([SEEDED]);
  });
});

describe("ticking an idea off", () => {
  test("PATCH done ticks it off — and back on — against its own rev", async () => {
    const ticked = await json<Idea>(patchIdea({ rev: 1, done: true }));
    expect(ticked).toEqual({ ...SEEDED, done: true, rev: 2 });
    expect(await json<Idea>(app.request(SEEDED_URL))).toEqual(ticked);
    expect(await json<Idea>(patchIdea({ rev: 2, done: false }))).toEqual({ ...SEEDED, rev: 3 });
  });

  test("a stale rev is 409 with the current idea and writes nothing; force writes on top", async () => {
    await json<Idea>(patchIdea({ rev: 1, done: true }));
    const stale = await patchIdea({ rev: 1, done: false });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "rev_conflict",
      rev: 2,
      idea: { ...SEEDED, done: true, rev: 2 },
    });
    expect((await json<Idea>(app.request(SEEDED_URL))).done).toBe(true);
    expect(await json<Idea>(patchIdea({ rev: 1, force: true, done: false }))).toEqual({
      ...SEEDED,
      rev: 3,
    });
  });

  test("the text is no field a patch carries: 400 naming it", async () => {
    const res = await patchIdea({ rev: 1, text: "Anders" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("text");
    expect(await json<Idea>(app.request(SEEDED_URL))).toEqual(SEEDED);
  });

  test("400 for a missing rev, nothing to write or a wrong value; 404 for an unknown idea", async () => {
    expect((await patchIdea({ done: true })).status).toBe(400);
    const nothing = await patchIdea({ rev: 1 });
    expect(nothing.status).toBe(400);
    expect(await nothing.json()).toMatchObject({ code: "nothing_to_write" });
    expect((await patchIdea({ rev: 1, done: "ja" })).status).toBe(400);
    expect((await patchIdea({ rev: 1, id: "anders", done: true })).status).toBe(400);
    expect((await patchIdea({ rev: 1, done: true }, `${IDEAS}/no-such-id`)).status).toBe(404);
    expect(await json<Idea>(app.request(SEEDED_URL))).toEqual(SEEDED);
  });
});
