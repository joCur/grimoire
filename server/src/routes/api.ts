// API routes: read, write, search/version, and the generator with its
// background jobs and its NPC run.
// Mounted under /api in server.ts. Response shapes are the contracts in
// @grimoire/shared (types.ts). THIS FILE IS THE API's documentation: every
// endpoint is described right above its route, and there is no second list
// anywhere that could drift away from it.
//
// WHAT `path` MEANS: an ADDRESS, not a path on disk — no `.md`, no extension at
// all. The complete schema is in ../store/paths.ts:
//
//   campaign · <chapter> ·
//   <chapter>/<scene-id> · <chapter>/<group>/<scene-id> ·
//   npcs/<id> · locations/<id>
//
// The wire vocabulary follows from that: an entry's fields are `properties`,
// its markdown is `body`, and its optimistic-concurrency token is `rev` (the
// row version).
//
// THE THREE LISTS ARE NOT ENTRIES (ADR #26). A session, the inbox and the
// glossary are tables, and they answer their OWN shapes on their own
// endpoints — `SessionResponse`, `InboxResponse`, `GlossaryResponse`, rows
// all the way down. None of them has an address, so an entry path reaching
// for one answers 404 like any other address the schema does not describe.
// `inbox`, `glossary` and `sessions` stay RESERVED segments all the same, so
// no chapter can claim one and collide with its list's endpoint.
//
// ERROR BODIES ARE LANGUAGE-FREE. Every error a HUMAN reads carries a stable
// `code` from `@grimoire/shared/error-codes` plus the parameters its sentence
// needs; the `error` text next to it is the ENGLISH technical fallback (curl,
// logs, a client that does not know the code). The app renders the sentence
// from its own catalog (app/src/i18n, keys `server.<code>`) and degrades to
// that text for a code it does not know. Codes are APPEND-ONLY — the full
// list lives in shared/src/error-codes.ts.

import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  isKnowledgeKind,
  KNOWLEDGE_KINDS,
  type DraftEdit,
  type KnowledgeEntry,
  type PatchSessionRequest,
} from "@grimoire/shared";
import { getBuildId } from "../config";
import { ApiError } from "../api-error";
import { campaignVersion, createCampaign, listCampaigns, requireCampaign } from "../store/campaigns";
import { appendInboxEntry, markInboxLineDone, readInbox } from "../store/inbox";
import {
  appendThreadToChapter,
  buildTree,
  createChapter,
  createScene,
  setActiveChapter,
} from "../store/chapters";
import { readGlossary, writeGlossary } from "../store/glossary";
import { readKnowledge, writeKnowledge } from "../store/knowledge";
import { readEntry } from "../store/read";
import {
  appendLogEntry,
  continueSession,
  discardSession,
  endSession,
  listSessions,
  markLogLineSeen,
  patchSession,
  pauseSession,
  readActiveSession,
  readSession,
  startSession,
} from "../store/sessions";
import { addressSegments } from "../store/paths";
import { searchCampaign } from "../store/search";
import { readSettings, writeSettings } from "../store/settings";
import { createLocation } from "../store/locations";
import { createNpc, createNpcStub } from "../store/npcs";
import { patchEntry } from "../store/write";
import { acceptJobParts } from "../generate-accept";
import {
  applyGenerated,
  assertGenerateTarget,
  assertNpcGenerateTarget,
  obtainProvider,
} from "../generator";
import { applyAugment, readAugmentTarget } from "../generator-augment";
import {
  deleteJob,
  getJob,
  patchJobReview,
  retryJobPart,
  serializeJob,
  type ReviewPatch,
  startJob,
} from "../generate-jobs";

export const api = new Hono();

// Map ApiError to a small JSON error body; anything else is a real 500.
api.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message, ...err.extra }, err.status as ContentfulStatusCode);
  }
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});

// Every /api response carries the server's build id. The primary
// carrier is GET /campaigns/:campaign/version (the app polls it anyway); this header is
// the cheap belt-and-braces copy for anything that talks to the API without
// that poll — curl during a deploy, a future client, the browser network tab.
// Set on the finished response so handlers that return a raw Response (not
// c.json) get it too.
api.use("*", async (c, next) => {
  await next();
  c.res.headers.set("x-grimoire-build", getBuildId());
});

// --- request body validation ---------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Parse the JSON body; must be an object with no keys outside `allowed`. */
async function jsonBody(c: Context, allowed: string[]): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "request body must be valid JSON");
  }
  if (!isPlainObject(body)) throw new ApiError(400, "request body must be a JSON object");
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new ApiError(400, `unknown body key: ${key}`);
  }
  return body;
}

/**
 * The `rev` of a guarded write. Its own helper because the
 * third and fourth endpoint needed the identical three lines: a MISSING rev
 * has to be a 400 and never a default, because a defaulted guard token is no
 * guard at all (ADR #4).
 */
function requireRev(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(400, "rev must be a number");
  }
  return value;
}

/**
 * One SINGLE-LINE field of a knowledge entry.
 *
 * The knowledge list feeds the generator prompt, where an entry becomes one
 * bullet in markdown the model reads as INSTRUCTIONS
 * (store/read.ts knowledgeText). A newline inside an entry is
 * therefore not a formatting detail: it lets an entry open lines of its own —
 * a `## ` heading that poses as a section of the prompt, for instance. The UI
 * has single-line inputs and cannot produce one, so refusing it costs the DM
 * nothing and closes the door for every other client.
 *
 * The prompt assembly stays defensive as well (`promptInline`) — this is the
 * validator, not the only line of defence.
 */
function requireSingleLine(value: string, key: string): string {
  if (/[\r\n]/u.test(value)) throw new ApiError(400, `${key} must be a single line`);
  return value;
}

/** Query flag: present and not `0`/`false` counts as on (`?includeEnded=1`). */
function isTruthyFlag(v: string | undefined): boolean {
  return v !== undefined && v !== "0" && v.toLowerCase() !== "false";
}

/**
 * Normalize free text destined for a single markdown list line: trim and
 * collapse any internal newline (plus surrounding spaces) to one space.
 * Returns undefined for non-strings and for text that is empty after
 * trimming.
 */
function normalizeLineText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const text = v.replace(/\s*\r?\n\s*/g, " ").trim();
  return text === "" ? undefined : text;
}

