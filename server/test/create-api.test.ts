// The create endpoints (issue #56) — POST /campaigns and the four per-campaign
// creates. This is the API half of "a fresh instance is not a dead end": since
// issue #79 nothing is imported at boot, so every one of these has to work on
// an EMPTY database, which is what the cold-start cases below run on.
//
// What each case is really pinning:
//
//   * the ID DERIVATION is the shared slug rule, umlauts included — the app
//     shows the id it derives before the POST, so a server that derived
//     another one would make that preview a lie;
//   * a COLLISION writes nothing and answers `slug_taken` WITH a free
//     `suggestion` (the app's one-click "take it"), and the explicit `id` that
//     click sends is honoured verbatim;
//   * an EMPTY npc/ort row — one a reference created (#70) — is FILLED, not
//     collided with;
//   * a scene needs an EXISTING chapter (ADR #14);
//   * an id the ADDRESS SCHEMA reserves (`npcs`/`locations`/`sessions`) is not
//     creatable as a chapter — it would be a row nothing can ever open;
//   * a `suggestion` names only ids nobody holds, empty referenced rows
//     included: filling one of those is the DM's own decision about that id.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignSummary, EntryResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, emptyStore, seedStore } from "./support/store";

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function created<T>(path: string, body: unknown): Promise<T> {
  const res = await post(path, body);
  expect(res.status).toBe(201);
  return (await res.json()) as T;
}

async function errorBody(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("POST /api/campaigns — the cold start", () => {
  beforeEach(async () => {
    await emptyStore();
  });
  afterEach(() => {
    dropStore();
  });

  test("derives the id from the name and answers the summary", async () => {
    const summary = await created<CampaignSummary>("/campaigns", {
      name: "Die Küste von Salzhafen",
      description: "Ein Küstenabenteuer",
    });
    expect(summary.id).toBe("die-kueste-von-salzhafen");
    expect(summary.name).toBe("Die Küste von Salzhafen");
    expect(summary.description).toBe("Ein Küstenabenteuer");

    // It is a campaign like any other from here on: it appears in the list and
    // its document is readable with a guard token.
    const list = (await (await app.request("/api/campaigns")).json()) as CampaignSummary[];
    expect(list.map((c) => c.id)).toEqual(["die-kueste-von-salzhafen"]);
    const doc = (await (
      await app.request("/api/die-kueste-von-salzhafen/file?path=_campaign")
    ).json()) as EntryResponse;
    expect(doc.properties.name).toBe("Die Küste von Salzhafen");
    expect(doc.rev).toBe(1);
  });

  test("a description is optional and a blank one is not stored", async () => {
    const summary = await created<CampaignSummary>("/campaigns", { name: "Nordwind", description: "  " });
    expect(summary.description).toBeUndefined();
  });

  test("a taken id is 409 slug_taken with a free suggestion, and nothing is written", async () => {
    await created<CampaignSummary>("/campaigns", { name: "Nordwind" });
    const res = await post("/campaigns", { name: "Nordwind" });
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.code).toBe("slug_taken");
    expect(body.id).toBe("nordwind");
    expect(body.suggestion).toBe("nordwind-2");
    const list = (await (await app.request("/api/campaigns")).json()) as CampaignSummary[];
    expect(list).toHaveLength(1);
  });

  test("the suggestion can be sent back as an explicit id", async () => {
    await created<CampaignSummary>("/campaigns", { name: "Nordwind" });
    const second = await created<CampaignSummary>("/campaigns", {
      name: "Nordwind",
      id: "nordwind-2",
    });
    expect(second.id).toBe("nordwind-2");
    // The name is the one the DM typed — only the id was taken from the 409.
    expect(second.name).toBe("Nordwind");
  });

  test("a name that yields no id is a 400, not an invented one", async () => {
    const res = await post("/campaigns", { name: "!!! ??? ---" });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    // Language-free since issue #69: a stable code plus the field it points
    // at, and an English technical fallback text next to them.
    expect(body.code).toBe("slug_empty");
    expect(body.kind).toBe("campaign");
    expect(body.field).toBe("name");
    expect(String(body.error)).toContain("yields no id");
  });

  test("an explicit id that is no slug is refused", async () => {
    const res = await post("/campaigns", { name: "Nordwind", id: "Nord Wind" });
    expect(res.status).toBe(400);
  });

  test("an empty name is refused", async () => {
    expect((await post("/campaigns", { name: "   " })).status).toBe(400);
    expect((await post("/campaigns", {})).status).toBe(400);
  });
});

