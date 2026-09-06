// "Referencing creates" (issue #70).
//
// The DB model (#52/#13) says a referenced entity is never MISSING, only
// EMPTY: an npc without information is a row with an id and a name. The file
// era's answer was a permanent hole plus a "Stub anlegen" button. These cases
// pin the new rule on every write path that can introduce a reference, and
// the one boundary that stays: free text in `location` is still free text.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CampaignTree, FileResponse } from "@grimoire/shared";
import { sceneNpcs } from "../src/db/schema";
import { app } from "../src/server";
import { getDb, storeInfo } from "../src/store/handle";
import { applyDrafts } from "../src/store/write";
import {
  dropStore,
  removeTempRoot,
  seedStore,
  tempCampaignRoot,
  useCampaignRoot,
} from "./support/store";

const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";
const NPC = "npcs/fenn.md";

async function getFile(rel: string, campaign = "beispiel"): Promise<FileResponse> {
  const res = await app.request(`/api/${campaign}/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function fileStatus(rel: string, campaign = "beispiel"): Promise<number> {
  return (await app.request(`/api/${campaign}/file?path=${encodeURIComponent(rel)}`)).status;
}

async function patchFm(rel: string, patch: Record<string, unknown>): Promise<FileResponse> {
  const before = await getFile(rel);
  const res = await app.request("/api/beispiel/frontmatter", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, mtimeMs: before.mtimeMs, patch }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function putBody(rel: string, body: string): Promise<FileResponse> {
  const before = await getFile(rel);
  const res = await app.request("/api/beispiel/file", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, mtimeMs: before.mtimeMs, body }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function tree(): Promise<CampaignTree> {
  const res = await app.request("/api/beispiel/tree");
  expect(res.status).toBe(200);
  return (await res.json()) as CampaignTree;
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("a reference creates the entry it names", () => {
  test("a scene's npcs list: the new id has an EMPTY entry, not a hole", async () => {
    expect(await fileStatus("npcs/holm.md")).toBe(404);
    await patchFm(SCENE, { npcs: ["jorna", "holm"] });

    const created = await getFile("npcs/holm.md");
    expect(created.kind).toBe("npc");
    // Nothing but the id: the id IS the display name until somebody types
    // one, and the status is the neutral default.
    expect(created.frontmatter.id).toBe("holm");
    expect(created.frontmatter.name).toBe("holm");
    expect(created.frontmatter.status).toBe("unknown");
    expect(created.body.trim()).toBe("");
    // It is a normal entry: in the tree, patchable, and its own rev token.
    expect((await tree()).npcs.some((n) => n.id === "holm")).toBe(true);
    const named = await patchFm("npcs/holm.md", { name: "Holm", role: "Netzflicker" });
    expect(named.frontmatter.name).toBe("Holm");
  });

  test("a scene's location, when it is a slug", async () => {
    expect(await fileStatus("locations/bucht.md")).toBe(404);
    await patchFm(SCENE, { location: "bucht" });
    const created = await getFile("locations/bucht.md");
    expect(created.frontmatter.name).toBe("bucht");
    expect((await tree()).locations.some((l) => l.id === "bucht")).toBe(true);
  });

  test("free text in location stays free text — no entry, no invented Ort", async () => {
    // The format allows a free string there (README). Spaces or capitals make
    // it unmistakably text, and text must not become an entity.
    await patchFm(SCENE, { location: "Der alte Hafen" });
    expect((await getFile(SCENE)).frontmatter.location).toBe("Der alte Hafen");
    expect((await tree()).locations.some((l) => l.name === "Der alte Hafen")).toBe(false);
    await patchFm(SCENE, { location: "Nordbucht" });
    expect((await tree()).locations.some((l) => l.id === "Nordbucht")).toBe(false);
  });

  test("an unrelated patch does not materialise an EXISTING reference", async () => {
    // A `PATCH { status }` re-sends the scene's stored `location`. Creating a
    // row for it would retroactively turn every legacy free-text place name
    // into an entity nobody authored — only NEW references are created.
    const before = (await tree()).locations.map((l) => l.id);
    await patchFm("01-salzhafen/hafen/smuggler-captured.md", { status: "played" });
    expect((await tree()).locations.map((l) => l.id)).toEqual(before);
  });

  test("the counterpart of a ## Beziehungen line", async () => {
    const npc = await getFile(NPC);
    expect(npc.body).toContain("- jorna: alte Bekannte");
    await putBody(
      NPC,
      npc.body.replace(
        "- jorna: alte Bekannte; er weicht ihrem Blick aus",
        "- jorna: alte Bekannte; er weicht ihrem Blick aus\n- holm: schuldet ihm Geld",
      ),
    );
    const created = await getFile("npcs/holm.md");
    expect(created.frontmatter.name).toBe("holm");
    // The relation itself is unchanged — one-sided, as authored.
    expect((await getFile(NPC)).body).toContain("- holm: schuldet ihm Geld");
    expect((await getFile("npcs/holm.md")).body).not.toContain("Beziehungen");
  });
});

describe("the boot pass for migrated stock", () => {
  test("a dangling npc reference from the file era gets an empty entry", async () => {
    const root = await tempCampaignRoot();
    const restore = useCampaignRoot(root);
    try {
      const scene = path.join(root, "beispiel", "01-salzhafen", "hafen", "ankunft-leuchtturm.md");
      const raw = await readFile(scene, "utf8");
      await writeFile(scene, raw.replace("npcs: [jorna]", "npcs: [jorna, alte-fischerin]"));
      await seedStore(root);

      // The pass reports what it created, so a boot that changes data says so.
      expect(storeInfo()?.backfilledNpcs).toEqual(["beispiel/alte-fischerin"]);
      const created = await getFile("npcs/alte-fischerin.md");
      expect(created.frontmatter.name).toBe("alte-fischerin");
      expect((await tree()).npcs.some((n) => n.id === "alte-fischerin")).toBe(true);
    } finally {
      restore();
      await removeTempRoot(root);
    }
  });

  test("a clean campaign is untouched — and a slug-shaped location stays text", async () => {
    // `location: bucht` in the examples has no locations row and must KEEP
    // none: in that one field a slug is indistinguishable from free text, so
    // a blanket pass would invent Orte the DM never wrote.
    expect(storeInfo()?.backfilledNpcs).toEqual([]);
    expect(await fileStatus("locations/bucht.md")).toBe(404);
  });
});

describe("the generator's apply step", () => {
  test("a scene draft creates its unknown npc — and the npc draft FILLS that row", async () => {
    // Order matters here: the scene is inserted first and creates the empty
    // `holm` row, so the npc draft in the SAME batch would have collided
    // with a row put there by itself. An empty row is not a conflict.
    await applyDrafts("beispiel", [
      {
        rel: "01-salzhafen/hafen/neue-szene.md",
        address: "01-salzhafen/hafen/neue-szene.md",
        frontmatter: {
          id: "neue-szene",
          title: "Neue Szene",
          npcs: ["holm"],
          location: "bucht",
          status: "draft",
        },
        body: "\n## Was passiert\n\nEtwas.\n",
      },
      {
        rel: "npcs/holm.md",
        address: "npcs/holm.md",
        frontmatter: { id: "holm", name: "Holm", status: "alive" },
        body: "\n## Will\n\nSeine Netze zurück.\n",
      },
    ]);
    const npc = await getFile("npcs/holm.md");
    expect(npc.frontmatter.name).toBe("Holm");
    expect(npc.frontmatter.status).toBe("alive");
    expect(npc.body).toContain("Seine Netze zurück.");
    // The scene's location got its empty row too.
    expect((await getFile("locations/bucht.md")).frontmatter.name).toBe("bucht");
  });

  test("a row that holds CONTENT is still a 409 conflict", async () => {
    const before = await getFile(NPC);
    await expect(
      applyDrafts("beispiel", [
        {
          rel: "npcs/fenn.md",
          address: "npcs/fenn.md",
          frontmatter: { id: "fenn", name: "Anders" },
          body: "\n## Will\n\nAnderes.\n",
        },
      ]),
    ).rejects.toThrow(/already exist/);
    expect(await getFile(NPC)).toEqual(before);
  });
});

describe("the rename cascade", () => {
  test("a scene listing BOTH ids merges instead of failing on the primary key", async () => {
    // A scene that lists both `jorna` and a `holm` WITHOUT a row: renaming
    // jorna onto that id used to violate `scene_npcs`' primary key — a 500
    // out of a rename whose preview had just called it safe. The boot pass
    // makes that state unreachable through the API from now on, so the row
    // is put there directly: it is exactly what a database migrated before
    // this change can hold at the moment of the rename.
    const db = await getDb();
    db.insert(sceneNpcs)
      .values({
        campaignId: "beispiel",
        sceneId: "lighthouse-arrival",
        npcId: "holm",
        pos: 9,
      })
      .run();

    const res = await app.request("/api/beispiel/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "npc", oldId: "jorna", newId: "holm" }),
    });
    expect(res.status).toBe(200);
    // One entry left, not a constraint error and not a duplicate.
    expect((await getFile(SCENE)).frontmatter.npcs).toEqual(["holm"]);
  });
});

describe("empty is not missing", () => {
  test("an empty inbox is an empty document (200), not a missing one", async () => {
    const inbox = await getFile("inbox.md");
    expect(inbox.kind).toBe("inbox");
  });
});

describe("a patch never drops what the migration preserved", () => {
  test("a misshapen quickstats survives a frontmatter patch", async () => {
    // The migration keeps a `quickstats:` the column cannot hold (a list
    // where the format wants a mapping) in `extra`, and the renderer shows
    // it. The first patch used to delete it — silently, against the
    // round-trip rule (schema.ts rule 1).
    const root = await tempCampaignRoot();
    const restore = useCampaignRoot(root);
    try {
      const npc = path.join(root, "beispiel", "npcs", "fenn.md");
      const raw = await readFile(npc, "utf8");
      await writeFile(
        npc,
        raw.replace(/^quickstats:.*$/m, "quickstats: [ac 12, hp 9]"),
      );
      await seedStore(root);

      expect((await getFile(NPC)).frontmatter.quickstats).toEqual(["ac 12", "hp 9"]);
      const patched = await patchFm(NPC, { role: "Anders" });
      expect(patched.frontmatter.role).toBe("Anders");
      expect(patched.frontmatter.quickstats).toEqual(["ac 12", "hp 9"]);
      // …and it is still there on the next read, not only in the answer.
      expect((await getFile(NPC)).frontmatter.quickstats).toEqual(["ac 12", "hp 9"]);
    } finally {
      restore();
      await removeTempRoot(root);
    }
  });
});
