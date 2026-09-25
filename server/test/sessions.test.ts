// The session verbs and the log, against the database stack.
//
// Starting an evening, the quick note that grows the log and `scenesPlayed`
// with it, and ending it. A session answers its own shape and has no address
// (ADR #26), so every assertion here reads a `SessionResponse`.
//
// Two facts shape every case below:
//
//   * THE STORE IS THE DATABASE. Every case runs against its OWN in-memory
//     database, seeded from the committed JSON fixtures by the real loader
//     (test/support/store.ts), so the cases cannot build on each other.
//     Assertions read the API's own answer — which is what the app sees and
//     therefore what the contract is about.
//   * `rev` IS THE ROW VERSION — a small integer that starts at 1 and grows
//     by one per write, and a deliberately opaque guard token.
//     "nothing was written" is "the rev did not move".
//
// The system time is faked per case (setSystemTime) for deterministic dates.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { SessionResponse, SessionSummary } from "@grimoire/shared";
import { app } from "../src/server";
import type { GrimoireDb } from "../src/db/client";
import { sessions as sessionsTable } from "../src/db/schema";
import { getDb } from "../src/store/handle";
import { seedCampaign } from "../src/db/seed";
import { dropStore, seedStore } from "./support/store";

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** A POST that answers a SESSION — the verbs and the log append. */
async function postSession(url: string, body?: unknown): Promise<SessionResponse> {
  const res = await postJson(url, body);
  expect(res.status).toBe(200);
  return (await res.json()) as SessionResponse;
}

