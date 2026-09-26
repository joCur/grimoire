// Augmenting a scene on its own resource (decisions/resources): `POST …/scenes/:id/augment`
// starts the run, the job carries the scene as read and as proposed, and
// `POST …/scenes/:id/augment/apply` writes what the DM took.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sceneToReply, type GeneratorJob, type Scene, type SceneProposal } from "@grimoire/shared";
import { app } from "../src/server";
import { setKnowledge } from "./support/knowledge-items";
import { clearJobsForTests } from "../src/generator-jobs";
import {
  MAX_CORRECTION_TURNS,
  campaignRefIds,
  collectContext,
  setProviderForTests,
} from "../src/generator";
import { validateSceneAugmentReply } from "../src/scene-augment";
import { failInterruptedJobs } from "../src/db/job-boot";
import { getDb } from "../src/store/handle";
import {
  buildPrompt,
  EXISTING_NPC_HEADING,
  EXISTING_SCENE_HEADING,
  INSTRUCTION_HEADING,
  type CompletionResult,
  type CorrectionTurn,
  type GenerateRequest,
  type LLMProvider,
} from "../src/llm-provider";
import { dropStore, seedStore } from "./support/store";
import { jobsUrl, readJob } from "./support/generator-jobs";

const CAMPAIGN = "beispiel";
const SCENES = `/api/campaigns/${CAMPAIGN}/scenes`;
const ARRIVAL = `${SCENES}/lighthouse-arrival`;

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: Array<{ req: GenerateRequest; corrections: CorrectionTurn[] }> = [];
  constructor(private replies: string[]) {}
  async complete(req: GenerateRequest, corrections: CorrectionTurn[] = []): Promise<CompletionResult> {
    this.calls.push({ req, corrections: [...corrections] });
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error("FakeProvider: no scripted reply left");
    return { text: reply, truncated: false };
  }
}

/** A provider whose call never returns — a run that is still `running`. */
class StuckProvider implements LLMProvider {
  readonly name = "stuck";
  async complete(): Promise<CompletionResult> {
    return new Promise<CompletionResult>(() => undefined);
  }
}

function useFake(replies: string[]): FakeProvider {
  const fake = new FakeProvider(replies);
  setProviderForTests(fake);
  return fake;
}

async function read(url = ARRIVAL): Promise<Scene> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return (await res.json()) as Scene;
}

function withoutGuard(scene: Scene): SceneProposal {
  const { rev: _rev, ...fields } = scene;
  return fields;
}

/** The reply a model gives: the scene in its reply form, `over` applied, and the notes. */
function reply(stored: Scene, over: Record<string, unknown> = {}, warnings: string[] = []): string {
  return JSON.stringify({ ...sceneToReply(withoutGuard(stored)), ...over, warnings });
}

async function post(url: string, body: Record<string, unknown>): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function currentJob(): Promise<GeneratorJob> {
  const job = await readJob(CAMPAIGN);
  expect(job).not.toBeNull();
  return job!;
}

/** Start a run on the scene and wait for the job to leave `running`. */
async function runJob(body: Record<string, unknown>): Promise<GeneratorJob> {
  const res = await post(`${ARRIVAL}/augment`, body);
  expect(res.status).toBe(202);
  // The answer is the job itself, naming the scene from the moment it starts.
  const started = (await res.json()) as GeneratorJob;
  expect(started.kind).toBe("scene-augment");
  expect(started.scene).toBe("lighthouse-arrival");
  for (let i = 0; i < 200; i += 1) {
    const job = await currentJob();
    expect(job.id).toBe(started.id);
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job never finished");
}

beforeAll(async () => {
  await seedStore();
});
afterAll(() => {
  dropStore();
});
afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
});

