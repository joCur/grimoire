// A scene run with SUPPLEMENTARY material beside its source text: the outline
// names for each scene where its passage comes from, the server cuts each
// passage out of its own text, and the material travels whole in the
// constant half of every call of the run.
//
// The pure halves (the outline validation, the passage cut, the prompt
// assembly) are called directly; the run itself goes through the real
// endpoints against the real job row, with a provider that records every
// call it answers.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GeneratorJob } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generator-jobs";
import { ASSET_FILES, loadAsset, loadPromptAssets, setProviderForTests } from "../src/generator";
import {
  MAX_OUTLINE_SCENES,
  passageNotes,
  scenePassages,
  validateOutlineReply,
  type SceneContext,
} from "../src/generate-pipeline";
import {
  SUPPLEMENT_HEADING,
  SUPPLEMENT_PASSAGE_HEADING,
  buildPrompt,
  buildPromptParts,
  type CompletionResult,
  type CorrectionTurn,
  type GenerateRequest,
  type LLMProvider,
} from "../src/llm-provider";
import { jobsUrl, partUrl, readJob } from "./support/generator-jobs";
import { dropStore, seedStore } from "./support/store";

const CTX = {
  chapter: "01-salt-harbour",
  newChapter: false,
  npcs: [{ id: "fenn", name: "Fenn" }],
  locations: [{ id: "harbour", name: "The Harbour" }],
  knowledge: "",
  glossary: "",
  glossaryTerms: [],
  namingRules: [],
  npcIds: new Set(["fenn"]),
  locationIds: new Set(["harbour"]),
  sceneIds: new Set<string>(),
} satisfies SceneContext;

const SOURCE = [
  "The party arrives at the harbour on the evening tide.",
  "Fenn waits at the docks.",
  "",
  "A storm breaks over the bay at midnight.",
  "The boats strain at their moorings.",
].join("\n");

const SUPPLEMENT = [
  "The lighthouse keeper poses a riddle to every visitor.",
  "Whoever answers it may climb the tower.",
  "",
  "During the storm a ghost ship drifts past the mole.",
  "Its lanterns burn green.",
].join("\n");

/** A passage's two quotes: its first and its last line of the text above. */
type Quote = { first: string; last: string };

const ARRIVAL: Quote = {
  first: "The party arrives at the harbour on the evening tide.",
  last: "Fenn waits at the docks.",
};
const STORM: Quote = {
  first: "A storm breaks over the bay at midnight.",
  last: "The boats strain at their moorings.",
};
const RIDDLE: Quote = {
  first: "The lighthouse keeper poses a riddle to every visitor.",
  last: "Whoever answers it may climb the tower.",
};
const GHOST: Quote = {
  first: "During the storm a ghost ship drifts past the mole.",
  last: "Its lanterns burn green.",
};

/** The passage two quotes cut: both lines, as the text holds them. */
const passageOf = (quote: Quote) => `${quote.first}\n${quote.last}`;

/** One scene of an outline reply, quoting its passages. */
function outlineScene(id: string, title: string, source: Quote | null, supplement: Quote | null) {
  return {
    id,
    title,
    type: "planned",
    location: null,
    sourceExcerpt: source,
    supplementExcerpt: supplement,
    refs: [],
  };
}

/** The outline of the run every case here reads: arrival, riddle, storm. */
function outlineScenes() {
  return [
    outlineScene("arrival", "Arrival", ARRIVAL, null),
    outlineScene("riddle", "The keeper's riddle", null, RIDDLE),
    outlineScene("storm", "Storm night", STORM, GHOST),
  ];
}

// --- the outline validation ---------------------------------------------------

