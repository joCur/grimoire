// Review-action tests (issue #10). Same setup as the write-API tests: they
// run against a TEMP COPY of the example campaign — examples/ is the
// committed format reference and must never be mutated — created in
// beforeAll and wired via setCampaignRoot() (restored in afterAll).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { getCampaignRoot, setCampaignRoot } from "../src/config";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

let tmpRoot = "";
let originalRoot = "";

const absOf = (rel: string) => path.join(tmpRoot, "beispiel", rel);

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** Top-level YAML keys of the frontmatter block, in file order. */
function topLevelKeys(raw: string): string[] {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!m) return [];
  return [...m[1]!.matchAll(/^([A-Za-z_][\w-]*):/gm)].map((k) => k[1]!);
}

/** Everything after the closing frontmatter delimiter. */
function bodyOf(raw: string): string {
  return raw.slice(raw.indexOf("\n---\n") + "\n---\n".length);
}

/** The documented short-hash: first 8 hex chars of SHA-256 over the raw line. */
function sha8(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);
}

beforeAll(async () => {
  originalRoot = getCampaignRoot();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "grimoire-review-"));
  await cp(path.join(EXAMPLES, "beispiel"), path.join(tmpRoot, "beispiel"), { recursive: true });
  setCampaignRoot(tmpRoot);
});

