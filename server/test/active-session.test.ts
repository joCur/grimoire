// The active session (issue #40): GET /api/:campaign/session, the epoch
// timestamps that make the client's runtime correct, and the rule that a log
// line lands in the RUNNING session even when that is yesterday's row.
//
// After the SQLite cutover (issue #57) the session lives in `sessions` +
// `session_pauses` + `log_entries`, and the picking rule moved from a
// newest-first file scan to a query (store/read.ts `pickSession`) — the RULE
// itself is unchanged, which is what this file pins. Each case gets a fresh
// in-memory database seeded from examples/ (test/support/store.ts); the clock
// is still overridden via setNow().
//
// Sessions that used to be written as FILES are produced two ways here:
//   - through the API whenever that is possible (a session started yesterday
//     is simply `POST /session/start` with yesterday's clock) — that exercises
//     the real state machine instead of a hand-built row;
//   - through the MIGRATION, in a temp campaign root, for the shapes only a
//     hand-edited file can have (a degraded `started`, a blank `ended`,
//     `scenes_played` without a log).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { localDateTimeToMs, setNow } from "../src/clock";
import type { GrimoireDb } from "../src/db/client";
import { sessions as sessionsTable } from "../src/db/schema";
import { pickSession, sessionOrderKey } from "../src/store/read";
import type { SessionRow } from "../src/store/render";
import {
  dropStore,
  removeTempRoot,
  seedStore,
  tempCampaignRoot,
  useCampaignRoot,
} from "./support/store";

let db: GrimoireDb;
let tmpRoot: string | undefined;
let restoreRoot: (() => void) | undefined;

