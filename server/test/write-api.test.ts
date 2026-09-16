// Write-API tests (issue #5), ported to the database stack (issue #57).
//
// What changed with the cutover, and therefore in this file:
//
//   * THE STORE IS THE DATABASE. Every case runs against its OWN in-memory
//     database, seeded from `examples/` by the real migration (test/support/
//     store.ts). No file is written any more, so the old "the bytes on disk
//     are X" assertions are re-expressed against the API's own answer — which
//     is what the app sees and therefore what the contract is about.
//   * `rev` IS THE ROW VERSION — a small integer that starts at 1 and
//     grows by one per write, and still a deliberately opaque guard token.
//     "nothing was written" is now "the rev did not move".
//   * A SCENE'S PATH SEGMENT IS ITS ID (store/paths.ts), so the reference
//     scenes are addressed as `01-salzhafen/leuchtturm/lighthouse-arrival` and
//     `.../smuggler-captured.md` instead of by their former file names.
//   * `raw` IS A DETERMINISTIC RENDERING (YAML block + body), not stored
//     bytes. Byte assertions about `raw` are still meaningful — the rendering
//     is a pure function of the row — but they say "this is what the editor
//     is shown", not "this is what is on disk".
//   * EVERY CASE IS SELF-CONTAINED. The old file lived off a shared temp copy
//     and let cases build on each other; a fresh database per case makes that
//     impossible, which is the better contract anyway.
//
// The clock is overridden per case via setNow() for deterministic dates —
// src/clock.ts is untouched by the cutover.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { EntryResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { setNow } from "../src/clock";
import type { GrimoireDb } from "../src/db/client";
import {
  npcRelations as npcRelationsTable,
  npcs as npcsTable,
  scenes as scenesTable,
  sessions as sessionsTable,
} from "../src/db/schema";
import { getDb } from "../src/store/handle";
import {
  dropStore,
  removeTempRoot,
  seedStore,
  tempCampaignRoot,
} from "./support/store";

