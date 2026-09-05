// Test setup for the database-backed API (issue #57).
//
// Every test case gets its OWN in-memory database, seeded through the real
// one-time migration from a campaign tree — `examples/` by default, which is
// what makes the committed example campaign the fixture of the whole suite
// (CLAUDE.md, "Arbeitsweise"; planning decision F5) without a second data
// format anywhere.
//
// Why in-memory: it is the same driver, the same schema migrations and the
// same importer as production (store/handle.ts calls exactly this), it needs
// no cleanup, and it makes each case independent — the server process used to
// be stateless because the files were the state, and the equivalent now is a
// fresh database per case.

import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GrimoireDb } from "../../src/db/client";
import { getCampaignRoot, setCampaignRoot } from "../../src/config";
import { closeStore, initStore } from "../../src/store/handle";

/** The committed example campaign — read-only for the suite. */
export const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../examples");

/**
 * A fresh in-memory database, seeded from `root` (default: the current
 * CAMPAIGN_ROOT, i.e. `examples/`). Call it in `beforeEach` — it closes any
 * database a previous case left open.
 */
export async function seedStore(root?: string): Promise<GrimoireDb> {
  closeStore();
  return initStore({ file: ":memory:", campaignRoot: root ?? getCampaignRoot() });
}

/** Close the database of the current case. Call it in `afterEach`. */
export function dropStore(): void {
  closeStore();
}

/**
 * A temp copy of `examples/` as a CAMPAIGN ROOT, for cases that need to seed
 * from a modified tree (a broken file, a second campaign, a missing
 * `_campaign.md`). The server never writes into it — after the cutover the
 * tree is only ever the migration's source.
 */
export async function tempCampaignRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "grimoire-root-"));
  await cp(EXAMPLES, dir, { recursive: true });
  return dir;
}

/** Drop a temp root created above. */
export async function removeTempRoot(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Point the app at `root` for the duration of one case and hand back the
 * restore function. Pairs with `seedStore(root)`.
 */
export function useCampaignRoot(root: string): () => void {
  const previous = getCampaignRoot();
  setCampaignRoot(root);
  return () => setCampaignRoot(previous);
}
