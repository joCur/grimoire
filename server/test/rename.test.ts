// Rename-cascade tests (issue #30, ported to the database in issue #57).
//
// The rename is a primary-key UPDATE with a cascade now (store/rename.ts), so
// the assertions changed their MEDIUM but not their subject: every reference
// site is read back THROUGH THE API — the scene's `npcs` list, the
// counterpart's `## Beziehungen` line, the scene's `location`, the session's
// `scenes_played` and its log markers, the `chapter` fields of npcs,
// locations and scenes. That is the contract the app sees; the bytes of a
// file are not a thing any more.
//
// What byte-exactness became: the surrounding VALUES must survive a rename
// untouched (a display name that happens to contain the old id, quickstats,
// the `roll20-page`, the log's timestamps and hashtags). Those are asserted
// individually, because that is what "nur Referenzstellen ändern sich"
// (AK5) means once the values live in columns.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignTree, FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import type { UsageReport } from "../src/store/usage";
import { dropStore, seedStore } from "./support/store";

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

const SCENE_A = "01-salzhafen/hafen/lighthouse-arrival";
const SCENE_B = "01-salzhafen/hafen/smuggler-captured";
const SESSION = "sessions/2026-01-15";

interface RenameResponse {
  renamed: { from: string; to: string };
  changed: string[];
  /** The reference counts behind `changed` (issue #60). */
  usage: UsageReport;
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

/** GET /usage — the reference counts of one entity (issue #60). */
async function usageOf(kind: string, id: string): Promise<UsageReport> {
  const res = await app.request(`/api/beispiel/usage?kind=${kind}&id=${encodeURIComponent(id)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as UsageReport;
}

/** GET /file — the way the app sees an entity. */
async function read(rel: string): Promise<FileResponse> {
  const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

/** Whether an address resolves at all (404 = the entity is not there). */
async function exists(rel: string): Promise<boolean> {
  const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
  return res.status === 200;
}

async function tree(): Promise<CampaignTree> {
  const res = await app.request("/api/beispiel/tree");
  expect(res.status).toBe(200);
  return (await res.json()) as CampaignTree;
}

/**
 * The campaign's version counter — the successor of the rev snapshot the
 * file version compared: a rename bumps it in its own transaction, so an
 * UNCHANGED counter is the proof that nothing was written.
 */
async function version(): Promise<number> {
  const res = await app.request("/api/beispiel/version");
  expect(res.status).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

describe("POST /api/:campaign/rename — npc", () => {
  test("cascade: own id, scene npcs list and the Beziehungen counterpart", async () => {
    const result = await renameOk({ kind: "npc", oldId: "jorna", newId: "hafenmeisterin" });

    expect(result.renamed).toEqual({ from: "npcs/jorna", to: "npcs/hafenmeisterin" });
    // von-schmugglern-erwischt mentions "Jorna" in a `## If:` heading —
    // prose, so it is NOT in the plan.
    expect(result.changed).toEqual([
      SCENE_A,
      "npcs/fenn",
      "npcs/hafenmeisterin",
    ]);

    // the npc is addressed by its new id, and everything that is NOT an id
    // survived: the display name still says Jorna, the quickstats are intact
    expect(await exists("npcs/jorna")).toBe(false);
    const renamed = await read("npcs/hafenmeisterin");
    expect(renamed.properties.id).toBe("hafenmeisterin");
    expect(renamed.properties.name).toBe("Hafenmeisterin Jorna");
    expect(renamed.properties.quickstats).toEqual({ insight: 2, "passive-perception": 12 });

    // fenn's `## Beziehungen` names the counterpart by ID — it followed
    const fenn = await read("npcs/fenn");
    expect(fenn.body).toContain("- hafenmeisterin: alte Bekannte; er weicht ihrem Blick aus");
    expect(fenn.body).not.toContain("- jorna:");

    // the scene: the npcs member is rewritten, nothing else about it moves
    const sceneA = await read(SCENE_A);
    expect(sceneA.properties.npcs).toEqual(["hafenmeisterin"]);
    expect(sceneA.properties.handouts).toEqual(["Karte von Salzhafen"]);
    expect(sceneA.properties.location).toBe("leuchtturm");
    // the other scene never referenced jorna in properties — untouched
    expect((await read(SCENE_B)).properties.npcs).toEqual(["fenn"]);
  });