describe("the prompt", () => {
  test("the existing scene travels as its own block, in the reply form", async () => {
    const stored = await read();
    const prompt = buildPrompt({
      systemPrompt: "SYS",
      fewShotTarget: "FEWSHOT",
      knowledge: "- Salzhafen heißt immer Salzhafen",
      glossary: "cove → Bucht",
      context: { chapter: stored.chapter, npcs: [], locations: [] },
      sourceText: "A spy among the smugglers.",
      existingScene: sceneToReply(withoutGuard(stored)),
      instruction: "Führe einen Handlungsstrang um den Spitzel ein",
    });
    expect(prompt).toContain(`${EXISTING_SCENE_HEADING} (lighthouse-arrival)`);
    expect(prompt).toContain('"title": "Ankunft am Leuchtturm"');
    // An absent optional field is `null` — the form the model answers in.
    expect(prompt).toContain('"trigger": null');
    expect(prompt).toContain(INSTRUCTION_HEADING);
    expect(prompt).toContain("cove → Bucht");
    expect(prompt).toContain("Salzhafen heißt immer Salzhafen");
    expect(prompt).not.toContain(EXISTING_NPC_HEADING);
    // The existing scene stands BELOW the few-shot and ABOVE the source text.
    expect(prompt.indexOf("FEWSHOT")).toBeLessThan(prompt.indexOf(EXISTING_SCENE_HEADING));
    expect(prompt.indexOf(EXISTING_SCENE_HEADING)).toBeLessThan(prompt.indexOf("## Quelltext"));
  });

  test("a run with only an instruction has no Quelltext section", async () => {
    const prompt = buildPrompt({
      systemPrompt: "SYS",
      fewShotTarget: "FEWSHOT",
      knowledge: "",
      glossary: "",
      context: { npcs: [], locations: [] },
      sourceText: "",
      existingScene: sceneToReply(withoutGuard(await read())),
      instruction: "Ergänze die Stimmung",
    });
    expect(prompt).not.toContain("## Quelltext");
    expect(prompt).toContain(INSTRUCTION_HEADING);
  });
});

