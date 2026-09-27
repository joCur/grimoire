// The pipelined scene run — the pieces that are worth testing
// on their own, plus the run mechanics a rendering test cannot see.
//
// The pure halves (the outline validation, the excerpt cut, the prompt
// assembly) are called directly: they are the rules the whole run rests on
// and going through HTTP for them would only make a failure harder to read.
// The run mechanics — a failed part that does not take its siblings down, a
// retry that re-runs ONE part, a cancel that stops the open rest — go through
// the real endpoints against the real job row.

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { GeneratorJob } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generator-jobs";
import { acceptBody, jobsUrl, jobUrl, partUrl, readJob } from "./support/generator-jobs";
import { failInterruptedJobs, RESTART_FAILURE_MESSAGE } from "../src/db/job-boot";
import { getDb } from "../src/store/handle";
import { setProviderForTests } from "../src/generator";
import {
  assignmentBlock,
  cutExcerpt,
  locationContext,
  MAX_OUTLINE_PROPOSALS,
  MAX_OUTLINE_SCENES,
  npcContext,
  outlineBlock,
  planOf,
  outlineParts,
  sceneSystemPrompt,
  validateOutlineReply,
  type RunOutline,
  type SceneContext,
} from "../src/generate-pipeline";
import { dropStore, seedStore } from "./support/store";
import { PipelineFake } from "./support/pipeline-fake";
import {
  ASSIGNMENT_HEADING,
  buildPromptParts,
  type CompletionResult,
  type CorrectionTurn,
  type GenerateRequest,
  type LLMProvider,
} from "../src/llm-provider";

// --- the outline validation ---------------------------------------------------

const CTX = {
  chapter: "01-salt-harbour",
  newChapter: false,
  npcs: [{ id: "fenn", name: "Fenn" }],
  locations: [{ id: "harbour", name: "The Harbour" }],
  knowledge: "",
  glossary: "",
  namingRules: [],
  npcIds: new Set(["fenn"]),
  locationIds: new Set(["harbour"]),
  sceneIds: new Set<string>(),
} satisfies SceneContext;

function outlineReply(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    scenes: [
      {
        id: "night-watch",
        title: "Night Watch on the Quay",
        type: "planned",
        location: "harbour",
        sourceExcerpt: { first: "One.", last: "Two." },
        refs: [],
      },
    ],
    npcs: [],
    locations: [],
    warnings: [],
    ...over,
  });
}

/** The errors of an outline reply, or [] when it validated. */
function outlineErrors(raw: string): string[] {
  const outcome = validateOutlineReply(raw, CTX);
  return outcome.ok ? [] : outcome.errors;
}

test("a well-formed outline validates and keeps its order", () => {
  const outcome = validateOutlineReply(outlineReply(), CTX);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(outcome.result.scenes.map((s) => s.id)).toEqual(["night-watch"]);
  expect(outcome.result.scenes[0]!.sourceExcerpt).toEqual({ first: "One.", last: "Two." });
});

test("an almost-JSON outline is repaired instead of costing a correction turn", () => {
  // The errors a model makes when it hand-writes JSON: a trailing comma, a
  // single-quoted key, an unquoted one. `jsonrepair` fixes them
  // deterministically — far cheaper than resending the whole prompt.
  const almost = `{
    scenes: [
      {
        'id': 'night-watch',
        "title": "Night Watch on the Quay",
        "type": "planned",
        "refs": [],
      },
    ],
    "npcs": [],
    "locations": [],
    "warnings": ["The source text names no DC."],
  }`;
  const outcome = validateOutlineReply(almost, CTX);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(outcome.result.scenes.map((sc) => sc.id)).toEqual(["night-watch"]);
  // …and the run notes it as data beside the model's notes, so a provider
  // that needs patching every time is visible to the DM instead of silently
  // tolerated.
  expect(outcome.result.warnings).toEqual(["The source text names no DC."]);
  expect(outcome.result.serverNotes).toEqual(["reply_repaired"]);
});

test("a new-chapter outline keeps its chapter description, trimmed", () => {
  const outcome = validateOutlineReply(
    outlineReply({ chapterDescription: "  What it is about.\n\nWhat the party should achieve.  " }),
    { ...CTX, newChapter: true },
  );
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(outcome.result.chapterDescription).toBe("What it is about.\n\nWhat the party should achieve.");
});

