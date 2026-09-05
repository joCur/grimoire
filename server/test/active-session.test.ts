// The active session (issue #40): GET /api/:campaign/session, the epoch
// timestamps that make the client's runtime correct, and the rule that a log
// line lands in the RUNNING session even when that is yesterday's file.
//
// Like the other write tests this runs against a TEMP COPY of the example
// campaign (examples/ is the committed format reference and must never be
// mutated) and overrides the clock via setNow().

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FileResponse, SessionSummary } from "@grimoire/shared";
import { app } from "../src/server";
import {
  pickActiveSession,
  pickLastStartedSession,
  sessionOrderKey,
} from "../src/campaign-fs";
import { localDateTimeToMs, setNow } from "../src/clock";
import { getCampaignRoot, setCampaignRoot } from "../src/config";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

let tmpRoot = "";
let originalRoot = "";

const absOf = (rel: string) => path.join(tmpRoot, "beispiel", rel);

async function post(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

async function exists(rel: string): Promise<boolean> {
  try {
    await stat(absOf(rel));
    return true;
  } catch {
    return false;
  }
}

/** Write a session file directly (an "externally created" session). */
async function session(id: string, frontmatter: string): Promise<void> {
  await writeFile(absOf(`sessions/${id}.md`), `---\nid: ${id}\n${frontmatter}---\n\n## Log\n`, "utf8");
}

/** Remove every session file, so each test starts from a known state. */
async function clearSessions(): Promise<void> {
  await rm(path.join(tmpRoot, "beispiel", "sessions"), { recursive: true, force: true });
  await cp(
    path.join(EXAMPLES, "beispiel", "sessions"),
    path.join(tmpRoot, "beispiel", "sessions"),
    { recursive: true },
  );
}

beforeAll(async () => {
  originalRoot = getCampaignRoot();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "grimoire-active-"));
  await cp(path.join(EXAMPLES, "beispiel"), path.join(tmpRoot, "beispiel"), { recursive: true });
  setCampaignRoot(tmpRoot);
});

afterAll(async () => {
  setCampaignRoot(originalRoot);
  setNow(null);
  await rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  setNow(() => new Date(2026, 7, 19, 21, 5));
  await clearSessions();
});

describe("pickActiveSession", () => {
  const of = (s: Partial<SessionSummary> & { id: string }): SessionSummary => ({
    path: `sessions/${s.id}.md`,
    scenes_played: [],
    ...s,
  });

  test("no sessions, or all of them ended -> undefined", () => {
    expect(pickActiveSession([])).toBeUndefined();
    expect(
      pickActiveSession([
        of({ id: "2026-01-15", started: "2026-01-15T19:30", ended: "2026-01-15T22:45" }),
      ]),
    ).toBeUndefined();
  });

  test("the LAST started session without `ended` wins", () => {
    const active = pickActiveSession([
      of({ id: "2026-01-15", started: "2026-01-15T19:30", ended: "2026-01-15T22:45" }),
      of({ id: "2026-08-19", started: "2026-08-19T21:05" }),
      of({ id: "2026-08-18", started: "2026-08-18T18:00" }),
    ]);
    expect(active?.id).toBe("2026-08-19");
  });

  test("falls back to the id when `started` is missing or degraded", () => {
    // A session file whose `started` is a date-only value (the midnight
    // degradation of the YAML normalization) still sorts, and a file without
    // `started` at all is ordered by its id — never dropped.
    const active = pickActiveSession([
      of({ id: "2026-08-18" }),
      of({ id: "2026-08-19", started: "2026-08-19" }),
    ]);
    expect(active?.id).toBe("2026-08-19");
  });
});

