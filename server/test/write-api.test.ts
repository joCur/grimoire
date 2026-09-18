// The write API against the database stack.
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
import { and, eq } from "drizzle-orm";
import type { EntryResponse } from "@grimoire/shared";
import { app } from "../src/server";
import type { GrimoireDb } from "../src/db/client";
import { scenes as scenesTable, sessions as sessionsTable } from "../src/db/schema";
import { getDb } from "../src/store/handle";
import { seedCampaign } from "../src/db/seed";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

async function getFile(rel: string, campaign = "beispiel"): Promise<EntryResponse> {
  const res = await app.request(entriesUrl(campaign, rel));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function fileStatus(rel: string, campaign = "beispiel"): Promise<number> {
  return (await app.request(entriesUrl(campaign, rel))).status;
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

async function postOk(url: string, body?: unknown): Promise<EntryResponse> {
  const res = await postJson(url, body);
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
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

let db: GrimoireDb;

beforeEach(async () => {
  // 2026-08-19 21:05 local time unless a test overrides it.
  setSystemTime(new Date(2026, 7, 19, 21, 5));
  db = await seedStore();
});

afterEach(() => {
  setSystemTime();
  dropStore();
});

describe("PATCH /api/campaigns/:campaign/entries/* — the properties half", () => {
  const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

  test("happy path: only named keys change, key order stable, body untouched", async () => {
    const before = await getFile(SCENE);

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
    const again = await getFile(SCENE);
    expect(again.properties.status).toBe("played");
    expect(again.rev).toBe(after.rev);
  });

  test("400 for a key the entry has no field for — nothing is written", async () => {
    const before = await getFile(SCENE);
    const res = await patchEntry(SCENE, {
      rev: before.rev,
      properties: { review_note: "x" },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("review_note");
    expect((await getFile(SCENE)).rev).toBe(before.rev);
  });

  test("400 when the patch carries `id` — an id never changes", async () => {
    // The id IS the primary key: always present and never patchable. What
    // CAN happen is a form sending the whole properties back, `id` included
    // — and that must not orphan every reference to the entity.
    const before = await getFile(SCENE);
    const res = await patchEntry(SCENE, { rev: before.rev, properties: { id: "neu" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("id is the primary key");
    // Refused means refused: the row did not move.
    expect((await getFile(SCENE)).rev).toBe(before.rev);
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
  test("400 for inbox and glossary — lists of rows, not entities", async () => {
    for (const rel of ["inbox", "glossary"]) {
      const before = await getFile(rel);
      const res = await patchEntry(rel, { rev: before.rev, properties: { status: "x" } });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("no properties");
      expect(await getFile(rel)).toEqual(before);
    }
  });

  test("the campaign entry is patchable through the same endpoint", async () => {
    const rel = "campaign";
    const before = await getFile(rel);
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
    const before = await getFile(SCENE);
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
    expect(await getFile(SCENE)).toEqual(before);
  });

  test("400 on malformed bodies", async () => {
    const before = await getFile(SCENE);
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
    expect(await getFile(SCENE)).toEqual(before);
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
    // stale link: 404, exactly as GET answers it (store/read.ts
    // readByLocator).
    expect((await patchEntry("02-nebel/lighthouse-arrival.md", field)).status).toBe(404);
  });
});

describe("POST /api/campaigns/:campaign/session/start", () => {
  test("creates today's session with the documented shape", async () => {
    const file = await postOk("/api/campaigns/beispiel/session/start");
    expect(file.kind).toBe("session");
    // The id is an OPAQUE random string (a UUID): the entry's address and
    // nothing else. What is asserted about it is that it IS the address and
    // that it carries no calendar date.
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
    const first = await postOk("/api/campaigns/beispiel/session/start");
    await postOk("/api/campaigns/beispiel/session/end");
    const second = await postOk("/api/campaigns/beispiel/session/start");
    expect(second.properties.id).not.toBe(first.properties.id);
  });

  // `started` carries SECONDS, not just minutes. Rounded down to the start of
  // its minute it would open the timer chip at up to 0:00:59 — after an
  // end→start that reads like the old session kept counting.
  test("`started` keeps the seconds, so a fresh session starts at 0", async () => {
    setSystemTime(new Date(2026, 7, 19, 21, 5, 50));
    const file = await postOk("/api/campaigns/beispiel/session/start");
    expect(file.properties.started).toBe("2026-08-19T21:05:50");
    // …and what the app actually clocks — startedMs vs. the same instant — is
    // zero, not 50 seconds.
    expect(file.startedMs).toBe(new Date(2026, 7, 19, 21, 5, 50).getTime());
  });

  test("a session started on the REAL system clock has an elapsed under 2s", async () => {
    setSystemTime(); // the real clock, the surface this matters on
    const before = Date.now();
    const file = await postOk("/api/campaigns/beispiel/session/start");
    expect(file.startedMs).toBeDefined();
    expect(file.startedMs as number).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.now() - (file.startedMs as number)).toBeLessThan(2000);
  });

  test("second start on the same day is idempotent (nothing reset)", async () => {
    const first = await postOk("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 21, 30));
    const again = await postOk("/api/campaigns/beispiel/session/start");
    expect(again.properties.started).toBe("2026-08-19T21:05:00"); // NOT 21:30
    // Idempotent all the way down: no write happened, so the token stands.
    expect(again.rev).toBe(first.rev);
  });

  test("after the end a start creates a SECOND session with an empty log", async () => {
    const first = await postOk("/api/campaigns/beispiel/session/start");
    await postOk("/api/campaigns/beispiel/log", { text: "Runde eins" });
    await postOk("/api/campaigns/beispiel/session/end");
    setSystemTime(new Date(2026, 7, 19, 23, 30));
    const second = await postOk("/api/campaigns/beispiel/session/start");
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
    // app offers to end the old one.
    const open = await postOk("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 20, 20, 0));
    const res = await postJson("/api/campaigns/beispiel/session/start");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_running",
      // "Older" is decided by the DATE PART OF `started` now — the id says
      // nothing about a day.
      path: open.path,
    });
    // …and nothing was created for the new day: the campaign still has only
    // the committed fixture's session and this one.
    const tree = (await (await app.request("/api/campaigns/beispiel/tree")).json()) as {
      sessions: unknown[];
    };
    expect(tree.sessions).toHaveLength(2);
  });
});

describe("POST /api/campaigns/:campaign/log", () => {
  // NOTE: a log line lands in the ACTIVE session — the last
  // started row without `ended`. Each case starts one; "no session at all"
  // is covered under session/end below.
  test("appends `- HH:MM (sceneId) text` under ## Log", async () => {
    await postOk("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 21, 12));
    const file = await postOk("/api/campaigns/beispiel/log", {
      text: "Spuren am Strand #thread",
      sceneId: "lighthouse-arrival",
    });
    expect(file.body).toBe("\n## Log\n\n- 21:12 (lighthouse-arrival) Spuren am Strand #thread\n");
  });

  test("omits the parens without sceneId and appends after existing entries", async () => {
    await postOk("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 21, 12));
    await postOk("/api/campaigns/beispiel/log", {
      text: "Spuren am Strand #thread",
      sceneId: "lighthouse-arrival",
    });
    setSystemTime(new Date(2026, 7, 19, 21, 20));
    const file = await postOk("/api/campaigns/beispiel/log", { text: "Pause" });
    // Append order is the rows' `pos` order — a log line is never rewritten.
    expect(
      file.body.endsWith("- 21:12 (lighthouse-arrival) Spuren am Strand #thread\n- 21:20 Pause\n"),
    ).toBe(true);
  });

  test("multi-line text collapses to a single log line", async () => {
    await postOk("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 21, 25));
    const file = await postOk("/api/campaigns/beispiel/log", { text: "  Zeile eins\n   Zeile zwei  " });
    expect(file.body.endsWith("- 21:25 Zeile eins Zeile zwei\n")).toBe(true);
  });

  test("the line goes into ## Log, above the session's other sections", async () => {
    // `## Log` is rendered from `log_entries` and the rest of the session's
    // prose follows it (store/render.ts renderSessionBody). The invariant: a
    // note does not land in, or clobber, the DM's own sections. It is
    // asserted on the fixture session, made the running one for the purpose.
    // "beenden" is final, so no endpoint resumes a session and the row is
    // opened directly here: the SUBJECT of the case is the log append, not
    // the state machine.
    db.update(sessionsTable)
      .set({ ended: null })
      .where(eq(sessionsTable.id, "2026-01-15"))
      .run();
    setSystemTime(new Date(2026, 0, 15, 23, 0));
    const file = await postOk("/api/campaigns/beispiel/log", { text: "Nachtrag nach dem Cliffhanger" });
    expect(file.path).toBe("sessions/2026-01-15");
    expect(file.body).toContain(
      "- 22:40 — Cliffhanger: Lichter in der Bucht gesichtet #thread\n- 23:00 Nachtrag nach dem Cliffhanger\n\n## Threads\n",
    );
    // Threads content untouched
    expect(file.body).toContain("- [ ] Wer bezahlt die Schmuggler?");
  });

  test("400 on empty or missing text", async () => {
    await postOk("/api/campaigns/beispiel/session/start");
    expect((await postJson("/api/campaigns/beispiel/log", { text: "" })).status).toBe(400);
    expect((await postJson("/api/campaigns/beispiel/log", { text: "   \n " })).status).toBe(400);
    expect((await postJson("/api/campaigns/beispiel/log", {})).status).toBe(400);
    expect((await postJson("/api/campaigns/beispiel/log", { text: 42 })).status).toBe(400);
  });
});

describe("scenes_played maintenance (POST log with sceneId)", () => {
  test("first log with a sceneId adds it to scenes_played", async () => {
    await postOk("/api/campaigns/beispiel/session/start");
    const file = await postOk("/api/campaigns/beispiel/log", {
      text: "Ankunft",
      sceneId: "lighthouse-arrival",
    });
    expect(file.properties.scenes_played).toEqual(["lighthouse-arrival"]);
    // The played scene is a row, and rendering it back did not disturb the log
    expect(file.body).toBe("\n## Log\n\n- 21:05 (lighthouse-arrival) Ankunft\n");
  });

  test("second log with the same sceneId does not duplicate", async () => {
    await postOk("/api/campaigns/beispiel/session/start");
    await postOk("/api/campaigns/beispiel/log", { text: "Ankunft", sceneId: "lighthouse-arrival" });
    setSystemTime(new Date(2026, 7, 19, 21, 10));
    const file = await postOk("/api/campaigns/beispiel/log", {
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
    await postOk("/api/campaigns/beispiel/session/start");
    await postOk("/api/campaigns/beispiel/log", { text: "Ankunft", sceneId: "lighthouse-arrival" });
    setSystemTime(new Date(2026, 7, 19, 21, 10));
    await postOk("/api/campaigns/beispiel/log", { text: "Erwischt", sceneId: "smuggler-captured" });
    setSystemTime(new Date(2026, 7, 19, 21, 15));
    // Playing the FIRST scene again must not reorder the list — the order is
    // "first played", not "last played" (it is the review's reading order).
    const file = await postOk("/api/campaigns/beispiel/log", {
      text: "Zurück am Turm",
      sceneId: "lighthouse-arrival",
    });
    expect(file.properties.scenes_played).toEqual(["lighthouse-arrival", "smuggler-captured"]);
  });

  test("log without sceneId leaves scenes_played untouched", async () => {
    await postOk("/api/campaigns/beispiel/session/start");
    await postOk("/api/campaigns/beispiel/log", { text: "Ankunft", sceneId: "lighthouse-arrival" });
    setSystemTime(new Date(2026, 7, 19, 21, 15));
    const file = await postOk("/api/campaigns/beispiel/log", { text: "Pause" });
    expect(file.properties.scenes_played).toEqual(["lighthouse-arrival"]);
    expect(file.body.endsWith("- 21:15 Pause\n")).toBe(true);
  });

  // `scenes_played` is rendered from `session_scenes_played` and therefore
  // always present (empty list included, asserted in the session/start case
  // above).
});

describe("POST /api/campaigns/:campaign/session/end", () => {
  test("sets ended, log untouched", async () => {
    await postOk("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 21, 25));
    await postOk("/api/campaigns/beispiel/log", { text: "Zeile eins Zeile zwei" });
    setSystemTime(new Date(2026, 7, 19, 23, 45));
    const file = await postOk("/api/campaigns/beispiel/session/end");
    expect(file.properties.ended).toBe("2026-08-19T23:45:00");
    expect(Object.keys(file.properties)).toEqual(["id", "started", "ended", "scenes_played"]);
    expect(file.properties.started).toBe("2026-08-19T21:05:00");
    // the log line appended earlier survives verbatim
    expect(file.body.endsWith("- 21:25 Zeile eins Zeile zwei\n")).toBe(true);
  });

  test("second end keeps the first ended (idempotent)", async () => {
    await postOk("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 23, 45));
    const first = await postOk("/api/campaigns/beispiel/session/end");
    setSystemTime(new Date(2026, 7, 19, 23, 59));
    const second = await postOk("/api/campaigns/beispiel/session/end");
    expect(second.properties.ended).toBe("2026-08-19T23:45:00");
    // Idempotent means no write: the guard token stands still.
    expect(second.rev).toBe(first.rev);
  });

  test("end stays idempotent across days, log is refused", async () => {
    const started = await postOk("/api/campaigns/beispiel/session/start");
    setSystemTime(new Date(2026, 7, 19, 23, 45));
    await postOk("/api/campaigns/beispiel/session/end");
    // With nothing running, `end` falls back to the LAST STARTED session —
    // ended or not — and keeps its `ended`. That is what makes "Session
    // beenden" safe to press twice, also after midnight.
    setSystemTime(new Date(2026, 7, 22, 22, 0));
    const file = await postOk("/api/campaigns/beispiel/session/end");
    expect(file.path).toBe(started.path);
    expect(file.properties.ended).toBe("2026-08-19T23:45:00");
    // A log line, however, is STRICTLY the running session's business: a note
    // typed after the end is refused, not appended to the closed log.
    const log = await postJson("/api/campaigns/beispiel/log", { text: "verloren" });
    expect(log.status).toBe(404);
    expect(await log.json()).toEqual({ error: expect.any(String) });
  });

  test("404 for a campaign that has no session at all", async () => {
    await withFreshCampaign(async () => {
      expect((await postJson(`/api/campaigns/${FRESH}/session/end`)).status).toBe(404);
      expect((await postJson(`/api/campaigns/${FRESH}/log`, { text: "x" })).status).toBe(404);
    });
  });
});

describe("POST /api/campaigns/:campaign/inbox", () => {
  test("appends `- text` to the existing inbox", async () => {
    const before = await getFile("inbox");
    const after = await postOk("/api/campaigns/beispiel/inbox", { text: "Schmied beobachten #thread" });
    // Append-only: the existing rendering is a PREFIX of the new one.
    expect(after.body.startsWith(before.body.replace(/\n$/, ""))).toBe(true);
    expect(after.body.endsWith("- Schmied beobachten #thread\n")).toBe(true);
    // visible in a subsequent GET with the fresh token
    const file = await getFile("inbox");
    expect(file.body).toBe(after.body);
    expect(file.rev).toBe(after.rev);
  });

  test("creates the inbox with a # Inbox heading when there is none", async () => {
    // A campaign with no inbox rows at all: the inbox is an EMPTY entry, not
    // a missing one — GET answers 200 — and the first entry brings the
    // heading the format opens the inbox with.
    await withFreshCampaign(async () => {
      expect(await fileStatus("inbox", FRESH)).toBe(200);
      const res = await postJson(`/api/campaigns/${FRESH}/inbox`, { text: "Erste Idee" });
      expect(res.status).toBe(200);
      const file = (await res.json()) as EntryResponse;
      expect(file.body).toBe("\n# Inbox\n\n- Erste Idee\n");
      expect(file.properties).toEqual({ id: "inbox" });
    });
  });

  test("400 on empty text", async () => {
    expect((await postJson("/api/campaigns/beispiel/inbox", { text: "  " })).status).toBe(400);
    expect((await postJson("/api/campaigns/beispiel/inbox", {})).status).toBe(400);
  });

  test("404 for an unknown campaign", async () => {
    expect((await postJson("/api/campaigns/nope/inbox", { text: "x" })).status).toBe(404);
    expect((await postJson("/api/campaigns/nope/session/start")).status).toBe(404);
  });
});

// The metadata dialog writes name/description through the entry PATCH —
// the ONE write path. The campaign ROW always exists, GET /entry always
// answers with an entry and a guard token, and naming a campaign that has no
// name is an ordinary patch.
describe("naming a campaign that has none", () => {
  test("the PATCH sets name and description on an unnamed campaign", async () => {
    await withFreshCampaign(async () => {
      // Unnamed: the entry exists and shows the ID as its display name,
      // which is exactly what GET /campaigns says too (both synthesize).
      const before = await getFile("campaign", FRESH);
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
      const res = await patchEntry(
        "campaign",
        { rev: before.rev, properties: { name: "Nur ein Name", description: null } },
        FRESH,
      );
      expect(res.status).toBe(200);
      const file = (await res.json()) as EntryResponse;
      expect(Object.keys(file.properties)).toEqual(["id", "name"]);
      expect(file.properties).toEqual({ id: "frischling", name: "Nur ein Name" });
      expect(file.body).toBe("");
    });
  });

  test("a stale token is a 409 — the existing name is never touched", async () => {
    const before = await getFile("campaign");
    const res = await patchEntry("campaign", {
      rev: before.rev - 1,
      properties: { name: "Überschrieben" },
    });
    expect(res.status).toBe(409);
    expect(await getFile("campaign")).toEqual(before);
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
    const before = await getFile(REFERENCE);
    // the reference scene carries callouts and `## If:` sections
    expect(before.body).toContain("> [!check] Charisma (Deception)");
    expect(before.body).toContain("## If: sie lügen");

    const after = await patchOk(REFERENCE, { rev: before.rev, body: before.body });
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
    const after = await patchOk(REFERENCE, { rev: before.rev, body });
    expect(after.body).toBe(body);
    // and back again, character for character
    const back = await patchOk(REFERENCE, { rev: after.rev, body: before.body });
    expect(back.body).toBe(before.body);
    expect(back.properties).toEqual(before.properties);
  });

  test("happy path: new body, properties untouched", async () => {
    const before = await getFile(SCENE);
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
    expect((await getFile(SCENE)).body).toBe(body);
  });

  test("a body without a trailing newline gets exactly one", async () => {
    const before = await getFile(SCENE);
    const after = await patchOk(SCENE, { rev: before.rev, body: "\nOhne Newline" });
    expect(after.body).toBe("\nOhne Newline\n");
  });

  test("an empty body leaves the properties alone", async () => {
    const before = await getFile(SCENE);
    const after = await patchOk(SCENE, { rev: before.rev, body: "" });
    expect(after.body).toBe("");
    expect(after.properties).toEqual(before.properties);
  });

  test("the list addresses take no body — glossary, inbox and a session", async () => {
    // A glossary term, an idea and a log line are ROWS, edited through
    // PUT /glossary, POST /inbox and POST /log. A body for one of them
    // could only be a misunderstanding, and silently ignoring it would look
    // like a save (DECISIONS #4, ADR #23).
    for (const rel of ["glossary", "inbox", "sessions/2026-01-15"]) {
      const before = await getFile(rel);
      const res = await patchEntry(rel, { rev: before.rev, body: "\n- alles neu\n" });
      expect(res.status).toBe(400);
      const error = (await res.json()) as { code: string; path: string };
      expect(error.code).toBe("body_not_editable");
      expect(error.path).toBe(rel);
      expect(await getFile(rel)).toEqual(before);
    }
  });

  test("409 on a stale token carries the current one and writes nothing", async () => {
    const before = await getFile(SCENE);
    const res = await patchEntry(SCENE, { rev: before.rev - 1, body: "\nZu spät\n" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; rev: number };
    expect(typeof body.error).toBe("string");
    expect(body.rev).toBe(before.rev);
    expect(await getFile(SCENE)).toEqual(before);
  });

  test("400 on malformed bodies", async () => {
    const before = await getFile(SCENE);
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
    expect(await getFile(SCENE)).toEqual(before);
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
    // it is on read (store/read.ts readByLocator).
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
    const before = await getFile(SCENE);
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
    expect(await getFile(SCENE)).toEqual(after);
    // …and the campaign version counts one change too, not two.
    expect(await campaignVersion()).toBe(versionBefore + 1);
  });

  test("neither half is nothing_to_write, with the code", async () => {
    const before = await getFile(SCENE);
    for (const body of [{ rev: before.rev }, { rev: before.rev, properties: {} }]) {
      const res = await patchEntry(SCENE, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("nothing_to_write");
    }
    expect(await getFile(SCENE)).toEqual(before);
  });

  test("force keeps a field somebody else changed while replacing the text", async () => {
    const read = await getFile(SCENE);
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
    expect(await getFile(SCENE)).toEqual(forced);
  });
});