async function getSession(id: string, campaign = "beispiel"): Promise<SessionResponse> {
  const res = await app.request(`/api/campaigns/${campaign}/sessions/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as SessionResponse;
}

/**
 * A SECOND campaign next to `beispiel`, holding nothing but its own row: no
 * name, no sessions, no inbox. That is what the "there is nothing yet" cases
 * need, and a campaign row on its own is exactly it.
 */
const FRESH = "frischling";

async function withFreshCampaign(fn: () => Promise<void>): Promise<void> {
  seedCampaign(await getDb(), { campaign: { id: FRESH, name: "", body: "" } });
  await fn();
}

let db: GrimoireDb;

beforeEach(async () => {
  // 2026-08-19 21:05 local time unless a test overrides it.
  setSystemTime(new Date(2026, 7, 19, 21, 5));
  db = await seedStore();
});

afterEach(() => {
  setSystemTime();
  dropStore();
});

describe("POST /api/campaigns/:campaign/session/start", () => {
  test("creates today's session with the documented shape", async () => {
    const session = await postSession("/api/campaigns/beispiel/session/start");
    // The id is an OPAQUE random string (a UUID) and the session's key.
    // What is asserted about it is that it carries no calendar date.
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // A fresh session is empty ROWS, not an empty text: no log, no pauses,
    // no played scenes, and no `properties`/`body`/`path` at all — a session
    // is not an entry (ADR #26).
    expect(session).toEqual({
      id: session.id,
      started: "2026-08-19T21:05:00",
      startedMs: new Date(2026, 7, 19, 21, 5).getTime(),
      pauses: [],
      log: [],
      scenesPlayed: [],
      rev: 1,
    });
    // A fresh row starts at rev 1, and the GET agrees.
    expect((await getSession(session.id)).rev).toBe(1);
  });

  test("two starts hand out two DIFFERENT ids", async () => {
    const first = await postSession("/api/campaigns/beispiel/session/start");
    await postSession("/api/campaigns/beispiel/session/end");
    const second = await postSession("/api/campaigns/beispiel/session/start");
    expect(second.id).not.toBe(first.id);
  });

  // `started` carries SECONDS, not just minutes. Rounded down to the start of
  // its minute it would open the timer chip at up to 0:00:59 — after an
  // end→start that reads like the old session kept counting.
  test("`started` keeps the seconds, so a fresh session starts at 0", async () => {
    setSystemTime(new Date(2026, 7, 19, 21, 5, 50));
    const session = await postSession("/api/campaigns/beispiel/session/start");
    expect(session.started).toBe("2026-08-19T21:05:50");
    // …and what the app actually clocks — startedMs vs. the same instant — is
    // zero, not 50 seconds.
    expect(session.startedMs).toBe(new Date(2026, 7, 19, 21, 5, 50).getTime());
  });

  test("a session started on the REAL system clock has an elapsed under 2s", async () => {
    setSystemTime(); // the real clock, the surface this matters on
    const before = Date.now();
    const session = await postSession("/api/campaigns/beispiel/session/start");
    expect(session.startedMs).toBeDefined();
    expect(session.startedMs as number).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.now() - (session.startedMs as number)).toBeLessThan(2000);
  });

  test("second start on the same day is idempotent (nothing reset)", async () => {
    const first = await postSession("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 21, 30));
    const again = await postSession("/api/campaigns/beispiel/session/start");
    expect(again.started).toBe("2026-08-19T21:05:00"); // NOT 21:30
    // Idempotent all the way down: no write happened, so the token stands.
    expect(again.rev).toBe(first.rev);
  });

  test("after the end a start creates a SECOND session with an empty log", async () => {
    const first = await postSession("/api/campaigns/beispiel/session/start");
    await postSession("/api/campaigns/beispiel/log", { text: "Runde eins" });
    await postSession("/api/campaigns/beispiel/session/end");
    setSystemTime(new Date(2026, 7, 19, 23, 30));
    const second = await postSession("/api/campaigns/beispiel/session/start");
    // A second session of the SAME DAY is simply another opaque id.
    expect(second.id).not.toBe(first.id);
    // Own id, own `started`, and the log is EMPTY — the runtime of the new
    // session starts at 0 instead of inheriting the first evening's.
    expect(second.started).toBe("2026-08-19T23:30:00");
    expect(second.ended).toBeUndefined();
    expect(second.log).toEqual([]);
    expect(second.scenesPlayed).toEqual([]);
    expect(second.rev).toBe(1);
  });

  test("409 session_running when an OLDER session is still open", async () => {
    // A start on the NEXT day must not open a second session silently — the
    // app offers to end the old one.
    const open = await postSession("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 20, 20, 0));
    const res = await postJson("/api/campaigns/beispiel/session/start");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_running",
      // "Older" is decided by the DATE PART OF `started` now — the id says
      // nothing about a day — and the body names the session by ID, because
      // there is no address to hand back.
      id: open.id,
    });
    // …and nothing was created for the new day: the campaign still has only
    // the committed fixture's session and this one.
    const list = (await (
      await app.request("/api/campaigns/beispiel/sessions")
    ).json()) as SessionSummary[];
    expect(list).toHaveLength(2);
  });
});

describe("POST /api/campaigns/:campaign/log", () => {
  // NOTE: a log row lands in the ACTIVE session — the last started row
  // without `ended`. Each case starts one; "no session at all" is covered
  // under session/end below.
  test("appends one ROW: time, scene and text as columns", async () => {
    await postSession("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 21, 12));
    const session = await postSession("/api/campaigns/beispiel/log", {
      text: "Spuren am Strand #thread",
      sceneId: "lighthouse-arrival",
    });
    // The hashtag stays INSIDE the text: it is body vocabulary, so the note
    // travels as the DM typed it.
    expect(session.log).toEqual([
      {
        id: expect.any(String),
        at: "21:12",
        sceneId: "lighthouse-arrival",
        text: "Spuren am Strand #thread",
        reviewed: false,
      },
    ]);
  });

  test("no sceneId leaves the column out, and rows append behind each other", async () => {
    await postSession("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 21, 12));
    await postSession("/api/campaigns/beispiel/log", {
      text: "Spuren am Strand #thread",
      sceneId: "lighthouse-arrival",
    });
    setSystemTime(new Date(2026, 7, 19, 21, 20));
    const session = await postSession("/api/campaigns/beispiel/log", { text: "Pause" });
    // Append order is the rows' `pos` order — a log row is never rewritten.
    expect(session.log.map((l) => [l.at, l.sceneId, l.text])).toEqual([
      ["21:12", "lighthouse-arrival", "Spuren am Strand #thread"],
      ["21:20", undefined, "Pause"],
    ]);
  });

  test("multi-line text collapses to a single note", async () => {
    await postSession("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 21, 25));
    const session = await postSession("/api/campaigns/beispiel/log", {
      text: "  Zeile eins\n   Zeile zwei  ",
    });
    expect(session.log.at(-1)?.text).toBe("Zeile eins Zeile zwei");
  });

  test("a note lands in the running session and touches nothing else of it", async () => {
    // The invariant: a note appends a row and leaves the session's own prose
    // and its earlier rows alone. Asserted on the fixture session, made the
    // running one for the purpose — "beenden" is final, so no endpoint
    // resumes a session and the row is opened directly here: the SUBJECT of
    // the case is the log append, not the state machine.
    db.update(sessionsTable)
      .set({ ended: null })
      .where(eq(sessionsTable.id, "2026-01-15"))
      .run();
    setSystemTime(new Date(2026, 0, 15, 23, 0));
    const session = await postSession("/api/campaigns/beispiel/log", {
      text: "Nachtrag nach dem Cliffhanger",
    });
    expect(session.id).toBe("2026-01-15");
    expect(session.log.map((l) => l.text)).toEqual([
      "Spuren gefunden, Gruppe will sofort zur Bucht #decision",
      "Improvisiert: Fischerin „Old Metta“ am Steg #npc",
      "Cliffhanger: Lichter in der Bucht gesichtet #thread",
      "Nachtrag nach dem Cliffhanger",
    ]);
    // The session's own pauses are untouched by a log append.
    expect(session.pauses).toHaveLength(1);
  });

  test("400 on empty or missing text", async () => {
    await postSession("/api/campaigns/beispiel/session/start");
    expect((await postJson("/api/campaigns/beispiel/log", { text: "" })).status).toBe(400);
    expect((await postJson("/api/campaigns/beispiel/log", { text: "   \n " })).status).toBe(400);
    expect((await postJson("/api/campaigns/beispiel/log", {})).status).toBe(400);
    expect((await postJson("/api/campaigns/beispiel/log", { text: 42 })).status).toBe(400);
  });
});

describe("scenesPlayed maintenance (POST log with sceneId)", () => {
  test("first log with a sceneId adds it to scenesPlayed", async () => {
    await postSession("/api/campaigns/beispiel/session/start");
    const session = await postSession("/api/campaigns/beispiel/log", {
      text: "Ankunft",
      sceneId: "lighthouse-arrival",
    });
    expect(session.scenesPlayed).toEqual(["lighthouse-arrival"]);
    expect(session.log).toHaveLength(1);
  });

  test("second log with the same sceneId does not duplicate", async () => {
    await postSession("/api/campaigns/beispiel/session/start");
    await postSession("/api/campaigns/beispiel/log", {
      text: "Ankunft",
      sceneId: "lighthouse-arrival",
    });
    setSystemTime(new Date(2026, 7, 19, 21, 10));
    const session = await postSession("/api/campaigns/beispiel/log", {
      text: "Immer noch da",
      sceneId: "lighthouse-arrival",
    });
    expect(session.scenesPlayed).toEqual(["lighthouse-arrival"]);
    // The log, however, grows — both rows are there, in order.
    expect(session.log.map((l) => l.text)).toEqual(["Ankunft", "Immer noch da"]);
  });

  test("a different sceneId is appended in first-played order", async () => {
    await postSession("/api/campaigns/beispiel/session/start");
    await postSession("/api/campaigns/beispiel/log", {
      text: "Ankunft",
      sceneId: "lighthouse-arrival",
    });
    setSystemTime(new Date(2026, 7, 19, 21, 10));
    await postSession("/api/campaigns/beispiel/log", {
      text: "Erwischt",
      sceneId: "smuggler-captured",
    });
    setSystemTime(new Date(2026, 7, 19, 21, 15));
    // Playing the FIRST scene again must not reorder the list — the order is
    // "first played", not "last played" (it is the review's reading order).
    const session = await postSession("/api/campaigns/beispiel/log", {
      text: "Zurück am Turm",
      sceneId: "lighthouse-arrival",
    });
    expect(session.scenesPlayed).toEqual(["lighthouse-arrival", "smuggler-captured"]);
  });

  test("log without sceneId leaves scenesPlayed untouched", async () => {
    await postSession("/api/campaigns/beispiel/session/start");
    await postSession("/api/campaigns/beispiel/log", {
      text: "Ankunft",
      sceneId: "lighthouse-arrival",
    });
    setSystemTime(new Date(2026, 7, 19, 21, 15));
    const session = await postSession("/api/campaigns/beispiel/log", { text: "Pause" });
    expect(session.scenesPlayed).toEqual(["lighthouse-arrival"]);
    expect(session.log.at(-1)?.sceneId).toBeUndefined();
  });
});

describe("POST /api/campaigns/:campaign/session/end", () => {
  test("sets ended, log untouched", async () => {
    await postSession("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 21, 25));
    await postSession("/api/campaigns/beispiel/log", { text: "Zeile eins Zeile zwei" });
    setSystemTime(new Date(2026, 7, 19, 23, 45));
    const session = await postSession("/api/campaigns/beispiel/session/end");
    expect(session.ended).toBe("2026-08-19T23:45:00");
    expect(session.endedMs).toBe(new Date(2026, 7, 19, 23, 45).getTime());
    expect(session.started).toBe("2026-08-19T21:05:00");
    // the log row appended earlier survives verbatim
    expect(session.log.map((l) => l.text)).toEqual(["Zeile eins Zeile zwei"]);
  });

  test("second end keeps the first ended (idempotent)", async () => {
    await postSession("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 23, 45));
    const first = await postSession("/api/campaigns/beispiel/session/end");
    setSystemTime(new Date(2026, 7, 19, 23, 59));
    const second = await postSession("/api/campaigns/beispiel/session/end");
    expect(second.ended).toBe("2026-08-19T23:45:00");
    // Idempotent means no write: the guard token stands still.
    expect(second.rev).toBe(first.rev);
  });

  test("end stays idempotent across days, log is refused", async () => {
    const started = await postSession("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 23, 45));
    await postSession("/api/campaigns/beispiel/session/end");
    // With nothing running, `end` falls back to the LAST STARTED session —
    // ended or not — and keeps its `ended`. That is what makes "Session
    // beenden" safe to press twice, also after midnight.
    setSystemTime(new Date(2026, 7, 22, 22, 0));
    const session = await postSession("/api/campaigns/beispiel/session/end");
    expect(session.id).toBe(started.id);
    expect(session.ended).toBe("2026-08-19T23:45:00");
    // A log row, however, is STRICTLY the running session's business: a note
    // typed after the end is refused, not appended to the closed log.
    const log = await postJson("/api/campaigns/beispiel/log", { text: "verloren" });
    expect(log.status).toBe(404);
    expect(await log.json()).toEqual({ error: expect.any(String) });
  });

  test("404 for a campaign that has no session at all", async () => {
    await withFreshCampaign(async () => {
      expect((await postJson(`/api/campaigns/${FRESH}/session/end`)).status).toBe(404);
      expect((await postJson(`/api/campaigns/${FRESH}/log`, { text: "x" })).status).toBe(404);
    });
  });
});
