// Pausing the session for real (issue #40 AK8): POST /session/pause opens a
// `pauses` interval, POST /session/continue closes it, and the FileResponse
// carries the epoch arithmetic (pausedMs / pausedSinceMs) so the client only
// ever subtracts numbers.
//
// Like the other write tests this runs against a TEMP COPY of the example
// campaign (examples/ is the committed format reference and must never be
// mutated) and overrides the clock via setNow().

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { setNow } from "../src/clock";
import { getCampaignRoot, setCampaignRoot } from "../src/config";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");
const REL = "sessions/2026-08-19.md";

let tmpRoot = "";
let originalRoot = "";

const absOf = (rel: string) => path.join(tmpRoot, "beispiel", rel);

async function post(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** POST that must succeed, with the session file it answers with. */
async function ok(url: string): Promise<FileResponse> {
  const res = await post(url);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

const raw = () => readFile(absOf(REL), "utf8");

/** Write the running session file directly, with the given frontmatter tail. */
async function writeSession(tail = ""): Promise<void> {
  await writeFile(
    absOf(REL),
    `---\nid: 2026-08-19\nstarted: 2026-08-19T21:00\n${tail}---\n\n## Log\n`,
    "utf8",
  );
}

/** Log lines of the file, in order. */
async function logLines(): Promise<string[]> {
  const text = await raw();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
}

beforeAll(async () => {
  originalRoot = getCampaignRoot();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "grimoire-pause-"));
  await cp(path.join(EXAMPLES, "beispiel"), path.join(tmpRoot, "beispiel"), { recursive: true });
  setCampaignRoot(tmpRoot);
});

afterAll(async () => {
  setCampaignRoot(originalRoot);
  setNow(null);
  await rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  setNow(() => new Date(2026, 7, 19, 21, 5));
  await writeSession();
});

describe("POST /api/:campaign/session/pause + /continue", () => {
  test("pause opens an interval and logs `— Pause`; continue closes it and logs `— Weiter`", async () => {
    setNow(() => new Date(2026, 7, 19, 21, 40, 12));
    const paused = await ok("/api/beispiel/session/pause");
    expect(paused.path).toBe(REL);
    expect(paused.frontmatter.pauses).toEqual([{ from: "2026-08-19T21:40:12" }]);
    // Nothing counted yet, but the clock is standing since 21:40:12.
    expect(paused.pausedMs).toBeUndefined();
    expect(paused.pausedSinceMs).toBe(new Date(2026, 7, 19, 21, 40, 12).getTime());
    expect(await logLines()).toEqual(["- 21:40 — Pause"]);

    setNow(() => new Date(2026, 7, 19, 21, 58, 3));
    const running = await ok("/api/beispiel/session/continue");
    expect(running.frontmatter.pauses).toEqual([
      { from: "2026-08-19T21:40:12", to: "2026-08-19T21:58:03" },
    ]);
    expect(running.pausedSinceMs).toBeUndefined();
    expect(running.pausedMs).toBe((17 * 60 + 51) * 1000);
    expect(await logLines()).toEqual(["- 21:40 — Pause", "- 21:58 — Weiter"]);
    // Seconds survive the roundtrip through the YAML normalization.
    expect(await raw()).toContain("2026-08-19T21:40:12");
  });

  test("several pauses add up; the body stays append-only", async () => {
    setNow(() => new Date(2026, 7, 19, 21, 10, 0));
    await ok("/api/beispiel/session/pause");
    setNow(() => new Date(2026, 7, 19, 21, 20, 0));
    await ok("/api/beispiel/session/continue");
    setNow(() => new Date(2026, 7, 19, 22, 0, 0));
    await ok("/api/beispiel/session/pause");
    setNow(() => new Date(2026, 7, 19, 22, 5, 30));
    const file = await ok("/api/beispiel/session/continue");
    expect(file.pausedMs).toBe((10 * 60 + 5 * 60 + 30) * 1000);
    expect((file.frontmatter.pauses as unknown[]).length).toBe(2);
    expect(await logLines()).toEqual([
      "- 21:10 — Pause",
      "- 21:20 — Weiter",
      "- 22:00 — Pause",
      "- 22:05 — Weiter",
    ]);
  });

  test("both calls are idempotent — no second interval, no duplicate log line", async () => {
    setNow(() => new Date(2026, 7, 19, 21, 30, 0));
    await ok("/api/beispiel/session/pause");
    setNow(() => new Date(2026, 7, 19, 21, 31, 0));
    const again = await ok("/api/beispiel/session/pause");
    // `:00` seconds normalize away on the way back through the YAML parser
    // (the reader accepts both precisions) — non-zero seconds survive.
    expect(again.frontmatter.pauses).toEqual([{ from: "2026-08-19T21:30" }]);
    expect(await logLines()).toEqual(["- 21:30 — Pause"]);

    setNow(() => new Date(2026, 7, 19, 21, 35, 0));
    await ok("/api/beispiel/session/continue");
    setNow(() => new Date(2026, 7, 19, 21, 36, 0));
    const stillRunning = await ok("/api/beispiel/session/continue");
    expect(stillRunning.frontmatter.pauses).toEqual([
      { from: "2026-08-19T21:30", to: "2026-08-19T21:35" },
    ]);
    expect(await logLines()).toEqual(["- 21:30 — Pause", "- 21:35 — Weiter"]);
  });

  test("`session/end` closes an open pause", async () => {
    setNow(() => new Date(2026, 7, 19, 22, 50, 0));
    await ok("/api/beispiel/session/pause");
    setNow(() => new Date(2026, 7, 19, 23, 0, 0));
    const ended = await ok("/api/beispiel/session/end");
    expect(ended.frontmatter.ended).toBe("2026-08-19T23:00");
    expect(ended.frontmatter.pauses).toEqual([
      { from: "2026-08-19T22:50", to: "2026-08-19T23:00" },
    ]);
    expect(ended.pausedSinceMs).toBeUndefined();
    expect(ended.pausedMs).toBe(10 * 60 * 1000);
  });

  test("degraded `pauses` entries are ignored, never fatal", async () => {
    // Hand-edited garbage of every shape the field can grow: a scalar entry,
    // a mapping without `from`, an unreadable `from`, an unreadable `to` —
    // plus ONE usable closed interval.
    await writeSession(
      "pauses: [kaputt, {to: 2026-08-19T21:10}, {from: gestern}, " +
        "{from: 2026-08-19T21:20:00, to: irgendwann}, " +
        "{from: 2026-08-19T21:30:00, to: 2026-08-19T21:33:00}]\n",
    );
    const res = await app.request("/api/beispiel/session");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.pausedMs).toBe(3 * 60 * 1000);
    expect(file.pausedSinceMs).toBeUndefined();

    // …and a pause on top of that garbage keeps only the usable entries.
    setNow(() => new Date(2026, 7, 19, 21, 40, 0));
    const paused = await ok("/api/beispiel/session/pause");
    expect(paused.frontmatter.pauses).toEqual([
      { from: "2026-08-19T21:30", to: "2026-08-19T21:33" },
      { from: "2026-08-19T21:40" },
    ]);
    expect(paused.pausedSinceMs).toBe(new Date(2026, 7, 19, 21, 40, 0).getTime());
  });

  test("404 when no session is running", async () => {
    await writeSession("ended: 2026-08-19T23:30\n");
    expect((await post("/api/beispiel/session/pause")).status).toBe(404);
    expect((await post("/api/beispiel/session/continue")).status).toBe(404);
  });
});
