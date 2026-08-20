// Rename-cascade tests (issue #30). Like the other write tests these run
// against a TEMP COPY of the example campaign — examples/ is the committed
// format reference and must never be mutated. The copy is re-made before
// EVERY test: a rename moves files around, so tests must not inherit each
// other's filesystem.
//
// The recurring assertion is BYTE-EXACTNESS (issue #30 AK5, "nur
// Referenzstellen ändern sich"): every affected file is compared against the
// ORIGINAL example file with nothing but the id token substituted — quoting,
// spacing, comments and prose included.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CampaignTree } from "@grimoire/shared";
import { app } from "../src/server";
import { getCampaignRoot, setCampaignRoot } from "../src/config";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

let tmpRoot = "";
let originalRoot = "";

const absOf = (rel: string) => path.join(tmpRoot, "beispiel", rel);
const read = (rel: string) => readFile(absOf(rel), "utf8");
const exists = async (rel: string) => {
  try {
    await stat(absOf(rel));
    return true;
  } catch {
    return false;
  }
};

/** Original bytes of an example file (the untouched reference). */
const original = (rel: string) => readFile(path.join(EXAMPLES, "beispiel", rel), "utf8");

/** Everything after the frontmatter block's closing delimiter. */
function bodyOf(raw: string): string {
  const at = raw.indexOf("\n---\n");
  return at === -1 ? raw : raw.slice(at + "\n---\n".length);
}

interface RenameResponse {
  renamed: { from: string; to: string };
  changed: string[];
  dryRun?: boolean;
}

async function rename(body: unknown): Promise<Response> {
  return app.request("/api/beispiel/rename", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function renameOk(body: unknown): Promise<RenameResponse> {
  const res = await rename(body);
  expect(res.status).toBe(200);
  return (await res.json()) as RenameResponse;
}

/** mtimes of every markdown file of the campaign, by campaign-relative path. */
async function mtimes(rel = ""): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const dir = absOf(rel);
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      for (const [k, v] of await mtimes(childRel)) out.set(k, v);
    } else if (e.name.endsWith(".md")) {
      out.set(childRel, (await stat(absOf(childRel))).mtimeMs);
    }
  }
  return out;
}

beforeAll(async () => {
  originalRoot = getCampaignRoot();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "grimoire-rename-"));
  setCampaignRoot(tmpRoot);
});

afterAll(async () => {
  setCampaignRoot(originalRoot);
  await rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(path.join(tmpRoot, "beispiel"), { recursive: true, force: true });
  await cp(path.join(EXAMPLES, "beispiel"), path.join(tmpRoot, "beispiel"), { recursive: true });
});

const SCENE_A = "01-salzhafen/hafen/ankunft-leuchtturm.md";
const SCENE_B = "01-salzhafen/hafen/von-schmugglern-erwischt.md";
const SESSION = "sessions/2026-01-15.md";

