// The TERMS of a scene run (decisions/generator): the outline names the
// material's own terms with a proposed rendering, the run waits on the DM
// before any part call, the confirmation decides every term and keeps the
// ticked ones in the glossary, and every call after it carries the decided
// list in its constant half.
//
// The pure halves (the outline validation, the prompt block) are called
// directly; the run itself goes through the real endpoints against the real
// job row, with a provider that records every call it answers.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GeneratorJob, GlossaryTerm } from "@grimoire/shared";
import { app } from "../src/server";
import { failInterruptedJobs } from "../src/db/job-boot";
import { clearJobsForTests } from "../src/generator-jobs";
import { setProviderForTests } from "../src/generator";
import { termsBlock, validateOutlineReply, type SceneContext } from "../src/generate-pipeline";
import {
  KNOWLEDGE_HEADING,
  TERMS_HEADING,
  buildPrompt,
  buildPromptParts,
  type CompletionResult,
  type CorrectionTurn,
  type GenerateRequest,
  type LLMProvider,
} from "../src/llm-provider";
import { getDb } from "../src/store/handle";
import { jobUrl, jobsUrl, partUrl, readJob } from "./support/generator-jobs";
import { dropStore, seedStore } from "./support/store";

const CTX = {
  chapter: "01-salt-harbour",
  newChapter: false,
  npcs: [{ id: "fenn", name: "Fenn" }],
  locations: [],
  knowledge: "",
  glossary: "",
  glossaryTerms: ["lighthouse keeper"],
  namingRules: [{ from: "Salt Harbour", to: "Salzhafen" }],
  npcIds: new Set(["fenn"]),
  locationIds: new Set<string>(),
  sceneIds: new Set<string>(),
} satisfies SceneContext;

const SOURCE = "The party reaches Elturel. A Companion greets them at the High Hall.";

/** The terms the outline of the run below names, as the model wrote them. */
const OUTLINE_TERMS = [
  {
    wording: "Companion",
    description: "Honorary title of every citizen of Elturel.",
    kind: "person",
    rendering: "Sworn Companion",
  },
  { wording: "High Hall", description: "The seat of the council.", kind: "place", rendering: "High Hall" },
  { wording: "Hellriders", description: "The city's cavalry.", kind: "group", rendering: "Hell Riders" },
  // Covered by the fixture's glossary and by a naming convention, ignoring case.
  { wording: "Lighthouse Keeper", description: "", kind: "person", rendering: "Keeper" },
  { wording: "salt harbour", description: "", kind: "place", rendering: "Salzhafen" },
];

function outline(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    scenes: [
      {
        id: "arrival",
        title: "Arrival",
        type: "planned",
        location: "high-hall",
        sourceExcerpt: null,
        refs: [],
      },
    ],
    npcs: [{ id: "ulder", name: "Ulder", summary: "The council's herald." }],
    locations: [{ id: "high-hall", name: "High Hall", summary: "The seat of the council." }],
    terms: OUTLINE_TERMS,
    chapterDescription: null,
    warnings: [],
    ...over,
  });
}

// --- the outline --------------------------------------------------------------

describe("the terms of an outline", () => {
  test("are read with their wording, description, kind and proposed rendering", () => {
    const outcome = validateOutlineReply(outline(), CTX);
    if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
    expect(outcome.result.terms).toEqual([
      OUTLINE_TERMS[0]!,
      OUTLINE_TERMS[1]!,
      OUTLINE_TERMS[2]!,
    ] as never);
  });

  test("a term the glossary or a naming convention covers is not asked again", () => {
    const outcome = validateOutlineReply(outline(), CTX);
    if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
    const wordings = outcome.result.terms.map((term) => term.wording);
    expect(wordings).not.toContain("Lighthouse Keeper");
    expect(wordings).not.toContain("salt harbour");
  });

  test("a second term of the same wording is dropped, a missing rendering keeps the wording", () => {
    const outcome = validateOutlineReply(
      outline({
        terms: [
          { wording: "Soul coin", description: "Currency of Avernus.", kind: "game-term" },
          { wording: "soul coin", description: "Again.", kind: "game-term", rendering: "x" },
        ],
      }),
      CTX,
    );
    if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
    expect(outcome.result.terms).toEqual([
      { wording: "Soul coin", description: "Currency of Avernus.", kind: "game-term", rendering: "Soul coin" },
    ]);
  });

  test("a reply without terms has none, and a term of an unknown kind is a correction", () => {
    const without = validateOutlineReply(outline({ terms: undefined }), CTX);
    expect(without.ok && without.result.terms).toEqual([]);
    const unknown = validateOutlineReply(
      outline({ terms: [{ wording: "Avernus", description: "", kind: "plane", rendering: "Avernus" }] }),
      CTX,
    );
    expect(unknown.ok).toBe(false);
    expect((unknown as { errors: string[] }).errors.join("\n")).toContain('"kind"');
  });
});

