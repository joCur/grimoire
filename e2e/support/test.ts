// The suite's own `test` — every test gets:
//
//   - its OWN campaign root: a fresh copy of examples/beispiel in the run's
//     temp directory (assertions read the files back from THERE)
//   - its OWN server process on its own port, serving the built app and /api,
//     with LLM_PROVIDER=openai pointing at the run's stub endpoint
//   - `baseURL` wired to that server, so page.goto("/") hits it
//
// One server per test instead of one per worker: the server holds state the
// tests care about (the in-memory generate job) and the campaign files are
// mutated by half the paths — a fresh process plus a fresh copy is the only
// isolation that needs no cleanup discipline. Starting it costs ~0.3s.
//
// Ports are deterministic per worker (base + slot) instead of "ask the OS for
// a free one": with several workers, two simultaneous lookups can hand out the
// same port. A busy port is retried on the next slot.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { test as base, expect } from "@playwright/test";

import { APP_DIST, CAMPAIGN, BUN, SERVER_ENTRY, REPO_ROOT, pristineDir, runDir, stubLlmBaseUrl } from "./paths";
import { startProcess, waitForHttp, type ManagedProcess } from "./procs";

/** First port of the E2E range; each worker owns PORTS_PER_WORKER of them. */
const PORT_BASE = 3200;
const PORTS_PER_WORKER = 40;

/** Per-worker counter (module state is per worker process). */
let slot = 0;

export interface ServerHandle {
  /** e.g. http://localhost:3200 — the app AND /api live here. */
  url: string;
  /** Campaign root this server serves (the test's own copy). */
  root: string;
  /** Campaign directory inside the root. */
  campaignDir: string;
}

/** Read/write access to the files the server is serving. */
export interface CampaignFiles {
  /** Absolute path of a campaign-relative file. */
  abs(rel: string): string;
  /** Raw content; throws when the file does not exist. */
  read(rel: string): Promise<string>;
  exists(rel: string): Promise<boolean>;
  /** Write a file (creating parent directories) — e.g. an external change. */
  write(rel: string, content: string): Promise<void>;
  /** `sessions/<today>.md` — the server's local-date convention. */
  todaySession(): string;
}

interface Fixtures {
  campaignRoot: string;
  server: ServerHandle;
  files: CampaignFiles;
}

async function startServer(root: string, workerIndex: number): Promise<{
  handle: ServerHandle;
  proc: ManagedProcess;
}> {
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
        CAMPAIGN_ROOT: root,
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
        handle: { url, root, campaignDir: path.join(root, CAMPAIGN) },
      };
    } catch (err) {
      lastError = err;
      await proc.stop();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function todaySessionRel(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `sessions/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
}

export const test = base.extend<Fixtures>({
  // A fresh copy of the fixture campaign per test — examples/ is read-only
  // for the suite (CLAUDE.md: the format is a contract).
  campaignRoot: async ({}, use, testInfo) => {
    const dir = path.join(runDir(), `w${testInfo.workerIndex}`, testInfo.testId, "campaigns");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await cp(pristineDir(), dir, { recursive: true });
    await use(dir);
    if (process.env.E2E_KEEP !== "1") await rm(dir, { recursive: true, force: true });
  },

  server: async ({ campaignRoot }, use, testInfo) => {
    const { handle, proc } = await startServer(campaignRoot, testInfo.workerIndex);
    await use(handle);
    await proc.stop();
  },

  // Everything in the app talks to ITS server; page.goto("/") is enough.
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },

  files: async ({ server }, use) => {
    const abs = (rel: string) => path.join(server.campaignDir, rel);
    await use({
      abs,
      read: (rel) => readFile(abs(rel), "utf8"),
      exists: async (rel) => {
        try {
          await readFile(abs(rel));
          return true;
        } catch {
          return false;
        }
      },
      write: async (rel, content) => {
        await mkdir(path.dirname(abs(rel)), { recursive: true });
        await writeFile(abs(rel), content, "utf8");
      },
      todaySession: () => todaySessionRel(),
    });
  },
});

export { expect };
