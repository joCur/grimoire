// The session resource: listing (and the running one), reading with the
// children embedded, starting, ending, correcting and deleting.
//
// Every case runs against its own in-memory database seeded from the
// committed fixtures (test/support/store.ts), with the system clock faked.
// The pauses, the log entries and the played scenes have their own test
// modules; here they only appear as what a session embeds.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Session } from "@grimoire/shared/session";
import { app } from "../src/server";
import type { GrimoireDb } from "../src/db/client";
import { sessions as sessionsTable } from "../src/db/schema";
import { dropStore, seedStore } from "./support/store";
import {
  FIXTURE_SESSION,
  SESSIONS,
  endSession,
  readSession,
  runningSession,
  send,
  sessionSeed,
  startSession,
} from "./support/sessions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let db: GrimoireDb;

async function list(query = ""): Promise<Session[]> {
  const res = await app.request(`${SESSIONS}${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Session[];
}

/** Start a session at `at`, then move the clock to `thenNow`. */
async function startAt(at: Date, thenNow: Date): Promise<Session> {
  setSystemTime(at);
  const session = await startSession();
  setSystemTime(thenNow);
  return session;
}

beforeEach(async () => {
  // 2026-08-19 21:05 local time unless a case moves it.
  setSystemTime(new Date(2026, 7, 19, 21, 5));
  db = await seedStore();
});

afterEach(() => {
  setSystemTime();
  dropStore();
});

describe("reading a session", () => {
  test("GET answers every field flat, the children embedded with their own id and rev", async () => {
    expect(await readSession(FIXTURE_SESSION)).toEqual({
      id: FIXTURE_SESSION,
      started: "2026-01-15T19:30:00",
      startedMs: new Date(2026, 0, 15, 19, 30).getTime(),
      ended: "2026-01-15T22:45:00",
      endedMs: new Date(2026, 0, 15, 22, 45).getTime(),
      body: "\n## Threads\n\n- [ ] Wer bezahlt die Schmuggler?\n- [ ] Old Metta als NPC ausarbeiten?\n",
      pauses: [
        {
          id: "abendessen",
          from: "2026-01-15T20:30:00",
          fromMs: new Date(2026, 0, 15, 20, 30).getTime(),
          to: "2026-01-15T21:10:00",
          toMs: new Date(2026, 0, 15, 21, 10).getTime(),
          rev: 1,
        },
      ],
      log: [
        {
          id: "spuren-gefunden",
          at: "19:52",
          sceneId: "lighthouse-arrival",
          text: "Spuren gefunden, Gruppe will sofort zur Bucht #decision",
          reviewed: false,
          rev: 1,
        },
        {
          id: "old-metta",
          at: "21:10",
          sceneId: "lighthouse-arrival",
          text: "Improvisiert: Fischerin „Old Metta“ am Steg #npc",
          reviewed: false,
          rev: 1,
        },
        {
          id: "lichter-in-der-bucht",
          at: "22:40",
          text: "Cliffhanger: Lichter in der Bucht gesichtet #thread",
          reviewed: false,
          rev: 1,
        },
      ],
      playedScenes: [{ id: "ankunft", sceneId: "lighthouse-arrival", rev: 1 }],
      rev: 1,
    });
  });

  test("404 for an unknown session or campaign", async () => {
    expect((await app.request(`${SESSIONS}/gibt-es-nicht`)).status).toBe(404);
    expect((await app.request("/api/campaigns/nope/sessions")).status).toBe(404);
  });

  test("a `started` outside the one shape is shown verbatim, without a reading", async () => {
    db.update(sessionsTable)
      .set({ started: "2026-01-15T19:30" })
      .where(eq(sessionsTable.id, FIXTURE_SESSION))
      .run();
    const session = await readSession(FIXTURE_SESSION);
    expect(session.started).toBe("2026-01-15T19:30");
    expect(session.startedMs).toBeUndefined();
  });
});

describe("the session list", () => {
  test("every session, newest first, each with its children", async () => {
    const fresh = await startSession();
    const sessions = await list();
    expect(sessions.map((s) => s.id)).toEqual([fresh.id, FIXTURE_SESSION]);
    expect(sessions[1]).toEqual(await readSession(FIXTURE_SESSION));
  });

  test("an empty list for a campaign without sessions", async () => {
    db = await seedStore({ without: { sessions: [FIXTURE_SESSION] } });
    expect(await list()).toEqual([]);
    expect(await list("?running=true")).toEqual([]);
  });

  test("the first of the list is the last STARTED session — the review's", async () => {
    // The evening of the 18th ran into the 19th and was ended at 01:40 in
    // yesterday's session; the list still names it first the next morning.
    const late = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 40));
    await endSession(late.id);
    setSystemTime(new Date(2026, 7, 19, 9, 0));
    expect(await runningSession()).toBeUndefined();
    const [first] = await list();
    expect(first?.id).toBe(late.id);
    expect(first?.endedMs).toBe(new Date(2026, 7, 19, 1, 40).getTime());
  });

  test("a session without a readable `started` stands last", async () => {
    db = await seedStore({ sessions: [sessionSeed({ id: "notizen", started: "gestern abend" })] });
    expect((await list()).map((s) => s.id)).toEqual([FIXTURE_SESSION, "notizen"]);
  });

  test("same-second restarts order by the row's insertion time", async () => {
    const first = await startSession();
    await endSession(first.id);
    const second = await startSession();
    expect(second.started).toBe(first.started);
    expect((await list()).slice(0, 2).map((s) => s.id)).toEqual([second.id, first.id]);
  });

  test("400 for a `running` other than true", async () => {
    expect((await app.request(`${SESSIONS}?running=false`)).status).toBe(400);
    expect((await app.request(`${SESSIONS}?running=1`)).status).toBe(400);
  });
});

describe("the running session — ?running=true", () => {
  test("none while every session is ended", async () => {
    expect(await list("?running=true")).toEqual([]);
  });

  test("the session that runs, and only it", async () => {
    const started = await startSession();
    expect(await list("?running=true")).toEqual([await readSession(started.id)]);
  });

  test("a session started yesterday still runs past midnight", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 15));
    expect((await runningSession())?.id).toBe(yesterday.id);
    expect((await runningSession())?.startedMs).toBe(new Date(2026, 7, 18, 22, 30).getTime());
  });

  test("a blank `ended` counts as running", async () => {
    db = await seedStore({
      sessions: [sessionSeed({ id: "offen", started: "2026-08-19T20:00:00", ended: " " })],
    });
    expect((await runningSession())?.id).toBe("offen");
  });

  test("a session without a readable `started` never runs", async () => {
    db = await seedStore({ sessions: [sessionSeed({ id: "notizen", started: "gestern abend" })] });
    expect(await runningSession()).toBeUndefined();
  });

  test("of two open sessions, the one started last runs", async () => {
    db = await seedStore({
      sessions: [
        sessionSeed({ id: "vorgestern", started: "2026-08-17T20:00:00" }),
        sessionSeed({ id: "gestern", started: "2026-08-18T20:00:00" }),
      ],
    });
    expect((await runningSession())?.id).toBe("gestern");
  });
});

describe("starting a session — POST …/sessions", () => {
  test("a new session: opaque id, started now to the second, no children, 201", async () => {
    setSystemTime(new Date(2026, 7, 19, 21, 5, 50));
    const session = await startSession();
    expect(session.id).toMatch(UUID);
    expect(session).toEqual({
      id: session.id,
      started: "2026-08-19T21:05:50",
      startedMs: new Date(2026, 7, 19, 21, 5, 50).getTime(),
      body: "",
      pauses: [],
      log: [],
      playedScenes: [],
      rev: 1,
    });
    expect(await readSession(session.id)).toEqual(session);
  });

  test("a session started at midnight keeps its reading", async () => {
    setSystemTime(new Date(2026, 7, 19, 0, 0));
    const session = await startSession();
    expect(session.started).toBe("2026-08-19T00:00:00");
    expect(session.startedMs).toBe(new Date(2026, 7, 19, 0, 0).getTime());
  });

  test("while today's session runs, a start answers it unchanged with 200", async () => {
    const first = await startSession();
    setSystemTime(new Date(2026, 7, 19, 21, 30));
    const res = await send("POST", SESSIONS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(first);
    expect(await list()).toHaveLength(2);
  });

  test("409 session_running while a session of an earlier day runs — nothing starts", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 21, 5));
    const res = await send("POST", SESSIONS);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_running",
      id: yesterday.id,
    });
    expect(await list()).toHaveLength(2);
    // Once the older session is ended, today's starts normally.
    await endSession(yesterday.id);
    expect((await startSession()).id).not.toBe(yesterday.id);
  });

  test("ending is final: a start after the end is a new session of the same day", async () => {
    const first = await startSession();
    await endSession(first.id);
    setSystemTime(new Date(2026, 7, 19, 23, 30));
    const second = await startSession();
    expect(second.id).not.toBe(first.id);
    expect(second.started).toBe("2026-08-19T23:30:00");
    expect(second.ended).toBeUndefined();
    expect((await runningSession())?.id).toBe(second.id);
  });

  test("a session with an unreadable `started` does not block a start", async () => {
    const broken = await startSession();
    db.update(sessionsTable)
      .set({ started: "gestern abend" })
      .where(eq(sessionsTable.id, broken.id))
      .run();
    const fresh = await startSession();
    expect(fresh.id).not.toBe(broken.id);
    expect((await readSession(broken.id)).started).toBe("gestern abend");
  });

  test("400 for a key in the body — a start carries nothing", async () => {
    const res = await send("POST", SESSIONS, { started: "2026-08-19T20:00:00" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("started");
    expect(await list()).toHaveLength(1);
  });
});

describe("writing a session — PATCH …/sessions/:id", () => {
  test("`endedMs` ends it: the server stores the reading of that moment", async () => {
    const session = await startSession();
    const endedMs = new Date(2026, 7, 19, 23, 45, 12).getTime();
    const res = await send("PATCH", `${SESSIONS}/${session.id}`, { rev: session.rev, endedMs });
    expect(res.status).toBe(200);
    const ended = (await res.json()) as Session;
    expect(ended.ended).toBe("2026-08-19T23:45:12");
    expect(ended.endedMs).toBe(endedMs);
    expect(ended.rev).toBe(session.rev + 1);
    expect(await runningSession()).toBeUndefined();
  });

  test("a session past midnight is ended in its own row", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 2, 0));
    const ended = await endSession(yesterday.id);
    expect(ended.ended).toBe("2026-08-19T02:00:00");
    expect(ended.started).toBe("2026-08-18T22:30:00");
  });

  test("ending closes the open pause at the same moment, and that pause's rev moves", async () => {
    const session = await startSession();
    setSystemTime(new Date(2026, 7, 19, 22, 50));
    const opened = await send("POST", `${SESSIONS}/${session.id}/pauses`);
    const pause = (await opened.json()) as Session["pauses"][number];
    setSystemTime(new Date(2026, 7, 19, 23, 0));
    const ended = await endSession(session.id);
    expect(ended.pauses).toEqual([
      {
        id: pause.id,
        from: "2026-08-19T22:50:00",
        fromMs: new Date(2026, 7, 19, 22, 50).getTime(),
        to: "2026-08-19T23:00:00",
        toMs: new Date(2026, 7, 19, 23, 0).getTime(),
        rev: pause.rev + 1,
      },
    ]);
  });

  test("`endedMs: null` lets it run again; `startedMs` corrects the start", async () => {
    const before = await readSession(FIXTURE_SESSION);
    const res = await send("PATCH", `${SESSIONS}/${FIXTURE_SESSION}`, {
      rev: before.rev,
      endedMs: null,
      startedMs: new Date(2026, 0, 15, 19, 31, 7).getTime(),
    });
    expect(res.status).toBe(200);
    const session = (await res.json()) as Session;
    expect(session.started).toBe("2026-01-15T19:31:07");
    expect(session.ended).toBeUndefined();
    expect(session.endedMs).toBeUndefined();
    // The children are not the session's to write: they stand as they were.
    expect(session.pauses).toEqual(before.pauses);
    expect(session.log).toEqual(before.log);
    expect(session.playedScenes).toEqual(before.playedScenes);
  });

  test("400 for a field the patch does not take — named, and nothing written", async () => {
    const before = await readSession(FIXTURE_SESSION);
    for (const field of [
      { ended: "2026-01-15T23:00:00" },
      { started: "2026-01-15T19:00:00" },
      { pauses: [] },
      { playedScenes: [] },
      { endedMs: "spät" },
    ]) {
      const res = await send("PATCH", `${SESSIONS}/${FIXTURE_SESSION}`, { rev: before.rev, ...field });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(Object.keys(field)[0]!);
    }
    expect(await readSession(FIXTURE_SESSION)).toEqual(before);
  });

  test("naming no field is 400 nothing_to_write; the id may be echoed, never changed", async () => {
    const { rev } = await readSession(FIXTURE_SESSION);
    const empty = await send("PATCH", `${SESSIONS}/${FIXTURE_SESSION}`, { rev });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ code: "nothing_to_write" });
    const renamed = await send("PATCH", `${SESSIONS}/${FIXTURE_SESSION}`, { rev, id: "anders" });
    expect(renamed.status).toBe(400);
  });

  test("a stale rev is 409 with the current session; force writes on top of it", async () => {
    const before = await readSession(FIXTURE_SESSION);
    const stale = await send("PATCH", `${SESSIONS}/${FIXTURE_SESSION}`, {
      rev: before.rev - 1,
      endedMs: null,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: expect.any(String),
      code: "rev_conflict",
      rev: before.rev,
      session: before,
    });
    expect(await readSession(FIXTURE_SESSION)).toEqual(before);

    const forced = await send("PATCH", `${SESSIONS}/${FIXTURE_SESSION}`, {
      rev: before.rev - 1,
      force: true,
      endedMs: null,
    });
    expect(forced.status).toBe(200);
    expect(((await forced.json()) as Session).ended).toBeUndefined();
  });

  test("404 for an unknown session", async () => {
    const res = await send("PATCH", `${SESSIONS}/gibt-es-nicht`, { rev: 1, endedMs: null });
    expect(res.status).toBe(404);
  });
});

describe("deleting a session — DELETE …/sessions/:id", () => {
  test("an empty session is deleted, and a start works again", async () => {
    const session = await startSession();
    const res = await send("DELETE", `${SESSIONS}/${session.id}`, { rev: session.rev });
    expect(res.status).toBe(204);
    expect((await app.request(`${SESSIONS}/${session.id}`)).status).toBe(404);
    expect(await runningSession()).toBeUndefined();
    expect((await startSession()).id).not.toBe(session.id);
  });

  test("a session with a log entry is 409 session_not_empty, and stays", async () => {
    const session = await startSession();
    expect(
      (await send("POST", `${SESSIONS}/${session.id}/log`, { text: "Ankunft im Hafen" })).status,
    ).toBe(201);
    const before = await readSession(session.id);
    const res = await send("DELETE", `${SESSIONS}/${session.id}`, { rev: before.rev });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_not_empty",
      id: session.id,
    });
    expect(await readSession(session.id)).toEqual(before);
  });

  test("a session with a played scene but no log is not empty either", async () => {
    const session = await startSession();
    expect(
      (
        await send("POST", `${SESSIONS}/${session.id}/played-scenes`, {
          sceneId: "lighthouse-arrival",
        })
      ).status,
    ).toBe(201);
    const res = await send("DELETE", `${SESSIONS}/${session.id}`, { rev: session.rev });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "session_not_empty" });
  });

  test("a stale rev is 409 with the current session, and nothing is removed", async () => {
    const session = await startSession();
    const res = await send("DELETE", `${SESSIONS}/${session.id}`, { rev: session.rev + 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "rev_conflict", rev: session.rev, session });
    expect(await readSession(session.id)).toEqual(session);
  });

  test("400 without a rev, 404 for an unknown session", async () => {
    const session = await startSession();
    expect((await send("DELETE", `${SESSIONS}/${session.id}`, {})).status).toBe(400);
    expect((await send("DELETE", `${SESSIONS}/gibt-es-nicht`, { rev: 1 })).status).toBe(404);
  });
});

describe("the addresses that name nothing", () => {
  test("the session verbs, the campaign's log and review/seen are 404", async () => {
    const session = await startSession();
    expect((await app.request("/api/campaigns/beispiel/session")).status).toBe(404);
    for (const verb of ["start", "end", "pause", "continue", "discard", "resume"]) {
      expect((await send("POST", `/api/campaigns/beispiel/session/${verb}`)).status).toBe(404);
    }
    expect((await send("POST", "/api/campaigns/beispiel/log", { text: "x" })).status).toBe(404);
    expect(
      (
        await send("POST", "/api/campaigns/beispiel/review/seen", {
          sessionId: FIXTURE_SESSION,
          logId: "spuren-gefunden",
        })
      ).status,
    ).toBe(404);
    // …and none of them wrote anything.
    expect(await readSession(session.id)).toEqual(session);
    expect((await readSession(FIXTURE_SESSION)).log.every((entry) => !entry.reviewed)).toBe(true);
  });
});
