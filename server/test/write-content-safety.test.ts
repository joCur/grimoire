// Content-safety regressions of the SQLite cutover.
//
// One rule holds every case in this file together, and it is the guard rail of
// the whole cutover: NO WRITE PATH MAY SILENTLY LOSE CONTENT. Each test below
// stands for one way the first cut of the store did lose some — an npc's
// prose under `## Beziehungen`, the glossary's unassignable text, a scene's
// place in the tree, an open edit that could not be saved any more, a log
// line whose columns fell apart.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { CampaignTree, EntryResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { ApiError } from "../src/api-error";
import { applyDrafts } from "../src/store/write";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

async function getFile(rel: string): Promise<EntryResponse> {
  const res = await app.request(entriesUrl("beispiel", rel));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function patchEntry(rel: string, body: unknown): Promise<Response> {
  return app.request(entriesUrl("beispiel", rel), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchOk(rel: string, body: unknown): Promise<EntryResponse> {
  const res = await patchEntry(rel, body);
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** PUT /glossary — the glossary's own write: the whole list plus its token. */
async function putGlossary(
  entries: Array<{ term: string; explanation: string }>,
  rev: number,
): Promise<{ entries: Array<{ term: string; explanation: string }>; rev: number }> {
  const res = await app.request("/api/campaigns/beispiel/glossary", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries, rev }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    entries: Array<{ term: string; explanation: string }>;
    rev: number;
  };
}

async function tree(): Promise<CampaignTree> {
  const res = await app.request("/api/campaigns/beispiel/tree");
  expect(res.status).toBe(200);
  return (await res.json()) as CampaignTree;
}

async function version(): Promise<number> {
  const res = await app.request("/api/campaigns/beispiel/version");
  expect(res.status).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

const NPC = "npcs/fenn";
const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";
const GLOSSARY = "glossary";

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
    const before = await getFile(NPC);
    expect(before.body).toContain("- [[jorna]]: alte Bekannte");

    // Three things under the heading: one relation line (a row), one prose
    // line (no row), and a SECOND line for jorna (the composite key allows
    // only one row per counterpart). Only the first is a relation.
    const body =
      "\n## Beziehungen\n\n- jorna: alte Bekannte\n" +
      "Beide kennen sich aus der Zeit vor dem Leuchtturm.\n" +
      "- jorna: und schuldet ihr Geld\n\n## Notizen\n";
    const after = await patchOk(NPC, { rev: before.rev, body });

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
    const first = await patchOk(NPC, { rev: before.rev, body });
    const second = await patchOk(NPC, { rev: first.rev, body: first.body });
    expect(second.body).toBe(first.body);
    const third = await patchOk(NPC, { rev: second.rev, body: second.body });
    expect(third.body).toBe(first.body);
  });

  test("a section that is ONLY relations still renders once, at the end", async () => {
    const before = await getFile(NPC);
    const body = "\n## Will\n\nRaus aus dem Geschäft.\n\n## Beziehungen\n\n- jorna: Ex-Kollegin\n";
    const after = await patchOk(NPC, { rev: before.rev, body });
    expect(after.body.match(/^## Beziehungen$/gm)).toHaveLength(1);
    expect(after.body).toContain("- jorna: Ex-Kollegin");
    expect(after.body).toContain("Raus aus dem Geschäft.");
  });
});

describe("glossary — a list, edited as a list", () => {
  test("a body is refused, with the code the app knows", async () => {
    // The glossary is TERM ROWS. It used to take its own rendering back as
    // markdown and parse it into rows again — the one text-to-columns path,
    // and the one that could lose a line nobody could assign. It is gone:
    // the list endpoint writes the rows, and a body for this address says so
    // instead of silently doing nothing.
    const before = await getFile(GLOSSARY);
    const res = await patchEntry(GLOSSARY, {
      rev: before.rev,
      body: "\n- tide pool → Gezeitentümpel\n",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("body_not_editable");
    expect(await getFile(GLOSSARY)).toEqual(before);
  });

  test("an emptied glossary is an empty entry (200), still editable", async () => {
    const before = await getFile(GLOSSARY);
    const emptied = await putGlossary([], before.rev);
    expect(emptied.entries).toEqual([]);
    // The 404 this used to answer made the entry the editor was in
    // unreachable.
    const read = await getFile(GLOSSARY);
    expect(read.body).toBe("");
    expect(read.path).toBe(GLOSSARY);
    // …and the DM can type the glossary back in.
    const refilled = await putGlossary(
      [{ term: "tide pool", explanation: "Gezeitentümpel" }],
      read.rev,
    );
    expect(refilled.entries).toEqual([{ term: "tide pool", explanation: "Gezeitentümpel" }]);
    expect((await getFile(GLOSSARY)).body).toContain("- tide pool → Gezeitentümpel");
  });

  test("a multi-line explanation keeps its line breaks through a save", async () => {
    // Nothing flattens an explanation on the way in: it is one column, and
    // the reading rendering gives it a section of its own.
    const before = await getFile(GLOSSARY);
    const explanation = "Zeile eins\nZeile zwei";
    const saved = await putGlossary([{ term: "Ton", explanation }], before.rev);
    expect(saved.entries).toEqual([{ term: "Ton", explanation }]);
    expect((await getFile(GLOSSARY)).body).toContain("## Ton\n\nZeile eins\nZeile zwei");
  });
});

describe("guard tokens of the two list entries", () => {
  test("an unrelated write does not invalidate an open glossary edit", async () => {
    // The bug: `campaigns.version` was the glossary's token, so ANY write —
    // a quick note during a running session — made a pending glossary edit
    // unsaveable. The token is the glossary's own counter now.
    const glossary = await getFile(GLOSSARY);
    expect((await postJson("/api/campaigns/beispiel/session/start")).status).toBe(200);
    expect((await postJson("/api/campaigns/beispiel/log", { text: "Etwas passiert" })).status).toBe(200);
    expect((await postJson("/api/campaigns/beispiel/inbox", { text: "Idee #idee" })).status).toBe(200);
    expect(await version()).toBeGreaterThan(1);

    const saved = await putGlossary(
      [{ term: "tide pool", explanation: "Gezeitentümpel" }],
      glossary.rev,
    );
    expect(saved.entries[0]?.explanation).toBe("Gezeitentümpel");
    // its own writes DO move the token
    expect(saved.rev).toBe(glossary.rev + 1);
    const stale = await app.request("/api/campaigns/beispiel/glossary", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries: [], rev: glossary.rev }),
    });
    expect(stale.status).toBe(409);
    // Same 409 as every other write: the code, the current token, and the
    // entry as it stands.
    const conflict = (await stale.json()) as { code: string; rev: number; entry: EntryResponse };
    expect(conflict.code).toBe("rev_conflict");
    expect(conflict.rev).toBe(saved.rev);
    expect(conflict.entry.path).toBe(GLOSSARY);
  });

  test("the inbox token moves on inbox writes only", async () => {
    const before = await getFile("inbox");
    expect((await postJson("/api/campaigns/beispiel/session/start")).status).toBe(200);
    expect(await getFile("inbox")).toEqual(before);
    expect((await postJson("/api/campaigns/beispiel/inbox", { text: "Neu" })).status).toBe(200);
    expect((await getFile("inbox")).rev).toBe(before.rev + 1);
  });
});

describe("the entry PATCH — a scene's `chapter`", () => {
  test("null is refused: a scene belongs to a chapter, the address is the chapter", async () => {
    const before = await getFile(SCENE);
    expect(before.properties.chapter).toBe("01-salzhafen");

    const res = await patchEntry(SCENE, { rev: before.rev, properties: { chapter: null } });
    expect(res.status).toBe(400);
    // Nothing written: same chapter, same address, same rev.
    const after = await getFile(SCENE);
    expect(after.properties.chapter).toBe("01-salzhafen");
    expect(after.path).toBe(SCENE);
    expect(after.rev).toBe(before.rev);
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
    const rel = `01-salzhafen/${id}`;
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
    // reported under the path the CALLER sent (`<chapter>/<id>`)
    expect(api.extra?.conflicts).toEqual(["01-salzhafen/lighthouse-arrival"]);
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
    const start = await postJson("/api/campaigns/beispiel/session/start");
    expect(start.status).toBe(200);
    // The session's id is opaque, so its path comes from the start.
    const rel = ((await start.json()) as EntryResponse).path;
    const before = await getFile(rel);
    // (An EMPTY sceneId is not in this list: the route normalises it away to
    // "no scene", which is the same thing as omitting the key.)
    for (const sceneId of ["boom) und mehr", "a b", "Gross", "with/slash", "-lead"]) {
      const res = await postJson("/api/campaigns/beispiel/log", { text: "Notiz", sceneId });
      expect(res.status).toBe(400);
    }
    expect(await getFile(rel)).toEqual(before);
    // the legal form still works
    const ok = await postJson("/api/campaigns/beispiel/log", {
      text: "Notiz",
      sceneId: "lighthouse-arrival",
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as EntryResponse).body).toContain("(lighthouse-arrival) Notiz");
  });
});
