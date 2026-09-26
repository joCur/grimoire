// The thread resource (decisions/resources): `GET/POST …/threads`, `GET/PATCH/DELETE
// …/threads/:id`, every field of a thread flat — `{ id, chapter, text, done,
// rev }` — and every write checked against the thread's schema.
//
// Three things below are watched hardest, because each is easy to get wrong:
//
//   * no thread write touches the CHAPTER — its body stays byte for byte and
//     its `rev` does not move, so an open chapter editor is not dragged into
//     a conflict by the review;
//   * every thread has its own guard: a stale `rev` is a 409 that carries the
//     current thread, and a write of one thread leaves another one's `rev`
//     where it was;
//   * the address a chapter's threads once had under the chapter names
//     nothing.
//
// One fresh database per case, seeded from the committed fixtures
// (test/support/store.ts); the example campaign brings one open thread.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Chapter } from "@grimoire/shared/chapter";
import type { Thread } from "@grimoire/shared/thread";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";

const CAMPAIGN = "beispiel";
const CHAPTER = "01-salzhafen";
const THREADS = `/api/campaigns/${CAMPAIGN}/threads`;
const SEEDED: Thread = {
  id: "wer-bezahlt-die-schmuggler",
  chapter: CHAPTER,
  text: "Wer bezahlt die Schmuggler?",
  done: false,
  rev: 1,
};
const { rev: _rev, ...SEEDED_FIXTURE } = SEEDED;
const SEEDED_URL = `${THREADS}/${SEEDED.id}`;
const CHAPTER_URL = `/api/campaigns/${CAMPAIGN}/chapters/${CHAPTER}`;

async function send(method: string, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json<T>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const answer = await res;
  expect(answer.status).toBe(status);
  return (await answer.json()) as T;
}

const readThread = (url = SEEDED_URL) => json<Thread>(app.request(url));
const listThreads = (query = "") => json<Thread[]>(app.request(`${THREADS}${query}`));
const createThread = (body: unknown) => send("POST", THREADS, body);
const patchThread = (body: unknown, url = SEEDED_URL) => send("PATCH", url, body);
const deleteThread = (body: unknown, url = SEEDED_URL) => send("DELETE", url, body);
const readChapter = () => json<Chapter>(app.request(CHAPTER_URL));

async function newChapter(title: string): Promise<string> {
  return (await json<Chapter>(send("POST", `/api/campaigns/${CAMPAIGN}/chapters`, { title }), 201))
    .id;
}