  test("prose mentions stay untouched", async () => {
    await renameOk({ kind: "npc", oldId: "fenn", newId: "schmugglerkapitaen" });
    const sceneB = await read(SCENE_B);
    // properties reference rewritten …
    expect(sceneB.properties.npcs).toEqual(["schmugglerkapitaen"]);
    // … while the prose keeps saying "Fenn"
    expect(sceneB.body).toContain("Fenn");
    // and the glossary, which is prose about the WORLD, is not a reference site
    expect((await read("glossary")).body).toContain("lighthouse keeper → Leuchtturmwärter");
  });

  test("a display name that was the id's fallback follows the id", async () => {
    // `npcs/jorna` with `name: jorna` never had a real name — the id was
    // the fallback, spelled out. Leaving it behind means the tree and the
    // search title keep naming a reference that no longer exists.
    const before = await read("npcs/jorna");
    const patched = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "npcs/jorna",
        rev: before.rev,
        patch: { name: "jorna" },
      }),
    });
    expect(patched.status).toBe(200);

    await renameOk({ kind: "npc", oldId: "jorna", newId: "hafenmeisterin" });
    expect((await read("npcs/hafenmeisterin")).properties.name).toBe("hafenmeisterin");
    const npc = (await tree()).npcs.find((n) => n.id === "hafenmeisterin");
    expect(npc?.name).toBe("hafenmeisterin");
  });

  test("a REAL display name is not touched by a rename", async () => {
    await renameOk({ kind: "npc", oldId: "jorna", newId: "hafenmeisterin" });
    expect((await read("npcs/hafenmeisterin")).properties.name).toBe("Hafenmeisterin Jorna");
  });

  test("unknown npc id -> 404, nothing written", async () => {
    const before = await version();
    const res = await rename({ kind: "npc", oldId: "nobody", newId: "somebody" });
    expect(res.status).toBe(404);
    expect(await version()).toBe(before);
  });
});

describe("POST /api/:campaign/rename — location", () => {
  test("cascade: own id and scene `location` fields", async () => {
    const result = await renameOk({ kind: "location", oldId: "leuchtturm", newId: "salzturm" });
    expect(result.renamed).toEqual({
      from: "locations/leuchtturm",
      to: "locations/salzturm",
    });
    expect(result.changed).toEqual([SCENE_A, "locations/salzturm"]);

    expect(await exists("locations/leuchtturm")).toBe(false);
    const moved = await read("locations/salzturm");
    expect(moved.properties.id).toBe("salzturm");
    // only the id changed — the display name still says "Leuchtturm", and so
    // does the roll20 page (a label, not a reference)
    expect(moved.properties.name).toBe("Der Leuchtturm von Salzhafen");
    expect(moved.properties["roll20-page"]).toBe("Leuchtturm");

    expect((await read(SCENE_A)).properties.location).toBe("salzturm");
    // the scene keeps its own address — a location rename never moves scenes
    expect(await exists(SCENE_A)).toBe(true);
  });
});