async function getFile(rel: string, campaign = "beispiel"): Promise<EntryResponse> {
  const res = await app.request(`/api/${campaign}/entry?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function fileStatus(rel: string, campaign = "beispiel"): Promise<number> {
  return (await app.request(`/api/${campaign}/entry?path=${encodeURIComponent(rel)}`)).status;
}

async function patchReq(body: unknown): Promise<Response> {
  return app.request("/api/beispiel/properties", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchOk(body: unknown): Promise<EntryResponse> {
  const res = await patchReq(body);
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

/** PATCH /properties of any campaign (patchReq is bound to `beispiel`). */
async function patchJson(url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function putFile(body: unknown): Promise<Response> {
  return app.request("/api/beispiel/entry", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function putOk(body: unknown): Promise<EntryResponse> {
  const res = await putFile(body);
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

async function postOk(url: string, body?: unknown): Promise<EntryResponse> {
  const res = await postJson(url, body);
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

/**
 * A campaign root with a SECOND, empty campaign directory next to
 * `beispiel` — the migration turns it into a campaign row with no name, no
 * sessions and no inbox, which is what the "there is nothing yet" cases need
 * (they used to create a bare directory in the temp tree).
 */
const FRESH = "frischling";

async function withFreshCampaign(fn: () => Promise<void>): Promise<void> {
  const root = await tempCampaignRoot();
  try {
    await mkdir(path.join(root, FRESH), { recursive: true });
    await seedStore(root);
    await fn();
  } finally {
    await removeTempRoot(root);
  }
}

let db: GrimoireDb;

beforeEach(async () => {
  // 2026-08-19 21:05 local time unless a test overrides it.
  setNow(() => new Date(2026, 7, 19, 21, 5));
  db = await seedStore();
});

afterEach(() => {
  setNow(null);
  dropStore();
});

describe("PATCH /api/:campaign/properties", () => {
  const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

  test("happy path: only named keys change, key order stable, body untouched", async () => {
    const before = await getFile(SCENE);

    const after = await patchOk({ path: SCENE, rev: before.rev, patch: { status: "played" } });
    expect(after.properties.status).toBe("played");

    // Key order: the contract order of the kind, nothing added or removed.
    // In the file tree this was "the file's own order"; the columns produce it
    // now (store/render.ts rule 1), which is the same order the fixture had.
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
    const again = await getFile(SCENE);
    expect(again.properties.status).toBe("played");
    expect(again.rev).toBe(after.rev);
  });

  test("400 when a scene loses its chapter — a scene belongs to one", async () => {
    // `scenes.chapter_id` is NOT NULL (ADR #18): the chapter is part of the
    // scene's address, so a patch may MOVE the scene but never unhook it.
    const before = await getFile(SCENE);
    const res = await patchReq({ path: SCENE, rev: before.rev, patch: { chapter: null } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("chapter cannot be removed");
    const again = await getFile(SCENE);
    expect(again.properties.chapter).toBe("01-salzhafen");
    expect(again.rev).toBe(before.rev);
  });

  test("400 when `scenes_played` names a scene that does not exist", async () => {
    // The list REFERENCES scenes (ADR #18), and a scene is not created by
    // naming it — its address is a chapter and a title nobody typed here.
    const before = await getFile("sessions/2026-01-15");
    const res = await patchReq({
      path: "sessions/2026-01-15",
      rev: before.rev,
      patch: { scenes_played: ["lighthouse-arrival", "gibt-es-nicht"] },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("unknown scene");
    const again = await getFile("sessions/2026-01-15");
    expect(again.properties.scenes_played).toEqual(before.properties.scenes_played);
    expect(again.rev).toBe(before.rev);
  });

  test("400 for a key the entry has no field for — nothing is written", async () => {
    const before = await getFile(SCENE);
    const res = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: SCENE, rev: before.rev, patch: { review_note: "x" } }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("review_note");
    expect((await getFile(SCENE)).rev).toBe(before.rev);
  });

  test("an imported unknown key is rendered after the contract keys, changeable and deletable", async () => {
    // Only the importer puts keys into `extra`; stand in for it here.
    (await getDb())
      .update(scenesTable)
      .set({ extra: JSON.stringify({ review_note: "nochmal lesen" }) })
      .where(and(eq(scenesTable.campaignId, "beispiel"), eq(scenesTable.id, "lighthouse-arrival")))
      .run();
    const before = await getFile(SCENE);
    const keys = Object.keys(before.properties);
    expect(keys[keys.length - 1]).toBe("review_note");
    expect(before.properties.review_note).toBe("nochmal lesen");

    const changed = await patchOk({
      path: SCENE,
      rev: before.rev,
      patch: { review_note: "gelesen" },
    });
    expect(changed.properties.review_note).toBe("gelesen");
    const after = await patchOk({
      path: SCENE,
      rev: changed.rev,
      patch: { review_note: null },
    });
    expect(Object.keys(after.properties)).not.toContain("review_note");
    expect(after.body).toBe(before.body);
  });

  test("400 when the patch carries `id` — that is POST /rename's job", async () => {
    // Replaces the old "a file without `id` on disk does not gain one": in the
    // database the id IS the primary key, always present and never patchable,
    // so the degrade case it guarded cannot exist. What CAN happen is a form
    // sending the whole properties back, `id` included — and that must not
    // orphan every reference to the entity (issues #29/#30).
    const before = await getFile(SCENE);
    const res = await patchReq({ path: SCENE, rev: before.rev, patch: { id: "neu" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("id is the primary key");
    // Refused means refused: the row did not move.
    expect((await getFile(SCENE)).rev).toBe(before.rev);
    // An id patch that changes NOTHING is a no-op, not an error — that is what
    // "send the form back unchanged" looks like.
    const same = await patchOk({
      path: SCENE,
      rev: before.rev,
      patch: { id: "lighthouse-arrival", status: "played" },
    });
    expect(same.properties.id).toBe("lighthouse-arrival");
    expect(same.properties.status).toBe("played");
  });

  // DELETED: "a file without a properties block gets one, body untouched" —
  // a row always renders its properties (store/render.ts), so the case it
  // described has no counterpart. The 400 for the two properties-less kinds
  // below is what guards this corner now.
  test("400 for inbox and glossary — lists of rows, not entities", async () => {
    for (const rel of ["inbox", "glossary"]) {
      const before = await getFile(rel);
      const res = await patchReq({ path: rel, rev: before.rev, patch: { status: "x" } });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("no properties");
      expect(await getFile(rel)).toEqual(before);
    }
  });

  test("campaign is patchable through the same endpoint (issue #17)", async () => {
    const rel = "campaign";
    const before = await getFile(rel);
    expect(before.kind).toBe("campaign");
    const after = await patchOk({
      path: rel,
      rev: before.rev,
      patch: { description: "Neue Kurzbeschreibung." },
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
    const before = await getFile(SCENE);
    const res = await patchReq({
      path: SCENE,
      rev: before.rev - 1,
      patch: { status: "ready" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; rev: number };
    expect(typeof body.error).toBe("string");
    expect(body.rev).toBe(before.rev);
    // and nothing was written — same row, same token
    expect(await getFile(SCENE)).toEqual(before);
  });

  test("400 on malformed bodies", async () => {
    const before = await getFile(SCENE);
    const bad = [
      {}, // missing everything
      { path: SCENE, rev: before.rev }, // missing patch
      { path: SCENE, rev: "later", patch: {} }, // rev not a number
      { path: SCENE, rev: before.rev, patch: ["status"] }, // patch not an object
      { path: SCENE, rev: before.rev, patch: {}, extra: 1 }, // unknown key
      { path: 42, rev: before.rev, patch: {} }, // path not a string
    ];
    for (const b of bad) {
      expect((await patchReq(b)).status).toBe(400);
    }
    // non-JSON body
    const res = await app.request("/api/beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "no json",
    });
    expect(res.status).toBe(400);
    // none of the rejected requests touched the row
    expect(await getFile(SCENE)).toEqual(before);
  });

  test("path safety and missing rows behave like the read API", async () => {
    expect(
      (await patchReq({ path: "../../etc/passwd.md", rev: 1, patch: {} })).status,
    ).toBe(400);
    // No extension rule any more (issue #79): an address the schema does not
    // describe is simply not there.
    expect((await patchReq({ path: "notes.txt", rev: 1, patch: {} })).status).toBe(404);
    expect(
      (await patchReq({ path: "01-salzhafen/nope", rev: 1, patch: {} })).status,
    ).toBe(404);
    // A path naming the WRONG chapter for an existing scene id is a stale
    // link: 404, exactly as GET answers it (store/read.ts readByLocator).
    expect(
      (await patchReq({ path: "02-nebel/lighthouse-arrival.md", rev: 1, patch: {} })).status,
    ).toBe(404);
  });
});

describe("POST /api/:campaign/session/start", () => {
  test("creates today's session with the documented shape", async () => {
    const file = await postOk("/api/beispiel/session/start");
    expect(file.kind).toBe("session");
    // The id is an OPAQUE random string since issue #58 (a UUID): the file's
    // address and nothing else. What is asserted about it is that it IS the
    // address and that it carries no calendar date.
    const id = String(file.properties.id);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(file.path).toBe(`sessions/${id}`);
    expect(file.properties.started).toBe("2026-08-19T21:05:00");
    expect(file.properties.scenes_played).toEqual([]);
    // The skeleton is the one the format prescribes — the `## Log` section is
    // rendered from (still zero) log rows.
    expect(file.properties).toEqual({ id, started: "2026-08-19T21:05:00", scenes_played: [] });
    expect(file.body).toBe("\n## Log\n");
    // A fresh row starts at rev 1, and the GET agrees.
    expect(file.rev).toBe(1);
    expect((await getFile(file.path)).rev).toBe(1);
  });

  test("two starts hand out two DIFFERENT ids", async () => {
    const first = await postOk("/api/beispiel/session/start");
    await postOk("/api/beispiel/session/end");
    const second = await postOk("/api/beispiel/session/start");
    expect(second.properties.id).not.toBe(first.properties.id);
  });

  // Issue #58 bug: `started` used to be minute-precise, so it rounded DOWN to
  // the start of its minute and the timer chip opened at up to 0:00:59 — after
  // an end→start that read like the old session kept counting.
  test("`started` keeps the seconds, so a fresh session starts at 0", async () => {
    setNow(() => new Date(2026, 7, 19, 21, 5, 50));
    const file = await postOk("/api/beispiel/session/start");
    expect(file.properties.started).toBe("2026-08-19T21:05:50");
    // …and what the app actually clocks — startedMs vs. the same instant — is
    // zero, not 50 seconds.
    expect(file.startedMs).toBe(new Date(2026, 7, 19, 21, 5, 50).getTime());
  });

  test("a session started on the REAL clock has an elapsed under 2s (#58)", async () => {
    setNow(null); // the real clock: this is the bug's actual surface
    const before = Date.now();
    const file = await postOk("/api/beispiel/session/start");
    expect(file.startedMs).toBeDefined();
    expect(file.startedMs as number).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.now() - (file.startedMs as number)).toBeLessThan(2000);
  });

  test("second start on the same day is idempotent (nothing reset)", async () => {
    const first = await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 19, 21, 30));
    const again = await postOk("/api/beispiel/session/start");
    expect(again.properties.started).toBe("2026-08-19T21:05:00"); // NOT 21:30
    // Idempotent all the way down: no write happened, so the token stands.
    expect(again.rev).toBe(first.rev);
  });

  test("after the end a start creates a SECOND session with an empty log (#58)", async () => {
    const first = await postOk("/api/beispiel/session/start");
    await postOk("/api/beispiel/log", { text: "Runde eins" });
    await postOk("/api/beispiel/session/end");
    setNow(() => new Date(2026, 7, 19, 23, 30));
    const second = await postOk("/api/beispiel/session/start");
    // A second session of the SAME DAY is simply another opaque id.
    expect(second.path).not.toBe(first.path);
    // Own id, own `started`, and the log skeleton is EMPTY — the runtime of
    // the new session starts at 0 instead of inheriting the first evening's.
    expect(second.properties).toEqual({
      id: second.properties.id,
      started: "2026-08-19T23:30:00",
      scenes_played: [],
    });
    expect(second.body).toBe("\n## Log\n");
    expect(second.rev).toBe(1);
  });

  test("409 session_running when an OLDER session is still open", async () => {
    // A start on the NEXT day must not open a second session silently — the
    // app offers to end the old one (issue #40 review, finding 3).
    const open = await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 20, 20, 0));
    const res = await postJson("/api/beispiel/session/start");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_running",
      // "Older" is decided by the DATE PART OF `started` now — the id says
      // nothing about a day (issue #58).
      path: open.path,
    });
    // …and nothing was created for the new day: the campaign still has only
    // the committed fixture's session and this one.
    const tree = (await (await app.request("/api/beispiel/tree")).json()) as {
      sessions: unknown[];
    };
    expect(tree.sessions).toHaveLength(2);
  });
});

