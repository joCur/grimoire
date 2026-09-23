// A chapter's open threads: the list under
// /api/campaigns/:campaign/chapters/:chapter/threads.
//
// The threads are a LIST (ADR #26, #29): rows with a stable id, answered with
// the list's own guard token and never as a checklist in the chapter's text.
// Three things below are watched hardest, because each is easy to get wrong:
//
//   * no thread write touches the chapter ENTRY — its body stays byte for
//     byte and its `rev` does not move, so an open chapter editor is not
//     dragged into a conflict by the review;
//   * a stale list token is a 409 that carries the current list, and it wins
//     over an unknown id — the caller looking at an old list gets the new one;
//   * an id the chapter's list does not hold is a 404, never a 200 that
//     changed nothing.
//
// One fresh database per case, seeded from the committed fixtures
// (test/support/store.ts); the example chapter brings one open thread.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignTree, EntryResponse, ThreadsResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { asSeedEntry } from "../src/db/seed";
import { getDb } from "../src/store/handle";
import { insertThreadRows } from "../src/store/threads";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

const CAMPAIGN = "beispiel";
const CHAPTER = "01-salzhafen";
const SEEDED = "Wer bezahlt die Schmuggler?";

function threadsUrl(chapter = CHAPTER, campaign = CAMPAIGN): string {
  return `/api/campaigns/${campaign}/chapters/${chapter}/threads`;
}

async function send(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  body: unknown,
): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function ok(res: Response | Promise<Response>): Promise<ThreadsResponse> {
  const answer = await res;
  expect(answer.status).toBe(200);
  return (await answer.json()) as ThreadsResponse;
}

async function readThreads(chapter = CHAPTER): Promise<ThreadsResponse> {
  return ok(app.request(threadsUrl(chapter)));
}

async function append(text: unknown, chapter = CHAPTER): Promise<Response> {
  return send("POST", threadsUrl(chapter), { text });
}

async function patch(id: string, body: Record<string, unknown>, chapter = CHAPTER) {
  return send("PATCH", `${threadsUrl(chapter)}/${encodeURIComponent(id)}`, body);
}

async function remove(id: string, body: Record<string, unknown>, chapter = CHAPTER) {
  return send("DELETE", `${threadsUrl(chapter)}/${encodeURIComponent(id)}`, body);
}

