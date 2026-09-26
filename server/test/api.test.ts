// Read-API tests against the DATABASE, seeded from the committed JSON fixtures
// in `fixtures/` — the example campaign is the fixture of the whole
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

    test("lists the example campaign", async () => {
      const body = await campaigns();
      // The example campaign carries a campaign, so name and
      // description come along additively.
      expect(body).toContainEqual({
        id: "example",
        lastSession: "2026-01-15",
        lastSessionStarted: "2026-01-15T19:30:00",
        name: "The Lighthouse of Salt Harbour",
        description: expect.any(String),
      });
      // Only campaign rows, never anything else the database holds.
      for (const c of body) {
        expect(c.id.startsWith(".")).toBe(false);
        expect(c.id.endsWith(".md")).toBe(false);
      }
    });

    test("lastSession/lastSessionStarted name the newest session of the example", async () => {
      const example = (await campaigns()).find((c) => c.id === "example");
      expect(example?.lastSession).toBe("2026-01-15");
      // `lastSessionStarted` is the ORDERABLE half: a session id is opaque,
      // so the app sorts by this.
      expect(example?.lastSessionStarted).toBe("2026-01-15T19:30:00");
    });

    test("name/description come from the campaign", async () => {
      const example = (await campaigns()).find((c) => c.id === "example");
      expect(example?.name).toBe("The Lighthouse of Salt Harbour");
      expect(example?.description).toContain("lighthouse");
    });
  });

  describe("several campaigns side by side", () => {
    /** A campaign: its own row, plus one session per id given. */
    function campaign(
      fields: { id: string; name?: string; description?: string },
      sessionIds: string[] = [],
    ): CampaignFixture {
      return {
        campaign: { name: "", ...fields, body: "", glossaryIntro: "" },
        sessions: sessionIds.map((id) => ({
          id,
          started: "",
          body: "",
          pauses: [],
          log: [],
        })),
      };
    }

    beforeEach(async () => {
      const db = await emptyStore();
      seedCampaign(db, campaign({ id: "with-sessions" }, ["2026-02-01", "2026-03-09"]));
      seedCampaign(db, campaign({ id: "without-sessions" }));
      seedCampaign(
        db,
        campaign({ id: "with-meta", name: "Tyranny of Dragons", description: "Dragons, everywhere." }),
      );
      seedCampaign(db, campaign({ id: "meta-without-name" }));
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
        { id: "meta-without-name", name: "meta-without-name" },
        { id: "with-meta", name: "Tyranny of Dragons", description: "Dragons, everywhere." },
        { id: "with-sessions", name: "with-sessions", lastSession: "2026-03-09" },
        { id: "without-sessions", name: "without-sessions" },
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
    const res = await app.request("/api/campaigns/example/tree");
    expect(res.status).toBe(200);
    return (await res.json()) as CampaignTree;
  };

  test("chapter 01-salt-harbour with the chapter's title and status", async () => {
    const t = await tree();
    expect(t.campaign).toBe("example");
    const chapter = t.chapters.find((c) => c.id === "01-salt-harbour");
    expect(chapter).toBeDefined();
    expect(chapter!.title).toBe("Chapter 1: The Lighthouse of Salt Harbour");
    expect(chapter!.status).toBe("active");
    // No address: a chapter is its own resource (decisions/resources).
    expect(Object.hasOwn(chapter!, "path")).toBe(false);
  });

  test("a chapter lists its scenes as ONE ordered list", async () => {
    const t = await tree();
    const chapter = t.chapters.find((c) => c.id === "01-salt-harbour")!;
    // A flat list in `pos` order, not buckets per location: the seed loads
    // the fixture scenes in id order, each at the end of its chapter.
    expect(chapter.scenes.map((s) => s.id)).toEqual([
      "lighthouse-arrival",
      "smuggler-captured",
    ]);
    const arrival = chapter.scenes[0]!;
    expect(arrival.status).toBe("ready");
    // The location travels as the ID (address, links) AND as the resolved
    // display name the meta line shows.
    expect(arrival.location).toBe("lighthouse");
    expect(arrival.locationName).toBe("The Lighthouse of Salt Harbour");
    // A scene is its own resource and carries no address (decisions/resources).
    expect(Object.hasOwn(arrival, "path")).toBe(false);
    expect(chapter.scenes[1]!.type).toBe("contingency");
    // The order carries its own guard token, separate from the chapter's
    // `rev`.
    expect(chapter.sceneOrderRev).toBe(1);
  });

  test("npcs sorted by name, locations and sessions present", async () => {
    const t = await tree();
    expect(t.npcs.map((n) => n.id)).toEqual(["fenn", "jorna"]); // Fenn < Harbourmaster Jorna
    expect(t.npcs[0]!.name).toBe("Fenn");
    // Both locations the example campaign's scenes name have a row of their
    // own — a reference never creates one.
    expect(t.locations.map((l) => l.id).sort()).toEqual(["cove", "lighthouse"]);
    expect(t.sessions.map((s) => s.id)).toEqual(["2026-01-15"]);
    // The tree's item for a session is when it ran, and nothing of its
    // children: the pauses and the log come with the session itself
    // (GET /sessions/:id) — the tree is a navigation index.
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
    expect(t.chapters.map((c) => c.id)).toEqual(["01-salt-harbour"]);
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
      "/api/campaigns/example/tree",
      "/api/campaigns/example/version",
      "/api/campaigns/example",
      "/api/campaigns/example/chapters",
      "/api/campaigns/example/sessions",
    ]) {
      expect((await app.request(p)).status).toBe(404);
    }
  });
});