describe("sessionOrderKey / pickLastStartedSession", () => {
  const of = (s: Partial<SessionSummary> & { id: string }): SessionSummary => ({
    path: `sessions/${s.id}.md`,
    scenes_played: [],
    ...s,
  });

  test("no usable date at all -> no key, and therefore never active", () => {
    expect(sessionOrderKey(of({ id: "notes", started: "gestern abend" }))).toBeUndefined();
    expect(
      pickActiveSession([of({ id: "gestern abend", started: "gestern abend" })]),
    ).toBeUndefined();
    // …not even against a real session: the parseable one wins, always.
    expect(
      pickActiveSession([
        of({ id: "gestern abend", started: "gestern abend" }),
        of({ id: "2026-08-19", started: "2026-08-19T21:05" }),
      ])?.id,
    ).toBe("2026-08-19");
  });

  test("a blank `ended` counts as RUNNING (one shared predicate)", () => {
    expect(pickActiveSession([of({ id: "2026-08-19", ended: "" })])?.id).toBe("2026-08-19");
    expect(pickActiveSession([of({ id: "2026-08-19", ended: "  " })])?.id).toBe("2026-08-19");
  });

  test("pickLastStartedSession ignores `ended` — the review's question", () => {
    const last = pickLastStartedSession([
      of({ id: "2026-08-18", started: "2026-08-18T22:30", ended: "2026-08-19T01:40" }),
      of({ id: "2026-01-15", started: "2026-01-15T19:30", ended: "2026-01-15T22:45" }),
    ]);
    expect(last?.id).toBe("2026-08-18");
    expect(pickLastStartedSession([])).toBeUndefined();
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
    expect(file.raw).toBe(await readFile(absOf("sessions/2026-08-19.md"), "utf8"));
    expect(typeof file.mtimeMs).toBe("number");
    // The whole point: the SERVER resolves the zone-less timestamp, so a
    // client in another timezone still computes the right runtime.
    expect(file.startedMs).toBe(new Date(2026, 7, 19, 21, 5).getTime());
    expect(file.endedMs).toBeUndefined();
  });

  test("a session started YESTERDAY stays active past midnight", async () => {
    await session("2026-08-18", "started: 2026-08-18T22:30\nscenes_played: []\n");
    setNow(() => new Date(2026, 7, 19, 1, 15)); // 01:15, no file for today
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe("sessions/2026-08-18.md");
    expect(file.startedMs).toBe(new Date(2026, 7, 18, 22, 30).getTime());
  });

  test("`started` at exactly midnight keeps a usable epoch time", async () => {
    // A full YAML timestamp (js-yaml only reads the seconds form as a Date)
    // at exactly midnight is indistinguishable from a date-only value, so the
    // frontmatter STRING degrades to `yyyy-mm-dd` (shared/src/parse.ts).
    // startedMs must not degrade with it: the live timer used to vanish
    // silently here because the client demanded a time part.
    await session("2026-08-19", "started: 2026-08-19T00:00:00\nscenes_played: []\n");
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.frontmatter.started).toBe("2026-08-19"); // the degraded string
    expect(file.startedMs).toBe(new Date(2026, 7, 19, 0, 0).getTime());
  });

  test("an ended session carries endedMs too (GET /file, same shape)", async () => {
    const res = await app.request("/api/beispiel/file?path=sessions/2026-01-15.md");
    const file = (await res.json()) as FileResponse;
    expect(file.startedMs).toBe(new Date(2026, 0, 15, 19, 30).getTime());
    expect(file.endedMs).toBe(new Date(2026, 0, 15, 22, 45).getTime());
  });

  test("a non-session file carries no session times", async () => {
    const res = await app.request("/api/beispiel/file?path=npcs/jorna.md");
    const file = (await res.json()) as FileResponse;
    expect(file.startedMs).toBeUndefined();
    expect(file.endedMs).toBeUndefined();
  });
});

describe("writes land in the ACTIVE session, not in today's file", () => {
  test("POST /log appends to yesterday's still-running session", async () => {
    await session("2026-08-18", "started: 2026-08-18T22:30\nscenes_played: []\n");
    setNow(() => new Date(2026, 7, 19, 1, 20));
    const res = await post("/api/beispiel/log", {
      text: "Nach Mitternacht weiter",
      sceneId: "lighthouse-arrival",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileResponse).path).toBe("sessions/2026-08-18.md");
    const raw = await readFile(absOf("sessions/2026-08-18.md"), "utf8");
    expect(raw).toContain("- 01:20 (lighthouse-arrival) Nach Mitternacht weiter\n");
    expect(raw).toContain("scenes_played: [lighthouse-arrival]\n");
    // Nothing was created for the new day.
    expect(await exists("sessions/2026-08-19.md")).toBe(false);
  });

  test("POST /session/end ends yesterday's session", async () => {
    await session("2026-08-18", "started: 2026-08-18T22:30\nscenes_played: []\n");
    setNow(() => new Date(2026, 7, 19, 2, 0));
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

describe("start / resume — the state machine's edges (issue #40 review)", () => {
  test("409 session_running instead of a second session next to an open one", async () => {
    // The older session was never ended (a forgotten evening). Starting today
    // used to create a second file, and ENDING that one resurrected the old
    // one as "active" — the app now offers to end the old session instead.
    await session("2026-08-18", "started: 2026-08-18T22:30\nscenes_played: []\n");
    const res = await post("/api/beispiel/session/start");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_running",
      path: "sessions/2026-08-18.md",
    });
    expect(await exists("sessions/2026-08-19.md")).toBe(false);
    // After ending the old one, today's session starts normally.
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    expect(await exists("sessions/2026-08-19.md")).toBe(true);
  });

  test("a session past midnight keeps its claim (it is not 'stale')", async () => {
    await session("2026-08-18", "started: 2026-08-18T22:30\nscenes_played: []\n");
    setNow(() => new Date(2026, 7, 19, 1, 15));
    const res = await app.request("/api/beispiel/session");
    expect(((await res.json()) as FileResponse).path).toBe("sessions/2026-08-18.md");
    // …and the start button of the live view does not silently split it.
    expect((await post("/api/beispiel/session/start")).status).toBe(409);
  });

  test("409 session_ended on today's ended session, resume re-opens it", async () => {
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    const again = await post("/api/beispiel/session/start");
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: expect.any(String),
      code: "session_ended",
      path: "sessions/2026-08-19.md",
    });
    // Explicit "fortsetzen": `ended` is removed, the session runs again —
    // same file, so the log of the evening stays in one piece.
    setNow(() => new Date(2026, 7, 19, 23, 30));
    const resumed = await post("/api/beispiel/session/resume");
    expect(resumed.status).toBe(200);
    const file = (await resumed.json()) as FileResponse;
    expect(file.path).toBe("sessions/2026-08-19.md");
    expect(file.frontmatter.ended).toBeUndefined();
    expect(file.endedMs).toBeUndefined();
    expect(await readFile(absOf("sessions/2026-08-19.md"), "utf8")).not.toContain("ended:");
    // …and it is the active session again, so notes land in it.
    expect((await app.request("/api/beispiel/session")).status).toBe(200);
    expect((await post("/api/beispiel/log", { text: "weiter" })).status).toBe(200);
  });

  test("resume needs an ENDED session: 409 while one runs", async () => {
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    const running = await post("/api/beispiel/session/resume");
    expect(running.status).toBe(409);
    expect(await running.json()).toEqual({
      error: expect.any(String),
      path: "sessions/2026-08-19.md",
    });
  });
});

