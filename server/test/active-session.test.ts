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
import { pickActiveSession } from "../src/campaign-fs";
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

  test("a session started today wins over an older open one", async () => {
    await session("2026-08-18", "started: 2026-08-18T22:30\nscenes_played: []\n");
    expect((await post("/api/beispiel/session/start")).status).toBe(200);
    const res = await post("/api/beispiel/log", { text: "Heute" });
    expect(((await res.json()) as FileResponse).path).toBe("sessions/2026-08-19.md");
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