describe("POST /api/:campaign/log", () => {
  // NOTE (issue #40): a log line lands in the ACTIVE session — the last
  // started row without `ended`. Each case starts one; "no session at all"
  // is covered under session/end below.
  test("appends `- HH:MM (sceneId) text` under ## Log", async () => {
    await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 19, 21, 12));
    const file = await postOk("/api/beispiel/log", {
      text: "Spuren am Strand #thread",
      sceneId: "lighthouse-arrival",
    });
    expect(file.body).toBe("\n## Log\n\n- 21:12 (lighthouse-arrival) Spuren am Strand #thread\n");
  });

  test("omits the parens without sceneId and appends after existing entries", async () => {
    await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 19, 21, 12));
    await postOk("/api/beispiel/log", {
      text: "Spuren am Strand #thread",
      sceneId: "lighthouse-arrival",
    });
    setNow(() => new Date(2026, 7, 19, 21, 20));
    const file = await postOk("/api/beispiel/log", { text: "Pause" });
    // Append order is the rows' `pos` order — a log line is never rewritten.
    expect(
      file.body.endsWith("- 21:12 (lighthouse-arrival) Spuren am Strand #thread\n- 21:20 Pause\n"),
    ).toBe(true);
  });

  test("multi-line text collapses to a single log line", async () => {
    await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 19, 21, 25));
    const file = await postOk("/api/beispiel/log", { text: "  Zeile eins\n   Zeile zwei  " });
    expect(file.body.endsWith("- 21:25 Zeile eins Zeile zwei\n")).toBe(true);
  });

  test("the line goes into ## Log, above the session's other sections", async () => {
    // The old case wrote a session file with a `## Threads` section and
    // checked the INSERTION POINT of the markdown surgery. There is no
    // surgery any more: `## Log` is rendered from `log_entries` and the rest
    // of the session's prose follows it (store/render.ts renderSessionBody).
    // The invariant that mattered survives — a note does not land in, or
    // clobber, the DM's own sections — so it is asserted on the fixture
    // session, made the running one for the purpose. That used to be POST
    // /session/resume; the endpoint is gone (issue #58 — "beenden" is final),
    // so the row is opened directly here: the SUBJECT of the case is the log
    // append, not the state machine.
    db.update(sessionsTable)
      .set({ ended: null })
      .where(eq(sessionsTable.id, "2026-01-15"))
      .run();
    setNow(() => new Date(2026, 0, 15, 23, 0));
    const file = await postOk("/api/beispiel/log", { text: "Nachtrag nach dem Cliffhanger" });
    expect(file.path).toBe("sessions/2026-01-15");
    expect(file.body).toContain(
      "- 22:40 — Cliffhanger: Lichter in der Bucht gesichtet #thread\n- 23:00 Nachtrag nach dem Cliffhanger\n\n## Threads\n",
    );
    // Threads content untouched
    expect(file.body).toContain("- [ ] Wer bezahlt die Schmuggler?");
  });

  test("400 on empty or missing text", async () => {
    await postOk("/api/beispiel/session/start");
    expect((await postJson("/api/beispiel/log", { text: "" })).status).toBe(400);
    expect((await postJson("/api/beispiel/log", { text: "   \n " })).status).toBe(400);
    expect((await postJson("/api/beispiel/log", {})).status).toBe(400);
    expect((await postJson("/api/beispiel/log", { text: 42 })).status).toBe(400);
  });

  test("404 for a scene that does not exist — and nothing is appended", async () => {
    // The line and `scenes_played` both REFERENCE the scene (ADR #18), and a
    // quick note does not invent one: the app picks the scene from the
    // campaign, so an id with no scene is a stale client.
    const session = await postOk("/api/beispiel/session/start");
    const res = await postJson("/api/beispiel/log", { text: "Ankunft", sceneId: "gibt-es-nicht" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("unknown scene");
    expect((await getFile(session.path)).body).toBe(session.body);
  });
});

