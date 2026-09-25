// The suite's own `test` — every test gets:
//
//   - its OWN database: a fresh, empty GRIMOIRE_DATA directory, seeded by
//     `grimoire seed <fixtures dir>` BEFORE the server starts. The boot reads
//     no fixtures, so the CLI is the only seeding path
//   - its OWN server process on its own port, serving the built app and /api,
//     with LLM_PROVIDER=openai pointing at the run's stub endpoint
//   - `baseURL` wired to that server, so page.goto("/") hits it
//   - an `api` helper against that server, and a `db` helper that opens the
//     test's `grimoire.db` with the server's own driver layer
//
// The database is the only truth (ADR #13): nothing writes campaign content
// to disk, so there is nothing next to the server to read an assertion back
// from. Every claim about stored state goes through the API or, where a spec
// really means storage, through `db`.
//
// The FIXTURES are therefore only an INPUT, read exactly once per test — by
// that seed run. `fixtures/beispiel/*.json` holds one entry per fixture file in the
// shape the API speaks, and a test that needs content the example campaign
// does not have overrides the fixtures in its own copy of that directory:
//
//   test.use({ seed: { entries: { "scene-loot": { kind: "scene", … } } } });
//   test.use({ seed: { without: ["session-2026-01-15"] } });
//
// The keys are FIXTURE FILE STEMS, not addresses: a stem that already exists
// in `fixtures/beispiel` REPLACES that entry, any other stem adds one. The
// address an entry gets is the server's decision (`server/src/store/paths.ts`
// — a scene's segments are its chapter, its location and its id). An npc and
// a location are each their own resource (ADR #31): their stems are
// `npcs/<id>` and `locations/<id>`, and the fixture is the npc or the
// location itself, every field flat, without a guard.
//
// Without overrides the pristine copy from the global setup is used directly
// (it is never written to), so most tests copy nothing at all.
//
// And a test that needs an EMPTY INSTANCE — no campaign whatsoever, which is
// what a fresh installation is — turns the seed run off:
//
//   test.use({ seed: { skip: true } });
//
// That is the starting point of critical path 10 ("Kaltstart"). The `api`
// fixture is bound to the example campaign's id, so a spec that creates its
// own campaign builds its helper with `apiFor(server.url, id)`.
//
// One server per test instead of one per worker: the server holds state the
// tests care about (the in-memory generate job) and half the paths write to
// the database — a fresh process on a fresh database is the only isolation
// that needs no cleanup discipline. Seed plus boot costs ~0.4s.
//
// Ports are deterministic per worker (base + slot) instead of "ask the OS for
// a free one": with several workers, two simultaneous lookups can hand out the
// same port. A busy port is retried on the next slot.

import { execFile } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { test as base, expect } from "@playwright/test";

import { openSqlite, type SqliteClient } from "../../server/src/db/driver";
import {
  APP_DIST,
  BUN,
  CAMPAIGN,
  CLI_ENTRY,
  SERVER_ENTRY,
  REPO_ROOT,
  pristineDir,
  runDir,
  stubLlmBaseUrl,
} from "./paths";
import { startProcess, waitForHttp, type ManagedProcess } from "./procs";

const run = promisify(execFile);

/** First port of the E2E range; each worker owns PORTS_PER_WORKER of them. */
const PORT_BASE = 3200;
const PORTS_PER_WORKER = 40;

/** Per-worker counter (module state is per worker process). */
let slot = 0;

export interface ServerHandle {
  /** e.g. http://localhost:3200 — the app AND /api live here. */
  url: string;
  /** GRIMOIRE_DATA of this server (holds grimoire.db and its companions). */
  dataDir: string;
  /** The `grimoire.db` this server booted on. */
  dbFile: string;
  /** The fixtures directory `grimoire seed` read (an INPUT, never written). */
  fixturesDir: string;
}

/**
 * One entry as a fixture file holds it — the shape `grimoire seed` reads and
 * the shape the API speaks. Structural on purpose: the suite drives the
 * server as a process and never imports its types.
 */
