// The active session: GET /api/campaigns/:campaign/session, the epoch
// timestamps that make the client's runtime correct, and the rule that a log
// row lands in the RUNNING session even when that is yesterday's row.
//
// A session lives in `sessions` + `session_pauses` + `log_entries`, and the
// picking rule is a query (store/session-rows.ts `pickSession`) — that rule is
// this file pins. Each case gets a fresh in-memory database seeded from the
// committed JSON fixtures (test/support/store.ts); the system time is faked
// per case (setSystemTime).
//
// Everything here reads a `SessionResponse`: a session is a TABLE, not an
// entry (ADR #26), so there is no address to assert and no body to grep. What
// a case asserts instead is the id, the timestamps with their epoch readings,
// and the log as ROWS.
//
// Sessions are produced two ways here:
//   - through the API whenever that is possible (a session started yesterday
//     is simply `POST /session/start` with yesterday as the system time) —
//     that exercises the real state machine instead of a hand-built row;
//   - through the SEED, for the shapes an endpoint cannot produce in one call
//     (a blank `ended`, `scenes_played` without a log, a `started` that is no
//     timestamp at all).

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { SessionResponse, SessionSummary } from "@grimoire/shared";
import { app } from "../src/server";
import { localDateTimeToMs } from "../src/store/time";
import type { GrimoireDb } from "../src/db/client";
import { sessions as sessionsTable } from "../src/db/schema";
import { pickSession } from "../src/store/session-rows";
import { sessionOrderKey } from "../src/store/shared";
import type { SessionRow } from "../src/store/render";
import type { SeedSession } from "../src/db/seed";
import { dropStore, seedStore } from "./support/store";

let db: GrimoireDb;

