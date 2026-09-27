// A scene run that also extends npcs and locations the campaign already has
// (decisions/generator).
//
// The harness is the generator suite's: a database seeded from the example
// campaign and a scripted provider instead of an LLM, so the run really goes
// through the pipeline and its review state sits on a real job row. The
// provider answers each call of the run by what the call is: the outline by
// its schema, a scene by its assignment, an extension by the stored row it
// carries.
//
// What is asserted is the promise: the extension is a list of changes to the
// stored row, never the entity again; each change is taken or kept on its
// own; accepting writes the taken ones into the row as it is stored at that
// moment, and a change whose block is gone by then changes nothing and
// stands as a finding. A run started without the option asks for no
// extension and gets none.

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { GeneratorJob, Npc } from "@grimoire/shared";
import { OUTLINE_SCHEMA_NAME } from "@grimoire/shared/outline-schema";
import { validateOutlineReply } from "../src/generate-pipeline";
import { collectSceneContext, setProviderForTests } from "../src/generator";
import { clearJobsForTests } from "../src/generator-jobs";
import type {
  CompletionResult,
  GenerateRequest,
  LLMProvider,
} from "../src/llm-provider";
import { app } from "../src/server";
import { jobsUrl, jobUrl, partUrl, readJob } from "./support/generator-jobs";
import { entryReply } from "./support/pipeline-fake";
import { dropStore, seedStore } from "./support/store";

const CHAPTER = "01-salt-harbour";
const SCENE = "meeting-at-the-quay";
const FENN_KEY = "npc:fenn";

/** The block of Fenn's stored body the extension inserts after. */
const FENN_SECRET =
  "> [!secret] Knows the name of whoever hired him, but only gives it\n> once his way out is secured.";

const ADDED_BLOCK = "> [!note] Owes the harbour master a favour since the storm.";

/** What the extension of Fenn replies: a set, an insert, one missing anchor and a note. */
const FENN_OPERATIONS = [
  { op: "set", field: "role", value: "Leader of the smugglers, in debt to the harbour master" },
  { op: "insertAfter", anchor: FENN_SECRET, text: ADDED_BLOCK },
  { op: "remove", anchor: "A block Fenn's text does not hold." },
  { op: "note", text: "The source does not say how large the debt is." },
];

/**
 * The provider of these cases: one outline naming one scene and, when the
 * run may extend, Fenn; the scene; and Fenn's operations.
 */
class ExtendFake implements LLMProvider {
  readonly name = "fake";
  readonly calls: GenerateRequest[] = [];

  constructor(private readonly outline: Record<string, unknown>) {}

  async complete(req: GenerateRequest): Promise<CompletionResult> {
    this.calls.push(req);
    if (req.jsonSchema?.name === OUTLINE_SCHEMA_NAME) {
      return { text: JSON.stringify(this.outline), truncated: false };
    }
    if (req.existingNpc !== undefined) {
      return { text: JSON.stringify({ operations: FENN_OPERATIONS }), truncated: false };
    }
    if (req.existingLocation !== undefined) {
      return { text: JSON.stringify({ operations: [] }), truncated: false };
    }
    return {
      text: entryReply(
        {
          properties: { id: SCENE, title: "Meeting at the Quay", npcs: ["fenn"], location: "lighthouse" },
          body: "## Flow\n\nFenn waits at the quay.\n",
        },
        [],
        "scene",
        CHAPTER,
      ),
      truncated: false,
    };
  }
}

/** An outline of one scene; `extend` names Fenn and the cove as existing. */
function outline(extend: boolean): Record<string, unknown> {
  return {
    scenes: [
      {
        id: SCENE,
        title: "Meeting at the Quay",
        type: "planned",
        location: "lighthouse",
        sourceExcerpt: null,
        refs: [],
      },
    ],
    npcs: [],
    locations: [],
    ...(extend
      ? {
          existingNpcs: [{ id: "fenn", summary: "He owes the harbour master." }],
          existingLocations: [{ id: "cove", summary: "Nothing new after all." }],
        }
      : {}),
    chapterDescription: null,
    warnings: [],
  };
}

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** Start a scene run and wait until its job is finished. */
async function runJob(extend: boolean): Promise<GeneratorJob> {
  const res = await send("POST", jobsUrl("example"), {
    kind: "scene",
    chapter: CHAPTER,
    sourceText: "Fenn waits at the docks. He owes the harbour master a favour.",
    ...(extend ? { extend: true } : {}),
  });
  expect(res.status).toBe(202);
  for (let i = 0; i < 2000; i++) {
    const job = await readJob("example");
    if (job === null) throw new Error("job disappeared");
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("job never finished");
}

async function patchJob(job: GeneratorJob, body: Record<string, unknown>): Promise<Response> {
  return send("PATCH", jobUrl("example", job.id), { rev: job.rev, ...body });
}

async function readFenn(): Promise<Npc> {
  const res = await app.request("/api/campaigns/example/npcs/fenn");
  expect(res.status).toBe(200);
  return (await res.json()) as Npc;
}

let provider: ExtendFake;

function useProvider(extend: boolean): void {
  provider = new ExtendFake(outline(extend));
  setProviderForTests(provider);
}

beforeEach(async () => {
  await seedStore();
});

afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
  dropStore();
});

