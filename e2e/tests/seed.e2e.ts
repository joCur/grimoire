// `grimoire seed` — the markdown importer as the dev/E2E tool it now is
// (issue #79 AK6; the former first-migration spec, which covered the same
// importer when it still ran at boot).
//
// The production boot imports NOTHING any more, and that is the first thing
// asserted here: a server on an empty data directory comes up healthy and
// empty. The importer itself is still a critical path — it is how every other
// spec gets its fixture campaign — so its two guarantees are covered as
// before:
//
//   1. one seed run on a fresh database imports the whole campaign, and it is
//      then reachable through the API (tree, a scene body, an npc, the
//      session, the inbox, the glossary);
//   2. a SECOND seed run on that same database is a no-op — nothing is
//      re-imported, nothing is lost.
//
// The database is looked at directly for the two claims the API cannot make:
// the import markers in `meta` and the row counts (no second import). The
// migration report is read from the CLI's own stdout — since #79 there is no
// endpoint for it, which is the point: the report belongs to the tool.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { openSqlite } from "../../server/src/db/driver";
import { pristineDir, runDir } from "../support/paths";
import {
  apiFor,
  dbFor,
  expect,
  seedCampaigns,
  startGrimoireServer,
  test,
  type Api,
} from "../support/test";

/** What GET /api/:campaign/tree answers — only the parts this spec reads. */
interface TreeResponse {
  campaign: string;
  chapters: { id: string; title: string; groups: { slug: string; scenes: { path: string; id: string; title: string }[] }[] }[];
  npcs: { path: string; id: string }[];
  locations: { path: string }[];
  sessions: { path: string }[];
}

/** What GET /api/:campaign/glossary answers. */
interface GlossaryResponse {
  entries: { term: string; explanation: string }[];
}

const SCENE = "01-salzhafen/hafen/lighthouse-arrival";

const COUNTS =
  "SELECT (SELECT count(*) FROM campaigns) AS campaigns, " +
  "(SELECT count(*) FROM scenes) AS scenes, " +
  "(SELECT count(*) FROM npcs) AS npcs, " +
  "(SELECT count(*) FROM glossary) AS glossary";

/**
 * Everything the imported campaign has to answer — asserted after BOTH seed
 * runs, so the second one is proven to have changed nothing.
 */
async function assertCampaignIsThere(api: Api): Promise<void> {
  // --- the tree -------------------------------------------------------------
  const tree = await api.get<TreeResponse>("beispiel/tree");
  expect(tree.campaign).toBe("beispiel");
  expect(tree.chapters.map((c) => c.id)).toEqual(["01-salzhafen"]);
  const scenes = tree.chapters.flatMap((c) => c.groups.flatMap((g) => g.scenes));
  // The scene's path segment is its ID since the cutover.
  expect(scenes.map((s) => s.path).sort()).toEqual([
    "01-salzhafen/hafen/lighthouse-arrival",
    "01-salzhafen/hafen/smuggler-captured",
  ]);
  expect(tree.npcs.map((n) => n.id).sort()).toEqual(["fenn", "jorna"]);
  expect(tree.locations.map((l) => l.path)).toEqual(["locations/leuchtturm"]);
  expect(tree.sessions.map((s) => s.path)).toEqual(["sessions/2026-01-15"]);

  // --- a scene body, callouts and If-sections included ----------------------
  const scene = await api.file(SCENE);
  expect(scene.properties.id).toBe("lighthouse-arrival");
  expect(scene.properties.status).toBe("ready");
  expect(scene.body).toContain("> [!readaloud]");
  expect(scene.body).toContain("Der Turm ragt schwarz gegen den Abendhimmel auf.");
  expect(scene.raw.startsWith("---\n")).toBe(true);

  // --- an npc: typed properties (voice, quickstats) and its prose ----------
  const npc = await api.file("npcs/jorna");
  expect(npc.properties.name).toBe("Hafenmeisterin Jorna");
  expect(npc.properties.voice).toBe("knapp, wetterrau, duzt jeden");
  expect(npc.properties.quickstats).toMatchObject({ insight: 2, "passive-perception": 12 });
  expect(npc.body).toContain("Das Leuchtfeuer muss wieder brennen");
  expect(npc.body).toContain("- fenn: kennt ihn von früher");

  // --- the session ----------------------------------------------------------
  const session = await api.file("sessions/2026-01-15");
  expect(session.body).toContain("Spuren gefunden");

  // --- the inbox ------------------------------------------------------------
  const inbox = await api.file("inbox");
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

test("a fresh instance boots EMPTY — no import happens at startup", async ({}, testInfo) => {
  const dataDir = path.join(runDir(), `w${testInfo.workerIndex}`, testInfo.testId, "empty-data");
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  const { handle, proc } = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(handle.url);
    // The server is up (the fixture waited for /api/campaigns) and knows
    // nothing: the markdown tree next to it was never read.
    expect(await api.get<{ id: string }[]>("campaigns")).toEqual([]);
    expect((await api.fetch("beispiel/tree")).status).toBe(404);
  } finally {
    await proc.stop();
  }

  if (process.env.E2E_KEEP !== "1") await rm(dataDir, { recursive: true, force: true });
});

