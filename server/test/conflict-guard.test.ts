// The conflict guard — the issue #37 regression, demanded by issue #57 AK2.
//
// WHAT WAS BROKEN. The optimistic-concurrency token used to be the file's
// mtime in milliseconds, and on the filesystems Grimoire runs on that mtime
// is coarse: two writes that land in the SAME clock second read the same
// value. So the sequence
//
//     A reads the scene  -> mtimeMs = T
//     B reads the scene  -> mtimeMs = T
//     A writes with T    -> ok, file's mtime is still T (same second)
//     B writes with T    -> guard sees T == T -> ok, A's change is GONE
//
// went through silently: the second write was accepted, the first one's
// change was overwritten, and neither the DM nor the app ever saw a 409. Two
// browser tabs, or a fast double-save, were enough. A test could not even
// catch it reliably, because it depended on how the clock fell.
//
// WHAT FIXES IT. The token is the ROW's `rev` now (store/render.ts rule 3):
// an integer that starts at 1 and is incremented by every write inside the
// write's own transaction. It has nothing to do with wall-clock time, so it
// cannot collide — no matter how close together the two writes are. The
// second write against a spent `rev` is a 409 that carries the CURRENT rev,
// which is exactly what the app needs to reload and retry.
//
// That is what this file pins, with the clock deliberately FROZEN via
// setNow(): under the old guard a frozen clock was the worst case; under the
// new one it is irrelevant, and a test that stops being about timing is the
// point.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { setNow } from "../src/clock";
import { dropStore, seedStore } from "./support/store";

const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";

async function getFile(rel: string): Promise<FileResponse> {
  const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function patchReq(mtimeMs: number, patch: Record<string, unknown>): Promise<Response> {
  return app.request("/api/beispiel/frontmatter", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: SCENE, mtimeMs, patch }),
  });
}

async function putReq(mtimeMs: number, body: string): Promise<Response> {
  return app.request("/api/beispiel/file", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: SCENE, mtimeMs, body }),
  });
}

interface Conflict {
  error: string;
  mtimeMs: number;
}

beforeEach(async () => {
  // FROZEN — every request in this file happens in the same clock second, the
  // situation the mtime guard could not tell apart.
  setNow(() => new Date(2026, 7, 19, 21, 5, 30));
  await seedStore();
});

afterEach(() => {
  setNow(null);
  dropStore();
});

describe("two writes with the same guard token, same clock second", () => {
  test("PATCH /frontmatter: first wins, second is 409, the loser did not land", async () => {
    const read = await getFile(SCENE);

    // Both "tabs" hold the SAME token — the one read above.
    const first = await patchReq(read.mtimeMs, { status: "played" });
    expect(first.status).toBe(200);
    const won = (await first.json()) as FileResponse;
    expect(won.frontmatter.status).toBe("played");
    expect(won.mtimeMs).toBe(read.mtimeMs + 1);

    const second = await patchReq(read.mtimeMs, { status: "draft" });
    expect(second.status).toBe(409);
    const conflict = (await second.json()) as Conflict;
    expect(typeof conflict.error).toBe("string");
    // The 409 carries the CURRENT rev, so the app can reload and retry.
    expect(conflict.mtimeMs).toBe(won.mtimeMs);

    // The whole point: the second write did NOT land — this is the assertion
    // that failed with the mtime guard.
    const after = await getFile(SCENE);
    expect(after.frontmatter.status).toBe("played");
    expect(after.mtimeMs).toBe(won.mtimeMs);

    // …and retrying with the token from the 409 succeeds, in the same second.
    const retry = await patchReq(conflict.mtimeMs, { status: "draft" });
    expect(retry.status).toBe(200);
    const retried = (await retry.json()) as FileResponse;
    expect(retried.frontmatter.status).toBe("draft");
    expect(retried.mtimeMs).toBe(conflict.mtimeMs + 1);
  });

  test("PUT /file: first wins, second is 409, the loser's body did not land", async () => {
    const read = await getFile(SCENE);

    const first = await putReq(read.mtimeMs, "\n## Flow\n\nVersion A.\n");
    expect(first.status).toBe(200);
    const won = (await first.json()) as FileResponse;
    expect(won.body).toBe("\n## Flow\n\nVersion A.\n");
    expect(won.mtimeMs).toBe(read.mtimeMs + 1);

    const second = await putReq(read.mtimeMs, "\n## Flow\n\nVersion B.\n");
    expect(second.status).toBe(409);
    const conflict = (await second.json()) as Conflict;
    expect(conflict.mtimeMs).toBe(won.mtimeMs);

    // Version B is nowhere — not in the row, not in the rendering.
    const after = await getFile(SCENE);
    expect(after.body).toBe("\n## Flow\n\nVersion A.\n");
    expect(after.body).not.toContain("Version B");
    expect(after.mtimeMs).toBe(won.mtimeMs);

    const retry = await putReq(conflict.mtimeMs, "\n## Flow\n\nVersion B.\n");
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as FileResponse).body).toBe("\n## Flow\n\nVersion B.\n");
  });

  test("fired together: exactly one lands, whichever the runtime schedules first", async () => {
    // The sequential cases above are the deterministic contract. This one is
    // the shape the bug actually had in the field — two requests in flight at
    // once — and it asserts the property that matters without pinning an
    // order: ONE 200, ONE 409 whose token is the winner's, and a row that
    // shows exactly the winner's value.
    const read = await getFile(SCENE);
    const responses = await Promise.all([
      patchReq(read.mtimeMs, { status: "played" }),
      patchReq(read.mtimeMs, { status: "ready" }),
    ]);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);

    const okRes = responses[responses.findIndex((r) => r.status === 200)]!;
    const conflictRes = responses[responses.findIndex((r) => r.status === 409)]!;
    const won = (await okRes.json()) as FileResponse;
    const conflict = (await conflictRes.json()) as Conflict;

    expect(won.mtimeMs).toBe(read.mtimeMs + 1);
    expect(conflict.mtimeMs).toBe(won.mtimeMs);

    // The row carries the winner's value and NOTHING of the loser's: the
    // rev moved by exactly one, for exactly one write.
    const after = await getFile(SCENE);
    expect(after.frontmatter.status).toBe(won.frontmatter.status);
    expect(after.mtimeMs).toBe(read.mtimeMs + 1);
  });

  test("the two endpoints share one token — a PATCH invalidates a held PUT", async () => {
    // Frontmatter and body are one row, so they are one guard. An app that
    // saved the status and then the body with the token it read BEFORE the
    // status write must be told, not silently allowed to revert.
    const read = await getFile(SCENE);
    const patched = await patchReq(read.mtimeMs, { status: "played" });
    expect(patched.status).toBe(200);

    const stalePut = await putReq(read.mtimeMs, "\n## Flow\n\nAus einem alten Tab.\n");
    expect(stalePut.status).toBe(409);
    expect(((await stalePut.json()) as Conflict).mtimeMs).toBe(read.mtimeMs + 1);
    expect((await getFile(SCENE)).body).toBe(read.body);

    // …and the reverse direction, still in the same second.
    const put = await putReq(read.mtimeMs + 1, "\n## Flow\n\nJetzt aber.\n");
    expect(put.status).toBe(200);
    const stalePatch = await patchReq(read.mtimeMs + 1, { status: "draft" });
    expect(stalePatch.status).toBe(409);
    expect(((await stalePatch.json()) as Conflict).mtimeMs).toBe(read.mtimeMs + 2);
    expect((await getFile(SCENE)).frontmatter.status).toBe("played");
  });
});