describe("POST /api/:campaign/rename — scene", () => {
  test("cascade: own address, scenes_played and the log markers", async () => {
    const sessionBefore = (await read(SESSION)).body;
    const result = await renameOk({
      kind: "scene",
      oldId: "lighthouse-arrival",
      newId: "ankunft-am-leuchtturm",
    });
    expect(result.renamed).toEqual({
      from: SCENE_A,
      to: "01-salzhafen/hafen/ankunft-am-leuchtturm",
    });
    expect(result.changed).toEqual([
      "01-salzhafen/hafen/ankunft-am-leuchtturm",
      SESSION,
    ]);

    // the scene is addressed by its new id inside the SAME chapter/group —
    // its path segment IS the id since the cutover (store/paths)
    expect(await exists(SCENE_A)).toBe(false);
    const moved = await read("01-salzhafen/hafen/ankunft-am-leuchtturm");
    expect(moved.properties.id).toBe("ankunft-am-leuchtturm");
    expect(moved.properties.title).toBe("Ankunft am Leuchtturm");

    // the session: `scenes_played` plus the two log markers — and NOTHING
    // else, timestamps, em-dashes, quotes and hashtags included
    const session = await read(SESSION);
    expect(session.properties.scenes_played).toEqual(["ankunft-am-leuchtturm"]);
    expect(session.body).toContain(
      "- 19:52 (ankunft-am-leuchtturm) Spuren gefunden, Gruppe will sofort zur Bucht #decision",
    );
    expect(session.body).toContain(
      '- 21:10 (ankunft-am-leuchtturm) Improvisiert: Fischerin "Old Metta" am Steg #npc',
    );
    // the untimed lines survived verbatim
    expect(session.body).toContain("- 20:30 — Pause");
    expect(session.body).toContain("- 22:40 — Cliffhanger: Lichter in der Bucht gesichtet #thread");
    expect(session.body).not.toContain("lighthouse-arrival");
    // PORTED from the file era ("log otherwise byte-identical"): the WHOLE
    // rendered session differs from before by nothing but the id token —
    // timestamps, em-dashes, quotes, hashtags and blank lines included.
    expect(session.body).toBe(sessionBefore.replaceAll("lighthouse-arrival", "ankunft-am-leuchtturm"));

    // the tree names the scene by its new id, under its new path
    const chapter = (await tree()).chapters[0]!;
    expect(chapter.groups[0]!.scenes.map((s) => s.id)).toEqual([
      "ankunft-am-leuchtturm",
      "smuggler-captured",
    ]);
  });

  test("only the log MARKER moves — the same token in free text stays", async () => {
    // `raw.replace("(id)", …)` replaced the first occurrence anywhere, free
    // text included. The rewrite is anchored on the timestamp, exactly as the
    // file cascade was: `- HH:MM (<id>) …` is a reference, prose is not.
    expect((await app.request("/api/beispiel/session/start", { method: "POST" })).status).toBe(200);
    const logged = await app.request("/api/beispiel/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Rückverweis auf (smuggler-captured) im Text",
        sceneId: "smuggler-captured",
      }),
    });
    expect(logged.status).toBe(200);
    const sessionPath = ((await logged.json()) as FileResponse).path;

    await renameOk({ kind: "scene", oldId: "smuggler-captured", newId: "in-der-bucht-erwischt" });

    const body = (await read(sessionPath)).body;
    expect(body).toContain("(in-der-bucht-erwischt) Rückverweis auf (smuggler-captured) im Text");
  });

  test("a scene named in prose only (contingency note) is not rewritten", async () => {
    const before = (await read(SCENE_A)).body;
    await renameOk({ kind: "scene", oldId: "smuggler-captured", newId: "in-der-bucht-erwischt" });
    // the note in the other scene references the contingency as TEXT
    expect((await read(SCENE_A)).body).toBe(before);
    expect(await exists("01-salzhafen/hafen/in-der-bucht-erwischt")).toBe(true);
  });
});