afterAll(async () => {
  setCampaignRoot(originalRoot);
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/:campaign/review/seen", () => {
  const SESSION = "sessions/2026-01-15.md";
  const LINE = "- 19:52 (lighthouse-arrival) Spuren gefunden, Gruppe will sofort zur Bucht #decision";
  const LINE2 = '- 21:10 (lighthouse-arrival) Improvisiert: Fischerin "Old Metta" am Steg #npc';

  test("adds the short hash once; Log body byte-identical; key appended last", async () => {
    const before = await readFile(absOf(SESSION), "utf8");
    const res = await postJson("/api/beispiel/review/seen", { path: SESSION, line: LINE });
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.frontmatter.reviewed).toEqual([sha8(LINE)]);

    const raw = await readFile(absOf(SESSION), "utf8");
    // the key is created (degrade path) and appended after the existing keys
    expect(topLevelKeys(raw)).toEqual(["id", "started", "ended", "scenes_played", "reviewed"]);
    expect(raw).toContain(`reviewed: [${sha8(LINE)}]\n`);
    // body (## Log, ## Threads) untouched byte for byte
    expect(bodyOf(raw)).toBe(bodyOf(before));
    expect(file.raw).toBe(raw);
  });

  test("hash matches an independently computed sha-256 prefix", async () => {
    // Recompute from scratch here so a hash-implementation change fails loudly.
    const expected = createHash("sha256").update(LINE, "utf8").digest("hex").slice(0, 8);
    expect(expected).toHaveLength(8);
    expect(expected).toMatch(/^[0-9a-f]{8}$/);
    const raw = await readFile(absOf(SESSION), "utf8");
    expect(raw).toContain(`reviewed: [${expected}]\n`);
  });

  test("idempotent: the same line does not add a second entry", async () => {
    const before = await readFile(absOf(SESSION), "utf8");
    const res = await postJson("/api/beispiel/review/seen", { path: SESSION, line: LINE });
    expect(res.status).toBe(200);
    expect(await readFile(absOf(SESSION), "utf8")).toBe(before);
  });

  test("a different line appends its hash in seen order", async () => {
    const res = await postJson("/api/beispiel/review/seen", { path: SESSION, line: LINE2 });
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.frontmatter.reviewed).toEqual([sha8(LINE), sha8(LINE2)]);
    const raw = await readFile(absOf(SESSION), "utf8");
    expect(raw).toContain(`reviewed: [${sha8(LINE)}, ${sha8(LINE2)}]\n`);
  });

  test("400 unless path is a sessions/*.md file", async () => {
    for (const p of ["npcs/fenn.md", "inbox.md", "sessions/x/y.md", "sessions/2026-01-15.txt"]) {
      const res = await postJson("/api/beispiel/review/seen", { path: p, line: LINE });
      expect(res.status).toBe(400);
    }
  });

  test("404 for a session file that does not exist", async () => {
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

describe("POST /api/:campaign/review/thread", () => {
  test("appends to an existing ## Offene Fäden section (append-only)", async () => {
    const rel = "01-salzhafen/_chapter.md";
    const before = await readFile(absOf(rel), "utf8");
    const res = await postJson("/api/beispiel/review/thread", {
      chapter: "01-salzhafen",
      text: "Lichter in der Bucht untersuchen",
    });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf(rel), "utf8");
    // section is the last section in the fixture -> pure append
    expect(raw).toBe(`${before}- [ ] Lichter in der Bucht untersuchen\n`);
    const file = (await res.json()) as FileResponse;
    expect(file.raw).toBe(raw);
    expect(file.kind).toBe("chapter");
  });

  test("inserts before the next heading when the section is not last", async () => {
    const rel = "02-nebel/_chapter.md";
    await mkdir(absOf("02-nebel"), { recursive: true });
    const content =
      "---\nid: 02-nebel\ntitle: Nebel\n---\n\n## Offene Fäden\n\n- [ ] Alt\n\n## Notizen\n\nText bleibt.\n";
    await writeFile(absOf(rel), content, "utf8");
    const res = await postJson("/api/beispiel/review/thread", {
      chapter: "02-nebel",
      text: "Neu",
    });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf(rel), "utf8");
    expect(raw).toBe(
      "---\nid: 02-nebel\ntitle: Nebel\n---\n\n## Offene Fäden\n\n- [ ] Alt\n- [ ] Neu\n\n## Notizen\n\nText bleibt.\n",
    );
  });

  test("creates the section at the end when it is missing", async () => {
    const rel = "03-kueste/_chapter.md";
    await mkdir(absOf("03-kueste"), { recursive: true });
    const content = "---\nid: 03-kueste\ntitle: Küste\n---\n\n## Ziel des Kapitels\n\nText.\n";
    await writeFile(absOf(rel), content, "utf8");
    const res = await postJson("/api/beispiel/review/thread", {
      chapter: "03-kueste",
      text: "Erster Faden",
    });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf(rel), "utf8");
    expect(raw).toBe(`${content}\n## Offene Fäden\n\n- [ ] Erster Faden\n`);
  });

  test("creates _chapter.md with minimal frontmatter when missing", async () => {
    await mkdir(absOf("04-leer"), { recursive: true });
    const res = await postJson("/api/beispiel/review/thread", {
      chapter: "04-leer",
      text: "Faden im leeren Kapitel",
    });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf("04-leer/_chapter.md"), "utf8");
    expect(raw).toBe(
      "---\nid: 04-leer\ntitle: 04-leer\n---\n\n## Offene Fäden\n\n- [ ] Faden im leeren Kapitel\n",
    );
  });

  test("multi-line text collapses to a single item line", async () => {
    const res = await postJson("/api/beispiel/review/thread", {
      chapter: "04-leer",
      text: "  Zeile eins\n  Zeile zwei  ",
    });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf("04-leer/_chapter.md"), "utf8");
    expect(raw.endsWith("- [ ] Faden im leeren Kapitel\n- [ ] Zeile eins Zeile zwei\n")).toBe(true);
  });

  test("404 when the chapter directory is missing or reserved", async () => {
    expect(
      (await postJson("/api/beispiel/review/thread", { chapter: "99-nix", text: "x" })).status,
    ).toBe(404);
    // npcs/ exists as a directory but is not a chapter
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
  test("creates npcs/<id>.md with the documented shape", async () => {
    const res = await postJson("/api/beispiel/review/npc-stub", {
      id: "old-metta",
      name: "Old Metta",
      note: "Fischerin am Steg, kennt die Gezeiten #npc",
    });
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe("npcs/old-metta.md");
    expect(file.kind).toBe("npc");
    expect(file.frontmatter.status).toBe("unknown");
    const raw = await readFile(absOf("npcs/old-metta.md"), "utf8");
    expect(raw).toBe(
      "---\nid: old-metta\nname: Old Metta\nstatus: unknown\n---\n\n## Notizen\n\n- Fischerin am Steg, kennt die Gezeiten #npc\n",
    );
  });

  test("name defaults to the id; without a note the section stays empty", async () => {
    const res = await postJson("/api/beispiel/review/npc-stub", { id: "kai" });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf("npcs/kai.md"), "utf8");
    expect(raw).toBe("---\nid: kai\nname: kai\nstatus: unknown\n---\n\n## Notizen\n");
  });

  test("409 with { error, path } for an existing slug — file untouched", async () => {
    const before = await readFile(absOf("npcs/fenn.md"), "utf8");
    const res = await postJson("/api/beispiel/review/npc-stub", { id: "fenn", note: "doppelt" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; path: string };
    expect(typeof body.error).toBe("string");
    expect(body.path).toBe("npcs/fenn.md");
    expect(await readFile(absOf("npcs/fenn.md"), "utf8")).toBe(before);
    // and the stub created above also conflicts now
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

  test("rewrites ONLY the matching line — every other line byte-identical", async () => {
    const beforeLines = (await readFile(absOf("inbox.md"), "utf8")).split("\n");
    const idx = beforeLines.indexOf(DONE_TARGET);
    expect(idx).toBeGreaterThan(-1);

    const res = await postJson("/api/beispiel/review/inbox-done", { line: DONE_TARGET });
    expect(res.status).toBe(200);
    const afterLines = (await readFile(absOf("inbox.md"), "utf8")).split("\n");
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
    const before = await readFile(absOf("inbox.md"), "utf8");
    // original (now rewritten) form
    const res1 = await postJson("/api/beispiel/review/inbox-done", { line: DONE_TARGET });
    expect(res1.status).toBe(200);
    expect(await readFile(absOf("inbox.md"), "utf8")).toBe(before);
    // explicit done form
    const res2 = await postJson("/api/beispiel/review/inbox-done", {
      line: `- [x] ${DONE_TARGET.slice(2)}`,
    });
    expect(res2.status).toBe(200);
    expect(await readFile(absOf("inbox.md"), "utf8")).toBe(before);
  });

  test("only the FIRST of several identical lines is rewritten", async () => {
    const raw = await readFile(absOf("inbox.md"), "utf8");
    await writeFile(absOf("inbox.md"), `${raw}- Doppelt\n- Doppelt\n`, "utf8");
    const res = await postJson("/api/beispiel/review/inbox-done", { line: "- Doppelt" });
    expect(res.status).toBe(200);
    const after = await readFile(absOf("inbox.md"), "utf8");
    expect(after.endsWith("- [x] Doppelt\n- Doppelt\n")).toBe(true);
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

  test("404 when inbox.md itself is missing", async () => {
    await rm(absOf("inbox.md"));
    const res = await postJson("/api/beispiel/review/inbox-done", { line: "- egal" });
    expect(res.status).toBe(404);
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
