// The one write of an entry, against the database stack.
//
// `PATCH /entries/<address>` in its three shapes — properties only, body
// only, both at once (ADR #23) — plus giving a campaign that has none its
// name, which goes through the same write.
//
// Four facts shape every case below:
//
//   * THE STORE IS THE DATABASE. Every case runs against its OWN in-memory
//     database, seeded from the committed JSON entries by the real loader
//     (test/support/store.ts), so the cases cannot build on each other.
//     Assertions read the API's own answer — which is what the app sees and
//     therefore what the contract is about.
//   * `rev` IS THE ROW VERSION — a small integer that starts at 1 and grows
//     by one per write, and a deliberately opaque guard token.
//     "nothing was written" is "the rev did not move".
//   * A SCENE'S PATH SEGMENT IS ITS ID (store/paths.ts), so the reference
//     scenes are addressed as `01-salzhafen/leuchtturm/lighthouse-arrival`
//     and `01-salzhafen/bucht/smuggler-captured`.
//   * `raw` IS A DETERMINISTIC RENDERING (YAML block + body) of the row, not
//     a stored byte sequence. Byte assertions about it are meaningful — the
//     rendering is a pure function of the row — but they say "this is what
//     the editor is shown".
//
// The system time is faked per case (setSystemTime) for deterministic dates.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { EntryResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { seedCampaign } from "../src/db/seed";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