test("an extension is the changes to the stored row, with its notes and findings on its part", async () => {
  useProvider(true);
  const job = await runJob(true);
  expect(job.status).toBe("done");

  const part = job.pipeline!.parts.find((candidate) => candidate.key === FENN_KEY)!;
  expect(part).toMatchObject({ kind: "npc", id: "fenn", existing: true, title: "Fenn", status: "done" });
  expect(part.warnings).toEqual(["The source does not say how large the debt is."]);
  expect(part.findings).toEqual([
    { kind: "anchor_missing", anchor: "A block Fenn's text does not hold." },
  ]);
  const extension = job.result!.npcExtensions!.find((candidate) => candidate.id === "fenn")!;
  expect(extension.changes.map((change) => change.op)).toEqual(["set", "insertAfter"]);
  // No new npc is proposed for it: the row exists.
  expect(job.result!.npcs).toEqual([]);

  // The extension call saw the row as stored, and the passages that mention it.
  const call = provider.calls.find((candidate) => candidate.existingNpc !== undefined)!;
  expect(call.existingNpc?.id).toBe("fenn");
  expect(call.existingNpc?.role).toBe("Leader of the smugglers in the North Cove");
  expect(call.sourceText).toContain("harbour master");

  // A location the source adds nothing to has no change and nothing to decide.
  expect(job.result!.locationExtensions).toMatchObject([{ id: "cove", changes: [] }]);
  // The row as the run read it travels with it, for the comparison.
  expect(extension.current.role).toBe("Leader of the smugglers in the North Cove");
});

test("an extension does not hold the scene back — the scene names a row that exists", async () => {
  useProvider(true);
  const job = await runJob(true);
  const res = await patchJob(job, { review: { writtenScenes: [SCENE] } });
  expect(res.status).toBe(200);
  const after = (await res.json()) as GeneratorJob;
  expect(after.review.writtenScenes).toEqual([SCENE]);
  // The extension is still open: the job stays.
  expect(await readJob("example")).not.toBeNull();
});

test("accepting writes only the taken changes into the row, in one write", async () => {
  useProvider(true);
  let job = await runJob(true);
  const before = await readFenn();
  const setChange = job.result!.npcExtensions![0]!.changes.find((change) => change.op === "set")!;

  const kept = await patchJob(job, { review: { keptChanges: { [FENN_KEY]: [setChange.id] } } });
  expect(kept.status).toBe(200);
  job = (await kept.json()) as GeneratorJob;
  expect(job.review.keptChanges).toEqual({ [FENN_KEY]: [setChange.id] });

  const res = await patchJob(job, { review: { writtenNpcs: ["fenn"] } });
  expect(res.status).toBe(200);
  const accepted = (await res.json()) as GeneratorJob;
  expect(accepted.review.writtenNpcs).toEqual(["fenn"]);

  const fenn = await readFenn();
  expect(fenn.rev).toBe(before.rev + 1);
  expect(fenn.role).toBe(before.role);
  expect(fenn.body).toContain(`${FENN_SECRET}\n\n${ADDED_BLOCK}`);
});

test("a change whose block is gone by the accept changes nothing and stands as a finding", async () => {
  useProvider(true);
  const job = await runJob(true);
  const fenn = await readFenn();
  // Somebody rewrites the secret after the run read the row.
  const edited = await send("PATCH", "/api/campaigns/example/npcs/fenn", {
    rev: fenn.rev,
    body: "## Knows\n\n> [!secret] Knows who hired him.\n",
  });
  expect(edited.status).toBe(200);

  const res = await patchJob(job, { review: { writtenNpcs: ["fenn"] } });
  expect(res.status).toBe(200);
  const accepted = (await res.json()) as GeneratorJob;
  const part = accepted.pipeline!.parts.find((candidate) => candidate.key === FENN_KEY)!;
  expect(part.findings).toEqual([{ kind: "anchor_missing", anchor: FENN_SECRET }]);

  const after = await readFenn();
  // The set still applies; the text stays as the other write left it.
  expect(after.role).toBe("Leader of the smugglers, in debt to the harbour master");
  expect(after.body).toBe("## Knows\n\n> [!secret] Knows who hired him.\n");
  // The finding stays on the job, where the review reads it.
  const stored = await readJob("example");
  expect(stored!.pipeline!.parts.find((candidate) => candidate.key === FENN_KEY)!.findings).toEqual(
    part.findings,
  );
});