/**
 * The entry address of an `/entries/*` route: everything behind `entries/`,
 * one decoded segment per address segment (an address may carry umlauts).
 * The store layer validates the result (`assertSafeAddress`), so an escape
 * attempt reaches it as an address and is answered with a 400.
 */
function entryAddress(c: Context): string {
  const marker = "/entries/";
  const pathname = new URL(c.req.url).pathname;
  const at = pathname.indexOf(marker);
  const rest = at === -1 ? "" : pathname.slice(at + marker.length);
  if (rest === "") throw new ApiError(400, "missing entry address");
  return addressSegments(rest)
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

// --- read endpoints --------------------------------------------------------------

// GET /api/campaigns -> CampaignSummary[]
api.get("/campaigns", async (c) => c.json(await listCampaigns()));

// GET /api/settings -> InstanceSettings. Campaign-independent:
// the UI language belongs to the INSTANCE, and the app asks for it before it
// knows which campaign it is about to open (the cold start has none).
api.get("/settings", async (c) => c.json(await readSettings()));

// PUT /api/settings { locale } -> InstanceSettings. `null` clears the setting
// (back to "follow the browser"); anything but de/en/null is a 400.
// Stored in the `meta` table under `setting:locale` — no table of its own for
// one user with one settings object, and deliberately not localStorage: the
// language is server state (quality floor).
api.put("/settings", async (c) => {
  const body = await jsonBody(c, ["locale"]);
  return c.json(await writeSettings(body));
});

// GET /api/campaigns/:campaign/tree -> CampaignTree
api.get("/campaigns/:campaign/tree", async (c) => c.json(await buildTree(c.req.param("campaign"))));

// GET /api/campaigns/:campaign -> EntryResponse of the campaign entry.
// The campaign's own address is `campaign`, so this is the shorter spelling of
// GET /campaigns/:campaign/entries/campaign and answers exactly the same body.
api.get("/campaigns/:campaign", async (c) =>
  c.json(await readEntry(c.req.param("campaign"), "campaign")),
);

// GET /api/campaigns/:campaign/entries/<address> -> EntryResponse
// (properties, body, rev). The address IS the path — the schema is in
// store/paths.ts, and it describes the five ENTRY kinds only.
api.get("/campaigns/:campaign/entries/*", async (c) =>
  c.json(await readEntry(c.req.param("campaign"), entryAddress(c))),
);

// GET /api/campaigns/:campaign/session -> SessionResponse | null — the ACTIVE
// session, `null` when none runs. "Active" = the last STARTED session without
// `ended` — today's or an older one, so a session that runs past midnight
// stays active instead of vanishing at 00:00.
//
// This is the one place that decides what "the running session" is: the app
// must never derive it from its own date (a browser in another timezone, or
// simply a session past midnight, would get it wrong).
//
// `null` and not a 404: between two evenings nothing runs, and that is the
// ordinary state of a campaign, not a missing thing.
//
// The answer is ROWS, not an entry (ADR #26): `log` is the list of log rows,
// `pauses` the intervals, `scenesPlayed` the sequence. Every zone-less
// timestamp carries the SERVER's epoch reading beside it (`startedMs`,
// `endedMs`, a pause's `fromMs`/`toMs`) — that is what makes the live runtime
// correct in any timezone, and the client does plain epoch arithmetic: it
// subtracts the closed intervals and freezes the clock on the open one.
//
// `?includeEnded=1` asks the OTHER question: the last STARTED session, ended
// or not. That is the review's session (the harvest runs right after "Session
// beenden"), and it must come from the server for the same reason — a session
// that ran past midnight was ended in YESTERDAY's row, so the client's own
// date would harvest an empty or wrong one.
api.get("/campaigns/:campaign/session", async (c) =>
  c.json(await readActiveSession(c.req.param("campaign"), isTruthyFlag(c.req.query("includeEnded")))),
);

// GET /api/campaigns/:campaign/sessions -> SessionSummary[] — every session,
// NEWEST FIRST. A summary is the identifying head of a session: its id and
// when it ran, with the epoch readings. No log and no played scenes — a list
// shows when the evening was, and the session itself has the rest.
//
// The order is `started`, with the row's insertion time as the tie-break:
// several sessions per day are possible and the opaque id orders nothing.
api.get("/campaigns/:campaign/sessions", async (c) =>
  c.json(await listSessions(c.req.param("campaign"))),
);

// GET /api/campaigns/:campaign/sessions/:id -> SessionResponse, 404 for an
// unknown id. The way to read a session that is NOT the active one — the
// review's list of past evenings opens them through this.
api.get("/campaigns/:campaign/sessions/:id", async (c) =>
  c.json(await readSession(c.req.param("campaign"), c.req.param("id"))),
);

// GET /api/campaigns/:campaign/inbox -> InboxResponse `{ entries, rev }` —
// the ideas as rows (`{ id, text, done }`), newest last: the inbox is
// append-only. An EMPTY inbox answers 200 with an empty list, not a 404 — an
// empty list is a list, and a 404 would make every reader special-case an
// answer that means nothing is wrong.
//
// `rev` is the LIST's guard token (`campaigns.inbox_rev`), not
// `campaigns.version`: every unrelated write bumps that one, and one log line
// would then invalidate an inbox the DM had open during a session.
api.get("/campaigns/:campaign/inbox", async (c) =>
  c.json(await readInbox(c.req.param("campaign"))),
);

// GET /api/campaigns/:campaign/search?q=... -> { results: SearchResult[] } (max 20)
// Full-text search over the FTS5 index: scenes, npcs, locations,
// chapters, the campaign entry and the GLOSSARY, ranked by bm25 with the
// index's own column weights. Every token is a prefix term, so a half-typed
// palette query still matches, and the tokenizer folds diacritics ("leucht"
// finds "Leuchtturm").
api.get("/campaigns/:campaign/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (q === undefined || q === "") throw new ApiError(400, "missing q query parameter");
  const campaign = c.req.param("campaign");
  await requireCampaign(campaign); // 400 unsafe id, 404 unknown campaign
  return c.json({ results: await searchCampaign(campaign, q) });
});