async function getEntry(rel: string, campaign = "beispiel"): Promise<EntryResponse> {
  const res = await app.request(entriesUrl(campaign, rel));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

/**
 * The one write of an entry: PATCH of its address. `rel` is the address, the
 * rest is the request body — the cases send exactly what the app sends.
 */
async function patchEntry(rel: string, body: unknown, campaign = "beispiel"): Promise<Response> {
  return app.request(entriesUrl(campaign, rel), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchOk(rel: string, body: unknown, campaign = "beispiel"): Promise<EntryResponse> {
  const res = await patchEntry(rel, body, campaign);
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

/**
 * A SECOND campaign next to `beispiel`, holding nothing but its own row: no
 * name, no sessions, no inbox. That is what the "there is nothing yet" cases
 * need, and a campaign entry on its own is exactly it.
 */
const FRESH = "frischling";

async function withFreshCampaign(fn: () => Promise<void>): Promise<void> {
  seedCampaign(await getDb(), [{ kind: "campaign", properties: { id: FRESH }, body: "" }]);
  await fn();
}

beforeEach(async () => {
  // 2026-08-19 21:05 local time unless a test overrides it.
  setSystemTime(new Date(2026, 7, 19, 21, 5));
  await seedStore();
});

afterEach(() => {
  setSystemTime();
  dropStore();
});

describe("PATCH /api/campaigns/:campaign/entries/* — the properties half", () => {
  const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

  test("happy path: only named keys change, key order stable, body untouched", async () => {
    const before = await getEntry(SCENE);

    const after = await patchOk(SCENE, { rev: before.rev, properties: { status: "played" } });
    expect(after.properties.status).toBe("played");

    // Key order: the contract order of the kind, nothing added or removed.
    // The columns produce it (store/render.ts rule 1), which is the same
    // order the fixture has.
    expect(Object.keys(after.properties)).toEqual([
      "id",
      "title",
      "type",
      "chapter",
      "location",
      "npcs",
      "handouts",
      "tags",
      "status",
    ]);
    expect(after.properties.id).toBe("lighthouse-arrival");
    expect(after.properties.npcs).toEqual(["jorna"]);
    // The body is not a patch's business — unchanged, character for character.
    expect(after.body).toBe(before.body);
    expect(after.properties).toEqual({ ...before.properties, status: "played" });
    // Fresh guard token (exactly one write) and a subsequent GET sees both.
    expect(after.rev).toBe(before.rev + 1);
    const again = await getEntry(SCENE);
    expect(again.properties.status).toBe("played");
    expect(again.rev).toBe(after.rev);
  });

  test("400 for a key the entry has no field for — nothing is written", async () => {
    const before = await getEntry(SCENE);
    const res = await patchEntry(SCENE, {
      rev: before.rev,
      properties: { review_note: "x" },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("review_note");
    expect((await getEntry(SCENE)).rev).toBe(before.rev);
  });

  test("400 when the patch carries `id` — an id never changes", async () => {
    // The id IS the primary key: always present and never patchable. What
    // CAN happen is a form sending the whole properties back, `id` included
    // — and that must not orphan every reference to the entity.
    const before = await getEntry(SCENE);
    const res = await patchEntry(SCENE, { rev: before.rev, properties: { id: "neu" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("id is the primary key");
    // Refused means refused: the row did not move.
    expect((await getEntry(SCENE)).rev).toBe(before.rev);
    // An id patch that changes NOTHING is a no-op, not an error — that is what
    // "send the form back unchanged" looks like.
    const same = await patchOk(SCENE, {
      rev: before.rev,
      properties: { id: "lighthouse-arrival", status: "played" },
    });
    expect(same.properties.id).toBe("lighthouse-arrival");
    expect(same.properties.status).toBe("played");
  });

  // A row always renders its properties (store/render.ts). The 400 for the
  // two properties-less kinds below is what guards this corner.
  test("404 for the LIST addresses — they are not entries at all", async () => {
    // The inbox, the glossary and a session have their own endpoints and no
    // address (ADR #26), so a patch at one of these reads like a patch at any
    // other address the schema does not describe. There is no
    // `body_not_editable` in front of it any more: nothing to refuse a body
    // FOR, because nothing is there.
    for (const rel of ["inbox", "glossary", "sessions/2026-01-15"]) {
      expect((await patchEntry(rel, { rev: 1, properties: { status: "x" } })).status).toBe(404);
      expect((await patchEntry(rel, { rev: 1, body: "\n- alles neu\n" })).status).toBe(404);
    }
  });

  test("the campaign entry is patchable through the same endpoint", async () => {
    const rel = "campaign";
    const before = await getEntry(rel);
    expect(before.kind).toBe("campaign");
    const after = await patchOk(rel, {
      rev: before.rev,
      properties: { description: "Neue Kurzbeschreibung." },
    });
    expect(after.properties.description).toBe("Neue Kurzbeschreibung.");
    expect(after.properties.name).toBe("Der Leuchtturm von Salzhafen");
    expect(Object.keys(after.properties)).toEqual(["id", "name", "description"]); // order stable
    expect(after.properties.description).toBe("Neue Kurzbeschreibung.");
    // the list endpoint picks the new value up right away
    const list = (await (await app.request("/api/campaigns")).json()) as Array<{
      id: string;
      description?: string;
    }>;
    expect(list.find((c) => c.id === "beispiel")?.description).toBe("Neue Kurzbeschreibung.");
  });

  test("409 on a stale token carries the current one and writes nothing", async () => {
    const before = await getEntry(SCENE);
    const res = await patchEntry(SCENE, {
      rev: before.rev - 1,
      properties: { status: "ready" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      code: string;
      rev: number;
      entry: EntryResponse;
    };
    expect(typeof body.error).toBe("string");
    expect(body.code).toBe("rev_conflict");
    expect(body.rev).toBe(before.rev);
    // The conflict hands the app the entry it collided with.
    expect(body.entry).toEqual(before);
    // and nothing was written — same row, same token
    expect(await getEntry(SCENE)).toEqual(before);
  });

  test("400 on malformed bodies", async () => {
    const before = await getEntry(SCENE);
    const bad = [
      {}, // missing everything
      { rev: before.rev }, // neither properties nor body
      { rev: before.rev, properties: {} }, // an empty patch writes nothing
      { rev: "later", properties: { status: "ready" } }, // rev not a number
      { rev: before.rev, properties: ["status"] }, // properties not an object
      { rev: before.rev, body: 42 }, // body not a string
      { rev: before.rev, body: "x", force: "yes" }, // force not a boolean
      { rev: before.rev, properties: {}, extra: 1 }, // unknown key
    ];
    for (const b of bad) {
      expect((await patchEntry(SCENE, b)).status).toBe(400);
    }
    // non-JSON body
    const res = await app.request(entriesUrl("beispiel", SCENE), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "no json",
    });
    expect(res.status).toBe(400);
    // none of the rejected requests touched the row
    expect(await getEntry(SCENE)).toEqual(before);
  });

  test("address safety and missing rows behave like the read API", async () => {
    const field = { rev: 1, properties: { status: "ready" } };
    // A `..` segment never reaches the store: every URL parser on the way
    // resolves it away, so what arrives is a different, ordinary address
    // nobody has. The probe uses a neutral traversal target — only the `..`
    // segments matter.
    expect((await patchEntry("../../vertraulich/notizen", field)).status).toBe(404);
    // An address the schema does not describe is simply not there.
    expect((await patchEntry("notes.txt", field)).status).toBe(404);
    expect((await patchEntry("01-salzhafen/nope", field)).status).toBe(404);
    // An address naming the WRONG chapter for an existing scene id is a
    // stale link: 404, exactly as GET answers it (store/entries.ts
    // readByLocator).
    expect((await patchEntry("02-nebel/lighthouse-arrival.md", field)).status).toBe(404);
  });
});

describe("naming a campaign that has none", () => {
  test("the PATCH sets name and description on an unnamed campaign", async () => {
    await withFreshCampaign(async () => {
      // Unnamed: the entry exists and shows the ID as its display name,
      // which is exactly what GET /campaigns says too (both synthesize).
      const before = await getEntry("campaign", FRESH);
      expect(before.properties).toEqual({ id: FRESH, name: FRESH });

      const res = await patchEntry(
        "campaign",
        {
          rev: before.rev,
          properties: {
            name: "Die Aschekönige",
            description: "Eine Wüstenkampagne um verschüttete Städte.",
          },
        },
        FRESH,
      );
      expect(res.status).toBe(200);
      const entry = (await res.json()) as EntryResponse;
      expect(entry.path).toBe("campaign");
      expect(entry.kind).toBe("campaign");
      expect(entry.properties.name).toBe("Die Aschekönige");
      // The id is the CAMPAIGN key — never client input.
      expect(entry.properties).toEqual({
        id: "frischling",
        name: "Die Aschekönige",
        description: "Eine Wüstenkampagne um verschüttete Städte.",
      });
      expect(entry.body).toBe("");

      // The campaign list serves the new metadata right away.
      const list = (await (await app.request("/api/campaigns")).json()) as Array<
        Record<string, unknown>
      >;
      expect(list.find((c) => c.id === FRESH)).toMatchObject({
        name: "Die Aschekönige",
        description: "Eine Wüstenkampagne um verschüttete Städte.",
      });
    });
  });

  test("a blank description is DELETED with null, not written as an empty key", async () => {
    await withFreshCampaign(async () => {
      const before = await getEntry("campaign", FRESH);
      const res = await patchEntry(
        "campaign",
        { rev: before.rev, properties: { name: "Nur ein Name", description: null } },
        FRESH,
      );
      expect(res.status).toBe(200);
      const entry = (await res.json()) as EntryResponse;
      expect(Object.keys(entry.properties)).toEqual(["id", "name"]);
      expect(entry.properties).toEqual({ id: "frischling", name: "Nur ein Name" });
      expect(entry.body).toBe("");
    });
  });

  test("a stale token is a 409 — the existing name is never touched", async () => {
    const before = await getEntry("campaign");
    const res = await patchEntry("campaign", {
      rev: before.rev - 1,
      properties: { name: "Überschrieben" },
    });
    expect(res.status).toBe(409);
    expect(await getEntry("campaign")).toEqual(before);
  });

  test("the create endpoint is gone — 404, no route", async () => {
    expect((await postJson("/api/campaigns/beispiel/campaign-meta", { name: "x" })).status).toBe(404);
  });
});

// Text writes: content editing in the app. The invariant under
// test everywhere here is that a write carrying only `body` is ONLY a text
// write — the properties of the row come back unchanged, key for key and
// value for value.
describe("PATCH /api/campaigns/:campaign/entries/* — the body half", () => {
  const REFERENCE = "01-salzhafen/bucht/smuggler-captured";
  const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

  test("roundtrip: writing the read body back changes nothing but the token", async () => {
    const before = await getEntry(REFERENCE);
    // the reference scene carries callouts and `## If:` sections
    expect(before.body).toContain("> [!check] Charisma (Deception)");
    expect(before.body).toContain("## If: sie lügen");

    const after = await patchOk(REFERENCE, { rev: before.rev, body: before.body });
    expect(after.body).toBe(before.body);
    expect(after.properties).toEqual(before.properties);
    // A write is a write, so the rev moves — the token is opaque and
    // monotonic, never a content hash.
    expect(after.rev).toBe(before.rev + 1);
    expect((await getEntry(REFERENCE)).rev).toBe(after.rev);
  });

  test("unknown callouts and headings survive a write verbatim", async () => {
    const before = await getEntry(REFERENCE);
    const body = "\n## Völlig Eigenes\n\n> [!wetter] Nebel über der Bucht\n\n### Unter-Titel\n";
    const after = await patchOk(REFERENCE, { rev: before.rev, body });
    expect(after.body).toBe(body);
    // and back again, character for character
    const back = await patchOk(REFERENCE, { rev: after.rev, body: before.body });
    expect(back.body).toBe(before.body);
    expect(back.properties).toEqual(before.properties);
  });

  test("happy path: new body, properties untouched", async () => {
    const before = await getEntry(SCENE);
    const body = "\n## Flow\n\nKomplett neu geschrieben.\n";

    const after = await patchOk(SCENE, { rev: before.rev, body });
    expect(after.path).toBe(SCENE);
    expect(after.kind).toBe("scene");
    expect(after.body).toBe(body);
    // properties untouched — same keys, same values, same order
    expect(after.properties).toEqual(before.properties);
    expect(Object.keys(after.properties)).toEqual(Object.keys(before.properties));
    // fresh token, and a GET sees the write
    expect(after.rev).toBe(before.rev + 1);
    expect((await getEntry(SCENE)).body).toBe(body);
  });

  test("a body without a trailing newline gets exactly one", async () => {
    const before = await getEntry(SCENE);
    const after = await patchOk(SCENE, { rev: before.rev, body: "\nOhne Newline" });
    expect(after.body).toBe("\nOhne Newline\n");
  });

  test("an empty body leaves the properties alone", async () => {
    const before = await getEntry(SCENE);
    const after = await patchOk(SCENE, { rev: before.rev, body: "" });
    expect(after.body).toBe("");
    expect(after.properties).toEqual(before.properties);
  });

  test("409 on a stale token carries the current one and writes nothing", async () => {
    const before = await getEntry(SCENE);
    const res = await patchEntry(SCENE, { rev: before.rev - 1, body: "\nZu spät\n" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; rev: number };
    expect(typeof body.error).toBe("string");
    expect(body.rev).toBe(before.rev);
    expect(await getEntry(SCENE)).toEqual(before);
  });

  test("400 on malformed bodies", async () => {
    const before = await getEntry(SCENE);
    const bad = [
      { rev: "später", body: "x" }, // rev not a number
      { rev: before.rev, body: ["x"] }, // body not a string
      { rev: before.rev, body: null }, // body not a string
      { rev: before.rev, body: "x", patch: {} }, // unknown key
      { rev: before.rev, body: "x", path: SCENE }, // the address is the url now
    ];
    for (const b of bad) {
      expect((await patchEntry(SCENE, b)).status).toBe(400);
    }
    const res = await app.request(entriesUrl("beispiel", SCENE), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "no json",
    });
    expect(res.status).toBe(400);
    // none of the rejected requests touched the row
    expect(await getEntry(SCENE)).toEqual(before);
  });

  test("address safety and missing rows behave like the read API", async () => {
    const text = { rev: 1, body: "x" };
    expect((await patchEntry("/etc/passwd", text)).status).toBe(400);
    expect((await patchEntry(".hidden/x", text)).status).toBe(400);
    // No extension rule — 404, not 400.
    expect((await patchEntry("notes.txt", text)).status).toBe(404);
    expect((await patchEntry("01-salzhafen/nope", text)).status).toBe(404);
    // A `..` segment never reaches the store: the URL resolves it away, so
    // the address that arrives is an ordinary one nobody has — 404, like the
    // read side, and nothing is written either way.
    expect((await patchEntry("01-salzhafen/../../beispiel/inbox", text)).status).toBe(404);
    // A stale link — right scene id, wrong chapter — is 404 on write just as
    // it is on read (store/entries.ts readByLocator).
    expect((await patchEntry("02-nebel/lighthouse-arrival.md", text)).status).toBe(404);
  });

  test("404 for an unknown campaign", async () => {
    const res = await app.request(entriesUrl("nope", "a.md"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: 1, body: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

// The two halves in ONE request — what the text editor and the properties
// dialog both save through, and the refusals that keep a no-op from looking
// like a save.
describe("PATCH /api/campaigns/:campaign/entries/* — both halves at once", () => {
  const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

  async function campaignVersion(): Promise<number> {
    const res = await app.request("/api/campaigns/beispiel/version");
    expect(res.status).toBe(200);
    return ((await res.json()) as { version: number }).version;
  }

  test("fields and text in one call", async () => {
    const before = await getEntry(SCENE);
    const versionBefore = await campaignVersion();
    const after = await patchOk(SCENE, {
      rev: before.rev,
      properties: { status: "played", trigger: "Sie betreten den Turm" },
      body: "\n## Flow\n\nEin Satz.\n",
    });
    expect(after.properties.status).toBe("played");
    expect(after.properties.trigger).toBe("Sie betreten den Turm");
    expect(after.body).toBe("\n## Flow\n\nEin Satz.\n");
    // ONE write: the rev steps exactly once, however much the request
    // carried. Two steps would leak the two statements this used to be.
    expect(after.rev).toBe(before.rev + 1);
    expect(await getEntry(SCENE)).toEqual(after);
    // …and the campaign version counts one change too, not two.
    expect(await campaignVersion()).toBe(versionBefore + 1);
  });

  test("neither half is nothing_to_write, with the code", async () => {
    const before = await getEntry(SCENE);
    for (const body of [{ rev: before.rev }, { rev: before.rev, properties: {} }]) {
      const res = await patchEntry(SCENE, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("nothing_to_write");
    }
    expect(await getEntry(SCENE)).toEqual(before);
  });

  test("force keeps a field somebody else changed while replacing the text", async () => {
    const read = await getEntry(SCENE);
    // The second tab changes a field; the first tab still holds `read.rev`.
    const other = await patchEntry(SCENE, {
      rev: read.rev,
      properties: { status: "played" },
    });
    expect(other.status).toBe(200);

    const forced = await patchOk(SCENE, {
      rev: read.rev,
      body: "\n## Flow\n\nTrotzdem gespeichert.\n",
      force: true,
    });
    expect(forced.body).toBe("\n## Flow\n\nTrotzdem gespeichert.\n");
    // Only what the request carried was written — the status survived.
    expect(forced.properties.status).toBe("played");
    expect(await getEntry(SCENE)).toEqual(forced);
  });
});

describe("the prose property an npc keeps beside its text", () => {
  // `motivation` is a property like any other field of its kind — one row,
  // one guard (ADR #23) — and the npc's edit surface writes it together with
  // the text. (A location's `atmosphere` is a field of the location's own
  // resource: test/locations.test.ts.)
  const NPC = "npcs/jorna";

  test("the seeded npc carries it as a property, not as a body section", async () => {
    const jorna = await getEntry(NPC);
    expect(jorna.properties.motivation).toBe(
      "Das Leuchtfeuer muss wieder brennen, bevor die Herbstkonvois kommen — ihr Amt hängt daran.",
    );
    expect(jorna.body).not.toContain("## Will");
  });

  test("set with text in one write, and `null` deletes the key", async () => {
    const before = await getEntry(NPC);
    const written = await patchOk(NPC, {
      rev: before.rev,
      properties: { motivation: "Ruhe am Kai — und dass [[fenn]] verschwindet." },
      body: "\n## Weiß\n\nNichts Neues.\n",
    });
    expect(written.properties.motivation).toBe("Ruhe am Kai — und dass [[fenn]] verschwindet.");
    expect(written.body).toBe("\n## Weiß\n\nNichts Neues.\n");
    expect(written.rev).toBe(before.rev + 1);

    const cleared = await patchOk(NPC, { rev: written.rev, properties: { motivation: null } });
    expect(Object.hasOwn(cleared.properties, "motivation")).toBe(false);
    expect(cleared.body).toBe(written.body);
  });

  test("each field belongs to its kind — `atmosphere` on an npc is a 400", async () => {
    const before = await getEntry(NPC);
    const res = await patchEntry(NPC, { rev: before.rev, properties: { atmosphere: "Nebel" } });
    expect(res.status).toBe(400);
    expect(await getEntry(NPC)).toEqual(before);
  });

  test("a concurrent write is a 409, and force keeps the foreign status", async () => {
    const read = await getEntry(NPC);
    // Somebody else changes the status while the edit surface is open.
    const other = await patchEntry(NPC, { rev: read.rev, properties: { status: "missing" } });
    expect(other.status).toBe(200);

    const refused = await patchEntry(NPC, {
      rev: read.rev,
      properties: { motivation: "Neue Motivation." },
      body: "\n## Weiß\n\nNeuer Text.\n",
    });
    expect(refused.status).toBe(409);

    // „Trotzdem speichern": what the surface shows — text and motivation —
    // and nothing else.
    const forced = await patchOk(NPC, {
      rev: read.rev,
      properties: { motivation: "Neue Motivation." },
      body: "\n## Weiß\n\nNeuer Text.\n",
      force: true,
    });
    expect(forced.properties.motivation).toBe("Neue Motivation.");
    expect(forced.body).toBe("\n## Weiß\n\nNeuer Text.\n");
    expect(forced.properties.status).toBe("missing");
  });
});
