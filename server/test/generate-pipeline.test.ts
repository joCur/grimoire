// The pipelined scene run (issue #102) — the pieces that are worth testing
// on their own, plus the run mechanics a rendering test cannot see.
//
// The pure halves (the outline validation, the excerpt cut, the prompt
// assembly) are called directly: they are the rules the whole ticket rests on
// and going through HTTP for them would only make a failure harder to read.
// The run mechanics — a failed part that does not take its siblings down, a
// retry that re-runs ONE part, a cancel that stops the open rest — go through
// the real endpoints against the real job row.

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { GenerateJob } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generate-jobs";
import { failInterruptedJobs, RESTART_FAILURE_MESSAGE } from "../src/db/job-boot";
import { getDb } from "../src/store/handle";
import { setProviderForTests } from "../src/generator";
import {
  assignmentBlock,
  cutExcerpt,
  MAX_OUTLINE_ENTRIES,
  entryContext,
  MAX_OUTLINE_SCENES,
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
  chapter: "01-salzhafen",
  npcs: [{ id: "fenn", name: "Fenn" }],
  locations: [{ id: "hafen", name: "Der Hafen" }],
  knowledge: "",
  glossary: "",
  namingRules: [],
  npcIds: new Set(["fenn"]),
  locationIds: new Set(["hafen"]),
} satisfies SceneContext;