// --- the prompt -----------------------------------------------------------------

describe("the prompt of a run with decided terms", () => {
  const base: GenerateRequest = {
    systemPrompt: "sys",
    fewShotTarget: "few",
    knowledge: "- Fakt: Der Leuchtturm ist leer.",
    glossary: "g",
    context: { chapter: CTX.chapter, npcs: CTX.npcs, locations: CTX.locations },
    outline: "Szenen dieses Durchlaufs …",
    sourceText: "Passage.",
  };
  const block = termsBlock([
    { wording: "Companion", description: "Honorary title.", kind: "person", rendering: "Gefährte" },
    { wording: "High Hall", description: "", kind: "place", rendering: "High Hall" },
  ]);

  test("one line per term: wording, rendering and what it is", () => {
    expect(block).toBe(
      "- schreibe „Companion“ als „Gefährte“ (Honorary title.)\n- schreibe „High Hall“ als „High Hall“",
    );
  });

  test("the list stands in the constant half, right below the campaign knowledge", () => {
    const { constant, variable } = buildPromptParts({ ...base, terms: block });
    expect(constant).toContain(`${TERMS_HEADING}\n\n${block}\n\n## Glossar`);
    expect(constant.indexOf(KNOWLEDGE_HEADING)).toBeLessThan(constant.indexOf(TERMS_HEADING));
    expect(variable).not.toContain(TERMS_HEADING);
  });

  test("without terms the prompt is exactly what it was", () => {
    const plain = buildPrompt(base);
    expect(buildPrompt({ ...base, terms: "" })).toBe(plain);
    expect(plain).not.toContain(TERMS_HEADING);
  });
});

// --- the run through the endpoints ------------------------------------------------

/** One call the provider answered: what kind of call, and its request. */
interface Call {
  kind: "outline" | "scene" | "npc" | "location" | "patch";
  req: GenerateRequest;
}

const SCENE_NOTE = "The source names no herald.";

/** Answers every call of the run and records it; `outlineTerms` is what the outline names. */
class TermsProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: Call[] = [];
  constructor(private readonly outlineTerms: unknown[] = OUTLINE_TERMS) {}

  async complete(req: GenerateRequest, _corrections: CorrectionTurn[] = []): Promise<CompletionResult> {
    const reply = (kind: Call["kind"], value: unknown): CompletionResult => {
      this.calls.push({ kind, req });
      return { text: typeof value === "string" ? value : JSON.stringify(value), truncated: false };
    };
    if (req.answers !== undefined) {
      return reply("patch", { operations: [{ op: "set", field: "title", value: "Arrival at the hall" }] });
    }
    if (req.outline === undefined) return reply("outline", outline({ terms: this.outlineTerms }));
    if (req.context.targetId === "ulder") {
      return reply("npc", {
        id: "ulder",
        name: "Ulder",
        role: null,
        chapter: null,
        status: "alive",
        statblock: null,
        quickstats: null,
        voice: null,
        appearance: null,
        motivation: null,
        body: "The council's herald.\n",
        warnings: [],
      });
    }
    if (req.context.targetId === "high-hall") {
      return reply("location", {
        id: "high-hall",
        name: "High Hall",
        chapter: null,
        roll20Page: null,
        atmosphere: null,
        body: "The seat of the council.\n",
        warnings: [],
      });
    }
    return reply("scene", {
      id: "arrival",
      title: "Arrival",
      type: "planned",
      trigger: null,
      chapter: CTX.chapter,
      location: "high-hall",
      npcs: ["ulder"],
      handouts: [],
      tags: [],
      status: "draft",
      body: "## Flow\n\nA Companion greets the party.\n",
      warnings: [SCENE_NOTE],
    });
  }
}

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