describe("POST /api/:campaign/rename — npc", () => {
  test("cascade: file, own id, scene npcs arrays and the Beziehungen line", async () => {
    const fennBefore = await original("npcs/fenn.md");
    const sceneABodyBefore = bodyOf(await original(SCENE_A));

    const result = await renameOk({ kind: "npc", oldId: "jorna", newId: "hafenmeisterin" });

    expect(result.renamed).toEqual({ from: "npcs/jorna.md", to: "npcs/hafenmeisterin.md" });
    // von-schmugglern-erwischt.md mentions "Jorna" in a `## If:` heading —
    // prose, so it is NOT in the plan.
    expect(result.changed).toEqual([
      "01-salzhafen/hafen/ankunft-leuchtturm.md",
      "npcs/fenn.md",
      "npcs/hafenmeisterin.md",
    ]);

    // the file moved and is byte-identical apart from its own `id:` value —
    // the display name is not an id, the quickstats keep their `+2`
    expect(await exists("npcs/jorna.md")).toBe(false);
    const renamed = await read("npcs/hafenmeisterin.md");
    expect(renamed).toBe((await original("npcs/jorna.md")).replace("id: jorna", "id: hafenmeisterin"));
    expect(renamed).toContain("name: Hafenmeisterin Jorna\n");
    expect(renamed).toContain("quickstats: { insight: +2, passive-perception: 12 }\n");

    // fenn.md: the Beziehungen line, and ONLY the id token in it
    const fennAfter = await read("npcs/fenn.md");
    expect(fennAfter).toBe(fennBefore.replace("- jorna:", "- hafenmeisterin:"));
    expect(fennAfter).toContain("- hafenmeisterin: alte Bekannte; er weicht ihrem Blick aus\n");

    // the scene: the npcs member is rewritten, everything else — including the
    // quoted handout and the whole body — stays byte-identical
    const sceneA = await read(SCENE_A);
    expect(sceneA).toBe((await original(SCENE_A)).replace("npcs: [jorna]", "npcs: [hafenmeisterin]"));
    expect(sceneA).toContain('handouts: ["Karte von Salzhafen"]\n');
    expect(bodyOf(sceneA)).toBe(sceneABodyBefore);
    // the other scene never referenced jorna in frontmatter — untouched
    expect(await read(SCENE_B)).toBe(await original(SCENE_B));
  });

  test("prose mentions stay untouched", async () => {
    await renameOk({ kind: "npc", oldId: "fenn", newId: "schmugglerkapitaen" });
    const sceneB = await read(SCENE_B);
    // frontmatter reference rewritten …
    expect(sceneB).toContain("schmugglerkapitaen");
    // … while the prose keeps saying "Fenn" (and the glossary too)
    expect(sceneB).toContain("Fenn");
    expect(await read("glossary.md")).toBe(await original("glossary.md"));
  });

  test("unknown npc id -> 404, nothing written", async () => {
    const before = await mtimes();
    const res = await rename({ kind: "npc", oldId: "nobody", newId: "somebody" });
    expect(res.status).toBe(404);
    expect(await mtimes()).toEqual(before);
  });
});

describe("POST /api/:campaign/rename — location", () => {
  test("cascade: file, own id and scene `location` fields", async () => {
    const result = await renameOk({ kind: "location", oldId: "leuchtturm", newId: "salzturm" });
    expect(result.renamed).toEqual({
      from: "locations/leuchtturm.md",
      to: "locations/salzturm.md",
    });
    expect(result.changed).toEqual([
      "01-salzhafen/hafen/ankunft-leuchtturm.md",
      "locations/salzturm.md",
    ]);

    const moved = await read("locations/salzturm.md");
    // only the id line differs — the display name still says "Leuchtturm",
    // and the quoted roll20-page keeps its quotes
    expect(moved).toBe(
      (await original("locations/leuchtturm.md")).replace("id: leuchtturm", "id: salzturm"),
    );
    expect(moved).toContain('roll20-page: "Leuchtturm"\n');

    const sceneA = await read(SCENE_A);
    expect(sceneA).toBe(
      (await original(SCENE_A)).replace("location: leuchtturm", "location: salzturm"),
    );
    // the scene's FILE NAME still mentions the old location — file names are
    // not references (the group directory `hafen/` likewise stays put).
    expect(await exists(SCENE_A)).toBe(true);
  });
});

describe("POST /api/:campaign/rename — scene", () => {
  test("cascade: file, scenes_played and the log marker; log otherwise byte-identical", async () => {
    const sessionBefore = await original(SESSION);

    const result = await renameOk({
      kind: "scene",
      oldId: "lighthouse-arrival",
      newId: "ankunft-am-leuchtturm",
    });
    expect(result.renamed).toEqual({
      from: SCENE_A,
      to: "01-salzhafen/hafen/ankunft-am-leuchtturm.md",
    });
    expect(result.changed).toEqual([
      "01-salzhafen/hafen/ankunft-am-leuchtturm.md",
      "sessions/2026-01-15.md",
    ]);

    // the scene file moved inside its own chapter/group, only its id changed
    expect(await exists(SCENE_A)).toBe(false);
    const moved = await read("01-salzhafen/hafen/ankunft-am-leuchtturm.md");
    expect(moved).toBe(
      (await original(SCENE_A)).replace("id: lighthouse-arrival", "id: ankunft-am-leuchtturm"),
    );

    // session: scenes_played member plus the two log markers — and NOTHING
    // else, timestamps, em-dashes, quotes and hashtags included
    const session = await read(SESSION);
    expect(session).toBe(
      sessionBefore.replaceAll("lighthouse-arrival", "ankunft-am-leuchtturm"),
    );
    // the untimed lines and the hashtags survived verbatim
    expect(session).toContain("- 20:30 — Pause\n");
    expect(session).toContain(
      '- 21:10 (ankunft-am-leuchtturm) Improvisiert: Fischerin "Old Metta" am Steg #npc\n',
    );
  });

  test("a scene named in prose only (contingency note) is not rewritten", async () => {
    await renameOk({ kind: "scene", oldId: "smuggler-captured", newId: "in-der-bucht-erwischt" });
    // the note in ankunft-leuchtturm.md references the contingency as text
    expect(await read(SCENE_A)).toBe(await original(SCENE_A));
    expect(await exists("01-salzhafen/hafen/in-der-bucht-erwischt.md")).toBe(true);
  });
});