describe("the per-campaign creates", () => {
  beforeEach(async () => {
    await emptyStore();
    await created<CampaignSummary>("/campaigns", { name: "Nordwind" });
  });
  afterEach(() => {
    dropStore();
  });

  test("a chapter takes its id from the title and its goal into the section", async () => {
    const chapter = await created<EntryResponse>("/nordwind/chapters", {
      title: "01 Salzhafen",
      goal: "Die Gruppe kommt an",
    });
    expect(chapter.path).toBe("01-salzhafen/_chapter");
    expect(chapter.properties.title).toBe("01 Salzhafen");
    expect(chapter.body).toBe("## Ziel des Kapitels\n\nDie Gruppe kommt an\n");
  });

  test("a chapter without a goal has an empty body, not an empty section", async () => {
    const chapter = await created<EntryResponse>("/nordwind/chapters", { title: "Prolog" });
    expect(chapter.body).toBe("");
  });

  test("a second chapter with the same title is a 409 with a suggestion", async () => {
    await created<EntryResponse>("/nordwind/chapters", { title: "Prolog" });
    const res = await post("/nordwind/chapters", { title: "Prolog" });
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.code).toBe("slug_taken");
    expect(body.suggestion).toBe("prolog-2");
    expect(body.path).toBe("prolog/_chapter");
  });

  test("a reserved chapter id is refused with a proposal, and no row is written", async () => {
    // „NPCs" slugs to `npcs`, which the address schema routes to the npc kind —
    // the chapter would exist and be unreachable forever (store/paths).
    const res = await post("/nordwind/chapters", { title: "NPCs" });
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    // Its OWN code since issue #69: the app offers the same one-click
    // proposal as for a taken id, but says a different sentence.
    expect(body.code).toBe("slug_reserved");
    expect(body.kind).toBe("chapter");
    expect(body.id).toBe("npcs");
    expect(body.suggestion).toBe("npcs-2");
    expect(String(body.error)).toContain("reserved name");

    // Nothing was created — neither as a chapter row nor as a broken address.
    const tree = (await (await app.request("/api/nordwind/tree")).json()) as {
      chapters: Array<{ id: string }>;
    };
    expect(tree.chapters.map((c) => c.id)).not.toContain("npcs");
    expect((await app.request("/api/nordwind/file?path=npcs/_chapter")).status).toBe(404);

    // The proposal itself works, and the reserved ids are all three of them.
    expect((await created<EntryResponse>("/nordwind/chapters", { title: "NPCs", id: "npcs-2" })).path).toBe(
      "npcs-2/_chapter",
    );
    expect((await post("/nordwind/chapters", { title: "Locations" })).status).toBe(409);
    expect((await post("/nordwind/chapters", { title: "Sessions" })).status).toBe(409);
  });

  test("the campaign 409 points at an address, not at a bare id", async () => {
    const res = await post("/campaigns", { name: "Nordwind" });
    expect(res.status).toBe(409);
    // `_campaign` is the one document an otherwise empty campaign always has.
    expect((await errorBody(res)).path).toBe("nordwind/_campaign");
  });

  test("a proposal never lands on an empty row someone else references (#70)", async () => {
    await created<EntryResponse>("/nordwind/npcs", { name: "Holm" });
    await created<EntryResponse>("/nordwind/chapters", { title: "01 Salzhafen" });
    const scene = await created<EntryResponse>("/nordwind/scenes", {
      title: "Am Steg",
      chapter: "01-salzhafen",
    });
    // A reference leaves an EMPTY `holm-2` behind.
    expect(
      (
        await app.request("/api/nordwind/properties", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: scene.path, rev: scene.rev, patch: { npcs: ["holm-2"] } }),
        })
      ).status,
    ).toBe(200);

    // „Holm" collides with the filled `holm` — and the proposal SKIPS the
    // referenced empty `holm-2` instead of handing it over.
    const res = await post("/nordwind/npcs", { name: "Holm" });
    expect(res.status).toBe(409);
    expect((await errorBody(res)).suggestion).toBe("holm-3");

    // Filling that entry stays possible — for the DM who types exactly its id.
    const filled = await created<EntryResponse>("/nordwind/npcs", { name: "Holm 2" });
    expect(filled.path).toBe("npcs/holm-2");
    expect(filled.properties.name).toBe("Holm 2");
  });

  test("a scene lands in its chapter as a draft with an empty body", async () => {
    await created<EntryResponse>("/nordwind/chapters", { title: "01 Salzhafen" });
    const scene = await created<EntryResponse>("/nordwind/scenes", {
      title: "Ankunft am Leuchtturm",
      chapter: "01-salzhafen",
    });
    expect(scene.path).toBe("01-salzhafen/ankunft-am-leuchtturm");
    expect(scene.properties.status).toBe("draft");
    expect(scene.properties.type).toBe("planned");
    expect(scene.properties.chapter).toBe("01-salzhafen");
    expect(scene.body).toBe("");

    // …and the pool sees it (the tree is what every list reads).
    const tree = (await (await app.request("/api/nordwind/tree")).json()) as {
      chapters: Array<{ id: string; groups: Array<{ scenes: Array<{ path: string }> }> }>;
    };
    expect(tree.chapters[0]?.groups[0]?.scenes[0]?.path).toBe(
      "01-salzhafen/ankunft-am-leuchtturm",
    );
  });

  test("a scene under an unknown chapter is a 400 — chapters are never created by naming", async () => {
    const res = await post("/nordwind/scenes", { title: "Irgendwo", chapter: "gibt-es-nicht" });
    expect(res.status).toBe(400);
    expect(String((await errorBody(res)).error)).toContain("unknown chapter");
  });

  test("a scene without a chapter is refused", async () => {
    expect((await post("/nordwind/scenes", { title: "Irgendwo" })).status).toBe(400);
  });

  test("an npc is created from the name alone", async () => {
    const npc = await created<EntryResponse>("/nordwind/npcs", { name: "Alte Fischerin" });
    expect(npc.path).toBe("npcs/alte-fischerin");
    expect(npc.properties.name).toBe("Alte Fischerin");
    // Nothing is claimed beyond the name — the properties dialog carries the rest.
    expect(npc.properties.status).toBe("unknown");
    expect(npc.properties.role).toBeUndefined();
    expect(npc.body).toBe("");
  });

  test("a filled npc collides; the suggestion skips it", async () => {
    await created<EntryResponse>("/nordwind/npcs", { name: "Holm" });
    const res = await post("/nordwind/npcs", { name: "Holm" });
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.suggestion).toBe("holm-2");
    expect(body.path).toBe("npcs/holm");
  });

  test("an ort is created from the name alone and collides the same way", async () => {
    const location = await created<EntryResponse>("/nordwind/locations", { name: "Hafen" });
    expect(location.path).toBe("locations/hafen");
    expect(location.properties.name).toBe("Hafen");
    expect((await post("/nordwind/locations", { name: "Hafen" })).status).toBe(409);
  });

  test("an EMPTY row a reference created is filled, not collided with (#70)", async () => {
    await created<EntryResponse>("/nordwind/chapters", { title: "01 Salzhafen" });
    const scene = await created<EntryResponse>("/nordwind/scenes", {
      title: "Am Steg",
      chapter: "01-salzhafen",
    });
    // Referencing creates the empty rows — that is the #70 rule.
    const patched = await app.request("/api/nordwind/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: scene.path,
        rev: scene.rev,
        patch: { npcs: ["holm"], location: "bucht" },
      }),
    });
    expect(patched.status).toBe(200);

    // „NPC anlegen" for exactly that id now FILLS the entry.
    const npc = await created<EntryResponse>("/nordwind/npcs", { name: "Holm" });
    expect(npc.path).toBe("npcs/holm");
    expect(npc.properties.name).toBe("Holm");
    const location = await created<EntryResponse>("/nordwind/locations", { name: "Bucht" });
    expect(location.properties.name).toBe("Bucht");
  });

  test("an unknown campaign is a 404 for every per-campaign create", async () => {
    expect((await post("/gibt-es-nicht/chapters", { title: "X" })).status).toBe(404);
    expect((await post("/gibt-es-nicht/npcs", { name: "X" })).status).toBe(404);
    expect((await post("/gibt-es-nicht/locations", { name: "X" })).status).toBe(404);
  });

  test("an unknown body key is refused (the shared body guard)", async () => {
    expect((await post("/nordwind/npcs", { name: "X", role: "Wirt" })).status).toBe(400);
  });

  test("every create bumps the campaign version, so the app refetches", async () => {
    const before = (await (await app.request("/api/nordwind/version")).json()) as {
      version: number;
    };
    await created<EntryResponse>("/nordwind/npcs", { name: "Holm" });
    const after = (await (await app.request("/api/nordwind/version")).json()) as {
      version: number;
    };
    expect(after.version).toBeGreaterThan(before.version);
  });
});

