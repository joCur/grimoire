// Read-API tests against the real example campaign (CAMPAIGN_ROOT default
// points at ../examples). The Hono app runs in-process via app.request() —
// no live port needed.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { CampaignSummary, CampaignTree, FileResponse } from "@grimoire/shared";
import { getCampaignRoot, setCampaignRoot } from "../src/config";
import { app } from "../src/server";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

describe("GET /api/campaigns", () => {
  const campaigns = async (): Promise<CampaignSummary[]> => {
    const res = await app.request("/api/campaigns");
    expect(res.status).toBe(200);
    return (await res.json()) as CampaignSummary[];
  };

  test("lists example campaign directories", async () => {
    const body = await campaigns();
    // The example campaign carries a _campaign.md (issue #17), so name and
    // description come along additively.
    expect(body).toContainEqual({
      id: "beispiel",
      lastSession: "2026-01-15",
      name: "Der Leuchtturm von Salzhafen",
      description: expect.any(String),
    });
    // Only directories, no root-level files or hidden entries.
    for (const c of body) {
      expect(c.id.startsWith(".")).toBe(false);
      expect(c.id.endsWith(".md")).toBe(false);
    }
  });

  test("lastSession is the newest session id of the example campaign", async () => {
    const beispiel = (await campaigns()).find((c) => c.id === "beispiel");
    expect(beispiel?.lastSession).toBe("2026-01-15");
  });

  test("name/description come from examples/beispiel/_campaign.md", async () => {
    const beispiel = (await campaigns()).find((c) => c.id === "beispiel");
    expect(beispiel?.name).toBe("Der Leuchtturm von Salzhafen");
    expect(beispiel?.description).toContain("Leuchtturm");
  });

  describe("in a temp root", () => {
    let originalRoot: string;
    let tmpRoot: string;

    beforeAll(async () => {
      originalRoot = getCampaignRoot();
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
      setCampaignRoot(tmpRoot);
    });

    afterAll(async () => {
      setCampaignRoot(originalRoot);
      await rm(tmpRoot, { recursive: true, force: true });
    });

    test("newest session id wins; no sessions → no lastSession field", async () => {
      const body = await campaigns();
      expect(body).toEqual([
        { id: "kaputte-meta" },
        { id: "krude-meta", name: "Krude Kampagne" },
        { id: "leere-sessions" },
        { id: "meta-ohne-name" },
        { id: "mit-meta", name: "Tyranny of Dragons", description: "Drachen, überall." },
        { id: "mit-sessions", lastSession: "2026-03-09" },
        { id: "ohne-sessions" },
      ]);
    });

    test("_campaign.md degrades: broken YAML, missing name, non-string values", async () => {
      const byId = new Map((await campaigns()).map((c) => [c.id, c]));
      // Broken frontmatter → no fields at all, never an error and never the
      // parser's file-stem fallback ("_campaign").
      expect(byId.get("kaputte-meta")).toEqual({ id: "kaputte-meta" });
      // File present but without `name` → the id stays the label (the
      // parser's name→id fallback is not an authored display name).
      expect(byId.get("meta-ohne-name")).toEqual({ id: "meta-ohne-name" });
      // Non-string description is dropped, the valid name survives.
      expect(byId.get("krude-meta")).toEqual({ id: "krude-meta", name: "Krude Kampagne" });
      // No file at all → unchanged behaviour.
      expect(byId.get("ohne-sessions")).toEqual({ id: "ohne-sessions" });
    });
  });
});

describe("GET /api/:campaign/tree", () => {
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
    expect(chapter!.path).toBe("01-salzhafen/_chapter.md");
  });

  test("scenes grouped by location slug, sorted by path", async () => {
    const t = await tree();
    const chapter = t.chapters.find((c) => c.id === "01-salzhafen")!;
    const hafen = chapter.groups.find((g) => g.slug === "hafen");
    expect(hafen).toBeDefined();
    expect(hafen!.scenes.map((s) => s.id)).toEqual(["lighthouse-arrival", "smuggler-captured"]);
    expect(hafen!.scenes.map((s) => s.status)).toEqual(["ready", "ready"]);
    expect(hafen!.scenes[0]!.path).toBe("01-salzhafen/hafen/ankunft-leuchtturm.md");
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
    // root markdown files were never walked and still are not.
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

  test("traversal in campaign segment never reaches the filesystem", async () => {
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
  test("returns raw + parsed + real mtimeMs", async () => {
    const rel = "01-salzhafen/hafen/ankunft-leuchtturm.md";
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
    const s = await stat(path.join(EXAMPLES, "beispiel", rel));
    expect(body.mtimeMs).toBe(s.mtimeMs);
    expect(typeof body.mtimeMs).toBe("number");
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

  test("404 for unknown file and unknown campaign", async () => {
    expect((await app.request("/api/beispiel/file?path=01-salzhafen/nope.md")).status).toBe(404);
    expect((await app.request("/api/nope/file?path=inbox.md")).status).toBe(404);
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