async function post(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** GET /file — the status is the assertion for "does this row exist". */
async function fileStatus(rel: string): Promise<number> {
  return (await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`)).status;
}

async function getFile(rel: string): Promise<FileResponse> {
  const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

/**
 * Re-seed from a temp copy of examples/ with campaign files added, replaced
 * or (content `null`) removed. The successor of "write a file and let the
 * reader find it": the tree is now only ever the migration's source.
 */
async function seedWithFiles(files: Record<string, string | null>): Promise<void> {
  tmpRoot = await tempCampaignRoot();
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmpRoot, "beispiel", rel);
    if (content === null) {
      await rm(abs, { recursive: true, force: true });
      continue;
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  restoreRoot = useCampaignRoot(tmpRoot);
  db = await seedStore(tmpRoot);
}

/** A session file as the DM's tree would hold it. */
function sessionFile(id: string, frontmatter: string): string {
  return `---\nid: ${id}\n${frontmatter}---\n\n## Log\n`;
}

/** Start a session with the clock at `d`, then hand the clock back to `now`. */
async function startAt(d: Date, thenNow: Date): Promise<void> {
  setNow(() => d);
  expect((await post("/api/beispiel/session/start")).status).toBe(200);
  setNow(() => thenNow);
}

beforeEach(async () => {
  setNow(() => new Date(2026, 7, 19, 21, 5));
  db = await seedStore();
});

afterEach(async () => {
  dropStore();
  setNow(null);
  restoreRoot?.();
  restoreRoot = undefined;
  if (tmpRoot !== undefined) await removeTempRoot(tmpRoot);
  tmpRoot = undefined;
});

// --- the picking rule, as a query -------------------------------------------
// These used to call the pure `pickActiveSession`/`pickLastStartedSession`
// over SessionSummary lists read off disk. The rule is the same and lives in
// store/read.ts now, so it is exercised against real rows: the chronology is
// what decides, not the row order the database happens to return.

describe("pickSession", () => {
  const row = (s: { id: string; started?: string; ended?: string }): SessionRow => ({
    campaignId: "beispiel",
    id: s.id,
    started: s.started ?? null,
    ended: s.ended ?? null,
    body: "",
    extra: "{}",
    rev: 1,
  });

  /** Replace the campaign's sessions with exactly these rows. */
  function onlySessions(rows: SessionRow[]): void {
    db.delete(sessionsTable).where(eq(sessionsTable.campaignId, "beispiel")).run();
    for (const r of rows) {
      db.insert(sessionsTable)
        .values({ campaignId: r.campaignId, id: r.id, started: r.started, ended: r.ended })
        .run();
    }
  }

  const active = () => pickSession(db, "beispiel", false)?.id;
  const lastStarted = () => pickSession(db, "beispiel", true)?.id;

  test("no sessions, or all of them ended -> undefined", () => {
    onlySessions([]);
    expect(active()).toBeUndefined();
    onlySessions([row({ id: "2026-01-15", started: "2026-01-15T19:30", ended: "2026-01-15T22:45" })]);
    expect(active()).toBeUndefined();
  });

  test("the LAST started session without `ended` wins", () => {
    onlySessions([
      row({ id: "2026-01-15", started: "2026-01-15T19:30", ended: "2026-01-15T22:45" }),
      row({ id: "2026-08-19", started: "2026-08-19T21:05" }),
      row({ id: "2026-08-18", started: "2026-08-18T18:00" }),
    ]);
    expect(active()).toBe("2026-08-19");
  });

  test("falls back to the id when `started` is missing or degraded", () => {
    // A session whose `started` is a date-only value (the midnight
    // degradation of the YAML normalization the migration read) still sorts,
    // and one without `started` at all is ordered by its id — never dropped.
    onlySessions([row({ id: "2026-08-18" }), row({ id: "2026-08-19", started: "2026-08-19" })]);
    expect(active()).toBe("2026-08-19");
  });

  test("no usable date at all -> no order key, and therefore never active", () => {
    expect(sessionOrderKey(row({ id: "notes", started: "gestern abend" }))).toBeUndefined();
    onlySessions([row({ id: "gestern abend", started: "gestern abend" })]);
    expect(active()).toBeUndefined();
    // …not even against a real session: the parseable one wins, always.
    onlySessions([
      row({ id: "gestern abend", started: "gestern abend" }),
      row({ id: "2026-08-19", started: "2026-08-19T21:05" }),
    ]);
    expect(active()).toBe("2026-08-19");
  });

  test("a blank `ended` counts as RUNNING (one shared predicate)", () => {
    onlySessions([row({ id: "2026-08-19", ended: "" })]);
    expect(active()).toBe("2026-08-19");
    onlySessions([row({ id: "2026-08-19", ended: "  " })]);
    expect(active()).toBe("2026-08-19");
  });

  test("includeEnded ignores `ended` — the review's question", () => {
    onlySessions([
      row({ id: "2026-08-18", started: "2026-08-18T22:30", ended: "2026-08-19T01:40" }),
      row({ id: "2026-01-15", started: "2026-01-15T19:30", ended: "2026-01-15T22:45" }),
    ]);
    expect(lastStarted()).toBe("2026-08-18");
    expect(active()).toBeUndefined();
    onlySessions([]);
    expect(lastStarted()).toBeUndefined();
  });
});

describe("GET /api/:campaign/session", () => {
  test("404 when every session is ended (the committed fixture)", async () => {
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  test("404 for an unknown campaign", async () => {
    expect((await app.request("/api/nope/session")).status).toBe(404);
  });

  test("the running session, with the file GET's shape plus the epoch times", async () => {
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe("sessions/2026-08-19.md");
    expect(file.kind).toBe("session");
    expect(file.frontmatter.started).toBe("2026-08-19T21:05");
    // `raw` is a deterministic rendering of the rows now, not stored bytes
    // (store/render.ts rule 2) — so it is compared against GET /file, which
    // must answer with exactly the same document for the same session.
    expect(file.raw).toBe((await getFile("sessions/2026-08-19.md")).raw);
    expect(file.raw.startsWith("---")).toBe(true);
    expect(file.raw).toContain("## Log");
    expect(typeof file.mtimeMs).toBe("number");
    // The whole point: the SERVER resolves the zone-less timestamp, so a
    // client in another timezone still computes the right runtime.
    expect(file.startedMs).toBe(new Date(2026, 7, 19, 21, 5).getTime());
    expect(file.endedMs).toBeUndefined();
  });

  test("a session started YESTERDAY stays active past midnight", async () => {
    await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 15));
    const res = await app.request("/api/beispiel/session"); // 01:15, no row for today
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe("sessions/2026-08-18.md");
    expect(file.startedMs).toBe(new Date(2026, 7, 18, 22, 30).getTime());
  });

  test("a MIGRATED `started` at exactly midnight keeps a usable epoch time", async () => {
    // A full YAML timestamp (js-yaml only reads the seconds form as a Date)
    // at exactly midnight is indistinguishable from a date-only value, so the
    // migration stored the DEGRADED string `yyyy-mm-dd` (shared/src/parse.ts)
    // — the only way this shape still reaches the API. startedMs must not
    // degrade with it: the live timer used to vanish silently here because
    // the client demanded a time part.
    await seedWithFiles({
      "sessions/2026-08-19.md": sessionFile(
        "2026-08-19",
        "started: 2026-08-19T00:00:00\nscenes_played: []\n",
      ),
    });
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.frontmatter.started).toBe("2026-08-19"); // the degraded string
    expect(file.startedMs).toBe(new Date(2026, 7, 19, 0, 0).getTime());
  });

  test("an ended session carries endedMs too (GET /file, same shape)", async () => {
    const file = await getFile("sessions/2026-01-15.md");
    expect(file.startedMs).toBe(new Date(2026, 0, 15, 19, 30).getTime());
    expect(file.endedMs).toBe(new Date(2026, 0, 15, 22, 45).getTime());
  });

  test("a non-session file carries no session times", async () => {
    const file = await getFile("npcs/jorna.md");
    expect(file.startedMs).toBeUndefined();
    expect(file.endedMs).toBeUndefined();
  });
});

describe("writes land in the ACTIVE session, not in today's", () => {
  test("POST /log appends to yesterday's still-running session", async () => {
    await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 20));
    const res = await post("/api/beispiel/log", {
      text: "Nach Mitternacht weiter",
      sceneId: "lighthouse-arrival",
    });
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe("sessions/2026-08-18.md");
    expect(file.body).toContain("- 01:20 (lighthouse-arrival) Nach Mitternacht weiter\n");
    expect(file.frontmatter.scenes_played).toEqual(["lighthouse-arrival"]);
    // Nothing was created for the new day.
    expect(await fileStatus("sessions/2026-08-19.md")).toBe(404);
  });

  test("POST /session/end ends yesterday's session", async () => {
    await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 2, 0));
    const res = await post("/api/beispiel/session/end");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe("sessions/2026-08-18.md");
    expect(file.frontmatter.ended).toBe("2026-08-19T02:00");
    expect(file.endedMs).toBe(new Date(2026, 7, 19, 2, 0).getTime());
    // …and with that, nothing is active any more.
    expect((await app.request("/api/beispiel/session")).status).toBe(404);
  });

  test("POST /log is refused once the session is ended (no 200 into a closed log)", async () => {
    await post("/api/beispiel/session/start");
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    const res = await post("/api/beispiel/log", { text: "zu spät" });
    expect(res.status).toBe(404);
  });
});

