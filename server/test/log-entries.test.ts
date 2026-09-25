// The log entry resource: a quick note taken with POST, reviewed with PATCH,
// each entry with its own id and rev under its session.
//
// The log is append-only and COLUMNS only — time, scene and text —, and the
// note's scene is a reference. No log write moves the session's `rev`. Every
// case runs against its own in-memory database seeded from the committed
// fixtures, with the system clock faked.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import type { LogEntry } from "@grimoire/shared/log-entry";
import type { Session } from "@grimoire/shared/session";
import { logLineId } from "../src/store/log-entries";
import { dropStore, seedStore } from "./support/store";
import {
  FIXTURE_SESSION,
  SESSIONS,
  endSession,
  readSession,
  send,
  startSession,
} from "./support/sessions";

let session: Session;

function logUrl(sessionId = session.id): string {
  return `${SESSIONS}/${sessionId}/log`;
}

/** Take a note at `at`; it has to be taken. */
async function note(body: { text: string; sceneId?: string }, at: Date): Promise<LogEntry> {
  setSystemTime(at);
  const res = await send("POST", logUrl(), body);
  expect(res.status).toBe(201);
  return (await res.json()) as LogEntry;
}

beforeEach(async () => {
  setSystemTime(new Date(2026, 7, 19, 21, 5));
  await seedStore();
  session = await startSession();
});

afterEach(() => {
  setSystemTime();
  dropStore();
});

