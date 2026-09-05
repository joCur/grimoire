// GET /api/:campaign/usage — reference counting (issue #60).
//
// One case per reference kind, all of them against the SEED campaign
// (`examples/`, the suite's fixture — CLAUDE.md): the example tree happens to
// exercise every group exactly once, which is the reason the expected numbers
// below can be spelled out instead of computed.
//
// What is NOT in `examples/` is repetition — a scene played twice in one
// evening, a second session — and that is what separates "rows" from
// "documents" in the answer. Those cases get a hand-built campaign root.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { app } from "../src/server";
import type { UsageReport } from "../src/store/usage";
import {
  dropStore,
  removeTempRoot,
  seedStore,
  tempCampaignRoot,
  useCampaignRoot,
} from "./support/store";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

async function usageRes(query: string): Promise<Response> {
  return app.request(`/api/beispiel/usage?${query}`);
}

async function usage(kind: string, id: string): Promise<UsageReport> {
  const res = await usageRes(`kind=${kind}&id=${encodeURIComponent(id)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as UsageReport;
}

/** The group of one reference kind, or undefined when there is none. */
function group(report: UsageReport, ref: string) {
  return report.groups.find((g) => g.ref === ref);
}

describe("usage per reference kind", () => {
  test("npc: scene `npcs:` lists and `## Beziehungen` in both directions", async () => {
    const report = await usage("npc", "jorna");

    expect(report.kind).toBe("npc");
    expect(report.id).toBe("jorna");
    expect(report.path).toBe("npcs/jorna.md");

    // `npcs: [jorna]` of the arrival scene.
    expect(group(report, "sceneNpcs")).toEqual({
      ref: "sceneNpcs",
      count: 1,
      sites: [
        {
          kind: "scene",
          id: "lighthouse-arrival",
          title: "Ankunft am Leuchtturm",
          path: "01-salzhafen/hafen/lighthouse-arrival.md",
          count: 1,
        },
      ],
    });

    // BOTH directions: jorna's own line about fenn, and fenn's line about
    // jorna — two rows carrying the id, in two documents.
    const relations = group(report, "npcRelations");
    expect(relations?.count).toBe(2);
    expect(relations?.sites.map((s) => s.path).sort()).toEqual([
      "npcs/fenn.md",
      "npcs/jorna.md",
    ]);

    expect(report.total).toBe(3);
  });

  test("location: scene `location:` frontmatter", async () => {
    const report = await usage("location", "leuchtturm");

    expect(group(report, "sceneLocation")).toEqual({
      ref: "sceneLocation",
      count: 1,
      sites: [
        {
          kind: "scene",
          id: "lighthouse-arrival",
          title: "Ankunft am Leuchtturm",
          path: "01-salzhafen/hafen/lighthouse-arrival.md",
          count: 1,
        },
      ],
    });
    expect(report.total).toBe(1);
  });

  test("scene: session `scenes_played:` and log scene markers", async () => {
    const report = await usage("scene", "lighthouse-arrival");

    expect(group(report, "scenesPlayed")).toEqual({
      ref: "scenesPlayed",
      count: 1,
      sites: [
        {
          kind: "session",
          id: "2026-01-15",
          title: "2026-01-15",
          path: "sessions/2026-01-15.md",
          count: 1,
        },
      ],
    });

    // TWO log lines carry the marker, in ONE session: the group counts rows,
    // the site counts the rows of that document.
    const log = group(report, "logEntries");
    expect(log?.count).toBe(2);
    expect(log?.sites).toEqual([
      {
        kind: "session",
        id: "2026-01-15",
        title: "2026-01-15",
        path: "sessions/2026-01-15.md",
        count: 2,
      },
    ]);

    expect(report.total).toBe(3);
  });

  test("chapter: its scenes, npcs and locations", async () => {
    const report = await usage("chapter", "01-salzhafen");

    expect(group(report, "chapterScenes")?.count).toBe(2);
    expect(group(report, "chapterScenes")?.sites.map((s) => s.id).sort()).toEqual([
      "lighthouse-arrival",
      "smuggler-captured",
    ]);
    expect(group(report, "chapterNpcs")?.count).toBe(2);
    expect(group(report, "chapterNpcs")?.sites.map((s) => s.path).sort()).toEqual([
      "npcs/fenn.md",
      "npcs/jorna.md",
    ]);
    expect(group(report, "chapterLocations")).toEqual({
      ref: "chapterLocations",
      count: 1,
      sites: [
        {
          kind: "location",
          id: "leuchtturm",
          title: "Der Leuchtturm von Salzhafen",
          path: "locations/leuchtturm.md",
          count: 1,
        },
      ],
    });
    expect(report.total).toBe(5);
  });

  test("an entity nothing points at answers with an empty report", async () => {
    // The contingency scene was never played and carries no log marker.
    const report = await usage("scene", "smuggler-captured");
    expect(report.groups).toEqual([]);
    expect(report.total).toBe(0);
    expect(report.path).toBe("01-salzhafen/hafen/smuggler-captured.md");
  });

  test("a free-string location is not an entity — 404, not an empty report", async () => {
    // `location: bucht` is legal (README: an id OR free text) but has no
    // locations/bucht.md, so there is nothing to report ON. The scenes that
    // carry it stay countable through their chapter.
    expect((await usageRes("kind=location&id=bucht")).status).toBe(404);
    const report = await usage("chapter", "01-salzhafen");
    expect(group(report, "chapterScenes")?.count).toBe(2);
  });
});

