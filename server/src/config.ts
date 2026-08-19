// Server configuration.
//
// CAMPAIGN_ROOT defaults to ../examples relative to the server PACKAGE dir
// (not process.cwd()), so `bun test` / `bun run dev` work from the repo root
// as well as from server/. An explicit CAMPAIGN_ROOT env value keeps normal
// CLI semantics: absolute paths are used as-is, relative ones resolve against
// the current working directory.

import { fileURLToPath } from "node:url";
import path from "node:path";

/** Absolute path of the server package directory (the parent of src/). */
const PACKAGE_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

export const CAMPAIGN_ROOT = process.env.CAMPAIGN_ROOT
  ? path.resolve(process.cwd(), process.env.CAMPAIGN_ROOT)
  : path.resolve(PACKAGE_DIR, "../examples");

export const PORT = Number(process.env.PORT ?? 3000);
