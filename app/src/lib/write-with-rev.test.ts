// Issue #38: the rev protocol of ADR #4 has exactly one implementation, so
// it is tested exactly once here — with plain stub functions, no fetch, no
// react. The three per-path suites (scene-status, entry-body, campaign-meta)
// then only have to show that they wire the right request into it.

import type { EntryResponse } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { isStaleEntryError, withRev, writeWithRev } from "./write-with-rev";

function entryAt(rev: number): EntryResponse {
  return {
    path: "01-salzhafen/hafen/ankunft-leuchtturm",
    kind: "scene",
    properties: { id: "arrival", status: "ready" },
    body: "Text",
    rev,
  };
}

const CONFLICT = new ApiError(409, "entry changed on the server", { rev: 99 });

/** A stub that records how often it ran, so double calls are visible. */
function counted<T>(answer: () => Promise<T>): { run: () => Promise<T>; calls: () => number } {
  let calls = 0;
  return {
    run: () => {
      calls += 1;
      return answer();
    },
    calls: () => calls,
  };
}

describe("isStaleEntryError", () => {
  test("only a 409 from the API is the rev conflict", () => {
    expect(isStaleEntryError(CONFLICT)).toBe(true);
    expect(isStaleEntryError(new ApiError(500, "boom"))).toBe(false);
    expect(isStaleEntryError(new ApiError(404, "not found"))).toBe(false);
    expect(isStaleEntryError(new Error("network"))).toBe(false);
    expect(isStaleEntryError(undefined)).toBe(false);
  });
});

describe("writeWithRev", () => {
  test("a written entry is passed through as the new truth", async () => {
    const written = entryAt(43);
    const reread = counted(() => Promise.resolve(entryAt(1)));
    expect(await writeWithRev(() => Promise.resolve(written), reread.run)).toEqual({
      ok: true,
      entry: written,
    });
    // Nothing to re-read: the answer of the write IS the current entry.
    expect(reread.calls()).toBe(0);
  });

  test("409 means nothing was written — the entry is re-read once for the next attempt", async () => {
    const fresh = entryAt(99);
    const reread = counted(() => Promise.resolve(fresh));
    expect(await writeWithRev(() => Promise.reject(CONFLICT), reread.run)).toEqual({
      ok: false,
      entry: fresh,
    });
    expect(reread.calls()).toBe(1);
  });

  test("a failed reload after the conflict keeps the conflict, not a crash", async () => {
    expect(
      await writeWithRev(
        () => Promise.reject(CONFLICT),
        () => Promise.reject(new ApiError(500, "server gone")),
      ),
    ).toEqual({ ok: false });
  });

  test("every other failure throws — that is the caller's error line", async () => {
    const reread = counted(() => Promise.resolve(entryAt(1)));
    const boom = new ApiError(500, "boom");
    await expect(writeWithRev(() => Promise.reject(boom), reread.run)).rejects.toBe(boom);
    // A non-conflict failure says nothing about the stored entry.
    expect(reread.calls()).toBe(0);
  });

  test("a non-API failure throws just as well (offline, bug)", async () => {
    const offline = new TypeError("Failed to fetch");
    await expect(
      writeWithRev(
        () => Promise.reject(offline),
        () => Promise.resolve(entryAt(1)),
      ),
    ).rejects.toBe(offline);
  });
});

describe("withRev", () => {
  test("without a rev there is no write function at all", () => {
    expect(withRev(undefined, () => Promise.resolve({ ok: true, entry: entryAt(1) }))).toBe(
      undefined,
    );
  });

  test("with a rev the write gets the variables and that very version", async () => {
    const seen: Array<{ status: string; rev: number }> = [];
    const write = withRev<string>(42, (status, rev) => {
      seen.push({ status, rev });
      return Promise.resolve({ ok: true, entry: entryAt(rev + 1) });
    });
    expect(write).not.toBe(undefined);
    expect(await write?.("played")).toEqual({ ok: true, entry: entryAt(43) });
    expect(seen).toEqual([{ status: "played", rev: 42 }]);
  });

  test("rev 0 is a version, not a missing one", () => {
    expect(withRev(0, () => Promise.resolve({ ok: true, entry: entryAt(0) }))).not.toBe(undefined);
  });
});