function outlineReply(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    scenes: [
      {
        id: "night-watch",
        title: "Nachtwache am Kai",
        type: "planned",
        location: "hafen",
        sourceExcerpt: { first: "One.", last: "Two." },
        refs: [],
      },
    ],
    entries: [],
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

test("the outline's ids are kebab slugs and unique across scenes AND entries", () => {
  expect(
    outlineErrors(outlineReply({ scenes: [{ id: "Night Watch", type: "planned", refs: [] }] })),
  ).toEqual(expect.arrayContaining([expect.stringContaining("kebab-case id")]));
  // The same id twice — even across the two lists — describes two entities
  // that cannot both exist under one reference key.
  expect(
    outlineErrors(
      outlineReply({
        entries: [{ kind: "npc", id: "night-watch", name: "Grella", summary: "x" }],
      }),
    ),
  ).toEqual(expect.arrayContaining([expect.stringContaining("duplicate id")]));
});

test("an id the campaign already has is NOT an outline error", () => {
  // Since issue #70 a reference creates an EMPTY row, so „fenn exists“ can
  // mean „a scene mentions him and nobody has written him yet“ — which is
  // exactly the entry this run should fill. Collisions are the apply path's
  // question, and they always were.
  expect(
    outlineErrors(
      outlineReply({ entries: [{ kind: "npc", id: "fenn", name: "Fenn", summary: "x" }] }),
    ),
  ).toEqual([]);
});

test("the chapter is the RUN's — an invented one is a correction turn", () => {
  expect(
    outlineErrors(
      outlineReply({
        scenes: [{ id: "night-watch", type: "planned", chapter: "99-weg", refs: [] }],
      }),
    ),
  ).toEqual([expect.stringContaining('"chapter" ist "01-salzhafen"')]);
});

test("a location resolves against the campaign OR the outline's own entries", () => {
  expect(
    outlineErrors(
      outlineReply({ scenes: [{ id: "night-watch", type: "planned", location: "bucht", refs: [] }] }),
    ),
  ).toEqual([expect.stringContaining('location "bucht" does not exist')]);
  // …and with the entry that provides it, the same outline is fine.
  expect(
    outlineErrors(
      outlineReply({
        scenes: [{ id: "night-watch", type: "planned", location: "bucht", refs: [] }],
        entries: [{ kind: "location", id: "bucht", name: "Nordbucht", summary: "x" }],
      }),
    ),
  ).toEqual([]);
});

test("cross references must name scenes of this outline (AK4)", () => {
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
  expect(outlineErrors("kein json")).toEqual(["reply is not valid JSON"]);
});

test("an outline over the part bound is a correction turn, not a run", () => {
  // One provider call per part, so the outline decides what a run COSTS. Over
  // the bound it is asked to consolidate (the errors are what the correction
  // turn carries), rather than spending dozens of calls nobody asked for.
  const many = Array.from({ length: MAX_OUTLINE_SCENES + 1 }, (_, i) => ({
    id: `szene-${i}`,
    title: `Szene ${i}`,
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

  const entries = Array.from({ length: MAX_OUTLINE_ENTRIES + 1 }, (_, i) => ({
    kind: "npc",
    id: `figur-${i}`,
    name: `Figur ${i}`,
    summary: "aus dem Quelltext",
  }));
  const tooManyEntries = validateOutlineReply(outlineReply({ entries }), CTX);
  expect(tooManyEntries.ok).toBe(false);
  expect((tooManyEntries as { errors: string[] }).errors.join("\n")).toContain(
    `höchstens ${MAX_OUTLINE_ENTRIES}`,
  );
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
  // The PO's decision (15.09.): more expensive, never wrong, never a reason
  // to fail the run — and the caller records which of the two happened.
  for (const excerpt of [
    { first: "Die Gruppe kommt im Hafen an.", last: "Two lanterns move in the dark." },
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
        id: "kai",
        title: "Am Kai",
        type: "planned",
        sourceExcerpt: {
          first: "The harbour master counts crates at dawn.",
          last: "The harbour master counts crates at dawn.",
        },
        refs: [],
      },
      {
        id: "watt",
        title: "Im Watt",
        type: "planned",
        sourceExcerpt: {
          first: "Grella waits in the mudflats.",
          last: "Grella waits in the mudflats.",
        },
        refs: [],
      },
    ],
    entries: [
      { kind: "npc", id: "harbour-master", name: "Hafenmeisterin", summary: "zählt Kisten" },
      { kind: "npc", id: "grella", name: "Grella", summary: "Schmugglerin" },
    ],
    warnings: [],
  };
  const plan = planOf({ campaign: "beispiel", ctx: CTX, outline, sourceText: source });
  // The id is kebab-case English, the name German — so a source text that
  // never writes „Hafenmeisterin" and never writes „harbour-master" still
  // has to reach its entry, through the WORDS of the id.
  const master = entryContext(plan, outline.entries[0]!);
  expect(master).toContain("The harbour master counts crates");
  expect(master).not.toContain("Grella waits in the mudflats");
  // …and the plain name match still works, and matches only its own scene.
  const grella = entryContext(plan, outline.entries[1]!);
  expect(grella).toContain("Grella waits in the mudflats");
  expect(grella).not.toContain("harbour master counts");
  // The excerpts are cut ONCE for the whole run, not per entry × scene.
  expect([...plan.excerpts.keys()]).toEqual(["kai", "watt"]);
  expect(plan.excerpts.get("kai")!.matched).toBe(true);
});

// --- the per-part prompt -------------------------------------------------------

test("the single-scene mode swaps the output schema and keeps every rule", async () => {
  const single = await sceneSystemPrompt("single");
  const batch = await sceneSystemPrompt("batch");
  // The batch schema is gone…
  expect(single).not.toContain('"scenes": [');
  expect(single).not.toContain('"entries": [');
  // …replaced by the one-document one, and the `entries` array is explicitly
  // NOT part of this answer any more.
  expect(single).toContain('"scene": { "content"');
  expect(single).toContain("kein `entries`-Array");
  // Exactly one output-format heading, and the file format and the rules of
  // the batch prompt are untouched — that is why this is a swap and not a
  // second prompt file.
  expect(single.split("## Ausgabeformat").length - 1).toBe(1);
  for (const marker of ["## Ziel-Format der Datei", "**Deutsche Orthografie**", "**Tabellen**"]) {
    expect(single).toContain(marker);
    expect(batch).toContain(marker);
  }
});

test("the outline block names every id — and nothing about the assigned part", () => {
  const outline: RunOutline = {
    scenes: [
      { id: "night-watch", title: "Nachtwache", type: "planned", location: "hafen", refs: ["captured"] },
      { id: "captured", title: "Erwischt", type: "contingency", refs: [] },
    ],
    entries: [{ kind: "npc", id: "grella", name: "Grella", summary: "Schmugglerin" }],
    warnings: [],
  };
  const block = outlineBlock(outline);
  expect(block).toContain("night-watch — Nachtwache (planned, location: hafen)");
  expect(block).toContain("→ verweist auf: captured");
  expect(block).toContain("npc: grella (Grella) — Schmugglerin");
  // Which scene THIS call writes is NOT in here — it is a section of its own
  // in the variable half, so the block stays cacheable (issue #102 review).
  expect(block).not.toContain("DIESE Szene");
  expect(assignmentBlock(outline.scenes[1]!)).toBe("captured — Erwischt");

  // The part list follows the outline's order: scenes first, then entries.
  expect(outlineParts(outline).map((p) => p.key)).toEqual([
    "scene:night-watch",
    "scene:captured",
    "npc:grella",
  ]);
});

test("two parts of one run share a byte-identical constant prefix", () => {
  // The saving the whole split exists for (issue #102): everything above the
  // excerpt is the same text for every part, so an endpoint with prefix
  // caching sees the run's prompt once. One marker in the outline block used
  // to break that for every part at once.
  const outline: RunOutline = {
    scenes: [
      { id: "eins", title: "Eins", type: "planned", location: "hafen", refs: [] },
      { id: "zwei", title: "Zwei", type: "contingency", refs: ["eins"] },
    ],
    entries: [],
    warnings: [],
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
  expect(first.variable).toContain("eins — Eins");
  expect(second.variable).toContain("zwei — Zwei");
});

// --- the run through the endpoints ---------------------------------------------

const SCENE_IDS = ["eins", "zwei", "drei"] as const;

function sceneDoc(id: string, over: { status?: string } = {}): string {
  return [
    "---",
    `id: ${id}`,
    `title: Szene ${id}`,
    "type: planned",
    "location: leuchtturm",
    "npcs: [fenn]",
    "handouts: []",
    "tags: [social]",
    `status: ${over.status ?? "draft"}`,
    "---",
    "",
    "## Flow",
    "",
    "Fenn wartet am Kai.",
    "",
  ].join("\n");
}

/**
 * A provider that answers the outline with three scenes and then serves one
 * document per scene — with `broken` failing its validation every time, which
 * is what „ein Teil schlägt fehl“ has to mean for the other two.
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
            title: `Szene ${id}`,
            type: "planned",
            location: "leuchtturm",
            sourceExcerpt: { first: "Fenn waits at the docks.", last: "Fenn waits at the docks." },
            refs: [],
          })),
          entries: [],
          warnings: [],
        }),
        truncated: false,
      };
    }
    const id = /^([a-z0-9-]+) /.exec(req.assignment ?? "")?.[1] ?? "";
    this.calls.push(id);
    return {
      text: JSON.stringify({
        scene: { content: sceneDoc(id, id === this.broken ? { status: "ready" } : {}) },
        warnings: [],
      }),
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

async function fetchJob(): Promise<GenerateJob | null> {
  const res = await app.request("/api/beispiel/generate/job");
  if (res.status === 404) return null;
  expect(res.status).toBe(200);
  return (await res.json()) as GenerateJob;
}

async function runJob(): Promise<GenerateJob> {
  expect(
    (
      await send("POST", "/api/beispiel/generate", {
        chapter: "01-salzhafen",
        sourceText: "Fenn waits at the docks.",
      })
    ).status,
  ).toBe(202);
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
  ready: (parts: NonNullable<GenerateJob["pipeline"]>["parts"]) => boolean,
): Promise<GenerateJob> {
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

test("one failed part leaves the other two reviewable (AK1, AK2)", async () => {
  const provider = new ThreeSceneProvider("zwei");
  setProviderForTests(provider);
  const job = await runJob();

  // The run produced something, so it is `done` — with one failed part.
  expect(job.status).toBe("done");
  expect(job.pipeline!.parts.map((p) => [p.key, p.status])).toEqual([
    ["scene:eins", "done"],
    ["scene:zwei", "failed"],
    ["scene:drei", "done"],
  ]);
  const failed = job.pipeline!.parts[1]!;
  expect(failed.error).toContain("validation");
  // The part carries its OWN last raw reply to the client (the job's error
  // body only ever has one, for a run that can have many parts).
  expect(failed.rawReply).toContain("status: ready");
  expect(failed.validationErrors).toEqual(
    expect.arrayContaining([expect.stringContaining('"status" must be "draft"')]),
  );
  // The two finished scenes are in the result, in OUTLINE order.
  expect(job.result!.scenes.map((s) => s.path)).toEqual([
    "01-salzhafen/eins",
    "01-salzhafen/drei",
  ]);
  // 1 + 3 calls, plus the broken part's correction turn.
  expect(job.pipeline!.totals.calls).toBe(provider.calls.length);
  expect(provider.calls.filter((c) => c === "zwei")).toHaveLength(2);

  // …and one of them can be accepted while the failed part is still open.
  const accepted = await send("POST", `/api/beispiel/generate/job/${job.id}/accept`, {
    rev: job.rev ?? 0,
    paths: ["01-salzhafen/eins"],
  });
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({
    written: { "01-salzhafen/eins": "01-salzhafen/leuchtturm/eins" },
    // The job stays: the failed part is not settled (issue #102).
    jobDeleted: false,
  });
  expect((await fetchJob())!.id).toBe(job.id);
});

test("a done part is acceptable while the run is still RUNNING (AK2)", async () => {
  // The old gate asked for a finished JOB, which made the pipeline's central
  // promise unkeepable: „was hier steht, kannst du schon übernehmen" while
  // the run says `running`. The UI offers it, so the endpoint has to answer
  // it (issue #102 review).
  const gate = new Promise<void>(() => {});
  class HoldsLast extends ThreeSceneProvider {
    override async complete(
      req: GenerateRequest,
      corrections: CorrectionTurn[] = [],
    ): Promise<CompletionResult> {
      const answer = await super.complete(req, corrections);
      if (req.assignment !== undefined && /^drei /.test(req.assignment)) await gate;
      return answer;
    }
  }
  setProviderForTests(new HoldsLast(null));
  await send("POST", "/api/beispiel/generate", {
    chapter: "01-salzhafen",
    sourceText: "Fenn waits at the docks.",
  });
  const job = await waitForParts(
    (parts) => parts.filter((p) => p.status === "done").length === 2,
  );
  expect(job.status).toBe("running");

  const accepted = await send("POST", `/api/beispiel/generate/job/${job.id}/accept`, {
    rev: job.rev,
    paths: ["01-salzhafen/eins"],
  });
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({
    written: { "01-salzhafen/eins": "01-salzhafen/leuchtturm/eins" },
    jobDeleted: false,
  });
  // The run is untouched by it: still running, still holding its third part.
  const after = (await fetchJob())!;
  expect(after.status).toBe("running");
  expect(after.pipeline!.parts.map((p) => p.status)).toEqual(["done", "done", "running"]);
});

test("a run that has produced nothing yet is not acceptable", async () => {
  // Every part held: the job is `running` with no `done` part, so there is
  // nothing to accept and „Alle übernehmen" is a 409 rather than an empty
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
  await send("POST", "/api/beispiel/generate", {
    chapter: "01-salzhafen",
    sourceText: "Fenn waits at the docks.",
  });
  const job = await waitForParts((parts) => parts.length === 3);
  const res = await send("POST", `/api/beispiel/generate/job/${job.id}/accept`, { rev: job.rev });
  expect(res.status).toBe(409);
});

test("„Erneut versuchen“ re-runs ONE part and leaves the rest alone (AK3)", async () => {
  setProviderForTests(new ThreeSceneProvider("zwei"));
  const first = await runJob();
  expect(first.pipeline!.parts[1]!.status).toBe("failed");

  // A second provider, this time with nothing broken — the retry has to use
  // the STORED outline, so the run is not started again.
  const retryProvider = new ThreeSceneProvider(null);
  setProviderForTests(retryProvider);
  const res = await send(
    "POST",
    `/api/beispiel/generate/job/${first.id}/parts/scene:zwei/retry`,
  );
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
  expect(after.result!.scenes.map((s) => s.path)).toEqual([
    "01-salzhafen/eins",
    "01-salzhafen/zwei",
    "01-salzhafen/drei",
  ]);
  // Only the retried part ran — no outline call, no sibling.
  expect(retryProvider.calls).toEqual(["zwei"]);
});

test("a retry that races a sibling's result does not clobber it", async () => {
  // The shape: part „zwei" failed, part „drei" is still in flight, and the DM
  // presses „Erneut versuchen" on „zwei" in exactly the moment „drei"
  // answers. The retry has to revive ITS part and nothing else — a revive
  // that writes back the whole pipeline column as it read it before the
  // context read puts „drei" back to `running`, and then the run has no
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
      if (req.assignment !== undefined && req.assignment.includes("drei")) await gate;
      return answer;
    }
  }
  setProviderForTests(new HoldsLast("zwei"));
  expect(
    (
      await send("POST", "/api/beispiel/generate", {
        chapter: "01-salzhafen",
        sourceText: "Fenn waits at the docks.",
      })
    ).status,
  ).toBe(202);
  const before = await waitForParts((parts) =>
    parts.map((p) => p.status).join() === "done,failed,running",
  );
  expect(before.status).toBe("running");

  // Fire the retry and let „drei" answer INTO its context read.
  setProviderForTests(new HoldsLast(null));
  const retry = send("POST", `/api/beispiel/generate/job/${before.id}/parts/scene:zwei/retry`);
  release?.();
  expect((await retry).status).toBe(202);

  const after = await waitForParts((parts) => parts.every((p) => p.status === "done"));
  expect(after.pipeline!.parts.map((p) => p.status)).toEqual(["done", "done", "done"]);
  // …and the run settled, which is the property the clobber destroyed.
  expect(after.status).toBe("done");
  expect(after.result!.scenes.map((s) => s.path)).toEqual([
    "01-salzhafen/eins",
    "01-salzhafen/zwei",
    "01-salzhafen/drei",
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
  setProviderForTests(new HoldsEverything(null, [...SCENE_IDS, "vier"]));
  await send("POST", "/api/beispiel/generate", {
    chapter: "01-salzhafen",
    sourceText: "Fenn waits at the docks.",
  });
  const job = await waitForParts(
    (parts) => parts.length === 4 && parts[3]!.status === "pending",
  );
  const res = await send("POST", `/api/beispiel/generate/job/${job.id}/parts/scene:vier/retry`);
  expect(res.status).toBe(409);
  expect((await fetchJob())!.pipeline!.parts[3]!.status).toBe("pending");
});

test("a retry is refused for a part that is done, and for an unknown key", async () => {
  setProviderForTests(new ThreeSceneProvider(null));
  const job = await runJob();
  expect(
    (await send("POST", `/api/beispiel/generate/job/${job.id}/parts/scene:eins/retry`)).status,
  ).toBe(409);
  expect(
    (await send("POST", `/api/beispiel/generate/job/${job.id}/parts/scene:nope/retry`)).status,
  ).toBe(404);
  expect(
    (await send("POST", "/api/beispiel/generate/job/not-this-one/parts/scene:eins/retry")).status,
  ).toBe(404);
});

test("a restart fails the open parts and keeps the finished ones (AK3)", async () => {
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
      if (req.assignment !== undefined && /^drei /.test(req.assignment)) {
        await gate;
      }
      return answer;
    }
  }
  setProviderForTests(new HoldingProvider(null));
  await send("POST", "/api/beispiel/generate", {
    chapter: "01-salzhafen",
    sourceText: "Fenn waits at the docks.",
  });
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
  // that was in flight says what happened, next to „Erneut versuchen“.
  expect(after.status).toBe("done");
  expect(after.pipeline!.parts.map((p) => p.status)).toEqual(["done", "done", "failed"]);
  expect(after.pipeline!.parts[2]!.error).toBe(RESTART_FAILURE_MESSAGE);
  expect(after.result!.scenes.map((s) => s.path)).toEqual([
    "01-salzhafen/eins",
    "01-salzhafen/zwei",
  ]);
  // The abandoned call finishing later must not resurrect anything.
  held?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect((await fetchJob())!.pipeline!.parts[2]!.status).toBe("failed");
});

test("„Verwerfen“ stops the open parts — nothing of them lands afterwards", async () => {
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
  await send("POST", "/api/beispiel/generate", {
    chapter: "01-salzhafen",
    sourceText: "Fenn waits at the docks.",
  });
  for (let i = 0; i < 2000; i += 1) {
    const job = await fetchJob();
    if ((job?.pipeline?.parts.length ?? 0) === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  expect((await send("DELETE", "/api/beispiel/generate/job")).status).toBe(200);
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
          content: [
            "---",
            "id: brakk",
            "name: Brakk",
            "status: alive",
            "---",
            "",
            "## Will",
            "",
            "Ruhe am Kai.",
            "",
          ].join("\n"),
        },
        warnings: [],
      }),
    ]),
  );
  expect(
    (await send("POST", "/api/beispiel/generate/npc", { sourceText: "An ageing fisherman." }))
      .status,
  ).toBe(202);
  for (let i = 0; i < 2000; i += 1) {
    const job = await fetchJob();
    if (job!.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const job = (await fetchJob())!;
  expect(job.status).toBe("done");
  // An npc run has no parts (PO decision: it stays one call), so it carries
  // no pipeline at all and the review renders exactly as it did.
  expect(job.pipeline).toBeUndefined();
});