describe("usage errors", () => {
  test("404 for an entity that does not exist", async () => {
    expect((await usageRes("kind=npc&id=nobody")).status).toBe(404);
  });

  test("404 for an unknown campaign", async () => {
    const res = await app.request("/api/keine/usage?kind=npc&id=jorna");
    expect(res.status).toBe(404);
  });

  test("400 for an unknown or missing kind and for an empty id", async () => {
    expect((await usageRes("kind=session&id=2026-01-15")).status).toBe(400);
    expect((await usageRes("id=jorna")).status).toBe(400);
    expect((await usageRes("kind=npc&id=")).status).toBe(400);
    expect((await usageRes("kind=npc&id=%20")).status).toBe(400);
  });
});

describe("rows vs documents", () => {
  let root: string;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    if (root !== undefined) await removeTempRoot(root);
  });

  test("a scene played twice and in two sessions counts rows per document", async () => {
    root = await tempCampaignRoot();
    const first = path.join(root, "beispiel/sessions/2026-01-15.md");
    const raw = await readFile(first, "utf8");
    // The party returned to the scene later the same evening.
    await writeFile(
      first,
      raw.replace(
        "scenes_played: [lighthouse-arrival]",
        "scenes_played: [lighthouse-arrival, smuggler-captured, lighthouse-arrival]",
      ),
    );
    await writeFile(
      path.join(root, "beispiel/sessions/2026-01-22.md"),
      [
        "---",
        "id: 2026-01-22",
        "started: 2026-01-22T19:30",
        "ended: 2026-01-22T22:00",
        "scenes_played: [lighthouse-arrival]",
        "---",
        "",
        "## Log",
        "",
        "- 20:05 (lighthouse-arrival) Rückweg über die Klippen",
        "",
      ].join("\n"),
    );

    restore = useCampaignRoot(root);
    await seedStore(root);

    const report = await usage("scene", "lighthouse-arrival");
    const played = group(report, "scenesPlayed");
    // 2 rows in the first session + 1 in the second = 3 rows, 2 documents.
    expect(played?.count).toBe(3);
    expect(played?.sites).toEqual([
      {
        kind: "session",
        id: "2026-01-15",
        title: "2026-01-15",
        path: "sessions/2026-01-15.md",
        count: 2,
      },
      {
        kind: "session",
        id: "2026-01-22",
        title: "2026-01-22",
        path: "sessions/2026-01-22.md",
        count: 1,
      },
    ]);
    expect(group(report, "logEntries")?.count).toBe(3);
    expect(report.total).toBe(6);
  });
});
