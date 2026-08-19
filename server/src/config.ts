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