describe("the run", () => {
  test("202 with the running job, and the finished job carries the scene as read and as proposed", async () => {
    const stored = await read();
    const body = `${stored.body}\n> [!secret] Der Spitzel sitzt in der Hafenwache.\n`;
    const fake = useFake([
      reply(stored, { title: "Ankunft im Nebel", body }, ["Neuer Handlungsstrang ergänzt"]),
    ]);
    const job = await runJob({ instruction: "Spitzel einführen" });
    expect(job.status).toBe("done");
    expect(job.kind).toBe("scene-augment");
    expect(job.scene).toBe("lighthouse-arrival");
    expect(job.npcAugmentResult).toBeUndefined();
    const result = job.sceneAugmentResult!;
    expect(result.id).toBe("lighthouse-arrival");
    expect(result.rev).toBe(stored.rev);
    expect(result.current).toEqual(withoutGuard(stored));
    expect(result.proposed.title).toBe("Ankunft im Nebel");
    expect(result.proposed.body).toContain("Der Spitzel sitzt in der Hafenwache");
    // The status the DM gave the scene is not the model's to reset.
    expect(result.proposed.status).toBe("ready");
    expect(result.warnings).toEqual(["Neuer Handlungsstrang ergänzt"]);
    // Nothing is written by a run.
    expect(await read()).toEqual(stored);

    const req = fake.calls[0]!.req;
    expect(req.existingScene).toEqual(sceneToReply(withoutGuard(stored)));
    expect(req.existingNpc).toBeUndefined();
    expect(req.jsonSchema?.name).toBe("augmented_scene");
    expect(req.systemPrompt).toContain("System-Prompt: Szene ergänzen");
    expect(req.fewShotTarget).toContain('"id": "smuggler-captured"');
    // A scene's chapter belongs in the context, as it does for a scene run.
    expect(req.context.chapter).toBe("01-salzhafen");
  });

  test("the proposal round-trips through the job row", async () => {
    const stored = await read();
    useFake([reply(stored, { tags: ["social", "travel", "mystery"] }, ["geprüft"])]);
    const started = await runJob({ instruction: "x" });
    const job = await currentJob();
    expect(job.id).toBe(started.id);
    expect(job.sceneAugmentResult).toEqual(started.sceneAugmentResult!);
    expect(job.sceneAugmentResult?.proposed.tags).toEqual(["social", "travel", "mystery"]);
  });

  test("400 without source text and instruction, 404 for an unknown scene", async () => {
    expect((await post(`${ARRIVAL}/augment`, {})).status).toBe(400);
    expect((await post(`${ARRIVAL}/augment`, { sourceText: "  " })).status).toBe(400);
    expect((await post(`${ARRIVAL}/augment`, { path: "x", instruction: "x" })).status).toBe(400);
    const unknown = await post(`${SCENES}/gibt-es-nicht/augment`, { instruction: "x" });
    expect(unknown.status).toBe(404);
    expect(await readJob(CAMPAIGN)).toBeNull();
    // The augment run of a scene starts on the scene; the generator jobs'
    // own start takes no augment kind.
    const onJobs = await post(jobsUrl(CAMPAIGN), { kind: "scene-augment", instruction: "x" });
    expect(onJobs.status).toBe(400);
    expect(await readJob(CAMPAIGN)).toBeNull();
  });

  test("a changed id, an unknown callout or an added unknown [[id]] goes back to the model", async () => {
    const stored = await read();
    const refIds = campaignRefIds(await collectContext(CAMPAIGN));
    const renamed = validateSceneAugmentReply(reply(stored, { id: "arrival" }), stored, refIds);
    expect(renamed.ok).toBe(false);
    if (!renamed.ok) expect(renamed.errors.join(" ")).toContain('die id bleibt "lighthouse-arrival"');
    const callout = validateSceneAugmentReply(
      reply(stored, { body: `${stored.body}\n> [!spoiler] nope\n` }),
      stored,
      refIds,
    );
    expect(callout.ok).toBe(false);
    if (!callout.ok) expect(callout.errors.join(" ")).toContain("[!spoiler]");
    const unknownRef = validateSceneAugmentReply(
      reply(stored, { body: `${stored.body}\nSie misstraut [[niemand]].\n` }),
      stored,
      refIds,
    );
    expect(unknownRef.ok).toBe(false);
    if (!unknownRef.ok) expect(unknownRef.errors[0]).toContain("[[niemand]] nennt nichts");
    // An npc, a location and a scene of the campaign all resolve; a slug in
    // code is literal text and not a reference at all.
    const good = validateSceneAugmentReply(
      reply(stored, {
        body:
          `${stored.body}\n[[fenn]] am [[leuchtturm]], danach [[smuggler-captured]].\n` +
          "Im Log steht `[[niemand]]`.\n",
      }),
      stored,
      refIds,
    );
    expect(good.ok).toBe(true);
    // A reference the stored body already carries is the DM's, not the run's.
    const dangling = { ...stored, body: `${stored.body}\nVielleicht [[der-fremde]].\n` };
    expect(validateSceneAugmentReply(reply(dangling), dangling, refIds).ok).toBe(true);
  });

  test("a key a scene does not have is an echo, not a failed run", async () => {
    const stored = await read();
    const outcome = validateSceneAugmentReply(
      reply(stored, { mood: "düster" }),
      stored,
      campaignRefIds(await collectContext(CAMPAIGN)),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(Object.hasOwn(outcome.result.proposed, "mood")).toBe(false);
  });

  test("an unknown [[id]] in the proposal costs one correction turn", async () => {
    const stored = await read();
    const bad = reply(stored, { body: `${stored.body}\nDer Spitzel ist [[der-spitzel]].\n` });
    const good = reply(stored, { body: `${stored.body}\nDer Spitzel sitzt in der Hafenwache.\n` });
    const fake = useFake([bad, good]);
    const job = await runJob({ instruction: "Spitzel einführen" });
    expect(job.status).toBe("done");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]!.assistant).toBe(bad);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("[[der-spitzel]]");
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("die vollständige ergänzte Szene");
    expect(job.sceneAugmentResult?.proposed.body).not.toContain("[[der-spitzel]]");
  });

  test("every reply malformed is a terminal 422 llm_invalid, and nothing is written", async () => {
    const before = await read();
    const fake = useFake(Array.from({ length: 5 }, () => "kein JSON, nur Prosa"));
    const job = await runJob({ instruction: "x" });
    expect(job.status).toBe("failed");
    expect(job.error?.status).toBe(422);
    expect(job.error?.body.code).toBe("llm_invalid");
    expect(fake.calls.length).toBeLessThanOrEqual(1 + MAX_CORRECTION_TURNS);
    expect(fake.calls.length).toBeGreaterThan(1);
    expect((await read()).rev).toBe(before.rev);
  });

  test("a spelling a naming convention replaces is a hint on the scene, never a failure", async () => {
    await setKnowledge([{ kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }]);
    try {
      const stored = await read();
      useFake([
        reply(stored, {
          title: "Ankunft: Salt Harbour",
          body: `${stored.body}\n> [!secret] Jorna kam aus Salt Harbour zurück.\n`,
        }),
      ]);
      const job = await runJob({ instruction: "Hintergrund ergänzen" });
      expect(job.status).toBe("done");
      const hints = job.sceneAugmentResult?.namingHints ?? [];
      // A field the proposal changes is checked as that field, the text line
      // by line.
      expect(hints.map((hint) => [hint.scene, hint.field])).toEqual([
        ["lighthouse-arrival", "title"],
        ["lighthouse-arrival", "body"],
      ]);
    } finally {
      await setKnowledge([]);
    }
  });
});