// GET /api/campaigns/:campaign/version -> { version, build } — `version` is
// `campaigns.version`, bumped by every write in the SAME transaction as the
// change it belongs to — the database is the only truth (ADR #13), so a
// write is the only thing that can move it. The app polls this and refetches
// when it changes (DECISIONS #9). `build` rides
// along on that existing poll: the app compares it with its own
// build id and offers a reload when a deploy left it with a stale bundle.
// Every /api response carries the same value as `x-grimoire-build`.
api.get("/campaigns/:campaign/version", async (c) => {
  const campaign = c.req.param("campaign");
  return c.json({ version: await campaignVersion(campaign), build: getBuildId() });
});

// GET /api/campaigns/:campaign/glossary -> { entries: [{ term, explanation }], rev }
// The glossary is a structured TABLE: term → explanation, one row each, and
// this is the ONE way to read it (ADR #26) — the generator knowledge base
// builds on exactly these rows. `rev` is the LIST's guard token, the one
// PUT /glossary checks; it counts only the glossary's own writes, so an
// unrelated write during a session cannot invalidate an open edit.
api.get("/campaigns/:campaign/glossary", async (c) => c.json(await readGlossary(c.req.param("campaign"))));

// GET /api/campaigns/:campaign/knowledge -> { entries: [{ kind, from, to, text }], rev }
// The campaign's KNOWLEDGE BASE for the generator: naming
// conventions ("write <from> as <to>"), facts and style rules that outrank
// the source material. Its own list next to the glossary because it answers
// a different question — the glossary translates a term, an entry here
// overrides the source (db/schema.ts campaignKnowledge). Guard token:
// `campaigns.knowledge_rev`.
api.get("/campaigns/:campaign/knowledge", async (c) =>
  c.json(await readKnowledge(c.req.param("campaign"))),
);

// --- write endpoints --------------------------------------------------------------

// PATCH /api/campaigns/:campaign/entries/<address> { rev, properties?, body?, force? }
//   -> EntryResponse
// THE write of one entry (ADR #23): its fields, its text, or both in ONE
// request against ONE `rev`. The address is the path behind `entries/`, the
// same one GET reads.
//
// Fields and text together are ONE write: the row changes once, so `rev`
// steps once no matter how much the request carried.
//
// `properties` is a flat object of keys to set; null deletes a key. `body` is
// the markdown WITHOUT the properties block — exactly what GET hands out as
// `body` — and replaces the stored text. Neither of the two present is a 400
// { code: "nothing_to_write" }: a request that changes nothing is a bug in
// the caller, not a save.
//
// A reference in `properties` — `chapter`, `location`, an `npcs` entry — has
// to name an entry that exists: 400 with the code the app turns into its
// create-this-first hint, never a new entry as a side effect. A scene's
// `chapter` may be SET that way but never REMOVED (400): a scene belongs to
// a chapter and must not fall out of the tree. A key the entry's kind has no
// field for is a 400 as well; a key that is not part of the kind but sits on
// the row may still be changed or deleted with null.
//
// `locationName` is the display name for the location a scene's `location`
// CREATES — applied on insert only, never to a location that already exists.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, entry } and writes
// nothing — `entry` is the entry as it stands now, so the conflict dialog
// shows what is in the way without a second request. `force: true` writes the
// given fields on top of that current row instead: only what this request
// carries is written, so a status changed in between survives a forced text
// save.
//
// 404 for an entry that does not exist — including for an address that reaches
// for one of the three LISTS, which have none (ADR #26). They are written
// through their own endpoints: PUT /glossary, POST /inbox, POST /log, the
// session verbs, PATCH /sessions/:id and the review actions.
api.patch("/campaigns/:campaign/entries/*", async (c) => {
  const body = await jsonBody(c, ["rev", "properties", "body", "force"]);
  const properties = body.properties;
  const markdown = body.body;
  if (properties !== undefined && !isPlainObject(properties)) {
    throw new ApiError(400, "properties must be an object");
  }
  if (markdown !== undefined && typeof markdown !== "string") {
    throw new ApiError(400, "body must be a string");
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    throw new ApiError(400, "force must be a boolean");
  }
  return c.json(
    await patchEntry(c.req.param("campaign"), entryAddress(c), {
      rev: requireRev(body.rev),
      ...(properties === undefined ? {} : { properties }),
      ...(markdown === undefined ? {} : { body: markdown }),
      ...(body.force === undefined ? {} : { force: body.force }),
    }),
  );
});

// POST /api/campaigns/:campaign/session/start -> SessionResponse
// Creates a NEW session with an OPAQUE RANDOM id ("beenden" is FINAL, so a
// second evening on the same day is simply a second session with its own
// empty log and a runtime starting at 0; nothing reads the id — order and
// every label come from `started`). Idempotent only while TODAY's session is
// the RUNNING one — "today" is the date part of its `started` — so pressing
// the button twice re-enters it.
// One 409:
//   { code: "session_running", id } — an OLDER session is still open (past
//     midnight, or never ended). The app offers to end that one; nothing
//     starts a second parallel session.
api.post("/campaigns/:campaign/session/start", async (c) =>
  c.json(await startSession(c.req.param("campaign"))),
);

// POST /api/campaigns/:campaign/session/end -> SessionResponse — ends the
// ACTIVE session (that may be yesterday's row when it ran past midnight). An
// open pause is closed by the end. Idempotent — with nothing running the LAST
// STARTED session comes back with its existing `ended`; 404 when the campaign
// has no session at all.
api.post("/campaigns/:campaign/session/end", async (c) => c.json(await endSession(c.req.param("campaign"))));

// POST /api/campaigns/:campaign/session/pause -> SessionResponse — really
// STOPS the clock: it opens a `{ from }` interval in `pauses` and nothing
// else. No log row is written for it — a pause IS that interval, and the
// `— Pause` line the log used to carry was the same pause a second time
// (ADR #26). Idempotent (already paused -> 200, unchanged); 404 when no
// session is running.
api.post("/campaigns/:campaign/session/pause", async (c) =>
  c.json(await pauseSession(c.req.param("campaign"))),
);

// POST /api/campaigns/:campaign/session/continue -> SessionResponse — closes
// the open pause interval (`to`). It ends a PAUSE, not a session (an ended
// session is never re-opened), and writes no log row either. Idempotent (not
// paused -> 200, unchanged); 404 when no session is running.
api.post("/campaigns/:campaign/session/continue", async (c) =>
  c.json(await continueSession(c.req.param("campaign"))),
);

