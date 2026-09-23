// `grimoire seed` — the dev/E2E tool that puts fixture entries into a
// database.
//
// The production boot loads NOTHING, and that is the first thing asserted
// here: a server on an empty data directory comes up healthy and empty. The
// seed tool itself is a critical seam — it is how every other spec gets its
// fixture campaign — so its two guarantees are covered:
//
//   1. one seed run on a fresh database loads the whole campaign, and it is
//      then reachable through the API (tree, a scene body, an npc, the
//      session, the inbox, the glossary);
//   2. a SECOND run on that same database refuses, because the database
//      already holds campaigns — nothing is loaded twice, nothing is lost.
//
// The database is looked at directly for the one claim the API cannot make:
// the row counts, which say that the second run really wrote nothing. The
// report is read from the CLI's own stdout — there is no endpoint for it,
// which is the point: the report belongs to the tool.

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
  chapters: { id: string; title: string; scenes: { path: string; id: string; title: string }[] }[];
  npcs: { path: string; id: string }[];
  locations: { path: string }[];
  /** A session SUMMARY — id and timestamps, no address (ADR #26). */
  sessions: { id: string; started: string }[];
}

/** What GET /api/:campaign/glossary answers. */
interface GlossaryResponse {
  entries: { term: string; explanation: string }[];
}

const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

const COUNTS =
  "SELECT (SELECT count(*) FROM campaigns) AS campaigns, " +
  "(SELECT count(*) FROM scenes) AS scenes, " +
  "(SELECT count(*) FROM npcs) AS npcs, " +
  "(SELECT count(*) FROM glossary) AS glossary";

/**
 * Everything the seeded campaign has to answer — asserted after BOTH runs, so
 * the second one is proven to have changed nothing.
 */
async function assertCampaignIsThere(api: Api): Promise<void> {
  // --- the tree -------------------------------------------------------------
  const tree = await api.get<TreeResponse>("campaigns/beispiel/tree");
  expect(tree.campaign).toBe("beispiel");
  expect(tree.chapters.map((c) => c.id)).toEqual(["01-salzhafen"]);
  const scenes = tree.chapters.flatMap((c) => c.scenes);
  // A scene's address is its chapter, its location and its id — the two
  // scenes name different Orte, so the location shows up in both addresses.
  expect(scenes.map((s) => s.path).sort()).toEqual([
    "01-salzhafen/bucht/smuggler-captured",
    "01-salzhafen/leuchtturm/lighthouse-arrival",
  ]);
  expect(tree.npcs.map((n) => n.id).sort()).toEqual(["fenn", "jorna"]);
  // BOTH Orte have an entry of their own — and that is the only reason they
  // are here. A mention creates nothing (ADR #19): an Ort without an entry
  // would be a reference to nothing, and the run would fail on the scene
  // that names it.
  expect(tree.locations.map((l) => l.path).sort()).toEqual([
    "locations/bucht",
    "locations/leuchtturm",
  ]);
  // What says the entry was SEEDED rather than conjured: it carries the name
  // and the chapter its fixture spells, which a synthesized stub would not
  // have.
  const bucht = await api.entry("locations/bucht");
  expect(bucht.properties.name).toBe("Die Nordbucht");
  expect(bucht.properties.chapter).toBe("01-salzhafen");
  // A session in the tree is a SUMMARY: its id and when it ran, no address.
  expect(tree.sessions.map((s) => s.id)).toEqual(["2026-01-15"]);

  // --- a scene body, callouts and If-sections included ----------------------
  const scene = await api.entry(SCENE);
  expect(scene.properties.id).toBe("lighthouse-arrival");
  expect(scene.properties.status).toBe("ready");
  expect(scene.body).toContain("> [!readaloud]");
  expect(scene.body).toContain("Der Turm ragt schwarz gegen den Abendhimmel auf.");

  // --- an npc: typed properties (voice, quickstats, motivation) and its prose
  const npc = await api.entry("npcs/jorna");
  expect(npc.properties.name).toBe("Hafenmeisterin Jorna");
  expect(npc.properties.voice).toBe("knapp, wetterrau, duzt jeden");
  expect(npc.properties.quickstats).toMatchObject({ insight: 2, "passive-perception": 12 });
  expect(npc.properties.motivation).toContain("Das Leuchtfeuer muss wieder brennen");
  expect(npc.body).not.toContain("## Will");
  expect(npc.body).toContain("- [[fenn]]: kennt ihn von früher");

  // --- the session: its own TABLE, read through its own endpoint ------------
  const session = await api.session("2026-01-15");
  expect(session.started).toBe("2026-01-15T19:30:00");
  expect(session.ended).toBe("2026-01-15T22:45:00");
  expect(session.scenesPlayed).toEqual(["lighthouse-arrival"]);
  // The log arrives as rows, with the columns the fixture spells — nothing is
  // parsed back out of a rendered line.
  expect(session.log).toEqual([
    {
      id: expect.any(String),
      at: "19:52",
      sceneId: "lighthouse-arrival",
      text: "Spuren gefunden, Gruppe will sofort zur Bucht #decision",
      reviewed: false,
    },
    {
      id: expect.any(String),
      at: "21:10",
      sceneId: "lighthouse-arrival",
      text: "Improvisiert: Fischerin „Old Metta“ am Steg #npc",
      reviewed: false,
    },
    {
      id: expect.any(String),
      at: "22:40",
      text: "Cliffhanger: Lichter in der Bucht gesichtet #thread",
      reviewed: false,
    },
  ]);
  // A pause is an INTERVAL, with the server's epoch reading beside each
  // wall clock.
  expect(session.pauses).toEqual([
    {
      from: "2026-01-15T20:30:00",
      fromMs: expect.any(Number),
      to: "2026-01-15T21:10:00",
      toMs: expect.any(Number),
    },
  ]);

  // --- the inbox: its own TABLE too -----------------------------------------
  const inbox = await api.inbox();
  expect(inbox.entries).toEqual([
    {
      id: expect.any(String),
      text: "Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug #thread",
      done: false,
    },
  ]);

  // --- the glossary: its own TABLE ------------------------------------------
  const glossary = await api.get<GlossaryResponse>("campaigns/beispiel/glossary");
  const terms = glossary.entries.map((e) => e.term);
  expect(terms).toContain("lighthouse keeper");
  expect(glossary.entries.find((e) => e.term === "lighthouse keeper")?.explanation).toBe(
    "Leuchtturmwärter",
  );
  expect(terms).toContain("smugglers' cove");
}