describe("scenes_played maintenance (POST log with sceneId)", () => {
  test("first log with a sceneId adds it to scenes_played", async () => {
    await postOk("/api/beispiel/session/start");
    const file = await postOk("/api/beispiel/log", {
      text: "Ankunft",
      sceneId: "lighthouse-arrival",
    });
    expect(file.properties.scenes_played).toEqual(["lighthouse-arrival"]);
    // The played scene is a row, and rendering it back did not disturb the log
    expect(file.body).toBe("\n## Log\n\n- 21:05 (lighthouse-arrival) Ankunft\n");
  });

  test("second log with the same sceneId does not duplicate", async () => {
    await postOk("/api/beispiel/session/start");
    await postOk("/api/beispiel/log", { text: "Ankunft", sceneId: "lighthouse-arrival" });
    setNow(() => new Date(2026, 7, 19, 21, 10));
    const file = await postOk("/api/beispiel/log", {
      text: "Immer noch da",
      sceneId: "lighthouse-arrival",
    });
    expect(file.properties.scenes_played).toEqual(["lighthouse-arrival"]);
    // The log, however, grows — both lines are there, in order.
    expect(file.body.endsWith("- 21:05 (lighthouse-arrival) Ankunft\n- 21:10 (lighthouse-arrival) Immer noch da\n")).toBe(
      true,
    );
  });

  test("a different sceneId is appended in first-played order", async () => {
    await postOk("/api/beispiel/session/start");
    await postOk("/api/beispiel/log", { text: "Ankunft", sceneId: "lighthouse-arrival" });
    setNow(() => new Date(2026, 7, 19, 21, 10));
    await postOk("/api/beispiel/log", { text: "Erwischt", sceneId: "smuggler-captured" });
    setNow(() => new Date(2026, 7, 19, 21, 15));
    // Playing the FIRST scene again must not reorder the list — the order is
    // "first played", not "last played" (it is the review's reading order).
    const file = await postOk("/api/beispiel/log", {
      text: "Zurück am Turm",
      sceneId: "lighthouse-arrival",
    });
    expect(file.properties.scenes_played).toEqual(["lighthouse-arrival", "smuggler-captured"]);
  });

  test("log without sceneId leaves scenes_played untouched", async () => {
    await postOk("/api/beispiel/session/start");
    await postOk("/api/beispiel/log", { text: "Ankunft", sceneId: "lighthouse-arrival" });
    setNow(() => new Date(2026, 7, 19, 21, 15));
    const file = await postOk("/api/beispiel/log", { text: "Pause" });
    expect(file.properties.scenes_played).toEqual(["lighthouse-arrival"]);
    expect(file.body.endsWith("- 21:15 Pause\n")).toBe(true);
  });

  // DELETED: "a session file without scenes_played gains the key on first
  // sceneId-log" — that was the degrade path of a hand-written file. The key
  // is rendered from `session_scenes_played` and therefore always present
  // (empty list included, asserted in the session/start case above).
});