describe("one job per campaign, whatever its kind", () => {
  test("an augment start while a SCENE run is going is a 409, and the other way round", async () => {
    setProviderForTests(new StuckProvider());
    const scene = await post(jobsUrl(CAMPAIGN), {
      kind: "scene",
      chapter: "01-salzhafen",
      sourceText: "source",
    });
    expect(scene.status).toBe(202);
    const sceneJob = (await scene.json()) as GeneratorJob;
    const res = await post(`${ARRIVAL}/augment`, { instruction: "x" });
    expect(res.status).toBe(409);
    // The refusal carries the running job.
    const refused = (await res.json()) as { generatorJob: GeneratorJob };
    expect(refused.generatorJob.id).toBe(sceneJob.id);
    expect(refused.generatorJob.kind).toBe("scene");
    await clearJobsForTests();

    const augment = await post(`${ARRIVAL}/augment`, { instruction: "x" });
    expect(augment.status).toBe(202);
    const augmentJob = (await augment.json()) as GeneratorJob;
    const run = await post(jobsUrl(CAMPAIGN), {
      kind: "scene",
      chapter: "01-salzhafen",
      sourceText: "source",
    });
    expect(run.status).toBe(409);
    expect(((await run.json()) as { generatorJob: GeneratorJob }).generatorJob.id).toBe(
      augmentJob.id,
    );
  });

  test("a leftover `running` augment row becomes a failed job at the next boot", async () => {
    setProviderForTests(new StuckProvider());
    expect((await post(`${ARRIVAL}/augment`, { instruction: "x" })).status).toBe(202);
    expect(failInterruptedJobs(await getDb())).toBe(1);
    const job = await currentJob();
    expect(job.kind).toBe("scene-augment");
    expect(job.scene).toBe("lighthouse-arrival");
    expect(job.status).toBe("failed");
    expect(job.error?.body.code).toBe("job_restarted");
  });
});

describe("accepting", () => {
  test("the fields taken and the body land in ONE write, and the job is gone", async () => {
    const before = await read();
    useFake([reply(before)]);
    const job = await runJob({ instruction: "x" });
    const body = `${before.body}\n## If: Nebel\n\n- mehr als sie sagt\n`;
    const res = await post(`${ARRIVAL}/augment/apply`, {
      rev: before.rev,
      title: "Ankunft am Leuchtturm (neu)",
      body,
      jobId: job.id,
    });
    expect(res.status).toBe(200);
    const written = (await res.json()) as Scene;
    expect(written.title).toBe("Ankunft am Leuchtturm (neu)");
    expect(written.body).toContain("- mehr als sie sagt");
    expect(written.status).toBe(before.status);
    expect(written.rev).toBe(before.rev + 1);
    expect(await read()).toEqual(written);
    expect(await readJob(CAMPAIGN)).toBeNull();
  });

  test("a scene may change chapter with its body in the same write", async () => {
    const chapter = await post(`/api/campaigns/${CAMPAIGN}/chapters`, {
      title: "Zweites Kapitel",
      id: "02-umzug",
    });
    expect(chapter.status).toBe(201);
    const created = await post(SCENES, {
      title: "Umzugsszene",
      chapter: "01-salzhafen",
      id: "moving-scene",
    });
    const scene = (await created.json()) as Scene;
    const res = await post(`${SCENES}/moving-scene/augment/apply`, {
      rev: scene.rev,
      chapter: "02-umzug",
      body: "## Flow\n\nSie ziehen um.\n",
    });
    expect(res.status).toBe(200);
    const written = (await res.json()) as Scene;
    expect(written.chapter).toBe("02-umzug");
    expect(written.body).toBe("## Flow\n\nSie ziehen um.\n");
    expect(await read(`${SCENES}/moving-scene`)).toEqual(written);
  });

  test("a stale rev is 409 with the current scene, and nothing is written", async () => {
    const before = await read();
    const res = await post(`${ARRIVAL}/augment/apply`, {
      rev: before.rev - 1,
      title: "ganz anders",
      body: "## Flow\n\nüberschrieben\n",
    });
    expect(res.status).toBe(409);
    const conflict = (await res.json()) as { code: string; scene: Scene };
    expect(conflict.code).toBe("rev_conflict");
    expect(conflict.scene).toEqual(before);
    expect(await read()).toEqual(before);
  });

  test("no force, no id, no foreign key — and taking nothing is a 400", async () => {
    const before = await read();
    for (const body of [
      { rev: before.rev, title: "X", force: true },
      { rev: before.rev, id: "lighthouse-arrival", title: "X" },
      { rev: before.rev, properties: { title: "X" } },
      { rev: before.rev, path: "x", title: "X" },
      { rev: before.rev },
    ]) {
      expect((await post(`${ARRIVAL}/augment/apply`, body)).status).toBe(400);
    }
    expect(await read()).toEqual(before);
  });
});
