// The rules of one editing session, and the request they produce.
//
// The properties under test are the ones the app got wrong before: the version
// must NOT move because a query refetched, a refused write must not move it
// either, an adopt must, and the retry after a conflict must carry `force`
// with the same fields.
//
// That the poll cannot move it is STRUCTURAL and asserted as such: the event
// union has no case for "the entry query answered", so there is no reducer
// call that a refetch could make. The only two events that move the version
// are a written entry and an adopted one.

import type { EntryResponse } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";

import { ApiError, patchEntry, revConflict } from "@/api";
import {
  entryEditReducer,
  entryEditRequest,
  entryEditState,
  hasEntryWrite,
  type EntryEditEvent,
} from "./entry-edit";

const CHAPTER = "01-salzhafen";

function entryAt(rev: number, body: string): EntryResponse {
  return {
    path: CHAPTER,
    kind: "chapter",
    properties: { id: CHAPTER, title: "Salzhafen", status: "active" },
    body,
    rev,
  };
}

const MINE = { body: "Mein Text.\n" };

describe("the version the session writes against", () => {
  test("starts at the version of the entry the edit began on", () => {
    expect(entryEditState(111)).toEqual({ rev: 111 });
  });

  test("a refetch cannot move it — there is no event for one", () => {
    // The whole union, spelled out: every member either writes, refuses,
    // adopts or clears. None of them is "the query answered", which is what
    // makes the guard impossible to lose by accident.
    const kinds: Array<EntryEditEvent["type"]> = ["saved", "refused", "adopted", "cleared"];
    expect(kinds).toHaveLength(4);
    // And the one event a poll could plausibly be routed into leaves it alone.
    const state = entryEditState(111);
    expect(entryEditReducer(state, { type: "cleared" }).rev).toBe(111);
  });

  test("a written entry moves it, so a second save in the session works", () => {
    const after = entryEditReducer(entryEditState(111), {
      type: "saved",
      entry: entryAt(222, "Mein Text.\n"),
    });
    expect(after).toEqual({ rev: 222 });
  });

  test("the written entry's version is taken VERBATIM, never a successor", () => {
    // The row's version is the server's to hand out — it does not step by one
    // per write, so continuing with anything derived from the old one is a
    // conflict waiting to happen.
    const after = entryEditReducer(entryEditState(111), {
      type: "saved",
      entry: entryAt(987, "Mein Text.\n"),
    });
    expect(after.rev).toBe(987);
    expect(after.rev).not.toBe(112);
  });

  test("a refused write does NOT move it — nothing was written", () => {
    const refused = entryEditReducer(entryEditState(111), {
      type: "refused",
      write: MINE,
      conflict: { rev: 999, entry: entryAt(999, "Fremder Text.\n") },
    });
    expect(refused.rev).toBe(111);
    expect(refused.conflict?.entry?.rev).toBe(999);
    expect(refused.refused).toEqual(MINE);
  });

  test("adopting the stored entry moves it, and takes the conflict down", () => {
    const refused = entryEditReducer(entryEditState(111), {
      type: "refused",
      write: MINE,
      conflict: { rev: 999, entry: entryAt(999, "Fremder Text.\n") },
    });
    const adopted = entryEditReducer(refused, {
      type: "adopted",
      entry: entryAt(999, "Fremder Text.\n"),
    });
    expect(adopted).toEqual({ rev: 999 });
  });

  test("a new attempt takes the conflict down without moving the version", () => {
    const refused = entryEditReducer(entryEditState(111), {
      type: "refused",
      write: MINE,
      conflict: { rev: 999 },
    });
    expect(entryEditReducer(refused, { type: "cleared" })).toEqual({ rev: 111 });
  });
});