describe("POST /api/:campaign/rename — chapter", () => {
  test("moves every scene's address and patches every `chapter:` field", async () => {
    const result = await renameOk({ kind: "chapter", oldId: "01-salzhafen", newId: "01-salzbucht" });
    // a chapter is addressed by its `_chapter` — there is no directory to
    // rename any more, so the plan speaks in documents throughout
    expect(result.renamed).toEqual({
      from: "01-salzhafen/_chapter",
      to: "01-salzbucht/_chapter",
    });
    expect(result.changed).toEqual([
      "01-salzbucht/_chapter",
      "01-salzbucht/hafen/lighthouse-arrival",
      "01-salzbucht/hafen/smuggler-captured",
      "locations/leuchtturm",
      "npcs/fenn",
      "npcs/jorna",
    ]);

    expect(await exists("01-salzhafen/_chapter")).toBe(false);
    const chapterFile = await read("01-salzbucht/_chapter");
    expect(chapterFile.properties.id).toBe("01-salzbucht");
    // the title mentions the OLD name in prose — it is a title, not a reference
    expect(chapterFile.properties.title).toBe("Kapitel 1: Der Leuchtturm von Salzhafen");
    expect(chapterFile.properties.status).toBe("active");

    // every entity that names the chapter follows
    expect((await read("01-salzbucht/hafen/lighthouse-arrival")).properties.chapter).toBe(
      "01-salzbucht",
    );
    expect((await read("01-salzbucht/hafen/smuggler-captured")).properties.chapter).toBe(
      "01-salzbucht",
    );
    expect((await read("npcs/jorna")).properties.chapter).toBe("01-salzbucht");
    expect((await read("npcs/fenn")).properties.chapter).toBe("01-salzbucht");
    expect((await read("locations/leuchtturm")).properties.chapter).toBe("01-salzbucht");

    // the tree sees the new chapter with its scenes under the new paths
    const campaignTree = await tree();
    expect(campaignTree.chapters.map((ch) => ch.id)).toEqual(["01-salzbucht"]);
    const chapter = campaignTree.chapters[0]!;
    expect(chapter.path).toBe("01-salzbucht/_chapter");
    expect(chapter.groups.flatMap((g) => g.scenes.map((s) => s.path))).toEqual([
      "01-salzbucht/hafen/lighthouse-arrival",
      "01-salzbucht/hafen/smuggler-captured",
    ]);
    // scene ids are untouched by a chapter rename
    expect(chapter.groups[0]!.scenes.map((s) => s.id)).toEqual([
      "lighthouse-arrival",
      "smuggler-captured",
    ]);
  });

  test("a reserved name is not a chapter -> 404", async () => {
    const res = await rename({ kind: "chapter", oldId: "npcs", newId: "leute" });
    expect(res.status).toBe(404);
    expect(await exists("npcs/jorna")).toBe(true);
  });
});

// The "YAML shapes" block of the file era is gone: block sequences, quoted
// scalars and trailing comments were properties of the TEXT a rename had to
// patch. References are columns now (schema.ts), so there is no YAML shape
// left for a rename to preserve or to re-emit — what a value looks like when
// it is rendered back is store/render.ts's contract and is tested there.

