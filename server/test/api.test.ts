// Read-API tests against the real example campaign (CAMPAIGN_ROOT default
// points at ../examples). The Hono app runs in-process via app.request() —
// no live port needed.

import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { CampaignSummary, CampaignTree, FileResponse } from "@grimoire/shared";
import { app } from "../src/server";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

describe("GET /api/campaigns", () => {
  test("lists example campaign directories", async () => {
    const res = await app.request("/api/campaigns");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CampaignSummary[];
    expect(body).toContainEqual({ id: "beispiel" });
    // Only directories, no root-level files or hidden entries.
    for (const c of body) {
      expect(c.id.startsWith(".")).toBe(false);
      expect(c.id.endsWith(".md")).toBe(false);
    }
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
