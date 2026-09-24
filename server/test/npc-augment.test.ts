// Augmenting an npc on its own resource (ADR #31): `POST …/npcs/:id/augment`
// starts the run, the job carries the npc as read and as proposed, and
// `POST …/npcs/:id/augment/apply` writes what the DM took.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  npcProposalSchema,
  npcToReply,
  type GenerateJob,
  type Npc,
  type NpcProposal,
} from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generate-jobs";
import {
  ASSET_FILES,
  campaignRefIds,
  collectContext,
  loadAsset,
  setProviderForTests,
} from "../src/generator";
import { npcAugmentSystemPrompt, validateNpcAugmentReply } from "../src/npc-augment";
import { parseNpcReply } from "../src/npc-reply";
import {
  buildPrompt,
  EXISTING_ENTRY_HEADING,
  EXISTING_NPC_HEADING,
  type CompletionResult,
  type CorrectionTurn,
  type GenerateRequest,
  type LLMProvider,
} from "../src/llm-provider";
import { dropStore, seedStore } from "./support/store";

const CAMPAIGN = "beispiel";
const JORNA = `/api/campaigns/${CAMPAIGN}/npcs/jorna`;

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

function useFake(replies: string[]): FakeProvider {
  const fake = new FakeProvider(replies);
  setProviderForTests(fake);
  return fake;
}

async function read(): Promise<Npc> {
  const res = await app.request(JORNA);
  expect(res.status).toBe(200);
  return (await res.json()) as Npc;
}

function withoutGuard(npc: Npc): NpcProposal {
  const { rev: _rev, ...fields } = npc;
  return fields;
}

/**
 * The reply a model gives: the npc in its reply form — `quickstats` as its
 * pairs, an absent field `null` —, `over` applied, and the notes.
 */
function reply(stored: Npc, over: Record<string, unknown> = {}, warnings: string[] = []): string {
  return JSON.stringify({ ...npcToReply(withoutGuard(stored)), ...over, warnings });
}