test("a fresh instance boots EMPTY — nothing is loaded at startup", async ({}, testInfo) => {
  const dataDir = path.join(runDir(), `w${testInfo.workerIndex}`, testInfo.testId, "empty-data");
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  const { handle, proc } = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(handle.url);
    // The server is up (the fixture waited for /api/campaigns) and knows
    // nothing: the fixtures directory next to it was never read.
    expect(await api.get<{ id: string }[]>("campaigns")).toEqual([]);
    expect((await api.fetch("campaigns/beispiel/tree")).status).toBe(404);
  } finally {
    await proc.stop();
  }

  if (process.env.E2E_KEEP !== "1") await rm(dataDir, { recursive: true, force: true });
});

test("grimoire seed loads the fixtures; a second run refuses", async ({}, testInfo) => {
  const base = path.join(runDir(), `w${testInfo.workerIndex}`, testInfo.testId);
  const dataDir = path.join(base, "data");
  await rm(base, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  // --- run 1: fresh database, the pristine fixtures -------------------------
  const firstOut = await seedCampaigns(pristineDir(), dataDir);
  // The report names the campaign it loaded; the count is the tool's own.
  expect(firstOut).toContain("seeded: beispiel");

  const dbFile = path.join(dataDir, "grimoire.db");
  const first = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    await assertCampaignIsThere(apiFor(first.handle.url));
  } finally {
    await first.proc.stop();
  }

  // The row counts of that run — what the second run must not change.
  const afterFirst = await openSqlite(dbFile);
  let firstCounts: Record<string, unknown> | undefined;
  try {
    firstCounts = dbFor(afterFirst).one(COUNTS);
    expect(firstCounts).toMatchObject({ campaigns: 1, scenes: 2, npcs: 2 });
  } finally {
    afterFirst.close();
  }

  // --- run 2: SAME database -------------------------------------------------
  // A database that already holds campaigns is left alone — the tool says so
  // and writes nothing.
  const secondOut = await seedCampaigns(pristineDir(), dataDir);
  expect(secondOut).toContain("holds campaigns");

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

  // Nothing was loaded twice: the same row counts.
  const afterSecond = await openSqlite(dbFile);
  try {
    expect(dbFor(afterSecond).one(COUNTS)).toEqual(firstCounts);
  } finally {
    afterSecond.close();
  }

  if (process.env.E2E_KEEP !== "1") await rm(base, { recursive: true, force: true });
});