describe("start — the state machine's edges (issues #40 review, #58)", () => {
  test("409 session_running instead of a second session next to an open one", async () => {
    // The older session was never ended (a forgotten evening). Starting today
    // used to create a second row, and ENDING that one resurrected the old
    // one as "active" — the app now offers to end the old session instead.
    await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 21, 5));
    const res = await post("/api/beispiel/session/start");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_running",
      path: "sessions/2026-08-18.md",
    });
    expect(await fileStatus("sessions/2026-08-19.md")).toBe(404);
    // After ending the old one, today's session starts normally.
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    expect(await fileStatus("sessions/2026-08-19.md")).toBe(200);
  });

  test("a session past midnight keeps its claim (it is not 'stale')", async () => {
    await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 15));
    const res = await app.request("/api/beispiel/session");
    expect(((await res.json()) as FileResponse).path).toBe("sessions/2026-08-18.md");
    // …and the start button of the live view does not silently split it.
    expect((await post("/api/beispiel/session/start")).status).toBe(409);
  });

  test("a start after the end opens a SECOND session of the same day (#58)", async () => {
    // "Beenden" is final: no `session_ended` 409, no resume — the next press
    // is a new evening with its own id, an empty log and a runtime at 0.
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    expect((await post("/api/beispiel/log", { text: "erste Runde" })).status).toBe(200);
    expect((await post("/api/beispiel/session/end")).status).toBe(200);

    setNow(() => new Date(2026, 7, 19, 23, 30));
    const again = await post("/api/beispiel/session/start");
    expect(again.status).toBe(200);
    const file = (await again.json()) as FileResponse;
    expect(file.path).toBe("sessions/2026-08-19-2.md");
    expect(file.frontmatter.id).toBe("2026-08-19-2");
    expect(file.frontmatter.started).toBe("2026-08-19T23:30");
    expect(file.frontmatter.ended).toBeUndefined();
    expect(file.body).not.toContain("erste Runde");
    // The first session is untouched and still ended…
    const first = await getFile("sessions/2026-08-19.md");
    expect(first.frontmatter.ended).toBe("2026-08-19T21:05");
    expect(first.body).toContain("erste Runde");
    // …and the ACTIVE session — where notes land now — is the new one.
    const active = (await (await app.request("/api/beispiel/session")).json()) as FileResponse;
    expect(active.path).toBe("sessions/2026-08-19-2.md");
    expect((await post("/api/beispiel/log", { text: "zweite Runde" })).status).toBe(200);
    expect((await getFile("sessions/2026-08-19-2.md")).body).toContain("zweite Runde");
    expect((await getFile("sessions/2026-08-19.md")).body).not.toContain("zweite Runde");
  });

  test("a third session of the day counts on: -3, and the review takes the last", async () => {
    for (const [n, hour] of [
      [1, 18],
      [2, 20],
      [3, 22],
    ] as const) {
      setNow(() => new Date(2026, 7, 19, hour, 0));
      const res = await post("/api/beispiel/session/start");
      expect(res.status).toBe(200);
      expect(((await res.json()) as FileResponse).path).toBe(
        n === 1 ? "sessions/2026-08-19.md" : `sessions/2026-08-19-${n}.md`,
      );
      expect((await post("/api/beispiel/session/end")).status).toBe(200);
    }
    // ?includeEnded=1 — the harvest's session — is the LAST STARTED one.
    const last = await app.request("/api/beispiel/session?includeEnded=1");
    expect(((await last.json()) as FileResponse).path).toBe("sessions/2026-08-19-3.md");
  });

  test("a discarded id never comes back — end, start, discard, start gives -3", async () => {
    // The high-water mark (meta `session_seq:<campaign>:<date>`, #58 review):
    // discarding the trailing `-2` deletes its row, and without a persisted
    // mark the next start would re-issue `-2` — a second evening's log rows
    // under an id a DM may already have written down.
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    const second = await post("/api/beispiel/session/start");
    expect(((await second.json()) as FileResponse).path).toBe("sessions/2026-08-19-2.md");
    expect((await post("/api/beispiel/session/discard")).status).toBe(200);
    expect(await fileStatus("sessions/2026-08-19-2.md")).toBe(404);

    const third = await post("/api/beispiel/session/start");
    expect(third.status).toBe(200);
    expect(((await third.json()) as FileResponse).path).toBe("sessions/2026-08-19-3.md");
  });

  test("a degraded running id blocks the start with 409 — ending it resolves it", async () => {
    // Accepted degrade (#58 review, finding 4): an id that is not a date can
    // never be "today", so every start is a 409 `session_running`. What has to
    // hold is the way out the app offers for exactly this code: end it once.
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    db.update(sessionsTable)
      .set({ id: "kaputt" })
      .where(eq(sessionsTable.id, "2026-08-19"))
      .run();
    const blocked = await post("/api/beispiel/session/start");
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({
      error: expect.any(String),
      code: "session_running",
      path: "sessions/kaputt.md",
    });
    // "Alte Session beenden" does not look at the id at all…
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    // …and the next start opens a session normally. It counts on to `-2`:
    // the plain date was handed out before the row was renamed, and the
    // high-water mark does not forget that.
    const after = await post("/api/beispiel/session/start");
    expect(after.status).toBe(200);
    expect(((await after.json()) as FileResponse).path).toBe("sessions/2026-08-19-2.md");
  });

  test("POST /session/resume is gone (404, no route)", async () => {
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/beispiel/session/resume")).status).toBe(404);
  });

  test("same-minute restarts still order by the id's sequence number", async () => {
    // Start, end and start again inside ONE minute: `started` ties, so the
    // sequence number has to decide which session is "the last started".
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    const active = (await (await app.request("/api/beispiel/session")).json()) as FileResponse;
    expect(active.path).toBe("sessions/2026-08-19-2.md");
    expect(active.frontmatter.started).toBe("2026-08-19T21:05");
    const tree = (await (await app.request("/api/beispiel/tree")).json()) as {
      sessions: Array<{ id: string }>;
    };
    expect(tree.sessions.slice(0, 2).map((s) => s.id)).toEqual([
      "2026-08-19-2",
      "2026-08-19",
    ]);
  });
});