test("a missing description is no correction turn — the chapter starts empty", () => {
  for (const chapterDescription of [null, "", "   "]) {
    const outcome = validateOutlineReply(outlineReply({ chapterDescription }), {
      ...CTX,
      newChapter: true,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.chapterDescription).toBeUndefined();
  }
});

test("a run into an existing chapter drops whatever description the reply carries", () => {
  const outcome = validateOutlineReply(outlineReply({ chapterDescription: "Another chapter." }), CTX);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(outcome.result.chapterDescription).toBeUndefined();
});

test("a repaired outline is still VALIDATED — the repair loosens only parsing", () => {
  // Parseable after the repair, and still wrong: the type is not a scene type.
  expect(
    outlineErrors('{ "scenes": [{ "id": "night-watch", "type": "combat", "refs": [] },], }'),
  ).toEqual(expect.arrayContaining([expect.stringContaining('"type" must be one of')]));
});

test("prose without an object is NOT repaired — it is a correction turn", () => {
  // jsonrepair would happily turn a sentence into a JSON string, and the run
  // would then fail with a message about the wrong thing.
  for (const raw of ["I cannot complete this task.", "", "   "]) {
    expect(outlineErrors(raw)).toEqual(["reply is not valid JSON"]);
  }
  // A well-formed reply reports no repair at all.
  const clean = validateOutlineReply(outlineReply(), CTX);
  expect(clean.ok && clean.result.serverNotes).toEqual([]);
});

test("the schema's nullable optionals read as absent", () => {
  // `strict: true` has no optional properties, so the schema makes `location`
  // and `sourceExcerpt` NULLABLE and the provider will hand back explicit
  // nulls. The validation has to read those as absent — otherwise the very
  // shape the API guarantees would fail the run.
  const outcome = validateOutlineReply(
    outlineReply({
      scenes: [
        {
          id: "night-watch",
          title: "Night Watch on the Quay",
          type: "planned",
          location: null,
          sourceExcerpt: null,
          refs: [],
        },
      ],
    }),
    CTX,
  );
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(outcome.result.scenes[0]!.location).toBeUndefined();
  expect(outcome.result.scenes[0]!.sourceExcerpt).toBeUndefined();
});

test("the outline's ids are kebab slugs and unique across scenes, npcs AND locations", () => {
  expect(
    outlineErrors(outlineReply({ scenes: [{ id: "Night Watch", type: "planned", refs: [] }] })),
  ).toEqual(expect.arrayContaining([expect.stringContaining("kebab-case id")]));
  // The same id twice — even across the lists — describes two entities that
  // cannot both exist under one reference key.
  expect(
    outlineErrors(
      outlineReply({ npcs: [{ id: "night-watch", name: "Grella", summary: "x" }] }),
    ),
  ).toEqual(expect.arrayContaining([expect.stringContaining("duplicate id")]));
  expect(
    outlineErrors(
      outlineReply({
        npcs: [{ id: "grella", name: "Grella", summary: "x" }],
        locations: [{ id: "grella", name: "Grella's Hut", summary: "x" }],
      }),
    ),
  ).toEqual([expect.stringContaining('locations[0]: duplicate id "grella"')]);
});

test("an id the campaign already has is NOT an outline error", () => {
  // A reference creates an EMPTY row, so "fenn exists" can mean "a scene
  // mentions him and nobody has written him yet" — which is exactly the entry
  // this run should fill. Collisions are the accept's question.
  expect(
    outlineErrors(
      outlineReply({ npcs: [{ id: "fenn", name: "Fenn", summary: "x" }] }),
    ),
  ).toEqual([]);
});

test("the chapter is the RUN's — an invented one is a correction turn", () => {
  expect(
    outlineErrors(
      outlineReply({
        scenes: [{ id: "night-watch", type: "planned", chapter: "99-elsewhere", refs: [] }],
      }),
    ),
  ).toEqual([expect.stringContaining('"chapter" ist "01-salt-harbour"')]);
});

test("a location resolves against the campaign OR the outline's own locations", () => {
  expect(
    outlineErrors(
      outlineReply({ scenes: [{ id: "night-watch", type: "planned", location: "north-cove", refs: [] }] }),
    ),
  ).toEqual([expect.stringContaining('location "north-cove" does not exist')]);
  // …and with the location that provides it, the same outline is fine.
  expect(
    outlineErrors(
      outlineReply({
        scenes: [{ id: "night-watch", type: "planned", location: "north-cove", refs: [] }],
        locations: [{ id: "north-cove", name: "North Cove", summary: "x" }],
      }),
    ),
  ).toEqual([]);
  // An npc of the outline is no place a scene can be set at.
  expect(
    outlineErrors(
      outlineReply({
        scenes: [{ id: "night-watch", type: "planned", location: "north-cove", refs: [] }],
        npcs: [{ id: "north-cove", name: "Cove", summary: "x" }],
      }),
    ),
  ).toEqual([expect.stringContaining('location "north-cove" does not exist')]);
});

test("cross references must name scenes of this outline", () => {
  expect(
    outlineErrors(
      outlineReply({ scenes: [{ id: "night-watch", type: "planned", refs: ["nowhere"] }] }),
    ),
  ).toEqual([expect.stringContaining('ref "nowhere" ist keine Szene dieser Gliederung')]);
  expect(
    outlineErrors(
      outlineReply({ scenes: [{ id: "night-watch", type: "planned", refs: ["night-watch"] }] }),
    ),
  ).toEqual([expect.stringContaining("verweist auf sich selbst")]);
});

test("an outline without a single scene is not an outline", () => {
  expect(outlineErrors(outlineReply({ scenes: [] }))).toEqual([
    expect.stringContaining("at least one scene"),
  ]);
  expect(outlineErrors("no json")).toEqual(["reply is not valid JSON"]);
});

test("an outline over the part bound is a correction turn, not a run", () => {
  // One provider call per part, so the outline decides what a run COSTS. Over
  // the bound it is asked to consolidate (the errors are what the correction
  // turn carries), rather than spending dozens of calls nobody asked for.
  const many = Array.from({ length: MAX_OUTLINE_SCENES + 1 }, (_, i) => ({
    id: `scene-${i}`,
    title: `Scene ${i}`,
    type: "planned",
    refs: [],
  }));
  const tooMany = validateOutlineReply(outlineReply({ scenes: many }), CTX);
  expect(tooMany.ok).toBe(false);
  expect((tooMany as { errors: string[] }).errors.join("\n")).toContain(
    `höchstens ${MAX_OUTLINE_SCENES}`,
  );
  // Exactly at the bound is fine — the bound is a bound, not a target.
  expect(validateOutlineReply(outlineReply({ scenes: many.slice(1) }), CTX).ok).toBe(true);

  // The new npcs and the new locations share ONE bound: each is a provider
  // call, so 13 together is too many although each list stays below 12.
  const npcs = Array.from({ length: 7 }, (_, i) => ({
    id: `figure-${i}`,
    name: `Figure ${i}`,
    summary: "from the source text",
  }));
  const locations = Array.from({ length: MAX_OUTLINE_PROPOSALS + 1 - npcs.length }, (_, i) => ({
    id: `place-${i}`,
    name: `Place ${i}`,
    summary: "from the source text",
  }));
  expect(npcs.length).toBeLessThan(MAX_OUTLINE_PROPOSALS);
  expect(locations.length).toBeLessThan(MAX_OUTLINE_PROPOSALS);
  const tooManyProposals = validateOutlineReply(outlineReply({ npcs, locations }), CTX);
  expect(tooManyProposals.ok).toBe(false);
  expect((tooManyProposals as { errors: string[] }).errors.join("\n")).toContain(
    `${MAX_OUTLINE_PROPOSALS + 1} neue Figuren und Orte`,
  );
  // Exactly at the bound is fine.
  expect(
    validateOutlineReply(outlineReply({ npcs, locations: locations.slice(1) }), CTX).ok,
  ).toBe(true);
});

// --- cutting the source passage ------------------------------------------------

const SOURCE = [
  "The party arrives at the harbour on the evening tide.",
  "Jorna is waiting at the pier.",
  "",
  "At low tide the crew shifts a cargo along the mole.",
  "Two lanterns move in the dark.",
].join("\n");

test("the excerpt is cut by the literal first/last sentence", () => {
  const cut = cutExcerpt(SOURCE, {
    first: "At low tide the crew shifts a cargo along the mole.",
    last: "Two lanterns move in the dark.",
  });
  expect(cut.matched).toBe(true);
  expect(cut.text).toBe(
    "At low tide the crew shifts a cargo along the mole.\nTwo lanterns move in the dark.",
  );
});

test("a re-wrapped quote still matches — whitespace is normalized", () => {
  const cut = cutExcerpt(SOURCE, {
    first: "The party arrives at the harbour\n   on the evening tide.",
    last: "Jorna is waiting at the pier.",
  });
  expect(cut.matched).toBe(true);
  expect(cut.text).toContain("Jorna is waiting at the pier.");
});

test("a quote that is not in the source falls back to the WHOLE text", () => {
  // More expensive, never wrong, never a reason
  // to fail the run — and the caller records which of the two happened.
  for (const excerpt of [
    { first: "The group reaches the port.", last: "Two lanterns move in the dark." },
    { first: "The party arrives at the harbour on the evening tide.", last: "Nothing like this." },
    undefined,
  ]) {
    const cut = cutExcerpt(SOURCE, excerpt);
    expect(cut.matched).toBe(false);
    expect(cut.text).toBe(SOURCE);
  }
});

test("the LAST sentence is searched from the first one on", () => {
  const repeated = "Alpha. Beta. Alpha. Gamma.";
  const cut = cutExcerpt(repeated, { first: "Beta.", last: "Alpha." });
  expect(cut.matched).toBe(true);
  expect(cut.text).toBe("Beta. Alpha.");
});

test("an entry's context is the passages that mention it — by name OR by id words", () => {
  const source = [
    "The harbour master counts crates at dawn.",
    "Grella waits in the mudflats.",
    "Nobody is here at all.",
  ].join(" ");
  const outline: RunOutline = {
    scenes: [
      {
        id: "quay",
        title: "At the Quay",
        type: "planned",
        sourceExcerpt: {
          first: "The harbour master counts crates at dawn.",
          last: "The harbour master counts crates at dawn.",
        },
        refs: [],
      },
      {
        id: "mudflats",
        title: "In the Mudflats",
        type: "planned",
        sourceExcerpt: {
          first: "Grella waits in the mudflats.",
          last: "Grella waits in the mudflats.",
        },
        refs: [],
      },
    ],
    npcs: [
      { id: "harbour-master", name: "Mistress of the Docks", summary: "counts crates" },
      { id: "grella", name: "Grella", summary: "smuggler" },
    ],
    locations: [{ id: "mudflats", name: "The Mudflats", summary: "walkable at low tide" }],
    warnings: [],
    serverNotes: [],
    existingNpcs: [],
    existingLocations: [],
  };
  const plan = planOf({ campaign: "example", ctx: CTX, outline, sourceText: source });
  // The id and the name share no word — so a source text that never writes
  // "Mistress of the Docks" and never writes "harbour-master" still has to
  // reach its npc, through the WORDS of the id.
  const master = npcContext(plan, outline.npcs[0]!);
  expect(master).toContain("The harbour master counts crates");
  expect(master).not.toContain("Grella waits in the mudflats");
  // …and the plain name match still works, and matches only its own scene.
  const grella = npcContext(plan, outline.npcs[1]!);
  expect(grella).toContain("Grella waits in the mudflats");
  expect(grella).not.toContain("harbour master counts");
  // A location is reached by the scenes that are set there — and no scene of
  // this outline names one, so its call gets the whole source text.
  const watt = locationContext(plan, outline.locations[0]!);
  expect(watt).toContain("The Mudflats (mudflats): walkable at low tide");
  expect(watt).toContain(source);
  // The excerpts are cut ONCE for the whole run, not per npc × scene.
  expect([...plan.excerpts.keys()]).toEqual(["quay", "mudflats"]);
  expect(plan.excerpts.get("quay")!.matched).toBe(true);
});

// --- the per-part prompt -------------------------------------------------------

test("the single-scene mode swaps the output schema and keeps every rule", async () => {
  const single = await sceneSystemPrompt();
  // The reply object — the swapped section describes it, and
  // nothing of the raw-entry format is left.
  expect(single).toContain("Du antwortest mit **einem JSON-Objekt**");
  expect(single).toContain("`warnings`");
  expect(single).not.toContain("---warnings---");
  // The outline-bound half of the swap: one scene per call, nothing else.
  expect(single).toContain("GENAU EINE Szene");
  expect(single).toContain("Die Gliederung ist verbindlich.");
  // Exactly one output-format heading, and the scene's fields and the rules of
  // the scene prompt are untouched — that is why this is a swap and not a
  // second prompt file.
  expect(single.split("## Ausgabeformat").length - 1).toBe(1);
  for (const marker of [
    "## Die Felder der Szene",
    "**Deutsche Orthografie**",
    "**Anführungszeichen**",
    "**Tabellen**",
  ]) {
    expect(single).toContain(marker);
  }
});

test("the outline block names every id — and nothing about the assigned part", () => {
  const outline: RunOutline = {
    scenes: [
      { id: "night-watch", title: "Night Watch", type: "planned", location: "harbour", refs: ["captured"] },
      { id: "captured", title: "Caught", type: "contingency", refs: [] },
    ],
    npcs: [{ id: "grella", name: "Grella", summary: "smuggler" }],
    locations: [{ id: "mudflats", name: "The Mudflats", summary: "walkable at low tide" }],
    warnings: [],
    serverNotes: [],
    existingNpcs: [],
    existingLocations: [],
  };
  const block = outlineBlock(outline);
  expect(block).toContain("night-watch — Night Watch (planned, location: harbour)");
  expect(block).toContain("→ verweist auf: captured");
  expect(block).toContain("Neue Figuren dieses Durchlaufs");
  expect(block).toContain("- grella (Grella) — smuggler");
  expect(block).toContain("Neue Orte dieses Durchlaufs");
  expect(block).toContain("- mudflats (The Mudflats) — walkable at low tide");
  // Which scene THIS call writes is NOT in here — it is a section of its own
  // in the variable half, so the block stays cacheable.
  expect(block).not.toContain("DIESE Szene");
  expect(assignmentBlock(outline.scenes[1]!)).toBe("captured — Caught");

  // The part list follows the outline's order: scenes, then npcs, then locations.
  expect(outlineParts(outline).map((p) => p.key)).toEqual([
    "scene:night-watch",
    "scene:captured",
    "npc:grella",
    "location:mudflats",
  ]);
});

test("two parts of one run share a byte-identical constant prefix", () => {
  // The saving the whole split exists for: everything above the
  // excerpt is the same text for every part, so an endpoint with prefix
  // caching sees the run's prompt once. One marker in the outline block used
  // to break that for every part at once.
  const outline: RunOutline = {
    scenes: [
      { id: "one", title: "One", type: "planned", location: "harbour", refs: [] },
      { id: "two", title: "Two", type: "contingency", refs: ["one"] },
    ],
    npcs: [],
    locations: [],
    warnings: [],
    serverNotes: [],
    existingNpcs: [],
    existingLocations: [],
  };
  const base = {
    systemPrompt: "sys",
    fewShotTarget: "few",
    knowledge: "",
    glossary: "g",
    context: { chapter: CTX.chapter, npcs: CTX.npcs, locations: CTX.locations },
    outline: outlineBlock(outline),
  };
  const first = buildPromptParts({
    ...base,
    assignment: assignmentBlock(outline.scenes[0]!),
    sourceText: "Passage one.",
  });
  const second = buildPromptParts({
    ...base,
    assignment: assignmentBlock(outline.scenes[1]!),
    sourceText: "Passage two.",
  });
  expect(first.constant).toBe(second.constant);
  // …and the variable half is what tells the two calls apart.
  expect(first.variable).not.toBe(second.variable);
  expect(first.variable).toContain(ASSIGNMENT_HEADING);
  expect(first.variable).toContain("one — One");
  expect(second.variable).toContain("two — Two");
});

// --- the run through the endpoints ---------------------------------------------

const SCENE_IDS = ["one", "two", "three"] as const;

/** One scene as the REPLY OBJECT — what a part's call answers. */
function sceneDoc(id: string, over: { status?: string; warnings?: string[] } = {}): string {
  return JSON.stringify({
    id,
    title: `Scene ${id}`,
    type: "planned",
    trigger: null,
    chapter: "01-salt-harbour",
    location: "lighthouse",
    npcs: ["fenn"],
    handouts: [],
    tags: ["social"],
    status: over.status ?? "draft",
    body: "## Flow\n\nFenn waits on the quay.\n",
    warnings: over.warnings ?? [],
  });
}

/**
 * A provider that answers the outline with three scenes and then serves one
 * entry per scene — with `broken` failing its validation every time, which
 * is what "one part fails" has to mean for the other two.
 */
class ThreeSceneProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: string[] = [];
  constructor(
    private broken: string | null = null,
    /** The outline's scenes — four of them when a case needs a PENDING part. */
    private ids: readonly string[] = SCENE_IDS,
  ) {}

  async complete(
    req: GenerateRequest,
    _corrections: CorrectionTurn[] = [],
  ): Promise<CompletionResult> {
    if (req.outline === undefined) {
      this.calls.push("outline");
      return {
        text: JSON.stringify({
          scenes: this.ids.map((id) => ({
            id,
            title: `Scene ${id}`,
            type: "planned",
            location: "lighthouse",
            sourceExcerpt: { first: "Fenn waits at the docks.", last: "Fenn waits at the docks." },
            refs: [],
          })),
          npcs: [],
          locations: [],
          warnings: [],
        }),
        truncated: false,
      };
    }
    const id = /^([a-z0-9-]+) /.exec(req.assignment ?? "")?.[1] ?? "";
    this.calls.push(id);
    // The reply object — the scene part's answer, with no
    // warnings in it.
    return {
      text: sceneDoc(id, id === this.broken ? { status: "ready" } : {}),
      truncated: false,
    };
  }
}

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