// POST /api/campaigns/:campaign/session/discard -> { id } — DELETES the
// active session, the undo of a mis-clicked "Session starten". Allowed ONLY
// while that session is empty (no log row, no played scene); otherwise 409
// { code: "session_not_empty", id } — a session with content is ended, never
// deleted. 404 when nothing is running.
api.post("/campaigns/:campaign/session/discard", async (c) =>
  c.json(await discardSession(c.req.param("campaign"))),
);

// PATCH /api/campaigns/:campaign/sessions/:id { rev, started?, ended?,
//   pauses? } -> SessionResponse
// The TIMESTAMPS of a session — everything about it the DM corrects by hand:
// a start typed into the wrong hour, a pause that was never closed. A field
// left out keeps its value, `ended: null` clears it (the session runs again)
// and `pauses` replaces the whole list.
//
// The log and `scenesPlayed` are NOT patchable: they grow through POST /log
// and the review actions, and a whole-list write of an append-only log is not
// an edit anybody asked for. Naming none of the three fields is 400
// { code: "nothing_to_write" }.
//
// 400 { code: "timestamp_not_allowed", field, value } for a value outside
// `yyyy-mm-ddTHH:MM:SS` — checked for the WHOLE request before the first
// write, so a refusal refuses all of it. 404 for an unknown id. A stale `rev`
// is 409 { code: "rev_conflict", rev, session } — the current session rides
// along, so the conflict dialog shows what is in the way without a second
// request. The key is `session`, not `entry`: a session is not an entry.
api.patch("/campaigns/:campaign/sessions/:id", async (c) => {
  const body = await jsonBody(c, ["rev", "started", "ended", "pauses"]);
  const request: PatchSessionRequest = { rev: requireRev(body.rev) };
  if (body.started !== undefined) {
    if (typeof body.started !== "string") throw new ApiError(400, "started must be a string");
    request.started = body.started;
  }
  if (body.ended !== undefined) {
    if (body.ended !== null && typeof body.ended !== "string") {
      throw new ApiError(400, "ended must be a string or null");
    }
    request.ended = body.ended;
  }
  if (body.pauses !== undefined) {
    if (!Array.isArray(body.pauses)) throw new ApiError(400, "pauses must be an array");
    request.pauses = body.pauses.map((item) => {
      if (!isPlainObject(item)) throw new ApiError(400, "each pause must be an object");
      if (typeof item.from !== "string") throw new ApiError(400, "each pause needs a `from`");
      if (item.to !== undefined && item.to !== null && typeof item.to !== "string") {
        throw new ApiError(400, "a pause's `to` must be a string or null");
      }
      return { from: item.from, ...(item.to === undefined ? {} : { to: item.to }) };
    });
  }
  return c.json(await patchSession(c.req.param("campaign"), c.req.param("id"), request));
});

// POST /api/campaigns/:campaign/log { text, sceneId? } -> SessionResponse
// Appends one log ROW — time, scene and text as columns — to the ACTIVE
// session (not stubbornly to today's); 404 when no session is running,
// including right after "Session beenden", where a note would otherwise land
// in a closed log. With a `sceneId` the scene is also appended to
// `scenesPlayed`, in the same transaction; an unknown one is 400
// { code: "log_scene_unknown", value }.
//
// The hashtags stay INSIDE `text`: they are body vocabulary (README), so the
// note is stored as the DM typed it.
api.post("/campaigns/:campaign/log", async (c) => {
  const body = await jsonBody(c, ["text", "sceneId"]);
  const text = normalizeLineText(body.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  let sceneId: string | undefined;
  if (body.sceneId !== undefined && body.sceneId !== null) {
    if (typeof body.sceneId !== "string") throw new ApiError(400, "sceneId must be a string");
    sceneId = normalizeLineText(body.sceneId);
  }
  return c.json(await appendLogEntry(c.req.param("campaign"), text, sceneId));
});

// POST /api/campaigns/:campaign/inbox { text } -> InboxResponse
// Appends one idea as a row and answers the WHOLE list with its fresh `rev`.
// No heading row is written in front of the first idea: the inbox is a table
// and has no skeleton (ADR #26).
api.post("/campaigns/:campaign/inbox", async (c) => {
  const body = await jsonBody(c, ["text"]);
  const text = normalizeLineText(body.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  return c.json(await appendInboxEntry(c.req.param("campaign"), text));
});

// PUT /api/campaigns/:campaign/glossary { entries: [{ term, explanation }], rev }
//   -> { entries, rev }
// Replaces the WHOLE list — the glossary is a short, hand-curated table that
// is edited as a whole, and that is also what makes REORDERING an ordinary
// save: the array order is the stored order, so there is no
// separate move endpoint. Of duplicate terms the FIRST one wins. `rev` is
// the list's guard token (the one GET /glossary hands out); a stale one is
// 409 { code: "rev_conflict", rev } and writes nothing. No `entry` rides
// along — the glossary is not one (ADR #26), and the settings page reloads
// the list itself.
//
// This is the ONLY way the glossary is written: it has no address, so there
// is no entry PATCH that could reach it.
api.put("/campaigns/:campaign/glossary", async (c) => {
  const body = await jsonBody(c, ["entries", "rev"]);
  const raw = body.entries;
  if (!Array.isArray(raw)) throw new ApiError(400, "entries must be an array");
  const entries: Array<{ term: string; explanation: string }> = [];
  for (const item of raw) {
    if (!isPlainObject(item)) throw new ApiError(400, "each entry must be an object");
    if (typeof item.term !== "string" || item.term.trim() === "") {
      throw new ApiError(400, "each entry needs a non-empty term");
    }
    if (item.explanation !== undefined && typeof item.explanation !== "string") {
      throw new ApiError(400, "explanation must be a string");
    }
    // NO single-line rule here, unlike the knowledge list below: a glossary
    // explanation may span several lines (the example campaign has one), so a
    // 400 would make such a glossary unsavable. `promptInline` (store/read.ts)
    // flattens them for the prompt instead — the defence that does not lose
    // data.
    entries.push({ term: item.term, explanation: item.explanation ?? "" });
  }
  return c.json(await writeGlossary(c.req.param("campaign"), entries, requireRev(body.rev)));
});

// PUT /api/campaigns/:campaign/knowledge { entries: [{ kind, from?, to?, text? }], rev }
//   -> { entries, rev }
// The knowledge list's write, with the glossary's contract to the letter:
// the whole list, the array order IS the order, `rev` guards it and a stale
// one is a 409 `rev_conflict` carrying the current `rev`. Same page, same
// rules. It carries no `entry`, because the knowledge base has no entry
// address of its own — the list itself is the resource.
//
// A `naming` entry's pair may be HALF-FILLED here on purpose — that is a
// convention the DM has not finished typing, and refusing the save would
// lose the rest of the list with it. The prompt skips incomplete rules
// instead (store/read.ts knowledgeText), which is where a half rule could do
// damage.
//
// An entry's fields must be SINGLE LINE (400 otherwise): an entry becomes
// ONE bullet of the generator prompt, and a newline would let it open lines
// — headings, even — of its own. The glossary keeps taking wrapped
// explanations and is flattened for the prompt instead.
api.put("/campaigns/:campaign/knowledge", async (c) => {
  const body = await jsonBody(c, ["entries", "rev"]);
  const raw = body.entries;
  if (!Array.isArray(raw)) throw new ApiError(400, "entries must be an array");
  const entries: KnowledgeEntry[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) throw new ApiError(400, "each entry must be an object");
    if (!isKnowledgeKind(item.kind)) {
      throw new ApiError(400, `each entry needs a kind of ${KNOWLEDGE_KINDS.join(", ")}`);
    }
    const str = (key: "from" | "to" | "text"): string => {
      const value = item[key];
      if (value === undefined || value === null) return "";
      if (typeof value !== "string") throw new ApiError(400, `${key} must be a string`);
      return requireSingleLine(value, key);
    };
    entries.push({ kind: item.kind, from: str("from"), to: str("to"), text: str("text") });
  }
  return c.json(await writeKnowledge(c.req.param("campaign"), entries, requireRev(body.rev)));
});

// --- creating content ---------------------------------------------------------------
//
// Five POSTs, one shape: the DM types a NAME, the server derives the id with
// the shared slug rule (@grimoire/shared/slug) and answers with the created
// ENTRY — the same `EntryResponse` every other write returns, so the app can
// navigate straight into it. A taken id is
// `409 { code: "slug_taken", id, suggestion, path }`; a name that yields no
// slug at all is a 400 that says so (store/write.ts explains why neither is
// silently resolved). Every one of them also accepts an explicit `id` — that
// exists for ONE flow: taking the 409's `suggestion` in one click instead of
// making the DM invent another name.

/** The one required free-text field of a create body: trimmed, non-empty. */
function requiredText(v: unknown, what: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new ApiError(400, `${what} must be a non-empty string`);
  }
  return v.trim();
}