test("grimoire seed imports the campaign; a second run is a no-op", async ({}, testInfo) => {
  const base = path.join(runDir(), `w${testInfo.workerIndex}`, testInfo.testId);
  const dataDir = path.join(base, "data");
  await rm(base, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  // --- seed run 1: fresh database, markdown tree ----------------------------
  const firstOut = await seedCampaigns(pristineDir(), dataDir);
  expect(firstOut).toContain("imported: beispiel");
  // A clean example campaign degrades nothing, so the report is empty — the
  // CLI says so on stdout, which is where the report lives now.
  expect(firstOut).toContain("clean import");

  const dbFile = path.join(dataDir, "grimoire.db");
  const first = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    await assertCampaignIsThere(apiFor(first.handle.url));
  } finally {
    await first.proc.stop();
  }

  // What the database says about that import — the markers the second run
  // reads to decide it has nothing to do.
  const afterFirst = await openSqlite(dbFile);
  let firstMeta: Record<string, string>;
  let firstCounts: Record<string, unknown> | undefined;
  try {
    const db = dbFor(afterFirst);
    firstMeta = db.meta();
    expect(firstMeta.migrated_at).toBeTruthy();
    expect(firstMeta["migrated_campaign:beispiel"]).toBeTruthy();
    expect(firstMeta.migrated_from).toBe(pristineDir());
    firstCounts = db.one(COUNTS);
    expect(firstCounts).toMatchObject({ campaigns: 1, scenes: 2, npcs: 2 });
  } finally {
    afterFirst.close();
  }

  // --- seed run 2: SAME database --------------------------------------------
  // The importer never overwrites: an already-imported database is left alone.
  const secondOut = await seedCampaigns(pristineDir(), dataDir);
  expect(secondOut).toContain("nothing to do");

  const second = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(second.handle.url);
    // The campaign is there, whole, unchanged …
    await assertCampaignIsThere(api);
    // … and no second campaign appeared.
    const campaigns = await api.get<{ id: string }[]>("campaigns");
    expect(campaigns.map((c) => c.id)).toEqual(["beispiel"]);
  } finally {
    await second.proc.stop();
  }

  // Nothing was re-imported: same markers (a second run would rewrite
  // `migrated_at`), same row counts.
  const afterSecond = await openSqlite(dbFile);
  try {
    const db = dbFor(afterSecond);
    expect(db.meta()).toEqual(firstMeta);
    expect(db.one(COUNTS)).toEqual(firstCounts);
  } finally {
    afterSecond.close();
  }

  if (process.env.E2E_KEEP !== "1") await rm(base, { recursive: true, force: true });
});
