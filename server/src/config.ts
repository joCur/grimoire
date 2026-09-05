// Server configuration.
//
// CAMPAIGN_ROOT defaults to ../examples relative to the server PACKAGE dir
// (not process.cwd()), so `bun test` / `bun run dev` work from the repo root
// as well as from server/. An explicit CAMPAIGN_ROOT env value keeps normal
// CLI semantics: absolute paths are used as-is, relative ones resolve against
// the current working directory.
//
// The root is read through getCampaignRoot() instead of a top-level constant
// so tests can point the app at a temp copy of the example campaign without
// re-importing modules (see setCampaignRoot).

import { fileURLToPath } from "node:url";
import path from "node:path";

/** Absolute path of the server package directory (the parent of src/). */
const PACKAGE_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

let campaignRoot = process.env.CAMPAIGN_ROOT
  ? path.resolve(process.cwd(), process.env.CAMPAIGN_ROOT)
  : path.resolve(PACKAGE_DIR, "../examples");

/** Absolute path of the directory that holds the campaign directories. */
export function getCampaignRoot(): string {
  return campaignRoot;
}

/**
 * Test-only override: point the app at a different campaign root (e.g. a temp
 * copy of examples/). Production code never calls this — the root comes from
 * the CAMPAIGN_ROOT env var, evaluated once at startup.
 */
export function setCampaignRoot(dir: string): void {
  campaignRoot = path.resolve(dir);
}

/**
 * Directory that holds the SQLite database (`grimoire.db` plus its `-wal` and
 * `-shm` companions) — the Docker volume mount point (planning #52 section 5,
 * ADR #13). Defaults to `./data` next to the server package so `bun run dev`
 * and `bun test` work from the repo root as well as from server/.
 * GRIMOIRE_DATA overrides it with normal CLI semantics (relative to cwd).
 *
 * Read from the env on every call — unlike the campaign root, nothing needs a
 * test-only setter for it: tests pass an explicit path to `openDb`.
 */
export function getDataDir(): string {
  return process.env.GRIMOIRE_DATA
    ? path.resolve(process.cwd(), process.env.GRIMOIRE_DATA)
    : path.resolve(PACKAGE_DIR, "../data");
}

/** Absolute path of the database file. */
export function getDbFile(): string {
  return path.join(getDataDir(), "grimoire.db");
}

export const PORT = Number(process.env.PORT ?? 3000);

/**
 * Build id of this server — the commit the image was built from
 * (GRIMOIRE_BUILD, baked in by the Dockerfile via a build arg; see
 * .github/workflows/ci.yml). Outside an image it is "dev".
 *
 * The app compares it with its own build id and offers a reload when the two
 * differ (issue #24: an old SPA bundle in an open tab talking to a new
 * server). Read from the env on every call — like getAppDistDir() and unlike
 * the campaign root — so tests can set GRIMOIRE_BUILD without a test-only
 * setter; the cost is one env lookup per version poll.
 */
export function getBuildId(): string {
  return process.env.GRIMOIRE_BUILD?.trim() || "dev";
}

/**
 * Directory of the built frontend (Vite output). Defaults to ../app/dist
 * relative to the server PACKAGE dir, which is also the layout inside the
 * Docker image (/app/server + /app/app/dist). APP_DIST overrides it with
 * normal CLI semantics (relative to cwd).
 *
 * The directory only exists after `bun run --filter @grimoire/app build`; in
 * dev it is absent and the app is served by Vite instead (see static-files.ts).
 */
export function getAppDistDir(): string {
  return process.env.APP_DIST
    ? path.resolve(process.cwd(), process.env.APP_DIST)
    : path.resolve(PACKAGE_DIR, "../app/dist");
}