const fetchJob = (): Promise<GeneratorJob | null> => readJob("example");

/** Start the scene run every case here is about. */
const startRun = (): Promise<Response> =>
  send("POST", jobsUrl("example"), {
    kind: "scene",
    chapter: "01-salt-harbour",
    sourceText: "Fenn waits at the docks.",
  });

/** Retry one part of a job. */
const retryPart = (id: string, key: string): Promise<Response> =>
  send("PATCH", partUrl("example", id, key), { status: "running" });

async function runJob(): Promise<GeneratorJob> {
  expect((await startRun()).status).toBe(202);
  for (let i = 0; i < 2000; i += 1) {
    const job = await fetchJob();
    if (job === null) throw new Error("job disappeared");
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("job never finished");
}

/** Poll the job until its parts look the way a case needs them to. */
async function waitForParts(
  ready: (parts: NonNullable<GeneratorJob["pipeline"]>["parts"]) => boolean,
): Promise<GeneratorJob> {
  for (let i = 0; i < 4000; i += 1) {
    const job = await fetchJob();
    if (job !== null && ready(job.pipeline?.parts ?? [])) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("the parts never reached the expected shape");
}

beforeEach(async () => {
  await seedStore();
});

afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
  dropStore();
});

test("one failed part leaves the other two reviewable", async () => {
  const provider = new ThreeSceneProvider("two");
  setProviderForTests(provider);
  const job = await runJob();

  // The run produced something, so it is `done` — with one failed part.
  expect(job.status).toBe("done");
  expect(job.pipeline!.parts.map((p) => [p.key, p.status])).toEqual([
    ["scene:one", "done"],
    ["scene:two", "failed"],
    ["scene:three", "done"],
  ]);
  const failed = job.pipeline!.parts[1]!;
  expect(failed.error).toContain("validation");
  // The part carries its OWN last raw reply to the client (the job's error
  // body only ever has one, for a run that can have many parts).
  expect(failed.rawReply).toContain('"status":"ready"');
  expect(failed.validationErrors).toEqual(
    expect.arrayContaining([expect.stringContaining('scene "two": "status"')]),
  );
  // The two finished scenes are in the result, in OUTLINE order.
  expect(job.result!.scenes.map((s) => s.id)).toEqual([
    "one",
    "three",
  ]);
  // 1 + 3 calls, plus the broken part's correction turn.
  expect(job.pipeline!.totals.calls).toBe(provider.calls.length);
  expect(provider.calls.filter((c) => c === "two")).toHaveLength(2);

  // …and one of them can be accepted while the failed part is still open.
  const accepted = await send("PATCH", jobUrl("example", job.id), acceptBody(job, { scenes: ["one"] }));
  expect(accepted.status).toBe(200);
  const answer = (await accepted.json()) as GeneratorJob;
  expect(answer.review.writtenScenes).toEqual(["one"]);
  expect(answer.review.writtenNpcs).toEqual([]);
  expect(answer.review.writtenLocations).toEqual([]);
  // The job stays: the failed part is not settled.
  expect((await fetchJob())!.id).toBe(job.id);
});

