// Issue #15: the body write. What matters is the payload (the rev must be
// the one of the file the DM was looking at) and the 409 path — the server
// wrote NOTHING then, so the UI re-reads the file and the next attempt carries
// the fresh rev, WITHOUT the editor losing the typed text.

import type { FileResponse } from "@grimoire/shared/types";
import { afterEach, describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { canEditFileBody, hasBodyChanges, shouldAdvanceBase, writeFileBody } from "./file-body";

const SCENE = "01-salzhafen/hafen/ankunft-leuchtturm";

function fileAt(rev: number, body: string): FileResponse {
  return {
    path: SCENE,
    kind: "scene",
    properties: { id: "arrival", title: "Ankunft", status: "ready" },
    body,
    raw: `---\nid: arrival\nstatus: ready\n---\n\n${body}`,
    rev,
  };
}

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
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("writeFileBody", () => {
  test("PUTs path, rev and body to the file endpoint", async () => {
    const calls = mockFetch([{ status: 200, body: fileAt(222, "Neuer Text.\n") }]);
    const result = await writeFileBody("beispiel", SCENE, "Neuer Text.\n", 111);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe("/api/beispiel/file");
    expect(calls[0]?.body).toEqual({ path: SCENE, rev: 111, body: "Neuer Text.\n" });
    expect(result).toEqual({ ok: true, file: fileAt(222, "Neuer Text.\n") });
  });

  test("409: nothing written, the file is re-read for the fresh rev", async () => {
    const calls = mockFetch([
      { status: 409, body: { error: "file changed on disk", rev: 999 } },
      { status: 200, body: fileAt(999, "Fremder Text.\n") },
    ]);
    const result = await writeFileBody("beispiel", SCENE, "Mein Text.\n", 111);

    expect(result.ok).toBe(false);
    // The re-read file rides along — the view seeds it into the cache, which
    // is what hands the next attempt its rev.
    expect(result.file?.rev).toBe(999);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.url).toBe(`/api/beispiel/file?path=${encodeURIComponent(SCENE)}`);
  });

  test("the attempt after a conflict carries the rev the reload brought", async () => {
    mockFetch([
      { status: 409, body: { error: "file changed on disk", rev: 999 } },
      { status: 200, body: fileAt(999, "Fremder Text.\n") },
    ]);
    const conflict = await writeFileBody("beispiel", SCENE, "Mein Text.\n", 111);

    const calls = mockFetch([{ status: 200, body: fileAt(1000, "Mein Text.\n") }]);
    const retry = await writeFileBody(
      "beispiel",
      SCENE,
      "Mein Text.\n",
      conflict.file?.rev ?? 0,
    );

    expect(calls[0]?.body).toEqual({ path: SCENE, rev: 999, body: "Mein Text.\n" });
    expect(retry.ok).toBe(true);
  });

  test("409 plus a failed reload: still a conflict, no file to seed", async () => {
    mockFetch([
      { status: 409, body: { error: "file changed on disk", rev: 999 } },
      { status: 500, body: { error: "boom" } },
    ]);
    expect(await writeFileBody("beispiel", SCENE, "Mein Text.\n", 111)).toEqual({ ok: false });
  });

  test("every other failure throws (the editor shows its quiet line)", async () => {
    mockFetch([{ status: 500, body: { error: "boom" } }]);
    await expect(writeFileBody("beispiel", SCENE, "x", 111)).rejects.toBeInstanceOf(ApiError);
  });

  test("an empty body is a legal write, not a no-op", async () => {
    const calls = mockFetch([{ status: 200, body: fileAt(222, "") }]);
    await writeFileBody("beispiel", SCENE, "", 111);
    expect(calls[0]?.body).toEqual({ path: SCENE, rev: 111, body: "" });
  });
});

describe("hasBodyChanges", () => {
  test("identical text is nothing to save", () => {
    expect(hasBodyChanges("## Flow\n\nText.\n", "## Flow\n\nText.\n")).toBe(false);
  });

  test("whitespace counts — two trailing spaces are a markdown line break", () => {
    expect(hasBodyChanges("Zeile\n", "Zeile  \n")).toBe(true);
    expect(hasBodyChanges("Text.\n", "Text.\n\n")).toBe(true);
  });

  test("edited text is a change", () => {
    expect(hasBodyChanges("Text.\n", "Anderer Text.\n")).toBe(true);
  });
});

describe("shouldAdvanceBase", () => {
  const base = fileAt(111, "## Flow\n\nText.\n");

  test("a body-neutral new version is adopted — the DM's own status patch", () => {
    // The status regler stays usable next to the open editor (issue #28): its
    // PATCH bumps the rev and leaves the body alone, so the next „Speichern"
    // must not answer with „Inzwischen geändert".
    expect(shouldAdvanceBase(base, fileAt(222, base.body))).toBe(true);
  });

  test("a changed body is NOT adopted — that is the 409 the freeze exists for", () => {
    expect(shouldAdvanceBase(base, fileAt(222, "## Flow\n\nVon Hand geändert.\n"))).toBe(false);
  });

  test("the same version is nothing to adopt (no state churn from the 5s poll)", () => {
    expect(shouldAdvanceBase(base, fileAt(111, base.body))).toBe(false);
  });

  test("another file is never adopted", () => {
    expect(shouldAdvanceBase(base, { ...fileAt(222, base.body), path: "npcs/jorna" })).toBe(
      false,
    );
  });

  test("nothing to compare against: no", () => {
    expect(shouldAdvanceBase(base, undefined)).toBe(false);
  });
});

describe("canEditFileBody", () => {
  test("the maintained prose kinds are editable", () => {
    for (const kind of ["scene", "npc", "location", "chapter", "glossary", "unknown"] as const) {
      expect(canEditFileBody(kind)).toBe(true);
    }
  });

  test("append-only files and the campaign metadata file are not", () => {
    // Logs/inbox are append-only by design; `_campaign` has its own
    // „Bearbeiten" for name/description (issue #34).
    expect(canEditFileBody("session")).toBe(false);
    expect(canEditFileBody("inbox")).toBe(false);
    expect(canEditFileBody("campaign")).toBe(false);
  });
});