async function until(ready: (job: GeneratorJob) => boolean): Promise<GeneratorJob> {
  for (let i = 0; i < 4000; i += 1) {
    const job = await readJob("example");
    if (job !== null && ready(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("the job never reached the expected state");
}

async function startRun(provider: TermsProvider): Promise<GeneratorJob> {
  setProviderForTests(provider);
  const started = await send("POST", jobsUrl("example"), {
    kind: "scene",
    chapter: CTX.chapter,
    sourceText: SOURCE,
  });
  expect(started.status).toBe(202);
  return until((job) => job.status === "done");
}

/** Every term of the job, decided as it stands and kept in the glossary. */
function acceptAll(job: GeneratorJob): Record<string, { rendering: string; glossary: boolean }> {
  return Object.fromEntries(
    job.pipeline!.terms!.list.map((term) => [term.wording, { rendering: term.rendering, glossary: true }]),
  );
}

async function glossary(): Promise<GlossaryTerm[]> {
  return (await app.request("/api/campaigns/example/glossary-terms")).json() as Promise<GlossaryTerm[]>;
}

beforeEach(async () => {
  await seedStore({
    knowledgeItems: [{ id: "salt", kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }],
  });
});

afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
  dropStore();
});

describe("a scene run with new terms", () => {
  test("waits after the outline: no part call, every part pending, the terms open", async () => {
    const provider = new TermsProvider();
    const job = await startRun(provider);
    expect(provider.calls.map((call) => call.kind)).toEqual(["outline"]);
    expect(job.pipeline!.parts.map((part) => part.status)).toEqual(["pending", "pending", "pending"]);
    expect(job.pipeline!.terms!.status).toBe("open");
    expect(job.pipeline!.terms!.list.map((term) => term.wording)).toEqual([
      "Companion",
      "High Hall",
      "Hellriders",
    ]);
    // The outline is asked for the terms; it does not carry a decided list.
    expect(JSON.stringify(provider.calls[0]!.req.jsonSchema!.schema)).toContain('"terms"');
    expect(provider.calls[0]!.req.terms).toBeUndefined();
    // Nothing waits for a poll: the job is not running, and a restart leaves it waiting.
    expect(failInterruptedJobs(await getDb())).toBe(0);
    const after = (await readJob("example"))!;
    expect(after.status).toBe("done");
    expect(after.pipeline!.terms!.status).toBe("open");
    expect(after.pipeline!.parts.every((part) => part.status === "pending")).toBe(true);
  });

  test("the confirmation decides every term, keeps the ticked ones and runs the parts with them", async () => {
    const provider = new TermsProvider();
    const job = await startRun(provider);
    const confirmed = await send("PATCH", jobUrl("example", job.id), {
      rev: job.rev,
      terms: {
        Companion: { rendering: "Gefährte", glossary: true },
        "High Hall": { rendering: "  ", glossary: false },
        Hellriders: { rendering: "Höllenreiter", glossary: true },
      },
    });
    expect(confirmed.status).toBe(202);
    const done = await until(
      (current) =>
        current.status === "done" && current.pipeline!.parts.every((part) => part.status === "done"),
    );
    expect(done.pipeline!.terms).toEqual({
      status: "confirmed",
      list: [
        { ...OUTLINE_TERMS[0]!, rendering: "Gefährte" },
        // A blank rendering keeps the wording.
        { ...OUTLINE_TERMS[1]!, rendering: "High Hall" },
        { ...OUTLINE_TERMS[2]!, rendering: "Höllenreiter" },
      ] as never,
    });

    // Every part call carries the decided list in its constant half.
    const parts = provider.calls.filter((call) => call.kind !== "outline");
    expect(parts.map((call) => call.kind).sort()).toEqual(["location", "npc", "scene"]);
    const block = termsBlock(done.pipeline!.terms!.list);
    for (const { kind, req } of parts) {
      expect(buildPromptParts(req).constant, kind).toContain(`${TERMS_HEADING}\n\n${block}`);
    }
    expect(block).toContain("„Companion“ als „Gefährte“");

    // The ticked terms stand in the glossary: the wording, the rendering and
    // what it is; the unticked one does not.
    const terms = await glossary();
    expect(terms.find((term) => term.term === "Companion")?.explanation).toBe(
      "Gefährte — Honorary title of every citizen of Elturel.",
    );
    expect(terms.find((term) => term.term === "Hellriders")?.explanation).toBe(
      "Höllenreiter — The city's cavalry.",
    );
    expect(terms.some((term) => term.term === "High Hall")).toBe(false);

    // A patch round reads the list from the job's row.
    const round = await send("PATCH", partUrl("example", done.id, "scene:arrival"), {
      rev: done.rev,
      round: { answers: [{ note: SCENE_NOTE, answer: "Call him Ulder." }] },
    });
    expect(round.status).toBe(202);
    await until(
      (current) =>
        current.pipeline!.parts.find((part) => part.key === "scene:arrival")!.round?.status === "done",
    );
    const patch = provider.calls.find((call) => call.kind === "patch")!.req;
    expect(buildPromptParts(patch).constant).toContain(`${TERMS_HEADING}\n\n${block}`);
  });

  test("a ticked term the glossary already has is skipped, not an error", async () => {
    const provider = new TermsProvider();
    const job = await startRun(provider);
    const taken = await send("POST", "/api/campaigns/example/glossary-terms", {
      term: "companion",
      explanation: "the DM's own",
    });
    expect(taken.status).toBe(201);
    const confirmed = await send("PATCH", jobUrl("example", job.id), {
      rev: job.rev,
      terms: acceptAll(job),
    });
    expect(confirmed.status).toBe(202);
    const terms = await glossary();
    expect(terms.filter((term) => term.term.toLowerCase() === "companion")).toEqual([
      expect.objectContaining({ term: "companion", explanation: "the DM's own" }),
    ]);
    expect(terms.some((term) => term.term === "Hellriders")).toBe(true);
  });

  test("a confirmation that is stale, incomplete or names another term writes nothing", async () => {
    const provider = new TermsProvider();
    const job = await startRun(provider);
    const all = acceptAll(job);
    const stale = await send("PATCH", jobUrl("example", job.id), { rev: job.rev + 1, terms: all });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { generatorJob: GeneratorJob }).generatorJob.id).toBe(job.id);
    const { Companion: _left, ...missing } = all;
    expect((await send("PATCH", jobUrl("example", job.id), { rev: job.rev, terms: missing })).status).toBe(400);
    const extra = { ...all, Avernus: { rendering: "Avernus", glossary: true } };
    expect((await send("PATCH", jobUrl("example", job.id), { rev: job.rev, terms: extra })).status).toBe(400);
    const mixed = await send("PATCH", jobUrl("example", job.id), {
      rev: job.rev,
      terms: all,
      review: { stage: "npcs" },
    });
    expect(mixed.status).toBe(400);
    // Nothing ran and nothing was written.
    expect(provider.calls.map((call) => call.kind)).toEqual(["outline"]);
    expect((await glossary()).some((term) => term.term === "Companion")).toBe(false);
    const after = (await readJob("example"))!;
    expect(after.rev).toBe(job.rev);
    expect(after.pipeline!.terms!.status).toBe("open");

    // Confirmed once, the terms are not confirmed again.
    expect((await send("PATCH", jobUrl("example", job.id), { rev: job.rev, terms: all })).status).toBe(202);
    const running = (await readJob("example"))!;
    const again = await send("PATCH", jobUrl("example", job.id), { rev: running.rev, terms: all });
    expect(again.status).toBe(409);
  });

  test("a part retried after the confirmation carries the decided list", async () => {
    // The scene fails its first round (initial call and correction turn) and
    // answers from then on.
    let sceneCalls = 0;
    class FailingOnce extends TermsProvider {
      override async complete(req: GenerateRequest, corrections: CorrectionTurn[] = []) {
        if (req.assignment !== undefined && req.answers === undefined) {
          sceneCalls += 1;
          if (sceneCalls <= 2) return { text: "not json", truncated: false };
        }
        return super.complete(req, corrections);
      }
    }
    const provider = new FailingOnce();
    const job = await startRun(provider);
    await send("PATCH", jobUrl("example", job.id), { rev: job.rev, terms: acceptAll(job) });
    const failed = await until(
      (current) =>
        current.status === "done" &&
        current.pipeline!.parts.find((part) => part.key === "scene:arrival")!.status === "failed",
    );
    const retried = await send("PATCH", partUrl("example", failed.id, "scene:arrival"), { status: "running" });
    expect(retried.status).toBe(202);
    await until(
      (current) => current.pipeline!.parts.find((part) => part.key === "scene:arrival")!.status === "done",
    );
    const scene = provider.calls.filter((call) => call.kind === "scene").at(-1)!.req;
    expect(scene.terms).toBe(termsBlock(failed.pipeline!.terms!.list));
  });
});

describe("a scene run whose outline finds no new terms", () => {
  test("skips the stage: the parts run right away, without a terms block", async () => {
    // Every term the outline names is one the campaign already covers.
    const provider = new TermsProvider([OUTLINE_TERMS[3], OUTLINE_TERMS[4]]);
    setProviderForTests(provider);
    await send("POST", jobsUrl("example"), { kind: "scene", chapter: CTX.chapter, sourceText: SOURCE });
    const job = await until(
      (current) =>
        current.status === "done" && current.pipeline!.parts.every((part) => part.status === "done"),
    );
    expect(job.pipeline!.terms).toBeUndefined();
    for (const { req } of provider.calls) expect(req.terms).toBeUndefined();
  });
});
