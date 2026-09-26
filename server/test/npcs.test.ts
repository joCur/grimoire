// The npc resource (decisions/resources): `GET …/npcs`, `GET` and `PATCH …/npcs/:id`,
// `POST …/npcs`, every field of an npc flat — `body` among them — beside its
// `rev`, and every write checked against the npc's schema.
// `…/entries/npcs/<id>` names nothing.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Npc } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

const NPCS = "/api/campaigns/example/npcs";
const JORNA = `${NPCS}/jorna`;
const FENN = `${NPCS}/fenn`;

async function getNpc(url = JORNA): Promise<Npc> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return (await res.json()) as Npc;
}

async function send(method: string, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const patchNpc = (body: Record<string, unknown>, url = JORNA): Promise<Response> =>
  send("PATCH", url, body);

/** A PATCH of fenn that has to go through; answers the npc it wrote. */
async function patchNpcOk(body: Record<string, unknown>): Promise<Npc> {
  const res = await patchNpc(body, FENN);
  expect(res.status).toBe(200);
  return (await res.json()) as Npc;
}
const createNpc = (body: Record<string, unknown>): Promise<Response> => send("POST", NPCS, body);

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("reading an npc", () => {
  test("GET answers every field flat — no kind, no path, no properties", async () => {
    const jorna = await getNpc();
    expect(jorna).toEqual({
      id: "jorna",
      name: "Harbourmaster Jorna",
      role: "Employer, harbourmaster of Salt Harbour",
      chapter: "01-salt-harbour",
      status: "alive",
      statblock: "Roll20: Jorna",
      quickstats: { insight: 2, "passive-perception": 12 },
      voice: "curt, weather-beaten, on first-name terms with everyone",
      appearance: "oilskin coat, grey braid, missing little finger on the left hand",
      motivation:
        "The beacon has to burn again before the autumn convoys arrive — her office depends on it.",
      body: jorna.body,
      rev: jorna.rev,
    });
    // The motivation is a field, not a section of the text (decisions/data-shape).
    expect(jorna.body).toContain("## Relationships");
    expect(jorna.body).not.toContain("## Wants");
  });

  test("the list answers every npc in its own shape, sorted by name", async () => {
    const res = await app.request(NPCS);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Npc[];
    expect(list.map((npc) => npc.id)).toEqual(["fenn", "jorna"]);
    expect(list[1]).toEqual(await getNpc());
  });

  test("404 for an unknown npc or campaign", async () => {
    expect((await app.request(`${NPCS}/does-not-exist`)).status).toBe(404);
    expect((await app.request("/api/campaigns/nowhere/npcs/jorna")).status).toBe(404);
  });

  test("the entry address of an npc names nothing — GET and PATCH are 404", async () => {
    const url = entriesUrl("example", "npcs/jorna");
    expect((await app.request(url)).status).toBe(404);
    const before = await getNpc();
    const res = await send("PATCH", url, { rev: before.rev, body: "Overwritten.\n" });
    expect(res.status).toBe(404);
    expect(await getNpc()).toEqual(before);
  });
});

describe("writing an npc", () => {
  test("only the named fields change; `null` clears an optional one", async () => {
    const before = await getNpc();
    const res = await patchNpc({ rev: before.rev, role: "Harbourmaster", statblock: null });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Npc;
    expect(after.role).toBe("Harbourmaster");
    expect(Object.hasOwn(after, "statblock")).toBe(false);
    expect(after.motivation).toBe(before.motivation);
    expect(after.quickstats).toEqual(before.quickstats);
    expect(after.body).toBe(before.body);
    expect(after.rev).toBe(before.rev + 1);
    expect(await getNpc()).toEqual(after);
  });

  test("the body is a field like the others — written with the motivation in one step", async () => {
    const before = await getNpc();
    const res = await patchNpc({
      rev: before.rev,
      motivation: "Quiet on the quay — and [[fenn]] gone.",
      body: "\n## Knows\n\nNothing new.",
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Npc;
    expect(after.motivation).toBe("Quiet on the quay — and [[fenn]] gone.");
    expect(after.body).toBe("\n## Knows\n\nNothing new.\n");
    expect(after.rev).toBe(before.rev + 1);

    const cleared = await patchNpc({ rev: after.rev, motivation: null });
    expect(cleared.status).toBe(200);
    const read = (await cleared.json()) as Npc;
    expect(Object.hasOwn(read, "motivation")).toBe(false);
    expect(read.body).toBe(after.body);
  });

  test("quickstats is a key/value set, replaced whole; `null` clears it", async () => {
    const before = await getNpc();
    const res = await patchNpc({ rev: before.rev, quickstats: { insight: "+4" } });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Npc;
    expect(after.quickstats).toEqual({ insight: "+4" });
    const cleared = (await (await patchNpc({ rev: after.rev, quickstats: null })).json()) as Npc;
    expect(Object.hasOwn(cleared, "quickstats")).toBe(false);
  });

  test("400 for a field an npc does not have — named, and nothing written", async () => {
    const before = await getNpc();
    for (const extra of [
      { atmosphere: "Fog" },
      { properties: { name: "X" } },
      { kind: "npc" },
      { path: "npcs/jorna" },
    ]) {
      const res = await patchNpc({ rev: before.rev, ...extra });
      expect(res.status).toBe(400);
      const key = Object.keys(extra)[0]!;
      expect(((await res.json()) as { error: string }).error).toContain(key);
    }
    expect((await getNpc()).rev).toBe(before.rev);
  });

  test("400 for a value of the wrong shape, naming the field — nothing written", async () => {
    const before = await getNpc();
    for (const [key, value] of [
      ["name", 7],
      ["name", null],
      ["status", null],
      ["quickstats", ["+2"]],
      ["motivation", ["Quiet"]],
      ["body", 3],
    ] as const) {
      const res = await patchNpc({ rev: before.rev, [key]: value });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(key);
    }
    expect((await patchNpc({ name: "without rev" })).status).toBe(400);
    expect((await getNpc()).rev).toBe(before.rev);
  });

  test("a status outside the four is a 400 with the code the app has a sentence for", async () => {
    const before = await getNpc();
    const res = await patchNpc({ rev: before.rev, status: "deceased" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "status_not_allowed", kind: "npc" });
    const dead = await patchNpc({ rev: before.rev, status: "dead" });
    expect(((await dead.json()) as Npc).status).toBe("dead");
  });

  test("the id may be echoed, never changed; an empty patch writes nothing", async () => {
    const before = await getNpc();
    expect((await patchNpc({ rev: before.rev, id: "jorna-2" })).status).toBe(400);
    const empty = await patchNpc({ rev: before.rev });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ code: "nothing_to_write" });
    expect((await getNpc()).rev).toBe(before.rev);
  });

  test("a chapter has to exist — 400 with the create-this-first code", async () => {
    const before = await getNpc();
    const res = await patchNpc({ rev: before.rev, chapter: "99-nowhere" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "chapter_unknown" });
    expect(await getNpc()).toEqual(before);
  });

  test("a stale rev is 409 with the current npc; force writes only what it carries", async () => {
    const read = await getNpc();
    // Somebody else changes the status while the edit surface is open.
    expect((await patchNpc({ rev: read.rev, status: "missing" })).status).toBe(200);

    const refused = await patchNpc({ rev: read.rev, motivation: "A new motivation." });
    expect(refused.status).toBe(409);
    const conflict = (await refused.json()) as { code: string; rev: number; npc: Npc };
    expect(conflict.code).toBe("rev_conflict");
    expect(conflict.npc.status).toBe("missing");
    expect(conflict.rev).toBe(conflict.npc.rev);

    // The save-anyway action writes what the surface shows — text and
    // motivation — and nothing else.
    const forced = await patchNpc({
      rev: read.rev,
      motivation: "A new motivation.",
      body: "\n## Knows\n\nNew text.\n",
      force: true,
    });
    expect(forced.status).toBe(200);
    const written = (await forced.json()) as Npc;
    expect(written.motivation).toBe("A new motivation.");
    expect(written.body).toBe("\n## Knows\n\nNew text.\n");
    expect(written.status).toBe("missing");
  });

  test("404 for an unknown npc", async () => {
    expect((await patchNpc({ rev: 1, name: "X" }, `${NPCS}/does-not-exist`)).status).toBe(404);
  });

  test("the search index follows a rename, and the hit carries no address", async () => {
    const before = await getNpc();
    expect((await patchNpc({ rev: before.rev, name: "Jorna Saltmarsh" })).status).toBe(200);
    const res = await app.request("/api/campaigns/example/search?q=Saltmarsh");
    const { results } = (await res.json()) as { results: Array<Record<string, unknown>> };
    const hit = results.find((r) => r.kind === "npc" && r.id === "jorna");
    expect(hit?.title).toBe("Jorna Saltmarsh");
    expect(Object.hasOwn(hit!, "path")).toBe(false);
  });
});

describe("creating an npc", () => {
  test("from the name alone: the id is derived, the status is unknown, the text empty", async () => {
    const res = await createNpc({ name: "Holm the Fisher" });
    expect(res.status).toBe(201);
    const holm = (await res.json()) as Npc;
    expect(holm).toEqual({
      id: "holm-the-fisher",
      name: "Holm the Fisher",
      status: "unknown",
      body: "",
      rev: holm.rev,
    });
    expect(await getNpc(`${NPCS}/holm-the-fisher`)).toEqual(holm);
  });

  test("with a body: the note is the npc's text, as typed, without a heading", async () => {
    const res = await createNpc({ name: "Grella", id: "grella", body: "Brings the cargo into the village." });
    expect(res.status).toBe(201);
    const grella = (await res.json()) as Npc;
    expect(grella.body).toBe("Brings the cargo into the village.\n");
    expect(grella.status).toBe("unknown");
  });

  test("an EMPTY npc under the id is filled with the name and the body", async () => {
    const created = (await (await createNpc({ name: "holm" })).json()) as Npc;
    expect(created.name).toBe("holm");
    const filled = await createNpc({ name: "Holm", id: "holm", body: "Knows the current." });
    expect(filled.status).toBe(201);
    const holm = (await filled.json()) as Npc;
    expect(holm.name).toBe("Holm");
    expect(holm.body).toBe("Knows the current.\n");
    expect(holm.rev).toBe(created.rev + 1);
  });

  test("an npc with content is a 409 with a free proposal — nothing is written", async () => {
    const before = await getNpc();
    const res = await createNpc({ name: "Jorna", id: "jorna", body: "A note." });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "slug_taken",
      kind: "npc",
      id: "jorna",
      suggestion: "jorna-2",
    });
    expect(await getNpc()).toEqual(before);
  });

  test("400 for a key the create does not take, and for a missing name", async () => {
    expect((await createNpc({ name: "Holm", status: "alive" })).status).toBe(400);
    expect((await createNpc({ body: "Only a note." })).status).toBe(400);
    expect((await createNpc({ name: "   " })).status).toBe(400);
    expect((await createNpc({ name: "Holm", id: "Not A Slug" })).status).toBe(400);
  });
});

