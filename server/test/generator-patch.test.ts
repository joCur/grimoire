// The patch round on a finished part of a scene run: the DM answers the
// model's notes, one call returns operations, and the server applies them to
// the proposal deterministically.
//
// The pure half — turning a reply's operations into changes, notes and
// findings — is
// called directly over a whole reference scene. The round itself goes
// through the real endpoints against the real job row: its start, its
// outcome on the part, the DM's decisions and what they write into the job's
// edits, and what the accept then writes.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { GeneratorJob, KnowledgeItem, PartAnswerRequest, SceneProposal } from "@grimoire/shared";
import { applyBodyOperation } from "@grimoire/shared/body-patch";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generator-jobs";
import { failInterruptedJobs, RESTART_FAILURE_MESSAGE } from "../src/db/job-boot";
import { setProviderForTests } from "../src/generator";
import { applyPatchOperations, readPatchReply, type PatchScope } from "../src/generator-patch";
import { ANSWERS_HEADING, PROPOSAL_HEADING, buildPrompt } from "../src/llm-provider";
import type { CompletionResult, CorrectionTurn, GenerateRequest, LLMProvider } from "../src/llm-provider";
import { getDb } from "../src/store/handle";
import { acceptBody, jobsUrl, jobUrl, partUrl, readJob } from "./support/generator-jobs";
import { dropStore, seedStore } from "./support/store";

const arrival = JSON.parse(
  readFileSync(new URL("../../fixtures/scenes/lighthouse-arrival.json", import.meta.url), "utf8"),
) as SceneProposal;

const CHECK =
  "> [!check] Wisdom (Perception) DC 13: fresh boot prints in the sand\n> that do NOT come from the village but from the cove to the north.";

const SCOPE: PatchScope = {
  chapter: arrival.chapter,
  npcIds: new Set(["fenn", "jorna"]),
  locationIds: new Set(["lighthouse", "cove"]),
  refIds: new Set(["fenn", "jorna", "lighthouse", "cove", "smuggler-captured"]),
};

/** A reply of a patch call, read as the server reads it. */
function read(operations: unknown[], kind: "scene" | "npc" | "location" = "scene") {
  const reply = readPatchReply(JSON.stringify({ operations }), kind);
  if (!reply.ok) throw new Error(reply.errors.join("; "));
  return reply.result.operations;
}