/** An optional free-text field: undefined when absent, null or blank. */
function optionalText(v: unknown, what: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ApiError(400, `${what} must be a string`);
  return v.trim() === "" ? undefined : v.trim();
}

// POST /api/campaigns { name, description? } -> 201 CampaignSummary
// The cold start (an empty instance is the normal first boot):
// this is the only create that does not live under a campaign.
api.post("/campaigns", async (c) => {
  const body = await jsonBody(c, ["name", "description", "id"]);
  const name = requiredText(body.name, "name");
  const description = optionalText(body.description, "description");
  return c.json(await createCampaign(name, description, optionalText(body.id, "id")), 201);
});

// POST /api/campaigns/:campaign/chapters { title, goal? } -> 201 EntryResponse
// `goal` lands under `## Ziel des Kapitels` — the heading the chapter
// overview reads its goal line from.
api.post("/campaigns/:campaign/chapters", async (c) => {
  const body = await jsonBody(c, ["title", "goal", "id"]);
  const title = requiredText(body.title, "title");
  const goal = optionalText(body.goal, "goal");
  return c.json(
    await createChapter(c.req.param("campaign"), title, goal, optionalText(body.id, "id")),
    201,
  );
});

// POST /api/campaigns/:campaign/chapters/:id/active -> EntryResponse of that chapter
// The active state in the chapter overview's status control: the chapter becomes
// `active` and the one that was active goes back to `planned`, in ONE
// transaction — two calls from the app would leave a window with two active
// chapters, and the session view picks the first it finds. Idempotent, 404
// for an unknown chapter, no rev guard (store/write.ts explains why).
api.post("/campaigns/:campaign/chapters/:id/active", async (c) =>
  c.json(await setActiveChapter(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/scenes { title, chapter } -> 201 EntryResponse
// `chapter` is required and must exist (400) — a scene's chapter is part of
// its address, and chapters are never created by being named (ADR #19).
api.post("/campaigns/:campaign/scenes", async (c) => {
  const body = await jsonBody(c, ["title", "chapter", "id"]);
  const title = requiredText(body.title, "title");
  const chapter = requiredText(body.chapter, "chapter");
  return c.json(
    await createScene(c.req.param("campaign"), title, chapter, optionalText(body.id, "id")),
    201,
  );
});

// POST /api/campaigns/:campaign/npcs { name } -> 201 EntryResponse
// An EMPTY entry for the derived id — one the DM created and left empty — is
// FILLED instead of colliding; an entry with content answers 409. A RESERVED
// id answers 409 { code: "slug_reserved" } — same shape, different
// sentence.
api.post("/campaigns/:campaign/npcs", async (c) => {
  const body = await jsonBody(c, ["name", "id"]);
  const name = requiredText(body.name, "name");
  return c.json(
    await createNpc(c.req.param("campaign"), name, optionalText(body.id, "id")),
    201,
  );
});

// POST /api/campaigns/:campaign/locations { name } -> 201 EntryResponse (same rules)
api.post("/campaigns/:campaign/locations", async (c) => {
  const body = await jsonBody(c, ["name", "id"]);
  const name = requiredText(body.name, "name");
  return c.json(
    await createLocation(c.req.param("campaign"), name, optionalText(body.id, "id")),
    201,
  );
});

// --- review-action endpoints --------------------------------------------------------

/** One id as sent by the review UI: a non-empty single-line string. */
function reviewId(v: unknown, what: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new ApiError(400, `${what} must be a non-empty string`);
  }
  if (v.includes("\n") || v.includes("\r")) {
    throw new ApiError(400, `${what} must be a single line`);
  }
  return v;
}

// POST /api/campaigns/:campaign/review/seen { sessionId, logId }
//   -> SessionResponse
// Marks ONE log row as reviewed. `reviewed` is a flag on the row, and `logId`
// is the row's own id — `SessionLogEntry.id`, which the review read out of the
// log it is showing.
//
// Idempotent: a row that already carries the flag comes back unchanged and
// nothing is written, so the session's `rev` stands. 404 when the campaign has
// no such session, and 404 when that session has no row with this id — the
// caller sends back an id it was given, so a miss is the session having moved
// on, which a 200 that changed nothing would hide.
api.post("/campaigns/:campaign/review/seen", async (c) => {
  const body = await jsonBody(c, ["sessionId", "logId"]);
  return c.json(
    await markLogLineSeen(
      c.req.param("campaign"),
      reviewId(body.sessionId, "sessionId"),
      reviewId(body.logId, "logId"),
    ),
  );
});

// POST /api/campaigns/:campaign/review/thread { chapter, text } -> EntryResponse
// Appends `- [ ] text` under ## Offene Fäden of the chapter entry
// (section created when missing; 404 when the chapter is missing).
api.post("/campaigns/:campaign/review/thread", async (c) => {
  const body = await jsonBody(c, ["chapter", "text"]);
  if (typeof body.chapter !== "string") throw new ApiError(400, "chapter must be a string");
  const text = normalizeLineText(body.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  return c.json(await appendThreadToChapter(c.req.param("campaign"), body.chapter, text));
});

// POST /api/campaigns/:campaign/review/npc-stub { id, name?, note? } -> EntryResponse
// Creates the npc entry (status: unknown) — or, when the id already has one,
// answers with THAT entry: the caller's goal is "this id has an
// entry", so the call is idempotent. An entry that holds content is never
// overwritten; an EMPTY one — created and never filled in — is filled in.
api.post("/campaigns/:campaign/review/npc-stub", async (c) => {
  const body = await jsonBody(c, ["id", "name", "note"]);
  if (typeof body.id !== "string") throw new ApiError(400, "id must be a string");
  let name: string | undefined;
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== "string") throw new ApiError(400, "name must be a string");
    name = normalizeLineText(body.name); // empty after trim -> default (the id)
  }
  let note: string | undefined;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") throw new ApiError(400, "note must be a string");
    note = normalizeLineText(body.note); // empty after trim -> no note line
  }
  return c.json(await createNpcStub(c.req.param("campaign"), body.id, name, note));
});

