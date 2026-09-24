// Unit tests for the generator view's derivations: the
// new-chapter id (numeric prefix + kebab slug), the client-side properties
// edits a review keeps per draft, the labels — and which
// state the server's job puts the view in.

import { describe, expect, test } from "bun:test";

import type { GenerateJob } from "@grimoire/shared/types";

import { translator } from "@/i18n/format";
import {
  GENERATE_JOB_POLL_MS,
  generateJobPollMs,
  generateJobQueryOptions,
} from "@/lib/use-generate-job";
import {
  applySummary,
  chapterIdError,
  chapterIdValue,
  contextHint,
  jobNpcs,
  jobParts,
  acceptProgress,
  jobProgress,
  locationState,
  openLocations,
  mergeReviewPatch,
  openParts,
  partState,
  reviewOf,
  knowledgeHint,
  generatePhase,
  runJobArrived,
  hasReviewableParts,
  jobErrorBody,
  jobMode,
  draftOf,
  mergeDraftEdits,
  newChapterId,
  nextChapterPrefix,
  npcChangeOf,
  npcIdError,
  npcOf,
  npcState,
  openNpcs,
  restoredMode,
  slugify,
  stringField,
  stringList,
  partsStillRunning,
  pipelineCostLabel,
  pipelineProgress,
  usageLabel,
} from "./generate";

// The copy comes from the catalog and the translator is passed in — so a
// test says which language it asserts.
const t = translator("de");
const tEn = translator("en");

describe("slugify", () => {
  test("kebab-cases a German chapter title", () => {
    expect(slugify("Die Schmugglerbucht")).toBe("die-schmugglerbucht");
  });

  test("transliterates umlauts and ß instead of dropping them", () => {
    expect(slugify("Über den Fährmann, groß")).toBe("ueber-den-faehrmann-gross");
    expect(slugify("Öde Höhle")).toBe("oede-hoehle");
  });

  test("strips accents and punctuation, collapses separators", () => {
    expect(slugify("Café  am –– Kai!")).toBe("cafe-am-kai");
    expect(slugify("Kapitel 2: Der Turm")).toBe("kapitel-2-der-turm");
  });

  test("no usable characters yields an empty slug", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("…!?")).toBe("");
  });
});

describe("nextChapterPrefix", () => {
  test("first chapter of an empty campaign", () => {
    expect(nextChapterPrefix([])).toBe("01");
  });

  test("continues after the highest existing prefix", () => {
    expect(nextChapterPrefix(["01-salzhafen"])).toBe("02");
    expect(nextChapterPrefix(["01-a", "02-b", "03-c"])).toBe("04");
  });

  test("gaps and unordered ids do not lower the number", () => {
    expect(nextChapterPrefix(["03-c", "01-a"])).toBe("04");
    expect(nextChapterPrefix(["09-x"])).toBe("10");
  });

  test("keeps the widest existing padding", () => {
    expect(nextChapterPrefix(["001-a", "002-b"])).toBe("003");
  });

  test("chapters without a numeric prefix are ignored", () => {
    expect(nextChapterPrefix(["prolog", "anhang"])).toBe("01");
    expect(nextChapterPrefix(["prolog", "07-see"])).toBe("08");
  });
});

describe("newChapterId", () => {
  test("prefix and slug form the directory name", () => {
    expect(newChapterId("Die Schmugglerbucht", ["01-salzhafen"])).toBe("02-die-schmugglerbucht");
  });

  test("undefined while the title has no slug yet", () => {
    expect(newChapterId("", ["01-salzhafen"])).toBeUndefined();
    expect(newChapterId("  ", [])).toBeUndefined();
  });
});