export type SeedEntry =
  | {
      kind: "campaign" | "scene";
      properties: Record<string, unknown>;
      body?: string;
    }
  | {
      kind: "chapter";
      properties: Record<string, unknown>;
      body?: string;
      /** The chapter's open threads — ROWS beside the entry, never text in it. */
      threads?: { text: string; done?: boolean }[];
    }
  | {
      kind: "session";
      properties: Record<string, unknown>;
      /** Log ROWS — time, scene and text as columns, never a markdown line. */
      log?: { at: string; sceneId?: string; text: string; reviewed?: boolean }[];
      body?: string;
    }
  | {
      kind: "inbox";
      entries: { text: string; done?: boolean }[];
    }
  | {
      kind: "glossary";
      intro?: string;
      entries: { term: string; explanation: string }[];
    };

/**
 * One location as its fixture holds it (`locations/<id>.json`) — every field
 * flat, `body` among them, no guard (ADR #31).
 */
export interface SeedLocation {
  id: string;
  name: string;
  chapter?: string;
  roll20Page?: string;
  atmosphere?: string;
  body: string;
}

/**
 * One npc as its fixture holds it (`npcs/<id>.json`) — every field flat,
 * `body` among them, no guard (ADR #31).
 */
export interface SeedNpc {
  id: string;
  name: string;
  role?: string;
  chapter?: string;
  status: "alive" | "dead" | "missing" | "unknown";
  statblock?: string;
  quickstats?: Record<string, string | number>;
  voice?: string;
  appearance?: string;
  motivation?: string;
  body: string;
}

/** What a test changes about the fixtures its database is seeded from. */
export interface Seed {
  /**
   * fixture file stem -> entry; a stem that exists in fixtures/beispiel
   * REPLACES it. An npc's stem is `npcs/<id>`, a location's `locations/<id>`.
   */
  entries?: Record<string, SeedEntry | SeedNpc | SeedLocation>;
  /** fixture file stems to leave out, e.g. "session-2026-01-15" */
  without?: string[];
  /**
   * NO SEED AT ALL — `test.use({ seed: { skip: true } })`.
   *
   * The server boots on an empty data directory and the CLI never runs, so
   * the instance has no campaign: exactly what a fresh installation is, and
   * the only honest starting point for the cold-start path (critical path
   * 10). Everything else about the fixture is unchanged — the `api` and `db`
   * helpers work, they just have nothing to look at until the test creates
   * it.
   *
   * `entries`/`without` are meaningless with it and are ignored: there is no
   * seed run for them to feed.
   */
  skip?: boolean;
}

/** One entry as GET /api/campaigns/:campaign/entries/<address> answers it. */
export interface ApiEntry {
  path: string;
  kind: string;
  properties: Record<string, unknown>;
  body: string;
  /** The row version (`rev`) — an opaque guard token. */
  rev: number;
}

/**
 * One location as GET /api/campaigns/:campaign/locations/:id answers it —
 * its own resource (ADR #31): every field flat, `body` among them, beside
 * its guard.
 */
export interface ApiLocation {
  id: string;
  name: string;
  chapter?: string;
  roll20Page?: string;
  atmosphere?: string;
  body: string;
  rev: number;
}

/**
 * One npc as GET /api/campaigns/:campaign/npcs/:id answers it — its own
 * resource (ADR #31): every field flat, `body` among them, beside its guard.
 */
export interface ApiNpc {
  id: string;
  name: string;
  role?: string;
  chapter?: string;
  status: string;
  statblock?: string;
  quickstats?: Record<string, string | number>;
  voice?: string;
  appearance?: string;
  motivation?: string;
  body: string;
  rev: number;
}

/** One log row of a session — columns, never a markdown line (ADR #26). */
export interface ApiLogEntry {
  /** The row's stable id — what `POST /review/seen` names the line by. */
  id: string;
  at: string;
  sceneId?: string;
  text: string;
  reviewed: boolean;
}

/**
 * ONE SESSION as every session endpoint answers it. A session has no address
 * and no `properties` map: it is a table, so its log, its pauses and its
 * played scenes come back as rows and lists.
 */
export interface ApiSession {
  id: string;
  started: string;
  startedMs?: number;
  ended?: string;
  endedMs?: number;
  pauses: { from: string; fromMs?: number; to?: string; toMs?: number }[];
  log: ApiLogEntry[];
  scenesPlayed: string[];
  /** Guard token of the session row. */
  rev: number;
}

/** The identifying head of a session, as `GET …/sessions` lists it. */
export interface ApiSessionSummary {
  id: string;
  started: string;
  startedMs?: number;
  ended?: string;
  endedMs?: number;
}

/** The ideas as `GET …/inbox` answers them: rows plus the list's guard token. */
export interface ApiInbox {
  entries: { id: string; text: string; done: boolean }[];
  rev: number;
}

