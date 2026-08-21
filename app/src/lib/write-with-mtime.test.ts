// Issue #38: the mtime protocol of ADR #4 has exactly one implementation, so
// it is tested exactly once here — with plain stub functions, no fetch, no
// react. The three per-path suites (scene-status, file-body, campaign-meta)
// then only have to show that they wire the right request into it.

import type { FileResponse } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { isStaleFileError, withMtime, writeWithMtime } from "./write-with-mtime";

function fileAt(mtimeMs: number): FileResponse {
  return {
    path: "01-salzhafen/hafen/ankunft-leuchtturm.md",
    kind: "scene",
    frontmatter: { id: "arrival", status: "ready" },
    body: "Text",
    raw: "---\nid: arrival\n---\n\nText",
    mtimeMs,
  };
}

const CONFLICT = new ApiError(409, "file changed on disk", { mtimeMs: 99 });

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

describe("isStaleFileError", () => {
  test("only a 409 from the API is the mtime conflict", () => {
    expect(isStaleFileError(CONFLICT)).toBe(true);
    expect(isStaleFileError(new ApiError(500, "boom"))).toBe(false);
    expect(isStaleFileError(new ApiError(404, "not found"))).toBe(false);
    expect(isStaleFileError(new Error("network"))).toBe(false);
    expect(isStaleFileError(undefined)).toBe(false);
  });
});

describe("writeWithMtime", () => {
  test("a written file is passed through as the new truth", async () => {
    const written = fileAt(43);
    const reread = counted(() => Promise.resolve(fileAt(1)));
    expect(await writeWithMtime(() => Promise.resolve(written), reread.run)).toEqual({
      ok: true,
      file: written,
    });
    // Nothing to re-read: the answer of the write IS the current file.
    expect(reread.calls()).toBe(0);
  });

  test("409 means nothing was written — the file is re-read once for the next attempt", async () => {
    const fresh = fileAt(99);
    const reread = counted(() => Promise.resolve(fresh));
    expect(await writeWithMtime(() => Promise.reject(CONFLICT), reread.run)).toEqual({
      ok: false,
      file: fresh,
    });
    expect(reread.calls()).toBe(1);
  });

  test("a failed reload after the conflict keeps the conflict, not a crash", async () => {
    expect(
      await writeWithMtime(
        () => Promise.reject(CONFLICT),
        () => Promise.reject(new ApiError(500, "server gone")),
      ),
    ).toEqual({ ok: false });
  });

  test("every other failure throws — that is the caller's error line", async () => {
    const reread = counted(() => Promise.resolve(fileAt(1)));
    const boom = new ApiError(500, "boom");
    await expect(writeWithMtime(() => Promise.reject(boom), reread.run)).rejects.toBe(boom);
    // A non-conflict failure says nothing about the file on disk.
    expect(reread.calls()).toBe(0);
  });

  test("a non-API failure throws just as well (offline, bug)", async () => {
    const offline = new TypeError("Failed to fetch");
    await expect(
      writeWithMtime(
        () => Promise.reject(offline),
        () => Promise.resolve(fileAt(1)),
      ),
    ).rejects.toBe(offline);
  });
});

describe("withMtime", () => {
  test("without an mtime there is no write function at all", () => {
    expect(withMtime(undefined, () => Promise.resolve({ ok: true, file: fileAt(1) }))).toBe(
      undefined,
    );
  });

  test("with an mtime the write gets the variables and that very version", async () => {
    const seen: Array<{ status: string; mtimeMs: number }> = [];
    const write = withMtime<string>(42, (status, mtimeMs) => {
      seen.push({ status, mtimeMs });
      return Promise.resolve({ ok: true, file: fileAt(mtimeMs + 1) });
    });
    expect(write).not.toBe(undefined);
    expect(await write?.("played")).toEqual({ ok: true, file: fileAt(43) });
    expect(seen).toEqual([{ status: "played", mtimeMs: 42 }]);
  });

  test("mtime 0 is a version, not a missing one", () => {
    expect(withMtime(0, () => Promise.resolve({ ok: true, file: fileAt(0) }))).not.toBe(undefined);
  });
});