describe("POST /session/discard — the mis-click's undo (AK7)", () => {
  test("an EMPTY session is deleted, and nothing is live afterwards", async () => {
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    expect(await fileStatus("sessions/2026-08-19.md")).toBe(200);

    const res = await post("/api/beispiel/session/discard");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "sessions/2026-08-19.md" });
    // The ROW is gone — the successor of "the file was deleted".
    expect(await fileStatus("sessions/2026-08-19.md")).toBe(404);
    // …and the session state machine is back where it was: nothing running,
    // and "Session starten" works again instead of a 409.
    expect((await app.request("/api/beispiel/session")).status).toBe(404);
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
  });

  test("a session with a LOG ENTRY is refused — 409, row untouched", async () => {
    await post("/api/beispiel/session/start");
    expect((await post("/api/beispiel/log", { text: "Ankunft im Hafen" })).status).toBe(200);
    const before = await getFile("sessions/2026-08-19.md");

    const res = await post("/api/beispiel/session/discard");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_not_empty",
      path: "sessions/2026-08-19.md",
    });
    // "File untouched" is now "row untouched": same rendering, same rev — a
    // refused write must not even bump the guard token.
    const after = await getFile("sessions/2026-08-19.md");
    expect(after.raw).toBe(before.raw);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    // Still the running session — the refusal changed nothing at all.
    expect((await app.request("/api/beispiel/session")).status).toBe(200);
  });

  test("a session with SCENES_PLAYED is refused even with an empty log", async () => {
    // A hand-edited session file: `scenes_played` set, `## Log` without
    // entries. Only the migration can produce that shape now — the API
    // always writes a log line together with a played scene.
    await seedWithFiles({
      "sessions/2026-08-19.md": sessionFile(
        "2026-08-19",
        "started: 2026-08-19T21:05\nscenes_played: [lighthouse-arrival]\n",
      ),
    });
    const res = await post("/api/beispiel/session/discard");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("session_not_empty");
    expect(await fileStatus("sessions/2026-08-19.md")).toBe(200);
  });

  test("404 without a running session — an ENDED one is never deleted", async () => {
    // The committed fixture has only ended sessions.
    const res = await post("/api/beispiel/session/discard");
    expect(res.status).toBe(404);
    expect(await fileStatus("sessions/2026-01-15.md")).toBe(200);
    // …not even when that ended session is empty.
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/beispiel/session/discard")).status).toBe(404);
    expect(await fileStatus("sessions/2026-08-19.md")).toBe(200);
  });

  test("discards YESTERDAY's empty session past midnight (the ACTIVE one)", async () => {
    await startAt(new Date(2026, 7, 18, 23, 50), new Date(2026, 7, 19, 0, 20));
    const res = await post("/api/beispiel/session/discard");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { path: string }).path).toBe("sessions/2026-08-18.md");
    expect(await fileStatus("sessions/2026-08-18.md")).toBe(404);
  });

  test("404 for an unknown campaign", async () => {
    expect((await post("/api/nope/session/discard")).status).toBe(404);
  });
});

