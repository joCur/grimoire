// Content-safety regressions of the SQLite cutover (issue #57 review).
//
// One rule holds every case in this file together, and it is the guard rail of
// the whole cutover: NO WRITE PATH MAY SILENTLY LOSE CONTENT. Each test below
// stands for one way the first cut of the store did lose some — an npc's
// prose under `## Beziehungen`, the glossary's unassignable text, a scene's
// place in the tree, an open edit that could not be saved any more, a log
// line whose columns fell apart.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CampaignTree, FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { ApiError } from "../src/campaign-fs";
import { setNow } from "../src/clock";
import { applyDrafts } from "../src/store/write";
import {
  dropStore,
  removeTempRoot,
  seedStore,
  tempCampaignRoot,
} from "./support/store";

async function getFile(rel: string): Promise<FileResponse> {
  const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function putFile(body: unknown): Promise<Response> {
  return app.request("/api/beispiel/file", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function putOk(body: unknown): Promise<FileResponse> {
  const res = await putFile(body);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function patchReq(body: unknown): Promise<Response> {
  return app.request("/api/beispiel/properties", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchOk(body: unknown): Promise<FileResponse> {
  const res = await patchReq(body);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

async function tree(): Promise<CampaignTree> {
  const res = await app.request("/api/beispiel/tree");
  expect(res.status).toBe(200);
  return (await res.json()) as CampaignTree;
}

async function version(): Promise<number> {
  const res = await app.request("/api/beispiel/version");
  expect(res.status).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

const NPC = "npcs/fenn";
const SCENE = "01-salzhafen/hafen/lighthouse-arrival";
const GLOSSARY = "glossary";

beforeEach(async () => {
  setNow(() => new Date(2026, 7, 19, 21, 5));
  await seedStore();
});

afterEach(() => {
  setNow(null);
  dropStore();
});

describe("PUT /file — an npc's `## Beziehungen` keeps what became no row", () => {
  test("prose and a duplicate counterpart survive the save", async () => {
    const before = await getFile(NPC);
    expect(before.body).toContain("- jorna: alte Bekannte");

    // Three things under the heading: one relation line (a row), one prose
    // line (no row), and a SECOND line for jorna (the composite key allows
    // only one row per counterpart). Only the first is a relation.
    const body =
      "\n## Beziehungen\n\n- jorna: alte Bekannte\n" +
      "Beide kennen sich aus der Zeit vor dem Leuchtturm.\n" +
      "- jorna: und schuldet ihr Geld\n\n## Notizen\n";
    const after = await putOk({ path: NPC, rev: before.rev, body });

    // the relation is a row and comes back rendered …
    expect(after.body).toContain("- jorna: alte Bekannte");
    // … and NEITHER of the two lines that could not become a row is gone
    expect(after.body).toContain("Beide kennen sich aus der Zeit vor dem Leuchtturm.");
    expect(after.body).toContain("- jorna: und schuldet ihr Geld");
    // one heading, in its original place — not a second one appended
    expect(after.body.match(/^## Beziehungen$/gm)).toHaveLength(1);
    expect(after.body.indexOf("## Beziehungen")).toBeLessThan(after.body.indexOf("## Notizen"));
    expect(await getFile(NPC)).toEqual(after);
  });

  test("saving the rendered body again is a fixed point", async () => {
    const before = await getFile(NPC);
    const body =
      "\n## Beziehungen\n\n- jorna: alte Bekannte\nEin Satz, der keine Beziehung ist.\n";
    const first = await putOk({ path: NPC, rev: before.rev, body });
    const second = await putOk({ path: NPC, rev: first.rev, body: first.body });
    expect(second.body).toBe(first.body);
    const third = await putOk({ path: NPC, rev: second.rev, body: second.body });
    expect(third.body).toBe(first.body);
  });

  test("a section that is ONLY relations still renders once, at the end", async () => {
    const before = await getFile(NPC);
    const body = "\n## Will\n\nRaus aus dem Geschäft.\n\n## Beziehungen\n\n- jorna: Ex-Kollegin\n";
    const after = await putOk({ path: NPC, rev: before.rev, body });
    expect(after.body.match(/^## Beziehungen$/gm)).toHaveLength(1);
    expect(after.body).toContain("- jorna: Ex-Kollegin");
    expect(after.body).toContain("Raus aus dem Geschäft.");
  });
});

describe("glossary — nothing unassignable is dropped, and it stays reachable", () => {
  test("prose above the first heading survives a save", async () => {
    const before = await getFile(GLOSSARY);
    const body =
      "\nDieser Text steht über allem und gehört zu keinem Begriff.\n\n" +
      "- tide pool → Gezeitentümpel\n";
    const after = await putOk({ path: GLOSSARY, rev: before.rev, body });
    expect(after.body).toContain("Dieser Text steht über allem und gehört zu keinem Begriff.");
    expect(after.body).toContain("- tide pool → Gezeitentümpel");
    // and a GET says the same — it is stored, not just echoed back
    const read = await getFile(GLOSSARY);
    expect(read.body).toBe(after.body);
    // saving the rendering back keeps it
    const again = await putOk({ path: GLOSSARY, rev: read.rev, body: read.body });
    expect(again.body).toBe(read.body);
  });

  test("an empty glossary is an empty document (200), still editable", async () => {
    const before = await getFile(GLOSSARY);
    const emptied = await putOk({ path: GLOSSARY, rev: before.rev, body: "" });
    expect(emptied.body).toBe("");
    // The 404 this used to answer made the file the editor was in unreachable.
    const read = await getFile(GLOSSARY);
    expect(read.body).toBe("");
    expect(read.path).toBe(GLOSSARY);
    // …and the DM can type the glossary back in.
    const refilled = await putOk({
      path: GLOSSARY,
      rev: read.rev,
      body: "\n- tide pool → Gezeitentümpel\n",
    });
    expect(refilled.body).toContain("- tide pool → Gezeitentümpel");
  });

  test("a term typed twice is refused, not half-saved", async () => {
    const before = await getFile(GLOSSARY);
    const res = await putFile({
      path: GLOSSARY,
      rev: before.rev,
      body: "\n- tide pool → Gezeitentümpel\n- tide pool → Tidenbecken\n",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("tide pool");
    // nothing was written — the old glossary is untouched
    expect(await getFile(GLOSSARY)).toEqual(before);
  });
});

describe("guard tokens of the two list documents", () => {
  test("an unrelated write does not invalidate an open glossary edit", async () => {
    // The bug: `campaigns.version` was the glossary's token, so ANY write —
    // a quick note during a running session — made a pending glossary edit
    // unsaveable. The token is the glossary's own counter now.
    const glossary = await getFile(GLOSSARY);
    expect((await postJson("/api/beispiel/session/start")).status).toBe(200);
    expect((await postJson("/api/beispiel/log", { text: "Etwas passiert" })).status).toBe(200);
    expect((await postJson("/api/beispiel/inbox", { text: "Idee #idee" })).status).toBe(200);
    expect(await version()).toBeGreaterThan(1);

    const saved = await putOk({
      path: GLOSSARY,
      rev: glossary.rev,
      body: "\n- tide pool → Gezeitentümpel\n",
    });
    expect(saved.body).toContain("Gezeitentümpel");
    // its own writes DO move the token
    expect(saved.rev).toBe(glossary.rev + 1);
    const stale = await putFile({ path: GLOSSARY, rev: glossary.rev, body: "" });
    expect(stale.status).toBe(409);
  });

  test("the inbox token moves on inbox writes only", async () => {
    const before = await getFile("inbox");
    expect((await postJson("/api/beispiel/session/start")).status).toBe(200);
    expect(await getFile("inbox")).toEqual(before);
    expect((await postJson("/api/beispiel/inbox", { text: "Neu" })).status).toBe(200);
    expect((await getFile("inbox")).rev).toBe(before.rev + 1);
  });
});

describe("PATCH /properties — a scene's `chapter`", () => {
  test("null deletes the key and the scene keeps its place in the tree", async () => {
    const before = await getFile(SCENE);
    expect(before.properties.chapter).toBe("01-salzhafen");

    const after = await patchOk({
      path: SCENE,
      rev: before.rev,
      patch: { chapter: null },
    });
    expect("chapter" in after.properties).toBe(false);
    // The address is untouched — a deleted KEY must never move a scene, let
    // alone drop it out of the tree.
    expect(after.path).toBe(SCENE);
    const chapter = (await tree()).chapters[0]!;
    expect(chapter.groups[0]!.scenes.map((s) => s.id)).toContain("lighthouse-arrival");
    expect((await getFile(SCENE)).properties.chapter).toBeUndefined();
  });

  test("a chapter that does not exist -> 400, nothing written", async () => {
    const before = await getFile(SCENE);
    const res = await patchReq({
      path: SCENE,
      rev: before.rev,
      patch: { chapter: "99-gibt-es-nicht" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("99-gibt-es-nicht");
    expect(await getFile(SCENE)).toEqual(before);
  });

  test("an existing chapter moves the scene, and the tree follows", async () => {
    const root = await tempCampaignRoot();
    try {
      await mkdir(path.join(root, "beispiel", "02-nordbucht"), { recursive: true });
      await writeFile(
        path.join(root, "beispiel", "02-nordbucht", "_chapter.md"),
        "---\nid: 02-nordbucht\ntitle: Kapitel 2\nstatus: planned\n---\n",
        "utf8",
      );
      await seedStore(root);

      const before = await getFile(SCENE);
      const after = await patchOk({
        path: SCENE,
        rev: before.rev,
        patch: { chapter: "02-nordbucht" },
      });
      expect(after.properties.chapter).toBe("02-nordbucht");
      expect(after.path).toBe("02-nordbucht/hafen/lighthouse-arrival");
      const chapters = (await tree()).chapters;
      const moved = chapters.find((c) => c.id === "02-nordbucht");
      expect(moved?.groups[0]?.scenes.map((s) => s.id)).toEqual(["lighthouse-arrival"]);
    } finally {
      await removeTempRoot(root);
    }
  });
});

describe("applyDrafts — the conflict check is IN the insert transaction", () => {
  /** The properties/body of a scene draft, as the generator hands it over. */
  function draft(id: string): {
    rel: string;
    address: string;
    properties: Record<string, unknown>;
    body: string;
  } {
    const rel = `01-salzhafen/hafen/${id}`;
    return {
      rel,
      address: rel,
      properties: { id, title: id, type: "planned", chapter: "01-salzhafen", status: "draft" },
      body: "\n## Flow\n\nNeu.\n",
    };
  }

  test("an existing target is the documented 409 { conflicts }, never a 500", async () => {
    // The check used to run BEFORE the transaction (generator.ts), which left
    // a window in which the target could appear between "free" and "insert" —
    // and then the documented answer became a primary-key violation.
    let thrown: unknown;
    try {
      await applyDrafts("beispiel", [draft("lighthouse-arrival")]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    const api = thrown as ApiError;
    expect(api.status).toBe(409);
    expect(api.extra?.conflicts).toEqual(["01-salzhafen/hafen/lighthouse-arrival"]);
  });

  test("all or nothing: a conflict late in the batch writes none of it", async () => {
    const before = await tree();
    await expect(
      applyDrafts("beispiel", [draft("ganz-neu"), draft("smuggler-captured")]),
    ).rejects.toThrow();
    // not even the first, conflict-free draft landed
    expect(await tree()).toEqual(before);
  });
});

describe("POST /log — the scene marker is a parse column", () => {
  test("a sceneId with a closing paren is refused, nothing appended", async () => {
    const start = await postJson("/api/beispiel/session/start");
    expect(start.status).toBe(200);
    // The session's id is opaque (issue #58), so its path comes from the start.
    const rel = ((await start.json()) as FileResponse).path;
    const before = await getFile(rel);
    // (An EMPTY sceneId is not in this list: the route normalises it away to
    // "no scene", which is the same thing as omitting the key.)
    for (const sceneId of ["boom) und mehr", "a b", "Gross", "with/slash", "-lead"]) {
      const res = await postJson("/api/beispiel/log", { text: "Notiz", sceneId });
      expect(res.status).toBe(400);
    }
    expect(await getFile(rel)).toEqual(before);
    // the legal form still works
    const ok = await postJson("/api/beispiel/log", {
      text: "Notiz",
      sceneId: "lighthouse-arrival",
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as FileResponse).body).toContain("(lighthouse-arrival) Notiz");
  });
});