describe("chapterIdError", () => {
  test("accepts kebab ids with and without a number prefix", () => {
    expect(chapterIdError("03-schmugglerbucht", t)).toBeUndefined();
    expect(chapterIdError("schmugglerbucht", t)).toBeUndefined();
    expect(chapterIdError("prolog", t)).toBeUndefined();
    expect(chapterIdError("007", t)).toBeUndefined();
  });

  test("rejects an empty id", () => {
    expect(chapterIdError("", t)).toBe("Kapitel-Kennung fehlt.");
  });

  test("rejects path separators", () => {
    expect(chapterIdError("a/b", t)).toContain("Schrägstriche");
    expect(chapterIdError("a\\b", t)).toContain("Schrägstriche");
    expect(chapterIdError("/absolut", t)).toContain("Schrägstriche");
  });

  test("rejects traversal and hidden segments", () => {
    expect(chapterIdError("..", t)).toContain("..");
    expect(chapterIdError("a..b", t)).toContain("..");
    expect(chapterIdError(".versteckt", t)).toContain("Punkt am Anfang");
  });

  test("rejects whitespace anywhere", () => {
    expect(chapterIdError("03 schmugglerbucht", t)).toContain("Leerzeichen");
    expect(chapterIdError(" 03-bucht", t)).toContain("Leerzeichen");
    expect(chapterIdError("03-bucht ", t)).toContain("Leerzeichen");
    expect(chapterIdError("   ", t)).toContain("Leerzeichen");
    expect(chapterIdError("03-bucht\t", t)).toContain("Leerzeichen");
  });

  test("rejects anything outside lowercase kebab — no silent rewrite", () => {
    const charset = "Nur Kleinbuchstaben, Ziffern und Bindestriche.";
    expect(chapterIdError("03-Schmugglerbucht", t)).toBe(charset);
    expect(chapterIdError("03-schmüggler", t)).toBe(charset);
    expect(chapterIdError("03_bucht", t)).toBe(charset);
    expect(chapterIdError("bucht.md", t)).toBe(charset);
    expect(chapterIdError("bucht\0", t)).toBe(charset);
  });

  test("rejects the reserved campaign directories", () => {
    expect(chapterIdError("npcs", t)).toContain("reserviert");
    expect(chapterIdError("locations", t)).toContain("reserviert");
    expect(chapterIdError("sessions", t)).toContain("reserviert");
    // Only the exact names are reserved.
    expect(chapterIdError("02-sessions-am-kai", t)).toBeUndefined();
  });
});

describe("chapterIdValue", () => {
  test("follows the title while the field is untouched", () => {
    expect(chapterIdValue("02-die-schmugglerbucht", undefined)).toBe("02-die-schmugglerbucht");
    expect(chapterIdValue(undefined, undefined)).toBe("");
  });

  test("a manual value wins over the suggestion", () => {
    expect(chapterIdValue("02-die-schmugglerbucht", "03-bucht")).toBe("03-bucht");
    // …even when the title yields no suggestion at all.
    expect(chapterIdValue(undefined, "03-bucht")).toBe("03-bucht");
  });

  test("the suggestion follows the title only until the first manual edit", () => {
    const ids = ["01-salzhafen"];
    // Typing the title: the field mirrors the suggestion.
    let manual: string | undefined;
    expect(chapterIdValue(newChapterId("Die Bucht", ids), manual)).toBe("02-die-bucht");
    // The DM edits the id — from here the title no longer moves it.
    manual = "07-bucht";
    expect(chapterIdValue(newChapterId("Die Bucht", ids), manual)).toBe("07-bucht");
    expect(chapterIdValue(newChapterId("Ganz anderer Titel", ids), manual)).toBe("07-bucht");
    // Clearing the field (the view maps "" back to undefined) hands it back.
    manual = undefined;
    expect(chapterIdValue(newChapterId("Ganz anderer Titel", ids), manual)).toBe(
      "02-ganz-anderer-titel",
    );
  });
});

describe("draftOf and mergeDraftEdits", () => {
  const generated = { properties: { title: "Am Kai", status: "draft" }, body: "## Flow\n" };

  test("the generated draft stands where no edit touched it", () => {
    expect(draftOf(generated, undefined, undefined)).toEqual(generated);
    expect(draftOf(generated, { body: "Neu.\n" })).toEqual({
      properties: generated.properties,
      body: "Neu.\n",
    });
  });

  test("the local buffer wins over the edit stored on the job", () => {
    expect(
      draftOf(generated, { body: "gespeichert" }, { body: "im Tippen" }).body,
    ).toBe("im Tippen");
    // The halves are independent: a body buffer leaves stored properties be.
    expect(
      draftOf(generated, { properties: { title: "Am Kai (neu)" } }, { body: "im Tippen" }),
    ).toEqual({ properties: { title: "Am Kai (neu)" }, body: "im Tippen" });
  });

  test("a patch merges per address AND per half", () => {
    const before = { "01-x/a": { properties: { title: "A" } } };
    const after = mergeDraftEdits(before, { "01-x/a": { body: "Text" } });
    expect(after["01-x/a"]).toEqual({ properties: { title: "A" }, body: "Text" });
    // A half the patch carries replaces its counterpart whole.
    expect(mergeDraftEdits(after, { "01-x/a": { body: "Anders" } })["01-x/a"]).toEqual({
      properties: { title: "A" },
      body: "Anders",
    });
    // And an untouched address is left alone.
    expect(mergeDraftEdits(before, { "01-x/b": { body: "B" } })["01-x/a"]).toEqual(
      before["01-x/a"],
    );
  });
});

