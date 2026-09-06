// Read-API tests against the DATABASE (issue #57), seeded through the real
// markdown importer from the example campaign — examples/ is the committed
// format reference and stays the fixture of the whole suite (see
// test/support/store.ts). The Hono app runs in-process via app.request() —
// no live port needed.
//
// What the cutover changed for these tests, and nothing else:
//   - `mtimeMs` is the row's `rev` (an opaque guard token that starts at 1),
//     not a filesystem mtime — so there is nothing left to `stat`.
//   - a scene's path segment is its ID, not its former file name
//     (store/paths.ts): ankunft-leuchtturm.md is addressed as
//     01-salzhafen/hafen/lighthouse-arrival.md.
// Every status code, ordering and response field below is the one the
// file-tree reader answered with.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CampaignSummary, CampaignTree, FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, emptyStore, seedStore } from "./support/store";

describe("GET /api/campaigns", () => {
  const campaigns = async (): Promise<CampaignSummary[]> => {
    const res = await app.request("/api/campaigns");
    expect(res.status).toBe(200);
    return (await res.json()) as CampaignSummary[];
  };

  describe("seeded from examples/", () => {
    beforeEach(async () => {
      await seedStore();
    });
    afterEach(() => {
      dropStore();
    });

    test("lists example campaign directories", async () => {
      const body = await campaigns();
      // The example campaign carries a _campaign.md (issue #17), so name and
      // description come along additively.
      expect(body).toContainEqual({
        id: "beispiel",
        lastSession: "2026-01-15",
        lastSessionStarted: "2026-01-15T19:30",
        name: "Der Leuchtturm von Salzhafen",
        description: expect.any(String),
      });
      // Only campaign rows, never a file name that happened to sit in the
      // root of the tree the migration read.
      for (const c of body) {
        expect(c.id.startsWith(".")).toBe(false);
        expect(c.id.endsWith(".md")).toBe(false);
      }
    });

    test("lastSession/lastSessionStarted name the newest session of the example", async () => {
      const beispiel = (await campaigns()).find((c) => c.id === "beispiel");
      expect(beispiel?.lastSession).toBe("2026-01-15");
      // `lastSessionStarted` is the ORDERABLE half (issue #58): the id is
      // opaque for every session written since, so the app sorts by this.
      expect(beispiel?.lastSessionStarted).toBe("2026-01-15T19:30");
    });

    test("name/description come from examples/beispiel/_campaign.md", async () => {
      const beispiel = (await campaigns()).find((c) => c.id === "beispiel");
      expect(beispiel?.name).toBe("Der Leuchtturm von Salzhafen");
      expect(beispiel?.description).toContain("Leuchtturm");
    });
  });

  describe("in a temp root", () => {
    let tmpRoot: string;

    beforeAll(async () => {
      tmpRoot = await mkdtemp(path.join(os.tmpdir(), "grimoire-campaigns-"));
      // One campaign with two sessions (the later id must win) …
      await mkdir(path.join(tmpRoot, "mit-sessions", "sessions"), { recursive: true });
      await writeFile(path.join(tmpRoot, "mit-sessions", "sessions", "2026-02-01.md"), "---\n---\n");
      await writeFile(path.join(tmpRoot, "mit-sessions", "sessions", "2026-03-09.md"), "---\n---\n");
      // … one without a sessions directory at all, and one with an empty one.
      await mkdir(path.join(tmpRoot, "ohne-sessions"), { recursive: true });
      await mkdir(path.join(tmpRoot, "leere-sessions", "sessions"), { recursive: true });

      // Campaign-metadata files (issue #17) in every degradation flavour.
      const campaignFile = async (id: string, content: string) => {
        await mkdir(path.join(tmpRoot, id), { recursive: true });
        await writeFile(path.join(tmpRoot, id, "_campaign.md"), content);
      };
      await campaignFile(
        "mit-meta",
        "---\nid: mit-meta\nname: Tyranny of Dragons\ndescription: Drachen, überall.\nsystem: D&D 5e\n---\n\nNotizen.\n",
      );
      await campaignFile("kaputte-meta", "---\nname: [unclosed\n---\n\nNotizen.\n");
      await campaignFile("meta-ohne-name", "---\nid: meta-ohne-name\n---\n\nNur Notizen.\n");
      await campaignFile(
        "krude-meta",
        "---\nid: krude-meta\nname: Krude Kampagne\ndescription:\n  nested: nope\n---\n",
      );
    });

    afterAll(async () => {
      await rm(tmpRoot, { recursive: true, force: true });
    });

    beforeEach(async () => {
      await seedStore(tmpRoot);
    });

    afterEach(() => {
      dropStore();
    });

    test("newest session id wins; no sessions → no lastSession field", async () => {
      const body = await campaigns();
      // `name` is the DISPLAY name and is always there since issue #62: a
      // campaign with no authored name is listed under its id, exactly as the
      // campaign DOCUMENT renders it (GET /file?path=_campaign.md).
      expect(body).toEqual([
        { id: "kaputte-meta", name: "kaputte-meta" },
        { id: "krude-meta", name: "Krude Kampagne" },
        { id: "leere-sessions", name: "leere-sessions" },
        { id: "meta-ohne-name", name: "meta-ohne-name" },
        { id: "mit-meta", name: "Tyranny of Dragons", description: "Drachen, überall." },
        { id: "mit-sessions", name: "mit-sessions", lastSession: "2026-03-09" },
        { id: "ohne-sessions", name: "ohne-sessions" },
      ]);
    });

    test("_campaign.md degrades: broken YAML, missing name, non-string values", async () => {
      const byId = new Map((await campaigns()).map((c) => [c.id, c]));
      // Broken frontmatter → the campaign ROW still exists (a directory is a
      // campaign) and nothing was READ from the file: no description, and
      // never the parser's file-stem fallback ("_campaign") as the name — the
      // id is. The file itself is kept verbatim in unknown_files (see
      // db-migration.test.ts).
      expect(byId.get("kaputte-meta")).toEqual({ id: "kaputte-meta", name: "kaputte-meta" });
      // File present but without `name` → the id is the display name.
      expect(byId.get("meta-ohne-name")).toEqual({
        id: "meta-ohne-name",
        name: "meta-ohne-name",
      });
      // Non-string description is dropped, the valid name survives.
      expect(byId.get("krude-meta")).toEqual({ id: "krude-meta", name: "Krude Kampagne" });
      // No file at all → the id, same as everywhere else.
      expect(byId.get("ohne-sessions")).toEqual({ id: "ohne-sessions", name: "ohne-sessions" });
    });
  });
});

