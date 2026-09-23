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

describe("POST /api/campaigns/:campaign/review/npc-stub", () => {
  const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

  test("creates the npc with the documented shape", async () => {
    const entry = await postOk("/api/campaigns/beispiel/review/npc-stub", {
      id: "old-metta",
      name: "Old Metta",
      note: "Fischerin am Steg, kennt die Gezeiten #npc",
    });
    expect(entry.path).toBe("npcs/old-metta");
    expect(entry.kind).toBe("npc");
    // status is the column default — the log line said nothing about it, so
    // the entry must not claim "alive".
    expect(entry.properties.status).toBe("unknown");
    expect(entry.properties).toEqual({ id: "old-metta", name: "Old Metta", status: "unknown" });
    // The text IS the note — no heading, nothing around it.
    expect(entry.body).toBe("Fischerin am Steg, kennt die Gezeiten #npc");
    // A fresh row starts at rev 1 — the token the app sends with its first edit.
    expect(entry.rev).toBe(1);
    expect(await getEntry("npcs/old-metta")).toEqual(entry);
  });

  test("name defaults to the id; without a note the text is empty", async () => {
    const entry = await postOk("/api/campaigns/beispiel/review/npc-stub", { id: "kai" });
    expect(entry.properties).toEqual({ id: "kai", name: "kai", status: "unknown" });
    expect(entry.body).toBe("");
  });

  test("a stub without name and note is still EMPTY — a later create fills it, no 409", async () => {
    // Nothing but the id: the entry holds nothing, so creating it from the
    // list (or applying a generator draft for it) fills it like any other
    // empty entry instead of colliding with it.
    const stub = await postOk("/api/campaigns/beispiel/review/npc-stub", { id: "wirt" });
    expect(stub.body).toBe("");
    const created = await app.request("/api/campaigns/beispiel/npcs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Der Wirt", id: "wirt" }),
    });
    expect(created.status).toBe(201);
    const filled = (await created.json()) as EntryResponse;
    expect(filled.path).toBe("npcs/wirt");
    expect(filled.properties.name).toBe("Der Wirt");
    expect(filled.rev).toBe(stub.rev + 1);
  });

  test("an existing entry is ANSWERED, not overwritten and not refused", async () => {
    // Create-or-link: the caller wants this id to have an entry. One with
    // content comes back untouched — the old 409 made the review correct an
    // id that was right.
    const before = await getEntry("npcs/fenn");
    const linked = await postOk("/api/campaigns/beispiel/review/npc-stub", {
      id: "fenn",
      name: "Anders",
      note: "doppelt",
    });
    expect(linked).toEqual(before);
    expect(await getEntry("npcs/fenn")).toEqual(before);
    // and a stub created in this run is linked the same way
    const first = await postOk("/api/campaigns/beispiel/review/npc-stub", { id: "old-metta" });
    const second = await postOk("/api/campaigns/beispiel/review/npc-stub", { id: "old-metta" });
    expect(second).toEqual(first);
  });

  test("an EMPTY entry is filled in", async () => {
    // An entry the DM created and did not fill in — the review is the first
    // thing that knows a name and a note for it.
    const created = await app.request("/api/campaigns/beispiel/npcs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "holm" }),
    });
    expect(created.status).toBe(201);
    const empty = await getEntry("npcs/holm");
    expect(empty.properties.name).toBe("holm");
    const filled = await postOk("/api/campaigns/beispiel/review/npc-stub", {
      id: "holm",
      name: "Holm",
      note: "war am Steg #npc",
    });
    expect(filled.properties.name).toBe("Holm");
    expect(filled.body).toBe("war am Steg #npc");
    expect(filled.rev).toBe(empty.rev + 1);
  });

  test("400 unless id is a kebab-case slug", async () => {
    const bad = ["Old Metta", "old_metta", "-metta", "metta-", "a--b", "", "a/b", "ä", "A1"];
    for (const id of bad) {
      expect((await postJson("/api/campaigns/beispiel/review/npc-stub", { id })).status).toBe(400);
    }
    expect((await postJson("/api/campaigns/beispiel/review/npc-stub", {})).status).toBe(400);
    expect((await postJson("/api/campaigns/beispiel/review/npc-stub", { id: 42 })).status).toBe(400);
    expect(
      (await postJson("/api/campaigns/beispiel/review/npc-stub", { id: "ok-slug", name: 42 })).status,
    ).toBe(400);
    expect(
      (await postJson("/api/campaigns/beispiel/review/npc-stub", { id: "ok-slug", note: 42 })).status,
    ).toBe(400);
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

  test("404 for an unknown campaign on all three endpoints", async () => {
    expect(
      (
        await postJson("/api/campaigns/nope/review/seen", {
          sessionId: "x",
          logId: "abc12345",
        })
      ).status,
    ).toBe(404);
    expect((await postJson("/api/campaigns/nope/review/npc-stub", { id: "a" })).status).toBe(404);
    expect((await postJson("/api/campaigns/nope/review/inbox-done", { id: "0" })).status).toBe(404);
  });
});