describe("POST /api/:campaign/rename — chapter", () => {
  test("renames the DIRECTORY, patches _chapter.md id and every `chapter:` field", async () => {
    const result = await renameOk({ kind: "chapter", oldId: "01-salzhafen", newId: "01-salzbucht" });
    expect(result.renamed).toEqual({ from: "01-salzhafen", to: "01-salzbucht" });
    expect(result.changed).toEqual([
      "01-salzbucht/_chapter.md",
      "01-salzbucht/hafen/ankunft-leuchtturm.md",
      "01-salzbucht/hafen/von-schmugglern-erwischt.md",
      "locations/leuchtturm.md",
      "npcs/fenn.md",
      "npcs/jorna.md",
    ]);

    expect(await exists("01-salzhafen")).toBe(false);
    // every touched file differs from the original in the chapter id ONLY
    // (the _chapter.md keeps its quoted title, the npc its quickstats)
    const swap = (raw: string) => raw.replaceAll("01-salzhafen", "01-salzbucht");
    expect(await read("01-salzbucht/_chapter.md")).toBe(
      swap(await original("01-salzhafen/_chapter.md")),
    );
    expect(await read("01-salzbucht/hafen/ankunft-leuchtturm.md")).toBe(
      swap(await original(SCENE_A)),
    );
    expect(await read("01-salzbucht/hafen/von-schmugglern-erwischt.md")).toBe(
      swap(await original(SCENE_B)),
    );
    expect(await read("npcs/jorna.md")).toBe(swap(await original("npcs/jorna.md")));
    expect(await read("npcs/fenn.md")).toBe(swap(await original("npcs/fenn.md")));
    expect(await read("locations/leuchtturm.md")).toBe(
      swap(await original("locations/leuchtturm.md")),
    );

    // the tree sees the new chapter with its scenes under the new paths
    const res = await app.request("/api/beispiel/tree");
    expect(res.status).toBe(200);
    const tree = (await res.json()) as CampaignTree;
    expect(tree.chapters.map((ch) => ch.id)).toEqual(["01-salzbucht"]);
    const chapter = tree.chapters[0]!;
    expect(chapter.path).toBe("01-salzbucht/_chapter.md");
    expect(chapter.groups.flatMap((g) => g.scenes.map((s) => s.path))).toEqual([
      "01-salzbucht/hafen/ankunft-leuchtturm.md",
      "01-salzbucht/hafen/von-schmugglern-erwischt.md",
    ]);
    // scene ids are untouched by a chapter rename
    expect(chapter.groups[0]!.scenes.map((s) => s.id)).toEqual([
      "lighthouse-arrival",
      "smuggler-captured",
    ]);
  });

  test("a reserved directory is not a chapter -> 404", async () => {
    const res = await rename({ kind: "chapter", oldId: "npcs", newId: "leute" });
    expect(res.status).toBe(404);
    expect(await exists("npcs/jorna.md")).toBe(true);
  });
});

describe("POST /api/:campaign/rename — YAML shapes", () => {
  const EXTRA = "01-salzhafen/hafen/block-shapes.md";
  const BLOCK = `---
id: block-shapes
title: Blockformen
chapter: 01-salzhafen
location: "leuchtturm"   # zitiert, mit Kommentar
npcs:
  - jorna
  - 'fenn'
tags: [social]
---

## Flow

Jorna steht am Steg.
`;

  test("block sequences, quoted values and trailing comments survive verbatim", async () => {
    await writeFile(absOf(EXTRA), BLOCK, "utf8");

    await renameOk({ kind: "npc", oldId: "jorna", newId: "hafenmeisterin" });
    expect(await read(EXTRA)).toBe(BLOCK.replace("  - jorna", "  - hafenmeisterin"));

    await renameOk({ kind: "location", oldId: "leuchtturm", newId: "salzturm" });
    expect(await read(EXTRA)).toBe(
      BLOCK.replace("  - jorna", "  - hafenmeisterin").replace(
        'location: "leuchtturm"',
        'location: "salzturm"',
      ),
    );
  });

  test("an exotic YAML shape falls back to the raw patch — reference still fixed", async () => {
    await writeFile(
      absOf(EXTRA),
      `---\nid: folded-shape\ntitle: Gefaltet\nlocation: >-\n  leuchtturm\n---\n\n## Flow\n\nText.\n`,
      "utf8",
    );
    const result = await renameOk({ kind: "location", oldId: "leuchtturm", newId: "salzturm" });
    expect(result.changed).toContain(EXTRA);
    const after = await read(EXTRA);
    // the YAML block was re-emitted (documented fallback), the reference is
    // correct and the body is byte-identical
    expect(after).toContain("location: salzturm");
    expect(bodyOf(after)).toBe("\n## Flow\n\nText.\n");
  });
});