async function post(url: string, body: Record<string, unknown>): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Start a run on the npc and wait for the job to leave `running`. */
async function runJob(body: Record<string, unknown>): Promise<GenerateJob> {
  const res = await post(`${JORNA}/augment`, body);
  expect(res.status).toBe(202);
  for (let i = 0; i < 200; i += 1) {
    const job = (await (await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).json()) as GenerateJob;
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job never finished");
}

async function setKnowledge(entries: unknown[]): Promise<void> {
  const current = await app.request(`/api/campaigns/${CAMPAIGN}/knowledge`);
  const { rev } = (await current.json()) as { rev: number };
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/knowledge`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries, rev }),
  });
  expect(res.status).toBe(200);
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
  test("the augmentation rule for an npc plus the npc's fields, one output format", async () => {
    const prompt = await npcAugmentSystemPrompt();
    expect(prompt).toContain("System-Prompt: NPC ergänzen");
    expect(prompt).toContain("Die Ergänzungsregel");
    expect(prompt).toContain("Vorhandenes bleibt Wort für Wort stehen");
    expect(prompt).toContain("## Die Felder des NPC");
    expect(prompt).toContain('"quickstats"');
    expect(prompt.split("## Ausgabeformat").length - 1).toBe(1);
    expect(prompt.split("**Deutsche Orthografie**").length - 1).toBe(1);
    // The create prompt's own rules stay behind — the augmentation rule wins.
    expect(prompt).not.toContain("vorgegebene id");
  });

  test("the npc prompts speak of the npc and its fields", async () => {
    const create = await loadAsset(ASSET_FILES.npc.systemPrompt);
    const augment = await npcAugmentSystemPrompt();
    for (const prompt of [create, augment]) {
      expect(prompt).not.toContain("Eigenschaft");
      expect(prompt).not.toContain("Eintrag");
      expect(prompt).not.toContain("`properties`");
      expect(prompt).toContain("ä, ö, ü und ß stehen als genau diese Zeichen");
      expect(prompt).toContain("Du antwortest mit **einem JSON-Objekt**");
    }
  });

  test("the few-shot is an npc reply with every field, and it reads", async () => {
    const raw = await loadAsset(ASSET_FILES.npc.fewShotTarget);
    const example = JSON.parse(raw) as Record<string, unknown>;
    for (const key of Object.keys(npcProposalSchema.shape)) {
      expect(Object.hasOwn(example, key), key).toBe(true);
    }
    expect(JSON.stringify(example)).toMatch(/[äöüß]/);
    expect(parseNpcReply(raw).ok).toBe(true);
  });

  test("the existing npc travels as its own block, in the reply form", async () => {
    const stored = await read();
    const prompt = buildPrompt({
      systemPrompt: "SYS",
      fewShotTarget: "FEWSHOT",
      knowledge: "",
      glossary: "",
      context: { npcs: [], locations: [] },
      sourceText: "source",
      existingNpc: npcToReply(withoutGuard(stored)),
    });
    expect(prompt).toContain(`${EXISTING_NPC_HEADING} (jorna)`);
    expect(prompt).toContain('"name": "Hafenmeisterin Jorna"');
    // `quickstats` is a key/value set on the npc and a list of pairs in a
    // reply — the model is shown the form it has to write back.
    expect(prompt).toContain('"key": "insight"');
    expect(prompt).toContain('"value": "2"');
    expect(prompt).not.toContain('"insight": 2');
    expect(prompt).not.toContain(EXISTING_ENTRY_HEADING);
    expect(prompt.indexOf("FEWSHOT")).toBeLessThan(prompt.indexOf(EXISTING_NPC_HEADING));
    expect(prompt.indexOf(EXISTING_NPC_HEADING)).toBeLessThan(prompt.indexOf("## Quelltext"));
  });
});

describe("the run", () => {
  test("202, and the job carries the npc as read and as proposed", async () => {
    const stored = await read();
    const body = `${stored.body}\n> [!secret] Sie kennt den Spitzel in der Hafenwache.\n`;
    const fake = useFake([reply(stored, { voice: "knapp, heiser", body }, ["Spitzel ergänzt"])]);
    const job = await runJob({ instruction: "Einen Spitzel einführen" });
    expect(job.status).toBe("done");
    expect(job.kind).toBe("npc-augment");
    expect(job.npc).toBe("jorna");
    expect(job.target).toBeUndefined();
    expect(job.augmentResult).toBeUndefined();
    const result = job.npcAugmentResult!;
    expect(result.id).toBe("jorna");
    expect(result.rev).toBe(stored.rev);
    expect(result.current).toEqual(withoutGuard(stored));
    expect(result.proposed.voice).toBe("knapp, heiser");
    expect(result.proposed.body).toContain("Spitzel in der Hafenwache");
    // The stored quickstats hold numbers, the reply form holds strings: an
    // echo of them is no change, and the proposal keeps the stored values.
    expect(result.proposed.quickstats).toEqual(stored.quickstats);
    expect(result.warnings).toEqual(["Spitzel ergänzt"]);
    // Nothing is written by a run.
    expect(await read()).toEqual(stored);

    const req = fake.calls[0]!.req;
    expect(req.existingNpc).toEqual(npcToReply(withoutGuard(stored)));
    expect(req.existingEntry).toBeUndefined();
    expect(req.jsonSchema?.name).toBe("augmented_npc");
    expect(req.systemPrompt).toContain("System-Prompt: NPC ergänzen");
    expect(req.fewShotTarget).toContain('"id": "fenn"');
    expect(req.context.chapter).toBeUndefined();
  });

  test("the proposal round-trips through the job row", async () => {
    const stored = await read();
    useFake([reply(stored, { role: "Hafenmeisterin mit Geheimnissen" })]);
    const started = await runJob({ instruction: "x" });
    const job = (await (await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).json()) as GenerateJob;
    expect(job.id).toBe(started.id);
    expect(job.npcAugmentResult).toEqual(started.npcAugmentResult!);
    expect(job.npcAugmentResult?.proposed.role).toBe("Hafenmeisterin mit Geheimnissen");
  });

  test("400 without source text and instruction, 404 for an unknown npc", async () => {
    expect((await post(`${JORNA}/augment`, {})).status).toBe(400);
    expect((await post(`${JORNA}/augment`, { instruction: "  " })).status).toBe(400);
    expect((await post(`${JORNA}/augment`, { path: "x", instruction: "x" })).status).toBe(400);
    const unknown = await post(`/api/campaigns/${CAMPAIGN}/npcs/gibt-es-nicht/augment`, {
      instruction: "x",
    });
    expect(unknown.status).toBe(404);
    expect((await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).status).toBe(404);
  });

  test("a changed id, an unknown callout or an added unknown [[id]] goes back to the model", async () => {
    const stored = await read();
    const refIds = campaignRefIds(await collectContext(CAMPAIGN));
    const renamed = validateNpcAugmentReply(reply(stored, { id: "jorna-2" }), stored, refIds);
    expect(renamed.ok).toBe(false);
    if (!renamed.ok) expect(renamed.errors.join(" ")).toContain('die id bleibt "jorna"');
    const callout = validateNpcAugmentReply(
      reply(stored, { body: `${stored.body}\n> [!spoiler] nope\n` }),
      stored,
      refIds,
    );
    expect(callout.ok).toBe(false);
    const unknownRef = validateNpcAugmentReply(
      reply(stored, { body: `${stored.body}\n[[gibt-es-nicht]]\n` }),
      stored,
      refIds,
    );
    expect(unknownRef.ok).toBe(false);
    // A reference the stored body already carries is the DM's, not the run's.
    const dangling = { ...stored, body: `${stored.body}\nVielleicht [[der-fremde]].\n` };
    expect(validateNpcAugmentReply(reply(dangling), dangling, refIds).ok).toBe(true);
  });

  test("a key an npc does not have is an echo, not a failed run", async () => {
    const stored = await read();
    const outcome = validateNpcAugmentReply(
      reply(stored, { atmosphere: "Nebel" }),
      stored,
      campaignRefIds(await collectContext(CAMPAIGN)),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(Object.hasOwn(outcome.result.proposed, "atmosphere")).toBe(false);
  });

  test("an unknown [[id]] in the proposal costs one correction turn", async () => {
    const stored = await read();
    const bad = reply(stored, { body: `${stored.body}\nDer Spitzel ist [[der-spitzel]].\n` });
    const good = reply(stored, { body: `${stored.body}\nDer Spitzel sitzt in der Hafenwache.\n` });
    const fake = useFake([bad, good]);
    const job = await runJob({ instruction: "Spitzel einführen" });
    expect(job.status).toBe("done");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("[[der-spitzel]]");
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("den vollständigen ergänzten NPC");
    expect(job.npcAugmentResult?.proposed.body).not.toContain("[[der-spitzel]]");
  });

  test("a spelling a naming convention replaces is a hint on the npc, never a failure", async () => {
    await setKnowledge([{ kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }]);
    try {
      const stored = await read();
      useFake([reply(stored, { role: "Hafenmeisterin von Salt Harbour" })]);
      const job = await runJob({ instruction: "Rolle schärfen" });
      expect(job.status).toBe("done");
      expect(job.npcAugmentResult?.namingHints).toEqual([
        expect.objectContaining({ from: "Salt Harbour", npc: "jorna", field: "role" }),
      ]);
    } finally {
      await setKnowledge([]);
    }
  });
});

describe("accepting", () => {
  test("the fields taken and the body land in ONE write, and the job is gone", async () => {
    const before = await read();
    useFake([reply(before)]);
    const job = await runJob({ instruction: "x" });
    const body = `${before.body}\n- ein Spitzel in der Hafenwache\n`;
    const res = await post(`${JORNA}/augment/apply`, {
      rev: before.rev,
      voice: "knapp, heiser",
      body,
      jobId: job.id,
    });
    expect(res.status).toBe(200);
    const written = (await res.json()) as Npc;
    expect(written.voice).toBe("knapp, heiser");
    expect(written.body).toContain("ein Spitzel in der Hafenwache");
    expect(written.quickstats).toEqual(before.quickstats);
    expect(written.rev).toBe(before.rev + 1);
    expect(await read()).toEqual(written);
    expect((await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).status).toBe(404);
  });

  test("a stale rev is 409 with the current npc, and nothing is written", async () => {
    const before = await read();
    const res = await post(`${JORNA}/augment/apply`, { rev: before.rev - 1, name: "Anders" });
    expect(res.status).toBe(409);
    const conflict = (await res.json()) as { code: string; npc: Npc };
    expect(conflict.code).toBe("rev_conflict");
    expect(conflict.npc).toEqual(before);
    expect(await read()).toEqual(before);
  });

  test("no force, no id, no foreign key — and taking nothing is a 400", async () => {
    const before = await read();
    for (const body of [
      { rev: before.rev, name: "X", force: true },
      { rev: before.rev, id: "jorna", name: "X" },
      { rev: before.rev, properties: { name: "X" } },
      { rev: before.rev, path: "x", name: "X" },
      { rev: before.rev },
    ]) {
      expect((await post(`${JORNA}/augment/apply`, body)).status).toBe(400);
    }
    expect(await read()).toEqual(before);
  });
});