test("a part's notes stay on its part and the run's notes on the result", async () => {
  // The outline notes something about the run, and every scene part notes
  // something about its own scene.
  class NotingProvider extends ThreeSceneProvider {
    override async complete(
      req: GenerateRequest,
      corrections: CorrectionTurn[] = [],
    ): Promise<CompletionResult> {
      const answer = await super.complete(req, corrections);
      const reply = JSON.parse(answer.text) as Record<string, unknown>;
      const id = typeof reply.id === "string" ? reply.id : undefined;
      reply.warnings = id === undefined ? ["The source names no weather."] : [`About ${id}.`];
      return { ...answer, text: JSON.stringify(reply) };
    }
  }
  setProviderForTests(new NotingProvider());
  const job = await runJob();

  expect(job.result!.warnings).toEqual(["The source names no weather."]);
  expect(job.pipeline!.parts.map((part) => [part.key, part.warnings])).toEqual([
    ["scene:one", ["About one."]],
    ["scene:two", ["About two."]],
    ["scene:three", ["About three."]],
  ]);
});

test("the server's own notes are data beside the model's, on the result and on the part", async () => {
  // The outline has to be repaired, the scene `two` quotes a passage the
  // source does not have, and the reply for scene `three` has to be repaired.
  class NotedByServer extends ThreeSceneProvider {
    override async complete(
      req: GenerateRequest,
      corrections: CorrectionTurn[] = [],
    ): Promise<CompletionResult> {
      const answer = await super.complete(req, corrections);
      if (req.outline === undefined) {
        const outline = JSON.parse(answer.text) as { scenes: Array<Record<string, unknown>> };
        outline.scenes[1]!.sourceExcerpt = { first: "Nobody said this.", last: "Nor this." };
        return { ...answer, text: JSON.stringify(outline).replace(/}$/, ",}") };
      }
      if (req.assignment !== undefined && /^three /.test(req.assignment)) {
        return { ...answer, text: answer.text.replace(/}\s*$/, ",}") };
      }
      return answer;
    }
  }
  setProviderForTests(new NotedByServer());
  const job = await runJob();

  expect(job.result!.warnings).toEqual([]);
  expect(job.result!.serverNotes).toEqual(["reply_repaired"]);
  expect(job.pipeline!.parts.map((part) => [part.key, part.warnings, part.serverNotes])).toEqual([
    ["scene:one", [], undefined],
    ["scene:two", [], ["source_excerpt_unmatched"]],
    ["scene:three", [], ["reply_repaired"]],
  ]);
});

