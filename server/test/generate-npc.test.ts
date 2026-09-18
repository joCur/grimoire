// NPC generator tests. Same harness as the scene pipeline tests
// (generator.test.ts): a database seeded from the example campaign — once for
// this file, because cases build on what an earlier one applied — and a
// FakeProvider with scripted raw replies instead of a real LLM. Since the
// database cutover an applied draft is a ROW, so "was it written?" is asked
// through the API.
//
// What is asserted here: the NPC run uses the SAME mechanics as the scene run
// (correction turns, truncation fail-fast, usage summing, JSON extraction,
// one job per campaign) with its own prompt assets, its own context (no
// chapter) and its own validation rules.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type {
  EntryResponse,
  GenerateJob,
  GenerateNpcResult,
  GenerateUsage,
} from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generate-jobs";
import { setProviderForTests } from "../src/generator";
import { entryReply, type ScriptedEntry } from "./support/pipeline-fake";
import { dropStore, seedStore } from "./support/store";
import type {
  CompletionResult,
  CorrectionTurn,
  GenerateRequest,
  LLMProvider,
  TokenUsage,
} from "../src/llm-provider";
import { entriesUrl } from "./support/urls";

/** Whether an entity is there: its address resolves through GET /entry. */
async function exists(rel: string): Promise<boolean> {
  const res = await app.request(entriesUrl("beispiel", rel));
  return res.status === 200;
}

/** GET /entry of an applied draft. */
async function read(rel: string): Promise<EntryResponse> {
  const res = await app.request(entriesUrl("beispiel", rel));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
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
  delete process.env.LLM_CORRECTION_TURNS;
});

// --- fake provider ------------------------------------------------------------

interface RecordedCall {
  req: GenerateRequest;
  corrections: CorrectionTurn[];
}

type ScriptedReply = string | { text: string; truncated?: boolean; usage?: TokenUsage };

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: RecordedCall[] = [];
  constructor(
    private replies: ScriptedReply[],
    readonly maxTokens?: number,
    /** Awaited before the FIRST reply — the "still running" gate. */
    private gate?: Promise<unknown>,
  ) {}

  async complete(
    req: GenerateRequest,
    corrections: CorrectionTurn[] = [],
  ): Promise<CompletionResult> {
    this.calls.push({ req, corrections: corrections.map((c) => ({ ...c })) });
    if (this.gate !== undefined) {
      const gate = this.gate;
      this.gate = undefined;
      await gate;
    }
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error("FakeProvider: no scripted reply left");
    if (typeof reply === "string") return { text: reply, truncated: false };
    return { text: reply.text, truncated: reply.truncated ?? false, usage: reply.usage };
  }
}