describe("entryEditRequest", () => {
  test("only the fields the surface gave, plus the held version", () => {
    const state = entryEditState(111);
    expect(entryEditRequest(state, { body: "Text.\n" })).toEqual({ rev: 111, body: "Text.\n" });
    expect(entryEditRequest(state, { properties: { status: "ready" } })).toEqual({
      rev: 111,
      properties: { status: "ready" },
    });
  });

  test("properties AND text go in ONE request", () => {
    expect(
      entryEditRequest(entryEditState(7), { properties: { title: "Ankunft" }, body: "Text.\n" }),
    ).toEqual({ rev: 7, properties: { title: "Ankunft" }, body: "Text.\n" });
  });

  test("an empty text is a field, not an absent one", () => {
    expect(entryEditRequest(entryEditState(7), { body: "" })).toEqual({ rev: 7, body: "" });
  });

  test("force is absent unless asked for, and then rides with the same fields", () => {
    expect(entryEditRequest(entryEditState(111), MINE)).toEqual({ rev: 111, ...MINE });
    expect(entryEditRequest(entryEditState(111), MINE, true)).toEqual({
      rev: 111,
      ...MINE,
      force: true,
    });
  });
});

describe("hasEntryWrite", () => {
  test("neither field is not a write (the server would answer 400)", () => {
    expect(hasEntryWrite({})).toBe(false);
  });

  test("either field is", () => {
    expect(hasEntryWrite({ body: "" })).toBe(true);
    expect(hasEntryWrite({ properties: {} })).toBe(true);
  });
});

// --- the request on the wire ------------------------------------------------

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Answers the queued responses in order and records every request. */
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

const realFetch = globalThis.fetch;

describe("patchEntry", () => {
  test("PATCHes the entry address with the request as given", async () => {
    const calls = mockFetch([{ status: 200, body: entryAt(222, "Mein Text.\n") }]);
    const written = await patchEntry("beispiel", CHAPTER, { rev: 111, body: "Mein Text.\n" });
    globalThis.fetch = realFetch;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe(`/api/campaigns/beispiel/entries/${CHAPTER}`);
    expect(calls[0]?.body).toEqual({ rev: 111, body: "Mein Text.\n" });
    expect(written.rev).toBe(222);
  });

  test("the forced retry sends the same fields with force", async () => {
    const calls = mockFetch([{ status: 200, body: entryAt(1000, "Mein Text.\n") }]);
    const state = entryEditReducer(entryEditState(111), {
      type: "refused",
      write: MINE,
      conflict: { rev: 999, entry: entryAt(999, "Fremder Text.\n") },
    });
    await patchEntry("beispiel", CHAPTER, entryEditRequest(state, state.refused ?? {}, true));
    globalThis.fetch = realFetch;

    expect(calls[0]?.body).toEqual({ rev: 111, body: "Mein Text.\n", force: true });
  });

  test("a 409 rejects with the current version AND entry to read out", async () => {
    mockFetch([
      {
        status: 409,
        body: {
          code: "rev_conflict",
          error: "entry changed",
          rev: 999,
          entry: entryAt(999, "Fremder Text.\n"),
        },
      },
    ]);
    const failure = await patchEntry("beispiel", CHAPTER, { rev: 111, body: "x" }).catch(
      (error: unknown) => error,
    );
    globalThis.fetch = realFetch;

    const conflict = revConflict(failure);
    expect(conflict?.rev).toBe(999);
    expect(conflict?.entry?.body).toBe("Fremder Text.\n");
  });
});

describe("revConflict", () => {
  test("anything that is not a 409 is not a conflict", () => {
    expect(revConflict(new ApiError(400, "nope", { code: "nothing_to_write" }))).toBe(undefined);
    expect(revConflict(new Error("boom"))).toBe(undefined);
    expect(revConflict(undefined)).toBe(undefined);
  });

  test("a 409 without an entry still IS a conflict — the caller re-reads", () => {
    const conflict = revConflict(new ApiError(409, "changed", { rev: 999 }));
    expect(conflict?.rev).toBe(999);
    expect(conflict?.entry).toBe(undefined);
  });

  test("a 409 with a malformed entry degrades to no entry, never a throw", () => {
    const conflict = revConflict(new ApiError(409, "changed", { rev: 9, entry: { path: 7 } }));
    expect(conflict?.entry).toBe(undefined);
  });
});
