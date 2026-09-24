// Review actions against the database stack.
//
// Same setup as the write-API tests: one fresh in-memory database per case,
// seeded from the committed JSON entries by the real loader
// (test/support/store.ts). Every assertion reads the API's answer or the
// structured endpoint behind it.
//
// Two behaviour notes, both pinned below:
//
//   * `reviewed` is a FLAG ON THE LOG ROW, not a hash list beside the
//     session, and it travels on the row it belongs to. So there is no click
//     order to remember — the log's own order is the one the review reads in.
//   * The review names a row BY ITS ID, and an id that matches no row is a
//     404. The caller sends back an id it was given, so a miss is the session
//     having moved on — which a 200 that changed nothing would hide.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
  EntryResponse,
  InboxResponse,
  Npc,
  SessionLogEntry,
  SessionResponse,
} from "@grimoire/shared";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { seedCampaign } from "../src/db/seed";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

async function postOk(url: string, body?: unknown): Promise<EntryResponse> {
  const res = await postJson(url, body);
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function getEntry(rel: string, campaign = "beispiel"): Promise<EntryResponse> {
  const res = await app.request(entriesUrl(campaign, rel));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function patchBody(rel: string, body: string): Promise<EntryResponse> {
  const before = await getEntry(rel);
  const res = await app.request(entriesUrl("beispiel", rel), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: before.rev, body }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

/** The documented short hash: first 8 hex chars of SHA-256 over a string. */
function sha8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

/** A session by id — the rows the review works on. */
async function getSession(id: string, campaign = "beispiel"): Promise<SessionResponse> {
  const res = await app.request(`/api/campaigns/${campaign}/sessions/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as SessionResponse;
}

async function getInbox(campaign = "beispiel"): Promise<InboxResponse> {
  const res = await app.request(`/api/campaigns/${campaign}/inbox`);
  expect(res.status).toBe(200);
  return (await res.json()) as InboxResponse;
}

/** POST that must answer a session. */
async function seen(sessionId: string, logId: string): Promise<SessionResponse> {
  const res = await postJson("/api/campaigns/beispiel/review/seen", { sessionId, logId });
  expect(res.status).toBe(200);
  return (await res.json()) as SessionResponse;
}

/** The ids of the log rows that carry the review flag, in LOG order. */
function reviewedIds(session: SessionResponse): string[] {
  return session.log.filter((line: SessionLogEntry) => line.reviewed).map((line) => line.id);
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("POST /api/campaigns/:campaign/review/seen", () => {
  const SESSION = "2026-01-15";

  /** The fixture session's log rows, by their position in the log. */
  async function rows(): Promise<SessionLogEntry[]> {
    return (await getSession(SESSION)).log;
  }

  test("marks ONE row, and nothing else about the session moves", async () => {
    const before = await getSession(SESSION);
    const first = before.log[0]!;
    const session = await seen(SESSION, first.id);
    expect(reviewedIds(session)).toEqual([first.id]);
    // The flag rides on the ROW it belongs to — nothing beside the log
    // changed, and no other row was touched.
    expect(session.log.map((l) => [l.at, l.sceneId, l.text])).toEqual(
      before.log.map((l) => [l.at, l.sceneId, l.text]),
    );
    expect(session.pauses).toEqual(before.pauses);
    expect(session.scenesPlayed).toEqual(before.scenesPlayed);
    // A write happened, so the session's guard token moved.
    expect(session.rev).toBeGreaterThan(before.rev);
  });

  test("the row id IS the documented short hash of its canonical line", async () => {
    // Recompute from scratch here so a hash-implementation change fails
    // loudly. The canonical line is the columns in one deterministic
    // spelling — which is why a row keeps the id it has always had.
    const first = (await rows())[0]!;
    expect(first.id).toBe(
      sha8(`- ${first.at} (${String(first.sceneId)}) ${first.text}`),
    );
    expect(first.id).toMatch(/^[0-9a-f]{8}$/);
  });

  test("idempotent: the same id again writes nothing", async () => {
    const first = (await rows())[0]!;
    const once = await seen(SESSION, first.id);
    const again = await seen(SESSION, first.id);
    expect(reviewedIds(again)).toEqual([first.id]);
    // Nothing to write means nothing written: the guard token stands.
    expect(again.rev).toBe(once.rev);
    expect(again).toEqual(once);
  });

  test("several rows come back in LOG order, not in the order they were seen", async () => {
    // Deliberately marked back to front. The flag on a row has no click order
    // to remember, and the log's own order is the one the review reads in.
    const all = await rows();
    const [first, second] = [all[0]!, all[1]!];
    expect(reviewedIds(await seen(SESSION, second.id))).toEqual([second.id]);
    expect(reviewedIds(await seen(SESSION, first.id))).toEqual([first.id, second.id]);
  });

  test("404 for an id no row of this session carries", async () => {
    // A stale review view, or a caller inventing ids: there is nothing to
    // flag, and saying so beats a 200 that changed nothing.
    const before = await getSession(SESSION);
    const res = await postJson("/api/campaigns/beispiel/review/seen", {
      sessionId: SESSION,
      logId: "deadbeef",
    });
    expect(res.status).toBe(404);
    expect(await getSession(SESSION)).toEqual(before);
  });

  test("404 for a session that does not exist", async () => {
    const res = await postJson("/api/campaigns/beispiel/review/seen", {
      sessionId: "1999-01-01",
      logId: "deadbeef",
    });
    expect(res.status).toBe(404);
  });

  test("400 on malformed bodies", async () => {
    const bad = [
      {}, // missing everything
      { sessionId: SESSION }, // missing logId
      { logId: "abc12345" }, // missing sessionId
      { sessionId: SESSION, logId: "" },
      { sessionId: SESSION, logId: "   " },
      { sessionId: SESSION, logId: "a\nb" },
      { sessionId: SESSION, logId: 42 },
      { sessionId: 42, logId: "abc12345" },
      { sessionId: SESSION, logId: "abc12345", extra: 1 }, // unknown key
    ];
    for (const b of bad) {
      expect((await postJson("/api/campaigns/beispiel/review/seen", b)).status).toBe(400);
    }
  });
});

describe("a #npc note becomes an npc on the npc's own resource", () => {
  // The review creates the npc with `POST …/npcs { name, id, body }` — the
  // note is its text (ADR #31). There is no review action for it.
  async function createFromNote(body: Record<string, unknown>): Promise<Response> {
    return postJson("/api/campaigns/beispiel/npcs", body);
  }

  test("the note is the npc's text, without a heading; the status claims nothing", async () => {
    const res = await createFromNote({
      name: "Old Metta",
      id: "old-metta",
      body: "Fischerin am Steg, kennt die Gezeiten #npc",
    });
    expect(res.status).toBe(201);
    const npc = (await res.json()) as Npc;
    expect(npc).toEqual({
      id: "old-metta",
      name: "Old Metta",
      status: "unknown",
      body: "Fischerin am Steg, kennt die Gezeiten #npc\n",
      rev: 1,
    });
  });

  test("an npc with content is a 409 with a proposal, and the note is not written", async () => {
    const before = (await (await app.request("/api/campaigns/beispiel/npcs/fenn")).json()) as Npc;
    const res = await createFromNote({ name: "Fenn", id: "fenn", body: "doppelt #npc" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "slug_taken", id: "fenn", suggestion: "fenn-2" });
    expect(await (await app.request("/api/campaigns/beispiel/npcs/fenn")).json()).toEqual(before);
  });

  test("an EMPTY npc is filled with the name and the note", async () => {
    const empty = (await (await createFromNote({ name: "holm" })).json()) as Npc;
    const res = await createFromNote({ name: "Holm", id: "holm", body: "war am Steg #npc" });
    expect(res.status).toBe(201);
    const filled = (await res.json()) as Npc;
    expect(filled.name).toBe("Holm");
    expect(filled.body).toBe("war am Steg #npc\n");
    expect(filled.rev).toBe(empty.rev + 1);
  });
});

describe("POST /api/campaigns/:campaign/review/inbox-done", () => {
  /** POST that must answer the inbox. */
  async function done(id: string, campaign = "beispiel"): Promise<InboxResponse> {
    const res = await postJson(`/api/campaigns/${campaign}/review/inbox-done`, { id });
    expect(res.status).toBe(200);
    return (await res.json()) as InboxResponse;
  }

  test("ticks off the named idea and nothing else", async () => {
    const before = await getInbox();
    const target = before.entries[0]!;
    expect(target.done).toBe(false);
    const after = await done(target.id);
    expect(after.entries).toEqual(
      before.entries.map((e) => (e.id === target.id ? { ...e, done: true } : e)),
    );
    // The list's own guard token moved, and a subsequent GET agrees.
    expect(after.rev).toBeGreaterThan(before.rev);
    expect(await getInbox()).toEqual(after);
  });

  test("idempotent: an idea already done writes nothing", async () => {
    const target = (await getInbox()).entries[0]!;
    const first = await done(target.id);
    const again = await done(target.id);
    expect(again).toEqual(first);
  });

  test("the id names ONE row, even between identical ideas", async () => {
    // Two ideas with the same text are two rows with two ids, so ticking one
    // off cannot be ambiguous — which a match on the text would have been.
    expect((await postJson("/api/campaigns/beispiel/inbox", { text: "Doppelt" })).status).toBe(200);
    const list = (await postJson("/api/campaigns/beispiel/inbox", { text: "Doppelt" })).status;
    expect(list).toBe(200);
    const doubles = (await getInbox()).entries.filter((e) => e.text === "Doppelt");
    expect(doubles).toHaveLength(2);
    const after = await done(doubles[1]!.id);
    expect(after.entries.filter((e) => e.text === "Doppelt").map((e) => e.done)).toEqual([
      false,
      true,
    ]);
  });

  test("404 for an id the inbox does not have", async () => {
    const before = await getInbox();
    const res = await postJson("/api/campaigns/beispiel/review/inbox-done", { id: "999" });
    expect(res.status).toBe(404);
    expect(await getInbox()).toEqual(before);
  });

  test("400 on malformed bodies", async () => {
    const bad = [{}, { id: "" }, { id: "   " }, { id: "a\nb" }, { id: 42 }, { id: "0", extra: 1 }];
    for (const b of bad) {
      expect((await postJson("/api/campaigns/beispiel/review/inbox-done", b)).status).toBe(400);
    }
  });

  test("404 when the campaign has no inbox at all", async () => {
    // GET answers 200 with an empty list, but there is still no such idea to
    // check off — hence 404 here.
    seedCampaign(await getDb(), [
      { kind: "campaign", properties: { id: "frischling" }, body: "" },
    ]);
    const res = await postJson("/api/campaigns/frischling/review/inbox-done", { id: "0" });
    expect(res.status).toBe(404);
  });

  test("404 for an unknown campaign on both endpoints", async () => {
    expect(
      (
        await postJson("/api/campaigns/nope/review/seen", {
          sessionId: "x",
          logId: "abc12345",
        })
      ).status,
    ).toBe(404);
    expect((await postJson("/api/campaigns/nope/review/inbox-done", { id: "0" })).status).toBe(404);
  });
});