describe("creating next to imported stock", () => {
  beforeEach(async () => {
    await seedStore();
  });
  afterEach(() => {
    dropStore();
  });

  test("a name that collides with imported content answers a free suggestion", async () => {
    // `01-salzhafen` comes from the example campaign.
    const res = await post("/beispiel/chapters", { title: "01 Salzhafen" });
    expect(res.status).toBe(409);
    expect((await errorBody(res)).suggestion).toBe("01-salzhafen-2");
  });

  test("the search index knows a freshly created npc", async () => {
    await created<EntryResponse>("/beispiel/npcs", { name: "Brunhild Wellenbrecher" });
    const found = (await (
      await app.request("/api/beispiel/search?q=Wellenbrecher")
    ).json()) as { results: Array<{ path: string }> };
    expect(found.results.map((r) => r.path)).toContain("npcs/brunhild-wellenbrecher");
  });
});

// The set-active write: the overview action that decides which chapter
// is the one the session is in. It is ONE transaction over TWO rows, which is
// the only thing worth testing about it — an app doing it in two calls would
// have a window with two active chapters, and the session view picks the
// first it finds.
describe("POST /api/:campaign/chapters/:id/active", () => {
  beforeEach(async () => {
    await emptyStore();
    await created<CampaignSummary>("/campaigns", { name: "Nordwind" });
    await created<EntryResponse>("/nordwind/chapters", { title: "01 Salzhafen" });
    await created<EntryResponse>("/nordwind/chapters", { title: "02 Tiefe" });
  });
  afterEach(() => {
    dropStore();
  });

  const statuses = async (): Promise<Record<string, string | undefined>> => {
    const tree = (await (await app.request("/api/nordwind/tree")).json()) as {
      chapters: Array<{ id: string; status?: string }>;
    };
    return Object.fromEntries(tree.chapters.map((c) => [c.id, c.status]));
  };

  test("sets active here and puts the previous one back to planned — in one call", async () => {
    const first = await post("/nordwind/chapters/01-salzhafen/active", {});
    expect(first.status).toBe(200);
    expect(await statuses()).toMatchObject({ "01-salzhafen": "active" });

    const second = await post("/nordwind/chapters/02-tiefe/active", {});
    expect(second.status).toBe(200);
    // The swap, which is the whole point: never two active chapters.
    expect(await statuses()).toEqual({ "01-salzhafen": "planned", "02-tiefe": "active" });
  });

  test("is idempotent and answers the chapter document", async () => {
    expect((await post("/nordwind/chapters/01-salzhafen/active", {})).status).toBe(200);
    const res = await post("/nordwind/chapters/01-salzhafen/active", {});
    expect(res.status).toBe(200);
    const doc = (await res.json()) as EntryResponse;
    expect(doc.path).toBe("01-salzhafen/_chapter");
    expect(doc.properties.status).toBe("active");
    expect(await statuses()).toMatchObject({ "01-salzhafen": "active" });
  });

  test("404 for a chapter that does not exist, and nothing changes", async () => {
    await post("/nordwind/chapters/01-salzhafen/active", {});
    expect((await post("/nordwind/chapters/99-nichts/active", {})).status).toBe(404);
    expect(await statuses()).toMatchObject({ "01-salzhafen": "active" });
  });

  test("400 for an unsafe chapter id", async () => {
    expect((await post("/nordwind/chapters/..%2Fetc/active", {})).status).toBe(400);
  });
});