test("a done part is acceptable while the run is still RUNNING", async () => {
  // The gate is the PART, not the job: "what is shown here you can already
  // accept" has to hold while the run still says `running`. The UI offers
  // it, so the endpoint has to answer it.
  const gate = new Promise<void>(() => {});
  class HoldsLast extends ThreeSceneProvider {
    override async complete(
      req: GenerateRequest,
      corrections: CorrectionTurn[] = [],
    ): Promise<CompletionResult> {
      const answer = await super.complete(req, corrections);
      if (req.assignment !== undefined && /^three /.test(req.assignment)) await gate;
      return answer;
    }
  }
  setProviderForTests(new HoldsLast(null));
  await startRun();
  const job = await waitForParts(
    (parts) => parts.filter((p) => p.status === "done").length === 2,
  );
  expect(job.status).toBe("running");

  const accepted = await send("PATCH", jobUrl("example", job.id), acceptBody(job, { scenes: ["one"] }));
  expect(accepted.status).toBe(200);
  const answer = (await accepted.json()) as GeneratorJob;
  expect(answer.review.writtenScenes).toEqual(["one"]);
  expect(answer.review.writtenNpcs).toEqual([]);
  expect(answer.review.writtenLocations).toEqual([]);
  // The run is untouched by it: still running, still holding its third part.
  const after = (await fetchJob())!;
  expect(after.status).toBe("running");
  expect(after.pipeline!.parts.map((p) => p.status)).toEqual(["done", "done", "running"]);
});

