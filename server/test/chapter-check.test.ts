// The CHAPTER CHECK (decisions/generator): every row of a chapter names its
// own terms, one call merges them, a term the glossary decides is fixed right
// away, every other term written in different ways waits on the DM in the
// terms stage, and each row that writes a decided term otherwise is a part of
// its own whose fix is accepted as one patch of that row — refused when the
// row changed after the check read it.
//
// The pure half (sorting what the merge found) is called directly; the run
// itself goes through the real endpoints against the real job row, with a
// provider that answers each call of the check and records it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GeneratorJob, GlossaryTerm, Scene } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generator-jobs";
import { setProviderForTests } from "../src/generator";
import { fixBlock, sortTerms } from "../src/chapter-check";
import {
  CHECKED_ROW_HEADING,
  CHECK_TERMS_HEADING,
  TERMS_HEADING,
  buildPrompt,
  type CompletionResult,
  type CorrectionTurn,
  type GenerateRequest,
  type LLMProvider,
} from "../src/llm-provider";
import { acceptBody, jobUrl, jobsUrl, partUrl, readJob } from "./support/generator-jobs";
import { dropStore, seedStore } from "./support/store";

const CHAPTER = "01-salt-harbour";
const ARRIVAL = "lighthouse-arrival";
const CAPTURED = "smuggler-captured";

/** The term the chapter writes two ways, as the merge names it. */
const PARTY = {
  wording: "the party",
  description: "The adventurers.",
  kind: "game-term",
  rendering: "the party",
  variants: [
    { wording: "the party", places: [`scene:${ARRIVAL}`, `scene:${CAPTURED}`] },
    { wording: "the characters", places: [`scene:${CAPTURED}`] },
  ],
} as const;

/** The term the fixture's glossary decides ("lighthouse keeper" → the Keeper). */
const KEEPER = {
  wording: "lighthouse keeper",
  description: "The keeper of the lighthouse.",
  kind: "person",
  rendering: "Keeper",
  variants: [{ wording: "lighthouse keeper", places: [`scene:${ARRIVAL}`, `scene:${CAPTURED}`] }],
} as const;

type Call = { kind: "terms" | "merge" | "fix"; req: GenerateRequest };

/** The deviating spellings a fix call carries, out of its terms block. */
function fixPairs(terms: string): Array<[string, string]> {
  return [...terms.matchAll(/schreibe „([^“]+)“ als „([^“]+)“/g)].map((m) => [m[1]!, m[2]!]);
}

/** Replace every spelling, its capitalised form too. */
function fixed(text: string, pairs: ReadonlyArray<[string, string]>): string {
  let out = text;
  for (const [from, to] of pairs) {
    out = out.split(from).join(to);
    const upper = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
    out = out.split(upper(from)).join(upper(to));
  }
  return out;
}

/** Answers every call of a check; `merged` is what the merge names. */
class CheckProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: Call[] = [];
  constructor(private readonly merged: unknown[] = [PARTY, KEEPER]) {}

  async complete(req: GenerateRequest, _corrections: CorrectionTurn[] = []): Promise<CompletionResult> {
    const reply = (kind: Call["kind"], value: unknown): CompletionResult => {
      this.calls.push({ kind, req });
      return { text: JSON.stringify(value), truncated: false };
    };
    if (req.checkTerms !== undefined) return reply("merge", { terms: this.merged });
    if (req.terms !== undefined && req.checkedRow !== undefined) {
      const form = req.checkedRow.form as unknown as Record<string, unknown>;
      const pairs = fixPairs(req.terms);
      const operations: unknown[] = [];
      for (const [field, value] of Object.entries(form)) {
        if (field === "id" || field === "body" || typeof value !== "string") continue;
        if (fixed(value, pairs) !== value) operations.push({ op: "set", field, value: fixed(value, pairs) });
      }
      for (const block of String(form.body).split(/\n\s*\n/)) {
        const text = block.trim();
        if (text !== "" && !text.startsWith("## If:") && fixed(text, pairs) !== text) {
          operations.push({ op: "replace", anchor: text, text: fixed(text, pairs) });
        }
      }
      return reply("fix", { operations });
    }
    return reply("terms", { terms: [{ wording: "Fenn", description: "A smuggler.", kind: "person" }] });
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

const settledParts = (job: GeneratorJob) =>
  job.status === "done" && job.pipeline!.parts.every((part) => part.status === "done");

async function startCheck(provider: CheckProvider, chapter = CHAPTER): Promise<GeneratorJob> {
  setProviderForTests(provider);
  const started = await send("POST", jobsUrl("example"), { kind: "chapter-check", chapter });
  expect(started.status).toBe(202);
  return until((job) => job.status === "done");
}

async function scene(id: string): Promise<Scene> {
  return (await app.request(`/api/campaigns/example/scenes/${id}`)).json() as Promise<Scene>;
}

beforeEach(async () => {
  await seedStore();
});

afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
  dropStore();
});

