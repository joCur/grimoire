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

export const PORT = Number(process.env.PORT ?? 3000);

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
