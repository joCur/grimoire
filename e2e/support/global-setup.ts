// Global setup — everything the whole run shares:
//
//   1. build the app once (the server serves the real Vite bundle via
//      APP_DIST, exactly like the container does — docs/DEPLOYMENT.md)
//   2. create a per-run temp directory with a PRISTINE copy of
//      examples/beispiel — the markdown tree every test's first-run import
//      reads, so examples/ itself is never touched (and since the cutover
//      nothing writes into a campaign tree at all)
//   3. start the stub LLM as a managed process and publish its port
//
// The per-test server processes are started by the fixtures (support/test.ts)
// — one per test, on its own port, on its own EMPTY database, which that boot
// seeds by importing the pristine tree (the real first-run import).
//
// Values travel to the workers through process.env: Playwright spawns the
// worker processes AFTER this function returned, so they inherit them.

import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  APP_DIST,
  BUN,
  CAMPAIGN,
  ENV,
  EXAMPLES_DIR,
  REPO_ROOT,
  STUB_LLM_ENTRY,
} from "./paths";
import { startProcess, waitForHttp, type ManagedProcess } from "./procs";

const run = promisify(execFile);

/** A free TCP port on loopback (asked from the OS, then released). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Always build — reusing a stale app/dist is the classic way to test
 * yesterday's UI. The Vite build of this app takes a few seconds.
 */
async function buildApp(): Promise<void> {
  const started = Date.now();
  try {
    await run(BUN, ["run", "--filter", "@grimoire/app", "build"], {
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `e2e: app build failed (is bun on PATH? set GRIMOIRE_BUN otherwise)\n${detail}`,
    );
  }
  console.log(`e2e: app built in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${APP_DIST}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await buildApp();

  const dir = await mkdtemp(path.join(os.tmpdir(), "grimoire-e2e-"));
  // The pristine copy is a CAMPAIGN ROOT: <pristine>/<campaign>/…
  await cp(path.join(EXAMPLES_DIR, CAMPAIGN), path.join(dir, "pristine", CAMPAIGN), {
    recursive: true,
  });
  process.env[ENV.runDir] = dir;

  const port = await freePort();
  const stub: ManagedProcess = startProcess({
    command: BUN,
    args: [STUB_LLM_ENTRY, "--port", String(port)],
    cwd: REPO_ROOT,
    label: "stub-llm",
  });
  await waitForHttp(`http://127.0.0.1:${port}/health`, stub, "stub-llm", 15_000);
  process.env[ENV.stubPort] = String(port);
  console.log(`e2e: stub LLM on http://127.0.0.1:${port}/v1, per-test data in ${dir}`);

  return async () => {
    await stub.stop();
    // E2E_KEEP=1 keeps the databases and campaign copies for a post-mortem.
    if (process.env.E2E_KEEP !== "1") await rm(dir, { recursive: true, force: true });
  };
}
