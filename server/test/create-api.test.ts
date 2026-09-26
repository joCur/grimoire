// The create endpoints — POST /campaigns and the four per-campaign creates.
// This is the API half of "a fresh instance is not a dead end": nothing is
// imported at boot, so every one of these has to work on an EMPTY database,
// which is what the cold-start cases below run on.
//
// What each case is really pinning:
//
//   * the ID DERIVATION is the shared slug rule, umlauts included — the app
//     shows the id it derives before the POST, so a server that derived
//     another one would make that preview a lie;
//   * a COLLISION writes nothing and answers `slug_taken` WITH a free
//     `suggestion` (the app's one-click "take it"), and the explicit `id` that
//     click sends is honoured verbatim;
//   * an EMPTY npc or location — one the DM created and did not fill in — is
//     FILLED, not collided with;
//   * a scene needs an EXISTING chapter (decisions/constraints);
//   * a `suggestion` names only ids nobody holds, empty ones included:
//     filling one of those is the DM's own decision about that id.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  Campaign,
  CampaignSummary,
  Chapter,
  Location,
  Npc,
  Scene,
} from "@grimoire/shared";
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

  test("derives the id from the name and answers the campaign", async () => {
    const campaign = await created<Campaign>("/campaigns", {
      name: "Die Küste von Salzhafen",
      description: "Ein Küstenabenteuer",
    });
    expect(campaign).toEqual({
      id: "die-kueste-von-salzhafen",
      name: "Die Küste von Salzhafen",
      description: "Ein Küstenabenteuer",
      body: "",
      glossaryIntro: "",
      rev: 1,
    });

    // It is a campaign like any other from here on: it appears in the list and
    // is readable with a guard token.
    const list = (await (await app.request("/api/campaigns")).json()) as CampaignSummary[];
    expect(list.map((c) => c.id)).toEqual(["die-kueste-von-salzhafen"]);
    const read = (await (
      await app.request("/api/campaigns/die-kueste-von-salzhafen")
    ).json()) as Campaign;
    expect(read).toEqual(campaign);
  });

  test("a description is optional and a blank one is not stored", async () => {
    const campaign = await created<Campaign>("/campaigns", { name: "Nordwind", description: "  " });
    expect(Object.hasOwn(campaign, "description")).toBe(false);
  });

  test("a taken id is 409 slug_taken with a free suggestion, and nothing is written", async () => {
    await created<Campaign>("/campaigns", { name: "Nordwind" });
    const res = await post("/campaigns", { name: "Nordwind" });
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.code).toBe("slug_taken");
    expect(body.kind).toBe("campaign");
    expect(body.id).toBe("nordwind");
    expect(body.suggestion).toBe("nordwind-2");
    expect(Object.hasOwn(body, "path")).toBe(false);
    const list = (await (await app.request("/api/campaigns")).json()) as CampaignSummary[];
    expect(list).toHaveLength(1);
  });

  test("the suggestion can be sent back as an explicit id", async () => {
    await created<Campaign>("/campaigns", { name: "Nordwind" });
    const second = await created<Campaign>("/campaigns", {
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
    // Language-free: a stable code plus the field it points
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

  test("a key that is no field of the create is refused, and names the key", async () => {
    const res = await post("/campaigns", { name: "Nordwind", body: "Notizen" });
    expect(res.status).toBe(400);
    expect(String((await errorBody(res)).error)).toContain("body");
  });
});

describe("the per-campaign creates", () => {
  beforeEach(async () => {
    await emptyStore();
    await created<Campaign>("/campaigns", { name: "Nordwind" });
  });
  afterEach(() => {
    dropStore();
  });

  test("a chapter takes its id from the title and its body as typed", async () => {
    const chapter = await created<Chapter>("/campaigns/nordwind/chapters", {
      title: "01 Salzhafen",
      body: "  Die Gruppe kommt an.\n\nUnd sieht sich um.\n\n",
    });
    expect(chapter).toEqual({
      id: "01-salzhafen",
      title: "01 Salzhafen",
      // A chapter is born planned unless the DM says otherwise.
      status: "planned",
      // Verbatim, trimmed, one closing newline — no heading around it.
      body: "Die Gruppe kommt an.\n\nUnd sieht sich um.\n",
      rev: 1,
    });
  });

  test("a chapter without a body has an empty text", async () => {
    const chapter = await created<Chapter>("/campaigns/nordwind/chapters", { title: "Prolog" });
    expect(chapter.body).toBe("");
    const blank = await created<Chapter>("/campaigns/nordwind/chapters", {
      title: "Epilog",
      body: "  \n ",
    });
    expect(blank.body).toBe("");
  });

  test("a key that is no field of a chapter is refused — the text is its `body`", async () => {
    for (const key of ["goal", "description"]) {
      const res = await post("/campaigns/nordwind/chapters", { title: "Prolog", [key]: "Ankommen" });
      expect(res.status).toBe(400);
      expect(String((await errorBody(res)).error)).toContain(key);
    }
  });

  test("a second chapter with the same title is a 409 with a suggestion", async () => {
    await created<Chapter>("/campaigns/nordwind/chapters", { title: "Prolog" });
    const res = await post("/campaigns/nordwind/chapters", { title: "Prolog" });
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.code).toBe("slug_taken");
    expect(body.kind).toBe("chapter");
    expect(body.id).toBe("prolog");
    expect(body.suggestion).toBe("prolog-2");
    expect(Object.hasOwn(body, "path")).toBe(false);
  });

  test("a chapter may be called like a list — no id collides with a path", async () => {
    // A chapter is its own resource under `…/chapters/:id`, so `npcs` names
    // a chapter and nothing else.
    const chapter = await created<Chapter>("/campaigns/nordwind/chapters", { title: "NPCs" });
    expect(chapter.id).toBe("npcs");
    expect((await app.request("/api/campaigns/nordwind/chapters/npcs")).status).toBe(200);
  });

  test("a proposal never lands on an existing empty npc", async () => {
    await created<Npc>("/campaigns/nordwind/npcs", { name: "Holm" });
    // An npc whose name IS its id holds nothing — the DM created it and
    // typed nothing else.
    await created<Npc>("/campaigns/nordwind/npcs", { name: "holm-2" });
    await created<Chapter>("/campaigns/nordwind/chapters", { title: "01 Salzhafen" });
    const scene = await created<Scene>("/campaigns/nordwind/scenes", {
      title: "Am Steg",
      chapter: "01-salzhafen",
    });
    // A scene may reference it — the npc exists.
    expect(
      (
        await app.request(`/api/campaigns/nordwind/scenes/${scene.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rev: scene.rev, npcs: ["holm-2"] }),
        })
      ).status,
    ).toBe(200);

    // "Holm" collides with the filled `holm` — and the proposal SKIPS the
    // empty `holm-2` instead of handing somebody else's id over.
    const res = await post("/campaigns/nordwind/npcs", { name: "Holm" });
    expect(res.status).toBe(409);
    expect((await errorBody(res)).suggestion).toBe("holm-3");

    // Filling that npc stays possible — for the DM who types exactly its id.
    const filled = await created<Npc>("/campaigns/nordwind/npcs", { name: "Holm 2" });
    expect(filled.id).toBe("holm-2");
    expect(filled.name).toBe("Holm 2");
  });

  test("a scene lands in its chapter as a draft with an empty body", async () => {
    await created<Chapter>("/campaigns/nordwind/chapters", { title: "01 Salzhafen" });
    const scene = await created<Scene>("/campaigns/nordwind/scenes", {
      title: "Ankunft am Leuchtturm",
      chapter: "01-salzhafen",
    });
    expect(scene.id).toBe("ankunft-am-leuchtturm");
    expect(scene.status).toBe("draft");
    expect(scene.type).toBe("planned");
    expect(scene.chapter).toBe("01-salzhafen");
    expect(scene.body).toBe("");
    // A scene is its own resource (decisions/resources): no address.
    expect(Object.hasOwn(scene, "path")).toBe(false);

    // …and the chapter overview sees it (the tree is what every list reads).
    const tree = (await (await app.request("/api/campaigns/nordwind/tree")).json()) as {
      chapters: Array<{ id: string; scenes: Array<{ id: string }> }>;
    };
    expect(tree.chapters[0]?.scenes[0]?.id).toBe("ankunft-am-leuchtturm");
  });

  test("a scene under an unknown chapter is a 400 — chapters are never created by naming", async () => {
    const res = await post("/campaigns/nordwind/scenes", { title: "Irgendwo", chapter: "gibt-es-nicht" });
    expect(res.status).toBe(400);
    const error = await errorBody(res);
    expect(String(error.error)).toContain("unknown chapter");
    // The SAME refusal a scene patch answers with, code included, so the
    // German sentence comes out of the one catalog entry.
    expect(error).toMatchObject({ code: "chapter_unknown", value: "gibt-es-nicht" });
  });

  test("a scene without a chapter is refused", async () => {
    expect((await post("/campaigns/nordwind/scenes", { title: "Irgendwo" })).status).toBe(400);
  });

  test("an npc is created from the name alone", async () => {
    const npc = await created<Npc>("/campaigns/nordwind/npcs", { name: "Alte Fischerin" });
    expect(npc.id).toBe("alte-fischerin");
    expect(npc.name).toBe("Alte Fischerin");
    // Nothing is claimed beyond the name — the properties dialog carries the rest.
    expect(npc.status).toBe("unknown");
    expect(npc.role).toBeUndefined();
    expect(npc.body).toBe("");
    expect(Object.hasOwn(npc, "path")).toBe(false);
  });

  test("a filled npc collides; the suggestion skips it", async () => {
    await created<Npc>("/campaigns/nordwind/npcs", { name: "Holm" });
    const res = await post("/campaigns/nordwind/npcs", { name: "Holm" });
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.suggestion).toBe("holm-2");
    expect(body).toMatchObject({ kind: "npc", id: "holm" });
    // An npc is its own resource (decisions/resources): the 409 names it by kind and id.
    expect(Object.hasOwn(body, "path")).toBe(false);
  });

  test("an ort is created from the name alone and collides the same way", async () => {
    const location = await created<Location>("/campaigns/nordwind/locations", { name: "Hafen" });
    expect(location.id).toBe("hafen");
    expect(location.name).toBe("Hafen");
    expect(Object.hasOwn(location, "path")).toBe(false);
    expect((await post("/campaigns/nordwind/locations", { name: "Hafen" })).status).toBe(409);
  });

  test("an EMPTY npc or location is filled, not collided with", async () => {
    await created<Chapter>("/campaigns/nordwind/chapters", { title: "01 Salzhafen" });
    const scene = await created<Scene>("/campaigns/nordwind/scenes", {
      title: "Am Steg",
      chapter: "01-salzhafen",
    });
    // An npc and a location created and left empty — their name is their own id.
    await created<Npc>("/campaigns/nordwind/npcs", { name: "holm" });
    await created<Location>("/campaigns/nordwind/locations", { name: "bucht" });
    const patched = await app.request(`/api/campaigns/nordwind/scenes/${scene.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: scene.rev, npcs: ["holm"], location: "bucht" }),
    });
    expect(patched.status).toBe(200);

    // Creating an npc for exactly that id FILLS it.
    const npc = await created<Npc>("/campaigns/nordwind/npcs", { name: "Holm" });
    expect(npc.id).toBe("holm");
    expect(npc.name).toBe("Holm");
    const location = await created<Location>("/campaigns/nordwind/locations", { name: "Bucht" });
    expect(location.name).toBe("Bucht");
  });

  test("an unknown campaign is a 404 for every per-campaign create", async () => {
    expect((await post("/campaigns/gibt-es-nicht/chapters", { title: "X" })).status).toBe(404);
    expect((await post("/campaigns/gibt-es-nicht/npcs", { name: "X" })).status).toBe(404);
    expect((await post("/campaigns/gibt-es-nicht/locations", { name: "X" })).status).toBe(404);
  });

  test("an unknown body key is refused, and names the key", async () => {
    const res = await post("/campaigns/nordwind/npcs", { name: "X", role: "Wirt" });
    expect(res.status).toBe(400);
    expect(String((await errorBody(res)).error)).toContain("role");
  });

  test("every create bumps the campaign version, so the app refetches", async () => {
    const before = (await (await app.request("/api/campaigns/nordwind/version")).json()) as {
      version: number;
    };
    await created<Npc>("/campaigns/nordwind/npcs", { name: "Holm" });
    const after = (await (await app.request("/api/campaigns/nordwind/version")).json()) as {
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
    const res = await post("/campaigns/beispiel/chapters", { title: "01 Salzhafen" });
    expect(res.status).toBe(409);
    expect((await errorBody(res)).suggestion).toBe("01-salzhafen-2");
  });

  test("the search index knows a freshly created npc", async () => {
    await created<Npc>("/campaigns/beispiel/npcs", { name: "Brunhild Wellenbrecher" });
    const found = (await (
      await app.request("/api/campaigns/beispiel/search?q=Wellenbrecher")
    ).json()) as { results: Array<{ kind: string; id: string }> };
    expect(found.results).toContainEqual(
      expect.objectContaining({ kind: "npc", id: "brunhild-wellenbrecher" }),
    );
  });
});
