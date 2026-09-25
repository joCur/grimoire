// Read-API tests against the DATABASE, seeded from the committed JSON fixtures
// in `fixtures/beispiel` — the example campaign is the fixture of the whole
// suite (see test/support/store.ts). The Hono app runs in-process via
// app.request(), so no live port is needed.
//
// Each entity with its own resource has its own test module
// (campaigns.test.ts, chapters.test.ts, scenes.test.ts, …); this one covers
// the shapes that show several of them — the campaign list and the tree —
// and the empty boot.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignSummary, CampaignTree } from "@grimoire/shared";
import { app } from "../src/server";
import { seedCampaign, type CampaignFixture } from "../src/db/seed";
import { dropStore, emptyStore, seedStore } from "./support/store";

describe("GET /api/campaigns", () => {
  const campaigns = async (): Promise<CampaignSummary[]> => {
    const res = await app.request("/api/campaigns");
    expect(res.status).toBe(200);
    return (await res.json()) as CampaignSummary[];
  };

  describe("seeded from the example campaign", () => {
    beforeEach(async () => {
      await seedStore();
    });
    afterEach(() => {
      dropStore();
    });

    test("lists example campaign directories", async () => {
      const body = await campaigns();
      // The example campaign carries a campaign, so name and
      // description come along additively.
      expect(body).toContainEqual({
        id: "beispiel",
        lastSession: "2026-01-15",
        lastSessionStarted: "2026-01-15T19:30:00",
        name: "Der Leuchtturm von Salzhafen",
        description: expect.any(String),
      });
      // Only campaign rows, never a stray name that happened to sit in the
      // root of the tree the migration read.
      for (const c of body) {
        expect(c.id.startsWith(".")).toBe(false);
        expect(c.id.endsWith(".md")).toBe(false);
      }
    });

    test("lastSession/lastSessionStarted name the newest session of the example", async () => {
      const beispiel = (await campaigns()).find((c) => c.id === "beispiel");
      expect(beispiel?.lastSession).toBe("2026-01-15");
      // `lastSessionStarted` is the ORDERABLE half: the id is
      // opaque for every session written since, so the app sorts by this.
      expect(beispiel?.lastSessionStarted).toBe("2026-01-15T19:30:00");
    });

    test("name/description come from the campaign", async () => {
      const beispiel = (await campaigns()).find((c) => c.id === "beispiel");
      expect(beispiel?.name).toBe("Der Leuchtturm von Salzhafen");
      expect(beispiel?.description).toContain("Leuchtturm");
    });
  });

  describe("several campaigns side by side", () => {
    /** A campaign: its own row, plus one session per id given. */
    function campaign(
      fields: { id: string; name?: string; description?: string },
      sessionIds: string[] = [],
    ): CampaignFixture {
      return {
        campaign: { name: "", ...fields, body: "" },
        sessions: sessionIds.map((id) => ({
          kind: "session",
          properties: { id, scenes_played: [] },
          body: "",
          log: [],
        })),
      };
    }

    beforeEach(async () => {
      const db = await emptyStore();
      seedCampaign(db, campaign({ id: "mit-sessions" }, ["2026-02-01", "2026-03-09"]));
      seedCampaign(db, campaign({ id: "ohne-sessions" }));
      seedCampaign(
        db,
        campaign({ id: "mit-meta", name: "Tyranny of Dragons", description: "Drachen, überall." }),
      );
      seedCampaign(db, campaign({ id: "meta-ohne-name" }));
    });

    afterEach(() => {
      dropStore();
    });

    test("newest session id wins; no sessions → no lastSession field", async () => {
      const body = await campaigns();
      // `name` is the DISPLAY name and is always there: a campaign with no
      // authored name is listed under its id, exactly as `GET /campaigns/:c`
      // answers it.
      expect(body).toEqual([
        { id: "meta-ohne-name", name: "meta-ohne-name" },
        { id: "mit-meta", name: "Tyranny of Dragons", description: "Drachen, überall." },
        { id: "mit-sessions", name: "mit-sessions", lastSession: "2026-03-09" },
        { id: "ohne-sessions", name: "ohne-sessions" },
      ]);
    });
  });
});

