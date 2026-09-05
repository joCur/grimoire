// Write-API tests (issue #5), ported to the database stack (issue #57).
//
// What changed with the cutover, and therefore in this file:
//
//   * THE STORE IS THE DATABASE. Every case runs against its OWN in-memory
//     database, seeded from `examples/` by the real migration (test/support/
//     store.ts). No file is written any more, so the old "the bytes on disk
//     are X" assertions are re-expressed against the API's own answer — which
//     is what the app sees and therefore what the contract is about.
//   * `mtimeMs` IS THE ROW'S `rev` — a small integer that starts at 1 and
//     grows by one per write, and still a deliberately opaque guard token.
//     "nothing was written" is now "the rev did not move".
//   * A SCENE'S PATH SEGMENT IS ITS ID (store/paths.ts), so the reference
//     scenes are addressed as `01-salzhafen/hafen/lighthouse-arrival.md` and
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
import { eq } from "drizzle-orm";
import type { FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { setNow } from "../src/clock";
import type { GrimoireDb } from "../src/db/client";
import { sessions as sessionsTable } from "../src/db/schema";
import {
  dropStore,
  removeTempRoot,
  seedStore,
  tempCampaignRoot,
  useCampaignRoot,
} from "./support/store";

async function getFile(rel: string, campaign = "beispiel"): Promise<FileResponse> {
  const res = await app.request(`/api/${campaign}/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function fileStatus(rel: string, campaign = "beispiel"): Promise<number> {
  return (await app.request(`/api/${campaign}/file?path=${encodeURIComponent(rel)}`)).status;
}

async function patchReq(body: unknown): Promise<Response> {
  return app.request("/api/beispiel/frontmatter", {
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

/** PATCH /frontmatter of any campaign (patchReq is bound to `beispiel`). */
async function patchJson(url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

async function postOk(url: string, body?: unknown): Promise<FileResponse> {
  const res = await postJson(url, body);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
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
  const restore = useCampaignRoot(root);
  try {
    await mkdir(path.join(root, FRESH), { recursive: true });
    await seedStore(root);
    await fn();
  } finally {
    restore();
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

describe("PATCH /api/:campaign/frontmatter", () => {
  const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";

  test("happy path: only named keys change, key order stable, body untouched", async () => {
    const before = await getFile(SCENE);

    const after = await patchOk({ path: SCENE, mtimeMs: before.mtimeMs, patch: { status: "played" } });
    expect(after.frontmatter.status).toBe("played");

    // Key order: the contract order of the kind, nothing added or removed.
    // In the file tree this was "the file's own order"; the columns produce it
    // now (store/render.ts rule 1), which is the same order the fixture had.
    expect(Object.keys(after.frontmatter)).toEqual([
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
    expect(after.frontmatter.id).toBe("lighthouse-arrival");
    expect(after.frontmatter.npcs).toEqual(["jorna"]);
    // The body is not a patch's business — unchanged, character for character.
    expect(after.body).toBe(before.body);
    expect(after.raw).toBe(before.raw.replace("status: ready", "status: played"));
    // Fresh guard token (exactly one write) and a subsequent GET sees both.
    expect(after.mtimeMs).toBe(before.mtimeMs + 1);
    const again = await getFile(SCENE);
    expect(again.frontmatter.status).toBe("played");
    expect(again.mtimeMs).toBe(after.mtimeMs);
  });

  test("new keys are appended after the existing ones", async () => {
    const before = await getFile(SCENE);
    const after = await patchOk({
      path: SCENE,
      mtimeMs: before.mtimeMs,
      patch: { review_note: "nochmal lesen" },
    });
    // A key the schema has no column for is preserved in `extra` and rendered
    // AFTER the contract keys — the successor of "appended to the block".
    const keys = Object.keys(after.frontmatter);
    expect(keys[keys.length - 1]).toBe("review_note");
    expect(after.frontmatter.review_note).toBe("nochmal lesen");
    expect(after.raw).toContain("review_note: nochmal lesen\n");
  });

  test("null deletes a key, everything else untouched", async () => {
    const before = await getFile(SCENE);
    // Set it first: every case starts from the untouched fixture now, so the
    // key to delete has to be created here rather than inherited.
    const withKey = await patchOk({
      path: SCENE,
      mtimeMs: before.mtimeMs,
      patch: { review_note: "nochmal lesen" },
    });
    const after = await patchOk({
      path: SCENE,
      mtimeMs: withKey.mtimeMs,
      patch: { review_note: null },
    });
    expect(Object.keys(after.frontmatter)).not.toContain("review_note");
    expect(after.raw).not.toContain("review_note");
    // …and nothing else moved: this is the untouched fixture again.
    expect(after.frontmatter).toEqual(before.frontmatter);
    expect(after.body).toBe(before.body);
  });

  test("400 when the patch carries `id` — that is POST /rename's job", async () => {
    // Replaces the old "a file without `id` on disk does not gain one": in the
    // database the id IS the primary key, always present and never patchable,
    // so the degrade case it guarded cannot exist. What CAN happen is a form
    // sending the whole frontmatter back, `id` included — and that must not
    // orphan every reference to the entity (issues #29/#30).
    const before = await getFile(SCENE);
    const res = await patchReq({ path: SCENE, mtimeMs: before.mtimeMs, patch: { id: "neu" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("id is the primary key");
    // Refused means refused: the row did not move.
    expect((await getFile(SCENE)).mtimeMs).toBe(before.mtimeMs);
    // An id patch that changes NOTHING is a no-op, not an error — that is what
    // "send the form back unchanged" looks like.
    const same = await patchOk({
      path: SCENE,
      mtimeMs: before.mtimeMs,
      patch: { id: "lighthouse-arrival", status: "played" },
    });
    expect(same.frontmatter.id).toBe("lighthouse-arrival");
    expect(same.frontmatter.status).toBe("played");
  });

  // DELETED: "a file without a frontmatter block gets one, body untouched" —
  // a row always renders its frontmatter (store/render.ts), so the case it
  // described has no counterpart. The 400 for the two frontmatter-less kinds
  // below is what guards this corner now.
  test("400 for inbox.md and glossary.md — lists of rows, not entities", async () => {
    for (const rel of ["inbox.md", "glossary.md"]) {
      const before = await getFile(rel);
      const res = await patchReq({ path: rel, mtimeMs: before.mtimeMs, patch: { status: "x" } });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("no frontmatter");
      expect(await getFile(rel)).toEqual(before);
    }
  });

  test("_campaign.md is patchable through the same endpoint (issue #17)", async () => {
    const rel = "_campaign.md";
    const before = await getFile(rel);
    expect(before.kind).toBe("campaign");
    const after = await patchOk({
      path: rel,
      mtimeMs: before.mtimeMs,
      patch: { description: "Neue Kurzbeschreibung." },
    });
    expect(after.frontmatter.description).toBe("Neue Kurzbeschreibung.");
    expect(after.frontmatter.name).toBe("Der Leuchtturm von Salzhafen");
    expect(Object.keys(after.frontmatter)).toEqual(["id", "name", "description"]); // order stable
    expect(after.raw).toContain("description: Neue Kurzbeschreibung.\n");
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
      mtimeMs: before.mtimeMs - 1,
      patch: { status: "ready" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; mtimeMs: number };
    expect(typeof body.error).toBe("string");
    expect(body.mtimeMs).toBe(before.mtimeMs);
    // and nothing was written — same row, same token
    expect(await getFile(SCENE)).toEqual(before);
  });

  test("400 on malformed bodies", async () => {
    const before = await getFile(SCENE);
    const bad = [
      {}, // missing everything
      { path: SCENE, mtimeMs: before.mtimeMs }, // missing patch
      { path: SCENE, mtimeMs: "later", patch: {} }, // mtimeMs not a number
      { path: SCENE, mtimeMs: before.mtimeMs, patch: ["status"] }, // patch not an object
      { path: SCENE, mtimeMs: before.mtimeMs, patch: {}, extra: 1 }, // unknown key
      { path: 42, mtimeMs: before.mtimeMs, patch: {} }, // path not a string
    ];
    for (const b of bad) {
      expect((await patchReq(b)).status).toBe(400);
    }
    // non-JSON body
    const res = await app.request("/api/beispiel/frontmatter", {
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
      (await patchReq({ path: "../../etc/passwd.md", mtimeMs: 1, patch: {} })).status,
    ).toBe(400);
    expect((await patchReq({ path: "notes.txt", mtimeMs: 1, patch: {} })).status).toBe(400);
    expect(
      (await patchReq({ path: "01-salzhafen/nope.md", mtimeMs: 1, patch: {} })).status,
    ).toBe(404);
    // A path naming the WRONG chapter for an existing scene id is a stale
    // link: 404, exactly as GET answers it (store/read.ts readByLocator).
    expect(
      (await patchReq({ path: "02-nebel/lighthouse-arrival.md", mtimeMs: 1, patch: {} })).status,
    ).toBe(404);
  });
});

describe("POST /api/:campaign/session/start", () => {
  test("creates today's session with the documented shape", async () => {
    const file = await postOk("/api/beispiel/session/start");
    expect(file.path).toBe("sessions/2026-08-19.md");
    expect(file.kind).toBe("session");
    expect(file.frontmatter.id).toBe("2026-08-19");
    expect(file.frontmatter.started).toBe("2026-08-19T21:05");
    expect(file.frontmatter.scenes_played).toEqual([]);
    // The rendered skeleton is the one the format prescribes — the `## Log`
    // section is rendered from (still zero) log rows.
    expect(file.raw).toBe(
      "---\nid: 2026-08-19\nstarted: 2026-08-19T21:05\nscenes_played: []\n---\n\n## Log\n",
    );
    // A fresh row starts at rev 1, and the GET agrees.
    expect(file.mtimeMs).toBe(1);
    expect((await getFile("sessions/2026-08-19.md")).mtimeMs).toBe(1);
  });

  test("second start on the same day is idempotent (nothing reset)", async () => {
    const first = await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 19, 21, 30));
    const again = await postOk("/api/beispiel/session/start");
    expect(again.frontmatter.started).toBe("2026-08-19T21:05"); // NOT 21:30
    // Idempotent all the way down: no write happened, so the token stands.
    expect(again.mtimeMs).toBe(first.mtimeMs);
  });

  test("after the end a start creates <date>-2 with an empty log (#58)", async () => {
    await postOk("/api/beispiel/session/start");
    await postOk("/api/beispiel/log", { text: "Runde eins" });
    await postOk("/api/beispiel/session/end");
    setNow(() => new Date(2026, 7, 19, 23, 30));
    const second = await postOk("/api/beispiel/session/start");
    expect(second.path).toBe("sessions/2026-08-19-2.md");
    // Own id, own `started`, and the log skeleton is EMPTY — the runtime of
    // the new session starts at 0 instead of inheriting the first evening's.
    expect(second.raw).toBe(
      "---\nid: 2026-08-19-2\nstarted: 2026-08-19T23:30\nscenes_played: []\n---\n\n## Log\n",
    );
    expect(second.mtimeMs).toBe(1);
  });

  test("409 session_running when an OLDER session is still open", async () => {
    // A start on the NEXT day must not open a second session silently — the
    // app offers to end the old one (issue #40 review, finding 3).
    await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 20, 20, 0));
    const res = await postJson("/api/beispiel/session/start");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_running",
      path: "sessions/2026-08-19.md",
    });
    // …and nothing was created for the new day.
    expect(await fileStatus("sessions/2026-08-20.md")).toBe(404);
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
    expect(file.path).toBe("sessions/2026-01-15.md");
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
});