// POST /api/campaigns/:campaign/review/inbox-done { id } -> InboxResponse
// Ticks ONE idea off — the single documented exception to the inbox's
// append-only rule, so a harvested idea does not come back in every future
// review. `id` is the row's own id (`InboxEntry.id`).
//
// Idempotent: an idea already done comes back unchanged and the list's `rev`
// stands. 404 when the inbox has no row with that id.
api.post("/campaigns/:campaign/review/inbox-done", async (c) => {
  const body = await jsonBody(c, ["id"]);
  return c.json(await markInboxLineDone(c.req.param("campaign"), reviewId(body.id, "id")));
});

/** One `{ key: value }` map out of a review patch body, value-checked. */
function reviewRecord<T>(
  value: unknown,
  label: string,
  check: (v: unknown) => v is T,
): Record<string, T> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, `${label} must be an object`);
  }
  const out: Record<string, T> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!check(item)) throw new ApiError(400, `${label}.${key} has an unusable value`);
    out[key] = item;
  }
  return out;
}

/**
 * One draft edit of a review patch: the halves the DM changed. `properties`
 * replaces that draft's whole properties object, `body` its whole body, and
 * an entry that carries neither half is nothing to store — see DraftEdit.
 */
const isDraftEdit = (v: unknown): v is DraftEdit => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const raw = v as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "properties" && key !== "body") return false;
  }
  const properties = raw.properties;
  if (
    properties !== undefined &&
    (properties === null || typeof properties !== "object" || Array.isArray(properties))
  ) {
    return false;
  }
  if (raw.body !== undefined && typeof raw.body !== "string") return false;
  return properties !== undefined || raw.body !== undefined;
};
/** A field/block decision, or `null` for no decision any more. */
const isDecidedFlag = (v: unknown): v is boolean | null => v === null || typeof v === "boolean";
/** `null` is undecided again — the review's third state. */
const isDecision = (v: unknown): v is "accepted" | "rejected" | null =>
  v === null || v === "accepted" || v === "rejected";

// --- generator endpoints ------------------------------------------------------------

// POST /api/campaigns/:campaign/generate { chapter, sourceText, newChapter?,
//                                chapterTitle? } ->
// 202 { jobId }. Starts a BACKGROUND job and returns
// immediately; the result is picked up via GET …/generate/job. Writes
// NOTHING (generator/README.md).
//
// Everything cheap stays a synchronous answer, BEFORE a job exists — a
// request error must not turn into a failed job the DM has to go and read:
// 400 for a malformed body/unsafe chapter id, 404 for an unknown
// campaign/chapter (unless newChapter marks the app's new-chapter flow,
// where the directory is created on apply), 503 when no provider is
// configured (e.g. ANTHROPIC_API_KEY missing). 409 { error, jobId } while a
// job for this campaign is still running — one job per campaign.
// The run's own outcome (incl. the 422 of a truncated or invalid reply)
// lands in the job.
//
// `chapterTitle` belongs to a `newChapter` run and is stored ON the job: the
// accept step must not read the title out of the browser, because the
// browser's copy does not survive a navigation or a reload — and the chapter
// would go with it. Optional, so a client that omits it still starts runs;
// the accept then falls back to the chapter id.
api.post("/campaigns/:campaign/generate", async (c) => {
  const body = await jsonBody(c, ["chapter", "sourceText", "newChapter", "chapterTitle"]);
  const campaign = c.req.param("campaign");
  const chapter = body.chapter;
  const sourceText = body.sourceText;
  const newChapter = body.newChapter;
  const chapterTitle = optionalText(body.chapterTitle, "chapterTitle");
  if (typeof chapter !== "string" || chapter.trim() === "") {
    throw new ApiError(400, "chapter must be a non-empty string");
  }
  if (typeof sourceText !== "string" || sourceText.trim() === "") {
    throw new ApiError(400, "sourceText must be a non-empty string");
  }
  if (newChapter !== undefined && typeof newChapter !== "boolean") {
    throw new ApiError(400, "newChapter must be a boolean");
  }
  await assertGenerateTarget(campaign, chapter, newChapter === true); // 400/404
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "scene",
    campaign,
    chapter,
    sourceText,
    newChapter: newChapter === true,
    ...(newChapter === true && chapterTitle !== undefined ? { newChapterTitle: chapterTitle } : {}),
    provider,
  });
  return c.json({ jobId: job.id }, 202);
});