describe("applying a patch reply", () => {
  test("over a whole scene only the applied operations change it", () => {
    const { changes, notes, findings } = applyPatchOperations(
      "scene",
      arrival,
      read([
        { op: "replace", anchor: CHECK, text: "> [!check] Wisdom (Perception) DC 15: boot prints." },
        { op: "set", field: "title", value: "  Night at the lighthouse " },
        { op: "note", text: "The keeper's name stays open." },
      ]),
      SCOPE,
    );
    expect(notes).toEqual(["The keeper's name stays open."]);
    expect(findings).toEqual([]);
    expect(changes).toEqual([
      {
        id: "c1",
        op: "replace",
        anchor: CHECK,
        text: "> [!check] Wisdom (Perception) DC 15: boot prints.",
        block: CHECK,
      },
      { id: "c2", op: "set", field: "title", value: "Night at the lighthouse" },
    ]);
    // Taken, the block change touches that block and nothing else.
    const [block] = changes;
    if (block === undefined || block.op !== "replace") throw new Error("expected a replace");
    const applied = applyBodyOperation(arrival.body, block);
    expect(applied).toEqual({
      ok: true,
      body: arrival.body.replace(CHECK, "> [!check] Wisdom (Perception) DC 15: boot prints."),
    });
  });

  test("an anchor that hits nothing or several blocks is a finding carrying it", () => {
    const body = "## Flow\n\nSame.\n\nSame.\n";
    const { changes, notes, findings } = applyPatchOperations(
      "scene",
      { ...arrival, body },
      read([
        { op: "remove", anchor: "The keeper waves\n  from the top." },
        { op: "replace", anchor: "Same.", text: "Other." },
      ]),
      SCOPE,
    );
    expect(changes).toEqual([]);
    expect(notes).toEqual([]);
    expect(findings).toEqual([
      { kind: "anchor_missing", anchor: "The keeper waves\n  from the top." },
      { kind: "anchor_ambiguous", anchor: "Same." },
    ]);
  });

  test("an invalid value is a finding, and an unchanged one is no change", () => {
    const { changes, findings } = applyPatchOperations(
      "scene",
      arrival,
      read([
        { op: "set", field: "location", value: "atlantis" },
        { op: "set", field: "chapter", value: "02-elsewhere" },
        { op: "set", field: "title", value: " " },
        { op: "set", field: "npcs", value: arrival.npcs },
        { op: "insertAfter", anchor: CHECK, text: "> [!warning] Unknown." },
        { op: "insertAfter", anchor: CHECK, text: "[[nobody]] waits here." },
        { op: "replace", anchor: CHECK, text: "  " },
      ]),
      SCOPE,
    );
    expect(changes).toEqual([]);
    expect(findings).toEqual([
      { kind: "ids_unknown", field: "location", ids: ["atlantis"] },
      { kind: "chapter_outside", chapter: SCOPE.chapter },
      { kind: "field_empty", field: "title" },
      { kind: "callouts_unknown", anchor: CHECK, callouts: ["warning"] },
      { kind: "refs_unknown", anchor: CHECK, ids: ["nobody"] },
      { kind: "text_empty", anchor: CHECK },
    ]);
  });

  test("an operation that does not read is a finding, an envelope that does not is a correction", () => {
    const { findings } = applyPatchOperations(
      "scene",
      arrival,
      read([{ op: "set", field: "id", value: "other" }]),
      SCOPE,
    );
    expect(findings).toEqual([{ kind: "unreadable" }]);
    expect(readPatchReply("{\"changes\": []}", "scene").ok).toBe(false);
  });

  test("a blank optional field clears it", () => {
    const { changes } = applyPatchOperations(
      "location",
      { id: "harbour-office", name: "Harbour office", atmosphere: "Dusty.", body: "Text.\n" },
      read([{ op: "set", field: "atmosphere", value: "" }], "location"),
      SCOPE,
    );
    expect(changes).toEqual([{ id: "c1", op: "set", field: "atmosphere", value: null }]);
  });
});

test("the patch call's prompt carries the proposal and the answers", () => {
  const prompt = buildPrompt({
    systemPrompt: "",
    fewShotTarget: "{}",
    knowledge: "",
    glossary: "",
    context: { npcs: [], locations: [] },
    sourceText: "",
    proposal: { id: "harbour-office", name: "Harbour office", chapter: null, roll20Page: null, atmosphere: null, body: "Text.\n" },
    answers: [{ note: "Who runs the office?", answer: "Jorna." }],
  });
  expect(prompt).toContain(`${PROPOSAL_HEADING} (harbour-office)`);
  expect(prompt).toContain(ANSWERS_HEADING);
  expect(prompt).toContain("Who runs the office?");
  expect(prompt).toContain("Jorna.");
});

// --- the round through the endpoints ---------------------------------------------

const SCENE_BODY = "## Flow\n\nFenn waits on the quay.\n\n> [!check] Insight DC 12.\n";
const SCENE_NOTE = "The DC of the check is a guess.";
const LOCATION_NOTE = "The source does not say what the office smells of.";

/**
 * A run of one scene and one new location, each with a note; a patch call
 * answers with what `patches` holds for the proposal it is about.
 */
class RoundProvider implements LLMProvider {
  readonly name = "fake";
  readonly patchCalls: GenerateRequest[] = [];
  /** Held patch calls, released by the test. */
  private held: Array<() => void> = [];
  hold = false;

  constructor(private patches: Record<string, unknown[] | string>) {}

  release(): void {
    for (const go of this.held.splice(0)) go();
  }