function useFake(
  replies: ScriptedReply[],
  maxTokens?: number,
  gate?: Promise<unknown>,
): FakeProvider {
  const fake = new FakeProvider(replies, maxTokens, gate);
  setProviderForTests(fake);
  return fake;
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const usage = (inputTokens: number, outputTokens: number): TokenUsage => ({
  inputTokens,
  outputTokens,
});

// --- fixtures -------------------------------------------------------------------

/** A prompt-conform NPC entry for an npc the example campaign does NOT have. */
function npcDraft(
  over: {
    id?: string;
    name?: string | null;
    status?: string | null;
    chapter?: boolean;
    quickstats?: Record<string, unknown>;
    knowledge?: string;
    relations?: string[];
    notes?: string;
  } = {},
  drop: readonly string[] = [],
): ScriptedEntry {
  const status = over.status === undefined ? "alive" : over.status;
  const name = over.name === undefined ? "Grella" : over.name;
  return without(
    {
      properties: {
        id: over.id ?? "grella",
        ...(name === null ? {} : { name }),
        role: "Schmugglerin mit eigenen Plänen",
        ...(over.chapter === true ? { chapter: "01-salzhafen" } : {}),
        ...(status === null ? {} : { status }),
        statblock: "Roll20: Grella",
        quickstats: over.quickstats ?? { insight: "+3", deception: "+5" },
        voice: "schnell, spöttisch — wird höflich, wenn sie lügt",
        appearance: "geflickter Ölmantel, rußige Finger",
      },
      body: [
        "## Will",
        "",
        "Die Route durch die Nordbucht für sich allein — ohne Fenn.",
        "",
        "## Weiß",
        "",
        over.knowledge ?? "> [!secret] Kennt ein zweites Versteck unter dem Kai.",
        "",
        "## Beziehungen",
        "",
        ...(over.relations ?? ["- [[jorna]]: schuldet ihr einen Gefallen"]),
        "",
        "## Notizen",
        "",
        over.notes ?? "<!-- wird von der App im Review-Schritt befüllt -->",
        "",
      ].join("\n"),
    },
    drop,
  );
}

/** The same draft without the named properties — a reply that omits a key. */
function without(entry: ScriptedEntry, keys: readonly string[]): ScriptedEntry {
  const properties = { ...entry.properties };
  for (const key of keys) delete properties[key];
  return { ...entry, properties };
}

/**
 * The reply object: the entry itself —
 * no address (the server addresses the npc as `npcs/<id>` with the
 * id from the properties). Written from the DRAFT a case describes and
 * turned into the reply object (support/pipeline-fake `entryReply`).
 */
function npcReply(over: { content?: ScriptedEntry; warnings?: string[] } = {}): string {
  const entry = over.content ?? npcDraft();
  const warnings = over.warnings ?? ["Quelltext nennt keinen Status — alive gesetzt"];
  return entryReply(entry, warnings, "npc");
}

/** A reply for a specific id (so a test that WRITES does not collide later). */
function replyFor(id: string, over: Parameters<typeof npcDraft>[0] = {}): string {
  return npcReply({ content: npcDraft({ id, ...over }) });
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

const npcBody = {
  sourceText: "Grella runs her own route through the north cove; she owes Jorna a favour.",
};

// --- job helpers ----------------------------------------------------------------

async function fetchJob(campaign = "beispiel"): Promise<GenerateJob | null> {
  const res = await app.request(`/api/campaigns/${campaign}/generate/job`);
  if (res.status === 404) return null;
  expect(res.status).toBe(200);
  return (await res.json()) as GenerateJob;
}

async function waitForJob(campaign = "beispiel"): Promise<GenerateJob> {
  for (let i = 0; i < 2000; i++) {
    const job = await fetchJob(campaign);
    if (job === null) throw new Error("job disappeared while waiting");
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("job never finished");
}

interface GenerateOutcome {
  status: number;
  json: () => Promise<unknown>;
}

/** Start an NPC run and wait for it — the synchronous view of the job flow. */
async function generateNpc(body?: unknown, campaign = "beispiel"): Promise<GenerateOutcome> {
  const res = await postJson(`/api/campaigns/${campaign}/generate/npc`, body);
  if (res.status !== 202) return { status: res.status, json: () => res.json() };
  expect(await res.json()).toEqual({ jobId: expect.any(String) });
  const job = await waitForJob(campaign);
  if (job.status === "done") return { status: 200, json: async () => job.npcResult };
  return { status: job.error?.status ?? 500, json: async () => job.error?.body };
}

/** The one validation error of a run that ends in a 422 (max turns = 0). */
async function firstValidationError(replies: ScriptedReply[]): Promise<string> {
  process.env.LLM_CORRECTION_TURNS = "0";
  useFake(replies);
  const res = await generateNpc(npcBody);
  expect(res.status).toBe(422);
  const body = (await res.json()) as { validationErrors: string[] };
  expect(body.validationErrors.length).toBeGreaterThan(0);
  return body.validationErrors.join("\n");
}

// --- POST /api/campaigns/:campaign/generate/npc -------------------------------------------

describe("POST /api/campaigns/:campaign/generate/npc", () => {
  test("happy path: GenerateNpcResult from one call, nothing written", async () => {
    const fake = useFake([npcReply()]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateNpcResult;

    expect(result.npc.path).toBe("npcs/grella");
    // The draft is the PAIR the reply carried — the properties in contract
    // order, the body verbatim. Nothing renders it into one text on the way.
    expect(result.npc.properties).toEqual({
      id: "grella",
      name: "Grella",
      role: "Schmugglerin mit eigenen Plänen",
      status: "alive",
      statblock: "Roll20: Grella",
      quickstats: { insight: "+3", deception: "+5" },
      voice: "schnell, spöttisch — wird höflich, wenn sie lügt",
      appearance: "geflickter Ölmantel, rußige Finger",
    });
    expect(result.npc.body).toBe(npcDraft().body);
    expect(result.npc.properties.id).toBe("grella");
    expect(result.npc.properties.name).toBe("Grella");
    expect(result.npc.properties.status).toBe("alive");
    // quoted quickstats survive as strings — the plus is the whole point
    expect(result.npc.properties.quickstats).toEqual({ insight: "+3", deception: "+5" });
    expect(result.warnings).toEqual(["Quelltext nennt keinen Status — alive gesetzt"]);
    expect(result.usage).toBeUndefined();

    // exactly one provider call, no correction turns
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.corrections).toEqual([]);

    // the NPC prompt assets and the campaign context travelled
    const req = fake.calls[0]!.req;
    expect(req.systemPrompt).toContain("System-Prompt: NPC-Generator");
    expect(req.fewShotTarget).toContain('"id": "fenn"');
    expect(req.context.npcs.map((n) => n.id).sort()).toEqual(["fenn", "jorna"]);
    expect(req.context.locations.map((l) => l.id).sort()).toEqual(["bucht", "leuchtturm"]);
    expect(req.glossary).toContain("Leuchtturmwärter");
    // an NPC run has no chapter and (without a pinned id) no target id
    expect(req.context.chapter).toBeUndefined();
    expect(req.context.targetId).toBeUndefined();
    expect(req.sourceText).toBe(npcBody.sourceText);

    // review preview only — NOTHING on disk
    expect(await exists("npcs/grella")).toBe(false);
  });

  test("a pinned id travels in the context and decides the address", async () => {
    const fake = useFake([replyFor("die-krähe")]);
    // an id with an umlaut is not kebab-safe -> 400 before the provider runs
    expect((await generateNpc({ ...npcBody, id: "die-krähe" })).status).toBe(400);
    expect(fake.calls).toHaveLength(0);

    useFake([replyFor("krieger-ohne-namen")]);
    const res = await generateNpc({ ...npcBody, id: "krieger-ohne-namen" });
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateNpcResult;
    expect(result.npc.path).toBe("npcs/krieger-ohne-namen");
  });

  test("a pinned id the model ignores is a correction turn", async () => {
    const bad = replyFor("etwas-anderes");
    const fake = useFake([bad, replyFor("die-graue")]);
    const res = await generateNpc({ ...npcBody, id: "die-graue" });
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.req.context.targetId).toBe("die-graue");
    expect(fake.calls[1]!.corrections[0]!.assistant).toBe(bad);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain('"die-graue"');
    // the correction turn names the NPC entry, not "alle Szenen und Stubs"
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("vollständigen NPC-Eintrag");
  });

  test("an npc reply without an id is a correction turn, not the id npc", async () => {
    // The reply carries NO `id`, and the server addresses an npc by exactly
    // that id — so there is nothing to fall back to and the missing key has
    // to be the error it is.
    const bad = npcReply({ content: npcDraft({}, ["id"]) });
    const fake = useFake([bad, npcReply()]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    const correction = fake.calls[1]!.corrections[0]!.correction;
    expect(correction).toContain('"id" fehlt');
    expect(correction).not.toContain("npcs/npc");
    // …and the accepted reply is addressed by ITS id, as always.
    const result = (await res.json()) as GenerateNpcResult;
    expect(result.npc.path).toBe("npcs/grella");
  });

  // --- the validation rules (each one a correction turn) ------------------------

  test("a relationship to an unknown npc triggers a correction turn, then succeeds", async () => {
    const bad = npcReply({ content: npcDraft({ relations: ["- niemand: alter Feind"] }) });
    const fake = useFake([bad, npcReply()]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections).toHaveLength(1);
    expect(fake.calls[1]!.corrections[0]!.assistant).toBe(bad);
    const correction = fake.calls[1]!.corrections[0]!.correction;
    expect(correction).toContain('npc "niemand" existiert nicht');
    expect(correction).toContain("weglassen statt erfinden");
    // ONE error, not a cascade
    expect(correction.match(/^- /gm)).toHaveLength(1);
    expect(await exists("npcs/grella")).toBe(false);
  });

  test("a relationship line that is not `- [[<npc-id>]]: text` is an error", async () => {
    const errors = await firstValidationError([
      npcReply({ content: npcDraft({ relations: ["- Jorna, die Hafenmeisterin"] }) }),
    ]);
    expect(errors).toContain("ist keine \"- [[<npc-id>]]: <Text>\"-Zeile");
  });

  test("a relationship line without the brackets passes in one turn", async () => {
    // `- [[jorna]]: …` is what the prompt and its few-shot ask for (and what
    // the default fixture above sends), but the check is after the id, not
    // after the brackets: a line that names an existing npc bare is the same
    // statement in the same place and must not come back as a correction.
    const fake = useFake([
      npcReply({ content: npcDraft({ relations: ["- jorna: alte Bekannte"] }) }),
    ]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });

  test("prose inside ## Beziehungen degrades instead of erroring", async () => {
    const fake = useFake([
      npcReply({ content: npcDraft({ relations: ["Keine belegten Beziehungen."] }) }),
    ]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });

  test("an invalid status triggers a correction turn, then succeeds", async () => {
    const bad = npcReply({ content: npcDraft({ status: "draft" }) });
    const fake = useFake([bad, npcReply()]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    const correction = fake.calls[1]!.corrections[0]!.correction;
    expect(correction).toContain("alive, dead, missing, unknown");
    expect(correction).toContain('"alive"');
    expect(correction.match(/^- /gm)).toHaveLength(1);
  });

  test("a MISSING status is read as \"unknown\" — the schema allows null", async () => {
    // `status` is nullable in the reply schema (the prompt's „nicht gegeben →
    // null"), so an absent one is a legal answer and means what a status-less
    // npc entry has always meant: `unknown`. Hard-failing
    // here would make a schema-conform reply cost a correction turn.
    const fake = useFake([npcReply({ content: npcDraft({ status: null }) })]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
    const result = (await res.json()) as GenerateNpcResult;
    expect(result.npc.properties.status).toBe("unknown");
  });

  test("only [!secret] inside ## Weiß — other known callouts elsewhere are fine", async () => {
    const errors = await firstValidationError([
      npcReply({ content: npcDraft({ knowledge: "> [!note] Nur ein DM-Hinweis." }) }),
    ]);
    expect(errors).toContain("## Weiß: nur [!secret] erlaubt");

    // the same callout OUTSIDE the section passes in one call
    const fake = useFake([
      npcReply({
        content: {
          ...npcDraft(),
          body: `${npcDraft().body}\n## Auftreten\n\n> [!note] Grella taucht erst nach der Bucht auf.\n`,
        },
      }),
    ]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });

  test("an unknown callout anywhere is an error", async () => {
    const errors = await firstValidationError([
      npcReply({ content: npcDraft({ knowledge: "> [!danger] Sie lügt immer." }) }),
    ]);
    expect(errors).toContain('unknown callout "[!danger]"');
  });

  test("quickstats travel as key/value pairs — a mapping is a shape error", async () => {
    // The „quote the plus" rule is the SCHEMA's job now: a `pairs` field is a
    // list of `{ key, value }` with string values, and the server folds it
    // into the mapping and renders it quoted (entry-reply.ts). So what a
    // reply can still get wrong is the SHAPE, and that is what it is told.
    const mapping = JSON.stringify({
      properties: { id: "grella", name: "Grella", status: "alive", quickstats: { insight: "+3" } },
      body: "## Will\n\nIhren Anteil.\n",
      warnings: [],
    });
    expect(await firstValidationError([mapping])).toContain(
      '"properties.quickstats" muss eine Liste von { key, value } sein',
    );
  });

  test("an invented chapter and a filled ## Notizen are errors", async () => {
    expect(
      await firstValidationError([npcReply({ content: npcDraft({ chapter: true }) })]),
    ).toContain('kein "chapter"');

    expect(
      await firstValidationError([
        npcReply({ content: npcDraft({ notes: "Sie könnte die Schwester von Fenn sein." }) }),
      ]),
    ).toContain("## Notizen bleibt leer");
  });

  test("an id that is no kebab slug is an error", async () => {
    // The address is the server's; the `id` is what the model decides, so
    // that is what has to be usable as one.
    for (const badId of ["Grella", "grella.txt", "grella/2", "trailing-"]) {
      expect(
        await firstValidationError([npcReply({ content: npcDraft({ id: badId }) })]),
      ).toContain("kebab-case id");
    }
  });

  test("a missing name is a correction turn — the schema requires one", async () => {
    // Until this ticket a nameless reply DEGRADED: the shared parser filled
    // the display name from the address, so `npcs/namenlos` got „namenlos" as
    // its name and nobody was asked. The reply schema requires the field
    // (it is the one the properties dialog requires too), so the model is
    // told instead of the server inventing — the degrade rule stays where it
    // belongs, on the READ path for entries a DM hand-wrote.
    expect(
      await firstValidationError([
        npcReply({ content: npcDraft({ id: "namenlos", name: null }) }),
      ]),
    ).toContain('"properties.name" fehlt');
  });

  test("a reply that is not the reply object is a validation error", async () => {
    // Prose, the raw-entry format this ticket replaced, an empty reply, a
    // JSON value that is not the object: all of them are „das ist kein Objekt
    // des Schemas", and the message says which three keys one has.
    for (const raw of [
      "kein Objekt",
      "## Will\n\nnur Text, kein Objekt\n",
      "",
      JSON.stringify([{ properties: { id: "grella" } }]),
      JSON.stringify({ npc: { content: npcDraft() } }),
    ]) {
      expect(await firstValidationError([raw])).toContain("kein Objekt des Schemas");
    }
  });

  test("a fence and a leading sentence cost ONE call", async () => {
    // An endpoint that accepts `response_format` and ignores it answers the
    // object inside a fence, with a sentence in front. The tolerant reader
    // (parseJsonReply) takes it, and the run costs one call instead of a
    // correction turn.
    const fake = useFake([
      [
        "Hier ist der NPC-Eintrag — ich habe den Status auf alive gesetzt:",
        "",
        "```json",
        npcReply(),
        "```",
      ].join("\n"),
    ]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
    const result = (await res.json()) as GenerateNpcResult;
    // The draft is the reply's own pair, and the warning is the run's — the
    // fence around the reply travels nowhere.
    expect(result.npc.properties.id).toBe("grella");
    expect(result.npc.body).toBe(npcDraft().body);
    expect(result.npc.body).not.toContain("```");
    expect(result.warnings).toEqual(["Quelltext nennt keinen Status — alive gesetzt"]);
  });

  test("an almost-JSON reply is repaired once, with a warning", async () => {
    // A trailing comma is mechanical; `jsonrepair` fixes it deterministically
    // and much more cheaply than a correction turn — and the run SAYS so.
    const fake = useFake([`${npcReply().replace(/}$/, ",}")}`]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
    const result = (await res.json()) as GenerateNpcResult;
    expect(result.npc.properties.id).toBe("grella");
    expect(result.warnings.some((w) => w.includes("repariert"))).toBe(true);
  });

  // --- id collisions -------------------------------------------------------------

  test("a pinned id whose entry exists answers 409 — the provider is never called", async () => {
    const fake = useFake([npcReply()]);
    const res = await generateNpc({ ...npcBody, id: "fenn" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "npc entry already exists",
      path: "npcs/fenn",
    });
    expect(fake.calls).toHaveLength(0);
    // no job was created for a request error
    expect(await fetchJob()).toBeNull();
    // and the existing npc is untouched
    expect((await read("npcs/fenn")).properties.id).toBe("fenn");
  });

  test("an id the MODEL picks that collides is a correction turn, then a 422", async () => {
    const bad = replyFor("fenn");
    const fake = useFake([bad, replyFor("fenn")]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { validationErrors: string[]; rawReply: string };
    expect(body.validationErrors).toEqual([
      expect.stringContaining('id "fenn" existiert schon in der Kampagne'),
    ]);
    // the message points the DM at the way out
    expect(body.validationErrors[0]).toContain('Feld "id"');
    expect(body.rawReply).toBe(bad);
    expect(fake.calls).toHaveLength(2);
  });

  // --- run accounting: identical to the scene pipeline ---------------------------

  test("a truncated reply aborts after ONE call with the LLM_MAX_TOKENS message", async () => {
    const cut = '{"npc":{"path":"npcs/grella","content":"---\\nid: gre';
    const fake = useFake([{ text: cut, truncated: true, usage: usage(9000, 8000) }, npcReply()], 8000);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code?: string;
      maxTokens?: number;
      error: string;
      rawReply: string;
      usage: GenerateUsage;
      validationErrors?: string[];
    };
    // Language-free: the stable code plus the cap as a PARAMETER, and the
    // English fallback text next to them.
    expect(body.code).toBe("llm_truncated");
    expect(body.maxTokens).toBe(8000);
    expect(body.error).toBe(
      "the model's reply was cut off — raise LLM_MAX_TOKENS " +
        "(currently: 8000) or shorten the source text.",
    );
    expect(body.rawReply).toBe(cut);
    expect(body.usage).toEqual({ inputTokens: 9000, outputTokens: 8000, attempts: 1 });
    expect(body.validationErrors).toBeUndefined();
    // THE point: no correction turn, the second reply is unused
    expect(fake.calls).toHaveLength(1);
    expect(await exists("npcs/grella")).toBe(false);
  });

  test("usage is summed over the correction turn", async () => {
    const fake = useFake([
      { text: npcReply({ content: npcDraft({ status: "draft" }) }), usage: usage(1000, 100) },
      { text: npcReply(), usage: usage(2000, 250) },
    ]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateNpcResult;
    expect(result.usage).toEqual({ inputTokens: 3000, outputTokens: 350, attempts: 2 });
    expect(fake.calls).toHaveLength(2);
  });

  test("LLM_CORRECTION_TURNS bounds the NPC run as well", async () => {
    process.env.LLM_CORRECTION_TURNS = "2";
    const bad = npcReply({ content: npcDraft({ status: "draft" }) });
    const fake = useFake([bad, bad, bad]);
    expect((await generateNpc(npcBody)).status).toBe(422);
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2]!.corrections).toHaveLength(2);
  });

  // --- request errors ------------------------------------------------------------

  test("400 on malformed bodies — the provider is never called", async () => {
    const fake = useFake([npcReply()]);
    for (const body of [
      {},
      { sourceText: "" },
      { sourceText: "   " },
      { sourceText: 42 },
      { sourceText: "ok", id: 7 },
      { sourceText: "ok", extra: true },
    ]) {
      expect((await generateNpc(body)).status).toBe(400);
    }
    expect(fake.calls).toHaveLength(0);
  });

  test("an empty id string means 'the model chooses'", async () => {
    const fake = useFake([replyFor("leer-id")]);
    expect((await generateNpc({ ...npcBody, id: "  " })).status).toBe(200);
    expect(fake.calls[0]!.req.context.targetId).toBeUndefined();
  });

  test("404 for an unknown campaign", async () => {
    const fake = useFake([npcReply()]);
    expect((await generateNpc(npcBody, "gibtsnicht")).status).toBe(404);
    expect(fake.calls).toHaveLength(0);
  });

  test("503 with the factory message when no provider is configured", async () => {
    setProviderForTests(null);
    const saved = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_PROVIDER;
    try {
      const res = await postJson("/api/campaigns/beispiel/generate/npc", npcBody);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "ANTHROPIC_API_KEY fehlt" });
      expect(await fetchJob()).toBeNull();
    } finally {
      Object.assign(process.env, saved);
    }
  });
});

// --- the shared job model ------------------------------------------------------

describe("npc generate jobs", () => {
  test("the job carries kind npc, no chapter, and npcResult", async () => {
    const open = gate();
    useFake([replyFor("job-kind")], undefined, open.promise);

    const res = await postJson("/api/campaigns/beispiel/generate/npc", npcBody);
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };

    const running = await fetchJob();
    expect(running).toMatchObject({ id: jobId, campaign: "beispiel", kind: "npc", status: "running" });
    expect(running!.chapter).toBeUndefined();

    open.open();
    const done = await waitForJob();
    expect(done.kind).toBe("npc");
    expect(done.status).toBe("done");
    expect(done.npcResult!.npc.path).toBe("npcs/job-kind");
    // the scene field stays absent — a consumer reads one OR the other
    expect(done.result).toBeUndefined();
    expect(await exists("npcs/job-kind")).toBe(false);
  });

  test("ONE generator job per campaign — a scene run blocks an npc start and back", async () => {
    // scene job running -> npc start is a 409 carrying the running job's id.
    // The scene reply itself is junk (this test is about the gate, not the
    // pipeline) — one reply per allowed attempt, so nothing runs dry.
    const open = gate();
    process.env.LLM_CORRECTION_TURNS = "0";
    useFake(["{}"], undefined, open.promise);
    const scene = await postJson("/api/campaigns/beispiel/generate", {
      chapter: "01-salzhafen",
      sourceText: "Fenn waits at the docks.",
    });
    expect(scene.status).toBe(202);
    const { jobId } = (await scene.json()) as { jobId: string };

    const npc = await postJson("/api/campaigns/beispiel/generate/npc", npcBody);
    expect(npc.status).toBe(409);
    expect(await npc.json()).toEqual({
      error: "a generate job is already running for this campaign",
      jobId,
    });
    open.open();
    await waitForJob();
    await clearJobsForTests();

    // …and the other way round: npc job running -> scene start is a 409
    const open2 = gate();
    useFake([replyFor("job-block")], undefined, open2.promise);
    const started = await postJson("/api/campaigns/beispiel/generate/npc", npcBody);
    expect(started.status).toBe(202);
    const second = await postJson("/api/campaigns/beispiel/generate", {
      chapter: "01-salzhafen",
      sourceText: "Fenn waits at the docks.",
    });
    expect(second.status).toBe(409);
    open2.open();
    await waitForJob();
  });

  test("a new npc run replaces a finished scene job (and its result)", async () => {
    useFake([
      // a scene run whose reply fails validation is enough — the point is the
      // finished job being replaced, not its content
      "kein json",
      replyFor("job-replace"),
    ]);
    process.env.LLM_CORRECTION_TURNS = "0";
    await postJson("/api/campaigns/beispiel/generate", {
      chapter: "01-salzhafen",
      sourceText: "Fenn waits at the docks.",
    });
    const failed = await waitForJob();
    expect(failed.kind).toBe("scene");
    expect(failed.status).toBe("failed");

    expect((await generateNpc(npcBody)).status).toBe(200);
    const job = await fetchJob();
    expect(job!.kind).toBe("npc");
    expect(job!.status).toBe("done");
    expect(job!.error).toBeUndefined();
  });

  test("a review edit accepts the npc draft path and rejects anything else", async () => {
    useFake([replyFor("job-drafts")]);
    await generateNpc(npcBody);
    const edited = `${npcDraft({ id: "job-drafts" }).body}\nHandgeschriebene Ergänzung.\n`;

    // The review PATCH replaced `PUT …/job/drafts` and checks the same
    // known-path rule.
    const edit = async (path: string) => {
      const current = await fetchJob();
      return app.request(`/api/campaigns/beispiel/generate/job/${current!.id}/review`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rev: current!.rev ?? 0, edits: { [path]: { body: edited } } }),
      });
    };

    expect((await edit("npcs/fremd")).status).toBe(400);
    const res = await edit("npcs/job-drafts");
    expect(res.status).toBe(200);

    const job = await fetchJob();
    expect(job!.draftEdits).toEqual({ "npcs/job-drafts": { body: edited } });
    // the result itself is untouched — the edit sits next to it
    expect(job!.npcResult!.npc.body).not.toBe(edited);
  });
});

// --- POST /api/campaigns/:campaign/generate/apply with an npc draft ------------------------

describe("apply an npc draft", () => {
  /** Run + apply, the app's flow: the draft of a finished job goes to disk. */
  async function runAndApply(id: string, over: { jobId?: string } = {}): Promise<Response> {
    useFake([replyFor(id)]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    const job = await fetchJob();
    return postJson("/api/campaigns/beispiel/generate/apply", {
      npc: job!.npcResult!.npc,
      jobId: over.jobId ?? job!.id,
    });
  }

  test("writes npcs/<id> and discards the job", async () => {
    const res = await runAndApply("apply-happy");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ written: ["npcs/apply-happy"] });
    // the draft is stored — nothing left to restore
    expect(await fetchJob()).toBeNull();

    // …and it is a real npc for the rest of the API: every reviewed field
    // came through, the quoted quickstats included, and `## Beziehungen`
    // (which became relation ROWS) is rendered back into the body
    const written = await read("npcs/apply-happy");
    expect(written.kind).toBe("npc");
    expect(written.properties.id).toBe("apply-happy");
    expect(written.properties.name).toBe("Grella");
    expect(written.properties.status).toBe("alive");
    expect(written.properties.quickstats).toEqual({ insight: "+3", deception: "+5" });
    expect(written.properties.statblock).toBe("Roll20: Grella");
    expect(written.body).toContain("> [!secret] Kennt ein zweites Versteck unter dem Kai.");
    expect(written.body).toContain("- [[jorna]]: schuldet ihr einen Gefallen");
  });

  test("a stale jobId leaves the job alone", async () => {
    const res = await runAndApply("apply-stale", {
      jobId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(200);
    expect((await fetchJob())!.kind).toBe("npc");
  });

  test("409 when the entry exists — nothing overwritten, the job stays", async () => {
    // apply-happy.md was written by the test above
    useFake([replyFor("apply-happy")]);
    // the reply's id collides with an existing npc, so the RUN already fails
    process.env.LLM_CORRECTION_TURNS = "0";
    expect((await generateNpc(npcBody)).status).toBe(422);

    // …and a client that posts the draft anyway gets a 409 with the path
    const before = await read("npcs/apply-happy");
    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      npc: { path: "npcs/apply-happy", ...npcDraft({ id: "apply-happy" }) },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "target entries already exist",
      conflicts: ["npcs/apply-happy"],
    });
    const after = await read("npcs/apply-happy");
    expect(after.properties).toEqual(before.properties);
    expect(after.body).toBe(before.body);
    expect(after.rev).toBe(before.rev); // the row's rev never moved
  });

  test("400 re-validation: path, id, status, properties — nothing written", async () => {
    const cases: Array<[string, unknown]> = [
      ["path outside npcs/", { path: "locations/x", ...npcDraft({ id: "x" }) }],
      ["path traversal", { path: "npcs/../../etc/x", ...npcDraft({ id: "x" }) }],
      ["uppercase id", { path: "npcs/Grella", ...npcDraft({ id: "Grella" }) }],
      ["id mismatch", { path: "npcs/anders", ...npcDraft({ id: "grella" }) }],
      ["properties of the wrong shape", { path: "npcs/anders", properties: "id: anders", body: "" }],
      [
        "invalid status",
        { path: "npcs/anders", ...npcDraft({ id: "anders", status: "draft" }) },
      ],
      [
        "missing status",
        { path: "npcs/anders", ...npcDraft({ id: "anders", status: null }) },
      ],
      ["body of the wrong shape", { path: "npcs/anders", properties: {}, body: 7 }],
      ["unknown key", { path: "npcs/anders", ...npcDraft(), extra: 1 }],
      ["not an object", "npcs/anders"],
    ];
    for (const [what, npc] of cases) {
      const res = await postJson("/api/campaigns/beispiel/generate/apply", { npc });
      expect(res.status, what).toBe(400);
    }
    expect(await exists("npcs/anders")).toBe(false);
    expect(await exists("npcs/Grella")).toBe(false);
  });

  test("an empty body is still 'nothing to apply'", async () => {
    const res = await postJson("/api/campaigns/beispiel/generate/apply", { npc: null });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("nothing to apply");
  });
});

// --- campaign knowledge in an NPC run ----------------------------------------
//
// The NPC half of it; the scene half is in generator.test.ts. What is specific
// here is that an NPC run has NO chapter and still gets the block, and that
// the naming check looks at the npc's PROPERTIES as well (a wrong `role` is as
// visible to the DM as a wrong body line).

describe("campaign knowledge", () => {
  async function setKnowledge(entries: unknown[]): Promise<void> {
    const current = await app.request("/api/campaigns/beispiel/knowledge");
    const { rev } = (await current.json()) as { rev: number };
    const res = await app.request("/api/campaigns/beispiel/knowledge", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries, rev }),
    });
    expect(res.status).toBe(200);
  }

  // The database is shared by this file — nothing may leak upwards.
  afterEach(async () => {
    await setKnowledge([]);
  });

  test("the block travels although the run has no chapter, refs resolved", async () => {
    await setKnowledge([
      { kind: "fact", from: "", to: "", text: "[[fenn]] lügt über die Ladung." },
      { kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" },
    ]);
    const fake = useFake([replyFor("kennel-hand")]);
    expect((await generateNpc({ sourceText: "A kennel hand.", id: "kennel-hand" })).status).toBe(
      200,
    );
    const req = fake.calls[0]!.req;
    expect(req.context.chapter).toBeUndefined();
    // `[[fenn]]` reaches the model as the npc's NAME, never as a slug.
    expect(req.knowledge).toBe(
      [
        "- Fakt: Fenn lügt über die Ladung.",
        '- Namenskonvention: schreibe „Salt Harbour“ immer als „Salzhafen“.',
      ].join("\n"),
    );
  });

  test("a wrong spelling in a PROPERTY is reported with the key, not a line", async () => {
    await setKnowledge([
      { kind: "naming", from: "Schmugglerin", to: "Freihändlerin", text: "" },
    ]);
    useFake([replyFor("wharf-hand")]);
    const result = (await (
      await generateNpc({ sourceText: "A wharf hand.", id: "wharf-hand" })
    ).json()) as GenerateNpcResult;
    // The fixture's `role` is „Schmugglerin mit eigenen Plänen“.
    const hint = (result.namingHints ?? []).find((h) => h.field === "role");
    expect(hint).toMatchObject({
      from: "Schmugglerin",
      to: "Freihändlerin",
      path: "npcs/wharf-hand",
      field: "role",
    });
    expect(hint?.line).toBeUndefined();
  });

  test("without naming conventions the field stays absent", async () => {
    useFake([replyFor("net-mender")]);
    const result = (await (
      await generateNpc({ sourceText: "A net mender.", id: "net-mender" })
    ).json()) as GenerateNpcResult;
    expect(result.namingHints).toBeUndefined();
  });
});