describe("the outline of a run with supplementary material", () => {
  const reply = (scenes: unknown[]) =>
    JSON.stringify({ scenes, npcs: [], locations: [], chapterDescription: null, warnings: [] });

  test("keeps each scene's quotes of both texts, in one order", () => {
    const outcome = validateOutlineReply(reply(outlineScenes()), CTX, false, true);
    if (!outcome.ok) throw new Error(outcome.errors.join("; "));
    expect(outcome.result.scenes.map((scene) => scene.id)).toEqual(["arrival", "riddle", "storm"]);
    expect(outcome.result.scenes[0]).toMatchObject({ sourceExcerpt: ARRIVAL });
    expect(outcome.result.scenes[0]!.supplementExcerpt).toBeUndefined();
    expect(outcome.result.scenes[1]).toMatchObject({ supplementExcerpt: RIDDLE });
    expect(outcome.result.scenes[1]!.sourceExcerpt).toBeUndefined();
    expect(outcome.result.scenes[2]).toMatchObject({
      sourceExcerpt: STORM,
      supplementExcerpt: GHOST,
    });
  });

  test("a supplement quote without both sentences is a correction turn", () => {
    const scenes = outlineScenes();
    scenes[1]!.supplementExcerpt = { first: RIDDLE.first, last: "" };
    const outcome = validateOutlineReply(reply(scenes), CTX, false, true);
    expect(outcome.ok).toBe(false);
    expect((outcome as { errors: string[] }).errors.join("\n")).toContain('"supplementExcerpt"');
  });

  test("a run without supplementary material does not read the quote", () => {
    const outcome = validateOutlineReply(reply(outlineScenes()), CTX);
    if (!outcome.ok) throw new Error(outcome.errors.join("; "));
    for (const scene of outcome.result.scenes) expect(scene.supplementExcerpt).toBeUndefined();
  });

  test("an outline names up to 20 scenes; above that it is asked to merge", () => {
    expect(MAX_OUTLINE_SCENES).toBe(20);
    const scenes = (count: number) =>
      Array.from({ length: count }, (_, i) => outlineScene(`scene-${i}`, `Scene ${i}`, null, null));
    expect(validateOutlineReply(reply(scenes(20)), CTX, false, true).ok).toBe(true);
    const tooMany = validateOutlineReply(reply(scenes(21)), CTX, false, true);
    expect(tooMany.ok).toBe(false);
    expect((tooMany as { errors: string[] }).errors.join("\n")).toContain("höchstens 20");
  });
});

// --- cutting the passages -------------------------------------------------------

describe("a scene's passages", () => {
  test("a scene of the source alone gets its source passage and nothing of the supplement", () => {
    const passages = scenePassages({ sourceExcerpt: ARRIVAL }, SOURCE, SUPPLEMENT);
    expect(passages.source).toEqual({ text: passageOf(ARRIVAL), matched: true });
    expect(passages.supplement).toBeUndefined();
    expect(passageNotes(passages)).toEqual([]);
  });

  test("a scene of the supplement alone gets its supplement passage, no source and no note", () => {
    const passages = scenePassages({ supplementExcerpt: RIDDLE }, SOURCE, SUPPLEMENT);
    expect(passages.source).toBeUndefined();
    expect(passages.supplement).toEqual({ text: passageOf(RIDDLE), matched: true });
    expect(passageNotes(passages)).toEqual([]);
  });

  test("a scene of both gets both passages, each cut from its own text", () => {
    const passages = scenePassages(
      { sourceExcerpt: STORM, supplementExcerpt: GHOST },
      SOURCE,
      SUPPLEMENT,
    );
    expect(passages.source).toEqual({ text: passageOf(STORM), matched: true });
    expect(passages.supplement).toEqual({ text: passageOf(GHOST), matched: true });
  });

  test("an unmatched quote falls back to the whole text of ITS source, with its note", () => {
    const supplementMiss = scenePassages(
      { supplementExcerpt: { first: "Not in the supplement.", last: "Nor this." } },
      SOURCE,
      SUPPLEMENT,
    );
    expect(supplementMiss.source).toBeUndefined();
    expect(supplementMiss.supplement).toEqual({ text: SUPPLEMENT, matched: false });
    expect(passageNotes(supplementMiss)).toEqual(["supplement_excerpt_unmatched"]);

    const sourceMiss = scenePassages(
      { sourceExcerpt: { first: "Not in the source.", last: "Nor this." }, supplementExcerpt: GHOST },
      SOURCE,
      SUPPLEMENT,
    );
    expect(sourceMiss.source).toEqual({ text: SOURCE, matched: false });
    expect(passageNotes(sourceMiss)).toEqual(["source_excerpt_unmatched"]);
  });

  test("a scene that quotes neither gets the whole source, as without a supplement", () => {
    expect(scenePassages({}, SOURCE, SUPPLEMENT)).toEqual({ source: { text: SOURCE, matched: false } });
    expect(scenePassages({}, SOURCE, undefined)).toEqual({ source: { text: SOURCE, matched: false } });
    // Without supplementary material a supplement quote is not read at all.
    expect(scenePassages({ supplementExcerpt: RIDDLE }, SOURCE, undefined)).toEqual({
      source: { text: SOURCE, matched: false },
    });
  });
});