// POST /api/campaigns/:campaign/generate/npc { sourceText, id? } -> 202 { jobId }
// One NPC entry from source material — the same background job
// model as the scene run: ONE generator job per campaign, so a start while
// ANY run (scene or npc) is going answers 409 { jobId }. Writes NOTHING.
//
// Synchronous, before a job exists: 400 for a malformed body or an id that is
// not a kebab slug, 404 for an unknown campaign, 409 { path } when the pinned
// id's entry already exists (never overwrite — enriching an existing NPC
// entry is an explicit non-goal), 503 without a configured provider.
// `id` is optional: without it the model picks the id, and a collision with
// an existing npc becomes a correction turn.
api.post("/campaigns/:campaign/generate/npc", async (c) => {
  const body = await jsonBody(c, ["sourceText", "id"]);
  const campaign = c.req.param("campaign");
  const sourceText = body.sourceText;
  if (typeof sourceText !== "string" || sourceText.trim() === "") {
    throw new ApiError(400, "sourceText must be a non-empty string");
  }
  let npcId: string | undefined;
  if (body.id !== undefined && body.id !== null) {
    if (typeof body.id !== "string") throw new ApiError(400, "id must be a string");
    npcId = body.id.trim();
    if (npcId === "") npcId = undefined; // an empty field means "model chooses"
  }
  await assertNpcGenerateTarget(campaign, npcId); // 400/404/409
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "npc",
    campaign,
    sourceText,
    ...(npcId === undefined ? {} : { npcId }),
    provider,
  });
  return c.json({ jobId: job.id }, 202);
});

// POST /api/campaigns/:campaign/generate/augment { path, sourceText?, instruction? }
// -> 202 { jobId } — the AI augment run: the same background job
// model as the two create runs, pointed at an entry that already EXISTS.
// ONE generator job per campaign, so a start while ANY run is going answers
// 409 { jobId }. Writes NOTHING; the proposal waits in the job.
//
// Synchronous, before a job exists: 400 for a malformed body, for an unsafe
// address, for a kind that has no augment prompt (only npc/location/scene),
// and when NEITHER sourceText nor instruction carries text — the dialog
// requires at least one of them; 404 for an unknown campaign/entry; 503
// without a configured provider.
api.post("/campaigns/:campaign/generate/augment", async (c) => {
  const body = await jsonBody(c, ["path", "sourceText", "instruction"]);
  const campaign = c.req.param("campaign");
  const target = body.path;
  if (typeof target !== "string" || target.trim() === "") {
    throw new ApiError(400, "path must be a non-empty string");
  }
  const sourceText = optionalText(body.sourceText, "sourceText") ?? "";
  const instruction = optionalText(body.instruction, "instruction") ?? "";
  if (sourceText === "" && instruction === "") {
    throw new ApiError(400, "sourceText or instruction is required");
  }
  await readAugmentTarget(campaign, target); // 400 unsafe/kind, 404 unknown
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "augment",
    campaign,
    target,
    sourceText,
    instruction,
    provider,
  });
  return c.json({ jobId: job.id }, 202);
});

// POST /api/campaigns/:campaign/generate/augment/apply
// { path, rev, properties?, body?, jobId? } -> the written EntryResponse.
// Accepting the reviewed proposal: the DM's chosen fields
// and the body they assembled from the accepted blocks, written in ONE
// transaction against `rev` — 409 { code: "rev_conflict", rev } when the
// entry moved underneath, and then NOTHING is written. FTS and `[[slug]]`
// reference rows follow because this is the ordinary write path; `jobId`
// discards the augment job in that same transaction.
api.post("/campaigns/:campaign/generate/augment/apply", async (c) => {
  const body = await jsonBody(c, ["path", "rev", "properties", "body", "jobId"]);
  const jobId = body.jobId;
  if (jobId !== undefined && typeof jobId !== "string") {
    throw new ApiError(400, "jobId must be a string");
  }
  return c.json(await applyAugment(c.req.param("campaign"), body, jobId));
});

// PATCH /api/campaigns/:campaign/generate/job/:id/review { rev, edits?, entries?,
// dropped?, fields?, blocks? } -> the job.
// The review state of a run lives ON THE JOB: the edited halves per draft
// (`{ "<path>": { properties?, body? } }`), the decision per suggested
// entry, the dropped scenes and
// (for an augment run) the decision per property/block. Everything merges,
// so the app sends the ONE thing that just changed — text debounced,
// decisions immediately.
//
// `rev` is the job's review rev as the client read it: a second tab that
// decided first makes this a 409 { code: "rev_conflict", rev } and nothing
// is written — the app reloads the state instead of silently winning.
// 404 when the campaign has no job, or when :id names a different one (a
// patch for a replaced run must not land on its successor).
api.patch("/campaigns/:campaign/generate/job/:id/review", async (c) => {
  const body = await jsonBody(c, ["rev", "edits", "entries", "dropped", "fields", "blocks"]);
  const rev = body.rev;
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) {
    throw new ApiError(400, "rev must be a non-negative integer");
  }
  const patch: ReviewPatch = {};
  if (body.edits !== undefined) patch.edits = reviewRecord(body.edits, "edits", isDraftEdit);
  if (body.entries !== undefined) {
    patch.entries = reviewRecord(body.entries, "entries", isDecision);
  }
  if (body.dropped !== undefined) {
    if (!Array.isArray(body.dropped) || body.dropped.some((v) => typeof v !== "string")) {
      throw new ApiError(400, "dropped must be an array of strings");
    }
    patch.dropped = body.dropped as string[];
  }
  if (body.fields !== undefined) patch.fields = reviewRecord(body.fields, "fields", isDecidedFlag);
  if (body.blocks !== undefined) patch.blocks = reviewRecord(body.blocks, "blocks", isDecidedFlag);
  const job = await patchJobReview(c.req.param("campaign"), c.req.param("id"), rev, patch);
  return c.json(serializeJob(job));
});