describe("POST /api/:campaign/session/end", () => {
  test("sets ended, log untouched", async () => {
    await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 19, 21, 25));
    await postOk("/api/beispiel/log", { text: "Zeile eins Zeile zwei" });
    setNow(() => new Date(2026, 7, 19, 23, 45));
    const file = await postOk("/api/beispiel/session/end");
    expect(file.properties.ended).toBe("2026-08-19T23:45:00");
    expect(Object.keys(file.properties)).toEqual(["id", "started", "ended", "scenes_played"]);
    expect(file.properties.started).toBe("2026-08-19T21:05:00");
    // the log line appended earlier survives verbatim
    expect(file.body.endsWith("- 21:25 Zeile eins Zeile zwei\n")).toBe(true);
  });

  test("second end keeps the first ended (idempotent)", async () => {
    await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 19, 23, 45));
    const first = await postOk("/api/beispiel/session/end");
    setNow(() => new Date(2026, 7, 19, 23, 59));
    const second = await postOk("/api/beispiel/session/end");
    expect(second.properties.ended).toBe("2026-08-19T23:45:00");
    // Idempotent means no write: the guard token stands still.
    expect(second.rev).toBe(first.rev);
  });

  test("end stays idempotent across days, log is refused (issue #40 review)", async () => {
    const started = await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 19, 23, 45));
    await postOk("/api/beispiel/session/end");
    // With nothing running, `end` falls back to the LAST STARTED session —
    // ended or not — and keeps its `ended`. That is what makes "Session
    // beenden" safe to press twice, also after midnight.
    setNow(() => new Date(2026, 7, 22, 22, 0));
    const file = await postOk("/api/beispiel/session/end");
    expect(file.path).toBe(started.path);
    expect(file.properties.ended).toBe("2026-08-19T23:45:00");
    // A log line, however, is STRICTLY the running session's business: a note
    // typed after the end used to land in the closed log with a 200.
    const log = await postJson("/api/beispiel/log", { text: "verloren" });
    expect(log.status).toBe(404);
    expect(await log.json()).toEqual({ error: expect.any(String) });
  });

  test("404 for a campaign that has no session at all", async () => {
    await withFreshCampaign(async () => {
      expect((await postJson(`/api/${FRESH}/session/end`)).status).toBe(404);
      expect((await postJson(`/api/${FRESH}/log`, { text: "x" })).status).toBe(404);
    });
  });
});