describe("labels", () => {
  // What countLabel used to prove — a count and its noun agree — is an ICU
  // plural inside the catalog keys now, so it is asserted through the two
  // functions that consume them.
  test("applySummary reads like the prototype's button", () => {
    expect(applySummary(1, 1, t)).toBe("1 Szene · 1 vorgeschlagener Eintrag");
    expect(applySummary(2, 0, t)).toBe("2 Szenen · 0 vorgeschlagene Einträge");
    expect(applySummary(0, 3, t)).toBe("0 Szenen · 3 vorgeschlagene Einträge");
  });

  test("contextHint names the two counts the tree carries", () => {
    expect(contextHint(2, 1, t)).toBe("2 NPCs \u00b7 1 Ort");
    expect(contextHint(1, 0, t)).toBe("1 NPC \u00b7 0 Orte");
  });

  test("knowledgeHint COUNTS the knowledge entries", () => {
    // A count, not a yes/no: the DM comes here right after writing a rule and
    // the number is what confirms it travels. Zero says so in words — the
    // line has to read as a sentence either way.
    expect(knowledgeHint(0, t)).toBe("kein Kampagnenwissen");
    expect(knowledgeHint(1, t)).toBe("1 Wissens-Eintrag");
    expect(knowledgeHint(3, t)).toBe("3 Wissens-Eintr\u00e4ge");
  });
});