describe("taking a note — POST …/sessions/:id/log", () => {
  test("one entry: time, scene and text as fields, with an id of its own, 201", async () => {
    const entry = await note(
      { text: "Spuren am Strand #thread", sceneId: "lighthouse-arrival" },
      new Date(2026, 7, 19, 21, 12),
    );
    // The hashtag stays INSIDE the text: the note travels as the DM typed it.
    expect(entry).toEqual({
      id: expect.any(String),
      at: "21:12",
      sceneId: "lighthouse-arrival",
      text: "Spuren am Strand #thread",
      reviewed: false,
      rev: 1,
    });
    const read = await readSession(session.id);
    expect(read.log).toEqual([entry]);
    expect(read.rev).toBe(session.rev);
  });

  test("entries append in the order they were taken; no scene leaves the field out", async () => {
    await note({ text: "Ankunft", sceneId: "lighthouse-arrival" }, new Date(2026, 7, 19, 21, 12));
    await note({ text: "Pause" }, new Date(2026, 7, 19, 21, 20));
    await note({ text: "Leer", sceneId: "" }, new Date(2026, 7, 19, 21, 21));
    expect((await readSession(session.id)).log.map((l) => [l.at, l.sceneId, l.text])).toEqual([
      ["21:12", "lighthouse-arrival", "Ankunft"],
      ["21:20", undefined, "Pause"],
      ["21:21", undefined, "Leer"],
    ]);
  });

  test("a note plays no scene: the played scenes have their own resource", async () => {
    await note({ text: "Ankunft", sceneId: "lighthouse-arrival" }, new Date(2026, 7, 19, 21, 12));
    expect((await readSession(session.id)).playedScenes).toEqual([]);
  });

  test("a multi-line note becomes one line; an empty one is a 400", async () => {
    const entry = await note({ text: "  Zeile eins\n   Zeile zwei  " }, new Date(2026, 7, 19, 21, 25));
    expect(entry.text).toBe("Zeile eins Zeile zwei");
    for (const body of [{ text: "" }, { text: "   \n " }, {}, { text: 42 }]) {
      expect((await send("POST", logUrl(), body)).status).toBe(400);
    }
    expect((await readSession(session.id)).log).toHaveLength(1);
  });

  test("400 for a key the note does not take", async () => {
    const res = await send("POST", logUrl(), { text: "x", reviewed: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("reviewed");
  });

  test("a scene that does not exist is 400 log_scene_unknown, and nothing is taken", async () => {
    const res = await send("POST", logUrl(), { text: "Etwas passiert", sceneId: "gibt-es-nicht" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "log_scene_unknown", value: "gibt-es-nicht" });
    expect((await readSession(session.id)).log).toEqual([]);
  });

  test("a sceneId outside the slug shape is a 400, and nothing is taken", async () => {
    for (const sceneId of ["boom) und mehr", "a b", "Gross", "with/slash", "-lead"]) {
      expect((await send("POST", logUrl(), { text: "Notiz", sceneId })).status).toBe(400);
    }
    expect((await readSession(session.id)).log).toEqual([]);
  });

  test("parentheses in the note are text, and name no scene", async () => {
    const entry = await note({ text: "(vermutlich) der Turmwärter lügt" }, new Date(2026, 7, 19, 21, 30));
    expect([entry.text, entry.sceneId]).toEqual(["(vermutlich) der Turmwärter lügt", undefined]);
  });

  test("a session past midnight takes the note in its own log", async () => {
    expect((await send("DELETE", `${SESSIONS}/${session.id}`, { rev: session.rev })).status).toBe(204);
    setSystemTime(new Date(2026, 7, 18, 22, 30));
    session = await startSession();
    const entry = await note({ text: "Nach Mitternacht weiter" }, new Date(2026, 7, 19, 1, 20));
    expect(entry.at).toBe("01:20");
    expect((await readSession(session.id)).log).toEqual([entry]);
  });

  test("409 session_ended once the session is ended — no note in a closed log", async () => {
    await endSession(session.id);
    const res = await send("POST", logUrl(), { text: "zu spät" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_ended",
      id: session.id,
    });
    expect((await readSession(session.id)).log).toEqual([]);
  });

  test("404 for an unknown session or campaign", async () => {
    expect((await send("POST", logUrl("gibt-es-nicht"), { text: "x" })).status).toBe(404);
    expect(
      (await send("POST", `/api/campaigns/nope/sessions/${session.id}/log`, { text: "x" })).status,
    ).toBe(404);
  });

  test("the row's hash is the short sha256 of its canonical line", () => {
    const sha8 = (value: string) =>
      createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
    expect(logLineId("19:52", "arrival", "Spuren gefunden")).toBe(
      sha8("- 19:52 (arrival) Spuren gefunden"),
    );
    expect(logLineId(null, null, "Spuren")).toBe(sha8("- Spuren"));
  });
});

describe("reviewing a note — PATCH …/log/:id", () => {
  test("`reviewed` marks one entry; nothing else moves", async () => {
    const before = await readSession(FIXTURE_SESSION);
    const [first, second] = before.log;
    const res = await send("PATCH", `${logUrl(FIXTURE_SESSION)}/${first!.id}`, {
      rev: first!.rev,
      reviewed: true,
    });
    expect(res.status).toBe(200);
    const reviewed = (await res.json()) as LogEntry;
    expect(reviewed).toEqual({ ...first!, reviewed: true, rev: first!.rev + 1 });
    const after = await readSession(FIXTURE_SESSION);
    expect(after.log).toEqual([reviewed, ...before.log.slice(1)]);
    expect(after.log[1]).toEqual(second);
    expect(after.rev).toBe(before.rev);
  });

  test("the text is written once — 400 for `text`, nothing written", async () => {
    const [first] = (await readSession(FIXTURE_SESSION)).log;
    const res = await send("PATCH", `${logUrl(FIXTURE_SESSION)}/${first!.id}`, {
      rev: first!.rev,
      text: "anders",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("text");
    expect((await readSession(FIXTURE_SESSION)).log[0]).toEqual(first);
  });

  test("naming no field is 400 nothing_to_write", async () => {
    const [first] = (await readSession(FIXTURE_SESSION)).log;
    const res = await send("PATCH", `${logUrl(FIXTURE_SESSION)}/${first!.id}`, { rev: first!.rev });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "nothing_to_write" });
  });

  test("a stale rev is 409 with the current entry; force writes on top of it", async () => {
    const [first] = (await readSession(FIXTURE_SESSION)).log;
    const url = `${logUrl(FIXTURE_SESSION)}/${first!.id}`;
    const stale = await send("PATCH", url, { rev: first!.rev + 1, reviewed: true });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: expect.any(String),
      code: "rev_conflict",
      rev: first!.rev,
      logEntry: first,
    });
    const forced = await send("PATCH", url, { rev: first!.rev + 1, force: true, reviewed: true });
    expect(forced.status).toBe(200);
    expect(((await forced.json()) as LogEntry).reviewed).toBe(true);
  });

  test("404 for an entry the session does not have, and for an unknown session", async () => {
    expect(
      (await send("PATCH", `${logUrl(FIXTURE_SESSION)}/deadbeef`, { rev: 1, reviewed: true })).status,
    ).toBe(404);
    // An entry is named under its own session only.
    expect(
      (await send("PATCH", `${logUrl()}/spuren-gefunden`, { rev: 1, reviewed: true })).status,
    ).toBe(404);
    expect(
      (await send("PATCH", `${logUrl("gibt-es-nicht")}/spuren-gefunden`, { rev: 1, reviewed: true }))
        .status,
    ).toBe(404);
  });
});
