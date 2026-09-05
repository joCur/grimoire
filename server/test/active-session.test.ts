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

/**
 * Start a session and return ITS PATH. Session ids are opaque random strings
 * since issue #58, so no test may spell one out — the path always comes from
 * the response that created (or reported) the session.
 */
async function startSession(): Promise<string> {
  const res = await post("/api/beispiel/session/start");
  expect(res.status).toBe(200);
  return ((await res.json()) as FileResponse).path;
}

/**
 * How many sessions the campaign has. The successor of "no file was created
 * for the new day": with an opaque id there is no path to probe for absence,
 * so the assertion counts rows instead (via the tree, which lists them).
 */
async function sessionCount(): Promise<number> {
  const res = await app.request("/api/beispiel/tree");
  expect(res.status).toBe(200);
  return ((await res.json()) as { sessions: unknown[] }).sessions.length;
}

/** Path of the ACTIVE session, or of the last started one with `includeEnded`. */
async function activePath(includeEnded = false): Promise<string> {
  const res = await app.request(`/api/beispiel/session${includeEnded ? "?includeEnded=1" : ""}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as FileResponse).path;
}

/**
 * Start a session with the clock at `d`, then hand the clock back to `now`.
 * Returns the new session's path (see `startSession`).
 */
async function startAt(d: Date, thenNow: Date): Promise<string> {
  setNow(() => d);
  const path = await startSession();
  setNow(() => thenNow);
  return path;
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
    extra: "{}",
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

  test("a date-only `started` still sorts; no `started` at all never wins", () => {
    // A date-only `started` is the midnight degradation of the YAML
    // normalization the migration read — it is a usable order key.
    //
    // The id is NOT a fallback any more (issue #58, PO decision): it is an
    // opaque random string, so there is nothing in it to read. A row without
    // `started` therefore has no place in the chronology, even when its id
    // happens to look like a date — that shape only exists in files written
    // before the cutover.
    onlySessions([row({ id: "2026-08-18" }), row({ id: "2026-08-19", started: "2026-08-19" })]);
    expect(active()).toBe("2026-08-19");
    expect(sessionOrderKey(row({ id: "2026-08-18" }))).toBeUndefined();
    onlySessions([row({ id: "2026-08-18" })]);
    expect(active()).toBeUndefined();
  });

  test("`createdAt` breaks a tie on `started` — the same-second restart", () => {
    // Start, end, start again inside ONE second: `started` ties, and the
    // opaque id cannot say which row came second. The insertion time can.
    onlySessions([
      row({ id: "b6b1", started: "2026-08-19T21:05:00", createdAt: 2000 }),
      row({ id: "a0a2", started: "2026-08-19T21:05:00", createdAt: 1000 }),
    ]);
    expect(active()).toBe("b6b1");
    // …and with `createdAt` equal as well (migrated rows carry 0) the order is
    // arbitrary but STABLE — the same answer whatever the row order was.
    onlySessions([
      row({ id: "a0a2", started: "2026-08-19T21:05:00" }),
      row({ id: "b6b1", started: "2026-08-19T21:05:00" }),
    ]);
    const first = active();
    onlySessions([
      row({ id: "b6b1", started: "2026-08-19T21:05:00" }),
      row({ id: "a0a2", started: "2026-08-19T21:05:00" }),
    ]);
    expect(active()).toBe(first);
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
    onlySessions([row({ id: "2026-08-19", started: "2026-08-19T19:30", ended: "" })]);
    expect(active()).toBe("2026-08-19");
    onlySessions([row({ id: "2026-08-19", started: "2026-08-19T19:30", ended: "  " })]);
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
    const started = await startSession();
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe(started);
    // The id is OPAQUE (issue #58): an address, nothing to read. What has to
    // hold is that it is addressable and says nothing about the calendar.
    expect(file.path).toMatch(/^sessions\/[\w-]+\.md$/);
    expect(file.path).not.toContain("2026-08-19");
    expect(file.kind).toBe("session");
    expect(file.frontmatter.started).toBe("2026-08-19T21:05:00");
    // `raw` is a deterministic rendering of the rows now, not stored bytes
    // (store/render.ts rule 2) — so it is compared against GET /file, which
    // must answer with exactly the same document for the same session.
    expect(file.raw).toBe((await getFile(started)).raw);
    expect(file.raw.startsWith("---")).toBe(true);
    expect(file.raw).toContain("## Log");
    expect(typeof file.mtimeMs).toBe("number");
    // The whole point: the SERVER resolves the zone-less timestamp, so a
    // client in another timezone still computes the right runtime.
    expect(file.startedMs).toBe(new Date(2026, 7, 19, 21, 5).getTime());
    expect(file.endedMs).toBeUndefined();
  });

  test("a session started YESTERDAY stays active past midnight", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 15));
    const res = await app.request("/api/beispiel/session"); // 01:15, no row for today
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe(yesterday);
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
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 20));
    const res = await post("/api/beispiel/log", {
      text: "Nach Mitternacht weiter",
      sceneId: "lighthouse-arrival",
    });
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe(yesterday);
    expect(file.body).toContain("- 01:20 (lighthouse-arrival) Nach Mitternacht weiter\n");
    expect(file.frontmatter.scenes_played).toEqual(["lighthouse-arrival"]);
    // Nothing was created for the new day: the campaign still has exactly the
    // committed fixture's session plus this one.
    expect(await sessionCount()).toBe(2);
  });

  test("POST /session/end ends yesterday's session", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 2, 0));
    const res = await post("/api/beispiel/session/end");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe(yesterday);
    expect(file.frontmatter.ended).toBe("2026-08-19T02:00:00");
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
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 21, 5));
    const res = await post("/api/beispiel/session/start");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_running",
      path: yesterday,
    });
    expect(await sessionCount()).toBe(2); // the fixture's + yesterday's, no third
    // After ending the old one, today's session starts normally.
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    const today = await startSession();
    expect(today).not.toBe(yesterday);
    expect(await fileStatus(today)).toBe(200);
  });

  test("a session past midnight keeps its claim (it is not 'stale')", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 15));
    expect(await activePath()).toBe(yesterday);
    // …and the start button of the live view does not silently split it.
    expect((await post("/api/beispiel/session/start")).status).toBe(409);
  });

  test("a start after the end opens a SECOND session of the same day (#58)", async () => {
    // "Beenden" is final: no `session_ended` 409, no resume — the next press
    // is a new evening with its own id, an empty log and a runtime at 0.
    const firstPath = await startSession();
    expect((await post("/api/beispiel/log", { text: "erste Runde" })).status).toBe(200);
    expect((await post("/api/beispiel/session/end")).status).toBe(200);

    setNow(() => new Date(2026, 7, 19, 23, 30));
    const again = await post("/api/beispiel/session/start");
    expect(again.status).toBe(200);
    const file = (await again.json()) as FileResponse;
    // Two sessions on the SAME DAY are two different opaque ids, and both are
    // addressable — that is the whole contract on the id (issue #58).
    expect(file.path).not.toBe(firstPath);
    expect(file.path).toBe(`sessions/${String(file.frontmatter.id)}.md`);
    expect(file.frontmatter.started).toBe("2026-08-19T23:30:00");
    expect(file.frontmatter.ended).toBeUndefined();
    expect(file.body).not.toContain("erste Runde");
    // The first session is untouched and still ended…
    const first = await getFile(firstPath);
    expect(first.frontmatter.ended).toBe("2026-08-19T21:05:00");
    expect(first.body).toContain("erste Runde");
    // …and the ACTIVE session — where notes land now — is the new one.
    expect(await activePath()).toBe(file.path);
    expect((await post("/api/beispiel/log", { text: "zweite Runde" })).status).toBe(200);
    expect((await getFile(file.path)).body).toContain("zweite Runde");
    expect((await getFile(firstPath)).body).not.toContain("zweite Runde");
  });

  test("three sessions of one day are three ids, and the review takes the last", async () => {
    const paths: string[] = [];
    for (const hour of [18, 20, 22]) {
      setNow(() => new Date(2026, 7, 19, hour, 0));
      paths.push(await startSession());
      expect((await post("/api/beispiel/session/end")).status).toBe(200);
    }
    expect(new Set(paths).size).toBe(3);
    // ?includeEnded=1 — the harvest's session — is the LAST STARTED one, and
    // "last" is `started`, never anything read out of an id.
    expect(await activePath(true)).toBe(paths[2] ?? "");
  });

  test("a discarded session's id never comes back — the next start is a new one", async () => {
    // The date+sequence scheme needed a PERSISTED high-water mark for this
    // (meta `session_seq:…`, #58 review): discarding the trailing `-2` deleted
    // the only trace of it, and the next start re-issued the same id onto
    // another evening's log rows. A random id needs no bookkeeping at all.
    const seen = new Set<string>();
    seen.add(await startSession());
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    const second = await startSession();
    expect(seen.has(second)).toBe(false);
    seen.add(second);
    expect((await post("/api/beispiel/session/discard")).status).toBe(200);
    expect(await fileStatus(second)).toBe(404);

    const third = await startSession();
    expect(seen.has(third)).toBe(false);
  });

  test("a hand-broken `started` no longer blocks the start (the degrade moved)", async () => {
    // The old degrade (#58 review, finding 4) was about an ID that did not
    // parse as a date: it could never be "today", so every start answered 409
    // `session_running` and the DM had to end the row once. With the check on
    // `started` that dead end is gone — a row whose `started` is unreadable
    // has no place in the chronology at all (store/read.ts sessionOrderKey),
    // so it is not the "running session" either and a start simply opens a
    // new one. The broken row stays addressable and is not touched.
    const broken = await startSession();
    db.update(sessionsTable)
      .set({ started: "gestern abend" })
      .where(eq(sessionsTable.campaignId, "beispiel"))
      .run();
    const fresh = await startSession();
    expect(fresh).not.toBe(broken);
    expect(await activePath()).toBe(fresh);
    expect(await fileStatus(broken)).toBe(200);
  });

  test("POST /session/resume is gone (404, no route)", async () => {
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/beispiel/session/resume")).status).toBe(404);
  });

  test("same-second restarts order by the row's insertion time", async () => {
    // Start, end and start again inside ONE second: `started` ties, and the
    // opaque id cannot decide which session is "the last started" — the row's
    // `createdAt` does (store/read.ts compareSessionsNewestFirst).
    const first = await startSession();
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    const second = await startSession();
    expect(second).not.toBe(first);
    const active = (await (await app.request("/api/beispiel/session")).json()) as FileResponse;
    expect(active.path).toBe(second);
    expect(active.frontmatter.started).toBe("2026-08-19T21:05:00");
    const tree = (await (await app.request("/api/beispiel/tree")).json()) as {
      sessions: Array<{ path: string }>;
    };
    expect(tree.sessions.slice(0, 2).map((s) => s.path)).toEqual([second, first]);
  });
});

describe("POST /session/discard — the mis-click's undo (AK7)", () => {
  test("an EMPTY session is deleted, and nothing is live afterwards", async () => {
    const started = await startSession();
    expect(await fileStatus(started)).toBe(200);

    const res = await post("/api/beispiel/session/discard");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: started });
    // The ROW is gone — the successor of "the file was deleted".
    expect(await fileStatus(started)).toBe(404);
    // …and the session state machine is back where it was: nothing running,
    // and "Session starten" works again instead of a 409.
    expect((await app.request("/api/beispiel/session")).status).toBe(404);
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
  });

  test("a session with a LOG ENTRY is refused — 409, row untouched", async () => {
    const started = await startSession();
    expect((await post("/api/beispiel/log", { text: "Ankunft im Hafen" })).status).toBe(200);
    const before = await getFile(started);

    const res = await post("/api/beispiel/session/discard");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_not_empty",
      path: started,
    });
    // "File untouched" is now "row untouched": same rendering, same rev — a
    // refused write must not even bump the guard token.
    const after = await getFile(started);
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
    const started = await startSession();
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/beispiel/session/discard")).status).toBe(404);
    expect(await fileStatus(started)).toBe(200);
  });

  test("discards YESTERDAY's empty session past midnight (the ACTIVE one)", async () => {
    const yesterday = await startAt(new Date(2026, 7, 18, 23, 50), new Date(2026, 7, 19, 0, 20));
    const res = await post("/api/beispiel/session/discard");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { path: string }).path).toBe(yesterday);
    expect(await fileStatus(yesterday)).toBe(404);
  });

  test("404 for an unknown campaign", async () => {
    expect((await post("/api/nope/session/discard")).status).toBe(404);
  });
});

describe("the review's session — GET /session?includeEnded=1", () => {
  test("finds the session that was ended AFTER midnight (harvest, finding 1)", async () => {
    // The evening of the 18th ran into the 19th and was ended at 01:40 in
    // YESTERDAY's session. A review that derives "today's session" from the
    // browser date harvests nothing — there is no session of the 19th.
    const yesterday = await startAt(new Date(2026, 7, 18, 22, 30), new Date(2026, 7, 19, 1, 40));
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    setNow(() => new Date(2026, 7, 19, 9, 0));
    expect((await app.request("/api/beispiel/session")).status).toBe(404); // nothing runs
    const res = await app.request("/api/beispiel/session?includeEnded=1");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe(yesterday);
    expect(file.endedMs).toBe(new Date(2026, 7, 19, 1, 40).getTime());
  });

  test("prefers the RUNNING session over the ended fixture", async () => {
    const started = await startSession();
    expect(await activePath(true)).toBe(started);
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
    const started = await startSession();
    expect(await activePath()).toBe(started);
  });

  test("a non-date id with a parseable `started` still counts", async () => {
    await seedWithFiles({
      "sessions/notizen.md": sessionFile("notizen", "started: 2026-08-19T20:00\nscenes_played: []\n"),
    });
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileResponse).path).toBe("sessions/notizen.md");
  });

  // Sessions written before issue #58 have a MINUTE-precise `started`. The
  // format's parser has always accepted both widths, so those rows keep
  // working — verbatim string, a startedMs on the minute, endable.
  test("a pre-#58 minute-precise `started` stays valid", async () => {
    await seedWithFiles({
      "sessions/2026-08-19.md": sessionFile(
        "2026-08-19",
        "started: 2026-08-19T20:00\nscenes_played: []\n",
      ),
    });
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.frontmatter.started).toBe("2026-08-19T20:00");
    expect(file.startedMs).toBe(new Date(2026, 7, 19, 20, 0).getTime());
    setNow(() => new Date(2026, 7, 19, 22, 0, 30));
    const ended = (await (await post("/api/beispiel/session/end")).json()) as FileResponse;
    // The end is written at the new width next to the old `started`.
    expect(ended.frontmatter.started).toBe("2026-08-19T20:00");
    expect(ended.frontmatter.ended).toBe("2026-08-19T22:00:30");
  });

  // Date-shaped ids are what every campaign written before the PO decision on
  // issue #58 carries — plain dates and the `-2` sequence form. They are just
  // strings now: still addressable, still ordered by `started`, mixed freely
  // with the opaque ids a start hands out today.
  test("legacy date ids and a new opaque id live side by side", async () => {
    await seedWithFiles({
      "sessions/2026-08-19.md": sessionFile(
        "2026-08-19",
        "started: 2026-08-19T18:00\nended: 2026-08-19T19:30\nscenes_played: []\n",
      ),
      "sessions/2026-08-19-2.md": sessionFile(
        "2026-08-19-2",
        "started: 2026-08-19T19:45\nended: 2026-08-19T20:30\nscenes_played: []\n",
      ),
    });
    // Both old files are readable under their own path…
    expect(await fileStatus("sessions/2026-08-19.md")).toBe(200);
    expect(await fileStatus("sessions/2026-08-19-2.md")).toBe(200);
    // …and the harvest's "last started" is the `-2` one, by `started`.
    expect(await activePath(true)).toBe("sessions/2026-08-19-2.md");

    // A start next to them gets an opaque id and wins on `started` (21:05).
    const fresh = await startSession();
    expect(fresh).not.toContain("2026-08-19");
    expect(await activePath()).toBe(fresh);
    const tree = (await (await app.request("/api/beispiel/tree")).json()) as {
      sessions: Array<{ path: string }>;
    };
    expect(tree.sessions.slice(0, 3).map((s) => s.path)).toEqual([
      fresh,
      "sessions/2026-08-19-2.md",
      "sessions/2026-08-19.md",
    ]);
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
    expect(((await ended.json()) as FileResponse).frontmatter.ended).toBe("2026-08-19T23:50:00");
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
