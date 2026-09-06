// Issue #28: the status write. What matters is the payload (the mtime must be
// the one of the file the DM was looking at) and the 409 path — the server
// wrote NOTHING then, so the UI must re-read the file and let the next
// attempt carry the fresh mtime.

import type { FileResponse } from "@grimoire/shared/types";
import { afterEach, describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import {
  SCENE_STATUS_OPTIONS,
  isSceneDone,
  sceneStatusMeta,
  sceneStatusPatchBody,
  writeSceneStatus,
} from "./scene-status";

const SCENE = "01-salzhafen/hafen/ankunft-leuchtturm.md";

function fileAt(mtimeMs: number, status: string): FileResponse {
  return {
    path: SCENE,
    kind: "scene",
    frontmatter: { id: "arrival", title: "Ankunft", status },
    body: "",
    raw: `---\nid: arrival\nstatus: ${status}\n---\n`,
    mtimeMs,
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

describe("sceneStatusPatchBody", () => {
  test("patches only `status`, with the mtime of the loaded file", () => {
    expect(sceneStatusPatchBody(SCENE, 1_700_000_000_123, "ready")).toEqual({
      path: SCENE,
      mtimeMs: 1_700_000_000_123,
      patch: { status: "ready" },
    });
  });

  test("nothing else of the frontmatter is touched", () => {
    const body = sceneStatusPatchBody(SCENE, 1, "played");
    expect(Object.keys(body.patch)).toEqual(["status"]);
  });
});

describe("writeSceneStatus", () => {
  test("PATCHes the frontmatter endpoint and returns the server's file", async () => {
    const calls = mockFetch([{ status: 200, body: fileAt(222, "ready") }]);
    const result = await writeSceneStatus("beispiel", SCENE, 111, "ready");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("/api/beispiel/frontmatter");
    expect(calls[0]?.body).toEqual({ path: SCENE, mtimeMs: 111, patch: { status: "ready" } });
    expect(result.ok).toBe(true);
    expect(result.file?.mtimeMs).toBe(222);
  });

  test("409: nothing written, the file is re-read for the fresh mtime", async () => {
    const calls = mockFetch([
      { status: 409, body: { error: "file changed on disk", mtimeMs: 999 } },
      { status: 200, body: fileAt(999, "draft") },
    ]);
    const result = await writeSceneStatus("beispiel", SCENE, 111, "ready");

    expect(result.ok).toBe(false);
    expect(result.file?.mtimeMs).toBe(999);
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.url).toBe(`/api/beispiel/file?path=${encodeURIComponent(SCENE)}`);
  });

  test("the attempt after a conflict carries the mtime the reload brought", async () => {
    mockFetch([
      { status: 409, body: { error: "file changed on disk", mtimeMs: 999 } },
      { status: 200, body: fileAt(999, "draft") },
    ]);
    const conflict = await writeSceneStatus("beispiel", SCENE, 111, "ready");
    const fresh = conflict.file?.mtimeMs;

    const calls = mockFetch([{ status: 200, body: fileAt(1000, "ready") }]);
    const retry = await writeSceneStatus("beispiel", SCENE, fresh ?? 0, "ready");

    expect(calls[0]?.body).toEqual({ path: SCENE, mtimeMs: 999, patch: { status: "ready" } });
    expect(retry.ok).toBe(true);
  });

  test("409 plus a failed reload: still a conflict, no file to seed", async () => {
    mockFetch([
      { status: 409, body: { error: "file changed on disk", mtimeMs: 999 } },
      { status: 500, body: { error: "boom" } },
    ]);
    expect(await writeSceneStatus("beispiel", SCENE, 111, "ready")).toEqual({ ok: false });
  });

  test("every other failure throws (the control shows its quiet line)", async () => {
    mockFetch([{ status: 500, body: { error: "boom" } }]);
    await expect(writeSceneStatus("beispiel", SCENE, 111, "ready")).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe("status labels", () => {
  test("the menu offers exactly the known quartet, German and in lifecycle order", () => {
    expect(SCENE_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      "draft",
      "ready",
      "played",
      "dropped",
    ]);
    expect(SCENE_STATUS_OPTIONS.map((o) => o.label)).toEqual([
      "Entwurf",
      "bereit",
      "gespielt",
      "verworfen",
    ]);
  });

  test("an unknown value stays visible verbatim (degrade, never corrected)", () => {
    expect(sceneStatusMeta("verschollen").label).toBe("verschollen");
    expect(SCENE_STATUS_OPTIONS.map((o) => o.value)).not.toContain("verschollen");
  });
});

// Issue #73: the split the live nav groups by.
describe("isSceneDone", () => {
  test("played and dropped are behind us", () => {
    expect(isSceneDone("played")).toBe(true);
    expect(isSceneDone("dropped")).toBe(true);
  });

  test("draft and ready are still planned", () => {
    expect(isSceneDone("draft")).toBe(false);
    expect(isSceneDone("ready")).toBe(false);
  });

  test("an unknown status degrades to planned — it never hides a scene", () => {
    expect(isSceneDone("verschollen")).toBe(false);
    expect(isSceneDone("")).toBe(false);
  });
});