describe("the review's session — GET /session?includeEnded=1", () => {
  test("finds the session that was ended AFTER midnight (harvest, finding 1)", async () => {
    // The evening of the 18th ran into the 19th and was ended at 01:40 in
    // YESTERDAY's file. A review that derives "today's file" from the browser
    // date harvests sessions/2026-08-19.md — which does not exist.
    await session(
      "2026-08-18",
      "started: 2026-08-18T22:30\nended: 2026-08-19T01:40\nscenes_played: []\n",
    );
    setNow(() => new Date(2026, 7, 19, 9, 0));
    expect((await app.request("/api/beispiel/session")).status).toBe(404); // nothing runs
    const res = await app.request("/api/beispiel/session?includeEnded=1");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe("sessions/2026-08-18.md");
    expect(file.endedMs).toBe(new Date(2026, 7, 19, 1, 40).getTime());
  });

  test("prefers the RUNNING session and 404s only without any session file", async () => {
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    const res = await app.request("/api/beispiel/session?includeEnded=1");
    expect(((await res.json()) as FileResponse).path).toBe("sessions/2026-08-19.md");
    await rm(path.join(tmpRoot, "beispiel", "sessions"), { recursive: true, force: true });
    expect((await app.request("/api/beispiel/session?includeEnded=1")).status).toBe(404);
    expect((await app.request("/api/beispiel/session?includeEnded=0")).status).toBe(404);
  });
});

describe("degraded session files never hijack the active session", () => {
  test("an unparseable `started` with a non-date name is ignored (finding 4)", async () => {
    // `sessions/gestern abend.md`: neither the name nor `started` is a date,
    // so it has no place in the chronology — it used to win the raw STRING
    // sort forever and swallow every log line.
    await writeFile(
      absOf("sessions/gestern abend.md"),
      "---\nid: gestern abend\nstarted: gestern abend\nscenes_played: []\n---\n\n## Log\n",
      "utf8",
    );
    expect((await app.request("/api/beispiel/session")).status).toBe(404);
    expect((await post("/api/beispiel/log", { text: "x" })).status).toBe(404);
    // A real start works and IS the active session, despite the stray file.
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    const res = await app.request("/api/beispiel/session");
    expect(((await res.json()) as FileResponse).path).toBe("sessions/2026-08-19.md");
  });

  test("a non-date name with a parseable `started` still counts", async () => {
    await writeFile(
      absOf("sessions/notizen.md"),
      "---\nid: notizen\nstarted: 2026-08-19T20:00\nscenes_played: []\n---\n\n## Log\n",
      "utf8",
    );
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileResponse).path).toBe("sessions/notizen.md");
  });

  test("a blank `ended` means RUNNING and can be ended normally (finding 5)", async () => {
    await session("2026-08-19", 'started: 2026-08-19T20:00\nended: ""\nscenes_played: []\n');
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