describe("POST /api/:campaign/rename — dry run", () => {
  test("returns the same plan and writes nothing", async () => {
    const before = await version();
    const res = await rename({
      kind: "npc",
      oldId: "jorna",
      newId: "hafenmeisterin",
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const plan = (await res.json()) as RenameResponse;
    expect(plan.dryRun).toBe(true);
    expect(plan.renamed).toEqual({ from: "npcs/jorna", to: "npcs/hafenmeisterin" });
    expect(plan.changed).toEqual([SCENE_A, "npcs/fenn", "npcs/hafenmeisterin"]);

    expect(await version()).toBe(before);
    expect(await exists("npcs/jorna")).toBe(true);
    expect(await exists("npcs/hafenmeisterin")).toBe(false);

    // and the real call afterwards produces exactly the previewed plan
    const done = await renameOk({ kind: "npc", oldId: "jorna", newId: "hafenmeisterin" });
    expect(done.changed).toEqual(plan.changed);
    expect(done.renamed).toEqual(plan.renamed);
    expect(done.dryRun).toBeUndefined();
  });

  // Issue #60: the preview's numbers ARE the cascade's numbers — one set of
  // queries answers both (store/usage.ts). The proof is the round trip: what
  // the dry run counted for the old id is what the new id carries afterwards.
  test.each(["npc", "location", "scene", "chapter"] as const)(
    "dryRun usage counts match the rows the real rename moved (%s)",
    async (kind) => {
      const oldId = {
        npc: "jorna",
        location: "leuchtturm",
        scene: "lighthouse-arrival",
        chapter: "01-salzhafen",
      }[kind];
      const newId = "neu-getauft";

      const before = await usageOf(kind, oldId);
      const plan = await renameOk({ kind, oldId, newId, dryRun: true });
      // The plan reports the usage of the id it is about to move …
      expect(plan.usage).toEqual(before);
      expect(plan.usage.total).toBeGreaterThan(0);

      await renameOk({ kind, oldId, newId });

      // … and the rows now hang off the NEW id, group for group.
      const after = await usageOf(kind, newId);
      expect(after.total).toBe(plan.usage.total);
      expect(after.groups.map((g) => [g.ref, g.count])).toEqual(
        plan.usage.groups.map((g) => [g.ref, g.count]),
      );
      // Nothing is left pointing at the old id.
      expect((await app.request(`/api/beispiel/usage?kind=${kind}&id=${oldId}`)).status).toBe(404);
    },
  );
});

describe("POST /api/:campaign/rename — validation", () => {
  test("collision -> 409 with the target path, nothing written", async () => {
    const before = await version();
    const res = await rename({ kind: "npc", oldId: "jorna", newId: "fenn" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ path: "npcs/fenn" });
    expect(await version()).toBe(before);
    expect(await exists("npcs/jorna")).toBe(true);
  });

  test("chapter collision against an existing chapter -> 409", async () => {
    // A second chapter, created the way the app creates one (the generator's
    // new-chapter flow) — the example campaign has only one.
    const created = await app.request("/api/beispiel/generate/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenes: [
          {
            path: "02-tiefwasser/erste-szene.md",
            markdown:
              "---\nid: tiefwasser-ankunft\ntitle: Ankunft in Tiefwasser\ntype: planned\n" +
              "chapter: 02-tiefwasser\nnpcs: []\nhandouts: []\ntags: []\nstatus: draft\n---\n\n" +
              "## Flow\n\nDie Gruppe erreicht Tiefwasser.\n",
          },
        ],
        chapter: "02-tiefwasser",
        chapterTitle: "Kapitel 2: Tiefwasser",
      }),
    });
    expect(created.status).toBe(200);

    const res = await rename({ kind: "chapter", oldId: "01-salzhafen", newId: "02-tiefwasser" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ path: "02-tiefwasser/_chapter" });
    expect(await exists("01-salzhafen/_chapter")).toBe(true);
  });

  test("same id -> 400, nothing written", async () => {
    const before = await version();
    const res = await rename({ kind: "npc", oldId: "jorna", newId: "jorna" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("nothing to rename");
    expect(await version()).toBe(before);
  });

  test("unknown kind -> 400", async () => {
    // Sessions have no id to rename (their id IS their date) — the kind list
    // is npc/location/scene/chapter.
    const res = await rename({ kind: "session", oldId: "2026-01-15", newId: "2026-01-16" });
    expect(res.status).toBe(400);
  });

  test("non-kebab newId -> 400", async () => {
    for (const newId of ["Hafen Meisterin", "hafen_meisterin", "-hafen", "hafen--meisterin", ""]) {
      const res = await rename({ kind: "npc", oldId: "jorna", newId });
      expect(res.status).toBe(400);
    }
    expect(await exists("npcs/jorna")).toBe(true);
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

  // The file era's "ambiguous id — N files claim it" case is gone: an id is
  // the primary key of its table now, so two rows can never claim one id.
});