describe("POST /api/:campaign/inbox", () => {
  test("appends `- text` to the existing inbox", async () => {
    const before = await getFile("inbox");
    const after = await postOk("/api/beispiel/inbox", { text: "Schmied beobachten #thread" });
    // Append-only: the existing rendering is a PREFIX of the new one.
    expect(after.body.startsWith(before.body.replace(/\n$/, ""))).toBe(true);
    expect(after.body.endsWith("- Schmied beobachten #thread\n")).toBe(true);
    // visible in a subsequent GET with the fresh token
    const file = await getFile("inbox");
    expect(file.body).toBe(after.body);
    expect(file.rev).toBe(after.rev);
  });

  test("creates the inbox with a # Inbox heading when there is none", async () => {
    // The "missing inbox" case of the file version: a campaign whose
    // migration produced no inbox rows at all. It is an EMPTY document, not
    // a missing one (#70) — GET answers 200 — and the first entry brings the
    // heading the format opened the file with.
    await withFreshCampaign(async () => {
      expect(await fileStatus("inbox", FRESH)).toBe(200);
      const res = await postJson(`/api/${FRESH}/inbox`, { text: "Erste Idee" });
      expect(res.status).toBe(200);
      const file = (await res.json()) as EntryResponse;
      expect(file.body).toBe("\n# Inbox\n\n- Erste Idee\n");
      expect(file.properties).toEqual({ id: "inbox" });
    });
  });

  test("400 on empty text", async () => {
    expect((await postJson("/api/beispiel/inbox", { text: "  " })).status).toBe(400);
    expect((await postJson("/api/beispiel/inbox", {})).status).toBe(400);
  });

  test("404 for an unknown campaign", async () => {
    expect((await postJson("/api/nope/inbox", { text: "x" })).status).toBe(404);
    expect((await postJson("/api/nope/session/start")).status).toBe(404);
  });
});

// The metadata dialog of issue #34 writes name/description through PATCH
// /properties — the ONE write path since issue #62. The endpoint that used to
// close the "there is no `campaign` yet" gap (POST /campaign-meta) is gone
// with that gap: after the cutover the campaign ROW always exists, GET /entry
// always answers with a document and a guard token, and naming a campaign that
// has no name is an ordinary patch.
describe("naming a campaign that has none (issue #62)", () => {
  test("PATCH /properties sets name and description on an unnamed campaign", async () => {
    await withFreshCampaign(async () => {
      // Unnamed: the document exists and shows the ID as its display name,
      // which is exactly what GET /campaigns says too (both synthesize).
      const before = await getFile("campaign", FRESH);
      expect(before.properties).toEqual({ id: FRESH, name: FRESH });

      const res = await patchJson(`/api/${FRESH}/properties`, {
        path: "campaign",
        rev: before.rev,
        patch: {
          name: "Die Aschekönige",
          description: "Eine Wüstenkampagne um verschüttete Städte.",
        },
      });
      expect(res.status).toBe(200);
      const file = (await res.json()) as EntryResponse;
      expect(file.path).toBe("campaign");
      expect(file.kind).toBe("campaign");
      expect(file.properties.name).toBe("Die Aschekönige");
      // The id is the CAMPAIGN key — never client input.
      expect(file.properties).toEqual({
        id: "frischling",
        name: "Die Aschekönige",
        description: "Eine Wüstenkampagne um verschüttete Städte.",
      });
      expect(file.body).toBe("");

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
      const before = await getFile("campaign", FRESH);
      const res = await patchJson(`/api/${FRESH}/properties`, {
        path: "campaign",
        rev: before.rev,
        patch: { name: "Nur ein Name", description: null },
      });
      expect(res.status).toBe(200);
      const file = (await res.json()) as EntryResponse;
      expect(Object.keys(file.properties)).toEqual(["id", "name"]);
      expect(file.properties).toEqual({ id: "frischling", name: "Nur ein Name" });
      expect(file.body).toBe("");
    });
  });

  test("a stale token is a 409 — the existing name is never touched", async () => {
    const before = await getFile("campaign");
    const res = await patchJson("/api/beispiel/properties", {
      path: "campaign",
      rev: before.rev - 1,
      patch: { name: "Überschrieben" },
    });
    expect(res.status).toBe(409);
    expect(await getFile("campaign")).toEqual(before);
  });

  test("the create endpoint is gone — 404, no route", async () => {
    expect((await postJson("/api/beispiel/campaign-meta", { name: "x" })).status).toBe(404);
  });
});