/**
 * A chapter's open threads as `GET …/chapters/:chapter/threads` answers them:
 * rows plus the LIST's guard token — not the chapter entry's `rev`.
 */
export interface ApiThreads {
  entries: { id: string; text: string; done: boolean }[];
  rev: number;
}

/**
 * Typed access to the test's own server: the database is the truth, and the
 * API is how one looks at it — the same way the app does.
 */
export interface Api {
  /** Absolute URL of an API path (`/api/campaigns/beispiel/tree` or just `tree`). */
  url(apiPath: string): string;
  /** Raw fetch — for status-code assertions (409, 400, 404). */
  fetch(apiPath: string, init?: RequestInit): Promise<Response>;
  /** GET, parsed as JSON; throws with the body on a non-2xx answer. */
  get<T>(apiPath: string): Promise<T>;
  /** POST/PATCH/PUT with a JSON body, parsed as JSON; throws on non-2xx. */
  send<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", apiPath: string, body?: unknown): Promise<T>;
  /** GET the entry at an address; throws when it is unknown. */
  entry(rel: string): Promise<ApiEntry>;
  /** The markdown text of an entry. */
  body(rel: string): Promise<string>;
  /** The properties of an entry. */
  properties(rel: string): Promise<Record<string, unknown>>;
  /** Whether the address names an existing row (404 = no). */
  exists(rel: string): Promise<boolean>;
  /** GET one npc from its own resource; throws when it is unknown. */
  npc(id: string): Promise<ApiNpc>;
  /** Whether the campaign has an npc with that id (404 = no). */
  npcExists(id: string): Promise<boolean>;
  /** The request path of an npc (or, without an id, of the npc list). */
  npcPath(id?: string): string;
  /**
   * Create an npc: POST the list with `{ name, id?, body? }`; throws on a
   * non-2xx answer (a taken id is a 409 — `api.fetch` asserts that one).
   */
  createNpc(request: { name: string; id?: string; body?: string }): Promise<ApiNpc>;
  /**
   * The ONE write of an npc: PATCH its resource with `rev` and any subset of
   * its fields, `body` among them. Omitted, `rev` is read first — the helper
   * then plays the second writer.
   */
  patchNpc(
    id: string,
    change: { rev?: number; force?: boolean } & Record<string, unknown>,
  ): Promise<ApiNpc>;
  /** GET one location from its own resource; throws when it is unknown. */
  location(id: string): Promise<ApiLocation>;
  /** Whether the campaign has a location with that id (404 = no). */
  locationExists(id: string): Promise<boolean>;
  /** The request path of a location (or, without an id, of the location list). */
  locationPath(id?: string): string;
  /**
   * The ONE write of a location: PATCH its resource with `rev` and any subset
   * of its fields, `body` among them. Omitted, `rev` is read first — the
   * helper then plays the second writer.
   */
  patchLocation(
    id: string,
    change: { rev?: number; force?: boolean } & Record<string, unknown>,
  ): Promise<ApiLocation>;
  /**
   * The ACTIVE session — or, with `includeEnded`, the last started one.
   * `undefined` when the campaign has no such session: the endpoint answers
   * 200 with a `null` body, because "nothing runs" is an ordinary state.
   *
   * A session id the app starts is an opaque random string, so no spec can
   * spell one out: "the session the app just started" is a question only the
   * server can answer, and this asks it.
   */
  activeSession(includeEnded?: boolean): Promise<ApiSession | undefined>;
  /** Id of the active session (see `activeSession`), or undefined. */
  sessionId(includeEnded?: boolean): Promise<string | undefined>;
  /** ONE session by its id; throws when the id names none (404). */
  session(id: string): Promise<ApiSession>;
  /** Whether a session with that id exists (404 = no). */
  sessionExists(id: string): Promise<boolean>;
  /** Every session of the campaign, newest first. */
  sessions(): Promise<ApiSessionSummary[]>;
  /** The ideas with the list's guard token. */
  inbox(): Promise<ApiInbox>;
  /** A chapter's open threads with the list's guard token. */
  threads(chapter: string): Promise<ApiThreads>;
  /** The request path of a chapter's thread list, or of one row in it. */
  threadsPath(chapter: string, id?: string): string;
  /**
   * The ONE write path of an entry: PATCH the address with `rev` and at least
   * one of `properties` and `body` (ADR #23). Fields and text together are one
   * write against one `rev`. `force` writes the given fields on top of the row
   * as it stands instead of refusing a stale `rev`.
   *
   * Pass `rev` to write against a token the spec already holds — that is how a
   * test writes with the SAME token an editing surface is holding. Omitted, the
   * helper reads the current token first and so plays the second writer.
   */
  patchEntry(
    rel: string,
    change: {
      rev?: number;
      properties?: Record<string, unknown>;
      body?: string;
      force?: boolean;
    },
  ): Promise<ApiEntry>;
  /**
   * Replace the body with a FRESH guard token: a second writer, not a race.
   * Returns the new token. This is how a spec provokes the app's 409 — an entry
   * only ever changes through the API.
   */
  writeBody(rel: string, body: string): Promise<number>;
  /** Set properties with a fresh guard token; returns the new token. */
  patchProperties(rel: string, patch: Record<string, unknown>): Promise<number>;
}

