// Content-safety regressions of the SQLite cutover.
//
// One rule holds every case in this file together, and it is the guard rail of
// the whole cutover: NO WRITE PATH MAY SILENTLY LOSE CONTENT. Each test below
// stands for one way the first cut of the store did lose some — an npc's
// prose under `## Beziehungen`, a glossary term's line breaks, a scene's
// place in the tree, an open edit that could not be saved any more, a log
// line whose columns fell apart.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { CampaignTree, Npc, SceneProposal, SessionResponse } from "@grimoire/shared";
import type { GlossaryTerm } from "@grimoire/shared/glossary-term";
import { app } from "../src/server";
import { ApiError } from "../src/api-error";
import { writeGenerated } from "../src/store/generated";
import { dropStore, seedStore } from "./support/store";
/** An npc is its own resource (ADR #31): read and written flat, `body` among its fields. */
async function getNpc(id: string): Promise<Npc> {
  const res = await app.request(`/api/campaigns/beispiel/npcs/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Npc;
}

async function patchNpcOk(id: string, body: unknown): Promise<Npc> {
  const res = await app.request(`/api/campaigns/beispiel/npcs/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Npc;
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** Send a JSON body to one glossary term, or to the list of them. */
async function sendTerm(method: string, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function tree(): Promise<CampaignTree> {
  const res = await app.request("/api/campaigns/beispiel/tree");
  expect(res.status).toBe(200);
  return (await res.json()) as CampaignTree;
}

/** The campaign's glossary terms — each its own resource (ADR #31). */
async function listTerms(): Promise<GlossaryTerm[]> {
  const res = await app.request(TERMS);
  expect(res.status).toBe(200);
  return (await res.json()) as GlossaryTerm[];
}

async function version(): Promise<number> {
  const res = await app.request("/api/campaigns/beispiel/version");
  expect(res.status).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

const NPC = "fenn";
const TERMS = "/api/campaigns/beispiel/glossary-terms";

beforeEach(async () => {
  setSystemTime(new Date(2026, 7, 19, 21, 5));
  await seedStore();
});

afterEach(() => {
  setSystemTime();
  dropStore();
});

describe("an npc's `## Beziehungen` keeps what became no row", () => {
  test("prose and a duplicate counterpart survive the save", async () => {
    const before = await getNpc(NPC);
    expect(before.body).toContain("- [[jorna]]: alte Bekannte");

    // Three things under the heading: one relation line (a row), one prose
    // line (no row), and a SECOND line for jorna (the composite key allows
    // only one row per counterpart). Only the first is a relation.
    const body =
      "\n## Beziehungen\n\n- jorna: alte Bekannte\n" +
      "Beide kennen sich aus der Zeit vor dem Leuchtturm.\n" +
      "- jorna: und schuldet ihr Geld\n\n## Notizen\n";
    const after = await patchNpcOk(NPC, { rev: before.rev, body });

    // the relation is a row and comes back rendered …
    expect(after.body).toContain("- jorna: alte Bekannte");
    // … and NEITHER of the two lines that could not become a row is gone
    expect(after.body).toContain("Beide kennen sich aus der Zeit vor dem Leuchtturm.");
    expect(after.body).toContain("- jorna: und schuldet ihr Geld");
    // one heading, in its original place — not a second one appended
    expect(after.body.match(/^## Beziehungen$/gm)).toHaveLength(1);
    expect(after.body.indexOf("## Beziehungen")).toBeLessThan(after.body.indexOf("## Notizen"));
    expect(await getNpc(NPC)).toEqual(after);
  });

  test("saving the rendered body again is a fixed point", async () => {
    const before = await getNpc(NPC);
    const body =
      "\n## Beziehungen\n\n- jorna: alte Bekannte\nEin Satz, der keine Beziehung ist.\n";
    const first = await patchNpcOk(NPC, { rev: before.rev, body });
    const second = await patchNpcOk(NPC, { rev: first.rev, body: first.body });
    expect(second.body).toBe(first.body);
    const third = await patchNpcOk(NPC, { rev: second.rev, body: second.body });
    expect(third.body).toBe(first.body);
  });

  test("a section that is ONLY relations still renders once, at the end", async () => {
    const before = await getNpc(NPC);
    const body = "\n## Will\n\nRaus aus dem Geschäft.\n\n## Beziehungen\n\n- jorna: Ex-Kollegin\n";
    const after = await patchNpcOk(NPC, { rev: before.rev, body });
    expect(after.body.match(/^## Beziehungen$/gm)).toHaveLength(1);
    expect(after.body).toContain("- jorna: Ex-Kollegin");
    expect(after.body).toContain("Raus aus dem Geschäft.");
  });
});

describe("glossary terms — rows, each with its own guard", () => {
  test("an emptied glossary is an empty list (200), and the DM can type it back in", async () => {
    for (const term of await listTerms()) {
      expect((await sendTerm("DELETE", `${TERMS}/${term.id}`, { rev: term.rev })).status).toBe(204);
    }
    expect(await listTerms()).toEqual([]);
    const res = await sendTerm("POST", TERMS, { term: "tide pool", explanation: "Gezeitentümpel" });
    expect(res.status).toBe(201);
    expect((await listTerms()).map(({ term, explanation }) => ({ term, explanation }))).toEqual([
      { term: "tide pool", explanation: "Gezeitentümpel" },
    ]);
  });

  test("a multi-line explanation keeps its line breaks through a save", async () => {
    // Nothing flattens an explanation on the way in or out: it is one column
    // and travels as one string.
    const explanation = "Zeile eins\nZeile zwei";
    const res = await sendTerm("POST", TERMS, { term: "Ton", explanation });
    expect(res.status).toBe(201);
    const created = (await res.json()) as GlossaryTerm;
    expect(created.explanation).toBe(explanation);
    expect((await listTerms()).find((term) => term.id === created.id)?.explanation).toBe(
      explanation,
    );
  });

  test("an unrelated write does not invalidate an open term edit", async () => {
    // A term's guard is its own row version, not `campaigns.version`, which
    // any write — a quick note during a running session — moves.
    const [open] = await listTerms();
    expect((await postJson("/api/campaigns/beispiel/session/start")).status).toBe(200);
    expect((await postJson("/api/campaigns/beispiel/log", { text: "Etwas passiert" })).status).toBe(200);
    expect((await postJson("/api/campaigns/beispiel/ideas", { text: "Idee #idee" })).status).toBe(201);
    expect(await version()).toBeGreaterThan(1);

    const saved = await sendTerm("PATCH", `${TERMS}/${open!.id}`, {
      rev: open!.rev,
      explanation: "Gezeitentümpel",
    });
    expect(saved.status).toBe(200);
    // Its own writes DO move it: the same guard again is a 409 with the term.
    const stale = await sendTerm("PATCH", `${TERMS}/${open!.id}`, {
      rev: open!.rev,
      explanation: "Überschrieben",
    });
    expect(stale.status).toBe(409);
    const conflict = (await stale.json()) as { code: string; glossaryTerm: GlossaryTerm };
    expect(conflict.code).toBe("rev_conflict");
    expect(conflict.glossaryTerm.explanation).toBe("Gezeitentümpel");
  });
});

describe("writeGenerated — the conflict check is IN the insert transaction", () => {
  /** A proposed scene, as the generator hands it over — the scene without its guard. */
  function proposal(id: string): SceneProposal {
    return {
      id,
      title: id,
      type: "planned",
      chapter: "01-salzhafen",
      npcs: [],
      handouts: [],
      tags: [],
      status: "draft",
      body: "\n## Flow\n\nNeu.\n",
    };
  }

  test("an existing target is the documented 409 { scenes }, never a 500", async () => {
    // The check used to run BEFORE the transaction (generator.ts), which left
    // a window in which the target could appear between "free" and "insert" —
    // and then the documented answer became a primary-key violation.
    let thrown: unknown;
    try {
      await writeGenerated("beispiel", { scenes: [proposal("lighthouse-arrival")] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    const api = thrown as ApiError;
    expect(api.status).toBe(409);
    // reported by the scene's id
    expect(api.extra?.scenes).toEqual(["lighthouse-arrival"]);
  });

  test("all or nothing: a conflict late in the batch writes none of it", async () => {
    const before = await tree();
    await expect(
      writeGenerated("beispiel", {
        scenes: [proposal("ganz-neu"), proposal("smuggler-captured")],
      }),
    ).rejects.toThrow();
    // not even the first, conflict-free scene landed
    expect(await tree()).toEqual(before);
  });
});

describe("POST /log — a note's scene is a reference, and a reference is a slug", () => {
  test("a sceneId outside the slug shape is refused, nothing appended", async () => {
    const start = await postJson("/api/campaigns/beispiel/session/start");
    expect(start.status).toBe(200);
    const before = (await start.json()) as SessionResponse;
    // (An EMPTY sceneId is not in this list: the route normalises it away to
    // "no scene", which is the same thing as omitting the key.)
    for (const sceneId of ["boom) und mehr", "a b", "Gross", "with/slash", "-lead"]) {
      const res = await postJson("/api/campaigns/beispiel/log", { text: "Notiz", sceneId });
      expect(res.status).toBe(400);
    }
    const unchanged = await app.request(`/api/campaigns/beispiel/sessions/${before.id}`);
    expect(await unchanged.json()).toEqual(before);
    // the legal form still works, and lands in its own column
    const ok = await postJson("/api/campaigns/beispiel/log", {
      text: "Notiz",
      sceneId: "lighthouse-arrival",
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as SessionResponse).log.at(-1)).toMatchObject({
      sceneId: "lighthouse-arrival",
      text: "Notiz",
    });
  });
});