describe("an npc's `## Relationships` is prose in its body", () => {
  test("every line under the heading survives the save verbatim", async () => {
    const before = await getNpc(FENN);
    expect(before.body).toContain("- [[jorna]]: old acquaintance");

    // Three lines under the heading: a relation line, a prose line, and a
    // SECOND line for the same counterpart. Storage is never derived from
    // body text, so all three stay as written.
    const body =
      "\n## Relationships\n\n- jorna: old acquaintance\n" +
      "They know each other from before the lighthouse.\n" +
      "- jorna: and owes her money\n\n## Notes\n";
    const after = await patchNpcOk({ rev: before.rev, body });

    expect(after.body).toContain("- jorna: old acquaintance");
    expect(after.body).toContain("They know each other from before the lighthouse.");
    expect(after.body).toContain("- jorna: and owes her money");
    // one heading, in its original place — not a second one appended
    expect(after.body.match(/^## Relationships$/gm)).toHaveLength(1);
    expect(after.body.indexOf("## Relationships")).toBeLessThan(after.body.indexOf("## Notes"));
    expect(await getNpc(FENN)).toEqual(after);
  });

  test("saving the stored body again is a fixed point", async () => {
    const before = await getNpc(FENN);
    const body =
      "\n## Relationships\n\n- jorna: old acquaintance\nA sentence that is no relation.\n";
    const first = await patchNpcOk({ rev: before.rev, body });
    const second = await patchNpcOk({ rev: first.rev, body: first.body });
    expect(second.body).toBe(first.body);
    const third = await patchNpcOk({ rev: second.rev, body: second.body });
    expect(third.body).toBe(first.body);
  });

  test("a section that is ONLY relations stays once, at the end", async () => {
    const before = await getNpc(FENN);
    const body =
      "\n## Wants\n\nOut of the business.\n\n## Relationships\n\n- jorna: former colleague\n";
    const after = await patchNpcOk({ rev: before.rev, body });
    expect(after.body.match(/^## Relationships$/gm)).toHaveLength(1);
    expect(after.body).toContain("- jorna: former colleague");
    expect(after.body).toContain("Out of the business.");
  });
});
