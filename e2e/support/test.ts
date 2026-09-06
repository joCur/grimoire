// The suite's own `test` — every test gets:
//
//   - its OWN database: a fresh, empty GRIMOIRE_DATA directory, seeded by
//     `grimoire seed <tree>` BEFORE the server starts. Since issue #79 the
//     boot imports nothing, so the CLI is the seeding path — still the real
//     importer, still the example campaign as the only fixture format
//     (planning #52 decision F5)
//   - its OWN server process on its own port, serving the built app and /api,
//     with LLM_PROVIDER=openai pointing at the run's stub endpoint
//   - `baseURL` wired to that server, so page.goto("/") hits it
//   - an `api` helper against that server, and a `db` helper that opens the
//     test's `grimoire.db` with the server's own driver layer
//
// Since the cutover (issue #57) the database is the only truth: NOTHING writes
// campaign markdown any more, so there is no file to read an assertion back
// from. Every claim about stored state goes through the API (`api.raw` is the
// old `files.read`) or, where a spec really means storage, through `db`.
//
// The markdown tree is therefore only an INPUT, read exactly once per test —
// by that seed run. A test that needs content the example campaign does not
// have seeds it into its own copy of that tree BEFORE the seed:
//
//   test.use({ seed: { files: { "locations/hafen": "…" } } });
//   test.use({ seed: { remove: ["_campaign"] } });
//
// Those keys are ADDRESSES, like everything else in the suite (issue #79);
// the fixture appends the importer's `.md` when it writes into the tree, so
// no spec has to know that the SOURCE of the seed is still a file.
//
// Without a seed the pristine copy from the global setup is used directly (it
// is never written to), so most tests copy nothing at all.
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
  /** The database file this server booted on. */
  dbFile: string;
  /** The markdown tree `grimoire seed` read (an INPUT, never written). */
  campaignRoot: string;
}

/** What a test adds to its own copy of the markdown tree before the boot. */
export interface Seed {
  /** campaign-relative ADDRESS -> content (parent directories are created). */
  files?: Record<string, string>;
  /** campaign-relative ADDRESSES to delete before the seed runs. */
  remove?: string[];
}

/** One file as GET /api/:campaign/file answers it. */
export interface ApiFile {
  path: string;
  kind: string;
  properties: Record<string, unknown>;
  body: string;
  /** The row version (`rev`) — an opaque guard token since the cutover. */
  rev: number;
  /** The file as the server serializes it: properties block plus body. */
  raw: string;
}

/**
 * Typed access to the test's own server. This is what replaced the old
 * `files` fixture: the database is the truth, and the API is how one looks at
 * it — the same way the app does.
 */
export interface Api {
  /** Absolute URL of an API path (`/api/beispiel/tree` or just `tree`). */
  url(apiPath: string): string;
  /** Raw fetch — for status-code assertions (409, 400, 404). */
  fetch(apiPath: string, init?: RequestInit): Promise<Response>;
  /** GET, parsed as JSON; throws with the body on a non-2xx answer. */
  get<T>(apiPath: string): Promise<T>;
  /** POST/PATCH/PUT with a JSON body, parsed as JSON; throws on non-2xx. */
  send<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", apiPath: string, body?: unknown): Promise<T>;
  /** GET /file for a campaign-relative path; throws when it does not exist. */
  file(rel: string): Promise<ApiFile>;
  /** The serialized file — the successor of the old `files.read`. */
  raw(rel: string): Promise<string>;
  /** Whether the path addresses an existing row (404 = no). */
  exists(rel: string): Promise<boolean>;
  /**
   * Path of the ACTIVE session — or, with `includeEnded`, of the last started
   * one. `undefined` when the campaign has no such session.
   *
   * A session id is an opaque random string since issue #58, so no spec can
   * spell one out: "the file the app just started" is a question only the
   * server can answer, and this asks it.
   */
  sessionPath(includeEnded?: boolean): Promise<string | undefined>;
  /**
   * PUT /file with a FRESH guard token: a second writer, not a race. Returns
   * the new token. This is how a spec provokes the app's 409 since "someone
   * changed the file outside" cannot happen any more.
   */
  writeBody(rel: string, body: string): Promise<number>;
  /** PATCH /properties with a fresh guard token; returns the new token. */
  patchProperties(rel: string, patch: Record<string, unknown>): Promise<number>;
}

/** Read access to the test's database, with the server's own driver. */
export interface Db {
  /** Rows of a query, as plain objects. */
  all(sql: string, ...params: (string | number | null)[]): Record<string, unknown>[];
  /** The first row, or undefined. */
  one(sql: string, ...params: (string | number | null)[]): Record<string, unknown> | undefined;
  /** `meta` as a plain record — where the migration markers live. */
  meta(): Record<string, string>;
}

