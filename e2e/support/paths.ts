// Where things live, in one place: the repo root, the fixture campaign, the
// app build the server serves, and the per-run temp directory the global
// setup hands to the workers via the environment.

import path from "node:path";
import { fileURLToPath } from "node:url";

/** e2e/ package directory. */
export const E2E_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Repo root — the suite drives the real workspaces from here. */
export const REPO_ROOT = path.resolve(E2E_DIR, "..");

/**
 * The committed fixtures root: one directory per campaign, each holding the
 * campaign's entries as JSON. The suite only ever COPIES it.
 */
export const FIXTURES_ROOT = path.join(REPO_ROOT, "fixtures");

/** Campaign id inside fixtures/ — the fixture campaign of the whole suite. */
export const CAMPAIGN = "beispiel";

/** Vite build output the server serves statically (APP_DIST). */
export const APP_DIST = path.join(REPO_ROOT, "app", "dist");

/** Server entrypoint, started per test as its own process. */
export const SERVER_ENTRY = path.join(REPO_ROOT, "server", "src", "server.ts");

/**
 * The `grimoire` CLI entrypoint. The server boots EMPTY, so the suite seeds
 * each test's database with `grimoire seed <fixtures dir>` — the documented
 * dev/E2E tool — before the server process starts.
 */
export const CLI_ENTRY = path.join(REPO_ROOT, "server", "src", "cli.ts");

/** The standalone stub LLM script (started once per run). */
export const STUB_LLM_ENTRY = path.join(E2E_DIR, "fixtures", "stub-llm.ts");

/** The suite's own fixtures: the stub LLM and the entries single specs seed. */
export const E2E_FIXTURES_DIR = path.join(E2E_DIR, "fixtures");

/**
 * The bun binary. Both the server and the stub run on it; an explicit
 * GRIMOIRE_BUN wins for setups where it is not on PATH.
 */
export const BUN = process.env.GRIMOIRE_BUN ?? "bun";

/** Env keys the global setup fills in for the workers. */
export const ENV = {
  runDir: "E2E_RUN_DIR",
  stubPort: "E2E_STUB_PORT",
} as const;

/** The per-run temp directory (created by the global setup). */
export function runDir(): string {
  const dir = process.env[ENV.runDir];
  if (dir === undefined || dir === "") {
    throw new Error(`${ENV.runDir} is not set — run the suite through playwright.config.ts`);
  }
  return dir;
}

/** Base URL of the stub LLM (created by the global setup). */
export function stubLlmBaseUrl(): string {
  const port = process.env[ENV.stubPort];
  if (port === undefined || port === "") {
    throw new Error(`${ENV.stubPort} is not set — run the suite through playwright.config.ts`);
  }
  return `http://127.0.0.1:${port}/v1`;
}

/**
 * The pristine fixtures directory (<pristine>/beispiel/*.json) `grimoire seed`
 * reads. Nothing ever writes into it — a test that overrides entries gets its
 * own copy (support/test.ts, the `seed` fixture).
 */
export function pristineDir(): string {
  return path.join(runDir(), "pristine");
}