// --- the prompt -------------------------------------------------------------------

describe("the prompt of a run with supplementary material", () => {
  const base: GenerateRequest = {
    systemPrompt: "sys",
    fewShotTarget: "few",
    knowledge: "",
    glossary: "g",
    context: { chapter: CTX.chapter, npcs: CTX.npcs, locations: CTX.locations },
    outline: "Szenen dieses Durchlaufs …",
    sourceText: "Passage.",
  };

  test("the material stands whole in the constant half, the passage in the variable one", () => {
    const parts = buildPromptParts({ ...base, supplement: SUPPLEMENT, supplementPassage: "A passage." });
    expect(parts.constant).toContain(`${SUPPLEMENT_HEADING}\n\n${SUPPLEMENT}`);
    expect(parts.variable).not.toContain(SUPPLEMENT);
    expect(parts.variable).toContain(`${SUPPLEMENT_PASSAGE_HEADING}\n\nA passage.`);
  });

  test("without supplementary material the prompt is exactly what it was", () => {
    const plain = buildPrompt(base);
    expect(buildPrompt({ ...base, supplement: undefined, supplementPassage: undefined })).toBe(plain);
    expect(buildPrompt({ ...base, supplement: "  " })).toBe(plain);
    expect(plain).not.toContain(SUPPLEMENT_HEADING);
  });
});

// --- the run through the endpoints ------------------------------------------------

/** One call the provider answered: what kind of call, and its request. */
interface Call {
  kind: "outline" | "scene" | "npc" | "extension" | "patch";
  req: GenerateRequest;
}

const SCENE_NOTE = "The keeper's name is not given.";

/**
 * Answers every call of the run: the outline (arrival, riddle, storm, a new
 * npc and — when the run may extend — Fenn), each scene, the npc, the
 * extension and a patch round. Records every request.
 */
class SupplementProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: Call[] = [];

  async complete(req: GenerateRequest, _corrections: CorrectionTurn[] = []): Promise<CompletionResult> {
    const reply = (kind: Call["kind"], value: unknown): CompletionResult => {
      this.calls.push({ kind, req });
      return { text: JSON.stringify(value), truncated: false };
    };
    if (req.answers !== undefined) {
      return reply("patch", { operations: [{ op: "set", field: "title", value: "The keeper's question" }] });
    }
    if (req.existingNpc !== undefined) {
      return reply("extension", { operations: [{ op: "note", text: "Nothing to add." }] });
    }
    if (req.outline === undefined) {
      const scenes = req.supplement === undefined ? outlineScenes().slice(0, 1) : outlineScenes();
      return reply("outline", {
        scenes,
        npcs: [{ id: "keeper", name: "The keeper", summary: "Guards the lighthouse." }],
        locations: [],
        existingNpcs: [{ id: "fenn", summary: "Knows the ghost ship." }],
        existingLocations: [],
        chapterDescription: null,
        warnings: [],
      });
    }
    if (req.context.targetId === "keeper") {
      return reply("npc", {
        id: "keeper",
        name: "The keeper",
        role: null,
        chapter: null,
        status: "alive",
        statblock: null,
        quickstats: null,
        voice: null,
        appearance: null,
        motivation: null,
        body: "Guards the lighthouse.\n",
        warnings: [],
      });
    }
    const id = /^([a-z0-9-]+) /.exec(req.assignment ?? "")?.[1] ?? "";
    return reply("scene", {
      id,
      title: outlineScenes().find((scene) => scene.id === id)?.title ?? id,
      type: "planned",
      trigger: null,
      chapter: CTX.chapter,
      location: null,
      npcs: [],
      handouts: [],
      tags: [],
      status: "draft",
      body: "## Flow\n\nThe party goes on.\n",
      warnings: id === "riddle" ? [SCENE_NOTE] : [],
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

async function runJob(provider: SupplementProvider, supplementText?: string): Promise<GeneratorJob> {
  setProviderForTests(provider);
  const started = await send("POST", jobsUrl("example"), {
    kind: "scene",
    chapter: CTX.chapter,
    sourceText: SOURCE,
    extend: true,
    ...(supplementText === undefined ? {} : { supplementText }),
  });
  expect(started.status).toBe(202);
  return until((job) => job.status === "done");
}

beforeEach(async () => {
  await seedStore();
});

afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
  dropStore();
});

describe("a scene run with supplementary material", () => {
  test("every call carries the material whole in its constant half and reads its rules", async () => {
    const provider = new SupplementProvider();
    const job = await runJob(provider, SUPPLEMENT);
    // A patch round on the scene the supplement alone brings: the round
    // reads the material from the job's row.
    const round = await send("PATCH", partUrl("example", job.id, "scene:riddle"), {
      rev: job.rev,
      round: { answers: [{ note: SCENE_NOTE, answer: "Call him Odo." }] },
    });
    expect(round.status).toBe(202);
    const riddlePart = (current: GeneratorJob) =>
      current.pipeline!.parts.find((p) => p.key === "scene:riddle")!;
    await until((current) => riddlePart(current).round?.status === "done");

    expect(provider.calls.map((call): string => call.kind).sort()).toEqual(
      ["extension", "npc", "outline", "patch", "scene", "scene", "scene"].sort(),
    );
    const rules = (await loadAsset(ASSET_FILES.supplement.systemPrompt)).trimEnd();
    for (const { kind, req } of provider.calls) {
      expect(buildPromptParts(req).constant, kind).toContain(`${SUPPLEMENT_HEADING}\n\n${SUPPLEMENT}`);
      expect(req.systemPrompt, kind).toContain(rules);
    }
    // The outline prompt also carries its own rules, and its schema the quote.
    const outline = provider.calls.find((call) => call.kind === "outline")!.req;
    expect(outline.systemPrompt).toContain(
      (await loadAsset(ASSET_FILES.outlineSupplement.systemPrompt)).trimEnd(),
    );
    expect(JSON.stringify(outline.jsonSchema!.schema)).toContain("supplementExcerpt");

    // The scene parts of one run share a byte-identical constant prefix.
    const scenes = provider.calls.filter((call) => call.kind === "scene");
    const constants = new Set(scenes.map((call) => buildPromptParts(call.req).constant));
    expect(constants.size).toBe(1);
  });

  test("each scene gets the passages it names, and a supplement scene no source and no note", async () => {
    const provider = new SupplementProvider();
    const job = await runJob(provider, SUPPLEMENT);
    const scene = (id: string) =>
      provider.calls.find((call) => call.kind === "scene" && call.req.assignment?.startsWith(`${id} `))!.req;

    expect(scene("arrival").sourceText).toBe(passageOf(ARRIVAL));
    expect(scene("arrival").supplementPassage).toBeUndefined();

    const riddle = scene("riddle");
    expect(riddle.sourceText).toBe("");
    expect(buildPromptParts(riddle).variable).not.toContain("## Quelltext");
    expect(riddle.supplementPassage).toBe(passageOf(RIDDLE));

    expect(scene("storm").sourceText).toBe(passageOf(STORM));
    expect(scene("storm").supplementPassage).toBe(passageOf(GHOST));

    // No scene was written from a whole text, so no part carries a note of it.
    for (const part of job.pipeline!.parts) expect(part.serverNotes ?? []).toEqual([]);
    expect(job.result!.scenes.map((s) => s.id)).toEqual(["arrival", "riddle", "storm"]);
  });

  test("a run without supplementary material prompts exactly as before", async () => {
    const provider = new SupplementProvider();
    await runJob(provider);
    const outline = provider.calls.find((call) => call.kind === "outline")!.req;
    // The plain outline prompt with the extension rules, and no quote of a supplement.
    expect(outline.systemPrompt).not.toContain(
      (await loadAsset(ASSET_FILES.supplement.systemPrompt)).trimEnd(),
    );
    expect(JSON.stringify(outline.jsonSchema!.schema)).not.toContain("supplementExcerpt");
    const npc = provider.calls.find((call) => call.kind === "npc")!.req;
    expect(npc.systemPrompt).toBe((await loadPromptAssets("npc")).systemPrompt);
    for (const { kind, req } of provider.calls) {
      expect(req.supplement, kind).toBeUndefined();
      expect(req.supplementPassage, kind).toBeUndefined();
      expect(buildPrompt(req), kind).not.toContain(SUPPLEMENT_HEADING);
    }
  });

  test("a blank supplement is the same as none", async () => {
    const provider = new SupplementProvider();
    await runJob(provider, "  \n ");
    for (const { req } of provider.calls) expect(req.supplement).toBeUndefined();
  });
});