interface Fixtures {
  seed: Seed;
  campaignRoot: string;
  dataDir: string;
  server: ServerHandle;
  api: Api;
  db: Db;
}

/**
 * Import a markdown tree into `dataDir`'s database with the real CLI —
 * `grimoire seed <tree>`, the documented dev/E2E tool (issue #79 AK6). The
 * server no longer imports anything at boot, so this is what puts the fixture
 * campaign into a test's database.
 */
export async function seedCampaigns(campaignRoot: string, dataDir: string): Promise<string> {
  try {
    const { stdout } = await run(BUN, [CLI_ENTRY, "seed", campaignRoot], {
      cwd: REPO_ROOT,
      env: { ...process.env, GRIMOIRE_DATA: dataDir },
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`e2e: grimoire seed ${campaignRoot} failed\n${detail}`);
  }
}

/**
 * Start ONE real server process on `dataDir` (GRIMOIRE_DATA). `campaignRoot`
 * is recorded on the handle only — nothing reads it at boot any more; seed
 * with `seedCampaigns` first when the test needs content.
 *
 * Exported because the seed spec needs boots of its own on data directories
 * the per-test `server` fixture cannot express.
 */
export async function startGrimoireServer(
  campaignRoot: string,
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
        // The only truth — the boot imports nothing (issue #79).
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
      // localhost (not 127.0.0.1): the review view hashes log lines with
      // WebCrypto, which needs a secure context.
      const url = `http://localhost:${port}`;
      await waitForHttp(`${url}/api/campaigns`, proc, `server:${port}`, 20_000);
      return {
        proc,
        handle: { url, dataDir, dbFile: path.join(dataDir, "grimoire.db"), campaignRoot },
      };
    } catch (err) {
      lastError = err;
      await proc.stop();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * `sessions/<today>` — for session files a spec SEEDS itself.
 *
 * NOT the path of a session the app starts: those ids are opaque random
 * strings since issue #58 and only the server knows them (`api.sessionPath`).
 * A date-shaped id stays perfectly legal — it is what every campaign written
 * before the cutover carries — so seeding one is also the compatibility case.
 */
export function todaySessionPath(d = new Date()): string {
  return `sessions/${todaySessionId(d)}`;
}

/** The date-shaped id of a seeded session for that day (see above). */
export function todaySessionId(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    file(rel) {
      return api.get<ApiFile>(`${campaign}/file?path=${encodeURIComponent(rel)}`);
    },
    async raw(rel) {
      return (await api.file(rel)).raw;
    },
    async exists(rel) {
      const response = await fetchApi(`${campaign}/file?path=${encodeURIComponent(rel)}`);
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`GET /file ${rel}: HTTP ${response.status}`);
      return true;
    },
    async sessionPath(includeEnded = false) {
      const response = await fetchApi(
        `${campaign}/session${includeEnded ? "?includeEnded=1" : ""}`,
      );
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`GET /session: HTTP ${response.status}`);
      return ((await response.json()) as ApiFile).path;
    },
    async writeBody(rel, body) {
      const current = await api.file(rel);
      const written = await api.send<ApiFile>("PUT", `${campaign}/file`, {
        path: rel,
        rev: current.rev,
        body,
      });
      return written.rev;
    },
    async patchProperties(rel, patch) {
      const current = await api.file(rel);
      const written = await api.send<ApiFile>("PATCH", `${campaign}/properties`, {
        path: rel,
        rev: current.rev,
        patch,
      });
      return written.rev;
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
  // Extra markdown the seed run should see. Set per file or per
  // describe block with test.use({ seed: … }).
  seed: [{}, { option: true }],

  // The markdown tree `grimoire seed` reads. Without a seed this is the run's
  // pristine copy, shared and never written — examples/ itself is read-only
  // for the suite anyway (CLAUDE.md: the format is a contract).
  campaignRoot: async ({ seed }, use, testInfo) => {
    const files = seed.files ?? {};
    const remove = seed.remove ?? [];
    if (Object.keys(files).length === 0 && remove.length === 0) {
      await use(pristineDir());
      return;
    }
    const dir = path.join(runDir(), `w${testInfo.workerIndex}`, testInfo.testId, "campaigns");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await cp(pristineDir(), dir, { recursive: true });
    const campaignDir = path.join(dir, CAMPAIGN);
    // Addresses in, files out: the importer reads `.md` files, the suite
    // speaks addresses (issue #79).
    const asFile = (address: string) =>
      address.endsWith(".md") ? address : `${address}.md`;
    for (const rel of remove) {
      await rm(path.join(campaignDir, asFile(rel)), { force: true });
    }
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(campaignDir, asFile(rel));
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
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

  server: async ({ campaignRoot, dataDir }, use, testInfo) => {
    await seedCampaigns(campaignRoot, dataDir);
    const { handle, proc } = await startGrimoireServer(
      campaignRoot,
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
  // owns this file while it runs.
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