test("a run that has produced nothing yet is not acceptable", async () => {
  // Every part held: the job is `running` with no `done` part, so there is
  // nothing to accept and accepting everything is a 409 rather than an empty
  // write.
  const gate = new Promise<void>(() => {});
  class HoldsEverything extends ThreeSceneProvider {
    override async complete(
      req: GenerateRequest,
      corrections: CorrectionTurn[] = [],
    ): Promise<CompletionResult> {
      const answer = await super.complete(req, corrections);
      if (req.outline !== undefined) await gate;
      return answer;
    }
  }
  setProviderForTests(new HoldsEverything(null));
  await startRun();
  const job = await waitForParts((parts) => parts.length === 3);
  const res = await send(
    "PATCH",
    jobUrl("example", job.id),
    acceptBody(job, { scenes: ["one", "two", "three"] }),
  );
  expect(res.status).toBe(409);
});

test("retrying re-runs ONE part and leaves the rest alone", async () => {
  setProviderForTests(new ThreeSceneProvider("two"));
  const first = await runJob();
  expect(first.pipeline!.parts[1]!.status).toBe("failed");

  // A second provider, this time with nothing broken — the retry has to use
  // the STORED outline, so the run is not started again.
  const retryProvider = new ThreeSceneProvider(null);
  setProviderForTests(retryProvider);
  const res = await retryPart(first.id, "scene:two");
  expect(res.status).toBe(202);
  for (let i = 0; i < 2000; i += 1) {
    const job = await fetchJob();
    if (job!.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const after = (await fetchJob())!;
  expect(after.id).toBe(first.id);
  expect(after.pipeline!.parts.map((p) => p.status)).toEqual(["done", "done", "done"]);
  expect(after.pipeline!.parts[1]!.error).toBeUndefined();
  expect(after.result!.scenes.map((s) => s.id)).toEqual([
    "one",
    "two",
    "three",
  ]);
  // Only the retried part ran — no outline call, no sibling.
  expect(retryProvider.calls).toEqual(["two"]);
});

test("a retry that races a sibling's result does not clobber it", async () => {
  // The shape: part "two" failed, part "three" is still in flight, and the DM
  // retries "two" in exactly the moment "three"
  // answers. The retry has to revive ITS part and nothing else — a revive
  // that writes back the whole pipeline column as it read it before the
  // context read puts "three" back to `running`, and then the run has no
  // worker left that could ever settle it.
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  class HoldsLast extends ThreeSceneProvider {
    override async complete(
      req: GenerateRequest,
      corrections: CorrectionTurn[] = [],
    ): Promise<CompletionResult> {
      const answer = await super.complete(req, corrections);
      if (req.assignment !== undefined && req.assignment.includes("three")) await gate;
      return answer;
    }
  }
  setProviderForTests(new HoldsLast("two"));
  expect((await startRun()).status).toBe(202);
  const before = await waitForParts((parts) =>
    parts.map((p) => p.status).join() === "done,failed,running",
  );
  expect(before.status).toBe("running");

  // Fire the retry and let "three" answer INTO its context read.
  setProviderForTests(new HoldsLast(null));
  const retry = retryPart(before.id, "scene:two");
  release?.();
  expect((await retry).status).toBe(202);

  const after = await waitForParts((parts) => parts.every((p) => p.status === "done"));
  expect(after.pipeline!.parts.map((p) => p.status)).toEqual(["done", "done", "done"]);
  // …and the run settled, which is the property the clobber destroyed.
  expect(after.status).toBe("done");
  expect(after.result!.scenes.map((s) => s.id)).toEqual([
    "one",
    "two",
    "three",
  ]);
});

test("a PENDING part is the pool's, not the retry's", async () => {
  // Four scenes and three workers, every call held: the fourth part is
  // `pending` — it has not had its turn yet. Reviving it here would run it
  // twice, once from this call and once from the pool that still owns it.
  const gate = new Promise<void>(() => {});
  class HoldsEverything extends ThreeSceneProvider {
    override async complete(
      req: GenerateRequest,
      corrections: CorrectionTurn[] = [],
    ): Promise<CompletionResult> {
      const answer = await super.complete(req, corrections);
      if (req.outline !== undefined) await gate;
      return answer;
    }
  }
  setProviderForTests(new HoldsEverything(null, [...SCENE_IDS, "four"]));
  await startRun();
  const job = await waitForParts(
    (parts) => parts.length === 4 && parts[3]!.status === "pending",
  );
  const res = await retryPart(job.id, "scene:four");
  expect(res.status).toBe(409);
  expect((await fetchJob())!.pipeline!.parts[3]!.status).toBe("pending");
});

test("a retry is refused for a part that is done, and for an unknown key", async () => {
  setProviderForTests(new ThreeSceneProvider(null));
  const job = await runJob();
  expect(
    (await retryPart(job.id, "scene:one")).status,
  ).toBe(409);
  expect(
    (await retryPart(job.id, "scene:nope")).status,
  ).toBe(404);
  expect(
    (await retryPart("not-this-one", "scene:one")).status,
  ).toBe(404);
});

test("a restart fails the open parts and keeps the finished ones", async () => {
  // The first two scenes answer, the third one never does — then the process
  // dies. That is the shape `failInterruptedJobs` has to get right.
  let held: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    held = resolve;
  });
  class HoldingProvider extends ThreeSceneProvider {
    override async complete(
      req: GenerateRequest,
      corrections: CorrectionTurn[] = [],
    ): Promise<CompletionResult> {
      const answer = await super.complete(req, corrections);
      if (req.assignment !== undefined && /^three /.test(req.assignment)) {
        await gate;
      }
      return answer;
    }
  }
  setProviderForTests(new HoldingProvider(null));
  await startRun();
  // Wait until the two answering parts have landed.
  for (let i = 0; i < 2000; i += 1) {
    const job = await fetchJob();
    const done = job?.pipeline?.parts.filter((p) => p.status === "done") ?? [];
    if (done.length === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  expect(failInterruptedJobs(await getDb())).toBe(1);
  const after = (await fetchJob())!;
  // The run is `done` — two parts survived and are acceptable — and the part
  // that was in flight says what happened, next to its retry action.
  expect(after.status).toBe("done");
  expect(after.pipeline!.parts.map((p) => p.status)).toEqual(["done", "done", "failed"]);
  expect(after.pipeline!.parts[2]!.error).toBe(RESTART_FAILURE_MESSAGE);
  expect(after.result!.scenes.map((s) => s.id)).toEqual([
    "one",
    "two",
  ]);
  // The abandoned call finishing later must not resurrect anything.
  held?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect((await fetchJob())!.pipeline!.parts[2]!.status).toBe("failed");
});

test("discarding stops the open parts — nothing of them lands afterwards", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  class SlowProvider extends ThreeSceneProvider {
    override async complete(
      req: GenerateRequest,
      corrections: CorrectionTurn[] = [],
    ): Promise<CompletionResult> {
      const answer = await super.complete(req, corrections);
      if (req.outline !== undefined) await gate;
      return answer;
    }
  }
  setProviderForTests(new SlowProvider(null));
  await startRun();
  const job = await waitForParts((parts) => parts.length === 3);
  expect((await send("DELETE", jobUrl("example", job.id), { rev: job.rev })).status).toBe(200);
  release?.();
  await new Promise((resolve) => setTimeout(resolve, 20));
  // The discarded run is gone and stays gone.
  expect(await fetchJob()).toBeNull();
});

test("the pipeline is not serialized for a single-call run", async () => {
  setProviderForTests(
    new PipelineFake([
      JSON.stringify({
        npc: {
          content: {
            properties: { id: "brakk", name: "Brakk", status: "alive" },
            body: "## Will\n\nPeace on the quay.\n",
          },
        },
        warnings: [],
      }),
    ]),
  );
  expect(
    (await send("POST", jobsUrl("example"), { kind: "npc", sourceText: "An ageing fisherman." }))
      .status,
  ).toBe(202);
  for (let i = 0; i < 2000; i += 1) {
    const job = await fetchJob();
    if (job!.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const job = (await fetchJob())!;
  expect(job.status).toBe("done");
  // An npc run has no parts (it stays one call), so it carries
  // no pipeline at all and the review renders exactly as it did.
  expect(job.pipeline).toBeUndefined();
});
