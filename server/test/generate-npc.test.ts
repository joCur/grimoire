// NPC generator tests. Same harness as the scene pipeline tests
// (generator.test.ts): a database seeded from the example campaign — once for
// this file, because cases build on what an earlier one applied — and a
// FakeProvider with scripted raw replies instead of a real LLM. An accepted
// npc is a ROW, so "was it written?" is asked through the npc's own resource.
//
// What is asserted here: the NPC run uses the SAME mechanics as the scene run
// (correction turns, truncation fail-fast, usage summing, JSON extraction,
// one job per campaign) with its own prompt assets, its own context (no
// chapter), its own reply — the npc's own fields, flat (ADR #31) — and its
// own validation rules.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { GenerateJob, GenerateNpcResult, GenerateUsage, Npc } from "@grimoire/shared";
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

/** Whether an npc is there: its own resource answers. */
async function exists(id: string): Promise<boolean> {
  const res = await app.request(`/api/campaigns/beispiel/npcs/${id}`);
  return res.status === 200;
}

/** An accepted npc, read from its own resource. */
async function read(id: string): Promise<Npc> {
  const res = await app.request(`/api/campaigns/beispiel/npcs/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Npc;
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
        motivation: "Die Route durch die Nordbucht für sich allein — ohne [[fenn]].",
      },
      body: [
        "## Weiß",
        "",
        over.knowledge ?? "> [!secret] Kennt ein zweites Versteck unter dem Kai.",
        "",
        "## Beziehungen",
        "",
        ...(over.relations ?? ["- [[jorna]]: schuldet ihr einen Gefallen"]),
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
 * The reply object: the npc's own fields, flat, beside `body` and
 * `warnings`. Written from the draft a case describes and turned into the
 * reply object (support/pipeline-fake `entryReply`).
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

    // The proposal is the npc without its guard — every field flat, `body`
    // among them, a field the reply left `null` absent. Nothing renders it
    // into one text on the way.
    expect(result.npc).toEqual({
      id: "grella",
      name: "Grella",
      role: "Schmugglerin mit eigenen Plänen",
      status: "alive",
      statblock: "Roll20: Grella",
      // quoted quickstats survive as strings — the plus is the whole point
      quickstats: { insight: "+3", deception: "+5" },
      voice: "schnell, spöttisch — wird höflich, wenn sie lügt",
      appearance: "geflickter Ölmantel, rußige Finger",
      motivation: "Die Route durch die Nordbucht für sich allein — ohne [[fenn]].",
      body: npcDraft().body,
    });
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

    // review preview only — NOTHING written
    expect(await exists("grella")).toBe(false);
  });

  test("a pinned id travels in the context and decides the npc's id", async () => {
    const fake = useFake([replyFor("die-krähe")]);
    // an id with an umlaut is not kebab-safe -> 400 before the provider runs
    expect((await generateNpc({ ...npcBody, id: "die-krähe" })).status).toBe(400);
    expect(fake.calls).toHaveLength(0);

    useFake([replyFor("krieger-ohne-namen")]);
    const res = await generateNpc({ ...npcBody, id: "krieger-ohne-namen" });
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateNpcResult;
    expect(result.npc.id).toBe("krieger-ohne-namen");
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
    // the correction turn names the npc, not "alle Szenen"
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("vollständigen NPC enthalten");
  });

  test("an npc reply without an id is a correction turn, not the id npc", async () => {
    // The reply carries NO `id`, and an npc is its id — so there is nothing
    // to fall back to and the missing key has to be the error it is.
    const bad = npcReply({ content: npcDraft({}, ["id"]) });
    const fake = useFake([bad, npcReply()]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    const correction = fake.calls[1]!.corrections[0]!.correction;
    expect(correction).toContain('"id"');
    // …and the accepted reply carries ITS id, as always.
    const result = (await res.json()) as GenerateNpcResult;
    expect(result.npc.id).toBe("grella");
  });

  // --- the validation rules (each one a correction turn) ------------------------

  test("an unknown [[id]] triggers a correction turn, then succeeds", async () => {
    const bad = npcReply({ content: npcDraft({ relations: ["- [[niemand]]: alter Feind"] }) });
    const fake = useFake([bad, npcReply()]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections).toHaveLength(1);
    expect(fake.calls[1]!.corrections[0]!.assistant).toBe(bad);
    const correction = fake.calls[1]!.corrections[0]!.correction;
    expect(correction).toContain("[[niemand]] nennt nichts");
    // ONE error, not a cascade
    expect(correction.match(/^- /gm)).toHaveLength(1);
    expect(await exists("grella")).toBe(false);
  });

  test("the reference rule reads no heading — it finds [[id]] anywhere in the body", async () => {
    // A lowercase heading, CRLF line ends, a paragraph under no heading at
    // all: the rule is about the reference, so none of that hides one.
    const bodies = [
      "## weiß\r\n\r\n> [!secret] [[niemand]] zahlt.\r\n",
      "Vor jeder Überschrift steht [[niemand]].\n\n## Weiß\n\n> [!secret] Nichts.\n",
      "## Auftreten\n\n- [[niemand]]s Boot liegt am Kai.\n",
    ];
    for (const body of bodies) {
      expect(
        await firstValidationError([npcReply({ content: { ...npcDraft(), body } })]),
      ).toContain("[[niemand]] nennt nichts");
    }
  });

  test("[[id]] of any campaign kind, the npc itself and a slug in code pass in one turn", async () => {
    // A reference resolves to an npc, a location or a scene of the campaign;
    // the npc this run proposes is an entry of the run. Inside a code span the
    // brackets are literal text, as on the rendered page.
    const body = [
      "## Weiß",
      "",
      "> [!secret] Trifft [[jorna]] am [[leuchtturm]]; gehört zu [[smuggler-captured]].",
      "",
      "## Beziehungen",
      "",
      "- [[fenn]]: alter Rivale",
      "",
      "[[grella]] schreibt sich im Log als `[[niemand]]`.",
      "",
    ].join("\n");
    const fake = useFake([npcReply({ content: { ...npcDraft(), body } })]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });

  test("a relationship line in any form is prose — it passes in one turn", async () => {
    // `- [[jorna]]: …` is what the prompt and its few-shot recommend (and what
    // the default fixture above sends), but the section is free text: a line
    // without the brackets or without an id is the model's prose, not an
    // error.
    for (const relations of [
      ["- jorna: alte Bekannte"],
      ["- Jorna, die Hafenmeisterin"],
      ["Keine belegten Beziehungen."],
    ]) {
      const fake = useFake([npcReply({ content: npcDraft({ relations }) })]);
      expect((await generateNpc(npcBody)).status).toBe(200);
      expect(fake.calls).toHaveLength(1);
    }
  });

  test("an invalid status triggers a correction turn, then succeeds", async () => {
    const bad = npcReply({ content: npcDraft({ status: "draft" }) });
    const fake = useFake([bad, npcReply()]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    const correction = fake.calls[1]!.corrections[0]!.correction;
    expect(correction).toContain('"status"');
    expect(correction).toContain('"alive"|"dead"|"missing"|"unknown"');
    expect(correction.match(/^- /gm)).toHaveLength(1);
  });

  test("a status is required — the schema knows no npc without one", async () => {
    // An npc always has one of its four states, so the reply schema has no
    // `null` for it; an endpoint that answers one anyway gets it named.
    const reply = JSON.parse(npcReply()) as Record<string, unknown>;
    expect(await firstValidationError([JSON.stringify({ ...reply, status: null })])).toContain(
      '"status"',
    );
  });

  test("any known callout passes under ## Weiß — no rule reads a heading", async () => {
    const fake = useFake([
      npcReply({ content: npcDraft({ knowledge: "> [!note] Nur ein DM-Hinweis." }) }),
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
    // The „quote the plus" rule is the SCHEMA's job: `quickstats` is a list
    // of `{ key, value }` with string values, and the npc's reply folds it
    // into its key/value set (@grimoire/shared/npc `npcFromReply`). So what
    // a reply can still get wrong is the SHAPE, and that is what it is told.
    const reply = JSON.parse(npcReply()) as Record<string, unknown>;
    const mapping = JSON.stringify({ ...reply, quickstats: { insight: "+3" } });
    expect(await firstValidationError([mapping])).toContain('"quickstats"');
  });

  test("an invented chapter is an error; a ## Notizen section is free text", async () => {
    expect(
      await firstValidationError([npcReply({ content: npcDraft({ chapter: true }) })]),
    ).toContain("kennt kein Ziel-Kapitel");

    const fake = useFake([
      npcReply({
        content: {
          ...npcDraft(),
          body: `${npcDraft().body}\n## Notizen\n\nSie könnte die Schwester von [[fenn]] sein.\n`,
        },
      }),
    ]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });

  test("an id that is no kebab slug is an error", async () => {
    // The `id` is what the model decides, and it is the npc's reference key
    // — so it has to be usable as one.
    for (const badId of ["Grella", "grella.txt", "grella/2", "trailing-"]) {
      expect(
        await firstValidationError([npcReply({ content: npcDraft({ id: badId }) })]),
      ).toContain("kebab-case id");
    }
  });

  test("a missing name is a correction turn — the schema requires one", async () => {
    // The reply schema requires the field (the properties dialog requires it
    // too), so the model is told instead of the server inventing — the
    // degrade rule stays where it belongs, on the READ path.
    expect(
      await firstValidationError([
        npcReply({ content: npcDraft({ id: "namenlos", name: null }) }),
      ]),
    ).toContain('"name"');
    expect(
      await firstValidationError([npcReply({ content: npcDraft({ id: "namenlos", name: "  " }) })]),
    ).toContain('"name" fehlt');
  });

  test("a reply that is not the reply object is a validation error", async () => {
    // Prose, an empty reply, a JSON value that is not an object: all of them
    // are „das ist kein Objekt des Schemas", and the message names the
    // npc's fields.
    for (const raw of [
      "kein Objekt",
      "## Will\n\nnur Text, kein Objekt\n",
      "",
      JSON.stringify([{ id: "grella" }]),
    ]) {
      expect(await firstValidationError([raw])).toContain("kein Objekt des Schemas");
    }
    // An object of another shape — the earlier `properties` pair — is told
    // which keys it lacks and which it may not carry.
    const pair = await firstValidationError([
      JSON.stringify({ properties: { id: "grella" }, body: "x", warnings: [] }),
    ]);
    expect(pair).toContain('"id"');
    expect(pair).toContain('Unbekannter Schlüssel: "properties"');
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
    // The npc is the reply's own, and the warning is the run's — the fence
    // around the reply travels nowhere.
    expect(result.npc.id).toBe("grella");
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
    expect(result.npc.id).toBe("grella");
    expect(result.warnings.some((w) => w.includes("repariert"))).toBe(true);
  });

  // --- id collisions -------------------------------------------------------------

  test("a pinned id whose npc holds content answers 409 — the provider is never called", async () => {
    const fake = useFake([npcReply()]);
    const res = await generateNpc({ ...npcBody, id: "fenn" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "npc already exists", id: "fenn" });
    expect(fake.calls).toHaveLength(0);
    // no job was created for a request error
    expect(await fetchJob()).toBeNull();
    // and the existing npc is untouched
    expect((await read("fenn")).id).toBe("fenn");
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
    const cut = '{"id":"grella","name":"Gre';
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
    expect(await exists("grella")).toBe(false);
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
    expect(done.npcResult!.npc.id).toBe("job-kind");
    // the scene field stays absent — a consumer reads one OR the other
    expect(done.result).toBeUndefined();
    expect(await exists("job-kind")).toBe(false);
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

  test("a review edit names the proposed npc by its id and rejects anything else", async () => {
    useFake([replyFor("job-drafts")]);
    await generateNpc(npcBody);
    const edited = `${npcDraft({ id: "job-drafts" }).body}\nHandgeschriebene Ergänzung.\n`;

    const edit = async (id: string) => {
      const current = await fetchJob();
      return app.request(`/api/campaigns/beispiel/generate/job/${current!.id}/review`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rev: current!.rev ?? 0, npcEdits: { [id]: { body: edited } } }),
      });
    };

    expect((await edit("fremd")).status).toBe(400);
    const res = await edit("job-drafts");
    expect(res.status).toBe(200);

    const job = await fetchJob();
    expect(job!.npcEdits).toEqual({ "job-drafts": { body: edited } });
    expect(job!.sceneEdits).toEqual({});
    // the result itself is untouched — the edit sits next to it
    expect(job!.npcResult!.npc.body).not.toBe(edited);
  });
});