describe("the review's session — GET /session?includeEnded=1", () => {
  test("finds the session that was ended AFTER midnight (harvest, finding 1)", async () => {
    // The evening of the 18th ran into the 19th and was ended at 01:40 in
    // YESTERDAY's session. A review that derives "today's session" from the
    // browser date harvests sessions/2026-08-19.md — which does not exist.
    await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 40));
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    setNow(() => new Date(2026, 7, 19, 9, 0));
    expect((await app.request("/api/beispiel/session")).status).toBe(404); // nothing runs
    const res = await app.request("/api/beispiel/session?includeEnded=1");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe("sessions/2026-08-18.md");
    expect(file.endedMs).toBe(new Date(2026, 7, 19, 1, 40).getTime());
  });

  test("prefers the RUNNING session over the ended fixture", async () => {
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    const res = await app.request("/api/beispiel/session?includeEnded=1");
    expect(((await res.json()) as FileResponse).path).toBe("sessions/2026-08-19.md");
  });

  test("404 with no session at all, with and without includeEnded", async () => {
    await seedWithFiles({ sessions: null });
    expect((await app.request("/api/beispiel/session?includeEnded=1")).status).toBe(404);
    expect((await app.request("/api/beispiel/session?includeEnded=0")).status).toBe(404);
  });
});