/** Read access to the test's database, with the server's own driver. */
export interface Db {
  /** Rows of a query, as plain objects. */
  all(sql: string, ...params: (string | number | null)[]): Record<string, unknown>[];
  /** The first row, or undefined. */
  one(sql: string, ...params: (string | number | null)[]): Record<string, unknown> | undefined;
  /** `meta` as a plain record. */
  meta(): Record<string, string>;
}

interface Fixtures {
  seed: Seed;
  fixturesDir: string;
  dataDir: string;
  server: ServerHandle;
  api: Api;
  db: Db;
}

/**
 * Load a fixtures directory into `dataDir`'s database with the real CLI —
 * `grimoire seed <fixtures dir>`, the documented dev/E2E tool. The server
 * reads no fixtures at boot, so this is what puts the fixture campaign into a
 * test's database.
 */
export async function seedCampaigns(fixturesDir: string, dataDir: string): Promise<string> {
  try {
    const { stdout } = await run(BUN, [CLI_ENTRY, "seed", fixturesDir], {
      cwd: REPO_ROOT,
      env: { ...process.env, GRIMOIRE_DATA: dataDir },
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`e2e: grimoire seed ${fixturesDir} failed\n${detail}`);
  }
}

/**
 * Start ONE real server process on `dataDir` (GRIMOIRE_DATA). `fixturesDir`
 * is recorded on the handle only — the boot never reads it; seed with
 * `seedCampaigns` first when the test needs content.
 *
 * Exported because the seed spec needs boots of its own on data directories
 * the per-test `server` fixture cannot express.
 */
export async function startGrimoireServer(
  fixturesDir: string,
  dataDir: string,
  workerIndex: number,
): Promise<{ handle: ServerHandle; proc: ManagedProcess }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = PORT_BASE + workerIndex * PORTS_PER_WORKER + (slot++ % PORTS_PER_WORKER);
    const proc = startProcess({
      command: BUN,
      args: [SERVER_ENTRY],
      cwd: REPO_ROOT,
      label: `server:${port}`,
      env: {
        PORT: String(port),
        // The only truth (ADR #13) — the boot reads nothing else.
        GRIMOIRE_DATA: dataDir,
        APP_DIST,
        // The provider path runs for real — only the endpoint is canned.
        LLM_PROVIDER: "openai",
        LLM_BASE_URL: stubLlmBaseUrl(),
        LLM_MODEL: "grimoire-e2e-stub",
        // Pinned: a failing run must take exactly two calls, never more.
        LLM_CORRECTION_TURNS: "1",
      },
    });
    try {
      // localhost (not 127.0.0.1): it is a SECURE CONTEXT, so the browser
      // APIs that require one — the callout's copy button reaches for
      // `navigator.clipboard` — behave as they do in production.
      const url = `http://localhost:${port}`;
      await waitForHttp(`${url}/api/campaigns`, proc, `server:${port}`, 20_000);
      return {
        proc,
        handle: { url, dataDir, dbFile: path.join(dataDir, "grimoire.db"), fixturesDir },
      };
    } catch (err) {
      lastError = err;
      await proc.stop();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * The date-shaped id of a session a spec SEEDS itself.
 *
 * NOT the id of a session the app starts: those are opaque random strings and
 * only the server knows them (`api.sessionId`). A date-shaped id stays
 * perfectly legal, which is why a seeded session may spell one.
 */
export function todaySessionId(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The API path of one entry: the address sits in the path, one encoded
 * segment per address segment (ADR #22).
 */
function entriesPath(campaign: string, rel: string): string {
  const address = rel.split("/").map(encodeURIComponent).join("/");
  return `campaigns/${encodeURIComponent(campaign)}/entries/${address}`;
}

/** The API path of ONE session — its own endpoint, not an entry address. */
function sessionsPath(campaign: string, id: string): string {
  return `campaigns/${encodeURIComponent(campaign)}/sessions/${encodeURIComponent(id)}`;
}

/** The `api` helper for any server URL (the fixture is this, bound). */
export function apiFor(baseUrl: string, campaign: string = CAMPAIGN): Api {
  const url = (apiPath: string) =>
    apiPath.startsWith("http")
      ? apiPath
      : `${baseUrl}/api/${apiPath.replace(/^\/?api\//, "").replace(/^\//, "")}`;

  const fetchApi = (apiPath: string, init?: RequestInit) => fetch(url(apiPath), init);

  async function json<T>(response: Response, what: string): Promise<T> {
    const text = await response.text();
    if (!response.ok) throw new Error(`${what}: HTTP ${response.status} — ${text}`);
    return JSON.parse(text) as T;
  }

  const api: Api = {
    url,
    fetch: fetchApi,
    async get<T>(apiPath: string) {
      return json<T>(await fetchApi(apiPath), `GET ${apiPath}`);
    },
    async send<T>(
      method: "POST" | "PATCH" | "PUT" | "DELETE",
      apiPath: string,
      body?: unknown,
    ) {
      const response = await fetchApi(apiPath, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return json<T>(response, `${method} ${apiPath}`);
    },
    entry(rel) {
      return api.get<ApiEntry>(entriesPath(campaign, rel));
    },
    async body(rel) {
      return (await api.entry(rel)).body;
    },
    async properties(rel) {
      return (await api.entry(rel)).properties;
    },
    async exists(rel) {
      const response = await fetchApi(entriesPath(campaign, rel));
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`GET ${rel}: HTTP ${response.status}`);
      return true;
    },
    npc(id) {
      return api.get<ApiNpc>(api.npcPath(id));
    },
    async npcExists(id) {
      const response = await fetchApi(api.npcPath(id));
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`GET npc ${id}: HTTP ${response.status}`);
      return true;
    },
    npcPath(id) {
      const base = `campaigns/${encodeURIComponent(campaign)}/npcs`;
      return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
    },
    createNpc(request) {
      return api.send<ApiNpc>("POST", api.npcPath(), request);
    },
    async patchNpc(id, change) {
      const rev = change.rev ?? (await api.npc(id)).rev;
      return api.send<ApiNpc>("PATCH", api.npcPath(id), { ...change, rev });
    },
    location(id) {
      return api.get<ApiLocation>(api.locationPath(id));
    },
    async locationExists(id) {
      const response = await fetchApi(api.locationPath(id));
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`GET location ${id}: HTTP ${response.status}`);
      return true;
    },
    locationPath(id) {
      const base = `campaigns/${encodeURIComponent(campaign)}/locations`;
      return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
    },
    async patchLocation(id, change) {
      const rev = change.rev ?? (await api.location(id)).rev;
      return api.send<ApiLocation>("PATCH", api.locationPath(id), { ...change, rev });
    },
    async activeSession(includeEnded = false) {
      const path = `campaigns/${campaign}/session${includeEnded ? "?includeEnded=1" : ""}`;
      // "Nothing runs" is a null body, not a status — so it is read as a
      // value here, exactly as the app reads it.
      return (await api.get<ApiSession | null>(path)) ?? undefined;
    },
    async sessionId(includeEnded = false) {
      return (await api.activeSession(includeEnded))?.id;
    },
    session(id) {
      return api.get<ApiSession>(sessionsPath(campaign, id));
    },
    async sessionExists(id) {
      const response = await fetchApi(sessionsPath(campaign, id));
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`GET session ${id}: HTTP ${response.status}`);
      return true;
    },
    sessions() {
      return api.get<ApiSessionSummary[]>(`campaigns/${encodeURIComponent(campaign)}/sessions`);
    },
    inbox() {
      return api.get<ApiInbox>(`campaigns/${encodeURIComponent(campaign)}/inbox`);
    },
    threads(chapter) {
      return api.get<ApiThreads>(api.threadsPath(chapter));
    },
    threadsPath(chapter, id) {
      const base = `campaigns/${encodeURIComponent(campaign)}/chapters/${encodeURIComponent(chapter)}/threads`;
      return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
    },
    async patchEntry(rel, change) {
      const rev = change.rev ?? (await api.entry(rel)).rev;
      const { properties, body, force } = change;
      return api.send<ApiEntry>("PATCH", entriesPath(campaign, rel), {
        rev,
        ...(properties === undefined ? {} : { properties }),
        ...(body === undefined ? {} : { body }),
        ...(force === undefined ? {} : { force }),
      });
    },
    async writeBody(rel, body) {
      return (await api.patchEntry(rel, { body })).rev;
    },
    async patchProperties(rel, patch) {
      return (await api.patchEntry(rel, { properties: patch })).rev;
    },
  };
  return api;
}

/** The `db` helper for an already-open client (the fixture is this, bound). */
export function dbFor(client: SqliteClient): Db {
  const db: Db = {
    all: (sql, ...params) => client.prepare(sql).all(...params),
    one: (sql, ...params) => db.all(sql, ...params)[0],
    meta: () =>
      Object.fromEntries(
        db
          .all("SELECT key, value FROM meta")
          .map((row) => [String(row.key), String(row.value ?? "")]),
      ),
  };
  return db;
}

export const test = base.extend<Fixtures>({
  // What the seed run should see instead of the pristine fixtures. Set per
  // spec file or per describe block with test.use({ seed: … }).
  seed: [{}, { option: true }],

  // The fixtures directory `grimoire seed` reads. Without overrides this is
  // the run's pristine copy, shared and never written — fixtures/ itself is
  // read-only for the suite anyway (CLAUDE.md: the format is a contract).
  fixturesDir: async ({ seed }, use, testInfo) => {
    const entries = seed.entries ?? {};
    const without = seed.without ?? [];
    if (seed.skip === true || (Object.keys(entries).length === 0 && without.length === 0)) {
      await use(pristineDir());
      return;
    }
    const dir = path.join(runDir(), `w${testInfo.workerIndex}`, testInfo.testId, "fixtures");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await cp(pristineDir(), dir, { recursive: true });
    const campaignDir = path.join(dir, CAMPAIGN);
    // One entry per fixture file, `<stem>.json` — so a stem the pristine copy already
    // has is overwritten, and any other stem adds an entry.
    for (const stem of without) {
      await rm(path.join(campaignDir, `${stem}.json`), { force: true });
    }
    for (const [stem, entry] of Object.entries(entries)) {
      // A stem may name a resource's own directory (`npcs/<id>`, `locations/<id>`).
      await mkdir(path.dirname(path.join(campaignDir, `${stem}.json`)), { recursive: true });
      await writeFile(
        path.join(campaignDir, `${stem}.json`),
        `${JSON.stringify(entry, null, 2)}\n`,
        "utf8",
      );
    }
    await use(dir);
    if (process.env.E2E_KEEP !== "1") await rm(dir, { recursive: true, force: true });
  },

  // An EMPTY data directory: `grimoire seed` creates grimoire.db in it (see
  // the `server` fixture), the boot then finds it ready.
  dataDir: async ({}, use, testInfo) => {
    const dir = path.join(runDir(), `w${testInfo.workerIndex}`, testInfo.testId, "data");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await use(dir);
    if (process.env.E2E_KEEP !== "1") await rm(dir, { recursive: true, force: true });
  },

  server: async ({ seed, fixturesDir, dataDir }, use, testInfo) => {
    // `seed: { skip: true }` starts the server on an EMPTY data directory —
    // the instance has no campaign at all (critical path 10).
    if (seed.skip !== true) await seedCampaigns(fixturesDir, dataDir);
    const { handle, proc } = await startGrimoireServer(
      fixturesDir,
      dataDir,
      testInfo.workerIndex,
    );
    await use(handle);
    await proc.stop();
  },

  // Everything in the app talks to ITS server; page.goto("/") is enough.
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },

  api: async ({ server }, use) => {
    await use(apiFor(server.url));
  },

  // The storage itself, through the server's own driver layer (no second
  // SQLite dependency in the suite). Only ever READ from here — the server
  // owns that database while it runs.
  db: async ({ server }, use) => {
    const client = await openSqlite(server.dbFile);
    try {
      await use(dbFor(client));
    } finally {
      client.close();
    }
  },
});

export { expect };
