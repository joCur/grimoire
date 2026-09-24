// „Mit KI ergänzen" — the augment run.
//
// Same harness as the two create-run suites (generator.test.ts,
// generate-npc.test.ts): a database seeded from the example campaign and a
// FakeProvider with scripted raw replies instead of a real LLM.
//
// What is asserted here is the prompt the run assembles and what it does
// with the reply:
//   * prompt assembly PER KIND — the existing entry travels complete, the
//     campaign knowledge and the glossary travel with it, and each kind gets
//     its own format contract (a location's on its own resource:
//     test/location-augment.test.ts),
//   * the proposal — properties per field with new|changed, body whole,
//   * accepting — ONE transaction with a `rev` guard, and the job gone.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { AugmentResult, EntryResponse, GenerateJob } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generate-jobs";
import {
  ASSET_FILES,
  MAX_CORRECTION_TURNS,
  buildCorrectionMessage,
  campaignRefIds,
  collectContext,
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
import { sceneSystemPrompt } from "../src/generate-pipeline";
import { locationAugmentSystemPrompt } from "../src/location-augment";
import { entryReply, type ScriptedEntry } from "./support/pipeline-fake";
import { parseEntryReply } from "../src/entry-reply";
import { propertyFieldsFor } from "@grimoire/shared";
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
import { entriesUrl } from "./support/urls";

const CAMPAIGN = "beispiel";
const NPC = "npcs/jorna";
const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

/** The ids a `[[id]]` may name: the seeded campaign's npcs, locations and scenes. */
async function refIds(): Promise<Set<string>> {
  return campaignRefIds(await collectContext(CAMPAIGN));
}

async function read(rel: string): Promise<EntryResponse> {
  const res = await app.request(entriesUrl(CAMPAIGN, rel));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
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

/**
 * The reply object: the whole entry as it should look afterwards — properties
 * and body — plus the warnings. Written from the ENTRY a case describes,
 * because that is how a test says what the run proposes in one literal
 * (support/pipeline-fake `entryReply`).
 *
 * The `path` argument stays in the signature — every caller names the entry it
 * is about, and the ASSERTION that the model does not address anything is
 * that the path never reaches the reply.
 */
function augmentReply(
  _path: string,
  content: ScriptedEntry,
  warnings: string[] = [],
): string {
  return entryReply(content, warnings, "npc");
}

/** The stored entry as a scripted reply would carry it, with `over` applied. */
function proposal(
  stored: EntryResponse,
  over: { properties?: Record<string, unknown>; body?: string } = {},
): ScriptedEntry {
  return {
    properties: { ...stored.properties, ...over.properties },
    body: over.body ?? stored.body,
  };
}

/** Start a run and wait for the job to leave `running`. */
async function runAugmentJob(body: Record<string, unknown>): Promise<GenerateJob> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/generate/augment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(202);
  for (let i = 0; i < 200; i += 1) {
    const jobRes = await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`);
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

// --- prompt assembly per kind ----------------------------------------------

/**
 * One numbered rule's own text, from its bold label to the start of the NEXT
 * rule (or the next section). The list position differs per prompt — rule 10
 * in one, 12 in another — so the NUMBER is deliberately not part of what is
 * compared; the wording is.
 */
function ruleParagraph(doc: string, label: string): string {
  const rest = doc.slice(doc.indexOf(label));
  const next = rest.search(/\n(?:\d+\.\s|\n|## )/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("prompt assembly", () => {
  test("carries the existing entry, the instruction, knowledge and glossary", () => {
    const prompt = buildPrompt({
      systemPrompt: "SYS",
      fewShotTarget: "FEWSHOT",
      knowledge: "- Salzhafen heißt immer Salzhafen",
      glossary: "cove → Bucht",
      context: { npcs: [{ id: "jorna", name: "Jorna" }], locations: [] },
      sourceText: "A spy among the smugglers.",
      existingEntry: {
        path: NPC,
        kind: "npc",
        properties: { id: "jorna" },
        body: "## Will\n\nX\n",
      },
      instruction: "Führe einen Handlungsstrang um den Spitzel ein",
    });
    expect(prompt).toContain(EXISTING_ENTRY_HEADING);
    expect(prompt).toContain(`(${NPC})`);
    expect(prompt).toContain('"id": "jorna"');
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

  test("the existing entry stands in the prompt in the REPLY shape", async () => {
    const stored = await read(NPC);
    const prompt = buildPrompt({
      systemPrompt: "SYS",
      fewShotTarget: "FEWSHOT",
      knowledge: "",
      glossary: "",
      context: { npcs: [], locations: [] },
      sourceText: "",
      existingEntry: {
        path: NPC,
        kind: "npc",
        properties: stored.properties,
        body: stored.body,
      },
      instruction: "Ergänze einen Handlungsstrang",
    });
    // `quickstats` is a mapping in the store and a `{ key, value }` LIST in a
    // reply — the model is shown the shape it has to write back, values
    // verbatim, and never the stored mapping it would otherwise imitate into
    // a reply its own schema rejects.
    expect(prompt).toContain('"quickstats": [');
    expect(prompt).toContain('"key": "insight"');
    expect(prompt).toContain('"value": 2');
    expect(prompt).not.toContain('"insight": 2');
    // Everything else is the entry as it is stored.
    expect(prompt).toContain('"name": "Hafenmeisterin Jorna"');
  });

  test("a run with only an instruction has no Quelltext section", () => {
    const prompt = buildPrompt({
      systemPrompt: "SYS",
      fewShotTarget: "FEWSHOT",
      knowledge: "",
      glossary: "",
      context: { npcs: [], locations: [] },
      sourceText: "",
      existingEntry: { path: NPC, kind: "npc", properties: { id: "jorna" }, body: "" },
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
    const scene = await augmentSystemPrompt("scene");
    for (const prompt of [npc, scene]) {
      expect(prompt).toContain("Die Ergänzungsregel");
      expect(prompt).toContain("Vorhandenes bleibt Wort für Wort stehen");
      // The output format is the reply OBJECT, and the
      // augmentation rule is what makes it the whole entry rather than a patch.
      expect(prompt).toContain("Du antwortest mit **einem JSON-Objekt**");
      expect(prompt).toContain("immer den **ganzen** Eintrag");
    }
    expect(npc).toContain("System-Prompt: NPC-Generator");
    expect(scene).toContain("System-Prompt: Szenen-Generator");
    expect(scene).toContain("## If:");
  });

  test("only ONE output schema travels — the create runs' is sliced off", async () => {
    for (const kind of ["npc", "scene"] as const) {
      const prompt = await augmentSystemPrompt(kind);
      // The augment output format…
      expect(prompt).toContain("immer den **ganzen** Eintrag");
      // …and no JSON at all.
      expect(prompt).not.toContain("JSON-Block");
      expect(prompt).not.toContain('"scenes"');
      // Exactly one „## Ausgabeformat" heading: the augmentation rule's own.
      expect(prompt.split("## Ausgabeformat").length - 1).toBe(1);
      // The format of the entry itself is still there.
      expect(prompt).toContain("## Eigenschaften und Text des Eintrags");
    }
  });

  // The German-orthography rule. It has to reach EVERY assembled
  // prompt kind and exactly once — the create prompts carry it under
  // „## Regeln", which `formatContract` slices off, so the augment kinds get
  // it from augment-system-prompt.md instead. Once means once: a rule the
  // model meets twice in slightly different company is a rule it can weigh.
  const ORTHOGRAPHY_RULE = "**Deutsche Orthografie**";

  test("every prompt kind carries the orthography rule exactly once", async () => {
    const assembled: Array<[string, string]> = [
      ["scene", await loadAsset(ASSET_FILES.scene.systemPrompt)],
      ["npc", await loadAsset(ASSET_FILES.npc.systemPrompt)],
      ["augment/npc", await augmentSystemPrompt("npc")],
      ["augment/scene", await augmentSystemPrompt("scene")],
      // The two further prompt kinds: the outline step, and the
      // scene prompt in „genau eine Szene aus der Gliederung" mode. The
      // single-scene mode is an output-schema SWAP, not a second prompt file,
      // so that these rules keep travelling exactly once.
      ["outline", await loadAsset(ASSET_FILES.outline.systemPrompt)],
      ["scene/single", await sceneSystemPrompt()],
    ];
    for (const [kind, prompt] of assembled) {
      expect(prompt.split(ORTHOGRAPHY_RULE).length - 1, kind).toBe(1);
      // The wording is the contract, not just the label.
      expect(prompt, kind).toContain("ä, ö, ü und ß stehen als genau diese Zeichen");
      expect(prompt, kind).toContain("`id`-Werte und Adressen/Pfade");
    }
    // …and it is the SAME sentence everywhere: one rule, every prompt. (A
    // location's prompts name the location's own fields in it:
    // test/location-augment.test.ts.)
    const wordings = new Set(assembled.map(([, doc]) => ruleParagraph(doc, ORTHOGRAPHY_RULE)));
    expect(wordings.size).toBe(1);
  });

  test("the few-shot replies show umlauts in properties AND body", async () => {
    // The few-shots are REPLY OBJECTS, so the check reads
    // them as such: the properties mapping and the body string, each in real
    // German spelling — the model imitates what it reads.
    for (const kind of ["scene", "npc"] as const) {
      const reply = JSON.parse(await loadAsset(ASSET_FILES[kind].fewShotTarget)) as {
        properties: Record<string, unknown>;
        body: string;
        warnings: string[];
      };
      expect(JSON.stringify(reply.properties), `${kind} properties`).toMatch(/[äöüß]/);
      expect(reply.body, `${kind} body`).toMatch(/[äöüß]/);
      expect(Array.isArray(reply.warnings), `${kind} warnings`).toBe(true);
      // No properties block in the body: the block is the server's.
      expect(reply.body.startsWith("---"), `${kind} body`).toBe(false);
    }
  });

  test("the few-shot replies name EVERY key of their kind and pass the reader", async () => {
    // Strict mode has no optional properties: the schema asks for every field
    // and `null` is how a model says „nicht gegeben" (system-prompt.md). A
    // few-shot that simply omits a key teaches the opposite of the schema,
    // and the model imitates what it reads — so the examples show
    // the convention, `null` included.
    for (const kind of ["scene", "npc"] as const) {
      const raw = await loadAsset(ASSET_FILES[kind].fewShotTarget);
      const reply = JSON.parse(raw) as { properties: Record<string, unknown> };
      for (const field of propertyFieldsFor(kind) ?? []) {
        expect(Object.hasOwn(reply.properties, field.key), `${kind}.${field.key}`).toBe(true);
      }
      // …and the whole example is a reply the server can read as it stands.
      expect(parseEntryReply(raw, kind).ok, kind).toBe(true);
    }
  });

  // The table rule, carried the same way for the same reason —
  // once per assembled prompt kind, augment included. The renderer takes
  // TABLES from GFM and nothing else, so the prompt has to say both halves:
  // what a table looks like, and that the rest of GFM is plain text.
  const TABLE_RULE = "**Tabellen**";

  test("every prompt kind that writes entries carries the table rule once", async () => {
    const assembled: Array<[string, string]> = [
      ["scene", await loadAsset(ASSET_FILES.scene.systemPrompt)],
      ["npc", await loadAsset(ASSET_FILES.npc.systemPrompt)],
      ["location", await loadAsset(ASSET_FILES.location.systemPrompt)],
      ["augment/npc", await augmentSystemPrompt("npc")],
      ["augment/location", await locationAugmentSystemPrompt()],
      ["augment/scene", await augmentSystemPrompt("scene")],
      // The scene prompt in „genau eine Szene aus der Gliederung" mode
      // — an output-schema SWAP, not a second prompt file, so
      // that these rules keep travelling exactly once.
      ["scene/single", await sceneSystemPrompt()],
    ];
    for (const [kind, prompt] of assembled) {
      expect(prompt.split(TABLE_RULE).length - 1, kind).toBe(1);
      // The FORM is the contract: header row, delimiter row, edge pipes.
      expect(prompt, kind).toContain("GFM-Pipe-Tabelle");
      expect(prompt, kind).toContain("`|---|`");
      expect(prompt, kind).toContain("Rand-Pipes");
      // …and the boundary: tables only.
      expect(prompt, kind).toContain("**Aus GFM nutzt\n   du ausschließlich diese Pipe-Tabelle**");
      expect(prompt, kind).toContain("Aufgabenlisten (`- [x]`)");
    }
    const wordings = new Set(assembled.map(([, doc]) => ruleParagraph(doc, TABLE_RULE)));
    expect(wordings.size).toBe(1);

    // The OUTLINE prompt does NOT carry it: that call writes no entry at
    // all — no callouts, no properties, no tables — so the rule was a rule
    // about nothing, and a rule the model cannot apply is one it can weigh
    // against the rules it can (the reason the "exactly once" above exists).
    const outline = await loadAsset(ASSET_FILES.outline.systemPrompt);
    expect(outline).not.toContain(TABLE_RULE);
    // The orthography rule stays, because the outline DOES write text: titles,
    // one-liners and `warnings`.
    expect(outline).toContain(ORTHOGRAPHY_RULE);
  });

  // Every entry prompt describes the REPLY OBJECT, and the
  // wording is load-bearing in the same way the rules above are — the schema
  // forces the shape, the prompt is what makes the model understand what goes
  // where (that `body` is one string, that an unknown field is `null`, that
  // the properties block is the server's).
  const OBJECT_RULE = "Du antwortest mit **einem JSON-Objekt**";

  test("every entry prompt kind describes the reply object, once", async () => {
    const assembled: Array<[string, string]> = [
      ["scene/single", await sceneSystemPrompt()],
      ["npc", await loadAsset(ASSET_FILES.npc.systemPrompt)],
      ["augment/npc", await augmentSystemPrompt("npc")],
      ["augment/scene", await augmentSystemPrompt("scene")],
    ];
    for (const [kind, prompt] of assembled) {
      expect(prompt.split(OBJECT_RULE).length - 1, kind).toBe(1);
      // The three keys, and the two things a model gets wrong without them.
      expect(prompt, kind).toContain("`properties`");
      expect(prompt, kind).toContain("`body`");
      expect(prompt, kind).toContain("`warnings`");
      expect(prompt, kind).toContain("Der Server speichert sie genau so");
      // No trace of the raw-entry format.
      expect(prompt, kind).not.toContain("---warnings---");
    }
    // The SAME description everywhere — one shape, every entry prompt.
    const wordings = new Set(assembled.map(([, doc]) => ruleParagraph(doc, OBJECT_RULE)));
    expect(wordings.size).toBe(1);

    // The outline prompt describes its OWN object, so it must not carry this
    // one: two output schemas in one prompt is the contradiction the augment
    // run's `formatContract` exists to avoid.
    const outline = await loadAsset(ASSET_FILES.outline.systemPrompt);
    expect(outline).not.toContain(OBJECT_RULE);
  });

  test("the correction turn names the schema it wants corrected", () => {
    const entry = buildCorrectionMessage(
      ["scene: id fehlt"],
      "die Szene enthalten",
      "scene",
    );
    expect(entry).toContain("korrigierten JSON-Objekt");
    expect(entry).toContain("gleiches Schema (`scene`)");
    expect(entry).toContain("kein Text außerhalb des Objekts");
    // Without a schema (a provider that forces nothing) the sentence still
    // reads — it just has no name to point at.
    const bare = buildCorrectionMessage(["outline: leer"], "alle Szenen");
    expect(bare).toContain("gleiches Schema,");
  });

  test("the scene few-shot shows a table inside a callout", async () => {
    // Described is not shown: the model gets one worked example of the form
    // it has to produce, `>` markers included.
    const reply = JSON.parse(await loadAsset(ASSET_FILES.scene.fewShotTarget)) as {
      body: string;
    };
    const lines = reply.body.split("\n");
    const delimiter = lines.findIndex((line) => /^>\s*\|\s*-{3,}\s*\|/.test(line));
    expect(delimiter).toBeGreaterThan(0);
    // The row above it is the header row, and both carry the callout marker.
    expect(lines[delimiter - 1]).toMatch(/^>\s*\|.*\|\s*$/);
    expect(lines[delimiter + 1]).toMatch(/^>\s*\|.*\|\s*$/);
  });

  test("a prompt without the format heading travels whole", () => {
    expect(formatContract("# Titel\n\n## Regeln\n\nnichts\n")).toContain("## Regeln");
  });

  test("the run sends the kind's own system prompt and few-shot", async () => {
    const stored = await read(NPC);
    const content = proposal(stored, {
      body: `${stored.body}\n## Weiß\n\n- nichts Neues\n`,
    });
    const fake = useFake([augmentReply(NPC, content)]);
    await runAugmentJob({ path: NPC, instruction: "Ergänze, was sie weiß" });
    const req = fake.calls[0]!.req;
    expect(req.systemPrompt).toContain("System-Prompt: NPC-Generator");
    expect(req.fewShotTarget).toContain('"properties"');
    expect(req.existingEntry?.path).toBe(NPC);
    expect(req.existingEntry?.properties.status).toBeString();
    // An npc run has no target chapter in the context…
    expect(req.context.chapter).toBeUndefined();
  });

  test("an address that names a location is no augment target — 404", async () => {
    const res = await app.request(`/api/campaigns/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "locations/leuchtturm", instruction: "x" }),
    });
    expect(res.status).toBe(404);
  });

  test("a scene run carries its chapter in the context", async () => {
    const stored = await read(SCENE);
    const fake = useFake([augmentReply(SCENE, proposal(stored))]);
    await runAugmentJob({ path: SCENE, instruction: "nichts ändern" });
    expect(fake.calls[0]!.req.context.chapter).toBe("01-salzhafen");
  });
});

// --- the proposal -----------------------------------------------------------

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

  test("a changed id is rejected — it is the reference key", async () => {
    const stored = await read(NPC);
    const outcome = validateAugmentReply(
      augmentReply(NPC, proposal(stored, { properties: { id: "jorna-die-hafenmeisterin" } })),
      { kind: "npc", stored },
      await refIds(),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.join(" ")).toContain("die id bleibt");
  });

  test("an unknown callout is a correction turn, a known one is not", async () => {
    const stored = await read(NPC);
    const bad = validateAugmentReply(
      augmentReply(NPC, proposal(stored, { body: `${stored.body}\n> [!spoiler] nope\n` })),
      { kind: "npc", stored },
      await refIds(),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toContain("[!spoiler]");
    const good = validateAugmentReply(
      augmentReply(NPC, proposal(stored, { body: `${stored.body}\n> [!note] fine\n` })),
      { kind: "npc", stored },
      await refIds(),
    );
    expect(good.ok).toBe(true);
  });

  test("an added [[id]] must name an entry — wherever it stands in the body", async () => {
    const stored = await read(NPC);
    const bad = validateAugmentReply(
      augmentReply(NPC, proposal(stored, { body: `${stored.body}\nSie misstraut [[niemand]].\n` })),
      { kind: "npc", stored },
      await refIds(),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toHaveLength(1);
      expect(bad.errors[0]).toContain("[[niemand]] nennt keinen Eintrag");
    }
    // An npc, a location and a scene of the campaign all resolve; a slug in
    // code is literal text and not a reference at all.
    const good = validateAugmentReply(
      augmentReply(
        NPC,
        proposal(stored, {
          body:
            `${stored.body}\n[[fenn]] am [[leuchtturm]], danach [[smuggler-captured]].\n` +
            "Im Log steht `[[niemand]]`.\n",
        }),
      ),
      { kind: "npc", stored },
      await refIds(),
    );
    expect(good.ok).toBe(true);
  });

  test("a reference the stored body already carries is the DM's, not the run's", async () => {
    // The augmentation rule tells the model to keep what stands there, so a
    // dangling reference the DM wrote must not cost a correction turn the
    // model can only pass by deleting it.
    const current = await read(NPC);
    const stored = { ...current, body: `${current.body}\nVielleicht [[der-fremde]].\n` };
    const outcome = validateAugmentReply(
      augmentReply(NPC, proposal(stored, { body: `${stored.body}\n> [!note] Neu.\n` })),
      { kind: "npc", stored },
      await refIds(),
    );
    expect(outcome.ok).toBe(true);
  });

  test("a scene keeps the status the DM gave it", async () => {
    const stored = await read(SCENE);
    expect(stored.properties.status).toBe("ready");
    const outcome = validateAugmentReply(
      augmentReply(SCENE, proposal(stored)),
      { kind: "scene", stored },
      await refIds(),
    );
    expect(outcome.ok).toBe(true);
    // `ready` is not `draft` and must not be reported as a change at all.
    if (outcome.ok) {
      expect(outcome.result.properties.some((p) => p.key === "status")).toBe(false);
    }
  });

  test("an npc status the reply leaves out becomes a visible \"unknown\" proposal", async () => {
    // `status` is nullable in the schema, so a reply may omit it — and the
    // npc rule („present, and one of NPC_STATUSES") must not fail such a
    // reply. It reads as `unknown`, the same degrade a status-less npc has
    // always had, and the DM sees it as a CHANGED field in the review rather
    // than as a silent overwrite or a dead run.
    const stored = await read(NPC);
    expect(stored.properties.status).toBe("alive");
    const withoutStatus = proposal(stored);
    delete withoutStatus.properties.status;
    const outcome = validateAugmentReply(
      augmentReply(NPC, withoutStatus),
      { kind: "npc", stored },
      await refIds(),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const status = outcome.result.properties.find((p) => p.key === "status");
      expect(status).toEqual({
        key: "status",
        current: "alive",
        proposed: "unknown",
        state: "changed",
      });
    }
  });

  test("a key the kind does not have is an echo, not a failed run", async () => {
    // The DM may have hand-written a key the schema has no field for
    // (`roll20-page` on an npc). The model is SHOWN the whole entry, so it
    // echoes the key back — and the run must not die on that: the key cannot
    // be proposed anyway, and the proposal patches only the keys it lists, so
    // the value the DM authored keeps standing.
    const stored = await read(NPC);
    const outcome = validateAugmentReply(
      augmentReply(NPC, proposal(stored, { properties: { "roll20-page": "Jorna" } })),
      { kind: "npc", stored },
      await refIds(),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.properties.some((p) => p.key === "roll20-page")).toBe(false);
    }
  });
});

// --- the run and its job ------------------------------------------------------

describe("the job", () => {
  test("a run answers 202 and leaves an augment job with the proposal", async () => {
    const stored = await read(NPC);
    const content = proposal(stored, {
      body: `${stored.body}\n> [!secret] Der Spitzel sitzt in der Hafenwache.\n`,
    });
    useFake([augmentReply(NPC, content, ["Neuer Handlungsstrang ergänzt"])]);
    const job = await runAugmentJob({ path: NPC, instruction: "Spitzel einführen" });
    expect(job.status).toBe("done");
    expect(job.kind).toBe("augment");
    expect(job.target).toBe(NPC);
    const result = job.augmentResult as AugmentResult;
    expect(result.path).toBe(NPC);
    expect(result.kind).toBe("npc");
    expect(result.rev).toBe(stored.rev);
    expect(result.currentBody).toBe(stored.body);
    expect(result.proposedBody).toContain("Der Spitzel sitzt in der Hafenwache");
    expect(result.warnings).toEqual(["Neuer Handlungsstrang ergänzt"]);
    // Nothing is written by a run.
    expect((await read(NPC)).body).toBe(stored.body);
  });

  test("an unknown [[id]] in the proposal costs one correction turn", async () => {
    const stored = await read(NPC);
    const bad = augmentReply(
      NPC,
      proposal(stored, { body: `${stored.body}\nDer Spitzel ist [[der-spitzel]].\n` }),
    );
    const good = augmentReply(
      NPC,
      proposal(stored, { body: `${stored.body}\nDer Spitzel sitzt in der Hafenwache.\n` }),
    );
    const fake = useFake([bad, good]);
    const job = await runAugmentJob({ path: NPC, instruction: "Spitzel einführen" });
    expect(job.status).toBe("done");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]!.assistant).toBe(bad);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("[[der-spitzel]]");
    const result = job.augmentResult as AugmentResult;
    expect(result.proposedBody).toContain("Der Spitzel sitzt in der Hafenwache.");
    expect(result.proposedBody).not.toContain("[[der-spitzel]]");
  });

  test("a reply that is not the object comes back as a correction turn", async () => {
    const stored = await read(NPC);
    const fake = useFake([
      "## Will\n\nkein Objekt des Schemas\n",
      augmentReply(NPC, proposal(stored)),
    ]);
    const job = await runAugmentJob({ path: NPC, instruction: "x" });
    expect(job.status).toBe("done");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]?.correction).toContain("ergänzten Eintrag");
  });

  test("neither source text nor instruction is a 400, before a job exists", async () => {
    const res = await app.request(`/api/campaigns/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: NPC, sourceText: "  " }),
    });
    expect(res.status).toBe(400);
    expect((await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).status).toBe(404);
  });

  test("a kind without an augment prompt is a 400", async () => {
    const res = await app.request(`/api/campaigns/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "01-salzhafen", instruction: "x" }),
    });
    expect(res.status).toBe(400);
  });

  test("an unknown entry is a 404", async () => {
    const res = await app.request(`/api/campaigns/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "npcs/nobody", instruction: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("one job per campaign, whatever its kind", () => {
  async function jobStatus(): Promise<number> {
    return (await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).status;
  }

  test("an augment start while a SCENE run is going is a 409", async () => {
    setProviderForTests(new StuckProvider());
    const scene = await app.request(`/api/campaigns/${CAMPAIGN}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapter: "01-salzhafen", sourceText: "source" }),
    });
    expect(scene.status).toBe(202);
    const res = await app.request(`/api/campaigns/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: NPC, instruction: "x" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).jobId).toBeString();
  });

  test("a SCENE start while an augment run is going is a 409", async () => {
    setProviderForTests(new StuckProvider());
    const augment = await app.request(`/api/campaigns/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: NPC, instruction: "x" }),
    });
    expect(augment.status).toBe(202);
    const res = await app.request(`/api/campaigns/${CAMPAIGN}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapter: "01-salzhafen", sourceText: "source" }),
    });
    expect(res.status).toBe(409);
    // …and so is a second augment run.
    const again = await app.request(`/api/campaigns/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: SCENE, instruction: "x" }),
    });
    expect(again.status).toBe(409);
  });

  test("Vorschlag verwerfen discards a finished augment job", async () => {
    const stored = await read(NPC);
    useFake([augmentReply(NPC, proposal(stored))]);
    await runAugmentJob({ path: NPC, instruction: "x" });
    expect(await jobStatus()).toBe(200);
    const res = await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await jobStatus()).toBe(404);
    // Nothing was written by the run, and nothing by the reject.
    expect((await read(NPC)).rev).toBe(stored.rev);
  });

  test("a leftover `running` augment row becomes a failed job at the next boot", async () => {
    setProviderForTests(new StuckProvider());
    const started = await app.request(`/api/campaigns/${CAMPAIGN}/generate/augment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: NPC, instruction: "x" }),
    });
    expect(started.status).toBe(202);

    // What the next boot does with the row the dead process left behind.
    expect(failInterruptedJobs(await getDb())).toBe(1);

    const job = (await (await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).json()) as GenerateJob;
    expect(job.kind).toBe("augment");
    expect(job.target).toBe(NPC);
    expect(job.status).toBe("failed");
    expect(job.error?.body.code).toBe("job_restarted");
  });

  test("the proposal round-trips through the job row", async () => {
    const stored = await read(NPC);
    // A CHANGED field, so the proposal has something to carry through the
    // row. A key the SCHEMA does not have (a `tags` on an npc) cannot be
    // proposed at all — and cannot be lost either, it simply
    // keeps the value it has.
    const content = proposal(stored, {
      properties: { voice: "knapp, wetterrau — duzt auch den Ratsherrn" },
    });
    useFake([augmentReply(NPC, content, ["geprüft"])]);
    const started = await runAugmentJob({ path: NPC, instruction: "x" });

    // Re-read from the ROW (a fresh request is a fresh `toJob`), not from the
    // object the start returned.
    const job = (await (await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).json()) as GenerateJob;
    expect(job.id).toBe(started.id);
    expect(job.augmentResult).toEqual(started.augmentResult as AugmentResult);
    const result = job.augmentResult as AugmentResult;
    expect(result.properties.find((p) => p.key === "voice")?.proposed).toBe(
      "knapp, wetterrau — duzt auch den Ratsherrn",
    );
    expect(result.warnings).toEqual(["geprüft"]);
    expect(result.rev).toBe(stored.rev);
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

// --- the entry as the prompt shows it ----------------------------------------

/**
 * A provider that answers with EXACTLY the entry its own prompt showed it,
 * plus one new section — the model that imitates what it reads, which is what
 * both a real model and the E2E stub do.
 *
 * It is the only way to test the prompt and the reader against each other:
 * a scripted reply says what a test believes the prompt contains, while this
 * one reads the prompt the run really assembled.
 */
class EchoingProvider implements LLMProvider {
  readonly name = "echoing";
  shown: Record<string, unknown> = {};
  async complete(req: GenerateRequest): Promise<CompletionResult> {
    const prompt = buildPrompt(req);
    const fence = /```json\n([\s\S]*?)```/.exec(
      prompt.slice(prompt.indexOf(EXISTING_ENTRY_HEADING)),
    );
    if (fence === null) throw new Error("EchoingProvider: the prompt shows no entry");
    const entry = JSON.parse(fence[1]!) as { properties: Record<string, unknown>; body: string };
    this.shown = entry.properties;
    return {
      text: JSON.stringify({
        properties: entry.properties,
        body: `${entry.body}\n## If: Jorna wird misstrauisch\n\nSie schickt den Lotsen vor.\n`,
        warnings: [],
      }),
      truncated: false,
    };
  }
}

describe("an entry whose stored shape differs from the reply shape", () => {
  test("jorna's quickstats survive prompt, reply and accept", async () => {
    const stored = await read(NPC);
    expect(stored.properties.quickstats).toEqual({ insight: 2, "passive-perception": 12 });
    const provider = new EchoingProvider();
    setProviderForTests(provider);

    const job = await runAugmentJob({ path: NPC, instruction: "Handlungsstrang ergänzen" });
    // The reply is the shown properties, verbatim — so a run that fails here
    // failed on the SHAPE the prompt showed, which is the whole case.
    expect(job.error?.body.code).toBeUndefined();
    expect(job.status).toBe("done");
    // The prompt shows the reply's pair LIST, never the stored mapping.
    expect(provider.shown.quickstats).toEqual([
      { key: "insight", value: 2 },
      { key: "passive-perception", value: 12 },
    ]);

    const result = job.augmentResult as AugmentResult;
    expect(result.proposedBody).toContain("## If: Jorna wird misstrauisch");
    // Read back into the stored shape, the echo IS the stored value — so the
    // proposal has nothing to say about `quickstats`.
    expect(result.properties.map((p) => p.key)).not.toContain("quickstats");

    const res = await app.request(`/api/campaigns/${CAMPAIGN}/generate/augment/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: NPC,
        rev: stored.rev,
        body: result.proposedBody,
        jobId: job.id,
      }),
    });
    expect(res.status).toBe(200);
    const written = await read(NPC);
    expect(written.properties.quickstats).toEqual({ insight: 2, "passive-perception": 12 });
    expect(written.body).toContain("## If: Jorna wird misstrauisch");
    expect(written.body).toContain("## Weiß");
    expect(written.properties.motivation).toBe(stored.properties.motivation);
  });
});

// --- accepting -----------------------------------------------------------------

describe("accept", () => {
  async function apply(body: Record<string, unknown>): Promise<Response> {
    return app.request(`/api/campaigns/${CAMPAIGN}/generate/augment/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("properties and body land in ONE write, and the job is gone", async () => {
    const before = await read(NPC);
    useFake([augmentReply(NPC, proposal(before))]);
    const job = await runAugmentJob({ path: NPC, instruction: "x" });

    const body = `${before.body}\n## Weiß\n\n- mehr als sie sagt\n`;
    const res = await apply({
      path: NPC,
      rev: before.rev,
      properties: { voice: "Knapp, mit Hafenakzent (neu)" },
      body,
      jobId: job.id,
    });
    expect(res.status).toBe(200);
    const written = (await res.json()) as EntryResponse;
    expect(written.properties.voice).toBe("Knapp, mit Hafenakzent (neu)");
    expect(written.body).toContain("- mehr als sie sagt");
    // One transaction, two halves — both are on the stored row.
    const reread = await read(NPC);
    expect(reread.properties.voice).toBe("Knapp, mit Hafenakzent (neu)");
    expect(reread.body).toContain("- mehr als sie sagt");
    expect(reread.rev).toBeGreaterThan(before.rev);
    // …and the job the proposal came from is discarded with it.
    expect((await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).status).toBe(404);
  });

  test("a scene that MOVES chapter still gets its body — one write, new address", async () => {
    // The proposal changes `chapter`, which is part of a scene's ADDRESS. The
    // body write has to land before the move, or it resolves an address that
    // no longer exists and the whole accept rolls back on a bogus 404.
    const chapterRes = await app.request(`/api/campaigns/${CAMPAIGN}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Zweites Kapitel", id: "02-umzug" }),
    });
    expect(chapterRes.status).toBe(201);

    const sceneRes = await app.request(`/api/campaigns/${CAMPAIGN}/scenes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Umzugsszene", chapter: "01-salzhafen", id: "moving-scene" }),
    });
    expect(sceneRes.status).toBe(201);
    const scene = (await sceneRes.json()) as EntryResponse;

    const res = await apply({
      path: scene.path,
      rev: scene.rev,
      properties: { chapter: "02-umzug" },
      body: "## Flow\n\nSie ziehen um.\n",
    });
    expect(res.status).toBe(200);
    const written = (await res.json()) as EntryResponse;
    // The answer is the FINAL render: the new address, and the new body.
    expect(written.path).toContain("02-umzug/");
    expect(written.body).toContain("Sie ziehen um.");
    const moved = await read(written.path);
    expect(moved.body).toContain("Sie ziehen um.");
    expect(moved.properties.chapter).toBe("02-umzug");
    // …and the old address is a STALE address, not a dead one:
    // it still names the scene and answers with the one it has now, which is
    // what lets the app replace the URL instead of showing a 404.
    const old = await app.request(
      entriesUrl(CAMPAIGN, scene.path),
    );
    expect(old.status).toBe(200);
    expect(((await old.json()) as EntryResponse).path).toBe(written.path);
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

// --- the naming check („läuft auch hier") -------------------------------------

describe("naming check", () => {
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

  afterEach(async () => {
    await setKnowledge([]);
  });

  test("a proposal that keeps the old spelling is a HINT, never a failure", async () => {
    await setKnowledge([{ kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }]);
    const stored = await read(NPC);
    const content = proposal(stored, {
      body: `${stored.body}\n> [!secret] Sie kam aus Salt Harbour zurück.\n`,
    });
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

  test("a colon inside a property value does not derail the check", async () => {
    // The check reads the proposal's properties as VALUES, so a `role` that
    // contains ": " is a role — nothing renders or parses it on the way, and
    // the hint lands on the FIELD it is about instead of on `body` with a
    // line number pointing at nothing.
    await setKnowledge([{ kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }]);
    const stored = await read(NPC);
    const content = proposal(stored, {
      properties: { role: "Hafenmeisterin: Salt Harbour" },
    });
    useFake([augmentReply(NPC, content)]);
    const job = await runAugmentJob({ path: NPC, instruction: "Rolle schärfen" });
    expect(job.status).toBe("done");
    const hints = (job.augmentResult as AugmentResult).namingHints ?? [];
    // The hint knows WHICH field it is about — that is only true when the
    // properties block parsed.
    expect(hints.map((h) => h.field)).toContain("role");
    expect(hints.every((h) => h.field !== "body")).toBe(true);
  });

  test("a proposal that follows the convention produces no hint", async () => {
    await setKnowledge([{ kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }]);
    const stored = await read(NPC);
    useFake([
      augmentReply(
        NPC,
        proposal(stored, {
          body: `${stored.body}\nSalzhafen.\n`,
        }),
      ),
    ]);
    const job = await runAugmentJob({ path: NPC, instruction: "x" });
    expect(job.status).toBe("done");
    expect((job.augmentResult as AugmentResult).namingHints).toBeUndefined();
  });
});