  async complete(req: GenerateRequest, _corrections: CorrectionTurn[] = []): Promise<CompletionResult> {
    if (req.answers !== undefined) {
      this.patchCalls.push(req);
      if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve));
      const patch = this.patches[req.proposal?.id ?? ""] ?? [];
      return {
        text: typeof patch === "string" ? patch : JSON.stringify({ operations: patch }),
        truncated: false,
        usage: { inputTokens: 100, outputTokens: 10 },
      };
    }
    if (req.outline === undefined) {
      return {
        text: JSON.stringify({
          scenes: [
            {
              id: "quay",
              title: "The quay",
              type: "planned",
              location: "harbour-office",
              sourceExcerpt: { first: "Fenn waits at the docks.", last: "Fenn waits at the docks." },
              refs: [],
            },
          ],
          npcs: [],
          locations: [{ id: "harbour-office", name: "Harbour office", summary: "Where Jorna works." }],
          warnings: [],
        }),
        truncated: false,
      };
    }
    if (req.context.targetId === "harbour-office") {
      return {
        text: JSON.stringify({
          id: "harbour-office",
          name: "Harbour office",
          chapter: null,
          roll20Page: null,
          atmosphere: null,
          body: "A narrow room above the quay.\n",
          warnings: [LOCATION_NOTE],
        }),
        truncated: false,
      };
    }
    return {
      text: JSON.stringify({
        id: "quay",
        title: "The quay",
        type: "planned",
        trigger: null,
        chapter: "01-salt-harbour",
        location: "harbour-office",
        npcs: ["fenn"],
        handouts: [],
        tags: [],
        status: "draft",
        body: SCENE_BODY,
        warnings: [SCENE_NOTE, "Fenn's boat has no name."],
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

async function until(ready: (job: GeneratorJob) => boolean): Promise<GeneratorJob> {
  for (let i = 0; i < 4000; i += 1) {
    const job = await readJob("example");
    if (job !== null && ready(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("the job never reached the expected state");
}

async function runJob(provider: RoundProvider): Promise<GeneratorJob> {
  setProviderForTests(provider);
  const started = await send("POST", jobsUrl("example"), {
    kind: "scene",
    chapter: "01-salt-harbour",
    sourceText: "Fenn waits at the docks.",
  });
  expect(started.status).toBe(202);
  return until((job) => job.status === "done");
}

const part = (job: GeneratorJob, key: string) => job.pipeline!.parts.find((p) => p.key === key)!;

function answer(job: GeneratorJob, key: string, answers: PartAnswerRequest[]) {
  return send("PATCH", partUrl("example", job.id, key), { rev: job.rev, round: { answers } });
}

function decide(job: GeneratorJob, key: string, changes: Record<string, "taken" | "kept">) {
  return send("PATCH", partUrl("example", job.id, key), { rev: job.rev, round: { changes } });
}

const roundBack = (key: string) => (job: GeneratorJob) =>
  job.status === "done" && part(job, key).round?.status !== "running";

beforeEach(async () => {
  await seedStore();
});

afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
  dropStore();
});

describe("a patch round", () => {
  test("answers become changes the DM takes into the scene's edits", async () => {
    const provider = new RoundProvider({
      quay: [
        { op: "replace", anchor: "> [!check] Insight DC 12.", text: "> [!check] Insight DC 14." },
        { op: "set", field: "title", value: "Night on the quay" },
        { op: "remove", anchor: "> [!secret] Not there." },
      ],
    });
    const job = await runJob(provider);
    const totals = job.pipeline!.totals;

    const started = await answer(job, "scene:quay", [{ note: SCENE_NOTE, answer: "Make it 14." }]);
    expect(started.status).toBe(202);
    const running = (await started.json()) as GeneratorJob;
    expect(running.status).toBe("running");
    expect(running.rev).toBe(job.rev + 1);
    expect(part(running, "scene:quay").round).toEqual({
      status: "running",
      answers: [{ note: SCENE_NOTE, answer: "Make it 14." }],
      changes: [],
    });

    const back = await until(roundBack("scene:quay"));
    const quay = part(back, "scene:quay");
    // Two changes; the anchor that hit nothing is a finding carrying it, the
    // answered note is done and the unanswered one stays.
    expect(quay.round!.changes.map((change) => [change.id, change.op])).toEqual([
      ["c1", "replace"],
      ["c2", "set"],
    ]);
    expect(quay.warnings).toEqual(["Fenn's boat has no name."]);
    expect(quay.findings).toEqual([{ kind: "anchor_missing", anchor: "> [!secret] Not there." }]);
    // The call joined the run's counter, and the prompt carried what it should.
    expect(back.pipeline!.totals.calls).toBe(totals.calls + 1);
    expect(back.pipeline!.totals.inputTokens).toBe(totals.inputTokens + 100);
    expect(provider.patchCalls[0]!.proposal).toMatchObject({ id: "quay", body: SCENE_BODY });

    const decided = await decide(back, "scene:quay", { c1: "taken", c2: "taken" });
    expect(decided.status).toBe(200);
    const after = (await decided.json()) as GeneratorJob;
    expect(after.rev).toBe(back.rev + 1);
    expect(part(after, "scene:quay").round).toBeUndefined();
    expect(after.sceneEdits.quay).toEqual({
      body: SCENE_BODY.replace("DC 12", "DC 14"),
      title: "Night on the quay",
    });
    expect((await readJob("example"))!.sceneEdits.quay).toEqual(after.sceneEdits.quay);
  });

  test("a location is answered too, and the accept writes its edits", async () => {
    const provider = new RoundProvider({
      "harbour-office": [
        { op: "set", field: "atmosphere", value: "Tar and wet paper." },
        { op: "insertAfter", anchor: "A narrow room above the quay.", text: "Jorna keeps the ledgers here." },
      ],
    });
    const job = await runJob(provider);
    expect((await answer(job, "location:harbour-office", [
      { note: LOCATION_NOTE, answer: "Tar and wet paper." },
    ])).status).toBe(202);
    const back = await until(roundBack("location:harbour-office"));
    expect(part(back, "location:harbour-office").warnings).toEqual([]);

    const decided = (await (
      await decide(back, "location:harbour-office", { c1: "taken", c2: "kept" })
    ).json()) as GeneratorJob;
    expect(decided.locationEdits["harbour-office"]).toEqual({ atmosphere: "Tar and wet paper." });

    const accepted = await send(
      "PATCH",
      jobUrl("example", decided.id),
      acceptBody(decided, { locations: ["harbour-office"] }),
    );
    expect(accepted.status).toBe(200);
    const location = (await (
      await app.request("/api/campaigns/example/locations/harbour-office")
    ).json()) as { atmosphere?: string; body: string };
    expect(location.atmosphere).toBe("Tar and wet paper.");
    expect(location.body).toBe("A narrow room above the quay.\n");
  });

  test("an answer kept as campaign knowledge is a fact in this round's prompt and every later one", async () => {
    const provider = new RoundProvider({ quay: [], "harbour-office": [] });
    const job = await runJob(provider);
    const itemsUrl = "/api/campaigns/example/knowledge-items";
    const before = (await (await app.request(itemsUrl)).json()) as KnowledgeItem[];

    // A refused round creates no item.
    const stale = await send("PATCH", partUrl("example", job.id, "scene:quay"), {
      rev: job.rev + 5,
      round: { answers: [{ note: SCENE_NOTE, answer: "Make it 14.", asKnowledge: true }] },
    });
    expect(stale.status).toBe(409);
    expect(((await (await app.request(itemsUrl)).json()) as KnowledgeItem[]).length).toBe(before.length);

    const started = await answer(job, "scene:quay", [
      { note: SCENE_NOTE, answer: "The harbour watch\nnever checks the quay at night.", asKnowledge: true },
      { note: "Fenn's boat has no name.", answer: "The Gull." },
    ]);
    expect(started.status).toBe(202);
    // The round keeps the answers as sent, without the flag.
    expect(part((await started.json()) as GeneratorJob, "scene:quay").round!.answers).toEqual([
      { note: SCENE_NOTE, answer: "The harbour watch\nnever checks the quay at night." },
      { note: "Fenn's boat has no name.", answer: "The Gull." },
    ]);

    // Exactly one item, as the knowledge-item POST creates it: a fact on one
    // line at the end of the order; the unticked answer created nothing.
    const after = (await (await app.request(itemsUrl)).json()) as KnowledgeItem[];
    expect(after.length).toBe(before.length + 1);
    const kept = after.at(-1)!;
    expect(kept).toMatchObject({
      kind: "fact",
      from: "",
      to: "",
      text: "The harbour watch never checks the quay at night.",
    });
    const order = (await (
      await app.request("/api/campaigns/example/knowledge-item-order")
    ).json()) as { items: string[] };
    expect(order.items.at(-1)).toBe(kept.id);

    // This round's call already had it in its knowledge block, the answer
    // without the flag did not become knowledge.
    await until(roundBack("scene:quay"));
    const fact = "- Fakt: The harbour watch never checks the quay at night.";
    expect(provider.patchCalls[0]!.knowledge).toContain(fact);
    expect(provider.patchCalls[0]!.knowledge).not.toContain("The Gull.");

    // And so does every later call.
    const back = (await readJob("example"))!;
    await answer(back, "location:harbour-office", [{ note: LOCATION_NOTE, answer: "Tar." }]);
    await until(roundBack("location:harbour-office"));
    expect(provider.patchCalls[1]!.knowledge).toContain(fact);
  });

  test("a stale guard, an unknown note and a blank answer write nothing", async () => {
    const job = await runJob(new RoundProvider({}));
    const stale = await send("PATCH", partUrl("example", job.id, "scene:quay"), {
      rev: job.rev + 5,
      round: { answers: [{ note: SCENE_NOTE, answer: "Yes." }] },
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe("rev_conflict");
    const unknown = await answer(job, "scene:quay", [{ note: "Never noted.", answer: "Yes." }]);
    expect(unknown.status).toBe(409);
    expect((await answer(job, "scene:quay", [{ note: SCENE_NOTE, answer: "  " }])).status).toBe(400);
    expect((await answer(job, "scene:gone", [{ note: SCENE_NOTE, answer: "Yes." }])).status).toBe(404);
    expect((await readJob("example"))!.rev).toBe(job.rev);
  });

  test("a round that brings nothing fails on its part, and the notes stay", async () => {
    const job = await runJob(new RoundProvider({ quay: "not json at all" }));
    await answer(job, "scene:quay", [{ note: SCENE_NOTE, answer: "Make it 14." }]);
    const back = await until(roundBack("scene:quay"));
    const quay = part(back, "scene:quay");
    expect(quay.round?.status).toBe("failed");
    expect(quay.round?.error).toBeDefined();
    expect(quay.warnings).toContain(SCENE_NOTE);
    // A failed round is answered again.
    expect((await answer(back, "scene:quay", [{ note: SCENE_NOTE, answer: "14." }])).status).toBe(202);
  });

  test("a taken block change whose block is gone is 409 with the job", async () => {
    const provider = new RoundProvider({
      quay: [{ op: "replace", anchor: "> [!check] Insight DC 12.", text: "> [!check] Insight DC 14." }],
    });
    const job = await runJob(provider);
    await answer(job, "scene:quay", [{ note: SCENE_NOTE, answer: "14." }]);
    const back = await until(roundBack("scene:quay"));
    const edited = (await (
      await send("PATCH", jobUrl("example", back.id), {
        rev: back.rev,
        sceneEdits: { quay: { body: "## Flow\n\nRewritten.\n" } },
      })
    ).json()) as GeneratorJob;
    const refused = await decide(edited, "scene:quay", { c1: "taken" });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { code: string; generatorJob: GeneratorJob };
    expect(body.code).toBe("patch_anchor_missing");
    expect(body.generatorJob.sceneEdits.quay).toEqual({ body: "## Flow\n\nRewritten.\n" });
    // Kept, the change simply goes.
    const kept = (await (await decide(edited, "scene:quay", { c1: "kept" })).json()) as GeneratorJob;
    expect(part(kept, "scene:quay").round).toBeUndefined();
  });

  test("a round in flight fails on a restart; the part and its notes stay", async () => {
    const provider = new RoundProvider({ quay: [] });
    const job = await runJob(provider);
    provider.hold = true;
    await answer(job, "scene:quay", [{ note: SCENE_NOTE, answer: "14." }]);
    await until(() => provider.patchCalls.length === 1);
    expect(failInterruptedJobs(await getDb())).toBe(1);
    const after = (await readJob("example"))!;
    expect(after.status).toBe("done");
    const quay = part(after, "scene:quay");
    expect(quay.status).toBe("done");
    expect(quay.round).toMatchObject({ status: "failed", error: RESTART_FAILURE_MESSAGE });
    expect(quay.warnings).toContain(SCENE_NOTE);
    provider.release();
  });
});
