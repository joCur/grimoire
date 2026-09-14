// „Mit KI ergänzen" — the augment run (issue #36).
//
// Same harness as the two create-run suites (generator.test.ts,
// generate-npc.test.ts): a database seeded from the example campaign and a
// FakeProvider with scripted raw replies instead of a real LLM.
//
// What is asserted here is the ticket's AK4 and AK3:
//   * prompt assembly PER KIND — the existing entry travels complete, the
//     campaign knowledge and the glossary travel with it, and each kind gets
//     its own format contract (the location one is new with this ticket),
//   * the proposal — properties per field with new|changed, body whole,
//   * accepting — ONE transaction with a `rev` guard, and the job gone.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { AugmentResult, FileResponse, GenerateJob } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generate-jobs";
import {
  ASSET_FILES,
  MAX_CORRECTION_TURNS,
  loadAsset,
  setProviderForTests,
} from "../src/generator";
import {
  augmentSystemPrompt,
  formatContract,
  isEmptyValue,
  propertyProposals,
  validateAugmentReply,
} from "../src/generator-augment";
import { buildPrompt, EXISTING_ENTRY_HEADING, INSTRUCTION_HEADING } from "../src/llm-provider";
import { failInterruptedJobs } from "../src/db/job-boot";
import { getDb } from "../src/store/handle";
import { dropStore, seedStore } from "./support/store";
import type {
  CompletionResult,
  CorrectionTurn,
  GenerateRequest,
  LLMProvider,
} from "../src/llm-provider";

const CAMPAIGN = "beispiel";
const NPC = "npcs/jorna";
const LOCATION = "locations/leuchtturm";
const SCENE = "01-salzhafen/hafen/lighthouse-arrival";