async function post(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** GET /sessions/:id — the status is the assertion for "does this row exist". */
async function sessionStatus(id: string): Promise<number> {
  return (await app.request(`/api/campaigns/beispiel/sessions/${id}`)).status;
}

async function getSession(id: string): Promise<SessionResponse> {
  const res = await app.request(`/api/campaigns/beispiel/sessions/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as SessionResponse;
}

/** A session as the seed describes one. */
function session(properties: {
  id: string;
  started?: string;
  ended?: string;
  scenes_played?: string[];
}): SeedSession {
  return {
    kind: "session",
    properties: { scenes_played: [], ...properties },
    body: "",
    log: [],
  };
}

/**
 * Re-seed the campaign with these sessions ALONGSIDE the fixture's own. The
 * shapes below are what a campaign written before today's session rules
 * carries — they have no create endpoint, so the seed is where they come from.
 */
async function seedWithSessions(...sessions: SeedSession[]): Promise<void> {
  db = await seedStore({ sessions });
}

/** Re-seed the campaign with NO sessions at all. */
async function seedWithoutSessions(): Promise<void> {
  db = await seedStore({ without: { sessions: ["2026-01-15"] } });
}

/**
 * Start a session and return ITS ID. Session ids are opaque random strings,
 * so no test may spell one out — the id always comes from the response that
 * created (or reported) the session.
 */
async function startSession(): Promise<string> {
  const res = await post("/api/campaigns/beispiel/session/start");
  expect(res.status).toBe(200);
  return ((await res.json()) as SessionResponse).id;
}

/**
 * How many sessions the campaign has. With an opaque id there is no id to
 * probe for absence, so an assertion about "no new session" counts rows.
 */
async function sessionCount(): Promise<number> {
  const res = await app.request("/api/campaigns/beispiel/sessions");
  expect(res.status).toBe(200);
  return ((await res.json()) as SessionSummary[]).length;
}

/** The ACTIVE session, or the last started one with `includeEnded`. */
async function active(includeEnded = false): Promise<SessionResponse | null> {
  const res = await app.request(
    `/api/campaigns/beispiel/session${includeEnded ? "?includeEnded=1" : ""}`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as SessionResponse | null;
}

/** Id of the active session; `null` when none runs. */
async function activeId(includeEnded = false): Promise<string | null> {
  return (await active(includeEnded))?.id ?? null;
}

/**
 * Start a session with the system time at `d`, then set it to `thenNow`.
 * Returns the new session's id (see `startSession`).
 */
async function startAt(d: Date, thenNow: Date): Promise<string> {
  setSystemTime(d);
  const id = await startSession();
  setSystemTime(thenNow);
  return id;
}

/** The texts of a session's log rows, in order. */
function logTexts(s: SessionResponse): string[] {
  return s.log.map((line) => line.text);
}

beforeEach(async () => {
  setSystemTime(new Date(2026, 7, 19, 21, 5));
  db = await seedStore();
});

afterEach(async () => {
  dropStore();
  setSystemTime();
});

// --- the picking rule, as a query -------------------------------------------
// The rule lives in store/session-rows.ts and is exercised against real rows:
// chronology is what decides, not the row order the database happens to
// return.

describe("pickSession", () => {
  const row = (s: {
    id: string;
    started?: string;
    ended?: string;
    createdAt?: number;
  }): SessionRow => ({
    campaignId: "beispiel",
    id: s.id,
    started: s.started ?? null,
    ended: s.ended ?? null,
    createdAt: s.createdAt ?? 0,
    body: "",
    rev: 1,
  });

  /** Replace the campaign's sessions with exactly these rows. */
  function onlySessions(rows: SessionRow[]): void {
    db.delete(sessionsTable).where(eq(sessionsTable.campaignId, "beispiel")).run();
    for (const r of rows) {
      db.insert(sessionsTable)
        .values({
          campaignId: r.campaignId,
          id: r.id,
          started: r.started,
          ended: r.ended,
          createdAt: r.createdAt,
        })
        .run();
    }
  }

  const running = () => pickSession(db, "beispiel", false)?.id;
  const lastStarted = () => pickSession(db, "beispiel", true)?.id;

  test("no sessions, or all of them ended -> undefined", () => {
    onlySessions([]);
    expect(running()).toBeUndefined();
    onlySessions([
      row({ id: "2026-01-15", started: "2026-01-15T19:30:00", ended: "2026-01-15T22:45:00" }),
    ]);
    expect(running()).toBeUndefined();
  });

  test("the LAST started session without `ended` wins", () => {
    onlySessions([
      row({ id: "2026-01-15", started: "2026-01-15T19:30:00", ended: "2026-01-15T22:45:00" }),
      row({ id: "2026-08-19", started: "2026-08-19T21:05:00" }),
      row({ id: "2026-08-18", started: "2026-08-18T18:00:00" }),
    ]);
    expect(running()).toBe("2026-08-19");
  });

  test("no `started` at all never wins", () => {
    // The id is NOT a fallback: it is an opaque random string, so there is
    // nothing in it to read. A row without `started` therefore has no place
    // in the chronology, even when its id happens to look like a date.
    onlySessions([
      row({ id: "2026-08-18" }),
      row({ id: "2026-08-19", started: "2026-08-19T21:05:00" }),
    ]);
    expect(running()).toBe("2026-08-19");
    expect(sessionOrderKey(row({ id: "2026-08-18" }))).toBeUndefined();
    onlySessions([row({ id: "2026-08-18" })]);
    expect(running()).toBeUndefined();
  });

  test("`createdAt` breaks a tie on `started` — the same-second restart", () => {
    // Start, end, start again inside ONE second: `started` ties, and the
    // opaque id cannot say which row came second. The insertion time can.
    onlySessions([
      row({ id: "b6b1", started: "2026-08-19T21:05:00", createdAt: 2000 }),
      row({ id: "a0a2", started: "2026-08-19T21:05:00", createdAt: 1000 }),
    ]);
    expect(running()).toBe("b6b1");
    // …and with `createdAt` equal as well (a seeded row carries 0) the order is
    // arbitrary but STABLE — the same answer whatever the row order was.
    onlySessions([
      row({ id: "a0a2", started: "2026-08-19T21:05:00" }),
      row({ id: "b6b1", started: "2026-08-19T21:05:00" }),
    ]);
    const first = running();
    onlySessions([
      row({ id: "b6b1", started: "2026-08-19T21:05:00" }),
      row({ id: "a0a2", started: "2026-08-19T21:05:00" }),
    ]);
    expect(running()).toBe(first);
  });

  test("no usable date at all -> no order key, and therefore never active", () => {
    // The one shape is the ONLY readable one (store/time.ts): free text, a
    // bare date and a second-less value are all unreadable alike.
    expect(sessionOrderKey(row({ id: "notes", started: "gestern abend" }))).toBeUndefined();
    expect(sessionOrderKey(row({ id: "notes", started: "2026-08-19" }))).toBeUndefined();
    expect(sessionOrderKey(row({ id: "notes", started: "2026-08-19T21:05" }))).toBeUndefined();
    onlySessions([row({ id: "gestern abend", started: "gestern abend" })]);
    expect(running()).toBeUndefined();
    // …not even against a real session: the parseable one wins, always.
    onlySessions([
      row({ id: "gestern abend", started: "gestern abend" }),
      row({ id: "2026-08-19", started: "2026-08-19T21:05:00" }),
    ]);
    expect(running()).toBe("2026-08-19");
  });

  test("a blank `ended` counts as RUNNING (one shared predicate)", () => {
    onlySessions([row({ id: "2026-08-19", started: "2026-08-19T19:30:00", ended: "" })]);
    expect(running()).toBe("2026-08-19");
    onlySessions([row({ id: "2026-08-19", started: "2026-08-19T19:30:00", ended: "  " })]);
    expect(running()).toBe("2026-08-19");
  });

  test("includeEnded ignores `ended` — the review's question", () => {
    onlySessions([
      row({ id: "2026-08-18", started: "2026-08-18T22:30:00", ended: "2026-08-19T01:40:00" }),
      row({ id: "2026-01-15", started: "2026-01-15T19:30:00", ended: "2026-01-15T22:45:00" }),
    ]);
    expect(lastStarted()).toBe("2026-08-18");
    expect(running()).toBeUndefined();
    onlySessions([]);
    expect(lastStarted()).toBeUndefined();
  });
});

describe("GET /api/campaigns/:campaign/session", () => {
  test("null when every session is ended (the committed fixture)", async () => {
    // 200 with `null`, not a 404: between two evenings nothing runs, and that
    // is the ordinary state of a campaign rather than a missing thing.
    const res = await app.request("/api/campaigns/beispiel/session");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  test("404 for an unknown campaign", async () => {
    expect((await app.request("/api/campaigns/nope/session")).status).toBe(404);
  });

  test("the running session as rows, with the epoch times beside the strings", async () => {
    const started = await startSession();
    const entry = await active();
    expect(entry?.id).toBe(started);
    // The id is OPAQUE: a key, nothing to read. What has to hold is that it
    // says nothing about the calendar.
    expect(entry?.id).toMatch(/^[\w-]+$/);
    expect(entry?.id).not.toContain("2026-08-19");
    expect(entry?.started).toBe("2026-08-19T21:05:00");
    expect(entry?.ended).toBeUndefined();
    // A fresh session is empty rows, not an empty text.
    expect(entry?.log).toEqual([]);
    expect(entry?.pauses).toEqual([]);
    expect(entry?.scenesPlayed).toEqual([]);
    expect(typeof entry?.rev).toBe("number");
    // The same session read by its id answers the same thing — one shape,
    // built in one place.
    expect(await getSession(started)).toEqual(entry as SessionResponse);
    // The whole point: the SERVER resolves the zone-less timestamp, so a
    // client in another timezone still computes the right runtime.
    expect(entry?.startedMs).toBe(new Date(2026, 7, 19, 21, 5).getTime());
    expect(entry?.endedMs).toBeUndefined();
  });

  test("a session started YESTERDAY stays active past midnight", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 15));
    const entry = await active(); // 01:15, no row for today
    expect(entry?.id).toBe(yesterday);
    expect(entry?.startedMs).toBe(new Date(2026, 7, 18, 22, 30).getTime());
  });

  test("a session started at MIDNIGHT keeps its epoch time", async () => {
    // The one shape is second-precise, so midnight is `…T00:00:00` and is
    // read like any other moment. The live timer reads startedMs, and a
    // missing one would make the timer vanish silently.
    await startAt(new Date(2026, 7, 19, 0, 0), new Date(2026, 7, 19, 0, 30));
    const entry = await active();
    expect(entry?.started).toBe("2026-08-19T00:00:00");
    expect(entry?.startedMs).toBe(new Date(2026, 7, 19, 0, 0).getTime());
  });

  test("an ended session carries endedMs too", async () => {
    const entry = await getSession("2026-01-15");
    expect(entry.startedMs).toBe(new Date(2026, 0, 15, 19, 30).getTime());
    expect(entry.endedMs).toBe(new Date(2026, 0, 15, 22, 45).getTime());
  });
});

describe("GET /api/campaigns/:campaign/sessions", () => {
  test("every session, newest first, as identifying heads", async () => {
    const fresh = await startSession();
    const res = await app.request("/api/campaigns/beispiel/sessions");
    expect(res.status).toBe(200);
    const list = (await res.json()) as SessionSummary[];
    expect(list.map((s) => s.id)).toEqual([fresh, "2026-01-15"]);
    // A summary is the head and nothing else: no log, no played scenes, and
    // above all no address — a session is not an entry.
    expect(list[0]).toEqual({
      id: fresh,
      started: "2026-08-19T21:05:00",
      startedMs: new Date(2026, 7, 19, 21, 5).getTime(),
    });
    expect(list[1]).toEqual({
      id: "2026-01-15",
      started: "2026-01-15T19:30:00",
      startedMs: new Date(2026, 0, 15, 19, 30).getTime(),
      ended: "2026-01-15T22:45:00",
      endedMs: new Date(2026, 0, 15, 22, 45).getTime(),
    });
  });

  test("an empty list for a campaign without sessions; 404 for an unknown one", async () => {
    await seedWithoutSessions();
    expect(await sessionCount()).toBe(0);
    expect((await app.request("/api/campaigns/nope/sessions")).status).toBe(404);
  });

  test("GET /sessions/:id is 404 for an unknown id", async () => {
    expect(await sessionStatus("gibt-es-nicht")).toBe(404);
  });
});

describe("writes land in the ACTIVE session, not in today's", () => {
  test("POST /log appends to yesterday's still-running session", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 20));
    const res = await post("/api/campaigns/beispiel/log", {
      text: "Nach Mitternacht weiter",
      sceneId: "lighthouse-arrival",
    });
    expect(res.status).toBe(200);
    const entry = (await res.json()) as SessionResponse;
    expect(entry.id).toBe(yesterday);
    // The note is a ROW: its time, its scene and its text as fields, and an
    // id of its own that the review names it by.
    expect(entry.log).toEqual([
      {
        id: expect.any(String),
        at: "01:20",
        sceneId: "lighthouse-arrival",
        text: "Nach Mitternacht weiter",
        reviewed: false,
      },
    ]);
    expect(entry.scenesPlayed).toEqual(["lighthouse-arrival"]);
    // Nothing was created for the new day: the campaign still has exactly the
    // committed fixture's session plus this one.
    expect(await sessionCount()).toBe(2);
  });

  test("POST /session/end ends yesterday's session", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 2, 0));
    const res = await post("/api/campaigns/beispiel/session/end");
    expect(res.status).toBe(200);
    const entry = (await res.json()) as SessionResponse;
    expect(entry.id).toBe(yesterday);
    expect(entry.ended).toBe("2026-08-19T02:00:00");
    expect(entry.endedMs).toBe(new Date(2026, 7, 19, 2, 0).getTime());
    // …and with that, nothing is active any more.
    expect(await activeId()).toBeNull();
  });

  test("POST /log is refused once the session is ended (no 200 into a closed log)", async () => {
    await post("/api/campaigns/beispiel/session/start");
    expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);
    const res = await post("/api/campaigns/beispiel/log", { text: "zu spät" });
    expect(res.status).toBe(404);
  });
});

describe("start — the state machine's edges", () => {
  test("409 session_running instead of a second session next to an open one", async () => {
    // The older session was never ended (a forgotten evening). Starting today
    // must not open a second row next to it — the app offers to end the old
    // session instead.
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 21, 5));
    const res = await post("/api/campaigns/beispiel/session/start");
    expect(res.status).toBe(409);
    // The body names the session by ID: there is no address to hand back.
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_running",
      id: yesterday,
    });
    expect(await sessionCount()).toBe(2); // the fixture's + yesterday's, no third
    // After ending the old one, today's session starts normally.
    expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);
    const today = await startSession();
    expect(today).not.toBe(yesterday);
    expect(await sessionStatus(today)).toBe(200);
  });

  test("a session past midnight keeps its claim (it is not 'stale')", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 15));
    expect(await activeId()).toBe(yesterday);
    // …and the start button of the live view does not silently split it.
    expect((await post("/api/campaigns/beispiel/session/start")).status).toBe(409);
  });

  test("a start after the end opens a SECOND session of the same day", async () => {
    // "Beenden" is final: no `session_ended` 409, no resume — the next press
    // is a new evening with its own id, an empty log and a runtime at 0.
    const firstId = await startSession();
    expect((await post("/api/campaigns/beispiel/log", { text: "erste Runde" })).status).toBe(200);
    expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);

    setSystemTime(new Date(2026, 7, 19, 23, 30));
    const again = await post("/api/campaigns/beispiel/session/start");
    expect(again.status).toBe(200);
    const entry = (await again.json()) as SessionResponse;
    // Two sessions on the SAME DAY are two different opaque ids.
    expect(entry.id).not.toBe(firstId);
    expect(entry.started).toBe("2026-08-19T23:30:00");
    expect(entry.ended).toBeUndefined();
    expect(entry.log).toEqual([]);
    // The first session is untouched and still ended…
    const first = await getSession(firstId);
    expect(first.ended).toBe("2026-08-19T21:05:00");
    expect(logTexts(first)).toEqual(["erste Runde"]);
    // …and the ACTIVE session — where notes land now — is the new one.
    expect(await activeId()).toBe(entry.id);
    expect((await post("/api/campaigns/beispiel/log", { text: "zweite Runde" })).status).toBe(200);
    expect(logTexts(await getSession(entry.id))).toEqual(["zweite Runde"]);
    expect(logTexts(await getSession(firstId))).toEqual(["erste Runde"]);
  });

  test("three sessions of one day are three ids, and the review takes the last", async () => {
    const ids: string[] = [];
    for (const hour of [18, 20, 22]) {
      setSystemTime(new Date(2026, 7, 19, hour, 0));
      ids.push(await startSession());
      expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);
    }
    expect(new Set(ids).size).toBe(3);
    // ?includeEnded=1 — the harvest's session — is the LAST STARTED one, and
    // "last" is `started`, never anything read out of an id.
    expect(await activeId(true)).toBe(ids[2] ?? "");
  });

  test("a discarded session's id never comes back — the next start is a new one", async () => {
    // Ids are random, so no high-water mark has to be kept anywhere: a
    // discarded id is simply never issued again, and the next start opens a
    // session of its own.
    const seen = new Set<string>();
    seen.add(await startSession());
    expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);
    const second = await startSession();
    expect(seen.has(second)).toBe(false);
    seen.add(second);
    expect((await post("/api/campaigns/beispiel/session/discard")).status).toBe(200);
    expect(await sessionStatus(second)).toBe(404);

    const third = await startSession();
    expect(seen.has(third)).toBe(false);
  });

  test("a hand-broken `started` no longer blocks the start (the degrade moved)", async () => {
    // The running-session check is on `started`, not on the id: a row whose
    // `started` is unreadable has no place in the chronology at all
    // (store/shared.ts sessionOrderKey), so it is not the "running session"
    // either and a start simply opens a new one. The broken row stays
    // readable and is not touched.
    const broken = await startSession();
    db.update(sessionsTable)
      .set({ started: "gestern abend" })
      .where(eq(sessionsTable.campaignId, "beispiel"))
      .run();
    const fresh = await startSession();
    expect(fresh).not.toBe(broken);
    expect(await activeId()).toBe(fresh);
    expect(await sessionStatus(broken)).toBe(200);
  });

  test("POST /session/resume is gone (404, no route)", async () => {
    expect((await post("/api/campaigns/beispiel/session/start")).status).toBe(200);
    expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/campaigns/beispiel/session/resume")).status).toBe(404);
  });

  test("same-second restarts order by the row's insertion time", async () => {
    // Start, end and start again inside ONE second: `started` ties, and the
    // opaque id cannot decide which session is "the last started" — the row's
    // `createdAt` does (store/shared.ts compareSessionsNewestFirst).
    const first = await startSession();
    expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);
    const second = await startSession();
    expect(second).not.toBe(first);
    expect(await activeId()).toBe(second);
    expect((await active())?.started).toBe("2026-08-19T21:05:00");
    const res = await app.request("/api/campaigns/beispiel/sessions");
    const list = (await res.json()) as SessionSummary[];
    expect(list.slice(0, 2).map((s) => s.id)).toEqual([second, first]);
  });
});

describe("POST /session/discard — the mis-click's undo (AK7)", () => {
  test("an EMPTY session is deleted, and nothing is live afterwards", async () => {
    const started = await startSession();
    expect(await sessionStatus(started)).toBe(200);

    const res = await post("/api/campaigns/beispiel/session/discard");
    expect(res.status).toBe(200);
    // It answers the id that is gone — a session never had an address.
    expect(await res.json()).toEqual({ id: started });
    // The ROW is gone.
    expect(await sessionStatus(started)).toBe(404);
    // …and the session state machine is back where it was: nothing running,
    // and "Session starten" works again instead of a 409.
    expect(await activeId()).toBeNull();
    expect((await post("/api/campaigns/beispiel/session/start")).status).toBe(200);
  });

  test("a session with a LOG ROW is refused — 409, row untouched", async () => {
    const started = await startSession();
    expect((await post("/api/campaigns/beispiel/log", { text: "Ankunft im Hafen" })).status).toBe(200);
    const before = await getSession(started);

    const res = await post("/api/campaigns/beispiel/session/discard");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_not_empty",
      id: started,
    });
    // Row untouched, guard token included — a refused write must not even
    // bump the `rev`.
    expect(await getSession(started)).toEqual(before);
    // Still the running session — the refusal changed nothing at all.
    expect(await activeId()).toBe(started);
  });

  test("a session with SCENES_PLAYED is refused even with an empty log", async () => {
    // A session with `scenes_played` set and no log row. The API cannot
    // produce that shape — it always writes a log row together with a played
    // scene.
    await seedWithSessions(
      session({
        id: "2026-08-19",
        started: "2026-08-19T21:05:00",
        scenes_played: ["lighthouse-arrival"],
      }),
    );
    const res = await post("/api/campaigns/beispiel/session/discard");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("session_not_empty");
    expect(await sessionStatus("2026-08-19")).toBe(200);
  });

  test("404 without a running session — an ENDED one is never deleted", async () => {
    // The committed fixture has only ended sessions.
    const res = await post("/api/campaigns/beispiel/session/discard");
    expect(res.status).toBe(404);
    expect(await sessionStatus("2026-01-15")).toBe(200);
    // …not even when that ended session is empty.
    const started = await startSession();
    expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/campaigns/beispiel/session/discard")).status).toBe(404);
    expect(await sessionStatus(started)).toBe(200);
  });

  test("discards YESTERDAY's empty session past midnight (the ACTIVE one)", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 23, 50), new Date(2026, 7, 19, 0, 20));
    const res = await post("/api/campaigns/beispiel/session/discard");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(yesterday);
    expect(await sessionStatus(yesterday)).toBe(404);
  });

  test("404 for an unknown campaign", async () => {
    expect((await post("/api/campaigns/nope/session/discard")).status).toBe(404);
  });
});

describe("the review's session — GET /session?includeEnded=1", () => {
  test("finds the session that was ended AFTER midnight (harvest, finding 1)", async () => {
    // The evening of the 18th ran into the 19th and was ended at 01:40 in
    // YESTERDAY's session. A review that derives "today's session" from the
    // browser date harvests nothing — there is no session of the 19th.
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 40));
    expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);
    setSystemTime(new Date(2026, 7, 19, 9, 0));
    expect(await activeId()).toBeNull(); // nothing runs
    const entry = await active(true);
    expect(entry?.id).toBe(yesterday);
    expect(entry?.endedMs).toBe(new Date(2026, 7, 19, 1, 40).getTime());
  });

  test("prefers the RUNNING session over the ended fixture", async () => {
    const started = await startSession();
    expect(await activeId(true)).toBe(started);
  });

  test("null with no session at all, with and without includeEnded", async () => {
    await seedWithoutSessions();
    expect(await activeId(true)).toBeNull();
    expect(await activeId()).toBeNull();
  });
});

describe("degraded sessions never hijack the active session", () => {
  test("an unparseable `started` with a non-date id is ignored (finding 4)", async () => {
    // Neither the id nor `started` is a date, so the row has no place in the
    // chronology: it must neither become the active session nor swallow a log
    // row.
    await seedWithSessions(session({ id: "gestern abend", started: "gestern abend" }));
    expect(await activeId()).toBeNull();
    expect((await post("/api/campaigns/beispiel/log", { text: "x" })).status).toBe(404);
    // A real start works and IS the active session, despite the stray row.
    const started = await startSession();
    expect(await activeId()).toBe(started);
  });

  test("a non-date id with a parseable `started` still counts", async () => {
    await seedWithSessions(session({ id: "notizen", started: "2026-08-19T20:00:00" }));
    expect(await activeId()).toBe("notizen");
  });

  // A `started` outside the one shape (store/time.ts) has no epoch reading at
  // all — the row stays readable and shows its string verbatim, it simply has
  // no place in the chronology. The session PATCH refuses such a value
  // (store/sessions.ts); here it is planted past the seed on purpose.
  test("a second-less `started` is unreadable, not half-read", async () => {
    await seedWithSessions(session({ id: "notizen", started: "2026-08-19T20:00:00" }));
    db.update(sessionsTable)
      .set({ started: "2026-08-19T20:00" })
      .where(eq(sessionsTable.campaignId, "beispiel"))
      .run();
    const entry = await getSession("notizen");
    expect(entry.started).toBe("2026-08-19T20:00");
    expect(entry.startedMs).toBeUndefined();
    expect(await activeId()).toBeNull();
  });

  // Date-shaped ids — plain dates and the `-2` sequence form — are just
  // strings: still readable by id, still ordered by `started`, mixed freely
  // with the opaque ids a start hands out.
  test("legacy date ids and a new opaque id live side by side", async () => {
    await seedWithSessions(
      session({ id: "2026-08-19", started: "2026-08-19T18:00:00", ended: "2026-08-19T19:30:00" }),
      session({ id: "2026-08-19-2", started: "2026-08-19T19:45:00", ended: "2026-08-19T20:30:00" }),
    );
    // Both are readable under their own id…
    expect(await sessionStatus("2026-08-19")).toBe(200);
    expect(await sessionStatus("2026-08-19-2")).toBe(200);
    // …and the harvest's "last started" is the `-2` one, by `started`.
    expect(await activeId(true)).toBe("2026-08-19-2");

    // A start next to them gets an opaque id and wins on `started` (21:05).
    const fresh = await startSession();
    expect(fresh).not.toContain("2026-08-19");
    expect(await activeId()).toBe(fresh);
    const list = (await (await app.request("/api/campaigns/beispiel/sessions")).json()) as
      SessionSummary[];
    expect(list.slice(0, 3).map((s) => s.id)).toEqual([fresh, "2026-08-19-2", "2026-08-19"]);
  });

  test("a blank `ended` means RUNNING and can be ended normally (finding 5)", async () => {
    await seedWithSessions(
      session({ id: "2026-08-19", started: "2026-08-19T20:00:00", ended: "" }),
    );
    expect(await activeId()).toBe("2026-08-19");
    setSystemTime(new Date(2026, 7, 19, 23, 50));
    const ended = await post("/api/campaigns/beispiel/session/end");
    expect(ended.status).toBe(200);
    expect(((await ended.json()) as SessionResponse).ended).toBe("2026-08-19T23:50:00");
    expect(await activeId()).toBeNull();
  });
});

describe("localDateTimeToMs", () => {
  test("reads the ONE shape in the server's timezone", () => {
    expect(localDateTimeToMs("2026-08-19T21:05:30")).toBe(
      new Date(2026, 7, 19, 21, 5, 30).getTime(),
    );
    expect(localDateTimeToMs("2026-08-19T00:00:00")).toBe(new Date(2026, 7, 19, 0, 0).getTime());
  });

  test("undefined for every other shape — never throws", () => {
    expect(localDateTimeToMs(undefined)).toBeUndefined();
    expect(localDateTimeToMs(null)).toBeUndefined();
    expect(localDateTimeToMs(42)).toBeUndefined();
    expect(localDateTimeToMs("gestern abend")).toBeUndefined();
    expect(localDateTimeToMs("")).toBeUndefined();
    expect(localDateTimeToMs("2026-08-19T21")).toBeUndefined();
    // No second-less value, no space for the `T`, no bare date, no one-digit
    // hour, no trailing blank — the writer produces none of them.
    expect(localDateTimeToMs("2026-08-19T21:05")).toBeUndefined();
    expect(localDateTimeToMs("2026-08-19 21:05:30")).toBeUndefined();
    expect(localDateTimeToMs("2026-08-19")).toBeUndefined();
    expect(localDateTimeToMs("2026-08-19T9:05:30")).toBeUndefined();
    expect(localDateTimeToMs("2026-08-19T21:05:30 ")).toBeUndefined();
    expect(localDateTimeToMs("2026-08-19T21:05:30.123")).toBeUndefined();
  });
});
