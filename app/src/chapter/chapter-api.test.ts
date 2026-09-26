// The chapter's client against its own resource: the write goes to
// `…/chapters/:id` with the request as given, making a chapter active is that
// same write, and a 409 is read out as the version and the chapter the server
// answered with.

import type { Chapter } from "@grimoire/shared/chapter";
import { afterEach, describe, expect, test } from "bun:test";

import { ApiError } from "@/api";

import { chapterConflict, createChapter, patchChapter } from "./chapter-api";

const CHAPTER = "01-salzhafen";

function chapterAt(rev: number, body: string): Chapter {
  return { id: CHAPTER, title: "Salzhafen", status: "active", body, rev };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer the next requests in order and record what was sent. */
function mockFetch(answers: Array<{ status: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const answer = answers.shift() ?? { status: 500, body: { error: "no answer queued" } };
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

describe("patchChapter", () => {
  test("PATCHes the chapter's own resource with the request as given", async () => {
    const calls = mockFetch([{ status: 200, body: chapterAt(222, "Mein Text.\n") }]);
    const written = await patchChapter("beispiel", CHAPTER, { rev: 111, body: "Mein Text.\n" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe(`/api/campaigns/beispiel/chapters/${CHAPTER}`);
    expect(calls[0]?.body).toEqual({ rev: 111, body: "Mein Text.\n" });
    expect(written.rev).toBe(222);
  });

  test("making a chapter active is the same write, with its rev", async () => {
    const calls = mockFetch([{ status: 200, body: chapterAt(5, "") }]);
    await patchChapter("beispiel", "02-bucht", { rev: 4, status: "active" });

    expect(calls[0]?.url).toBe("/api/campaigns/beispiel/chapters/02-bucht");
    expect(calls[0]?.body).toEqual({ rev: 4, status: "active" });
  });

  test("a 409 rejects with the current version AND chapter to read out", async () => {
    mockFetch([
      {
        status: 409,
        body: {
          code: "rev_conflict",
          error: "chapter changed",
          rev: 999,
          chapter: chapterAt(999, "Fremder Text.\n"),
        },
      },
    ]);
    const failure = await patchChapter("beispiel", CHAPTER, { rev: 111, body: "x" }).catch(
      (error: unknown) => error,
    );

    const conflict = chapterConflict(failure);
    expect(conflict?.rev).toBe(999);
    expect(conflict?.chapter?.body).toBe("Fremder Text.\n");
  });
});

describe("chapterConflict", () => {
  test("anything that is not a 409 is not a conflict", () => {
    expect(chapterConflict(new ApiError(400, "nope", { code: "nothing_to_write" }))).toBe(undefined);
    expect(chapterConflict(new Error("boom"))).toBe(undefined);
    expect(chapterConflict(undefined)).toBe(undefined);
  });

  test("a 409 without a chapter still IS a conflict — the caller re-reads", () => {
    const conflict = chapterConflict(new ApiError(409, "changed", { rev: 999 }));
    expect(conflict?.rev).toBe(999);
    expect(conflict?.chapter).toBe(undefined);
  });

  test("a 409 with a malformed chapter degrades to no chapter, never a throw", () => {
    const conflict = chapterConflict(new ApiError(409, "changed", { rev: 9, chapter: { id: 7 } }));
    expect(conflict?.chapter).toBe(undefined);
  });
});

describe("createChapter", () => {
  test("POSTs the title, the text and the id the DM set", async () => {
    const calls = mockFetch([{ status: 201, body: chapterAt(1, "Ankommen.\n") }]);
    await createChapter("beispiel", { title: "Salzhafen", body: "Ankommen.", id: CHAPTER });

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("/api/campaigns/beispiel/chapters");
    expect(calls[0]?.body).toEqual({ title: "Salzhafen", body: "Ankommen.", id: CHAPTER });
  });

  test("leaves out what the dialog left empty", async () => {
    const calls = mockFetch([{ status: 201, body: chapterAt(1, "") }]);
    await createChapter("beispiel", { title: "Salzhafen" });
    expect(calls[0]?.body).toEqual({ title: "Salzhafen" });
  });
});