// --- accepting the npc of an NPC run -----------------------------------------------

describe("accept the npc of an NPC run", () => {
  /** Run + apply: the npc of a finished job is written. */
  async function runAndApply(id: string, over: { jobId?: string } = {}): Promise<Response> {
    useFake([replyFor(id)]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    const job = await fetchJob();
    return postJson("/api/campaigns/beispiel/generate/apply", {
      npcs: [job!.npcResult!.npc],
      jobId: over.jobId ?? job!.id,
    });
  }

  test("the whole-run apply writes the npc and discards the job", async () => {
    const res = await runAndApply("apply-happy");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scenes: [], npcs: ["apply-happy"], locations: [] });
    // the npc is stored — nothing left to restore
    expect(await fetchJob()).toBeNull();

    // …and it is a real npc for the rest of the API: every reviewed field
    // came through, the quoted quickstats included, and the body is stored
    // as the reply carried it
    const written = await read("apply-happy");
    expect(written.id).toBe("apply-happy");
    expect(written.name).toBe("Grella");
    expect(written.status).toBe("alive");
    expect(written.quickstats).toEqual({ insight: "+3", deception: "+5" });
    expect(written.statblock).toBe("Roll20: Grella");
    // The motivation is a field of the reply, and the accept writes it.
    expect(written.motivation).toBe(
      "Die Route durch die Nordbucht für sich allein — ohne [[fenn]].",
    );
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

  test("the partial accept writes the npc by its id, with the DM's change on top", async () => {
    useFake([replyFor("accept-edit")]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    let job = (await fetchJob())!;
    const patched = await app.request(`/api/campaigns/beispiel/generate/job/${job.id}/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: job.rev ?? 0, npcEdits: { "accept-edit": { name: "Grella die Ältere" } } }),
    });
    expect(patched.status).toBe(200);
    job = (await patched.json()) as GenerateJob;
    // „Alle übernehmen" of an NPC run is its one npc.
    const res = await postJson(`/api/campaigns/beispiel/generate/job/${job.id}/accept`, { rev: job.rev });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scenes: [],
      npcs: ["accept-edit"],
      locations: [],
      jobDeleted: true,
    });
    const written = await read("accept-edit");
    expect(written.name).toBe("Grella die Ältere");
    expect(written.role).toBe("Schmugglerin mit eigenen Plänen");
  });

  test("409 when the npc holds content — nothing overwritten", async () => {
    // apply-happy was written by the test above
    useFake([replyFor("apply-happy")]);
    // the reply's id collides with an existing npc, so the RUN already fails
    process.env.LLM_CORRECTION_TURNS = "0";
    expect((await generateNpc(npcBody)).status).toBe(422);

    // …and a client that posts the npc anyway gets a 409 naming its id
    const before = await read("apply-happy");
    const { properties, body } = npcDraft({ id: "apply-happy" });
    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      npcs: [{ ...properties, body }],
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "target rows already exist",
      chapters: [],
      scenes: [],
      npcs: ["apply-happy"],
      locations: [],
    });
    expect(await read("apply-happy")).toEqual(before); // the row's rev never moved
  });

  test("400 re-validation: every npc is checked against the npc's schema — nothing written", async () => {
    const npc = (over: Record<string, unknown> = {}) => {
      const { properties, body } = npcDraft({ id: "anders" });
      return { ...properties, body, ...over };
    };
    const cases: Array<[string, unknown]> = [
      ["uppercase id", npc({ id: "Anders" })],
      ["id with a slash", npc({ id: "npcs/anders" })],
      ["invalid status", npc({ status: "draft" })],
      ["missing status", npc({ status: undefined })],
      ["the earlier properties pair", { properties: npc(), body: "" }],
      ["body of the wrong shape", npc({ body: 7 })],
      ["unknown key", npc({ extra: 1 })],
      ["a kind", npc({ kind: "npc" })],
      ["not an object", "anders"],
    ];
    for (const [what, item] of cases) {
      const res = await postJson("/api/campaigns/beispiel/generate/apply", { npcs: [item] });
      expect(res.status, what).toBe(400);
    }
    expect(await exists("anders")).toBe(false);
    expect(
      (await postJson("/api/campaigns/beispiel/generate/apply", { npc: npc() })).status,
    ).toBe(400);
  });

  test("an empty body is still 'nothing to apply'", async () => {
    const res = await postJson("/api/campaigns/beispiel/generate/apply", { npcs: [] });
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
      npc: "wharf-hand",
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