async function chapterEntry(): Promise<EntryResponse> {
  const res = await app.request(entriesUrl(CAMPAIGN, CHAPTER));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function version(): Promise<number> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/version`);
  return ((await res.json()) as { version: number }).version;
}

/** The id of the seeded thread — handed out by the store, so read, never spelled. */
async function seededId(): Promise<string> {
  const list = await readThreads();
  const row = list.entries.find((entry) => entry.text === SEEDED);
  expect(row).toBeDefined();
  return row!.id;
}

beforeEach(async () => {
  await seedStore();
});

afterAll(() => {
  dropStore();
});

describe("GET …/chapters/:chapter/threads", () => {
  test("the seeded thread is a row, and the chapter text holds no checklist", async () => {
    const list = await readThreads();
    expect(list.rev).toBe(1);
    expect(list.entries).toEqual([{ id: expect.any(String), text: SEEDED, done: false }]);
    expect(list.entries[0]!.id).not.toBe("");
    // The fixture's text is the chapter's description and nothing else: the
    // thread moved out.
    expect((await chapterEntry()).body).not.toContain("Offene Fäden");
  });

  test("a chapter without threads answers an empty list, not a 404", async () => {
    const created = await send("POST", `/api/campaigns/${CAMPAIGN}/chapters`, { title: "Leer" });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as EntryResponse).path;
    expect(await readThreads(id)).toEqual({ entries: [], rev: 1 });
  });

  test("404 for an unknown chapter or campaign, 400 for an unsafe chapter id", async () => {
    expect((await app.request(threadsUrl("99-nix"))).status).toBe(404);
    expect((await app.request(threadsUrl("npcs"))).status).toBe(404);
    expect((await app.request(threadsUrl(CHAPTER, "nope"))).status).toBe(404);
    expect((await app.request(threadsUrl(".hidden"))).status).toBe(400);
  });
});

describe("POST …/chapters/:chapter/threads", () => {
  test("appends a row at the end and leaves the chapter entry untouched", async () => {
    const before = await chapterEntry();
    const beforeVersion = await version();
    const list = await ok(append("Lichter in der Bucht untersuchen"));

    expect(list.rev).toBe(2);
    expect(list.entries.map((entry) => [entry.text, entry.done])).toEqual([
      [SEEDED, false],
      ["Lichter in der Bucht untersuchen", false],
    ]);
    // Two rows, two ids.
    expect(new Set(list.entries.map((entry) => entry.id)).size).toBe(2);
    // The chapter ENTRY did not move: text byte for byte, and its guard.
    const after = await chapterEntry();
    expect(after.body).toBe(before.body);
    expect(after.rev).toBe(before.rev);
    // …and it is a write like any other for the version poll.
    expect(await version()).toBeGreaterThan(beforeVersion);
    // What the POST answered is what a read answers.
    expect(await readThreads()).toEqual(list);
  });

  test("needs no rev: an append after another write still lands", async () => {
    await ok(patch(await seededId(), { rev: 1, done: true }));
    // The list moved to rev 2 behind this caller's back — an append does not care.
    const list = await ok(append("Noch ein Faden"));
    expect(list.rev).toBe(3);
    expect(list.entries.at(-1)!.text).toBe("Noch ein Faden");
  });

  test("the text is one line: trimmed, inner newlines folded", async () => {
    const list = await ok(append("  Zeile eins\n  Zeile zwei  "));
    expect(list.entries.at(-1)!.text).toBe("Zeile eins Zeile zwei");
  });

  test("400 for empty, missing or non-string text and for unknown keys", async () => {
    expect((await append("   ")).status).toBe(400);
    expect((await send("POST", threadsUrl(), {})).status).toBe(400);
    expect((await append(42)).status).toBe(400);
    expect((await send("POST", threadsUrl(), { text: "x", rev: 1 })).status).toBe(400);
    expect((await readThreads()).entries).toHaveLength(1);
  });

  test("404 for an unknown chapter — a mention creates no chapter", async () => {
    expect((await append("x", "99-nix")).status).toBe(404);
    expect((await append("x", "npcs")).status).toBe(404);
    const tree = (await (
      await app.request(`/api/campaigns/${CAMPAIGN}/tree`)
    ).json()) as CampaignTree;
    expect(tree.chapters.map((chapter) => chapter.id)).toEqual([CHAPTER]);
  });
});

describe("PATCH …/chapters/:chapter/threads/:id", () => {
  test("ticks, unticks and rewords one row; the chapter entry stays as it was", async () => {
    const before = await chapterEntry();
    const id = await seededId();

    const ticked = await ok(patch(id, { rev: 1, done: true }));
    expect(ticked).toEqual({ entries: [{ id, text: SEEDED, done: true }], rev: 2 });

    const reworded = await ok(patch(id, { rev: 2, text: "Wer zahlt wirklich?" }));
    expect(reworded).toEqual({ entries: [{ id, text: "Wer zahlt wirklich?", done: true }], rev: 3 });

    const both = await ok(patch(id, { rev: 3, done: false, text: " Wer zahlt?\n " }));
    expect(both).toEqual({ entries: [{ id, text: "Wer zahlt?", done: false }], rev: 4 });

    const after = await chapterEntry();
    expect(after.body).toBe(before.body);
    expect(after.rev).toBe(before.rev);
  });

  test("a patch that changes nothing writes nothing — the token stands", async () => {
    const id = await seededId();
    await ok(patch(id, { rev: 1, done: true }));
    expect(await ok(patch(id, { rev: 2, done: true }))).toMatchObject({ rev: 2 });
    expect(await ok(patch(id, { rev: 2, text: SEEDED }))).toMatchObject({ rev: 2 });
  });

  test("a stale rev is 409 with the current list, and nothing is written", async () => {
    const id = await seededId();
    await ok(append("Zweiter Faden")); // the list is at rev 2 now
    const res = await patch(id, { rev: 1, done: true });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("rev_conflict");
    expect(body.rev).toBe(2);
    expect(body.threads).toEqual(await readThreads());
    expect((await readThreads()).entries.every((entry) => !entry.done)).toBe(true);
  });

  test("the stale token wins over an unknown id", async () => {
    await ok(append("Zweiter Faden"));
    expect((await patch("no-such-id", { rev: 1, done: true })).status).toBe(409);
  });

  test("404 for an id the chapter's list does not hold, never a quiet 200", async () => {
    expect((await patch("no-such-id", { rev: 1, done: true })).status).toBe(404);
    // A row of ANOTHER chapter is not a row of this one.
    const created = await send("POST", `/api/campaigns/${CAMPAIGN}/chapters`, { title: "Zwei" });
    const other = ((await created.json()) as EntryResponse).path;
    const foreign = (await ok(append("Fremder Faden", other))).entries[0]!.id;
    expect((await patch(foreign, { rev: 1, done: true })).status).toBe(404);
    expect((await readThreads()).rev).toBe(1);
  });

  test("400 for a missing rev, nothing to write, a non-boolean done or empty text", async () => {
    const id = await seededId();
    expect((await patch(id, { done: true })).status).toBe(400);
    const nothing = await patch(id, { rev: 1 });
    expect(nothing.status).toBe(400);
    expect(((await nothing.json()) as { code?: string }).code).toBe("nothing_to_write");
    expect((await patch(id, { rev: 1, done: "ja" })).status).toBe(400);
    expect((await patch(id, { rev: 1, text: "  " })).status).toBe(400);
    expect((await patch(id, { rev: 1, done: true, pos: 3 })).status).toBe(400);
    expect(await readThreads()).toMatchObject({ rev: 1, entries: [{ done: false }] });
  });

  test("404 for an unknown chapter", async () => {
    expect((await patch("x", { rev: 1, done: true }, "99-nix")).status).toBe(404);
  });
});

describe("DELETE …/chapters/:chapter/threads/:id", () => {
  test("removes one row and answers the rest", async () => {
    const id = await seededId();
    const second = (await ok(append("Bleibt"))).entries[1]!.id;
    const list = await ok(remove(id, { rev: 2 }));
    expect(list).toEqual({ entries: [{ id: second, text: "Bleibt", done: false }], rev: 3 });
  });

  test("409 with the current list for a stale rev, then 404 for an unknown id", async () => {
    const id = await seededId();
    await ok(append("Zweiter Faden"));
    const stale = await remove(id, { rev: 1 });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { threads: ThreadsResponse }).threads.entries).toHaveLength(2);
    expect((await remove("no-such-id", { rev: 2 })).status).toBe(404);
    expect((await readThreads()).entries).toHaveLength(2);
  });

  test("400 without a rev", async () => {
    expect((await remove(await seededId(), {})).status).toBe(400);
  });
});

describe("the chapter entry and the thread list keep their own guards", () => {
  test("a chapter text save does not move the list's token", async () => {
    const before = await chapterEntry();
    const res = await app.request(entriesUrl(CAMPAIGN, CHAPTER), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: before.rev, body: `${before.body}\nNeuer Absatz.\n` }),
    });
    expect(res.status).toBe(200);
    // The tick prepared against the list before the save still goes through.
    expect(await ok(patch(await seededId(), { rev: 1, done: true }))).toMatchObject({ rev: 2 });
  });
});

describe("storage", () => {
  test("the database refuses a thread whose chapter does not exist", async () => {
    const db = await getDb();
    expect(() => insertThreadRows(db, CAMPAIGN, "99-nix", [{ text: "x" }])).toThrow();
    expect((await readThreads()).entries).toHaveLength(1);
  });

  test("the seed reads a chapter's threads as rows and refuses a malformed one", () => {
    const chapter = {
      kind: "chapter",
      properties: { id: "02-bucht", title: "Bucht" },
      body: "",
      threads: [{ text: "Offen" }, { text: "Erledigt", done: true }],
    };
    expect(asSeedEntry("chapter-02", chapter)).toMatchObject({
      threads: [{ text: "Offen" }, { text: "Erledigt", done: true }],
    });
    expect(() => asSeedEntry("chapter-02", { ...chapter, threads: "x" })).toThrow();
    expect(() => asSeedEntry("chapter-02", { ...chapter, threads: [{ done: true }] })).toThrow();
  });
});