describe("GET /api/campaigns/:campaign/tree", () => {
  beforeEach(async () => {
    await seedStore();
  });
  afterEach(() => {
    dropStore();
  });

  const tree = async (): Promise<CampaignTree> => {
    const res = await app.request("/api/campaigns/beispiel/tree");
    expect(res.status).toBe(200);
    return (await res.json()) as CampaignTree;
  };

  test("chapter 01-salzhafen with the chapter's title and status", async () => {
    const t = await tree();
    expect(t.campaign).toBe("beispiel");
    const chapter = t.chapters.find((c) => c.id === "01-salzhafen");
    expect(chapter).toBeDefined();
    expect(chapter!.title).toBe("Kapitel 1: Der Leuchtturm von Salzhafen");
    expect(chapter!.status).toBe("active");
    // No address: a chapter is its own resource (ADR #31).
    expect(Object.hasOwn(chapter!, "path")).toBe(false);
  });

  test("a chapter lists its scenes as ONE ordered list", async () => {
    const t = await tree();
    const chapter = t.chapters.find((c) => c.id === "01-salzhafen")!;
    // A flat list in `pos` order, not buckets per location: the migration
    // gave the fixture scenes the positions they were displayed at, which
    // ordered them by the location's display NAME ("Der Leuchtturm von
    // Salzhafen" before "Die Nordbucht").
    expect(chapter.scenes.map((s) => s.id)).toEqual([
      "lighthouse-arrival",
      "smuggler-captured",
    ]);
    const arrival = chapter.scenes[0]!;
    expect(arrival.status).toBe("ready");
    // The location travels as the ID (address, links) AND as the resolved
    // display name the meta line shows.
    expect(arrival.location).toBe("leuchtturm");
    expect(arrival.locationName).toBe("Der Leuchtturm von Salzhafen");
    // A scene is its own resource and carries no address (ADR #31).
    expect(Object.hasOwn(arrival, "path")).toBe(false);
    expect(chapter.scenes[1]!.type).toBe("contingency");
    // The order carries its own guard token, separate from the chapter's
    // `rev`.
    expect(chapter.sceneOrderRev).toBe(1);
  });

  test("npcs sorted by name, locations and sessions present", async () => {
    const t = await tree();
    expect(t.npcs.map((n) => n.id)).toEqual(["fenn", "jorna"]); // Fenn < Hafenmeisterin Jorna
    expect(t.npcs[0]!.name).toBe("Fenn");
    // Both locations the example campaign's scenes name have a row of their
    // own — a reference never creates one.
    expect(t.locations.map((l) => l.id).sort()).toEqual(["bucht", "leuchtturm"]);
    expect(t.sessions.map((s) => s.id)).toEqual(["2026-01-15"]);
    // The tree's item for a session is its identifying HEAD: when it ran, and
    // nothing of its content. The log and the played scenes come from the
    // session itself (GET /sessions/:id) — a session is not an entry, and the
    // tree is a navigation index (ADR #26).
    expect(t.sessions[0]).toEqual({
      id: "2026-01-15",
      started: "2026-01-15T19:30:00",
      startedMs: new Date(2026, 0, 15, 19, 30).getTime(),
      ended: "2026-01-15T22:45:00",
      endedMs: new Date(2026, 0, 15, 22, 45).getTime(),
    });
    // sessions sort newest first
    const ids = t.sessions.map((s) => s.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  test("the campaign and the lists never appear among the chapters", async () => {
    const t = await tree();
    // The tree has no slot for the campaign's own fields; the campaign is
    // read at its own resource.
    expect(t.chapters.map((c) => c.id)).toEqual(["01-salzhafen"]);
  });

  test("404 for unknown campaign", async () => {
    const res = await app.request("/api/campaigns/nope/tree");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  test("traversal in campaign segment is refused before any lookup", async () => {
    // "..%2f..": Hono decodes the param to "../.." -> our guard answers 400.
    const res = await app.request("/api/campaigns/..%2f../tree");
    expect(res.status).toBe(400);
    // Fully encoded "%2e%2e" is normalized away by URL/route matching before
    // any handler runs -> 404 from the router, also safe.
    const res2 = await app.request("/api/campaigns/%2e%2e/tree");
    expect([400, 404]).toContain(res2.status);
  });
});

// --- the empty boot ----------------------------------------------------------
// The production boot loads NOTHING: a fresh instance is empty, and
// `grimoire seed` is the dev and E2E tool. Nothing 500s on the way there —
// an empty campaign list and 404s are the honest answers.
describe("a fresh database (nothing loaded at boot)", () => {
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
      "/api/campaigns/beispiel/tree",
      "/api/campaigns/beispiel/version",
      "/api/campaigns/beispiel",
      "/api/campaigns/beispiel/chapters",
      "/api/campaigns/beispiel/session",
    ]) {
      expect((await app.request(p)).status).toBe(404);
    }
  });
});
