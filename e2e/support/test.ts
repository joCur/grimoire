// The suite's own `test` — every test gets:
//
//   - its OWN database: a fresh, empty GRIMOIRE_DATA directory, seeded by
//     `grimoire seed <fixtures dir>` BEFORE the server starts. The boot reads
//     no fixtures, so the CLI is the only seeding path
//   - its OWN server process on its own port, serving the built app and /api,
//     with LLM_PROVIDER=openai pointing at the run's stub endpoint
//   - `baseURL` wired to that server, so page.goto("/") hits it
//   - an `api` handle on that server (api.ts), and a `db` helper that opens
//     the test's `grimoire.db` with the server's own driver layer
//
// The database is the only truth (decisions/sqlite): nothing writes campaign content
// to disk, so there is nothing next to the server to read an assertion back
// from. Every claim about stored state goes through the API or, where a spec
// really means storage, through `db`.
//
// The FIXTURES are therefore only an INPUT, read exactly once per test — by
// that seed run. `fixtures/beispiel/` holds one object per fixture in the
// shape the API speaks, and a test that needs content the example campaign
// does not have overrides the fixtures in its own copy of that directory,
// entity by entity:
//
//   test.use({ seed: { scenes: [{ id: "loot", … }] } });
//   test.use({ seed: { without: { sessions: ["2026-01-15"] } } });
//
// An object whose id a fixture already has REPLACES that fixture, any other
// adds one. The campaign, a chapter, a scene, an npc, a location, a thread, an
// idea, a glossary term, a knowledge item and a session are each their own
// resource (decisions/resources) and have a directory of their own
// (`campaigns/<id>.json`, `chapters/<id>.json`, …, `sessions/<id>.json`): the
// fixture is the entity itself, every field flat, without a guard — a session
// with its pauses and log entries embedded.
//
// What the suite knows about each entity — reading it, writing it, its
// request paths — lives in that entity's own module next to this one
// (campaign.ts, chapter.ts, scene.ts, npc.ts, location.ts, thread.ts,
// idea.ts, glossary-term.ts, knowledge-item.ts, session.ts). This file only
// puts server, seed and fixtures together.
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

import type { CampaignSeed } from "@grimoire/shared/campaign";
import type { ChapterProposal } from "@grimoire/shared/chapter";
import type { GlossaryTermSeed } from "@grimoire/shared/glossary-term";
import type { IdeaSeed } from "@grimoire/shared/idea";
import type { KnowledgeItemSeed } from "@grimoire/shared/knowledge-item";
import type { LocationProposal } from "@grimoire/shared/location";
import type { NpcProposal } from "@grimoire/shared/npc";
import type { SceneProposal } from "@grimoire/shared/scene";
import type { SessionSeed } from "@grimoire/shared/session";
import type { ThreadSeed } from "@grimoire/shared/thread";

import { openSqlite, type SqliteClient } from "../../server/src/db/driver";
import { apiFor, type Api } from "./api";
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
 * What a test changes about the fixtures its database is seeded from, entity
 * by entity. Each list ADDS its objects, and one whose id a fixture already
 * has REPLACES that fixture. Every entity with its own resource (decisions/resources) is
 * typed with its own type from `@grimoire/shared/<entity>` — the entity as its
 * resource answers it, without the guard.
 */
export interface Seed {
  /** Replaces the example campaign's own fixture. */
  campaign?: CampaignSeed;
  chapters?: ChapterProposal[];
  scenes?: SceneProposal[];
  npcs?: NpcProposal[];
  locations?: LocationProposal[];
  threads?: ThreadSeed[];
  ideas?: IdeaSeed[];
  glossaryTerms?: GlossaryTermSeed[];
  knowledgeItems?: KnowledgeItemSeed[];
  sessions?: SessionSeed[];
  /** Fixtures to leave out, by their id, e.g. `{ sessions: ["2026-01-15"] }`. */
  without?: {
    chapters?: string[];
    scenes?: string[];
    npcs?: string[];
    locations?: string[];
    threads?: string[];
    ideas?: string[];
    glossaryTerms?: string[];
    knowledgeItems?: string[];
    sessions?: string[];
  };
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
   * Every other field is meaningless with it and is ignored: there is no
   * seed run for it to feed.
   */
  skip?: boolean;
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
 * Apply one entity's overrides to a campaign directory: drop the fixtures
 * `without` names, then write each object to the fixture path of its id —
 * which replaces a fixture of the same id and adds any other.
 */
async function overrideEntity<T>(
  campaignDir: string,
  fixturePath: (id: string) => string,
  idOf: (value: T) => string,
  objects: T[] = [],
  without: string[] = [],
): Promise<void> {
  for (const id of without) await rm(path.join(campaignDir, fixturePath(id)), { force: true });
  for (const value of objects) {
    const target = path.join(campaignDir, fixturePath(idOf(value)));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}

const byId = (value: { id: string }): string => value.id;

/** Apply a test's `seed` to its own copy of the example campaign's directory. */
async function overrideFixtures(campaignDir: string, seed: Seed): Promise<void> {
  const without = seed.without ?? {};
  const campaigns = seed.campaign === undefined ? [] : [seed.campaign];
  await overrideEntity(campaignDir, (id) => `campaigns/${id}.json`, byId, campaigns);
  await overrideEntity(
    campaignDir,
    (id) => `chapters/${id}.json`,
    byId,
    seed.chapters,
    without.chapters,
  );
  await overrideEntity(campaignDir, (id) => `scenes/${id}.json`, byId, seed.scenes, without.scenes);
  await overrideEntity(campaignDir, (id) => `npcs/${id}.json`, byId, seed.npcs, without.npcs);
  await overrideEntity(
    campaignDir,
    (id) => `locations/${id}.json`,
    byId,
    seed.locations,
    without.locations,
  );
  await overrideEntity(campaignDir, (id) => `threads/${id}.json`, byId, seed.threads, without.threads);
  await overrideEntity(campaignDir, (id) => `ideas/${id}.json`, byId, seed.ideas, without.ideas);
  await overrideEntity(
    campaignDir,
    (id) => `glossary-terms/${id}.json`,
    byId,
    seed.glossaryTerms,
    without.glossaryTerms,
  );
  await overrideEntity(
    campaignDir,
    (id) => `knowledge-items/${id}.json`,
    byId,
    seed.knowledgeItems,
    without.knowledgeItems,
  );
  await overrideEntity(
    campaignDir,
    (id) => `sessions/${id}.json`,
    byId,
    seed.sessions,
    without.sessions,
  );
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
        // The only truth (decisions/sqlite) — the boot reads nothing else.
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
    const overridden = Object.keys(seed).some((key) => key !== "skip");
    if (seed.skip === true || !overridden) {
      await use(pristineDir());
      return;
    }
    const dir = path.join(runDir(), `w${testInfo.workerIndex}`, testInfo.testId, "fixtures");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await cp(pristineDir(), dir, { recursive: true });
    await overrideFixtures(path.join(dir, CAMPAIGN), seed);
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
