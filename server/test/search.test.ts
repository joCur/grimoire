// Search + version tests (issues #7/#8). Like the write tests, they run
// against a TEMP COPY of the example campaign (examples/ is the committed
// format reference and must never be mutated). Index invalidation is
// triggered directly via invalidateCampaign() — tests never depend on
// chokidar timing; the watcher itself gets one lightweight real-fs test at
// the end.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "../src/server";
import { getCampaignRoot, setCampaignRoot } from "../src/config";
import {
  getCampaignVersion,
  invalidateCampaign,
  type SearchResult,
} from "../src/search-index";
import { startWatcher } from "../src/watcher";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

let tmpRoot = "";
let originalRoot = "";

beforeAll(async () => {
  originalRoot = getCampaignRoot();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "grimoire-search-"));
  await cp(path.join(EXAMPLES, "beispiel"), path.join(tmpRoot, "beispiel"), { recursive: true });
  setCampaignRoot(tmpRoot);
  // Drop any index another test file may have built against a different root.
  invalidateCampaign("beispiel");
});

afterAll(async () => {
  setCampaignRoot(originalRoot);
  invalidateCampaign("beispiel"); // do not leak the temp-root index
  await rm(tmpRoot, { recursive: true, force: true });
});

async function search(q: string): Promise<SearchResult[]> {
  const res = await app.request(`/api/beispiel/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { results: SearchResult[] };
  expect(Array.isArray(body.results)).toBe(true);
  return body.results;
}

describe("GET /api/:campaign/search", () => {
  test("'Leuchtturm' finds the scene AND the location (title/name weighted)", async () => {
    const results = await search("Leuchtturm");
    expect(results.length).toBeLessThanOrEqual(20);
    const scene = results.find((r) => r.kind === "scene" && r.id === "lighthouse-arrival");
    const location = results.find((r) => r.kind === "location" && r.id === "leuchtturm");
    expect(scene).toBeDefined();
    expect(location).toBeDefined();
    expect(scene!.title).toBe("Ankunft am Leuchtturm");
    expect(scene!.path).toBe("01-salzhafen/hafen/ankunft-leuchtturm.md");
    expect(location!.title).toBe("Der Leuchtturm von Salzhafen");
    for (const r of results) {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  test("'Leuchtturm' also finds the campaign itself (kind campaign, issue #17)", async () => {
    const results = await search("Leuchtturm");
    const campaign = results.find((r) => r.kind === "campaign");
    expect(campaign).toBeDefined();
    expect(campaign!.id).toBe("beispiel");
    expect(campaign!.title).toBe("Der Leuchtturm von Salzhafen");
    expect(campaign!.path).toBe("_campaign.md");
  });

  test("'Fenn' finds the npc", async () => {
    const results = await search("Fenn");
    const npc = results.find((r) => r.kind === "npc" && r.id === "fenn");
    expect(npc).toBeDefined();
    expect(npc!.title).toBe("Fenn");
    expect(npc!.path).toBe("npcs/fenn.md");
  });

  test("tag search: 'escape' finds the contingency scene via its tags", async () => {
    const results = await search("escape");
    expect(results.some((r) => r.kind === "scene" && r.id === "smuggler-captured")).toBe(true);
  });

  test("body matches carry a snippet with context", async () => {
    const results = await search("Lampenöl"); // only in the location body
    const location = results.find((r) => r.id === "leuchtturm");
    expect(location).toBeDefined();
    expect(location!.snippet).toContain("Lampenöl");
    expect(location!.snippet!.length).toBeLessThanOrEqual(140);
  });

  test("nonsense query yields empty results, not an error", async () => {
    expect(await search("qxzvywunbekannt")).toEqual([]);
  });

  test("400 on missing or empty q", async () => {
    expect((await app.request("/api/beispiel/search")).status).toBe(400);
    expect((await app.request("/api/beispiel/search?q=")).status).toBe(400);
    expect((await app.request("/api/beispiel/search?q=%20%20")).status).toBe(400);
  });

  test("404 for an unknown campaign, 400 for an unsafe id", async () => {
    expect((await app.request("/api/nope/search?q=Fenn")).status).toBe(404);
    expect((await app.request("/api/..%2fbeispiel/search?q=Fenn")).status).toBe(400);
  });
});

describe("index invalidation + GET /api/:campaign/version", () => {
  const NEW_SCENE = "01-salzhafen/hafen/nachtwache.md";

  async function version(): Promise<number> {
    const res = await app.request("/api/beispiel/version");
    expect(res.status).toBe(200);
    return ((await res.json()) as { version: number }).version;
  }

  test("a new file appears in search results only after invalidation", async () => {
    // stealth is tagged nowhere in the example campaign
    expect(await search("stealth")).toEqual([]);

    await writeFile(
      path.join(tmpRoot, "beispiel", NEW_SCENE),
      "---\nid: night-watch\ntitle: Nachtwache am Turm\ntags: [stealth]\nstatus: draft\n---\n\n## Flow\n\nDie Gruppe schleicht sich an den Posten vorbei.\n",
      "utf8",
    );

    // The index is cached — without invalidation the write stays invisible.
    expect(await search("stealth")).toEqual([]);

    const before = await version();
    invalidateCampaign("beispiel");
    expect(await version()).toBe(before + 1);

    const results = await search("stealth");
    expect(results.some((r) => r.kind === "scene" && r.id === "night-watch")).toBe(true);
  });

  test("version starts at 0 for an untouched campaign and only bumps on invalidation", async () => {
    expect(getCampaignVersion("never-touched")).toBe(0);
    const before = await version();
    expect(await version()).toBe(before); // polling alone never bumps
    invalidateCampaign("beispiel");
    expect(await version()).toBe(before + 1);
  });

  test("404 for an unknown campaign", async () => {
    expect((await app.request("/api/nope/version")).status).toBe(404);
  });
});

describe("chokidar watcher (real fs)", () => {
  test("an md write bumps the campaign version within ~2s", async () => {
    const watchRoot = await mkdtemp(path.join(os.tmpdir(), "grimoire-watch-"));
    const campaign = `watch-${Date.now()}`; // unique name -> fresh version counter
    await mkdir(path.join(watchRoot, campaign));

    // The watcher captures the root at start; restore the search root right after.
    setCampaignRoot(watchRoot);
    const watcher = startWatcher();
    setCampaignRoot(tmpRoot);
    expect(watcher).not.toBeNull();

    try {
      await new Promise<void>((resolve, reject) => {
        watcher!.on("ready", () => resolve());
        watcher!.on("error", (err) => reject(err));
      });

      const before = getCampaignVersion(campaign);
      await writeFile(path.join(watchRoot, campaign, "szene.md"), "---\nid: x\n---\n\nText.\n");

      const deadline = Date.now() + 2000;
      while (getCampaignVersion(campaign) === before && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(getCampaignVersion(campaign)).toBe(before + 1);
    } finally {
      await watcher!.close();
      await rm(watchRoot, { recursive: true, force: true });
    }
  });

  test("startWatcher on a missing root returns null instead of crashing", () => {
    setCampaignRoot(path.join(os.tmpdir(), "grimoire-does-not-exist-xyz"));
    try {
      expect(startWatcher()).toBeNull();
    } finally {
      setCampaignRoot(tmpRoot);
    }
  });
});