describe("POST /api/:campaign/rename — dry run", () => {
  test("returns the same plan and writes nothing", async () => {
    const before = await mtimes();
    const res = await rename({
      kind: "npc",
      oldId: "jorna",
      newId: "hafenmeisterin",
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const plan = (await res.json()) as RenameResponse;
    expect(plan.dryRun).toBe(true);
    expect(plan.renamed).toEqual({ from: "npcs/jorna.md", to: "npcs/hafenmeisterin.md" });
    expect(plan.changed).toEqual([
      "01-salzhafen/hafen/ankunft-leuchtturm.md",
      "npcs/fenn.md",
      "npcs/hafenmeisterin.md",
    ]);

    expect(await mtimes()).toEqual(before);
    expect(await exists("npcs/jorna.md")).toBe(true);
    expect(await exists("npcs/hafenmeisterin.md")).toBe(false);

    // and the real call afterwards produces exactly the previewed plan
    const done = await renameOk({ kind: "npc", oldId: "jorna", newId: "hafenmeisterin" });
    expect(done.changed).toEqual(plan.changed);
    expect(done.renamed).toEqual(plan.renamed);
    expect(done.dryRun).toBeUndefined();
  });
});

describe("POST /api/:campaign/rename — validation", () => {
  test("collision -> 409 with the target path, nothing written", async () => {
    const before = await mtimes();
    const res = await rename({ kind: "npc", oldId: "jorna", newId: "fenn" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ path: "npcs/fenn.md" });
    expect(await mtimes()).toEqual(before);
  });

  test("chapter collision against an existing directory -> 409", async () => {
    await cp(absOf("01-salzhafen"), absOf("02-tiefwasser"), { recursive: true });
    const res = await rename({ kind: "chapter", oldId: "01-salzhafen", newId: "02-tiefwasser" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ path: "02-tiefwasser" });
    expect(await exists("01-salzhafen/_chapter.md")).toBe(true);
  });

  test("same id -> 400, nothing written", async () => {
    const before = await mtimes();
    const res = await rename({ kind: "npc", oldId: "jorna", newId: "jorna" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("nothing to rename");
    expect(await mtimes()).toEqual(before);
  });

  test("unknown kind -> 400", async () => {
    const res = await rename({ kind: "session", oldId: "2026-01-15", newId: "2026-01-16" });
    expect(res.status).toBe(400);
  });

  test("non-kebab newId -> 400", async () => {
    for (const newId of ["Hafen Meisterin", "hafen_meisterin", "-hafen", "hafen--meisterin", ""]) {
      const res = await rename({ kind: "npc", oldId: "jorna", newId });
      expect(res.status).toBe(400);
    }
    expect(await exists("npcs/jorna.md")).toBe(true);
  });

  test("reserved newId -> 400", async () => {
    for (const kind of ["npc", "chapter"] as const) {
      const oldId = kind === "npc" ? "jorna" : "01-salzhafen";
      const res = await rename({ kind, oldId, newId: "sessions" });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("reserved");
    }
  });

  test("traversal in oldId -> 400, unknown body key -> 400", async () => {
    expect((await rename({ kind: "chapter", oldId: "../beispiel", newId: "x-y" })).status).toBe(400);
    expect(
      (await rename({ kind: "npc", oldId: "jorna", newId: "x-y", nope: true })).status,
    ).toBe(400);
  });

  test("unknown campaign -> 404", async () => {
    const res = await app.request("/api/gibtsnicht/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "jorna", newId: "x-y" }),
    });
    expect(res.status).toBe(404);
  });
});