async function version(): Promise<number> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/version`);
  return ((await res.json()) as { version: number }).version;
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("reading threads", () => {
  test("GET answers every field flat — no kind, no path, no list around it", async () => {
    expect(await readThread()).toEqual(SEEDED);
  });

  test("the list answers every thread of the campaign, ?chapter= those of one chapter", async () => {
    const other = await newChapter("Zwei");
    const foreign = await json<Thread>(createThread({ chapter: other, text: "Fremder Faden" }), 201);
    expect(await listThreads()).toEqual([SEEDED, foreign]);
    expect(await listThreads(`?chapter=${CHAPTER}`)).toEqual([SEEDED]);
    expect(await listThreads(`?chapter=${other}`)).toEqual([foreign]);
    // A filter names no resource: a chapter without threads, or none at all,
    // is an empty list.
    expect(await listThreads("?chapter=99-nix")).toEqual([]);
  });

  test("404 for an unknown thread or campaign", async () => {
    expect((await app.request(`${THREADS}/no-such-id`)).status).toBe(404);
    expect((await app.request("/api/campaigns/nope/threads")).status).toBe(404);
  });

  test("the address under the chapter names nothing", async () => {
    expect((await app.request(`${CHAPTER_URL}/threads`)).status).toBe(404);
    expect((await send("POST", `${CHAPTER_URL}/threads`, { text: "x" })).status).toBe(404);
    expect((await listThreads()).length).toBe(1);
  });
});

describe("creating a thread", () => {
  test("a new thread is open, stands at the end, and the chapter stays untouched", async () => {
    const before = await readChapter();
    const beforeVersion = await version();
    const created = await json<Thread>(
      createThread({ chapter: CHAPTER, text: "Lichter in der Bucht untersuchen" }),
      201,
    );
    expect(created).toEqual({
      id: expect.any(String),
      chapter: CHAPTER,
      text: "Lichter in der Bucht untersuchen",
      done: false,
      rev: 1,
    });
    expect(created.id).not.toBe(SEEDED.id);
    expect(await listThreads(`?chapter=${CHAPTER}`)).toEqual([SEEDED, created]);
    expect(await readThread(`${THREADS}/${created.id}`)).toEqual(created);
    // The chapter did not move: text byte for byte, and its guard.
    const after = await readChapter();
    expect(after.body).toBe(before.body);
    expect(after.rev).toBe(before.rev);
    // …and it is a write like any other for the version poll.
    expect(await version()).toBeGreaterThan(beforeVersion);
  });

  test("needs no rev, and leaves the other threads' guards where they were", async () => {
    await json<Thread>(createThread({ chapter: CHAPTER, text: "Noch ein Faden" }), 201);
    expect((await readThread()).rev).toBe(1);
  });

  test("the text is one line: trimmed, inner newlines folded", async () => {
    const created = await json<Thread>(
      createThread({ chapter: CHAPTER, text: "  Zeile eins\n  Zeile zwei  " }),
      201,
    );
    expect(created.text).toBe("Zeile eins Zeile zwei");
  });

  test("400 for empty or missing text, a missing chapter and an unknown key — naming it", async () => {
    expect((await createThread({ chapter: CHAPTER, text: "   " })).status).toBe(400);
    expect((await createThread({ chapter: CHAPTER })).status).toBe(400);
    expect((await createThread({ text: "x" })).status).toBe(400);
    expect((await createThread({ chapter: CHAPTER, text: 42 })).status).toBe(400);
    const unknown = await createThread({ chapter: CHAPTER, text: "x", done: true });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toContain("done");
    expect(await listThreads()).toEqual([SEEDED]);
  });

  test("400 chapter_unknown for a chapter the campaign does not have — naming creates nothing", async () => {
    const res = await createThread({ chapter: "99-nix", text: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "chapter_unknown", value: "99-nix" });
    expect((await app.request(`/api/campaigns/${CAMPAIGN}/chapters/99-nix`)).status).toBe(404);
  });
});

describe("writing a thread", () => {
  test("ticks, unticks, rewords; each write moves the thread's own rev", async () => {
    const before = await readChapter();
    const ticked = await json<Thread>(patchThread({ rev: 1, done: true }));
    expect(ticked).toEqual({ ...SEEDED, done: true, rev: 2 });
    const reworded = await json<Thread>(patchThread({ rev: 2, text: " Wer zahlt?\n wirklich " }));
    expect(reworded).toEqual({ ...SEEDED, text: "Wer zahlt? wirklich", done: true, rev: 3 });
    const both = await json<Thread>(patchThread({ rev: 3, done: false, text: "Wer zahlt?" }));
    expect(both).toEqual({ ...SEEDED, text: "Wer zahlt?", rev: 4 });
    expect(await readThread()).toEqual(both);
    const after = await readChapter();
    expect(after.body).toBe(before.body);
    expect(after.rev).toBe(before.rev);
  });

  test("moves to another chapter: the chapter is a field, the URL stays", async () => {
    const other = await newChapter("Zwei");
    const moved = await json<Thread>(patchThread({ rev: 1, chapter: other }));
    expect(moved).toEqual({ ...SEEDED, chapter: other, rev: 2 });
    expect(await listThreads(`?chapter=${CHAPTER}`)).toEqual([]);
    expect(await listThreads(`?chapter=${other}`)).toEqual([moved]);
    const unknown = await patchThread({ rev: 2, chapter: "99-nix" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: "chapter_unknown" });
  });

  test("a stale rev is 409 with the current thread and writes nothing; force writes on top", async () => {
    await json<Thread>(patchThread({ rev: 1, text: "Umformuliert" }));
    const stale = await patchThread({ rev: 1, done: true });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "rev_conflict",
      rev: 2,
      thread: { ...SEEDED, text: "Umformuliert", rev: 2 },
    });
    expect((await readThread()).done).toBe(false);
    // `force` writes only what it carries: the text changed in between stays.
    const forced = await json<Thread>(patchThread({ rev: 1, force: true, done: true }));
    expect(forced).toEqual({ ...SEEDED, text: "Umformuliert", done: true, rev: 3 });
  });

  test("a write of one thread leaves another one's rev alone", async () => {
    const second = await json<Thread>(createThread({ chapter: CHAPTER, text: "Zweiter" }), 201);
    await json<Thread>(patchThread({ rev: 1, done: true }));
    // The tick prepared against the second thread before still goes through.
    expect(await json<Thread>(patchThread({ rev: 1, done: true }, `${THREADS}/${second.id}`))).toEqual({
      ...second,
      done: true,
      rev: 2,
    });
  });

  test("400 for a missing rev, nothing to write, a wrong value or an unknown key", async () => {
    expect((await patchThread({ done: true })).status).toBe(400);
    const nothing = await patchThread({ rev: 1 });
    expect(nothing.status).toBe(400);
    expect(await nothing.json()).toMatchObject({ code: "nothing_to_write" });
    expect((await patchThread({ rev: 1, done: "ja" })).status).toBe(400);
    expect((await patchThread({ rev: 1, text: "  " })).status).toBe(400);
    const unknown = await patchThread({ rev: 1, done: true, pos: 3 });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toContain("pos");
    expect((await patchThread({ rev: 1, id: "anders" })).status).toBe(400);
    expect(await readThread()).toEqual(SEEDED);
  });

  test("404 for an unknown thread", async () => {
    expect((await patchThread({ rev: 1, done: true }, `${THREADS}/no-such-id`)).status).toBe(404);
  });
});

describe("deleting a thread", () => {
  test("removes the one thread, 204", async () => {
    const second = await json<Thread>(createThread({ chapter: CHAPTER, text: "Bleibt" }), 201);
    const res = await deleteThread({ rev: 1 });
    expect(res.status).toBe(204);
    expect(await listThreads()).toEqual([second]);
    expect((await app.request(SEEDED_URL)).status).toBe(404);
  });

  test("409 with the current thread for a stale rev, 404 for an unknown id, 400 without a rev", async () => {
    await json<Thread>(patchThread({ rev: 1, done: true }));
    const stale = await deleteThread({ rev: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "rev_conflict", thread: { rev: 2 } });
    expect((await deleteThread({ rev: 1 }, `${THREADS}/no-such-id`)).status).toBe(404);
    expect((await deleteThread({})).status).toBe(400);
    expect((await listThreads()).length).toBe(1);
  });
});

describe("the chapter and its threads keep their own guards", () => {
  test("a chapter text save does not move a thread's rev", async () => {
    const before = await readChapter();
    const res = await send("PATCH", CHAPTER_URL, {
      rev: before.rev,
      body: `${before.body}\nNeuer Absatz.\n`,
    });
    expect(res.status).toBe(200);
    expect(await json<Thread>(patchThread({ rev: 1, done: true }))).toMatchObject({ rev: 2 });
  });
});

describe("the seed", () => {
  test("a fixture thread naming a chapter the campaign does not have is refused", async () => {
    await expect(
      seedStore({ threads: [{ ...SEEDED_FIXTURE, id: "verwaist", chapter: "99-nix" }] }),
    ).rejects.toThrow();
  });
});
