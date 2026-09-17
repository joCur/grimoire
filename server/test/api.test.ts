// Read-API tests against the DATABASE, seeded from the committed JSON entries
// in `fixtures/beispiel` — the example campaign is the fixture of the whole
// suite (see test/support/store.ts). The Hono app runs in-process via
// app.request(), so no live port is needed.
//
// Two addressing facts to know while reading:
//   - `rev` is the ROW VERSION, an opaque guard token that starts at 1;
//   - a scene's path segment is its ID (store/paths.ts), so the example
//     scene is addressed as 01-salzhafen/leuchtturm/lighthouse-arrival.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignSummary, CampaignTree, EntryResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { seedCampaign, type SeedEntry } from "../src/db/seed";
import { dropStore, emptyStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

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
      // `lastSessionStarted` is the ORDERABLE half: the id is
      // opaque for every session written since, so the app sorts by this.
      expect(beispiel?.lastSessionStarted).toBe("2026-01-15T19:30");
    });

    test("name/description come from the campaign entry", async () => {
      const beispiel = (await campaigns()).find((c) => c.id === "beispiel");
      expect(beispiel?.name).toBe("Der Leuchtturm von Salzhafen");
      expect(beispiel?.description).toContain("Leuchtturm");
    });
  });

  describe("several campaigns side by side", () => {
    /** A campaign's entries: its own, plus one session per id given. */
    function campaign(
      properties: Record<string, unknown>,
      sessionIds: string[] = [],
    ): SeedEntry[] {
      return [
        { kind: "campaign", properties, body: "" },
        ...sessionIds.map(
          (id): SeedEntry => ({
            kind: "session",
            properties: { id, scenes_played: [] },
            body: "",
            log: [],
          }),
        ),
      ];
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
      // authored name is listed under its id, exactly as the campaign ENTRY
      // renders it (GET /entry?path=campaign).
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

  test("chapter 01-salzhafen with title from chapter entry", async () => {
    const t = await tree();
    expect(t.campaign).toBe("beispiel");
    const chapter = t.chapters.find((c) => c.id === "01-salzhafen");
    expect(chapter).toBeDefined();
    expect(chapter!.title).toBe("Kapitel 1: Der Leuchtturm von Salzhafen");
    expect(chapter!.status).toBe("active");
    // A chapter's address is its id (store/read.ts buildTree).
    expect(chapter!.path).toBe("01-salzhafen");
  });

  test("scenes grouped by their LOCATION", async () => {
    const t = await tree();
    const chapter = t.chapters.find((c) => c.id === "01-salzhafen")!;
    // The `hafen/` directory of the import format is not a group: the group
    // is what the scene's `location` names, so the two example scenes sit
    // apart even though they shared a directory.
    //
    // Ordered by the NAME the heading shows, not by the
    // id behind it.
    expect(chapter.groups.map((g) => g.slug)).toEqual(["leuchtturm", "bucht"]);
    expect(chapter.groups.map((g) => g.name)).toEqual([
      "Der Leuchtturm von Salzhafen",
      "Die Nordbucht",
    ]);
    const leuchtturm = chapter.groups.find((g) => g.slug === "leuchtturm")!;
    expect(leuchtturm.scenes.map((s) => s.id)).toEqual(["lighthouse-arrival"]);
    expect(leuchtturm.scenes[0]!.status).toBe("ready");
    // The path segment is the scene ID now (store/paths.ts) — the file stem
    // ("ankunft-leuchtturm") does not exist anywhere any more.
    expect(leuchtturm.scenes[0]!.path).toBe("01-salzhafen/leuchtturm/lighthouse-arrival");
    const bucht = chapter.groups.find((g) => g.slug === "bucht")!;
    expect(bucht.scenes[0]!.type).toBe("contingency");
  });

  test("npcs sorted by name, locations and sessions present", async () => {
    const t = await tree();
    expect(t.npcs.map((n) => n.id)).toEqual(["fenn", "jorna"]); // Fenn < Hafenmeisterin Jorna
    expect(t.npcs[0]!.name).toBe("Fenn");
    // Both locations the example campaign's scenes name have an entry of
    // their own — a reference never creates one.
    expect(t.locations.map((l) => l.id).sort()).toEqual(["bucht", "leuchtturm"]);
    expect(t.sessions.map((s) => s.id)).toEqual(["2026-01-15"]);
    expect(t.sessions[0]!.scenes_played).toEqual(["lighthouse-arrival"]);
    // sessions sort newest first
    const ids = t.sessions.map((s) => s.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  test("root-level files (incl. campaign) never appear in the tree", async () => {
    const t = await tree();
    // The tree has no slot for campaign metadata;
    // the campaign row is addressed by campaign and by nothing in here.
    expect(t.chapters.map((c) => c.id)).toEqual(["01-salzhafen"]);
    const paths = t.chapters.flatMap((c) => [
      ...(c.path === undefined ? [] : [c.path]),
      ...c.groups.flatMap((g) => g.scenes.map((s) => s.path)),
    ]);
    for (const rootEntry of ["campaign", "inbox", "glossary"]) expect(paths).not.toContain(rootEntry);
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

describe("GET /api/campaigns/:campaign/entries", () => {
  beforeEach(async () => {
    await seedStore();
  });
  afterEach(() => {
    dropStore();
  });

  test("returns properties, body and the rev", async () => {
    const rel = "01-salzhafen/leuchtturm/lighthouse-arrival";
    const res = await app.request(entriesUrl("beispiel", rel));
    expect(res.status).toBe(200);
    const body = (await res.json()) as EntryResponse;
    expect(body.path).toBe(rel);
    expect(body.kind).toBe("scene");
    expect(body.properties.id).toBe("lighthouse-arrival");
    expect(body.properties.status).toBe("ready");
    expect(body.body).toContain("## Flow");
    expect(body.body).not.toContain("id: lighthouse-arrival");
    // `rev` is the ROW VERSION (store/render.ts rule 3): an opaque
    // guard token the client only ever sends back. A freshly imported row is
    // at 1 — that it INCREASES per write is pinned in write-api.test.ts.
    expect(typeof body.rev).toBe("number");
    expect(body.rev).toBe(1);
  });

  test("serves campaign as kind campaign (no new endpoint needed)", async () => {
    const res = await app.request(entriesUrl("beispiel", "campaign"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as EntryResponse;
    expect(body.kind).toBe("campaign");
    expect(body.properties.id).toBe("beispiel");
    expect(body.properties.name).toBe("Der Leuchtturm von Salzhafen");
  });

  test("serves the two list files from their rows: inbox and glossary", async () => {
    // They have no entity row of their own; the campaign's version counter is
    // their guard token (store/read.ts readByLocator).
    const inbox = await app.request(entriesUrl("beispiel", "inbox"));
    expect(inbox.status).toBe(200);
    const inboxBody = (await inbox.json()) as EntryResponse;
    expect(inboxBody.kind).toBe("inbox");
    expect(inboxBody.body).toContain("- ");

    const glossary = await app.request(entriesUrl("beispiel", "glossary"));
    expect(glossary.status).toBe(200);
    expect(((await glossary.json()) as EntryResponse).kind).toBe("glossary");
  });

  test("404 for unknown file and unknown campaign", async () => {
    expect((await app.request(entriesUrl("beispiel", "01-salzhafen/nope"))).status).toBe(404);
    expect((await app.request(entriesUrl("nope", "inbox"))).status).toBe(404);
  });

  test("a STALE scene address resolves and answers with the current one", async () => {
    // The group segment is the scene's `location` and moves with it, so an
    // address written down before a correction names the right scene with
    // the wrong group. It resolves by id and reports the address it has now
    // — that is what the app follows (ADR #17).
    for (const stale of [
      "01-salzhafen/lighthouse-arrival",
      "01-salzhafen/hafen/lighthouse-arrival",
      "02-nope/lighthouse-arrival",
    ]) {
      const res = await app.request(entriesUrl("beispiel", stale));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { path: string }).path).toBe(
        "01-salzhafen/leuchtturm/lighthouse-arrival",
      );
    }
    // An unknown ID is still a 404 — nothing to redirect to.
    expect((await app.request(entriesUrl("beispiel", "01-salzhafen/nirgends"))).status).toBe(404);
  });

  test("400 without an address", async () => {
    expect((await app.request("/api/campaigns/beispiel/entries/")).status).toBe(400);
  });

  test("400 on traversal attempts", async () => {
    const cases = [
      "/etc/passwd",
      "C:\\windows\\system32",
      "01-salzhafen\\..\\..\\secret.md",
      ".hidden/x",
    ];
    for (const address of cases) {
      const res = await app.request(entriesUrl("beispiel", address));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe("string");
    }
  });

  test("a `..` segment never reaches the address — the URL resolves it away", async () => {
    // With the address in the path, every URL parser on the way normalizes
    // `.` and `..` segments (percent-encoded ones included) before the server
    // sees them. What arrives is a different, ordinary address, so the honest
    // answer is 404 and not the 400 of the address guard.
    for (const address of ["../../etc/passwd", "01-salzhafen/../../beispiel/inbox"]) {
      expect((await app.request(entriesUrl("beispiel", address))).status).toBe(404);
    }
  });

  test("400 for hidden segments, 404 for an address the schema has no row for", async () => {
    // Hidden segments stay a 400 — that is a hostile value, not an address.
    expect((await app.request(entriesUrl("beispiel", ".hidden"))).status).toBe(400);
    expect((await app.request(entriesUrl("beispiel", ".hidden.md"))).status).toBe(400);
    // An address the schema describes but no row answers is honestly a 404 —
    // "there is no such entry" — not a 400 about its shape.
    expect((await app.request(entriesUrl("beispiel", "kein-kapitel"))).status).toBe(404);
    expect((await app.request(entriesUrl("beispiel", "notes.txt"))).status).toBe(404);
    // …including the OLD `.md` form: no compatibility, by decision.
    expect(
      (await app.request(entriesUrl("beispiel", "npcs/jorna.md"))).status,
    ).toBe(404);
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
      entriesUrl("beispiel", "campaign"),
      "/api/campaigns/beispiel/session",
    ]) {
      expect((await app.request(p)).status).toBe(404);
    }
  });
});