describe("degraded session files never hijack the active session", () => {
  test("an unparseable `started` with a non-date name is ignored (finding 4)", async () => {
    // `sessions/gestern abend.md`: neither the id nor `started` is a date, so
    // the row has no place in the chronology — it used to win the raw STRING
    // sort forever and swallow every log line.
    await seedWithFiles({
      "sessions/gestern abend.md": sessionFile(
        "gestern abend",
        "started: gestern abend\nscenes_played: []\n",
      ),
    });
    expect((await app.request("/api/beispiel/session")).status).toBe(404);
    expect((await post("/api/beispiel/log", { text: "x" })).status).toBe(404);
    // A real start works and IS the active session, despite the stray row.
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    const res = await app.request("/api/beispiel/session");
    expect(((await res.json()) as FileResponse).path).toBe("sessions/2026-08-19.md");
  });

  test("a non-date id with a parseable `started` still counts", async () => {
    await seedWithFiles({
      "sessions/notizen.md": sessionFile("notizen", "started: 2026-08-19T20:00\nscenes_played: []\n"),
    });
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileResponse).path).toBe("sessions/notizen.md");
  });

  test("a blank `ended` means RUNNING and can be ended normally (finding 5)", async () => {
    await seedWithFiles({
      "sessions/2026-08-19.md": sessionFile(
        "2026-08-19",
        'started: 2026-08-19T20:00\nended: ""\nscenes_played: []\n',
      ),
    });
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileResponse).path).toBe("sessions/2026-08-19.md");
    setNow(() => new Date(2026, 7, 19, 23, 50));
    const ended = await post("/api/beispiel/session/end");
    expect(ended.status).toBe(200);
    expect(((await ended.json()) as FileResponse).frontmatter.ended).toBe("2026-08-19T23:50");
    expect((await app.request("/api/beispiel/session")).status).toBe(404);
  });
});

describe("localDateTimeToMs", () => {
  test("reads the format's zone-less timestamps in the server's timezone", () => {
    expect(localDateTimeToMs("2026-08-19T21:05")).toBe(new Date(2026, 7, 19, 21, 5).getTime());
    expect(localDateTimeToMs("2026-08-19 21:05")).toBe(new Date(2026, 7, 19, 21, 5).getTime());
    expect(localDateTimeToMs("2026-08-19T21:05:30")).toBe(
      new Date(2026, 7, 19, 21, 5, 30).getTime(),
    );
    // Date-only = midnight (the degraded `…T00:00`).
    expect(localDateTimeToMs("2026-08-19")).toBe(new Date(2026, 7, 19, 0, 0).getTime());
  });

  test("undefined for everything unusable — never throws", () => {
    expect(localDateTimeToMs(undefined)).toBeUndefined();
    expect(localDateTimeToMs(null)).toBeUndefined();
    expect(localDateTimeToMs(42)).toBeUndefined();
    expect(localDateTimeToMs("gestern abend")).toBeUndefined();
    expect(localDateTimeToMs("2026-08-19T21")).toBeUndefined();
  });
});
