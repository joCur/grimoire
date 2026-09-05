// The one-time import at first boot (issue #57 AK4) — the seam between the
// markdown era and the database.
//
// This spec is about the BOOT, so it cannot use the per-test `server` fixture:
// it needs TWO servers, one after the other, on the SAME data directory —
//
//   1. a fresh GRIMOIRE_DATA plus a markdown campaign tree: the boot imports
//      everything, and the whole campaign is then reachable through the API
//      (tree, a scene body, an npc, the session, the inbox, the glossary) with
//      an EMPTY migration report for the clean example campaign;
//   2. a second boot on that same database with CAMPAIGN_ROOT pointing at an
//      EMPTY directory: a no-op. Nothing is re-imported, nothing is lost, and
//      CAMPAIGN_ROOT is not read at all — which is exactly why pointing it
//      somewhere useless has to be harmless.
//
// The database is looked at directly for the two claims the API cannot make:
// the migration markers in `meta` and the row counts (no second import).

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { openSqlite } from "../../server/src/db/driver";
import { pristineDir, runDir } from "../support/paths";
import { apiFor, dbFor, expect, startGrimoireServer, test, type Api } from "../support/test";

/** What GET /api/:campaign/glossary answers. */
interface GlossaryResponse {
  entries: { term: string; explanation: string }[];
}

/** What GET /api/:campaign/migration-report answers. */
interface MigrationReport {
  entries: { path: string; reason: string; at?: string }[];
}

/** What GET /api/:campaign/tree answers — only the parts this spec reads. */
interface TreeResponse {
  campaign: string;
  chapters: { id: string; title: string; groups: { slug: string; scenes: { path: string; id: string; title: string }[] }[] }[];
  npcs: { path: string; id: string }[];
  locations: { path: string }[];
  sessions: { path: string }[];
}

const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";

/**
 * Everything the imported campaign has to answer — asserted after BOTH boots,
 * so the second one is proven to have changed nothing.
 */
async function assertCampaignIsThere(api: Api): Promise<void> {
  // --- the tree -------------------------------------------------------------
  const tree = await api.get<TreeResponse>("beispiel/tree");
  expect(tree.campaign).toBe("beispiel");
  expect(tree.chapters.map((c) => c.id)).toEqual(["01-salzhafen"]);
  const scenes = tree.chapters.flatMap((c) => c.groups.flatMap((g) => g.scenes));
  // The scene's path segment is its ID since the cutover.
  expect(scenes.map((s) => s.path).sort()).toEqual([
    "01-salzhafen/hafen/lighthouse-arrival.md",
    "01-salzhafen/hafen/smuggler-captured.md",
  ]);
  expect(tree.npcs.map((n) => n.id).sort()).toEqual(["fenn", "jorna"]);
  expect(tree.locations.map((l) => l.path)).toEqual(["locations/leuchtturm.md"]);
  expect(tree.sessions.map((s) => s.path)).toEqual(["sessions/2026-01-15.md"]);

  // --- a scene body, callouts and If-sections included ----------------------
  const scene = await api.file(SCENE);
  expect(scene.frontmatter.id).toBe("lighthouse-arrival");
  expect(scene.frontmatter.status).toBe("ready");
  expect(scene.body).toContain("> [!readaloud]");
  expect(scene.body).toContain("Der Turm ragt schwarz gegen den Abendhimmel auf.");
  expect(scene.raw.startsWith("---\n")).toBe(true);

  // --- an npc: typed frontmatter (voice, quickstats) and its prose ---------
  const npc = await api.file("npcs/jorna.md");
  expect(npc.frontmatter.name).toBe("Hafenmeisterin Jorna");
  expect(npc.frontmatter.voice).toBe("knapp, wetterrau, duzt jeden");
  expect(npc.frontmatter.quickstats).toMatchObject({ insight: 2, "passive-perception": 12 });
  expect(npc.body).toContain("Das Leuchtfeuer muss wieder brennen");
  expect(npc.body).toContain("- fenn: kennt ihn von früher");

  // --- the session ----------------------------------------------------------
  const session = await api.file("sessions/2026-01-15.md");
  expect(session.body).toContain("Spuren gefunden");

  // --- the inbox ------------------------------------------------------------
  const inbox = await api.file("inbox.md");
  expect(inbox.body).toContain("Der Dorfschmied repariert");

  // --- the glossary: its own TABLE since #57 (planning F6) ------------------
  const glossary = await api.get<GlossaryResponse>("beispiel/glossary");
  const terms = glossary.entries.map((e) => e.term);
  expect(terms).toContain("lighthouse keeper");
  expect(glossary.entries.find((e) => e.term === "lighthouse keeper")?.explanation).toBe(
    "Leuchtturmwärter",
  );
  expect(terms).toContain("smugglers' cove");
}