// --- sorting what the merge found -------------------------------------------------

describe("what the merge found", () => {
  const rows = [
    { kind: "scene" as const, id: ARRIVAL, name: "Arrival" },
    { kind: "scene" as const, id: CAPTURED, name: "Captured" },
    { kind: "npc" as const, id: "fenn", name: "Fenn" },
  ];
  const ctx = {
    glossaryTerms: ["lighthouse keeper"],
    namingRules: [{ from: "Salt Harbour", to: "Salzhafen" }],
  };

  test("a term written two ways waits on the DM, with its variants and their rows", () => {
    const { open, decided } = sortTerms([PARTY as never], rows, ctx);
    expect(decided).toEqual([]);
    expect(open).toEqual([
      {
        wording: "the party",
        description: "The adventurers.",
        kind: "game-term",
        rendering: "the party",
        variants: [
          { wording: "the party", places: [rows[0]!, rows[1]!] },
          { wording: "the characters", places: [rows[1]!] },
        ],
      },
    ]);
  });

  test("a term the glossary or a naming convention decides is a fix, never asked", () => {
    const harbour = {
      wording: "Salzhafen",
      description: "",
      kind: "place",
      rendering: "Salt Harbour",
      variants: [
        { wording: "Salzhafen", places: [`npc:fenn`] },
        { wording: "salt harbour", places: [`scene:${ARRIVAL}`] },
      ],
    };
    const { open, decided } = sortTerms([KEEPER as never, harbour as never], rows, ctx);
    expect(open).toEqual([]);
    expect(decided.map((term) => [term.wording, term.rendering])).toEqual([
      ["lighthouse keeper", "Keeper"],
      // The convention's own rendering wins over the merge's.
      ["Salzhafen", "Salzhafen"],
    ]);
    // Only the variant that deviates is fixed.
    expect(fixBlock(decided)).toBe(
      "- schreibe „lighthouse keeper“ als „Keeper“ (The keeper of the lighthouse.)\n" +
        "- schreibe „salt harbour“ als „Salzhafen“",
    );
  });

  test("a term written one way only is no finding, and a decided one written right is none", () => {
    const single = { ...PARTY, variants: [PARTY.variants[0]] };
    const right = { ...KEEPER, variants: [{ wording: "Keeper", places: [`scene:${ARRIVAL}`] }] };
    expect(sortTerms([single as never, right as never], rows, ctx)).toEqual({ open: [], decided: [] });
  });
});

// --- the run through the endpoints ----------------------------------------------------