// POST /api/campaigns/:campaign/generate/job/:id/accept
// { paths?, chapter?, chapterTitle? } -> { written, jobDeleted }
// The single-accept action per scene / per suggested entry, and the
// accept-all action for the rest. `paths` selects scene draft paths
// and suggested-entry addresses (`npcs/grella`); without it EVERY part that
// is still open is written — a dropped scene and a rejected entry are not
// open, so the bulk action never resurrects a "no".
//
// One transaction with the ordinary draft write: the conflict check lives
// inside it (409 { conflicts }), FTS and reference rows follow, and the
// job records what was written in that same commit. The job row disappears
// the moment nothing is left open (`jobDeleted`). `rev` is the review rev
// the client read and is re-checked inside that transaction: a decision
// made in between is a 409 `rev_conflict` and nothing is written. 404
// without a job or for a stale :id, 409 for a job that has no result, 400
// for an unknown path and for a BULK accept with nothing left to do. A
// named selection that is already written is not an error — a double click
// gets 200 with an empty `written`.
//
// A RUNNING pipelined run is acceptable part by part: it
// stays `running` while parts are open, and a `done` part is in the result
// and therefore acceptable before its siblings are. The 409 "no result" is
// kept for a failed run, and for a run that has not finished a single part.
api.post("/campaigns/:campaign/generate/job/:id/accept", async (c) => {
  const body = await jsonBody(c, ["rev", "paths", "chapter", "chapterTitle"]);
  const rev = requireRev(body.rev);
  return c.json(await acceptJobParts(c.req.param("campaign"), c.req.param("id"), rev, body));
});

// POST /api/campaigns/:campaign/generate/job/:id/parts/:key/retry -> the job (202)
// The retry action for ONE part of a pipelined scene run.
// Only that part is re-run: the outline stays, the finished parts stay
// reviewable and acceptable, and the retried part goes back through exactly
// the call it failed on — same outline, same source excerpt, same
// validation. The answer is the job with the part back in `running`, so the
// app needs no extra read before its next poll.
//
// 404 without a job, for a stale :id and for an unknown part key; 409 for a
// job that has no pipeline (a single-call npc/augment run) and for a part
// that is already running, has not run yet (`pending` — the run's own queue
// still owns it) or is already done — a double click must not spend tokens
// twice; 503 when no provider is configured.
api.post("/campaigns/:campaign/generate/job/:id/parts/:key/retry", async (c) => {
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await retryJobPart(
    c.req.param("campaign"),
    c.req.param("id"),
    c.req.param("key"),
    provider,
  );
  return c.json(serializeJob(job), 202);
});

// GET /api/campaigns/:campaign/generate/job -> GenerateJob (404 when there is none).
// The job carries its status (running/done/failed) with `kind`,
// result/npcResult/augmentResult, the error body and the review edits; an
// `augment` job also carries `target` — the entry's address — from the
// moment it STARTS. A finished result may carry `namingHints`: the SERVER's
// own findings that a draft still spells something a naming convention
// replaces — hints for the review, never a reason to fail or block. And it
// carries the REVIEW STATE with that state's `rev`: the decision per
// suggested entry, the dropped scenes, the per field/block decisions of an
// augment run and the parts a partial accept already wrote
// (`review.written`, draft path -> the address it landed at).
// The campaign is NOT re-validated here: the job store is the authority for
// this endpoint, and "no job" is the honest answer for an unknown campaign
// too. Polled by the generator route while a job runs (~3s) and once per
// campaign mount by the topbar's run indicator.
api.get("/campaigns/:campaign/generate/job", async (c) => {
  const job = await getJob(c.req.param("campaign"));
  if (job === undefined) throw new ApiError(404, "no generate job for this campaign");
  return c.json(serializeJob(job));
});

// DELETE /api/campaigns/:campaign/generate/job -> { deleted: true } ("Verwerfen").
// Works for every status — a running job is abandoned, its result never
// lands (see finish() in generate-jobs.ts). 404 when there is none.
api.delete("/campaigns/:campaign/generate/job", async (c) => {
  if (!(await deleteJob(c.req.param("campaign")))) {
    throw new ApiError(404, "no generate job for this campaign");
  }
  return c.json({ deleted: true });
});

// POST /api/campaigns/:campaign/generate/apply
// { scenes?, stubs?, npc?, chapter?, chapterTitle?, jobId? } -> { written }
// Writes the reviewed drafts — synchronous on purpose: this is a short
// write, and the DM waits for its result. Every draft is
// `{ path, properties, body }` (a stub `{ kind, id, name, properties, body }`)
// and is re-validated server-side (status draft, safe paths, the id matching
// the address); 409 { conflicts } when any
// target entry exists — then nothing is written at all. chapter +
// chapterTitle (both or neither) additionally create the chapter entry
// when it is missing, in the same all-or-nothing batch (the app's
// new-chapter flow).
// `jobId` ties the apply to the background job it came from: a
// SUCCESSFUL apply discards that job — the drafts are stored, there is
// nothing left to restore. A stale id (a newer run started meanwhile) is
// ignored rather than dropping the wrong job. That discard is
// part of the write TRANSACTION (store/write.ts applyDrafts), so drafts and
// job can never disagree after a crash.
// `npc` is the NPC generator's one draft — deliberately the SAME
// endpoint: it needs exactly the same all-or-nothing write, the same 409 and
// the same job cleanup, and re-validates server-side just like a scene.
api.post("/campaigns/:campaign/generate/apply", async (c) => {
  const body = await jsonBody(c, ["scenes", "stubs", "npc", "chapter", "chapterTitle", "jobId"]);
  const campaign = c.req.param("campaign");
  const jobId = body.jobId;
  if (jobId !== undefined && typeof jobId !== "string") {
    throw new ApiError(400, "jobId must be a string");
  }
  const written = await applyGenerated(campaign, body, jobId);
  return c.json(written);
});