describe("GET /api/:campaign/tree", () => {
  beforeEach(async () => {
    await seedStore();
  });
  afterEach(() => {
    dropStore();
  });

  const tree = async (): Promise<CampaignTree> => {
    const res = await app.request("/api/beispiel/tree");
    expect(res.status).toBe(200);
    return (await res.json()) as CampaignTree;
  };

  test("chapter 01-salzhafen with title from _chapter.md", async () => {
    const t = await tree();
    expect(t.campaign).toBe("beispiel");
    const chapter = t.chapters.find((c) => c.id === "01-salzhafen");
    expect(chapter).toBeDefined();
    expect(chapter!.title).toBe("Kapitel 1: Der Leuchtturm von Salzhafen");
    expect(chapter!.status).toBe("active");
    // `_chapter.md` was optional in the file tree; a chapter ROW always
    // exists, so the path is now always there (store/read.ts buildTree).
    expect(chapter!.path).toBe("01-salzhafen/_chapter.md");
  });

  test("scenes grouped by location slug, sorted by path", async () => {
    const t = await tree();
    const chapter = t.chapters.find((c) => c.id === "01-salzhafen")!;
    const hafen = chapter.groups.find((g) => g.slug === "hafen");
    expect(hafen).toBeDefined();
    expect(hafen!.scenes.map((s) => s.id)).toEqual(["lighthouse-arrival", "smuggler-captured"]);
    expect(hafen!.scenes.map((s) => s.status)).toEqual(["ready", "ready"]);
    // The path segment is the scene ID now (store/paths.ts) — the file stem
    // ("ankunft-leuchtturm") does not exist anywhere any more.
    expect(hafen!.scenes[0]!.path).toBe("01-salzhafen/hafen/lighthouse-arrival.md");
    expect(hafen!.scenes[1]!.type).toBe("contingency");
  });

  test("npcs sorted by name, locations and sessions present", async () => {
    const t = await tree();
    expect(t.npcs.map((n) => n.id)).toEqual(["fenn", "jorna"]); // Fenn < Hafenmeisterin Jorna
    expect(t.npcs[0]!.name).toBe("Fenn");
    expect(t.locations.map((l) => l.id)).toEqual(["leuchtturm"]);
    expect(t.sessions.map((s) => s.id)).toEqual(["2026-01-15"]);
    expect(t.sessions[0]!.scenes_played).toEqual(["lighthouse-arrival"]);
    // sessions sort newest first
    const ids = t.sessions.map((s) => s.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  test("root-level files (incl. _campaign.md) never appear in the tree", async () => {
    const t = await tree();
    // The tree has no slot for campaign metadata (issue #17 keeps it out);
    // the campaign row is addressed by _campaign.md and by nothing in here.
    expect(t.chapters.map((c) => c.id)).toEqual(["01-salzhafen"]);
    const paths = t.chapters.flatMap((c) => [
      ...(c.path === undefined ? [] : [c.path]),
      ...c.groups.flatMap((g) => g.scenes.map((s) => s.path)),
    ]);
    expect(paths).not.toContain("_campaign.md");
    expect(paths.some((p) => !p.includes("/"))).toBe(false);
  });

  test("404 for unknown campaign", async () => {
    const res = await app.request("/api/nope/tree");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  test("traversal in campaign segment is refused before any lookup", async () => {
    // "..%2f..": Hono decodes the param to "../.." -> our guard answers 400.
    const res = await app.request("/api/..%2f../tree");
    expect(res.status).toBe(400);
    // Fully encoded "%2e%2e" is normalized away by URL/route matching before
    // any handler runs -> 404 from the router, also safe.
    const res2 = await app.request("/api/%2e%2e/tree");
    expect([400, 404]).toContain(res2.status);
  });
});

describe("GET /api/:campaign/file", () => {
  beforeEach(async () => {
    await seedStore();
  });
  afterEach(() => {
    dropStore();
  });

  test("returns raw + parsed + the rev as mtimeMs", async () => {
    const rel = "01-salzhafen/hafen/lighthouse-arrival.md";
    const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileResponse;
    expect(body.path).toBe(rel);
    expect(body.kind).toBe("scene");
    expect(body.frontmatter.id).toBe("lighthouse-arrival");
    expect(body.frontmatter.status).toBe("ready");
    expect(body.raw.startsWith("---")).toBe(true);
    expect(body.body).toContain("## Flow");
    expect(body.body).not.toContain("id: lighthouse-arrival");
    // `mtimeMs` is the row's `rev` now (store/render.ts rule 3): an opaque
    // guard token the client only ever sends back. A freshly imported row is
    // at 1 — that it INCREASES per write is pinned in write-api.test.ts.
    expect(typeof body.mtimeMs).toBe("number");
    expect(body.mtimeMs).toBe(1);
  });

  test("serves _campaign.md as kind campaign (no new endpoint needed)", async () => {
    const res = await app.request("/api/beispiel/file?path=_campaign.md");
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileResponse;
    expect(body.kind).toBe("campaign");
    expect(body.frontmatter.id).toBe("beispiel");
    expect(body.frontmatter.name).toBe("Der Leuchtturm von Salzhafen");
    expect(body.raw.startsWith("---")).toBe(true);
  });

  test("serves the two list files from their rows: inbox.md and glossary.md", async () => {
    // They have no entity row of their own; the campaign's version counter is
    // their guard token (store/read.ts readByLocator).
    const inbox = await app.request("/api/beispiel/file?path=inbox.md");
    expect(inbox.status).toBe(200);
    const inboxBody = (await inbox.json()) as FileResponse;
    expect(inboxBody.kind).toBe("inbox");
    expect(inboxBody.body).toContain("- ");

    const glossary = await app.request("/api/beispiel/file?path=glossary.md");
    expect(glossary.status).toBe(200);
    expect(((await glossary.json()) as FileResponse).kind).toBe("glossary");
  });

  test("404 for unknown file and unknown campaign", async () => {
    expect((await app.request("/api/beispiel/file?path=01-salzhafen/nope.md")).status).toBe(404);
    expect((await app.request("/api/nope/file?path=inbox.md")).status).toBe(404);
  });

  test("404 for a scene addressed under the wrong chapter or group", async () => {
    // A stale link: the id exists, the address does not (store/read.ts). It
    // used to be a missing file and it still reads as one.
    expect(
      (await app.request("/api/beispiel/file?path=01-salzhafen/lighthouse-arrival.md")).status,
    ).toBe(404);
    expect(
      (await app.request("/api/beispiel/file?path=02-nope/hafen/lighthouse-arrival.md")).status,
    ).toBe(404);
  });

  test("400 without path parameter", async () => {
    expect((await app.request("/api/beispiel/file")).status).toBe(400);
  });

  test("400 on traversal attempts", async () => {
    const cases = [
      "?path=../../etc/passwd",
      "?path=..%2F..%2Fetc%2Fpasswd",
      "?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd", // fully encoded ../..
      "?path=/etc/passwd",
      `?path=${encodeURIComponent("C:\\windows\\system32")}`,
      `?path=${encodeURIComponent("01-salzhafen\\..\\..\\secret.md")}`,
      `?path=${encodeURIComponent("01-salzhafen/../../beispiel/inbox.md")}`,
    ];
    for (const q of cases) {
      const res = await app.request(`/api/beispiel/file${q}`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe("string");
    }
  });

  test("400 for non-md and hidden paths", async () => {
    expect((await app.request("/api/beispiel/file?path=01-salzhafen")).status).toBe(400);
    expect((await app.request("/api/beispiel/file?path=notes.txt")).status).toBe(400);
    expect((await app.request("/api/beispiel/file?path=.hidden.md")).status).toBe(400);
  });
});

// --- the empty boot (issue #79 AK6) ------------------------------------------
// The production boot imports NOTHING: a fresh instance is empty, and the
// markdown importer is the dev/E2E tool `grimoire seed`. Nothing 500s on the
// way there — an empty campaign list and 404s are the honest answers.
describe("a fresh database (no import at boot)", () => {
  beforeEach(async () => {
    await emptyStore();
  });
  afterEach(() => {
    dropStore();
  });

  test("GET /api/campaigns answers an empty list", async () => {
    const res = await app.request("/api/campaigns");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("every campaign-scoped endpoint answers 404", async () => {
    for (const p of [
      "/api/beispiel/tree",
      "/api/beispiel/version",
      "/api/beispiel/file?path=_campaign.md",
      "/api/beispiel/session",
    ]) {
      expect((await app.request(p)).status).toBe(404);
    }
  });
});