describe("scenes_played maintenance (POST log with sceneId)", () => {
  test("first log with a sceneId adds it to scenes_played", async () => {
    await postOk("/api/beispiel/session/start");
    const file = await postOk("/api/beispiel/log", {
      text: "Ankunft",
      sceneId: "lighthouse-arrival",
    });
    expect(file.frontmatter.scenes_played).toEqual(["lighthouse-arrival"]);
    expect(file.raw).toContain("scenes_played: [lighthouse-arrival]\n");
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
    expect(file.frontmatter.scenes_played).toEqual(["lighthouse-arrival"]);
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
    expect(file.frontmatter.scenes_played).toEqual(["lighthouse-arrival", "smuggler-captured"]);
    expect(file.raw).toContain("scenes_played: [lighthouse-arrival, smuggler-captured]\n");
  });

  test("log without sceneId leaves scenes_played untouched", async () => {
    await postOk("/api/beispiel/session/start");
    await postOk("/api/beispiel/log", { text: "Ankunft", sceneId: "lighthouse-arrival" });
    setNow(() => new Date(2026, 7, 19, 21, 15));
    const file = await postOk("/api/beispiel/log", { text: "Pause" });
    expect(file.frontmatter.scenes_played).toEqual(["lighthouse-arrival"]);
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
    expect(file.frontmatter.ended).toBe("2026-08-19T23:45");
    expect(Object.keys(file.frontmatter)).toEqual(["id", "started", "ended", "scenes_played"]);
    expect(file.frontmatter.started).toBe("2026-08-19T21:05");
    // the log line appended earlier survives verbatim
    expect(file.body.endsWith("- 21:25 Zeile eins Zeile zwei\n")).toBe(true);
  });

  test("second end keeps the first ended (idempotent)", async () => {
    await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 19, 23, 45));
    const first = await postOk("/api/beispiel/session/end");
    setNow(() => new Date(2026, 7, 19, 23, 59));
    const second = await postOk("/api/beispiel/session/end");
    expect(second.frontmatter.ended).toBe("2026-08-19T23:45");
    // Idempotent means no write: the guard token stands still.
    expect(second.mtimeMs).toBe(first.mtimeMs);
  });

  test("end stays idempotent across days, log is refused (issue #40 review)", async () => {
    await postOk("/api/beispiel/session/start");
    setNow(() => new Date(2026, 7, 19, 23, 45));
    await postOk("/api/beispiel/session/end");
    // With nothing running, `end` falls back to the LAST STARTED session —
    // ended or not — and keeps its `ended`. That is what makes "Session
    // beenden" safe to press twice, also after midnight.
    setNow(() => new Date(2026, 7, 22, 22, 0));
    const file = await postOk("/api/beispiel/session/end");
    expect(file.path).toBe("sessions/2026-08-19.md");
    expect(file.frontmatter.ended).toBe("2026-08-19T23:45");
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
    const before = await getFile("inbox.md");
    const after = await postOk("/api/beispiel/inbox", { text: "Schmied beobachten #thread" });
    // Append-only: the existing rendering is a PREFIX of the new one.
    expect(after.body.startsWith(before.body.replace(/\n$/, ""))).toBe(true);
    expect(after.body.endsWith("- Schmied beobachten #thread\n")).toBe(true);
    // visible in a subsequent GET with the fresh token
    const file = await getFile("inbox.md");
    expect(file.body).toBe(after.body);
    expect(file.mtimeMs).toBe(after.mtimeMs);
  });

  test("creates the inbox with a # Inbox heading when there is none", async () => {
    // The "missing inbox.md" case of the file version: a campaign whose
    // migration produced no inbox rows at all answers 404 on GET, and the
    // first entry brings the heading the format opened the file with.
    await withFreshCampaign(async () => {
      expect(await fileStatus("inbox.md", FRESH)).toBe(404);
      const res = await postJson(`/api/${FRESH}/inbox`, { text: "Erste Idee" });
      expect(res.status).toBe(200);
      const file = (await res.json()) as FileResponse;
      expect(file.body).toBe("\n# Inbox\n\n- Erste Idee\n");
      expect(file.raw).toBe("---\nid: inbox\n---\n\n# Inbox\n\n- Erste Idee\n");
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
// /frontmatter — the ONE write path since issue #62. The endpoint that used to
// close the "there is no `_campaign.md` yet" gap (POST /campaign-meta) is gone
// with that gap: after the cutover the campaign ROW always exists, GET /file
// always answers with a document and a guard token, and naming a campaign that
// has no name is an ordinary patch.
describe("naming a campaign that has none (issue #62)", () => {
  test("PATCH /frontmatter sets name and description on an unnamed campaign", async () => {
    await withFreshCampaign(async () => {
      // Unnamed: the document exists and shows the ID as its display name,
      // which is exactly what GET /campaigns says too (both synthesize).
      const before = await getFile("_campaign.md", FRESH);
      expect(before.frontmatter).toEqual({ id: FRESH, name: FRESH });

      const res = await patchJson(`/api/${FRESH}/frontmatter`, {
        path: "_campaign.md",
        mtimeMs: before.mtimeMs,
        patch: {
          name: "Die Aschekönige",
          description: "Eine Wüstenkampagne um verschüttete Städte.",
        },
      });
      expect(res.status).toBe(200);
      const file = (await res.json()) as FileResponse;
      expect(file.path).toBe("_campaign.md");
      expect(file.kind).toBe("campaign");
      expect(file.frontmatter.name).toBe("Die Aschekönige");
      // The id is the CAMPAIGN key — never client input.
      expect(file.raw).toBe(
        "---\nid: frischling\nname: Die Aschekönige\ndescription: Eine Wüstenkampagne um verschüttete Städte.\n---\n",
      );

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
      const before = await getFile("_campaign.md", FRESH);
      const res = await patchJson(`/api/${FRESH}/frontmatter`, {
        path: "_campaign.md",
        mtimeMs: before.mtimeMs,
        patch: { name: "Nur ein Name", description: null },
      });
      expect(res.status).toBe(200);
      const file = (await res.json()) as FileResponse;
      expect(Object.keys(file.frontmatter)).toEqual(["id", "name"]);
      expect(file.raw).toBe("---\nid: frischling\nname: Nur ein Name\n---\n");
    });
  });

  test("a stale token is a 409 — the existing name is never touched", async () => {
    const before = await getFile("_campaign.md");
    const res = await patchJson("/api/beispiel/frontmatter", {
      path: "_campaign.md",
      mtimeMs: before.mtimeMs - 1,
      patch: { name: "Überschrieben" },
    });
    expect(res.status).toBe(409);
    expect(await getFile("_campaign.md")).toEqual(before);
  });

  test("the create endpoint is gone — 404, no route", async () => {
    expect((await postJson("/api/beispiel/campaign-meta", { name: "x" })).status).toBe(404);
  });
});

// Body writes (issue #15): content editing in the app. The invariant under
// test everywhere here is that a body write is ONLY a body write — the
// frontmatter of the row comes back unchanged, key for key and value for
// value ("the frontmatter block stays byte-identical" of the file version).
describe("PUT /api/:campaign/file", () => {
  const REFERENCE = "01-salzhafen/hafen/smuggler-captured.md";
  const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";

  /** The rendered prefix up to and including the YAML block's closing `---\n`. */
  function fmBlock(raw: string): string {
    return raw.slice(0, raw.indexOf("\n---\n") + "\n---\n".length);
  }

  test("roundtrip: writing the read body back changes nothing but the token", async () => {
    const before = await getFile(REFERENCE);
    // the reference scene carries callouts and `## If:` sections
    expect(before.body).toContain("> [!check] Charisma (Deception)");
    expect(before.body).toContain("## If: sie lügen");

    const after = await putOk({ path: REFERENCE, mtimeMs: before.mtimeMs, body: before.body });
    expect(after.body).toBe(before.body);
    expect(after.frontmatter).toEqual(before.frontmatter);
    expect(after.raw).toBe(before.raw);
    // The file writer could skip an identical write and keep the mtime; a row
    // write is a write, so the rev moves — the token is opaque and monotonic,
    // never a content hash.
    expect(after.mtimeMs).toBe(before.mtimeMs + 1);
    expect((await getFile(REFERENCE)).mtimeMs).toBe(after.mtimeMs);
  });

  test("unknown callouts and headings survive a write verbatim", async () => {
    const before = await getFile(REFERENCE);
    const body = "\n## Völlig Eigenes\n\n> [!wetter] Nebel über der Bucht\n\n### Unter-Titel\n";
    const after = await putOk({ path: REFERENCE, mtimeMs: before.mtimeMs, body });
    expect(after.body).toBe(body);
    // and back again, character for character
    const back = await putOk({ path: REFERENCE, mtimeMs: after.mtimeMs, body: before.body });
    expect(back.raw).toBe(before.raw);
  });

  test("happy path: new body, frontmatter untouched", async () => {
    const before = await getFile(SCENE);
    const body = "\n## Flow\n\nKomplett neu geschrieben.\n";

    const after = await putOk({ path: SCENE, mtimeMs: before.mtimeMs, body });
    expect(after.path).toBe(SCENE);
    expect(after.kind).toBe("scene");
    expect(after.body).toBe(body);
    // frontmatter untouched — same keys, same values, same order
    expect(after.frontmatter).toEqual(before.frontmatter);
    expect(Object.keys(after.frontmatter)).toEqual(Object.keys(before.frontmatter));
    expect(fmBlock(after.raw)).toBe(fmBlock(before.raw));
    expect(after.raw).toBe(fmBlock(before.raw) + body);
    // fresh token, and a GET sees the write
    expect(after.mtimeMs).toBe(before.mtimeMs + 1);
    expect((await getFile(SCENE)).body).toBe(body);
  });

  test("a body without a trailing newline gets exactly one", async () => {
    const before = await getFile(SCENE);
    const after = await putOk({ path: SCENE, mtimeMs: before.mtimeMs, body: "\nOhne Newline" });
    expect(after.body).toBe("\nOhne Newline\n");
    expect(after.raw.endsWith("\nOhne Newline\n")).toBe(true);
    expect(after.raw.endsWith("\n\n")).toBe(false);
  });

  test("an empty body leaves the frontmatter alone", async () => {
    const before = await getFile(SCENE);
    const after = await putOk({ path: SCENE, mtimeMs: before.mtimeMs, body: "" });
    expect(after.body).toBe("");
    expect(after.frontmatter).toEqual(before.frontmatter);
    expect(after.raw).toBe(fmBlock(before.raw));
  });

  test("glossary.md: the edited markdown is parsed back into rows", async () => {
    // NEW with the cutover (planning F6): the glossary is a TABLE, so a body
    // write is the one PUT that decomposes what it is given — through the same
    // parser the migration used, so a hand-edited file and a DM's edit in the
    // app produce the same rows.
    const before = await getFile("glossary.md");
    expect(before.body).toContain("- lighthouse keeper → Leuchtturmwärter");
    const body = "\n- tide pool → Gezeitentümpel\n- harbour master → Hafenmeisterin\n";
    const after = await putOk({ path: "glossary.md", mtimeMs: before.mtimeMs, body });
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
    const res = await putFile({ path: SCENE, mtimeMs: before.mtimeMs - 1, body: "\nZu spät\n" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; mtimeMs: number };
    expect(typeof body.error).toBe("string");
    expect(body.mtimeMs).toBe(before.mtimeMs);
    expect(await getFile(SCENE)).toEqual(before);
  });

  // DELETED, all four of them: "a file without a frontmatter block: the body
  // IS the file", "400 for a file whose frontmatter block is not valid YAML",
  // the three degenerate-frontmatter cases (stray space behind the fence,
  // unclosed block, BOM) and "a file the parser reads as pure body stays
  // writable". Every one of those guarded the RAW SPLIT of a markdown file:
  // the writer had to reattach a frontmatter block it could not always find,
  // and refused rather than delete it. There is no split any more — the
  // frontmatter is columns and the body is a column — so the failure mode is
  // gone with it. What a malformed file can still do is fail the one-time
  // migration's parse, which is `unknown_files` plus a `migration_report`
  // entry (covered by test/db-migration.test.ts).

  test("400 for the append-only kinds — session logs and inbox", async () => {
    // DECISIONS #4: they grow by ROWS through POST /log and POST /inbox; a
    // free-hand body rewrite is not a maintenance action, and the rule lives
    // in the endpoint, not only in the UI that hides the button.
    for (const rel of ["sessions/2026-01-15.md", "inbox.md"]) {
      const before = await getFile(rel);
      const res = await putFile({ path: rel, mtimeMs: before.mtimeMs, body: "\nAlles neu.\n" });
      expect(res.status).toBe(400);
      expect(await getFile(rel)).toEqual(before);
    }
  });

  test("400 on malformed bodies", async () => {
    const before = await getFile(SCENE);
    const bad = [
      {}, // missing everything
      { path: SCENE, mtimeMs: before.mtimeMs }, // missing body
      { path: SCENE, mtimeMs: "später", body: "x" }, // mtimeMs not a number
      { path: SCENE, mtimeMs: before.mtimeMs, body: 42 }, // body not a string
      { path: SCENE, mtimeMs: before.mtimeMs, body: ["x"] }, // body not a string
      { path: SCENE, mtimeMs: before.mtimeMs, body: null }, // body not a string
      { path: SCENE, mtimeMs: before.mtimeMs, body: "x", patch: {} }, // unknown key
      { path: 42, mtimeMs: before.mtimeMs, body: "x" }, // path not a string
    ];
    for (const b of bad) {
      expect((await putFile(b)).status).toBe(400);
    }
    const res = await app.request("/api/beispiel/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "no json",
    });
    expect(res.status).toBe(400);
    // none of the rejected requests touched the row
    expect(await getFile(SCENE)).toEqual(before);
  });

  test("path safety and missing rows behave like the read API", async () => {
    expect((await putFile({ path: "../../etc/passwd.md", mtimeMs: 1, body: "x" })).status).toBe(
      400,
    );
    expect((await putFile({ path: "notes.txt", mtimeMs: 1, body: "x" })).status).toBe(400);
    expect((await putFile({ path: "01-salzhafen/nope.md", mtimeMs: 1, body: "x" })).status).toBe(
      404,
    );
    expect(
      (await putFile({ path: "01-salzhafen/hafen/../hafen/x.md", mtimeMs: 1, body: "x" })).status,
    ).toBe(400);
    // A stale link — right scene id, wrong chapter — is 404 on write just as
    // it is on read (store/read.ts readByLocator).
    expect(
      (await putFile({ path: "02-nebel/lighthouse-arrival.md", mtimeMs: 1, body: "x" })).status,
    ).toBe(404);
  });

  test("404 for an unknown campaign", async () => {
    const res = await app.request("/api/nope/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "a.md", mtimeMs: 1, body: "x" }),
    });
    expect(res.status).toBe(404);
  });
});
