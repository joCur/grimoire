// Review-action tests (issue #10), ported to the database stack (issue #57).
//
// Same setup as the write-API tests: one fresh in-memory database per case,
// seeded from `examples/` by the real migration (test/support/store.ts). No
// campaign file is read or written any more, so every "the file on disk says
// X" assertion is re-expressed against the API's answer or the structured
// endpoint behind it.
//
// Two behaviour notes the cutover forced, both pinned below:
//
//   * `reviewed` is no longer a frontmatter list that GROWS IN SEEN ORDER.
//     It is a flag on the log row, and the frontmatter renders the flagged
//     rows in LOG ORDER (store/render.ts sessionFrontmatter) — a stable
//     reading order instead of a click order.
//   * A `review/seen` hash matching no log line changes NOTHING and answers
//     `marked: false`. The file version appended the hash regardless and left
//     an orphan entry behind that nothing could ever clear; staying silent
//     about it would hide a client bug behind a 200.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import {
  dropStore,
  removeTempRoot,
  seedStore,
  tempCampaignRoot,
  useCampaignRoot,
} from "./support/store";

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

async function postOk(url: string, body?: unknown): Promise<FileResponse> {
  const res = await postJson(url, body);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function getFile(rel: string, campaign = "beispiel"): Promise<FileResponse> {
  const res = await app.request(`/api/${campaign}/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function putBody(rel: string, body: string): Promise<FileResponse> {
  const before = await getFile(rel);
  const res = await app.request("/api/beispiel/file", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, mtimeMs: before.mtimeMs, body }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

/** The documented short-hash: first 8 hex chars of SHA-256 over the raw line. */
function sha8(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("POST /api/:campaign/review/seen", () => {
  const SESSION = "sessions/2026-01-15.md";
  const LINE = "- 19:52 (lighthouse-arrival) Spuren gefunden, Gruppe will sofort zur Bucht #decision";
  const LINE2 = '- 21:10 (lighthouse-arrival) Improvisiert: Fischerin "Old Metta" am Steg #npc';

  test("adds the short hash once; Log unchanged; key rendered last", async () => {
    const before = await getFile(SESSION);
    const file = await postOk("/api/beispiel/review/seen", { path: SESSION, line: LINE });
    expect(file.frontmatter.reviewed).toEqual([sha8(LINE)]);

    // `reviewed` is rendered after the session's own keys — the position the
    // degrade path used to append it to.
    expect(Object.keys(file.frontmatter)).toEqual([
      "id",
      "started",
      "ended",
      "scenes_played",
      "reviewed",
    ]);
    expect(file.raw).toContain(`reviewed: [${sha8(LINE)}]\n`);
    // The body (## Log, ## Threads) is untouched — marking a line as read
    // never rewrites it.
    expect(file.body).toBe(before.body);
  });

  test("hash matches an independently computed sha-256 prefix", async () => {
    // Recompute from scratch here so a hash-implementation change fails loudly.
    const expected = createHash("sha256").update(LINE, "utf8").digest("hex").slice(0, 8);
    expect(expected).toHaveLength(8);
    expect(expected).toMatch(/^[0-9a-f]{8}$/);
    const file = await postOk("/api/beispiel/review/seen", { path: SESSION, line: LINE });
    expect(file.raw).toContain(`reviewed: [${expected}]\n`);
  });

  test("idempotent: the same line does not add a second entry", async () => {
    const first = await postOk("/api/beispiel/review/seen", { path: SESSION, line: LINE });
    const again = await postOk("/api/beispiel/review/seen", { path: SESSION, line: LINE });
    expect(again.frontmatter.reviewed).toEqual([sha8(LINE)]);
    // Nothing to write means nothing written: the session's guard token stands.
    expect(again.mtimeMs).toBe(first.mtimeMs);
    expect(again.body).toBe(first.body);
  });

  test("several lines render in LOG order, not in the order they were seen", async () => {
    // Deliberately marked back to front. The file version appended hashes as
    // they arrived; the flag on the row has no click order to remember, and
    // the log's own order is the one the review reads in.
    const second = await postOk("/api/beispiel/review/seen", { path: SESSION, line: LINE2 });
    expect(second.frontmatter.reviewed).toEqual([sha8(LINE2)]);
    const both = await postOk("/api/beispiel/review/seen", { path: SESSION, line: LINE });
    expect(both.frontmatter.reviewed).toEqual([sha8(LINE), sha8(LINE2)]);
    expect(both.raw).toContain(`reviewed: [${sha8(LINE)}, ${sha8(LINE2)}]\n`);
  });

  test("a line that is not in the log changes nothing and says so", async () => {
    // NEW with the cutover: the hash addresses a ROW. A line the session does
    // not have (a stale review view, a hand-edited log) can therefore not be
    // flagged — and instead of an orphan frontmatter entry nothing happens.
    // It is not SILENT though: `marked: false` is the answer saying "no row
    // hashes to what you sent", which a bare 200 would hide.
    const before = await getFile(SESSION);
    const after = (await postOk("/api/beispiel/review/seen", {
      path: SESSION,
      line: "- 23:59 gibt es in diesem Log nicht",
    })) as FileResponse & { marked?: boolean };
    expect(after.marked).toBe(false);
    expect(after.frontmatter.reviewed).toBeUndefined();
    const { marked: _marked, ...file } = after;
    expect(file).toEqual(before);
  });

  test("a line that IS in the log answers marked: true, and again on a repeat", async () => {
    const first = (await postOk("/api/beispiel/review/seen", {
      path: SESSION,
      line: LINE,
    })) as FileResponse & { marked?: boolean };
    expect(first.marked).toBe(true);
    const again = (await postOk("/api/beispiel/review/seen", {
      path: SESSION,
      line: LINE,
    })) as FileResponse & { marked?: boolean };
    expect(again.marked).toBe(true);
  });

  test("400 unless path is a sessions/*.md file", async () => {
    for (const p of ["npcs/fenn.md", "inbox.md", "sessions/x/y.md", "sessions/2026-01-15.txt"]) {
      const res = await postJson("/api/beispiel/review/seen", { path: p, line: LINE });
      expect(res.status).toBe(400);
    }
  });

  test("404 for a session that does not exist", async () => {
    const res = await postJson("/api/beispiel/review/seen", {
      path: "sessions/1999-01-01.md",
      line: LINE,
    });
    expect(res.status).toBe(404);
  });

  test("400 on malformed bodies", async () => {
    const bad = [
      {}, // missing everything
      { path: SESSION }, // missing line
      { path: SESSION, line: "" }, // empty line
      { path: SESSION, line: "   " }, // whitespace-only line
      { path: SESSION, line: "a\nb" }, // not a single line
      { path: SESSION, line: 42 }, // line not a string
      { path: 42, line: LINE }, // path not a string
      { path: SESSION, line: LINE, extra: 1 }, // unknown key
    ];
    for (const b of bad) {
      expect((await postJson("/api/beispiel/review/seen", b)).status).toBe(400);
    }
  });
});

// The `## Offene Fäden` markdown surgery is UNCHANGED by the cutover
// (store/write.ts appendThreadItem) — it operates on the chapter row's body
// instead of on file bytes, and the three insertion cases below are the same
// three it always had.
describe("POST /api/:campaign/review/thread", () => {
  const CHAPTER = "01-salzhafen/_chapter.md";

  test("appends to an existing ## Offene Fäden section (append-only)", async () => {
    const before = await getFile(CHAPTER);
    const file = await postOk("/api/beispiel/review/thread", {
      chapter: "01-salzhafen",
      text: "Lichter in der Bucht untersuchen",
    });
    // The section is the last one in the fixture -> pure append.
    expect(file.body).toBe(`${before.body}- [ ] Lichter in der Bucht untersuchen\n`);
    expect(file.kind).toBe("chapter");
    expect(file.frontmatter).toEqual(before.frontmatter);
  });

  test("inserts before the next heading when the section is not last", async () => {
    // The body is set up through PUT /file — the app's own way to get a
    // chapter into this shape, instead of writing a file behind the server.
    await putBody(CHAPTER, "\n## Offene Fäden\n\n- [ ] Alt\n\n## Notizen\n\nText bleibt.\n");
    const file = await postOk("/api/beispiel/review/thread", {
      chapter: "01-salzhafen",
      text: "Neu",
    });
    expect(file.body).toBe(
      "\n## Offene Fäden\n\n- [ ] Alt\n- [ ] Neu\n\n## Notizen\n\nText bleibt.\n",
    );
  });

  test("creates the section at the end when it is missing", async () => {
    const body = "\n## Ziel des Kapitels\n\nText.\n";
    await putBody(CHAPTER, body);
    const file = await postOk("/api/beispiel/review/thread", {
      chapter: "01-salzhafen",
      text: "Erster Faden",
    });
    expect(file.body).toBe(`${body}\n## Offene Fäden\n\n- [ ] Erster Faden\n`);
  });

  test("multi-line text collapses to a single item line", async () => {
    await postOk("/api/beispiel/review/thread", {
      chapter: "01-salzhafen",
      text: "Faden eins",
    });
    const file = await postOk("/api/beispiel/review/thread", {
      chapter: "01-salzhafen",
      text: "  Zeile eins\n  Zeile zwei  ",
    });
    expect(file.body.endsWith("- [ ] Faden eins\n- [ ] Zeile eins Zeile zwei\n")).toBe(true);
  });

  test("404 when the chapter does not exist or is not a chapter", async () => {
    // Replaces "creates _chapter.md with minimal frontmatter when missing":
    // the endpoint used to invent a chapter file for any directory it found,
    // and a chapter ROW is not something a review action may create out of a
    // typo (the generator's new-chapter flow does that, deliberately). So an
    // unknown chapter is now 404 in BOTH shapes the old test distinguished.
    expect(
      (await postJson("/api/beispiel/review/thread", { chapter: "04-leer", text: "x" })).status,
    ).toBe(404);
    expect(
      (await postJson("/api/beispiel/review/thread", { chapter: "99-nix", text: "x" })).status,
    ).toBe(404);
    // `npcs` is a reserved name, never a chapter id.
    expect(
      (await postJson("/api/beispiel/review/thread", { chapter: "npcs", text: "x" })).status,
    ).toBe(404);
  });

  test("400 on unsafe chapter ids and empty text", async () => {
    for (const chapter of ["../beispiel", "a/b", ".hidden", "", "a\\b"]) {
      expect(
        (await postJson("/api/beispiel/review/thread", { chapter, text: "x" })).status,
      ).toBe(400);
    }
    expect(
      (await postJson("/api/beispiel/review/thread", { chapter: "01-salzhafen", text: "  " }))
        .status,
    ).toBe(400);
    expect(
      (await postJson("/api/beispiel/review/thread", { chapter: "01-salzhafen" })).status,
    ).toBe(400);
    expect((await postJson("/api/beispiel/review/thread", { chapter: 42, text: "x" })).status).toBe(
      400,
    );
  });
});

describe("POST /api/:campaign/review/npc-stub", () => {
  test("creates the npc with the documented shape", async () => {
    const file = await postOk("/api/beispiel/review/npc-stub", {
      id: "old-metta",
      name: "Old Metta",
      note: "Fischerin am Steg, kennt die Gezeiten #npc",
    });
    expect(file.path).toBe("npcs/old-metta.md");
    expect(file.kind).toBe("npc");
    expect(file.frontmatter.status).toBe("alive");
    expect(file.raw).toBe(
      "---\nid: old-metta\nname: Old Metta\nstatus: alive\n---\n\n## Notizen\n\n- Fischerin am Steg, kennt die Gezeiten #npc\n",
    );
    // A fresh row starts at rev 1 — the token the app sends with its first edit.
    expect(file.mtimeMs).toBe(1);
    expect(await getFile("npcs/old-metta.md")).toEqual(file);
  });

  test("name defaults to the id; without a note the section stays empty", async () => {
    const file = await postOk("/api/beispiel/review/npc-stub", { id: "kai" });
    expect(file.raw).toBe("---\nid: kai\nname: kai\nstatus: alive\n---\n\n## Notizen\n");
  });

  test("409 with { error, path } for an existing slug — the npc is untouched", async () => {
    const before = await getFile("npcs/fenn.md");
    const res = await postJson("/api/beispiel/review/npc-stub", { id: "fenn", note: "doppelt" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; path: string };
    expect(typeof body.error).toBe("string");
    expect(body.path).toBe("npcs/fenn.md");
    expect(await getFile("npcs/fenn.md")).toEqual(before);
    // and a stub created in this run conflicts just the same
    expect((await postJson("/api/beispiel/review/npc-stub", { id: "old-metta" })).status).toBe(200);
    expect((await postJson("/api/beispiel/review/npc-stub", { id: "old-metta" })).status).toBe(409);
  });

  test("400 unless id is a kebab-case slug", async () => {
    const bad = ["Old Metta", "old_metta", "-metta", "metta-", "a--b", "", "a/b", "ä", "A1"];
    for (const id of bad) {
      expect((await postJson("/api/beispiel/review/npc-stub", { id })).status).toBe(400);
    }
    expect((await postJson("/api/beispiel/review/npc-stub", {})).status).toBe(400);
    expect((await postJson("/api/beispiel/review/npc-stub", { id: 42 })).status).toBe(400);
    expect(
      (await postJson("/api/beispiel/review/npc-stub", { id: "ok-slug", name: 42 })).status,
    ).toBe(400);
    expect(
      (await postJson("/api/beispiel/review/npc-stub", { id: "ok-slug", note: 42 })).status,
    ).toBe(400);
  });
});

describe("POST /api/:campaign/review/inbox-done", () => {
  const DONE_TARGET =
    "- 2026-01-10 Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug #thread";

  test("rewrites ONLY the matching line — every other line unchanged", async () => {
    const beforeLines = (await getFile("inbox.md")).body.split("\n");
    const idx = beforeLines.indexOf(DONE_TARGET);
    expect(idx).toBeGreaterThan(-1);

    const file = await postOk("/api/beispiel/review/inbox-done", { line: DONE_TARGET });
    const afterLines = file.body.split("\n");
    expect(afterLines.length).toBe(beforeLines.length);
    for (let i = 0; i < beforeLines.length; i++) {
      if (i === idx) {
        expect(afterLines[i]).toBe(`- [x] ${DONE_TARGET.slice(2)}`);
      } else {
        expect(afterLines[i]).toBe(beforeLines[i]!);
      }
    }
  });

  test("idempotent: the original line again and the done form both no-op", async () => {
    const first = await postOk("/api/beispiel/review/inbox-done", { line: DONE_TARGET });
    // Original (now rewritten) form. The inbox has no row of its own to carry
    // a rev, so its token is the campaign's version counter, which EVERY
    // write bumps — the content is what "no-op" is about here.
    const again = await postOk("/api/beispiel/review/inbox-done", { line: DONE_TARGET });
    expect(again.body).toBe(first.body);
    // Explicit done form.
    const explicit = await postOk("/api/beispiel/review/inbox-done", {
      line: `- [x] ${DONE_TARGET.slice(2)}`,
    });
    expect(explicit.body).toBe(first.body);
  });

  test("only the FIRST of several identical lines is rewritten", async () => {
    await postOk("/api/beispiel/inbox", { text: "Doppelt" });
    await postOk("/api/beispiel/inbox", { text: "Doppelt" });
    const file = await postOk("/api/beispiel/review/inbox-done", { line: "- Doppelt" });
    expect(file.body.endsWith("- [x] Doppelt\n- Doppelt\n")).toBe(true);
  });

  test("404 when the line is not in the inbox", async () => {
    const res = await postJson("/api/beispiel/review/inbox-done", { line: "- gibt es nicht" });
    expect(res.status).toBe(404);
  });

  test("400 on malformed lines", async () => {
    const bad = [
      {}, // missing line
      { line: "" },
      { line: "   " },
      { line: "kein Listeneintrag" }, // no `- ` prefix
      { line: "- a\n- b" }, // not a single line
      { line: 42 },
      { line: "- x", extra: 1 }, // unknown key
    ];
    for (const b of bad) {
      expect((await postJson("/api/beispiel/review/inbox-done", b)).status).toBe(400);
    }
  });

  test("404 when the campaign has no inbox at all", async () => {
    // The "inbox.md is missing" case: a campaign whose migration produced no
    // inbox rows. GET answers 404 for it, and so does this endpoint.
    const root = await tempCampaignRoot();
    const restore = useCampaignRoot(root);
    try {
      await mkdir(path.join(root, "frischling"), { recursive: true });
      await seedStore(root);
      const res = await postJson("/api/frischling/review/inbox-done", { line: "- egal" });
      expect(res.status).toBe(404);
    } finally {
      restore();
      await removeTempRoot(root);
    }
  });

  test("404 for an unknown campaign on all four endpoints", async () => {
    expect(
      (await postJson("/api/nope/review/seen", { path: "sessions/x.md", line: "- x" })).status,
    ).toBe(404);
    expect((await postJson("/api/nope/review/thread", { chapter: "a", text: "x" })).status).toBe(
      404,
    );
    expect((await postJson("/api/nope/review/npc-stub", { id: "a" })).status).toBe(404);
    expect((await postJson("/api/nope/review/inbox-done", { line: "- x" })).status).toBe(404);
  });
});