test("an extension with every change kept is rejected, not accepted", async () => {
  useProvider(true);
  let job = await runJob(true);
  const ids = job.result!.npcExtensions![0]!.changes.map((change) => change.id);
  job = (await (await patchJob(job, { review: { keptChanges: { [FENN_KEY]: ids } } })).json()) as GeneratorJob;
  const refused = await patchJob(job, { review: { writtenNpcs: ["fenn"] } });
  expect(refused.status).toBe(400);
  expect(((await refused.json()) as { code: string }).code).toBe("nothing_to_write");

  const before = await readFenn();
  const rejected = await patchJob(job, {
    review: { npcs: { fenn: "rejected" }, writtenScenes: [SCENE] },
  });
  expect(rejected.status).toBe(200);
  // Nothing was left open, so the job is over — and Fenn is untouched.
  expect(await readJob("example")).toBeNull();
  expect((await readFenn()).rev).toBe(before.rev);
});

test("the review refuses keys and changes the run does not have, and extension notes are not answered", async () => {
  useProvider(true);
  const job = await runJob(true);
  expect((await patchJob(job, { review: { keptChanges: { "npc:jorna": [] } } })).status).toBe(400);
  expect((await patchJob(job, { review: { keptChanges: { [FENN_KEY]: ["c99"] } } })).status).toBe(400);
  expect((await patchJob(job, { npcEdits: { fenn: { role: "x" } } })).status).toBe(400);

  const answer = await send("PATCH", partUrl("example", job.id, FENN_KEY), {
    rev: job.rev,
    round: { answers: [{ note: "The source does not say how large the debt is.", answer: "Small." }] },
  });
  expect(answer.status).toBe(409);
});

test("a run without the option asks for no extension and gets none", async () => {
  // The model names Fenn anyway: the run does not read the list.
  provider = new ExtendFake(outline(true));
  setProviderForTests(provider);
  const job = await runJob(false);
  expect(job.status).toBe("done");
  expect(job.pipeline!.parts.map((part) => part.key)).toEqual([`scene:${SCENE}`]);
  expect(job.result!.npcExtensions).toBeUndefined();
  expect(provider.calls.some((call) => call.existingNpc !== undefined)).toBe(false);

  const outlineCall = provider.calls.find((call) => call.jsonSchema?.name === OUTLINE_SCHEMA_NAME)!;
  const properties = (outlineCall.jsonSchema!.schema as { properties: Record<string, unknown> })
    .properties;
  expect(Object.keys(properties)).not.toContain("existingNpcs");
  expect(outlineCall.systemPrompt).not.toContain("existingNpcs");
});

test("the outline names only existing rows, each once, within the run's bound", async () => {
  const ctx = await collectSceneContext("example", CHAPTER);
  const reply = (extra: Record<string, unknown>) =>
    JSON.stringify({ ...outline(false), ...extra });

  const unknown = validateOutlineReply(
    reply({ existingNpcs: [{ id: "nobody", summary: "x" }], existingLocations: [] }),
    ctx,
    true,
  );
  expect(unknown.ok).toBe(false);

  const twice = validateOutlineReply(
    reply({
      npcs: [{ id: "fenn", name: "Fenn", summary: "x" }],
      existingNpcs: [{ id: "fenn", summary: "x" }],
      existingLocations: [],
    }),
    ctx,
    true,
  );
  expect(twice.ok).toBe(false);

  const many = Array.from({ length: 12 }, (_, i) => ({ id: `new-${i}`, name: `New ${i}`, summary: "x" }));
  const bound = validateOutlineReply(
    reply({ npcs: many, existingNpcs: [{ id: "fenn", summary: "x" }], existingLocations: [] }),
    ctx,
    true,
  );
  expect(bound.ok).toBe(false);

  const fine = validateOutlineReply(
    reply({ existingNpcs: [{ id: "fenn", summary: "x" }], existingLocations: [] }),
    ctx,
    true,
  );
  expect(fine.ok && fine.result.existingNpcs).toEqual([
    { id: "fenn", name: "Fenn", summary: "x" },
  ]);
});