async function read(rel: string): Promise<FileResponse> {
  const res = await app.request(`/api/${CAMPAIGN}/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

// --- fake provider ---------------------------------------------------------

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: Array<{ req: GenerateRequest; corrections: CorrectionTurn[] }> = [];
  constructor(private replies: string[]) {}
  async complete(
    req: GenerateRequest,
    corrections: CorrectionTurn[] = [],
  ): Promise<CompletionResult> {
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

/** The reply JSON in a fence, as real models tend to send it. */
function augmentReply(path: string, content: string, warnings: string[] = []): string {
  return "```json\n" + JSON.stringify({ entry: { path, content }, warnings }, null, 2) + "\n```";
}

/** Start a run and wait for the job to leave `running`. */
async function runAugmentJob(body: Record<string, unknown>): Promise<GenerateJob> {
  const res = await app.request(`/api/${CAMPAIGN}/generate/augment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(202);
  for (let i = 0; i < 200; i += 1) {
    const jobRes = await app.request(`/api/${CAMPAIGN}/generate/job`);
    const job = (await jobRes.json()) as GenerateJob;
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

// --- prompt assembly per kind (AK4) ----------------------------------------

describe("prompt assembly", () => {
  test("carries the existing entry, the instruction, knowledge and glossary", () => {
    const prompt = buildPrompt({
      systemPrompt: "SYS",
      fewShotTarget: "FEWSHOT",
      knowledge: "- Salzhafen heißt immer Salzhafen",
      glossary: "cove → Bucht",
      context: { npcs: [{ id: "jorna", name: "Jorna" }], locations: [] },
      sourceText: "A spy among the smugglers.",
      existingEntry: { path: NPC, markdown: "---\nid: jorna\n---\n\n## Will\n\nX\n" },
      instruction: "Führe einen Handlungsstrang um den Spitzel ein",
    });
    expect(prompt).toContain(EXISTING_ENTRY_HEADING);
    expect(prompt).toContain(`(${NPC})`);
    expect(prompt).toContain("id: jorna");
    expect(prompt).toContain(INSTRUCTION_HEADING);
    expect(prompt).toContain("Führe einen Handlungsstrang um den Spitzel ein");
    expect(prompt).toContain("cove → Bucht");
    expect(prompt).toContain("Salzhafen heißt immer Salzhafen");
    expect(prompt).toContain("## Quelltext");
    // The existing entry stands BELOW the few-shot and ABOVE the source text:
    // the model has to know the entry before it reads what to add to it.
    expect(prompt.indexOf("FEWSHOT")).toBeLessThan(prompt.indexOf(EXISTING_ENTRY_HEADING));
    expect(prompt.indexOf(EXISTING_ENTRY_HEADING)).toBeLessThan(prompt.indexOf("## Quelltext"));
  });

  test("a run with only an instruction has no Quelltext section", () => {
    const prompt = buildPrompt({
      systemPrompt: "SYS",
      fewShotTarget: "FEWSHOT",
      knowledge: "",
      glossary: "",
      context: { npcs: [], locations: [] },
      sourceText: "",
      existingEntry: { path: NPC, markdown: "---\nid: jorna\n---\n" },
      instruction: "Ergänze die Stimme",
    });
    expect(prompt).not.toContain("## Quelltext");
    expect(prompt).toContain(INSTRUCTION_HEADING);
  });

  test("a create run's prompt is unchanged — no augment sections", () => {
    const prompt = buildPrompt({
      systemPrompt: "SYS",
      fewShotTarget: "FEWSHOT",
      knowledge: "",
      glossary: "",
      context: { chapter: "01-salzhafen", npcs: [], locations: [] },
      sourceText: "source",
    });
    expect(prompt).not.toContain(EXISTING_ENTRY_HEADING);
    expect(prompt).not.toContain(INSTRUCTION_HEADING);
  });

  test("every kind gets the augmentation rule plus its own format contract", async () => {
    const npc = await augmentSystemPrompt("npc");
    const location = await augmentSystemPrompt("location");
    const scene = await augmentSystemPrompt("scene");
    for (const prompt of [npc, location, scene]) {
      expect(prompt).toContain("Die Ergänzungsregel");
      expect(prompt).toContain("Vorhandenes bleibt Wort für Wort stehen");
      expect(prompt).toContain('"entry"');
    }
    expect(npc).toContain("System-Prompt: NPC-Generator");
    // The location prompt is NEW with this ticket — locations had none.
    expect(location).toContain("System-Prompt: Ort-Generator");
    expect(location).toContain("kein `status`");
    expect(scene).toContain("System-Prompt: Szenen-Generator");
    expect(scene).toContain("## If:");
  });

  test("only ONE output schema travels — the create runs' is sliced off", async () => {
    for (const kind of ["npc", "location", "scene"] as const) {
      const prompt = await augmentSystemPrompt(kind);
      // The augment schema…
      expect(prompt).toContain('"entry"');
      // …and neither of the two create schemas that used to ride along.
      expect(prompt).not.toContain("npc_stubs");
      expect(prompt).not.toContain("location_stubs");
      expect(prompt).not.toContain('"npc":');
      expect(prompt).not.toContain('"scenes"');
      // Exactly one „## Ausgabeformat" heading: the augmentation rule's own.
      expect(prompt.split("## Ausgabeformat").length - 1).toBe(1);
      // The file format itself is still there.
      expect(prompt).toContain("## Ziel-Format der Datei");
    }
  });

  // Issue #93: the German-orthography rule. It has to reach EVERY assembled
  // prompt kind and exactly once — the create prompts carry it under
  // „## Regeln", which `formatContract` slices off, so the augment kinds get
  // it from augment-system-prompt.md instead. Once means once: a rule the
  // model meets twice in slightly different company is a rule it can weigh.
  const ORTHOGRAPHY_RULE = "**Deutsche Orthografie**";

  test("every prompt kind carries the orthography rule exactly once", async () => {
    const assembled: Array<[string, string]> = [
      ["scene", await loadAsset(ASSET_FILES.scene.systemPrompt)],
      ["npc", await loadAsset(ASSET_FILES.npc.systemPrompt)],
      ["location", await loadAsset(ASSET_FILES.location.systemPrompt)],
      ["augment/npc", await augmentSystemPrompt("npc")],
      ["augment/location", await augmentSystemPrompt("location")],
      ["augment/scene", await augmentSystemPrompt("scene")],
    ];
    for (const [kind, prompt] of assembled) {
      expect(prompt.split(ORTHOGRAPHY_RULE).length - 1, kind).toBe(1);
      // The wording is the contract, not just the label.
      expect(prompt, kind).toContain("ä, ö, ü und ß");
      expect(prompt, kind).toContain("ae/oe/ue/ss");
      expect(prompt, kind).toContain("`id`-Werte und Adressen/Pfade");
    }
    // …and it is the SAME sentence everywhere: one rule, four prompts.
    const paragraph = (doc: string) =>
      doc.slice(doc.indexOf(ORTHOGRAPHY_RULE)).split("\n\n")[0];
    const wordings = new Set(assembled.map(([, doc]) => paragraph(doc)));
    expect(wordings.size).toBe(1);
  });

  test("the few-shot targets show umlauts in properties AND body", async () => {
    for (const kind of ["scene", "npc", "location"] as const) {
      const doc = await loadAsset(ASSET_FILES[kind].fewShotTarget);
      const [, frontmatter = "", ...rest] = doc.split("---\n");
      expect(frontmatter, `${kind} properties`).toMatch(/[äöüß]/);
      expect(rest.join("---\n"), `${kind} body`).toMatch(/[äöüß]/);
    }
  });

  test("a document without the format heading travels whole", () => {
    expect(formatContract("# Titel\n\n## Regeln\n\nnichts\n")).toContain("## Regeln");
  });

  test("the run sends the kind's own system prompt and few-shot", async () => {
    const file = await read(LOCATION);
    const content = `${file.raw}\n## Wer ist hier\n\n- niemand\n`;
    const fake = useFake([augmentReply(LOCATION, content)]);
    await runAugmentJob({ path: LOCATION, instruction: "Ergänze, wer hier ist" });
    const req = fake.calls[0]!.req;
    expect(req.systemPrompt).toContain("System-Prompt: Ort-Generator");
    expect(req.fewShotTarget).toContain("id: leuchtturm");
    expect(req.existingEntry?.path).toBe(LOCATION);
    expect(req.existingEntry?.markdown).toContain("roll20-page");
    // A location run has no target chapter in the context…
    expect(req.context.chapter).toBeUndefined();
  });

  test("a scene run carries its chapter in the context", async () => {
    const file = await read(SCENE);
    const fake = useFake([augmentReply(SCENE, file.raw)]);
    await runAugmentJob({ path: SCENE, instruction: "nichts ändern" });
    expect(fake.calls[0]!.req.context.chapter).toBe("01-salzhafen");
  });
});

// --- the proposal (AK2) -----------------------------------------------------

describe("proposal", () => {
  test("empty values are `new`, filled ones `changed`, equal ones absent", () => {
    const proposals = propertyProposals(
      { name: "Jorna", role: "", tags: [], status: "alive", id: "jorna" },
      {
        name: "Jorna",           // unchanged -> not listed
        role: "Hafenmeisterin",  // was empty -> new
        tags: ["social"],        // was empty list -> new
        status: "missing",       // was filled -> changed
        voice: "knapp",          // absent -> new
        id: "other",             // frozen -> never listed
      },
    );
    const byKey = Object.fromEntries(proposals.map((p) => [p.key, p]));
    expect(Object.keys(byKey).sort()).toEqual(["role", "status", "tags", "voice"]);
    expect(byKey.role!.state).toBe("new");
    expect(byKey.tags!.state).toBe("new");
    expect(byKey.voice!.state).toBe("new");
    expect(byKey.voice!.current).toBeUndefined();
    expect(byKey.status!.state).toBe("changed");
    expect(byKey.status!.current).toBe("alive");
    expect(byKey.status!.proposed).toBe("missing");
  });

  test("a key the proposal drops is never a deletion", () => {
    expect(propertyProposals({ voice: "knapp" }, {})).toEqual([]);
  });

  test("isEmptyValue keeps false and 0 as real values", () => {
    expect(isEmptyValue("")).toBe(true);
    expect(isEmptyValue("  ")).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
  });

  test("a reply for another path is rejected", async () => {
    const file = await read(NPC);
    const outcome = validateAugmentReply(augmentReply("npcs/fenn", file.raw), {
      kind: "npc",
      file,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0]).toContain("path muss unverändert");
  });

  test("a changed id is rejected — it is the reference key", async () => {
    const file = await read(NPC);
    const outcome = validateAugmentReply(
      augmentReply(NPC, file.raw.replace("id: jorna", "id: jorna-die-hafenmeisterin")),
      { kind: "npc", file },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.join(" ")).toContain("die id bleibt");
  });

  test("an unknown callout is a correction turn, a known one is not", async () => {
    const file = await read(NPC);
    const bad = validateAugmentReply(
      augmentReply(NPC, `${file.raw}\n> [!spoiler] nope\n`),
      { kind: "npc", file },
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toContain("[!spoiler]");
    const good = validateAugmentReply(
      augmentReply(NPC, `${file.raw}\n> [!note] fine\n`),
      { kind: "npc", file },
    );
    expect(good.ok).toBe(true);
  });

  test("a scene keeps the status the DM gave it", async () => {
    const file = await read(SCENE);
    expect(file.properties.status).toBe("ready");
    const outcome = validateAugmentReply(augmentReply(SCENE, file.raw), {
      kind: "scene",
      file,
    });
    expect(outcome.ok).toBe(true);
    // `ready` is not `draft` and must not be reported as a change at all.
    if (outcome.ok) {
      expect(outcome.result.properties.some((p) => p.key === "status")).toBe(false);
    }
  });

  test("a location may not carry a status", async () => {
    const file = await read(LOCATION);
    const outcome = validateAugmentReply(
      augmentReply(LOCATION, file.raw.replace("---\n\n", "status: alive\n---\n\n")),
      { kind: "location", file },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.join(" ")).toContain("status");
  });
});

// --- the run and its job ------------------------------------------------------

describe("the job", () => {
  test("a run answers 202 and leaves an augment job with the proposal", async () => {
    const file = await read(NPC);
    const content = file.raw.replace(
      "## Notizen",
      "> [!secret] Der Spitzel sitzt in der Hafenwache.\n\n## Notizen",
    );
    useFake([augmentReply(NPC, content, ["Neuer Handlungsstrang ergänzt"])]);
    const job = await runAugmentJob({ path: NPC, instruction: "Spitzel einführen" });
    expect(job.status).toBe("done");
    expect(job.kind).toBe("augment");
    expect(job.target).toBe(NPC);
    const result = job.augmentResult as AugmentResult;
    expect(result.path).toBe(NPC);
    expect(result.kind).toBe("npc");
    expect(result.rev).toBe(file.rev);
    expect(result.currentBody).toBe(file.body);
    expect(result.proposedBody).toContain("Der Spitzel sitzt in der Hafenwache");
    expect(result.warnings).toEqual(["Neuer Handlungsstrang ergänzt"]);
    // Nothing is written by a run.
    expect((await read(NPC)).body).toBe(file.body);
  });

  test("a body without properties comes back as a correction turn", async () => {
    const file = await read(NPC);
    const fake = useFake([
      augmentReply(NPC, "## Will\n\nkein Frontmatter\n"),
      augmentReply(NPC, file.raw),
    ]);
    const job = await runAugmentJob({ path: NPC, instruction: "x" });
    expect(job.status).toBe("done");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]?.correction).toContain("ergänzten Eintrag");
  });

  test("neither source text nor instruction is a 400, before a job exists", async () => {
    const res = await app.request(`/api/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: NPC, sourceText: "  " }),
    });
    expect(res.status).toBe(400);
    expect((await app.request(`/api/${CAMPAIGN}/generate/job`)).status).toBe(404);
  });

  test("a kind without an augment prompt is a 400", async () => {
    const res = await app.request(`/api/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "01-salzhafen/_chapter", instruction: "x" }),
    });
    expect(res.status).toBe(400);
  });

  test("an unknown entry is a 404", async () => {
    const res = await app.request(`/api/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "npcs/nobody", instruction: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("one job per campaign, whatever its kind", () => {
  async function jobStatus(): Promise<number> {
    return (await app.request(`/api/${CAMPAIGN}/generate/job`)).status;
  }

  test("an augment start while a SCENE run is going is a 409", async () => {
    setProviderForTests(new StuckProvider());
    const scene = await app.request(`/api/${CAMPAIGN}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapter: "01-salzhafen", sourceText: "source" }),
    });
    expect(scene.status).toBe(202);
    const res = await app.request(`/api/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: NPC, instruction: "x" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).jobId).toBeString();
  });

  test("a SCENE start while an augment run is going is a 409", async () => {
    setProviderForTests(new StuckProvider());
    const augment = await app.request(`/api/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: NPC, instruction: "x" }),
    });
    expect(augment.status).toBe(202);
    const res = await app.request(`/api/${CAMPAIGN}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapter: "01-salzhafen", sourceText: "source" }),
    });
    expect(res.status).toBe(409);
    // …and so is a second augment run.
    const again = await app.request(`/api/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: LOCATION, instruction: "x" }),
    });
    expect(again.status).toBe(409);
  });

  test("Vorschlag verwerfen discards a finished augment job", async () => {
    const file = await read(NPC);
    useFake([augmentReply(NPC, file.raw)]);
    await runAugmentJob({ path: NPC, instruction: "x" });
    expect(await jobStatus()).toBe(200);
    const res = await app.request(`/api/${CAMPAIGN}/generate/job`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await jobStatus()).toBe(404);
    // Nothing was written by the run, and nothing by the reject.
    expect((await read(NPC)).rev).toBe(file.rev);
  });

  test("a leftover `running` augment row becomes a failed job at the next boot", async () => {
    setProviderForTests(new StuckProvider());
    const started = await app.request(`/api/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: NPC, instruction: "x" }),
    });
    expect(started.status).toBe(202);

    // What the next boot does with the row the dead process left behind.
    expect(failInterruptedJobs(await getDb())).toBe(1);

    const job = (await (await app.request(`/api/${CAMPAIGN}/generate/job`)).json()) as GenerateJob;
    expect(job.kind).toBe("augment");
    expect(job.target).toBe(NPC);
    expect(job.status).toBe("failed");
    expect(job.error?.body.code).toBe("job_restarted");
  });

  test("the proposal round-trips through the job row", async () => {
    const file = await read(NPC);
    const content = file.raw.replace("voice:", "tags: [hafen, see]\nvoice:");
    useFake([augmentReply(NPC, content, ["geprüft"])]);
    const started = await runAugmentJob({ path: NPC, instruction: "x" });

    // Re-read from the ROW (a fresh request is a fresh `toJob`), not from the
    // object the start returned.
    const job = (await (await app.request(`/api/${CAMPAIGN}/generate/job`)).json()) as GenerateJob;
    expect(job.id).toBe(started.id);
    expect(job.augmentResult).toEqual(started.augmentResult as AugmentResult);
    const result = job.augmentResult as AugmentResult;
    expect(result.properties.find((p) => p.key === "tags")?.proposed).toEqual(["hafen", "see"]);
    expect(result.warnings).toEqual(["geprüft"]);
    expect(result.rev).toBe(file.rev);
  });

  test("every reply malformed is a terminal 422 llm_invalid", async () => {
    // One initial call plus LLM_CORRECTION_TURNS; more replies than that are
    // never asked for, and the last word is a failed job, not an endless loop.
    const before = await read(NPC);
    const fake = useFake(Array.from({ length: 5 }, () => "kein JSON, nur Prosa"));
    const job = await runAugmentJob({ path: NPC, instruction: "x" });
    expect(job.status).toBe("failed");
    expect(job.error?.status).toBe(422);
    expect(job.error?.body.code).toBe("llm_invalid");
    expect(fake.calls.length).toBeLessThanOrEqual(1 + MAX_CORRECTION_TURNS);
    expect(fake.calls.length).toBeGreaterThan(1);
    // A failed run writes nothing at all.
    expect((await read(NPC)).rev).toBe(before.rev);
  });
});

// --- accepting (AK3) -----------------------------------------------------------

describe("accept", () => {
  async function apply(body: Record<string, unknown>): Promise<Response> {
    return app.request(`/api/${CAMPAIGN}/generate/augment/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("properties and body land in ONE write, and the job is gone", async () => {
    const before = await read(LOCATION);
    useFake([augmentReply(LOCATION, before.raw)]);
    const job = await runAugmentJob({ path: LOCATION, instruction: "x" });

    const body = `${before.body}\n## Wer ist hier\n\n- niemand\n`;
    const res = await apply({
      path: LOCATION,
      rev: before.rev,
      properties: { "roll20-page": "Leuchtturm (neu)" },
      body,
      jobId: job.id,
    });
    expect(res.status).toBe(200);
    const written = (await res.json()) as FileResponse;
    expect(written.properties["roll20-page"]).toBe("Leuchtturm (neu)");
    expect(written.body).toContain("## Wer ist hier");
    // One transaction, two halves — both are on the stored row.
    const reread = await read(LOCATION);
    expect(reread.properties["roll20-page"]).toBe("Leuchtturm (neu)");
    expect(reread.body).toContain("## Wer ist hier");
    expect(reread.rev).toBeGreaterThan(before.rev);
    // …and the job the proposal came from is discarded with it.
    expect((await app.request(`/api/${CAMPAIGN}/generate/job`)).status).toBe(404);
  });

  test("a scene that MOVES chapter still gets its body — one write, new address", async () => {
    // The proposal changes `chapter`, which is part of a scene's ADDRESS. The
    // body write has to land before the move, or it resolves an address that
    // no longer exists and the whole accept rolls back on a bogus 404.
    const chapterRes = await app.request(`/api/${CAMPAIGN}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Zweites Kapitel", id: "02-umzug" }),
    });
    expect(chapterRes.status).toBe(201);

    const sceneRes = await app.request(`/api/${CAMPAIGN}/scenes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Umzugsszene", chapter: "01-salzhafen", id: "moving-scene" }),
    });
    expect(sceneRes.status).toBe(201);
    const scene = (await sceneRes.json()) as FileResponse;

    const res = await apply({
      path: scene.path,
      rev: scene.rev,
      properties: { chapter: "02-umzug" },
      body: "## Flow\n\nSie ziehen um.\n",
    });
    expect(res.status).toBe(200);
    const written = (await res.json()) as FileResponse;
    // The answer is the FINAL render: the new address, and the new body.
    expect(written.path).toContain("02-umzug/");
    expect(written.body).toContain("Sie ziehen um.");
    const moved = await read(written.path);
    expect(moved.body).toContain("Sie ziehen um.");
    expect(moved.properties.chapter).toBe("02-umzug");
    // …and nothing is left behind at the old address.
    const old = await app.request(
      `/api/${CAMPAIGN}/file?path=${encodeURIComponent(scene.path)}`,
    );
    expect(old.status).toBe(404);
  });

  test("a stale rev is a 409 and writes NOTHING", async () => {
    const before = await read(NPC);
    const res = await apply({
      path: NPC,
      rev: before.rev - 1,
      properties: { voice: "ganz anders" },
      body: "## Will\n\nüberschrieben\n",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("rev_conflict");
    const after = await read(NPC);
    expect(after.body).toBe(before.body);
    expect(after.properties.voice).toBe(before.properties.voice);
    expect(after.rev).toBe(before.rev);
  });

  test("a body-only accept leaves the properties alone", async () => {
    const before = await read(NPC);
    const res = await apply({ path: NPC, rev: before.rev, body: `${before.body}\nNachtrag.\n` });
    expect(res.status).toBe(200);
    const after = await read(NPC);
    expect(after.body).toContain("Nachtrag.");
    expect(after.properties.role).toBe(before.properties.role);
  });

  test("the id can never be accepted", async () => {
    const before = await read(NPC);
    const res = await apply({ path: NPC, rev: before.rev, properties: { id: "andere" } });
    expect(res.status).toBe(400);
  });

  test("an empty accept is a 400", async () => {
    const before = await read(NPC);
    expect((await apply({ path: NPC, rev: before.rev, properties: {} })).status).toBe(400);
  });
});

// --- the naming check (issue #53 AK3, „läuft auch hier") ----------------------

describe("naming check", () => {
  async function setKnowledge(entries: unknown[]): Promise<void> {
    const current = await app.request(`/api/${CAMPAIGN}/knowledge`);
    const { rev } = (await current.json()) as { rev: number };
    const res = await app.request(`/api/${CAMPAIGN}/knowledge`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries, rev }),
    });
    expect(res.status).toBe(200);
  }

  afterEach(async () => {
    await setKnowledge([]);
  });

  test("a proposal that keeps the old spelling is a HINT, never a failure", async () => {
    await setKnowledge([{ kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }]);
    const file = await read(NPC);
    const content = file.raw.replace(
      "## Notizen",
      "> [!secret] Sie kam aus Salt Harbour zurück.\n\n## Notizen",
    );
    useFake([augmentReply(NPC, content)]);
    const job = await runAugmentJob({ path: NPC, instruction: "Hintergrund ergänzen" });
    // The run SUCCEEDED — the check never blocks an augment either.
    expect(job.status).toBe("done");
    const result = job.augmentResult as AugmentResult;
    expect(result.namingHints).toHaveLength(1);
    expect(result.namingHints![0]).toMatchObject({
      from: "Salt Harbour",
      to: "Salzhafen",
      path: NPC,
    });
  });

  test("a list value and a colon in a property do not derail the check", async () => {
    // The proposal document is rendered with the store's frontmatter
    // renderer: `role: Hafenmeisterin: Salt Harbour` and a LIST value used to
    // produce YAML nothing could parse, and every hint then landed on `body`
    // with a line number pointing at nothing.
    await setKnowledge([{ kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }]);
    const file = await read(NPC);
    const content = file.raw
      .replace(
        "role: Auftraggeberin, Hafenmeisterin von Salzhafen",
        "role: \"Hafenmeisterin: Salt Harbour\"\ntags: [hafen, salt harbour]",
      );
    useFake([augmentReply(NPC, content)]);
    const job = await runAugmentJob({ path: NPC, instruction: "Rolle schärfen" });
    expect(job.status).toBe("done");
    const hints = (job.augmentResult as AugmentResult).namingHints ?? [];
    // The hint knows WHICH field it is about — that is only true when the
    // frontmatter parsed.
    expect(hints.map((h) => h.field)).toContain("role");
    expect(hints.every((h) => h.field !== "body")).toBe(true);
  });

  test("a proposal that follows the convention produces no hint", async () => {
    await setKnowledge([{ kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }]);
    const file = await read(NPC);
    useFake([augmentReply(NPC, file.raw.replace("## Notizen", "## Notizen\n\nSalzhafen."))]);
    const job = await runAugmentJob({ path: NPC, instruction: "x" });
    expect(job.status).toBe("done");
    expect((job.augmentResult as AugmentResult).namingHints).toBeUndefined();
  });
});