// Body writes (issue #15): content editing in the app. The invariant under
// test everywhere here is that a body write is ONLY a body write — the
// properties of the row comes back unchanged, key for key and value for
// value ("the properties block stays byte-identical" of the file version).
describe("PUT /api/:campaign/entry", () => {
  const REFERENCE = "01-salzhafen/bucht/smuggler-captured";
  const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

  test("roundtrip: writing the read body back changes nothing but the token", async () => {
    const before = await getFile(REFERENCE);
    // the reference scene carries callouts and `## If:` sections
    expect(before.body).toContain("> [!check] Charisma (Deception)");
    expect(before.body).toContain("## If: sie lügen");

    const after = await putOk({ path: REFERENCE, rev: before.rev, body: before.body });
    expect(after.body).toBe(before.body);
    expect(after.properties).toEqual(before.properties);
    // A write is a write, so the rev moves — the token is opaque and
    // monotonic, never a content hash.
    expect(after.rev).toBe(before.rev + 1);
    expect((await getFile(REFERENCE)).rev).toBe(after.rev);
  });

  test("unknown callouts and headings survive a write verbatim", async () => {
    const before = await getFile(REFERENCE);
    const body = "\n## Völlig Eigenes\n\n> [!wetter] Nebel über der Bucht\n\n### Unter-Titel\n";
    const after = await putOk({ path: REFERENCE, rev: before.rev, body });
    expect(after.body).toBe(body);
    // and back again, character for character
    const back = await putOk({ path: REFERENCE, rev: after.rev, body: before.body });
    expect(back.body).toBe(before.body);
    expect(back.properties).toEqual(before.properties);
  });

  test("happy path: new body, properties untouched", async () => {
    const before = await getFile(SCENE);
    const body = "\n## Flow\n\nKomplett neu geschrieben.\n";

    const after = await putOk({ path: SCENE, rev: before.rev, body });
    expect(after.path).toBe(SCENE);
    expect(after.kind).toBe("scene");
    expect(after.body).toBe(body);
    // properties untouched — same keys, same values, same order
    expect(after.properties).toEqual(before.properties);
    expect(Object.keys(after.properties)).toEqual(Object.keys(before.properties));
    // fresh token, and a GET sees the write
    expect(after.rev).toBe(before.rev + 1);
    expect((await getFile(SCENE)).body).toBe(body);
  });

  test("a body without a trailing newline gets exactly one", async () => {
    const before = await getFile(SCENE);
    const after = await putOk({ path: SCENE, rev: before.rev, body: "\nOhne Newline" });
    expect(after.body).toBe("\nOhne Newline\n");
  });

  test("an empty body leaves the properties alone", async () => {
    const before = await getFile(SCENE);
    const after = await putOk({ path: SCENE, rev: before.rev, body: "" });
    expect(after.body).toBe("");
    expect(after.properties).toEqual(before.properties);
  });

  test("glossary: the edited markdown is parsed back into rows", async () => {
    // NEW with the cutover (planning F6): the glossary is a TABLE, so a body
    // write is the one PUT that decomposes what it is given — through the same
    // parser the migration used, so a hand-edited file and a DM's edit in the
    // app produce the same rows.
    const before = await getFile("glossary");
    expect(before.body).toContain("- lighthouse keeper → Leuchtturmwärter");
    const body = "\n- tide pool → Gezeitentümpel\n- harbour master → Hafenmeisterin\n";
    const after = await putOk({ path: "glossary", rev: before.rev, body });
    expect(after.body).toBe(body);
    // …and the structured endpoint sees the same list, in the same order.
    const glossary = (await (await app.request("/api/beispiel/glossary")).json()) as {
      entries: Array<{ term: string; explanation: string }>;
    };
    expect(glossary.entries).toEqual([
      { term: "tide pool", explanation: "Gezeitentümpel" },
      { term: "harbour master", explanation: "Hafenmeisterin" },
    ]);
    // The whole list was replaced — the fixture's terms are gone, not merged.
    expect(after.body).not.toContain("lighthouse keeper");
  });

  test("409 on a stale token carries the current one and writes nothing", async () => {
    const before = await getFile(SCENE);
    const res = await putFile({ path: SCENE, rev: before.rev - 1, body: "\nZu spät\n" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; rev: number };
    expect(typeof body.error).toBe("string");
    expect(body.rev).toBe(before.rev);
    expect(await getFile(SCENE)).toEqual(before);
  });

  // DELETED, all four of them: "a file without a properties block: the body
  // IS the file", "400 for a file whose properties block is not valid YAML",
  // the three degenerate-properties cases (stray space behind the fence,
  // unclosed block, BOM) and "a file the parser reads as pure body stays
  // writable". Every one of those guarded the RAW SPLIT of a markdown file:
  // the writer had to reattach a properties block it could not always find,
  // and refused rather than delete it. There is no split any more — the
  // properties is columns and the body is a column — so the failure mode is
  // gone with it. What a malformed file can still do is fail the importer's
  // parse, which names it in the seed report (test/db-migration.test.ts).

  test("400 for the append-only kinds — session logs and inbox", async () => {
    // DECISIONS #4: they grow by ROWS through POST /log and POST /inbox; a
    // free-hand body rewrite is not a maintenance action, and the rule lives
    // in the endpoint, not only in the UI that hides the button.
    for (const rel of ["sessions/2026-01-15", "inbox"]) {
      const before = await getFile(rel);
      const res = await putFile({ path: rel, rev: before.rev, body: "\nAlles neu.\n" });
      expect(res.status).toBe(400);
      expect(await getFile(rel)).toEqual(before);
    }
  });

  test("400 on malformed bodies", async () => {
    const before = await getFile(SCENE);
    const bad = [
      {}, // missing everything
      { path: SCENE, rev: before.rev }, // missing body
      { path: SCENE, rev: "später", body: "x" }, // rev not a number
      { path: SCENE, rev: before.rev, body: 42 }, // body not a string
      { path: SCENE, rev: before.rev, body: ["x"] }, // body not a string
      { path: SCENE, rev: before.rev, body: null }, // body not a string
      { path: SCENE, rev: before.rev, body: "x", patch: {} }, // unknown key
      { path: 42, rev: before.rev, body: "x" }, // path not a string
    ];
    for (const b of bad) {
      expect((await putFile(b)).status).toBe(400);
    }
    const res = await app.request("/api/beispiel/entry", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "no json",
    });
    expect(res.status).toBe(400);
    // none of the rejected requests touched the row
    expect(await getFile(SCENE)).toEqual(before);
  });

  test("path safety and missing rows behave like the read API", async () => {
    expect((await putFile({ path: "../../etc/passwd.md", rev: 1, body: "x" })).status).toBe(
      400,
    );
    // No extension rule any more (issue #79) — 404, not 400.
    expect((await putFile({ path: "notes.txt", rev: 1, body: "x" })).status).toBe(404);
    expect((await putFile({ path: "01-salzhafen/nope", rev: 1, body: "x" })).status).toBe(
      404,
    );
    expect(
      (await putFile({ path: "01-salzhafen/hafen/../hafen/x", rev: 1, body: "x" })).status,
    ).toBe(400);
    // A stale link — right scene id, wrong chapter — is 404 on write just as
    // it is on read (store/read.ts readByLocator).
    expect(
      (await putFile({ path: "02-nebel/lighthouse-arrival.md", rev: 1, body: "x" })).status,
    ).toBe(404);
  });

  test("404 for an unknown campaign", async () => {
    const res = await app.request("/api/nope/entry", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "a.md", rev: 1, body: "x" }),
    });
    expect(res.status).toBe(404);
  });

  describe("a relation counterpart is an id", () => {
    const NPC = "npcs/jorna";
    const LINE = "- fenn: kennt ihn von früher — er fuhr einst ehrlich zur See";

    /** The npc body with one extra line in the `## Beziehungen` section. */
    function withRelation(body: string, line: string): string {
      expect(body).toContain(LINE);
      return body.replace(LINE, `${LINE}\n${line}`);
    }

    test("400 for a counterpart written as a name — nothing is written", async () => {
      // `other_npc_id` is a foreign key and `ensureNpcRow` creates nothing
      // for a value that is no id, so this used to be a 500 on an ordinary
      // body edit. The rule is the one the npc list states.
      const before = await getFile(NPC);
      const res = await putFile({
        path: NPC,
        rev: before.rev,
        body: withRelation(before.body, "- Alte Freundin aus Waterdeep: sie schreiben sich"),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; code?: string };
      expect(body.error).toContain("Beziehungen holds npc ids, not names");
      expect(body.error).toContain("Alte Freundin aus Waterdeep");
      // Its own code, so the editor shows a German sentence naming the line
      // to fix rather than the English fallback text.
      expect(body).toMatchObject({
        code: "relation_ref_not_an_id",
        value: "Alte Freundin aus Waterdeep",
        suggestion: "alte-freundin-aus-waterdeep",
      });
      expect(await getFile(NPC)).toEqual(before);
    });

    test("a counterpart that IS an id creates its empty entry", async () => {
      const before = await getFile(NPC);
      const after = await putOk({
        path: NPC,
        rev: before.rev,
        body: withRelation(before.body, "- holm: schuldet ihr einen Gefallen"),
      });
      expect(after.body).toContain("- holm: schuldet ihr einen Gefallen");
      expect((await getFile("npcs/holm")).properties.name).toBe("holm");
    });

    test("a counterpart the entry ALREADY stores keeps saving", async () => {
      // A file era campaign is imported as it stands: a reference written as
      // a name got an npc row under that very name, and the relation points
      // at it. Refusing that text on the way out would make the entry
      // unsavable, so the rows are put there the way the import left them.
      db.insert(npcsTable)
        .values({ campaignId: "beispiel", id: "Alte Freundin aus Waterdeep" })
        .run();
      db.insert(npcRelationsTable)
        .values({
          campaignId: "beispiel",
          npcId: "jorna",
          otherNpcId: "Alte Freundin aus Waterdeep",
          note: "sie schreiben sich",
          pos: 1,
        })
        .run();
      const before = await getFile(NPC);
      expect(before.body).toContain("- Alte Freundin aus Waterdeep: sie schreiben sich");

      const after = await putOk({ path: NPC, rev: before.rev, body: before.body });
      expect(after.body).toContain("- Alte Freundin aus Waterdeep: sie schreiben sich");
    });
  });
});