// The chapter status enum (PO requirement 9): three known values,
// and the API writes nothing else. What is already STORED still degrades —
// that is the format's rule and there is no CHECK constraint behind the
// column — so the two halves are tested apart.
describe("the chapter status enum via PATCH /properties", () => {
  beforeEach(async () => {
    await emptyStore();
    await created<CampaignSummary>("/campaigns", { name: "Nordwind" });
    await created<EntryResponse>("/nordwind/chapters", { title: "01 Salzhafen" });
    await created<EntryResponse>("/nordwind/chapters", { title: "02 Tiefe" });
  });
  afterEach(() => {
    dropStore();
  });

  const statuses = async (): Promise<Record<string, string | undefined>> => {
    const tree = (await (await app.request("/api/nordwind/tree")).json()) as {
      chapters: Array<{ id: string; status?: string }>;
    };
    return Object.fromEntries(tree.chapters.map((c) => [c.id, c.status]));
  };

  async function file(rel: string): Promise<EntryResponse> {
    const res = await app.request(`/api/nordwind/file?path=${encodeURIComponent(rel)}`);
    expect(res.status).toBe(200);
    return (await res.json()) as EntryResponse;
  }

  async function patchStatus(chapter: string, status: unknown): Promise<Response> {
    const doc = await file(`${chapter}/_chapter`);
    return app.request("/api/nordwind/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: doc.path, rev: doc.rev, patch: { status } }),
    });
  }

  test("a created chapter starts at planned", async () => {
    // Not "no status": the overview renders the value, and a chapter without one
    // would look less planned than its siblings.
    const created = await file("02-tiefe/_chapter");
    expect(created.properties.status).toBe("planned");
  });

  test("writes each of the three known values", async () => {
    for (const status of ["planned", "active", "done"]) {
      expect((await patchStatus("01-salzhafen", status)).status).toBe(200);
      expect((await file("01-salzhafen/_chapter")).properties.status).toBe(status);
    }
  });

  test("400 for anything else, and nothing is written", async () => {
    expect((await patchStatus("01-salzhafen", "planned")).status).toBe(200);
    const res = await patchStatus("01-salzhafen", "laeuft");
    expect(res.status).toBe(400);
    // The message names the trio, so the DM reads what IS allowed.
    expect(JSON.stringify(await res.json())).toContain("planned, active, done");
    expect((await file("01-salzhafen/_chapter")).properties.status).toBe("planned");

    // A non-string is the same answer — the wire is not the file.
    expect((await patchStatus("01-salzhafen", 3)).status).toBe(400);
  });

  test("null still deletes the key — a chapter may have no status", async () => {
    expect((await patchStatus("01-salzhafen", "done")).status).toBe(200);
    expect((await patchStatus("01-salzhafen", null)).status).toBe(200);
    expect((await file("01-salzhafen/_chapter")).properties.status).toBeUndefined();
  });

  test("a patch that does NOT touch the status leaves an unknown value alone", async () => {
    // The degrade half: an existing row carrying something else (an import, a
    // legacy hand edit) stays readable AND patchable in its other fields.
    const doc = await file("01-salzhafen/_chapter");
    const { getDb } = await import("../src/store/handle");
    const db = await getDb();
    const { sql } = await import("drizzle-orm");
    db.run(
      sql`update chapters set status = 'laeuft' where campaign_id = 'nordwind' and id = '01-salzhafen'`,
    );

    const fresh = await file("01-salzhafen/_chapter");
    expect(fresh.properties.status).toBe("laeuft");
    const res = await app.request("/api/nordwind/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: doc.path, rev: fresh.rev, patch: { title: "Neu benannt" } }),
    });
    expect(res.status).toBe(200);
    const after = await file("01-salzhafen/_chapter");
    expect(after.properties.title).toBe("Neu benannt");
    expect(after.properties.status).toBe("laeuft");
  });

  // Review finding 4: the chapter properties dialog must not be a
  // second door past the one-active invariant. The endpoint is not the owner
  // of the rule, the column is.
  test("a patch setting active performs the swap, like the endpoint", async () => {
    expect((await post("/nordwind/chapters/01-salzhafen/active", {})).status).toBe(200);
    expect(await statuses()).toEqual({ "01-salzhafen": "active", "02-tiefe": "planned" });

    expect((await patchStatus("02-tiefe", "active")).status).toBe(200);
    // Never two active chapters — whichever door the write came through.
    expect(await statuses()).toEqual({ "01-salzhafen": "planned", "02-tiefe": "active" });
  });

  test("setting a chapter to done does not touch the active one", async () => {
    expect((await post("/nordwind/chapters/01-salzhafen/active", {})).status).toBe(200);
    expect((await patchStatus("02-tiefe", "done")).status).toBe(200);
    expect(await statuses()).toEqual({ "01-salzhafen": "active", "02-tiefe": "done" });
  });
});