describe("a chapter check", () => {
  test("reads every row, merges once, and waits on the term the chapter writes two ways", async () => {
    const provider = new CheckProvider();
    const job = await startCheck(provider);
    expect(job.kind).toBe("chapter-check");
    expect(job.chapter).toBe(CHAPTER);
    // Both scenes, the npcs and locations they name or that belong to the chapter.
    const rows = provider.calls.filter((call) => call.kind === "terms");
    expect(rows.map((call) => call.req.checkedRow!.key).sort()).toEqual([
      "location:cove",
      "location:lighthouse",
      "npc:fenn",
      "npc:jorna",
      `scene:${ARRIVAL}`,
      `scene:${CAPTURED}`,
    ]);
    expect(buildPrompt(rows[0]!.req)).toContain(CHECKED_ROW_HEADING);
    const merge = provider.calls.filter((call) => call.kind === "merge");
    expect(merge).toHaveLength(1);
    expect(buildPrompt(merge[0]!.req)).toContain(`${CHECK_TERMS_HEADING}\n\n### scene:${ARRIVAL}`);
    // The glossary's term is not asked; the other one waits, and nothing is fixed yet.
    expect(job.pipeline!.terms!.status).toBe("open");
    expect(job.pipeline!.terms!.list.map((term) => term.wording)).toEqual(["the party"]);
    expect(job.pipeline!.terms!.list[0]!.variants![1]).toEqual({
      wording: "the characters",
      places: [{ kind: "scene", id: CAPTURED, name: "Caught by the Smugglers" }],
    });
    expect(job.pipeline!.parts).toEqual([]);
    expect(provider.calls.some((call) => call.kind === "fix")).toBe(false);
  });

  test("the confirmation fixes each affected row as a part of its own, with every decided term", async () => {
    const provider = new CheckProvider();
    const job = await startCheck(provider);
    const confirmed = await send("PATCH", jobUrl("example", job.id), {
      rev: job.rev,
      terms: { "the party": { rendering: "the party", glossary: true } },
    });
    expect(confirmed.status).toBe(202);
    const done = await until(settledParts);
    expect(done.pipeline!.parts.map((part) => [part.key, part.existing])).toEqual([
      [`scene:${ARRIVAL}`, true],
      [`scene:${CAPTURED}`, true],
    ]);
    const fixes = provider.calls.filter((call) => call.kind === "fix");
    expect(fixes).toHaveLength(2);
    for (const { req } of fixes) {
      expect(buildPrompt(req)).toContain(TERMS_HEADING);
      expect(req.terms).toContain("„the characters“ als „the party“");
      expect(req.terms).toContain("„lighthouse keeper“ als „Keeper“");
    }
    const captured = done.result!.sceneExtensions!.find((extension) => extension.id === CAPTURED)!;
    expect(captured.rev).toBe((await scene(CAPTURED)).rev);
    // The trigger, the flow paragraph and the safety-valve note — nothing else.
    expect(captured.changes.map((change) => change.op)).toEqual(["set", "replace", "replace"]);
    // The kept term stands in the glossary.
    const glossary = (await (await app.request("/api/campaigns/example/glossary-terms")).json()) as GlossaryTerm[];
    expect(glossary.find((term) => term.term === "the party")?.explanation).toBe(
      "the party — The adventurers.",
    );
  });

  test("accepting a fix writes only that row; a row changed since the check is 409", async () => {
    const provider = new CheckProvider();
    const job = await startCheck(provider);
    await send("PATCH", jobUrl("example", job.id), {
      rev: job.rev,
      terms: { "the party": { rendering: "the party", glossary: false } },
    });
    const done = await until(settledParts);
    const arrivalBefore = await scene(ARRIVAL);

    const accepted = await send("PATCH", jobUrl("example", done.id), acceptBody(done, { scenes: [CAPTURED] }));
    expect(accepted.status).toBe(200);
    const captured = await scene(CAPTURED);
    expect(captured.trigger).toBe("The party are spotted while scouting the cove");
    expect(captured.body).toContain("Disarmed and bound, the party are brought before Fenn");
    expect(captured.body).toContain("the captured Keeper in the");
    expect(captured.body).not.toContain("lighthouse keeper");
    expect(await scene(ARRIVAL)).toEqual(arrivalBefore);

    // The other scene changes before its fix is accepted.
    const edited = await send("PATCH", `/api/campaigns/example/scenes/${ARRIVAL}`, {
      rev: arrivalBefore.rev,
      title: "Arrival at Night",
    });
    expect(edited.status).toBe(200);
    const after = (await readJob("example"))!;
    const stale = await send("PATCH", jobUrl("example", after.id), acceptBody(after, { scenes: [ARRIVAL] }));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe("fix_row_changed");
    expect((await scene(ARRIVAL)).body).toBe(arrivalBefore.body);

    // Rejecting the fix is the way out, and it settles the job.
    const rejected = await send("PATCH", jobUrl("example", after.id), {
      rev: after.rev,
      review: { droppedScenes: [ARRIVAL] },
    });
    expect(rejected.status).toBe(200);
  });

  test("with only glossary deviations there is no stage: the fixes run right away", async () => {
    const provider = new CheckProvider([KEEPER]);
    setProviderForTests(provider);
    await send("POST", jobsUrl("example"), { kind: "chapter-check", chapter: CHAPTER });
    const done = await until((job) => settledParts(job) && job.pipeline!.parts.length > 0);
    expect(done.pipeline!.terms).toBeUndefined();
    expect(done.pipeline!.parts.map((part) => part.key)).toEqual([`scene:${ARRIVAL}`, `scene:${CAPTURED}`]);
  });

  test("a chapter written the same way throughout ends done with nothing to review", async () => {
    const provider = new CheckProvider([]);
    const before = await scene(ARRIVAL);
    const job = await startCheck(provider);
    expect(job.pipeline!.parts).toEqual([]);
    expect(job.pipeline!.terms).toBeUndefined();
    expect(job.error).toBeUndefined();
    expect(provider.calls.some((call) => call.kind === "fix")).toBe(false);
    expect(await scene(ARRIVAL)).toEqual(before);
  });

  test("a merge naming a row the check did not read is a correction turn", async () => {
    class StrayMerge extends CheckProvider {
      override async complete(req: GenerateRequest, corrections: CorrectionTurn[] = []) {
        if (req.checkTerms !== undefined && corrections.length === 0) {
          const stray = { ...KEEPER, variants: [{ wording: "x", places: ["scene:nowhere"] }] };
          return { text: JSON.stringify({ terms: [stray] }), truncated: false };
        }
        return super.complete(req, corrections);
      }
    }
    const provider = new StrayMerge([KEEPER]);
    setProviderForTests(provider);
    await send("POST", jobsUrl("example"), { kind: "chapter-check", chapter: CHAPTER });
    const done = await until((job) => settledParts(job) && job.pipeline!.parts.length > 0);
    expect(done.pipeline!.parts.map((part) => part.key)).toEqual([`scene:${ARRIVAL}`, `scene:${CAPTURED}`]);
  });

  test("a failed fix part is retried on its own", async () => {
    let failing = true;
    class FailingFix extends CheckProvider {
      override async complete(req: GenerateRequest, corrections: CorrectionTurn[] = []) {
        if (failing && req.terms !== undefined && req.checkedRow?.key === `scene:${ARRIVAL}`) {
          return { text: "not json", truncated: false };
        }
        return super.complete(req, corrections);
      }
    }
    const provider = new FailingFix([KEEPER]);
    setProviderForTests(provider);
    await send("POST", jobsUrl("example"), { kind: "chapter-check", chapter: CHAPTER });
    const failed = await until(
      (job) =>
        job.status === "done" &&
        job.pipeline!.parts.find((part) => part.key === `scene:${ARRIVAL}`)?.status === "failed",
    );
    failing = false;
    const retried = await send("PATCH", partUrl("example", failed.id, `scene:${ARRIVAL}`), { status: "running" });
    expect(retried.status).toBe(202);
    const done = await until(settledParts);
    expect(done.result!.sceneExtensions!.map((extension) => extension.id).sort()).toEqual([ARRIVAL, CAPTURED]);
  });

  test("an unknown chapter is a 404 before any job exists", async () => {
    setProviderForTests(new CheckProvider());
    const res = await send("POST", jobsUrl("example"), { kind: "chapter-check", chapter: "nope" });
    expect(res.status).toBe(404);
    expect(await readJob("example")).toBeNull();
  });
});
