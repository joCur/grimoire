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
//      session, the ideas, the glossary terms);
//   2. a SECOND run on that same database refuses, because the database
//      already holds campaigns — nothing is loaded twice, nothing is lost.
//
// The database is looked at directly for the one claim the API cannot make:
// the row counts, which say that the second run really wrote nothing. The
// report is read from the CLI's own stdout — there is no endpoint for it,
// which is the point: the report belongs to the tool.

import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { openSqlite } from "../../server/src/db/driver";
import { CAMPAIGN, FIXTURES_ROOT, pristineDir, runDir } from "../support/paths";
import { dbFor, expect, seedCampaigns, startGrimoireServer, test } from "../support/test";
import { apiFor, type Api } from "../support/api";
import { getGlossaryTerms } from "../support/glossary-term";
import { getIdeas } from "../support/idea";
import { getLocation } from "../support/location";
import { getNpc } from "../support/npc";
import { getScene } from "../support/scene";
import { getSession } from "../support/session";

/** What GET /api/:campaign/tree answers — only the parts this spec reads. */
interface TreeResponse {
  campaign: string;
  chapters: { id: string; title: string; scenes: { path?: string; id: string; title: string }[] }[];
  npcs: { id: string; path?: string }[];
  locations: { id: string }[];
  /** A session SUMMARY — id and timestamps, no address (decisions/resources). */
  sessions: { id: string; started: string }[];
}

const SCENE = "lighthouse-arrival";

/**
 * One object of the example campaign as its fixture file spells it — the
 * content the seeded rows have to carry, read as data rather than copied
 * into this spec.
 */
async function fixture<T = Record<string, unknown>>(kind: string, id: string): Promise<T> {
  const source = path.join(FIXTURES_ROOT, CAMPAIGN, kind, `${id}.json`);
  return JSON.parse(await readFile(source, "utf8")) as T;
}

const COUNTS =
  "SELECT (SELECT count(*) FROM campaigns) AS campaigns, " +
  "(SELECT count(*) FROM scenes) AS scenes, " +
  "(SELECT count(*) FROM npcs) AS npcs, " +
  "(SELECT count(*) FROM glossary_terms) AS glossary_terms";

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
  // A scene in the tree names itself by its id — it has no address (decisions/resources).
  expect(scenes.map((s) => s.id).sort()).toEqual(["lighthouse-arrival", "smuggler-captured"]);
  for (const scene of scenes) expect(scene.path).toBeUndefined();
  expect(tree.npcs.map((n) => n.id).sort()).toEqual(["fenn", "jorna"]);
  // An npc in the tree names itself by its id — it has no address (decisions/resources).
  for (const npc of tree.npcs) expect(npc.path).toBeUndefined();
  // BOTH locations exist on their own — and that is the only reason they are
  // here. A mention creates nothing (decisions/constraints): a location that does not
  // exist would be a reference to nothing, and the run would fail on the
  // scene that names it.
  expect(tree.locations.map((l) => l.id).sort()).toEqual(["bucht", "leuchtturm"]);
  // What says the location was SEEDED rather than conjured: it carries the
  // name, the chapter and the Roll20 page its fixture
  // (`locations/bucht.json`) spells, which a synthesized stub would not have.
  const bucht = await getLocation(api, "bucht");
  const buchtFixture = await fixture("locations", "bucht");
  expect(bucht.name).toBe(buchtFixture.name);
  expect(bucht.chapter).toBe("01-salzhafen");
  expect(bucht.roll20Page).toBe(buchtFixture.roll20Page);
  expect(bucht.roll20Page).toEqual(expect.any(String));
  // …and the resource answers the location itself: every field flat, beside
  // its guard — no kind, no path, no properties (decisions/resources).
  expect(Object.keys(bucht).sort()).toEqual([
    "atmosphere",
    "body",
    "chapter",
    "id",
    "name",
    "rev",
    "roll20Page",
  ]);
  // A session in the tree is a SUMMARY: its id and when it ran, no address.
  expect(tree.sessions.map((s) => s.id)).toEqual(["2026-01-15"]);

  // --- a scene body, callouts and If-sections included ----------------------
  // What `scenes/lighthouse-arrival.json` spells, answered as the scene itself.
  const scene = await getScene(api, SCENE);
  expect(scene.id).toBe("lighthouse-arrival");
  expect(scene.status).toBe("ready");
  expect(scene.location).toBe("leuchtturm");
  expect(scene.body).toContain("> [!readaloud]");
  expect(scene.body).toBe((await fixture<{ body: string }>("scenes", SCENE)).body);

  // --- an npc: its typed fields (voice, quickstats, motivation) and its prose,
  // as its fixture (`npcs/jorna.json`) spells them
  const npc = await getNpc(api, "jorna");
  const npcFixture = await fixture("npcs", "jorna");
  expect(npc.name).toBe(npcFixture.name);
  expect(npc.voice).toBe(npcFixture.voice);
  expect(npc.quickstats).toEqual({ insight: 2, "passive-perception": 12 });
  expect(npc.motivation).toBe(npcFixture.motivation);
  expect(npc.body).not.toContain("## Will");
  expect(npc.body).toContain("- [[fenn]]: ");
  expect(npc.body).toBe(npcFixture.body);
  // …and the resource answers the npc itself: every field flat, beside its
  // guard — no kind, no path, no properties (decisions/resources).
  expect(Object.keys(npc).sort()).toEqual([
    "appearance",
    "body",
    "chapter",
    "id",
    "motivation",
    "name",
    "quickstats",
    "rev",
    "role",
    "statblock",
    "status",
    "voice",
  ]);

  // --- the session: its own TABLE, read through its own endpoint ------------
  const session = await getSession(api, "2026-01-15");
  expect(session.started).toBe("2026-01-15T19:30:00");
  expect(session.ended).toBe("2026-01-15T22:45:00");
  // The log arrives as rows, with the columns the fixture spells — nothing is
  // parsed back out of a rendered line.
  const sessionFixture = await fixture<{ log: Record<string, unknown>[] }>(
    "sessions",
    "2026-01-15",
  );
  expect(session.log.map((row) => row.id)).toEqual([
    "spuren-gefunden",
    "old-metta",
    "lichter-in-der-bucht",
  ]);
  expect(session.log.map((row) => row.sceneId)).toEqual([
    "lighthouse-arrival",
    "lighthouse-arrival",
    undefined,
  ]);
  expect(session.log).toEqual(
    sessionFixture.log.map((row) => ({ ...row, rev: expect.any(Number) })),
  );
  // A pause is an INTERVAL, with the server's epoch reading beside each
  // wall clock.
  expect(session.pauses).toEqual([
    {
      id: "abendessen",
      from: "2026-01-15T20:30:00",
      fromMs: expect.any(Number),
      to: "2026-01-15T21:10:00",
      toMs: expect.any(Number),
      rev: expect.any(Number),
    },
  ]);

  // --- the ideas: each its own resource --------------------------------------
  expect(await getIdeas(api)).toEqual([
    { ...(await fixture("ideas", "dorfschmied")), id: "dorfschmied", done: false, rev: 1 },
  ]);

  // --- the glossary terms: each its own resource ----------------------------
  const terms = await getGlossaryTerms(api);
  expect(terms.find((term) => term.id === "lighthouse-keeper")).toEqual({
    ...(await fixture("glossary-terms", "lighthouse-keeper")),
    id: "lighthouse-keeper",
    term: "lighthouse keeper",
    rev: 1,
  });
  expect(terms.map((term) => term.term)).toContain("smugglers' cove");
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