describe("stringList", () => {
  test("keeps strings, drops everything else", () => {
    expect(stringList(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(stringList(undefined)).toEqual([]);
    expect(stringList("a")).toEqual([]);
  });
});

describe("stringField", () => {
  test("keeps a non-empty string, drops everything else", () => {
    expect(stringField("Rohantwort")).toBe("Rohantwort");
    expect(stringField("")).toBeUndefined();
    expect(stringField(42)).toBeUndefined();
    expect(stringField(undefined)).toBeUndefined();
  });
});

describe("usageLabel", () => {
  test("sums the tokens and groups them the German way", () => {
    expect(usageLabel({ inputTokens: 11400, outputTokens: 1000, attempts: 1 }, t)).toBe(
      "~12.400 Tokens · 1 Versuch",
    );
    expect(usageLabel({ inputTokens: 40000, outputTokens: 1234, attempts: 3 }, t)).toBe(
      "~41.234 Tokens · 3 Versuche",
    );
    // below the grouping threshold, and the plural of 0
    expect(usageLabel({ inputTokens: 800, outputTokens: 20, attempts: 2 }, t)).toBe(
      "~820 Tokens · 2 Versuche",
    );
    expect(usageLabel({ inputTokens: 1000000, outputTokens: 0, attempts: 1 }, t)).toBe(
      "~1.000.000 Tokens · 1 Versuch",
    );
  });

  // The separator is catalog data (generate.usage.group), so the other
  // language has to be proven too — not just the German rule.
  test("the thousands separator comes from the catalog", () => {
    expect(usageLabel({ inputTokens: 11400, outputTokens: 1000, attempts: 1 }, tEn)).toBe(
      "~12,400 tokens · 1 attempt",
    );
    expect(usageLabel({ inputTokens: 1000000, outputTokens: 0, attempts: 3 }, tEn)).toBe(
      "~1,000,000 tokens · 3 attempts",
    );
  });

  test("nothing to show without usable numbers", () => {
    expect(usageLabel(undefined, t)).toBeUndefined();
    expect(usageLabel(null, t)).toBeUndefined();
    expect(usageLabel("12400", t)).toBeUndefined();
    expect(usageLabel([1, 2], t)).toBeUndefined();
    expect(usageLabel({}, t)).toBeUndefined();
    expect(usageLabel({ inputTokens: 0, outputTokens: 0, attempts: 0 }, t)).toBeUndefined();
  });

  test("survives a partial usage object instead of printing NaN", () => {
    expect(usageLabel({ attempts: 1 }, t)).toBe("~0 Tokens · 1 Versuch");
    expect(usageLabel({ inputTokens: 500, attempts: "viele" }, t)).toBe("~500 Tokens · 0 Versuche");
  });
});

// --- the view's state, derived from the server's job ----------------------

describe("generatePhase", () => {
  const base = { applied: false, starting: false, jobChecked: true };

  test("no job: the input form", () => {
    expect(generatePhase(base)).toBe("input");
  });

  test("before the first job lookup answers, neither form nor spinner", () => {
    expect(generatePhase({ ...base, jobChecked: false })).toBe("checking");
  });

  test("the server's job decides: running -> working, done -> review", () => {
    expect(generatePhase({ ...base, jobStatus: "running" })).toBe("working");
    expect(generatePhase({ ...base, jobStatus: "done" })).toBe("review");
  });

  test("a failed job belongs to the input state — its error block sits there", () => {
    expect(generatePhase({ ...base, jobStatus: "failed" })).toBe("input");
  });

  test("a start in flight is already the working state", () => {
    // …even before the job shows up in the query (and before it was checked)
    expect(generatePhase({ ...base, starting: true })).toBe("working");
    expect(generatePhase({ ...base, starting: true, jobChecked: false })).toBe("working");
  });

  test("a finished apply wins over everything the job still says", () => {
    expect(generatePhase({ ...base, applied: true, jobStatus: "done" })).toBe("done");
    expect(generatePhase({ ...base, applied: true, starting: true })).toBe("done");
  });
});

describe("runJobArrived", () => {
  const staleJobId = "job-before-the-click";

  test("nothing in the cache is never the run's job", () => {
    expect(runJobArrived({ jobId: null, staleJobId })).toBe(false);
    expect(runJobArrived({ jobId: null, staleJobId: null })).toBe(false);
  });

  test("the job that was there at the click is not the new run's", () => {
    expect(runJobArrived({ jobId: staleJobId, staleJobId })).toBe(false);
    expect(runJobArrived({ jobId: "job-of-the-new-run", staleJobId })).toBe(true);
    // Nothing there at the click: any job is the new one.
    expect(runJobArrived({ jobId: "job-of-the-new-run", staleJobId: null })).toBe(true);
  });

  test("an ADOPTED job is the run's job although it was there before", () => {
    // A 409 hands back the id of the job that is already running and the app
    // adopts it (api.ts startGenerateJob) — the only case in which the id
    // from before the click IS what this run is about.
    expect(
      runJobArrived({ jobId: staleJobId, staleJobId, startedJobId: staleJobId }),
    ).toBe(true);
  });
});

/**
 * The sequence of the stall reported on 15.09.: the click, a GET
 * that overtakes the new row (404 -> null), and then a poll that already sees
 * the finished run — all while `POST /generate` is STILL in flight, which is
 * the normal case with a fast model. The review has to be on the screen at
 * the end of it, and the poll loop has to be alive for every step before.
 */
describe("start pending -> 404/null -> done", () => {
  const phaseOf = (jobId: string | null, status?: GenerateJob["status"]) => {
    const arrived = runJobArrived({ jobId, staleJobId: null });
    return generatePhase({
      applied: false,
      starting: !arrived,
      jobChecked: true,
      ...(status === undefined ? {} : { jobStatus: status }),
    });
  };

  test("the spinner stands until the run's job answers — and not one step longer", () => {
    // 1. the click: no job yet, the POST is on its way.
    expect(phaseOf(null)).toBe("working");
    expect(generateJobPollMs(null, true)).toBe(GENERATE_JOB_POLL_MS);
    // 2. the GET that overtook the row: still no job, still polling.
    expect(phaseOf(null)).toBe("working");
    // 3. the first poll that answers already carries the FINISHED run. The
    //    202 of the same run has not arrived yet — and it must not matter:
    //    the job is the truth about the run, the request that started it is
    //    not. This is the step that used to keep the spinner up.
    expect(phaseOf("job-of-the-new-run", "done")).toBe("review");
    // 4. …and with the run's job on the table, nothing has to be polled.
    expect(generateJobPollMs({ status: "done" } as GenerateJob)).toBe(false);
  });
});

describe("jobErrorBody", () => {
  const failed = (error: unknown) =>
    ({
      id: "j1",
      campaign: "beispiel",
      chapter: "01-salzhafen",
      status: "failed",
      startedAt: "2026-08-20T10:00:00.000Z",
      draftEdits: {},
      error,
    }) as never;

  test("hands back the error body of a failed job unchanged", () => {
    const body = {
      error: "generation failed mechanical validation after retries",
      validationErrors: ['scene "x": "status" must be "draft"'],
      rawReply: "…",
      usage: { inputTokens: 1, outputTokens: 2, attempts: 2 },
    };
    expect(jobErrorBody(failed({ status: 422, body }))).toEqual(body);
  });

  test("nothing for a job that is not failed, or has no usable body", () => {
    expect(jobErrorBody(undefined)).toBeUndefined();
    expect(jobErrorBody(null)).toBeUndefined();
    expect(jobErrorBody(failed(undefined))).toBeUndefined();
    expect(jobErrorBody(failed({ status: 500, body: "kaputt" }))).toBeUndefined();
    expect(
      jobErrorBody({
        id: "j2",
        campaign: "beispiel",
        chapter: "01-salzhafen",
        status: "running",
        startedAt: "2026-08-20T10:00:00.000Z",
        draftEdits: {},
        npcEdits: {},
      }),
    ).toBeUndefined();
  });
});

// --- generator mode --------------------------------------------------------

describe("jobMode", () => {
  const job = (kind?: string) =>
    ({
      id: "j1",
      campaign: "beispiel",
      status: "done",
      startedAt: "2026-08-20T10:00:00.000Z",
      draftEdits: {},
      ...(kind === undefined ? {} : { kind }),
    }) as never;

  test("an npc job is npc mode", () => {
    expect(jobMode(job("npc"))).toBe("npc");
  });

  test("everything else is scene mode — also a payload without kind", () => {
    expect(jobMode(job("scene"))).toBe("scene");
    expect(jobMode(job())).toBe("scene");
    expect(jobMode(job("etwas-neues"))).toBe("scene");
    expect(jobMode(null)).toBe("scene");
    expect(jobMode(undefined)).toBe("scene");
  });
});

describe("restoredMode", () => {
  const job = (kind: "scene" | "npc") =>
    ({
      id: "j1",
      campaign: "beispiel",
      kind,
      status: "running",
      startedAt: "2026-08-20T10:00:00.000Z",
      draftEdits: {},
    }) as never;

  test("a job that exists decides the mode — in both directions", () => {
    expect(restoredMode("scene", job("npc"))).toBe("npc");
    expect(restoredMode("npc", job("scene"))).toBe("scene");
  });

  test("no job leaves the DM's own choice alone", () => {
    // applying/discarding an npc run must not throw the view back to scenes
    expect(restoredMode("npc", null)).toBe("npc");
    expect(restoredMode("npc", undefined)).toBe("npc");
    expect(restoredMode("scene", null)).toBe("scene");
  });
});

describe("npcIdError", () => {
  test("an empty field is not an error — it means 'the model chooses'", () => {
    expect(npcIdError("", [], t)).toBeUndefined();
  });

  test("accepts kebab ids", () => {
    expect(npcIdError("grella", [], t)).toBeUndefined();
    expect(npcIdError("die-graue-witwe", [], t)).toBeUndefined();
    expect(npcIdError("wache-2", [], t)).toBeUndefined();
  });

  test("rejects what the server would reject", () => {
    expect(npcIdError("Grella", [], t)).toContain("Kleinbuchstaben");
    expect(npcIdError("die graue", [], t)).toContain("Leerzeichen");
    expect(npcIdError("npcs/grella", [], t)).toContain("Schrägstriche");
    expect(npcIdError("grella_2", [], t)).toContain("Kleinbuchstaben");
    expect(npcIdError("-grella", [], t)).toContain("Kleinbuchstaben");
    expect(npcIdError("gräfin", [], t)).toContain("Kleinbuchstaben");
  });

  test("an id whose entry exists is named as such — the server would 409", () => {
    expect(npcIdError("fenn", ["fenn", "jorna"], t)).toContain("existiert schon");
    expect(npcIdError("grella", ["fenn", "jorna"], t)).toBeUndefined();
  });
});

// --- the review state on the job -------------------------------------------

describe("review state mapping", () => {
  const job = (over: Partial<GenerateJob> = {}): GenerateJob =>
    ({
      id: "j1",
      campaign: "beispiel",
      kind: "scene",
      status: "done",
      startedAt: "2026-01-01T00:00:00.000Z",
      draftEdits: {},
      npcEdits: {},
      rev: 0,
      result: {
        scenes: [
          { path: "01-x/a", properties: {}, body: "a" },
          { path: "01-x/b", properties: {}, body: "b" },
        ],
        npcs: [{ id: "grella", name: "Grella", status: "unknown", body: "s" }],
        locations: [],
        warnings: [],
      },
      ...over,
    }) as GenerateJob;

  test("a payload without a review degrades to „nothing decided yet“", () => {
    expect(reviewOf(job())).toEqual({
      dropped: [],
      fields: {},
      blocks: {},
      written: {},
      npcs: {},
      writtenNpcs: [],
      locations: {},
      writtenLocations: [],
    });
    expect(reviewOf(null)).toEqual(reviewOf(undefined));
  });

  test("a patch merges per key — and `null` puts a decision back to open", () => {
    let next = mergeReviewPatch(job(), { npcs: { grella: "accepted" } });
    next = mergeReviewPatch(next, { edits: { "01-x/a": { body: "typed" } } });
    expect(next.review?.npcs).toEqual({ grella: "accepted" });
    expect(next.draftEdits["01-x/a"]).toEqual({ body: "typed" });

    next = mergeReviewPatch(next, { npcs: { grella: null } });
    expect(next.review?.npcs).toEqual({});
    // The unrelated half is untouched — that is what merging has to mean.
    expect(next.draftEdits["01-x/a"]).toEqual({ body: "typed" });
  });

  test("`null` clears a field or block decision, mirroring the server", () => {
    // What an augment 409 needs: the re-alignment renames the block ids, so
    // the decisions cut against the old ones have to be deletable.
    let next = mergeReviewPatch(job(), { fields: { role: true }, blocks: { aug1: false } });
    expect(next.review?.blocks).toEqual({ aug1: false });

    next = mergeReviewPatch(next, { blocks: { aug1: null } });
    expect(next.review?.blocks).toEqual({});
    expect(next.review?.fields).toEqual({ role: true });

    next = mergeReviewPatch(next, { fields: { role: null } });
    expect(next.review?.fields).toEqual({});
  });

  test("an npc change merges field by field, and `null` clears a field of the proposal", () => {
    let next = mergeReviewPatch(job(), { npcEdits: { grella: { role: "Fischerin" } } });
    next = mergeReviewPatch(next, { npcEdits: { grella: { body: "Neu.\n" } } });
    expect(next.npcEdits).toEqual({ grella: { role: "Fischerin", body: "Neu.\n" } });
    const proposed = { id: "grella", name: "Grella", status: "unknown" as const, body: "s", voice: "leise" };
    expect(npcOf(proposed, next.npcEdits.grella, { voice: null })).toEqual({
      id: "grella",
      name: "Grella",
      status: "unknown",
      role: "Fischerin",
      body: "Neu.\n",
    });
  });

  test("the form of a proposed npc becomes its change: every form field named", () => {
    const keys = ["name", "role", "status", "quickstats", "motivation"];
    expect(
      npcChangeOf({ name: "Grella", status: "alive", quickstats: { insight: "+2" } }, keys),
    ).toEqual({
      name: "Grella",
      role: null,
      status: "alive",
      quickstats: { insight: "+2" },
      motivation: null,
    });
    // A required field the form left blank is not named — the proposal keeps it.
    expect(npcChangeOf({ status: "alive" }, ["name", "status"])).toEqual({ status: "alive" });
    // A value the npc's schema refuses queues nothing.
    expect(npcChangeOf({ status: "verschollen" }, ["status"])).toBeUndefined();
  });

  test("`dropped` is a set sent whole, not a merge", () => {
    const next = mergeReviewPatch(
      mergeReviewPatch(job(), { dropped: ["01-x/a"] }),
      { dropped: ["01-x/b"] },
    );
    expect(next.review?.dropped).toEqual(["01-x/b"]);
  });

  test("a scene is open, written or dropped; a proposed npc open, written or rejected", () => {
    const decided = job({
      review: {
        dropped: ["01-x/b"],
        fields: {},
        blocks: {},
        written: { "01-x/a": "01-x/a" },
        npcs: { grella: "rejected" },
        writtenNpcs: [],
        locations: {},
        writtenLocations: [],
      },
    });
    expect(partState(decided, "01-x/a")).toBe("written");
    expect(partState(decided, "01-x/b")).toBe("dropped");
    expect(npcState(decided, "grella")).toBe("rejected");
    expect(openNpcs(decided)).toEqual([]);
    expect(partState(job(), "01-x/a")).toBe("open");
    expect(npcState(job(), "grella")).toBe("open");
  });

  test("the scenes of a run by path, its npcs by id — the NPC run's one npc among them", () => {
    expect(jobParts(job())).toEqual(["01-x/a", "01-x/b"]);
    expect(jobNpcs(job())).toEqual(["grella"]);
    const npcRun = job({
      result: undefined,
      kind: "npc",
      npcResult: { npc: { id: "brakk", name: "Brakk", status: "unknown", body: "m" }, warnings: [] },
    });
    expect(jobParts(npcRun)).toEqual([]);
    expect(jobNpcs(npcRun)).toEqual(["brakk"]);
  });

  test("progress counts the written parts — „2 von 3 übernommen“", () => {
    expect(jobProgress(job())).toEqual({ written: 0, total: 3 });
    const partly = job({
      review: {
        dropped: [],
        fields: {},
        blocks: {},
        written: { "01-x/a": "01-x/a" },
        npcs: {},
        writtenNpcs: ["grella"],
        locations: {},
        writtenLocations: [],
      },
    });
    expect(jobProgress(partly)).toEqual({ written: 2, total: 3 });
    expect(openParts(partly)).toEqual(["01-x/b"]);
    expect(npcState(partly, "grella")).toBe("written");
  });

  test("a proposed location is decided, written and counted by its id", () => {
    const withLocation = job({
      result: {
        scenes: [{ path: "01-x/a", properties: {}, body: "a" }],
        npcs: [],
        locations: [{ id: "alte-mole", name: "Alte Mole", body: "m" }],
        warnings: [],
      },
    });
    expect(locationState(withLocation, "alte-mole")).toBe("open");
    expect(openLocations(withLocation)).toEqual(["alte-mole"]);
    expect(jobProgress(withLocation)).toEqual({ written: 0, total: 2 });
    const rejected = mergeReviewPatch(withLocation, { locations: { "alte-mole": "rejected" } });
    expect(locationState(rejected, "alte-mole")).toBe("rejected");
    expect(openLocations(rejected)).toEqual([]);
    const reopened = mergeReviewPatch(rejected, { locations: { "alte-mole": null } });
    expect(reopened.review?.locations).toEqual({});
    const written = job({
      ...withLocation,
      review: { ...reviewOf(withLocation), writtenLocations: ["alte-mole"] },
    });
    expect(locationState(written, "alte-mole")).toBe("written");
    expect(jobProgress(written)).toEqual({ written: 1, total: 2 });
  });

  test("a dropped or rejected part is not part of the rest", () => {
    const decided = job({
      review: {
        dropped: ["01-x/b"],
        fields: {},
        blocks: {},
        written: {},
        npcs: { grella: "rejected" },
        writtenNpcs: [],
        locations: {},
        writtenLocations: [],
      },
    });
    expect(openParts(decided)).toEqual(["01-x/a"]);
    expect(openNpcs(decided)).toEqual([]);
  });
});

// --- the pipeline of a scene run -------------------------------------------

describe("the run's parts", () => {
  /** A scene job with three scene parts in outline order. */
  function job(
    statuses: Array<"pending" | "running" | "done" | "failed">,
    over: Partial<GenerateJob> = {},
  ): GenerateJob {
    return {
      id: "j1",
      campaign: "beispiel",
      kind: "scene",
      chapter: "01-salzhafen",
      status: "running",
      startedAt: "2026-09-15T10:00:00.000Z",
      draftEdits: {},
      npcEdits: {},
      pipeline: {
        parts: statuses.map((status, i) => ({
          key: `scene:s${i}`,
          kind: "scene" as const,
          id: `s${i}`,
          title: `Szene ${i}`,
          status,
        })),
        totals: { inputTokens: 11_000, outputTokens: 1_400, calls: 5 },
      },
      ...over,
    };
  }

  test("a RUNNING run with a finished part is already the review", () => {
    const base = { applied: false, starting: false, jobChecked: true, jobStatus: "running" as const };
    // Nothing done yet: the spinner is still the honest answer.
    expect(generatePhase({ ...base, hasParts: false })).toBe("working");
    expect(generatePhase({ ...base, hasParts: true })).toBe("review");
    expect(hasReviewableParts(job(["running", "pending", "pending"]))).toBe(false);
    expect(hasReviewableParts(job(["done", "running", "pending"]))).toBe(true);
    // A FAILED part is reviewable too — it carries its retry action.
    expect(hasReviewableParts(job(["failed", "running", "pending"]))).toBe(true);
  });

  test("the poll survives the window in which there is NO job yet", () => {
    // The regression this guards: right after the run was started a GET can
    // overtake the new row and answer 404 → `null`. A
    // `null` is not a running job, so the interval went off and nothing ever
    // switched it back on — the view sat on the spinner until a reload.
    expect(generateJobPollMs(job(["running"]))).toBe(GENERATE_JOB_POLL_MS);
    expect(generateJobPollMs(null)).toBe(false);
    expect(generateJobPollMs(undefined)).toBe(false);
    expect(generateJobPollMs(null, true)).toBe(GENERATE_JOB_POLL_MS);
    expect(generateJobPollMs(undefined, true)).toBe(GENERATE_JOB_POLL_MS);
    // …and a caller that is waiting for a run's OWN job keeps polling even
    // though something settled sits in the cache: that is either the previous
    // run's job or a `null`. Switching the loop off there is how
    // the spinner became terminal.
    expect(generateJobPollMs({ ...job(["done"]), status: "done" }, true)).toBe(
      GENERATE_JOB_POLL_MS,
    );
    // Nobody waiting: a settled job needs no poll.
    expect(generateJobPollMs({ ...job(["done"]), status: "done" })).toBe(false);
  });

  test("the poll keeps running while the tab is hidden", () => {
    // A run lives on the server, so it finishes whether or not this tab is
    // in front. TanStack Query suspends refetch intervals on a hidden tab
    // unless refetchIntervalInBackground is set, which meant a run that
    // completed while the DM was reading another tab was only noticed when
    // this one regained focus — the view kept showing "working" until then.
    const options = generateJobQueryOptions("beispiel", { expectJob: true });
    expect(options.refetchIntervalInBackground).toBe(true);
    // The interval itself stays bounded: no run, no polling.
    expect(
      generateJobQueryOptions("beispiel").refetchInterval({
        state: { data: { ...job(["done"]), status: "done" } },
      }),
    ).toBe(false);
    expect(options.refetchInterval({ state: { data: null } })).toBe(
      GENERATE_JOB_POLL_MS,
    );
    // An empty campaign has nothing to ask about.
    expect(generateJobQueryOptions("").enabled).toBe(false);
  });

  test("„noch offen“ is pending or running, never failed", () => {
    expect(partsStillRunning(job(["done", "running", "pending"]))).toBe(true);
    // A failed part is settled: it waits for the DM, not for the model.
    expect(partsStillRunning(job(["done", "failed", "done"]))).toBe(false);
    expect(partsStillRunning(null)).toBe(false);
  });

  test("the progress line counts the SCENES and disappears when the run is over", () => {
    expect(pipelineProgress(job(["done", "running", "pending"]), t)).toBe(
      "1 von 3 Szenen fertig",
    );
    expect(pipelineProgress(job(["done", "done", "running"]), tEn)).toBe(
      "2 of 3 scenes finished",
    );
    // Nothing open any more, and a single-call run: no line at all.
    expect(pipelineProgress(job(["done", "done", "failed"]), t)).toBeUndefined();
    expect(pipelineProgress(null, t)).toBeUndefined();
  });

  test("„übernommen“ counts against every part of the RUN", () => {
    // Two of three parts answered, and the DM took one of them.
    const run = job(["done", "done", "running"], {
      result: {
        scenes: [
          { path: "01-salzhafen/s0", properties: {}, body: "a" },
          { path: "01-salzhafen/s1", properties: {}, body: "b" },
        ],
        npcs: [],
        locations: [],
        warnings: [],
      },
      review: {
        dropped: [],
        fields: {},
        blocks: {},
        written: { "01-salzhafen/s0": "01-salzhafen/s0" },
        npcs: {},
        writtenNpcs: [],
        locations: {},
        writtenLocations: [],
      },
    });
    // What the run PRODUCED — and why that number confused the chip.
    expect(jobProgress(run)).toEqual({ written: 1, total: 2 });
    expect(acceptProgress(run)).toEqual({ written: 1, total: 3 });
    expect(t("topbar.generator.progress", acceptProgress(run))).toBe("1 von 3 übernommen");
    // A run without a pipeline (a single call) is left exactly as it was.
    const single = { ...run, pipeline: undefined };
    expect(acceptProgress(single)).toEqual(jobProgress(single));
    expect(acceptProgress(null)).toEqual({ written: 0, total: 0 });
    // An accepted proposed npc is a part of the review without being a part
    // of the outline — the total never falls below what is written.
    const withNpc = job(["done"], {
      result: {
        scenes: [{ path: "01-salzhafen/s0", properties: {}, body: "a" }],
        npcs: [{ id: "grella", name: "Grella", status: "unknown", body: "s" }],
        locations: [],
        warnings: [],
      },
      review: {
        dropped: [],
        fields: {},
        blocks: {},
        written: { "01-salzhafen/s0": "01-salzhafen/s0" },
        npcs: { grella: "accepted" },
        writtenNpcs: ["grella"],
        locations: {},
        writtenLocations: [],
      },
    });
    expect(acceptProgress(withNpc)).toEqual({ written: 2, total: 2 });
  });

  test("the cost line sums the run's tokens and COUNTS CALLS", () => {
    expect(pipelineCostLabel(job(["done"]), t)).toBe("~12.400 Tokens · 5 Aufrufe");
    expect(pipelineCostLabel(job(["done"]), tEn)).toBe("~12,400 tokens · 5 calls");
    // A run whose endpoint reports no tokens still reports its calls.
    const quiet = job(["done"]);
    quiet.pipeline!.totals = { inputTokens: 0, outputTokens: 0, calls: 2 };
    expect(pipelineCostLabel(quiet, t)).toBe("~0 Tokens · 2 Aufrufe");
    // …and a run with nothing at all reports nothing.
    quiet.pipeline!.totals = { inputTokens: 0, outputTokens: 0, calls: 0 };
    expect(pipelineCostLabel(quiet, t)).toBeUndefined();
    expect(pipelineCostLabel(null, t)).toBeUndefined();
  });
});
