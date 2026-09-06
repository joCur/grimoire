// NPC generator tests (issue #21). Same harness as the scene pipeline tests
// (generator.test.ts): a database seeded from the example campaign — once for
// the whole file, because cases build on what an earlier one applied — and a
// FakeProvider with scripted raw replies instead of a real LLM. Since the
// cutover (issue #57) an applied draft is a ROW, so "was it written?" is
// asked through the API.
//
// What is asserted here is what the ticket is about: the NPC run uses the
// SAME mechanics as the scene run (correction turns, truncation fail-fast,
// usage summing, JSON extraction, one job per campaign) with its own prompt
// assets, its own context (no chapter) and its own validation rules.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type {
  FileResponse,
  GenerateJob,
  GenerateNpcResult,
  GenerateUsage,
} from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generate-jobs";
import { setProviderForTests } from "../src/generator";
import { dropStore, seedStore } from "./support/store";
import type {
  CompletionResult,
  CorrectionTurn,
  GenerateRequest,
  LLMProvider,
  TokenUsage,
} from "../src/llm-provider";

/** Whether an entity is there: its address resolves through GET /file. */
async function exists(rel: string): Promise<boolean> {
  const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
  return res.status === 200;
}

/** GET /file of an applied draft. */
async function read(rel: string): Promise<FileResponse> {
  const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
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

/** A prompt-conform NPC file for an npc the example campaign does NOT have. */
function npcMarkdown(
  over: {
    id?: string;
    name?: string | null;
    status?: string | null;
    chapter?: boolean;
    quickstats?: string;
    knowledge?: string;
    relations?: string[];
    notes?: string;
  } = {},
): string {
  const status = over.status === undefined ? "alive" : over.status;
  const name = over.name === undefined ? "Grella" : over.name;
  return [
    "---",
    `id: ${over.id ?? "grella"}`,
    ...(name === null ? [] : [`name: ${name}`]),
    "role: Schmugglerin mit eigenen Plänen",
    ...(over.chapter === true ? ["chapter: 01-salzhafen"] : []),
    ...(status === null ? [] : [`status: ${status}`]),
    'statblock: "Roll20: Grella"',
    `quickstats: ${over.quickstats ?? '{ insight: "+3", deception: "+5" }'}`,
    "voice: schnell, spöttisch — wird höflich, wenn sie lügt",
    "appearance: geflickter Ölmantel, rußige Finger",
    "---",
    "",
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
    ...(over.relations ?? ["- jorna: schuldet ihr einen Gefallen"]),
    "",
    "## Notizen",
    "",
    over.notes ?? "<!-- wird von der App im Review-Schritt befüllt -->",
    "",
  ].join("\n");
}

/** The reply's JSON, in a fence like real models tend to send it. */
function npcReply(
  over: { path?: string; content?: string; warnings?: string[] } = {},
): string {
  const body = {
    npc: {
      path: over.path ?? "npcs/grella.md",
      content: over.content ?? npcMarkdown(),
    },
    warnings: over.warnings ?? ["Quelltext nennt keinen Status — alive gesetzt"],
  };
  return "```json\n" + JSON.stringify(body, null, 2) + "\n```";
}

/** A reply for a specific id (so a test that WRITES does not collide later). */
function replyFor(id: string, over: Parameters<typeof npcMarkdown>[0] = {}): string {
  return npcReply({ path: `npcs/${id}.md`, content: npcMarkdown({ id, ...over }) });
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
  const res = await app.request(`/api/${campaign}/generate/job`);
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
  const res = await postJson(`/api/${campaign}/generate/npc`, body);
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

// --- POST /api/:campaign/generate/npc -------------------------------------------

describe("POST /api/:campaign/generate/npc", () => {
  test("happy path: GenerateNpcResult from one call, nothing written", async () => {
    const fake = useFake([npcReply()]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateNpcResult;

    expect(result.npc.path).toBe("npcs/grella.md");
    expect(result.npc.markdown).toBe(npcMarkdown());
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
    expect(req.fewShotTarget).toContain("id: fenn");
    expect(req.context.npcs.map((n) => n.id).sort()).toEqual(["fenn", "jorna"]);
    expect(req.context.locations.map((l) => l.id)).toEqual(["leuchtturm"]);
    expect(req.glossary).toContain("Leuchtturmwärter");
    // an NPC run has no chapter and (without a pinned id) no target id
    expect(req.context.chapter).toBeUndefined();
    expect(req.context.targetId).toBeUndefined();
    expect(req.sourceText).toBe(npcBody.sourceText);

    // review preview only — NOTHING on disk
    expect(await exists("npcs/grella.md")).toBe(false);
  });

  test("a pinned id travels in the context and decides the file name", async () => {
    const fake = useFake([replyFor("die-krähe")]);
    // an id with an umlaut is not kebab-safe -> 400 before the provider runs
    expect((await generateNpc({ ...npcBody, id: "die-krähe" })).status).toBe(400);
    expect(fake.calls).toHaveLength(0);

    useFake([replyFor("krieger-ohne-namen")]);
    const res = await generateNpc({ ...npcBody, id: "krieger-ohne-namen" });
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateNpcResult;
    expect(result.npc.path).toBe("npcs/krieger-ohne-namen.md");
  });

  test("a pinned id the model ignores is a correction turn", async () => {
    const bad = replyFor("etwas-anderes");
    const fake = useFake([bad, replyFor("die-graue")]);
    const res = await generateNpc({ ...npcBody, id: "die-graue" });
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.req.context.targetId).toBe("die-graue");
    expect(fake.calls[1]!.corrections[0]!.assistant).toBe(bad);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain('"npcs/die-graue.md"');
    // the correction turn names the NPC file, not "alle Szenen und Stubs"
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("vollständige NPC-Datei");
  });

  // --- the validation rules (each one a correction turn) ------------------------

  test("a relationship to an unknown npc triggers a correction turn, then succeeds", async () => {
    const bad = npcReply({ content: npcMarkdown({ relations: ["- niemand: alter Feind"] }) });
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
    expect(await exists("npcs/grella.md")).toBe(false);
  });

  test("a relationship line that is not `- <npc-id>: text` is an error", async () => {
    const errors = await firstValidationError([
      npcReply({ content: npcMarkdown({ relations: ["- Jorna, die Hafenmeisterin"] }) }),
    ]);
    expect(errors).toContain("ist keine \"- <npc-id>: <Text>\"-Zeile");
  });

  test("prose inside ## Beziehungen degrades instead of erroring", async () => {
    const fake = useFake([
      npcReply({ content: npcMarkdown({ relations: ["Keine belegten Beziehungen."] }) }),
    ]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });

  test("an invalid or missing status triggers a correction turn, then succeeds", async () => {
    const bad = npcReply({ content: npcMarkdown({ status: "draft" }) });
    const fake = useFake([bad, npcReply()]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    const correction = fake.calls[1]!.corrections[0]!.correction;
    expect(correction).toContain("alive, dead, missing, unknown");
    expect(correction).toContain('"alive"');
    expect(correction.match(/^- /gm)).toHaveLength(1);

    expect(await firstValidationError([npcReply({ content: npcMarkdown({ status: null }) })]))
      .toContain('"status" fehlt');
  });

  test("only [!secret] inside ## Weiß — other known callouts elsewhere are fine", async () => {
    const errors = await firstValidationError([
      npcReply({ content: npcMarkdown({ knowledge: "> [!note] Nur ein DM-Hinweis." }) }),
    ]);
    expect(errors).toContain("## Weiß: nur [!secret] erlaubt");

    // the same callout OUTSIDE the section passes in one call
    const fake = useFake([
      npcReply({
        content: `${npcMarkdown()}\n## Auftreten\n\n> [!note] Grella taucht erst nach der Bucht auf.\n`,
      }),
    ]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });

  test("an unknown callout anywhere is an error", async () => {
    const errors = await firstValidationError([
      npcReply({ content: npcMarkdown({ knowledge: "> [!danger] Sie lügt immer." }) }),
    ]);
    expect(errors).toContain('unknown callout "[!danger]"');
  });

  test("unquoted quickstats, an invented chapter and a filled ## Notizen are errors", async () => {
    expect(
      await firstValidationError([
        npcReply({ content: npcMarkdown({ quickstats: "{ insight: +3 }" }) }),
      ]),
    ).toContain("Werte als Strings in Anführungszeichen");

    expect(
      await firstValidationError([npcReply({ content: npcMarkdown({ chapter: true }) })]),
    ).toContain('kein "chapter"');

    expect(
      await firstValidationError([
        npcReply({ content: npcMarkdown({ notes: "Sie könnte die Schwester von Fenn sein." }) }),
      ]),
    ).toContain("## Notizen bleibt leer");
  });

  test("a mismatched id and a broken path are errors", async () => {
    expect(
      await firstValidationError([
        npcReply({ path: "npcs/grella.md", content: npcMarkdown({ id: "andere" }) }),
      ]),
    ).toContain("passt nicht zum Dateinamen");

    // not under npcs/, not kebab, not a .md file
    for (const badPath of ["locations/grella.md", "npcs/Grella.md", "npcs/grella.txt"]) {
      expect(await firstValidationError([npcReply({ path: badPath })])).toContain(
        'path muss "npcs/<kebab-id>.md" sein',
      );
    }
  });

  test("a missing name degrades to the id — the shared parser fills it", async () => {
    const fake = useFake([
      npcReply({ path: "npcs/namenlos.md", content: npcMarkdown({ id: "namenlos", name: null }) }),
    ]);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(200);
    expect(((await res.json()) as GenerateNpcResult).npc.properties.name).toBe("namenlos");
    expect(fake.calls).toHaveLength(1);
  });

  test("a reply without a usable npc object is a validation error", async () => {
    expect(await firstValidationError(["kein json"])).toContain("not valid JSON");
    expect(await firstValidationError(['{"warnings": []}'])).toContain('"npc" must be an object');
    expect(await firstValidationError(["[1, 2]"])).toContain("must be a JSON object");
    expect(
      await firstValidationError([JSON.stringify({ npc: { path: "npcs/x.md" } })]),
    ).toContain('"npc" must be an object');
  });

  test("prose around the JSON costs ONE call (issue #20 extraction, npc path)", async () => {
    const fake = useFake([
      [
        "I need to be careful about characters inside string values — the markdown",
        "content contains quotes and newlines that must be escaped properly.",
        "",
        JSON.stringify({ npc: { path: "npcs/grella.md", content: npcMarkdown() }, warnings: [] }),
      ].join("\n"),
    ]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });

  // --- id collisions -------------------------------------------------------------

  test("a pinned id whose file exists answers 409 — the provider is never called", async () => {
    const fake = useFake([npcReply()]);
    const res = await generateNpc({ ...npcBody, id: "fenn" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "npc file already exists",
      path: "npcs/fenn.md",
    });
    expect(fake.calls).toHaveLength(0);
    // no job was created for a request error
    expect(await fetchJob()).toBeNull();
    // and the existing npc is untouched
    expect((await read("npcs/fenn.md")).properties.id).toBe("fenn");
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
    const cut = '{"npc":{"path":"npcs/grella.md","content":"---\\nid: gre';
    const fake = useFake([{ text: cut, truncated: true, usage: usage(9000, 8000) }, npcReply()], 8000);
    const res = await generateNpc(npcBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      rawReply: string;
      usage: GenerateUsage;
      validationErrors?: string[];
    };
    expect(body.error).toBe(
      "Antwort wurde vom Modell abgeschnitten — LLM_MAX_TOKENS erhöhen " +
        "(aktuell: 8000) oder Quelltext verkleinern.",
    );
    expect(body.rawReply).toBe(cut);
    expect(body.usage).toEqual({ inputTokens: 9000, outputTokens: 8000, attempts: 1 });
    expect(body.validationErrors).toBeUndefined();
    // THE point: no correction turn, the second reply is unused
    expect(fake.calls).toHaveLength(1);
    expect(await exists("npcs/grella.md")).toBe(false);
  });

  test("usage is summed over the correction turn", async () => {
    const fake = useFake([
      { text: npcReply({ content: npcMarkdown({ status: "draft" }) }), usage: usage(1000, 100) },
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
    const bad = npcReply({ content: npcMarkdown({ status: "draft" }) });
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
      const res = await postJson("/api/beispiel/generate/npc", npcBody);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "ANTHROPIC_API_KEY fehlt" });
      expect(await fetchJob()).toBeNull();
    } finally {
      Object.assign(process.env, saved);
    }
  });
});

// --- the shared job model (issue #19 + #21) --------------------------------------

describe("npc generate jobs", () => {
  test("the job carries kind npc, no chapter, and npcResult", async () => {
    const open = gate();
    useFake([replyFor("job-kind")], undefined, open.promise);

    const res = await postJson("/api/beispiel/generate/npc", npcBody);
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };

    const running = await fetchJob();
    expect(running).toMatchObject({ id: jobId, campaign: "beispiel", kind: "npc", status: "running" });
    expect(running!.chapter).toBeUndefined();

    open.open();
    const done = await waitForJob();
    expect(done.kind).toBe("npc");
    expect(done.status).toBe("done");
    expect(done.npcResult!.npc.path).toBe("npcs/job-kind.md");
    // the scene field stays absent — a consumer reads one OR the other
    expect(done.result).toBeUndefined();
    expect(await exists("npcs/job-kind.md")).toBe(false);
  });

  test("ONE generator job per campaign — a scene run blocks an npc start and back", async () => {
    // scene job running -> npc start is a 409 carrying the running job's id.
    // The scene reply itself is junk (this test is about the gate, not the
    // pipeline) — one reply per allowed attempt, so nothing runs dry.
    const open = gate();
    process.env.LLM_CORRECTION_TURNS = "0";
    useFake(["{}"], undefined, open.promise);
    const scene = await postJson("/api/beispiel/generate", {
      chapter: "01-salzhafen",
      sourceText: "Fenn waits at the docks.",
    });
    expect(scene.status).toBe(202);
    const { jobId } = (await scene.json()) as { jobId: string };

    const npc = await postJson("/api/beispiel/generate/npc", npcBody);
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
    const started = await postJson("/api/beispiel/generate/npc", npcBody);
    expect(started.status).toBe(202);
    const second = await postJson("/api/beispiel/generate", {
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
    await postJson("/api/beispiel/generate", {
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

  test("PUT drafts accepts the npc draft path and rejects anything else", async () => {
    useFake([replyFor("job-drafts")]);
    await generateNpc(npcBody);
    const edited = `${npcMarkdown({ id: "job-drafts" })}\nHandgeschriebene Ergänzung.\n`;

    const put = (body: unknown) =>
      app.request("/api/beispiel/generate/job/drafts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await put({ path: "npcs/fremd.md", markdown: edited })).status).toBe(400);
    const res = await put({ path: "npcs/job-drafts.md", markdown: edited });
    expect(res.status).toBe(200);

    const job = await fetchJob();
    expect(job!.draftEdits).toEqual({ "npcs/job-drafts.md": edited });
    // the result itself is untouched — the edit sits next to it
    expect(job!.npcResult!.npc.markdown).not.toBe(edited);
  });
});

// --- POST /api/:campaign/generate/apply with an npc draft ------------------------

describe("apply an npc draft", () => {
  /** Run + apply, the app's flow: the draft of a finished job goes to disk. */
  async function runAndApply(id: string, over: { jobId?: string } = {}): Promise<Response> {
    useFake([replyFor(id)]);
    expect((await generateNpc(npcBody)).status).toBe(200);
    const job = await fetchJob();
    return postJson("/api/beispiel/generate/apply", {
      npc: job!.npcResult!.npc,
      jobId: over.jobId ?? job!.id,
    });
  }

  test("writes npcs/<id>.md and discards the job", async () => {
    const res = await runAndApply("apply-happy");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ written: ["npcs/apply-happy.md"] });
    // the draft is stored — nothing left to restore
    expect(await fetchJob()).toBeNull();

    // …and it is a real npc for the rest of the API: every reviewed field
    // came through, the quoted quickstats included, and `## Beziehungen`
    // (which became relation ROWS) is rendered back into the body
    const written = await read("npcs/apply-happy.md");
    expect(written.kind).toBe("npc");
    expect(written.properties.id).toBe("apply-happy");
    expect(written.properties.name).toBe("Grella");
    expect(written.properties.status).toBe("alive");
    expect(written.properties.quickstats).toEqual({ insight: "+3", deception: "+5" });
    expect(written.properties.statblock).toBe("Roll20: Grella");
    expect(written.body).toContain("> [!secret] Kennt ein zweites Versteck unter dem Kai.");
    expect(written.body).toContain("- jorna: schuldet ihr einen Gefallen");
  });

  test("a stale jobId leaves the job alone", async () => {
    const res = await runAndApply("apply-stale", {
      jobId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(200);
    expect((await fetchJob())!.kind).toBe("npc");
  });

  test("409 when the file exists — nothing overwritten, the job stays", async () => {
    // apply-happy.md was written by the test above
    useFake([replyFor("apply-happy")]);
    // the reply's id collides with an existing npc, so the RUN already fails
    process.env.LLM_CORRECTION_TURNS = "0";
    expect((await generateNpc(npcBody)).status).toBe(422);

    // …and a client that posts the draft anyway gets a 409 with the path
    const before = await read("npcs/apply-happy.md");
    const res = await postJson("/api/beispiel/generate/apply", {
      npc: { path: "npcs/apply-happy.md", markdown: npcMarkdown({ id: "apply-happy" }) },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "target files already exist",
      conflicts: ["npcs/apply-happy.md"],
    });
    const after = await read("npcs/apply-happy.md");
    expect(after.raw).toBe(before.raw);
    expect(after.rev).toBe(before.rev); // the row's rev never moved
  });

  test("400 re-validation: path, id, status, properties — nothing written", async () => {
    const cases: Array<[string, unknown]> = [
      ["path outside npcs/", { path: "locations/x.md", markdown: npcMarkdown({ id: "x" }) }],
      ["path traversal", { path: "npcs/../../etc/x.md", markdown: npcMarkdown({ id: "x" }) }],
      ["uppercase id", { path: "npcs/Grella.md", markdown: npcMarkdown({ id: "Grella" }) }],
      ["id mismatch", { path: "npcs/anders.md", markdown: npcMarkdown({ id: "grella" }) }],
      ["no properties", { path: "npcs/anders.md", markdown: "## Will\n\nnur Text\n" }],
      [
        "invalid status",
        { path: "npcs/anders.md", markdown: npcMarkdown({ id: "anders", status: "draft" }) },
      ],
      [
        "missing status",
        { path: "npcs/anders.md", markdown: npcMarkdown({ id: "anders", status: null }) },
      ],
      ["empty markdown", { path: "npcs/anders.md", markdown: "" }],
      ["unknown key", { path: "npcs/anders.md", markdown: npcMarkdown(), extra: 1 }],
      ["not an object", "npcs/anders.md"],
    ];
    for (const [what, npc] of cases) {
      const res = await postJson("/api/beispiel/generate/apply", { npc });
      expect(res.status, what).toBe(400);
    }
    expect(await exists("npcs/anders.md")).toBe(false);
    expect(await exists("npcs/Grella.md")).toBe(false);
  });

  test("an empty body is still 'nothing to apply'", async () => {
    const res = await postJson("/api/beispiel/generate/apply", { npc: null });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("nothing to apply");
  });
});
