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
import type { CampaignSummary, FileResponse } from "@grimoire/shared";
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
    ).json()) as FileResponse;
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
    expect(String((await errorBody(res)).error)).toContain("ergibt keine id");
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
    const chapter = await created<FileResponse>("/nordwind/chapters", {
      title: "01 Salzhafen",
      goal: "Die Gruppe kommt an",
    });
    expect(chapter.path).toBe("01-salzhafen/_chapter");
    expect(chapter.properties.title).toBe("01 Salzhafen");
    expect(chapter.body).toBe("## Ziel des Kapitels\n\nDie Gruppe kommt an\n");
  });

  test("a chapter without a goal has an empty body, not an empty section", async () => {
    const chapter = await created<FileResponse>("/nordwind/chapters", { title: "Prolog" });
    expect(chapter.body).toBe("");
  });

  test("a second chapter with the same title is a 409 with a suggestion", async () => {
    await created<FileResponse>("/nordwind/chapters", { title: "Prolog" });
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
    expect(body.code).toBe("slug_taken");
    expect(body.id).toBe("npcs");
    expect(body.suggestion).toBe("npcs-2");
    expect(String(body.error)).toContain("reservierter Name");

    // Nothing was created — neither as a chapter row nor as a broken address.
    const tree = (await (await app.request("/api/nordwind/tree")).json()) as {
      chapters: Array<{ id: string }>;
    };
    expect(tree.chapters.map((c) => c.id)).not.toContain("npcs");
    expect((await app.request("/api/nordwind/file?path=npcs/_chapter")).status).toBe(404);

    // The proposal itself works, and the reserved ids are all three of them.
    expect((await created<FileResponse>("/nordwind/chapters", { title: "NPCs", id: "npcs-2" })).path).toBe(
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
    await created<FileResponse>("/nordwind/npcs", { name: "Holm" });
    await created<FileResponse>("/nordwind/chapters", { title: "01 Salzhafen" });
    const scene = await created<FileResponse>("/nordwind/scenes", {
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
    const filled = await created<FileResponse>("/nordwind/npcs", { name: "Holm 2" });
    expect(filled.path).toBe("npcs/holm-2");
    expect(filled.properties.name).toBe("Holm 2");
  });

  test("a scene lands in its chapter as a draft with an empty body", async () => {
    await created<FileResponse>("/nordwind/chapters", { title: "01 Salzhafen" });
    const scene = await created<FileResponse>("/nordwind/scenes", {
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
    const npc = await created<FileResponse>("/nordwind/npcs", { name: "Alte Fischerin" });
    expect(npc.path).toBe("npcs/alte-fischerin");
    expect(npc.properties.name).toBe("Alte Fischerin");
    // Nothing is claimed beyond the name — the properties dialog carries the rest.
    expect(npc.properties.status).toBe("unknown");
    expect(npc.properties.role).toBeUndefined();
    expect(npc.body).toBe("");
  });

  test("a filled npc collides; the suggestion skips it", async () => {
    await created<FileResponse>("/nordwind/npcs", { name: "Holm" });
    const res = await post("/nordwind/npcs", { name: "Holm" });
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.suggestion).toBe("holm-2");
    expect(body.path).toBe("npcs/holm");
  });

  test("an ort is created from the name alone and collides the same way", async () => {
    const location = await created<FileResponse>("/nordwind/locations", { name: "Hafen" });
    expect(location.path).toBe("locations/hafen");
    expect(location.properties.name).toBe("Hafen");
    expect((await post("/nordwind/locations", { name: "Hafen" })).status).toBe(409);
  });

  test("an EMPTY row a reference created is filled, not collided with (#70)", async () => {
    await created<FileResponse>("/nordwind/chapters", { title: "01 Salzhafen" });
    const scene = await created<FileResponse>("/nordwind/scenes", {
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
    const npc = await created<FileResponse>("/nordwind/npcs", { name: "Holm" });
    expect(npc.path).toBe("npcs/holm");
    expect(npc.properties.name).toBe("Holm");
    const location = await created<FileResponse>("/nordwind/locations", { name: "Bucht" });
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
    await created<FileResponse>("/nordwind/npcs", { name: "Holm" });
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
    await created<FileResponse>("/beispiel/npcs", { name: "Brunhild Wellenbrecher" });
    const found = (await (
      await app.request("/api/beispiel/search?q=Wellenbrecher")
    ).json()) as { results: Array<{ path: string }> };
    expect(found.results.map((r) => r.path)).toContain("npcs/brunhild-wellenbrecher");
  });
});