test("first boot imports the campaign, the second boot is a no-op", async ({}, testInfo) => {
  const base = path.join(runDir(), `w${testInfo.workerIndex}`, testInfo.testId);
  const dataDir = path.join(base, "data");
  const emptyRoot = path.join(base, "empty-campaign-root");
  await rm(base, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(emptyRoot, { recursive: true });

  // --- boot 1: fresh database, markdown tree --------------------------------
  const first = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(first.handle.url);
    await assertCampaignIsThere(api);

    // A clean example campaign degrades nothing, so the report is empty.
    const report = await api.get<MigrationReport>("beispiel/migration-report");
    expect(report.entries).toEqual([]);
  } finally {
    await first.proc.stop();
  }

  // What the database says about that import — the markers the second boot
  // reads to decide it has nothing to do.
  const afterFirst = await openSqlite(first.handle.dbFile);
  let firstMeta: Record<string, string>;
  let firstCounts: Record<string, unknown> | undefined;
  try {
    const db = dbFor(afterFirst);
    firstMeta = db.meta();
    expect(firstMeta.migrated_at).toBeTruthy();
    expect(firstMeta["migrated_campaign:beispiel"]).toBeTruthy();
    expect(firstMeta.migrated_from).toBe(pristineDir());
    firstCounts = db.one(
      "SELECT (SELECT count(*) FROM campaigns) AS campaigns, " +
        "(SELECT count(*) FROM scenes) AS scenes, " +
        "(SELECT count(*) FROM npcs) AS npcs, " +
        "(SELECT count(*) FROM glossary) AS glossary",
    );
    expect(firstCounts).toMatchObject({ campaigns: 1, scenes: 2, npcs: 2 });
  } finally {
    afterFirst.close();
  }

  // --- boot 2: SAME database, an EMPTY campaign root ------------------------
  // If the boot read CAMPAIGN_ROOT at all, this is where it would show:
  // either as an emptied campaign or as a duplicated one.
  const second = await startGrimoireServer(emptyRoot, dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(second.handle.url);
    // The campaign is there, whole, unchanged …
    await assertCampaignIsThere(api);
    // … and no second campaign appeared from the empty root.
    const campaigns = await api.get<{ id: string }[]>("campaigns");
    expect(campaigns.map((c) => c.id)).toEqual(["beispiel"]);
    // The report is still the first import's — still empty here.
    expect((await api.get<MigrationReport>("beispiel/migration-report")).entries).toEqual([]);
  } finally {
    await second.proc.stop();
  }

  // Nothing was re-imported: same markers (a second run would rewrite
  // `migrated_at`), same row counts.
  const afterSecond = await openSqlite(first.handle.dbFile);
  try {
    const db = dbFor(afterSecond);
    expect(db.meta()).toEqual(firstMeta);
    expect(
      db.one(
        "SELECT (SELECT count(*) FROM campaigns) AS campaigns, " +
          "(SELECT count(*) FROM scenes) AS scenes, " +
          "(SELECT count(*) FROM npcs) AS npcs, " +
          "(SELECT count(*) FROM glossary) AS glossary",
      ),
    ).toEqual(firstCounts);
  } finally {
    afterSecond.close();
  }

  if (process.env.E2E_KEEP !== "1") await rm(base, { recursive: true, force: true });
});
