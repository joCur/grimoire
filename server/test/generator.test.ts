// Generator pipeline tests (issue #6). Like the write-API tests they run
// against a TEMP COPY of the example campaign (examples/ is the committed
// format reference and must never be mutated).
//
// No real LLM and no ANTHROPIC_API_KEY: a FakeProvider with scripted raw
// replies is injected via setProviderForTests(). It records every call, so
// the tests can assert the correction-turn mechanics (assistant reply
// replayed + validation errors sent back, LLM_CORRECTION_TURNS turns).
//
// A scripted reply is either a plain string (fine, not truncated, no usage
// reported) or the full CompletionResult shape — that is how the truncation
// fail-fast and the token accounting of issue #18 are exercised.
//
// Since issue #19 the run is a background job, so the pipeline tests go
// through `generate()`: POST /generate (202), poll the job in-process, then
// answer like the old synchronous endpoint did. The job endpoints
// themselves (lifecycle, 409, drafts, apply cleanup, restart) have their own
// describe block at the end; a FakeProvider that waits on a manual gate
// makes "running" observable without a single timer.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GenerateJob, GenerateResult, GenerateUsage } from "@grimoire/shared";
import { app } from "../src/server";
import { getCampaignRoot, setCampaignRoot } from "../src/config";
import { clearJobsForTests } from "../src/generate-jobs";
import {
  DEFAULT_CORRECTION_TURNS,
  MAX_CORRECTION_TURNS,
  RAW_REPLY_LIMIT,
  extractJsonReply,
  parseCorrectionTurns,
  setProviderForTests,
} from "../src/generator";
import type {
  CompletionResult,
  CorrectionTurn,
  GenerateRequest,
  LLMProvider,
  TokenUsage,
} from "../src/llm-provider";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

let tmpRoot = "";
let originalRoot = "";

const absOf = (rel: string) => path.join(tmpRoot, "beispiel", rel);

async function exists(rel: string): Promise<boolean> {
  try {
    await stat(absOf(rel));
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  originalRoot = getCampaignRoot();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "grimoire-generator-"));
  await cp(path.join(EXAMPLES, "beispiel"), path.join(tmpRoot, "beispiel"), { recursive: true });
  setCampaignRoot(tmpRoot);
});

afterAll(async () => {
  setCampaignRoot(originalRoot);
  await rm(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  setProviderForTests(null);
  // No job may leak into the next test (a leftover RUNNING one would 409).
  clearJobsForTests();
  delete process.env.LLM_CORRECTION_TURNS;
});

// --- fake provider ------------------------------------------------------------

interface RecordedCall {
  req: GenerateRequest;
  corrections: CorrectionTurn[];
}

/** A scripted reply: raw text, or text plus truncation/usage signals. */
type ScriptedReply = string | { text: string; truncated?: boolean; usage?: TokenUsage };

/** Scripted provider: returns its replies in order and records every call. */
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

/** A promise the test resolves when it wants the provider to answer. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Same shape the Anthropic/OpenAI usage objects normalize to. */
const usage = (inputTokens: number, outputTokens: number): TokenUsage => ({
  inputTokens,
  outputTokens,
});

// --- fixtures -------------------------------------------------------------------

const SCENE_PATH = "01-salzhafen/hafen/treffen-am-kai.md";

function sceneMarkdown(over: { status?: string; npcs?: string; callout?: string } = {}): string {
  return [
    "---",
    "id: treffen-am-kai",
    "title: Treffen am Kai",
    "type: planned",
    "chapter: 01-salzhafen",
    "location: leuchtturm",
    `npcs: [${over.npcs ?? "fenn, grella"}]`,
    "handouts: []",
    "tags: [social]",
    `status: ${over.status ?? "draft"}`,
    "---",
    "",
    "## Flow",
    "",
    "Fenn wartet am Kai; Grella beobachtet aus dem Schatten.",
    "",
    `> [!${over.callout ?? "readaloud"}] Nebel liegt über dem Kai, ihr hört`,
    "> nur das Knarren der Taue.",
    "",
    "> [!check] Wisdom (Perception) DC 12, um Grella zu bemerken.",
    "",
  ].join("\n");
}

/**
 * An npc stub. `status` defaults to what the prompt asks for (`alive`);
 * `null` drops the key entirely — both are validated since issue #27.
 */
function npcStub(over: { id?: string; name?: string; status?: string | null } = {}): string {
  const status = over.status === undefined ? "alive" : over.status;
  return [
    "---",
    `id: ${over.id ?? "grella"}`,
    `name: ${over.name ?? "Grella"}`,
    "role: Schmugglerin mit eigenen Plänen",
    "chapter: 01-salzhafen",
    ...(status === null ? [] : [`status: ${status}`]),
    "---",
    "",
    "## Will",
    "",
    "Im Quelltext nur erwähnt — Details fehlen.",
    "",
  ].join("\n");
}

const STUB_MARKDOWN = npcStub();

const LOCATION_STUB_PATH = "locations/raeucherkammer.md";

/** A location stub — correct form carries NO status key at all (issue #27). */
function locationStub(over: { status?: string } = {}): string {
  return [
    "---",
    "id: raeucherkammer",
    "name: Die alte Räucherkammer",
    "chapter: 01-salzhafen",
    ...(over.status === undefined ? [] : [`status: ${over.status}`]),
    "---",
    "",
    "## Atmosphäre",
    "",
    "Im Quelltext nur erwähnt — Details fehlen.",
    "",
  ].join("\n");
}

interface ReplyOver {
  scenes?: Array<{ path: string; content: string }>;
  npc_stubs?: Array<{ path: string; content: string; reason?: string }>;
  location_stubs?: Array<{ path: string; content: string; reason?: string }>;
  warnings?: string[];
}

/** The reply's JSON object, bare — what a model SHOULD return (issue #20). */
function replyJson(over: ReplyOver = {}): string {
  const body = {
    scenes: over.scenes ?? [{ path: SCENE_PATH, content: sceneMarkdown() }],
    npc_stubs: over.npc_stubs ?? [
      { path: "npcs/grella.md", content: STUB_MARKDOWN, reason: "im Quelltext erwähnt" },
    ],
    location_stubs: over.location_stubs ?? [],
    warnings: over.warnings ?? ["Quelltext nennt keinen DC — DC 12 gesetzt"],
  };
  return JSON.stringify(body, null, 2);
}

function reply(over: ReplyOver = {}): string {
  // Wrapped in a fence like real models tend to do — the extraction (issue
  // #20, stage b) takes the fence content.
  return "```json\n" + replyJson(over) + "\n```";
}

/**
 * The PO's production reply (issue #20): an English explainer paragraph, a
 * blank line, then the JSON object. Valid JSON the old whole-text parse
 * rejected — three correction turns for a usable answer.
 */
function proseThenJson(json: string): string {
  return [
    "I need to be careful about characters inside string values — the markdown",
    "content contains quotes and newlines that must be escaped properly.",
    "",
    json,
  ].join("\n");
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

const generateBody = { chapter: "01-salzhafen", sourceText: "Fenn waits at the docks." };

// --- job helpers (issue #19) ------------------------------------------------

/** GET the campaign's job, or null on the 404 "there is none". */
async function fetchJob(campaign = "beispiel"): Promise<GenerateJob | null> {
  const res = await app.request(`/api/${campaign}/generate/job`);
  if (res.status === 404) return null;
  expect(res.status).toBe(200);
  return (await res.json()) as GenerateJob;
}

/** PUT one review edit into the job store. */
async function putDraft(campaign: string, body: unknown): Promise<Response> {
  return app.request(`/api/${campaign}/generate/job/drafts`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Poll the in-process app until the job is no longer running. */
async function waitForJob(campaign = "beispiel"): Promise<GenerateJob> {
  for (let i = 0; i < 2000; i++) {
    const job = await fetchJob(campaign);
    if (job === null) throw new Error("job disappeared while waiting");
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("job never finished");
}

/** What the endpoint answered before issue #19, rebuilt over the job flow. */
interface GenerateOutcome {
  status: number;
  json: () => Promise<unknown>;
}

/**
 * Start a run and wait for it: the synchronous view of the job flow, so the
 * pipeline tests keep asserting the pipeline instead of the plumbing.
 * A non-202 answer (400/404/409/503 — all decided BEFORE a job exists) is
 * passed through unchanged.
 */
async function generate(body?: unknown, campaign = "beispiel"): Promise<GenerateOutcome> {
  const res = await postJson(`/api/${campaign}/generate`, body);
  if (res.status !== 202) return { status: res.status, json: () => res.json() };
  expect(await res.json()).toEqual({ jobId: expect.any(String) });
  const job = await waitForJob(campaign);
  if (job.status === "done") return { status: 200, json: async () => job.result };
  return { status: job.error?.status ?? 500, json: async () => job.error?.body };
}

// --- JSON extraction (issue #20) -------------------------------------------------

describe("extractJsonReply", () => {
  const OBJ = { scenes: [{ path: "a.md" }], warnings: ["w"] };
  const JSON_TEXT = JSON.stringify(OBJ, null, 2);
  /** Convenience: the extracted value, or undefined when nothing parsed. */
  const value = (raw: string) => extractJsonReply(raw)?.value;

  test("stage (a): the whole text, leading/trailing whitespace included", () => {
    expect(value(JSON_TEXT)).toEqual(OBJ);
    expect(value(`\n\n${JSON_TEXT}\n  `)).toEqual(OBJ);
    // a parseable non-object still wins the stage — the validation below
    // rejects it with "reply must be a JSON object", not with a parse error
    expect(value("[1, 2]")).toEqual([1, 2]);
    expect(extractJsonReply("null")).toEqual({ value: null });
  });

  test("the exact PO case: explainer paragraph, blank line, then the object", () => {
    expect(value(proseThenJson(JSON_TEXT))).toEqual(OBJ);
  });

  test("stage (b): a ```json fence surrounded by prose", () => {
    const raw = [
      "Hier ist das Ergebnis:",
      "```json",
      JSON_TEXT,
      "```",
      "Ich hoffe, das passt so.",
    ].join("\n");
    expect(value(raw)).toEqual(OBJ);
  });

  test("stage (b): a bare fence works too", () => {
    expect(value("Antwort:\n```\n" + JSON_TEXT + "\n```\n")).toEqual(OBJ);
  });

  test("stage (c): prose before AND after the object", () => {
    const raw = ["Kurze Vorbemerkung.", "", JSON_TEXT, "", "Nachbemerkung ohne Klammern."].join(
      "\n",
    );
    expect(value(raw)).toEqual(OBJ);
  });

  test("braces inside string values do not confuse the first-{-to-last-} span", () => {
    const tricky = {
      scenes: [{ path: "a.md", content: "Text mit { und } und {\"nested\": \"braces\"}" }],
      warnings: ["}{"],
    };
    const raw = `Vorbemerkung.\n\n${JSON.stringify(tricky, null, 2)}\n\nNachwort.`;
    expect(value(raw)).toEqual(tricky);
  });

  test("garbage without a single brace does not parse", () => {
    expect(extractJsonReply("Ich kann diese Aufgabe nicht erfüllen.")).toBeNull();
    expect(extractJsonReply("")).toBeNull();
    expect(extractJsonReply("   \n  ")).toBeNull();
  });

  test("a brace span that is not JSON does not parse either", () => {
    expect(extractJsonReply("Nimm { diesen } Hinweis.")).toBeNull();
    expect(extractJsonReply("```json\nnicht wirklich json\n```")).toBeNull();
  });

  test("a truncated object fails extraction (all three stages)", () => {
    const cut = '{\n  "scenes": [\n    { "path": "01-salzhafen/kai.md", "content": "---\\nid: k';
    expect(extractJsonReply(cut)).toBeNull();
    // …also when the model prefixed it with prose and opened a fence
    expect(extractJsonReply(`Los geht's:\n\n\`\`\`json\n${cut}`)).toBeNull();
  });
});

// --- POST /api/:campaign/generate --------------------------------------------------

describe("POST /api/:campaign/generate", () => {
  test("happy path: GenerateResult from one call, nothing written", async () => {
    const fake = useFake([reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateResult;

    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.path).toBe(SCENE_PATH);
    expect(result.scenes[0]!.markdown).toBe(sceneMarkdown());
    expect(result.scenes[0]!.frontmatter.status).toBe("draft");
    expect(result.scenes[0]!.frontmatter.npcs).toEqual(["fenn", "grella"]);
    expect(result.stubs).toEqual([
      { kind: "npc", id: "grella", name: "Grella", markdown: STUB_MARKDOWN },
    ]);
    expect(result.warnings).toEqual(["Quelltext nennt keinen DC — DC 12 gesetzt"]);
    // this provider reports no usage — then the field stays absent
    expect(result.usage).toBeUndefined();

    // exactly one provider call, no correction turns
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.corrections).toEqual([]);

    // the prompt carried the campaign context and assets
    const req = fake.calls[0]!.req;
    expect(req.context.chapter).toBe("01-salzhafen");
    expect(req.context.npcs.map((n) => n.id).sort()).toEqual(["fenn", "jorna"]);
    expect(req.context.locations.map((l) => l.id)).toEqual(["leuchtturm"]);
    expect(req.glossary).toContain("Leuchtturmwärter");
    expect(req.systemPrompt).toContain("System-Prompt: Szenen-Generator");
    expect(req.fewShotTarget).toContain("id: smuggler-captured");
    expect(req.sourceText).toBe(generateBody.sourceText);

    // review preview only — NOTHING on disk
    expect(await exists(SCENE_PATH)).toBe(false);
    expect(await exists("npcs/grella.md")).toBe(false);
  });

  test("unknown npc without stub triggers a correction turn, then succeeds", async () => {
    const bad = reply({
      scenes: [{ path: SCENE_PATH, content: sceneMarkdown({ npcs: "fenn, nobody" }) }],
      npc_stubs: [],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);

    expect(fake.calls).toHaveLength(2);
    // the correction turn replays the failed reply verbatim ...
    expect(fake.calls[1]!.corrections).toHaveLength(1);
    expect(fake.calls[1]!.corrections[0]!.assistant).toBe(bad);
    // ... and names the mechanical error
    expect(fake.calls[1]!.corrections[0]!.correction).toContain('npc "nobody"');
    expect(await exists(SCENE_PATH)).toBe(false);
  });

  test("unknown callout triggers a correction turn, then succeeds", async () => {
    const bad = reply({
      scenes: [{ path: SCENE_PATH, content: sceneMarkdown({ callout: "danger" }) }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("[!danger]");
  });

  // --- stub status rules (issue #27) -------------------------------------------

  test("npc stub with the SCENE status draft triggers a correction turn, then succeeds", async () => {
    const bad = reply({
      npc_stubs: [{ path: "npcs/grella.md", content: npcStub({ status: "draft" }) }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]!.assistant).toBe(bad);
    const correction = fake.calls[1]!.corrections[0]!.correction;
    expect(correction).toContain('npc stub "npcs/grella.md"');
    expect(correction).toContain("alive, dead, missing, unknown");
    expect(correction).toContain('"alive"');
    // the draft status is the ONLY error — the stub still resolves the
    // scene's npc reference instead of cascading into "npc does not exist"
    expect(correction.match(/^- /gm)).toHaveLength(1);

    // the corrected second reply is the one that got through
    const result = (await res.json()) as GenerateResult;
    expect(result.stubs).toEqual([
      { kind: "npc", id: "grella", name: "Grella", markdown: STUB_MARKDOWN },
    ]);
    expect(await exists("npcs/grella.md")).toBe(false);
  });

  test("npc stub without any status triggers a correction turn", async () => {
    const bad = reply({
      npc_stubs: [{ path: "npcs/grella.md", content: npcStub({ status: null }) }],
    });
    const fake = useFake([bad, reply()]);
    expect((await generate(generateBody)).status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain('"status" fehlt');
  });

  test("location stub with ANY status triggers a correction turn", async () => {
    for (const status of ["draft", "alive"]) {
      const bad = reply({
        location_stubs: [{ path: LOCATION_STUB_PATH, content: locationStub({ status }) }],
      });
      const fake = useFake([bad, reply()]);
      expect((await generate(generateBody)).status).toBe(200);
      expect(fake.calls).toHaveLength(2);
      const correction = fake.calls[1]!.corrections[0]!.correction;
      expect(correction).toContain(`location stub "${LOCATION_STUB_PATH}"`);
      expect(correction).toContain("locations haben keinen status");
    }
  });

  test("prompt-conform stubs pass in ONE call: npc dead/alive, location without status", async () => {
    const fake = useFake([
      reply({
        npc_stubs: [{ path: "npcs/grella.md", content: npcStub({ status: "dead" }) }],
        location_stubs: [{ path: LOCATION_STUB_PATH, content: locationStub() }],
      }),
    ]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
    const result = (await res.json()) as GenerateResult;
    expect(result.stubs.map((s) => `${s.kind}:${s.id}`)).toEqual([
      "npc:grella",
      "location:raeucherkammer",
    ]);
  });

  test("422 with the remaining errors after 2 correction turns", async () => {
    // Two turns is the MAXIMUM, not the default any more (issue #19).
    process.env.LLM_CORRECTION_TURNS = "2";
    const bad = reply({
      scenes: [{ path: SCENE_PATH, content: sceneMarkdown({ status: "ready" }) }],
    });
    // same mechanical error, but distinguishable text — the 422 must carry
    // the LAST attempt's reply, not the first one's
    const last = reply({
      scenes: [{ path: SCENE_PATH, content: sceneMarkdown({ status: "ready" }) }],
      warnings: ["letzter Versuch"],
    });
    const fake = useFake([
      { text: "kein json", usage: usage(1000, 100) },
      { text: bad, usage: usage(2000, 200) },
      { text: last, usage: usage(3000, 300) },
    ]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      validationErrors: string[];
      rawReply: string;
      usage: GenerateUsage;
    };
    expect(body.error).toContain("validation");
    expect(body.validationErrors).toEqual([expect.stringContaining('"status" must be "draft"')]);
    // the raw reply of the LAST attempt, not of the first one
    expect(body.rawReply).toBe(last);
    // summed over all three attempts
    expect(body.usage).toEqual({ inputTokens: 6000, outputTokens: 600, attempts: 3 });

    // initial call + exactly 2 correction turns = 3 provider calls
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("not valid JSON");
    expect(fake.calls[2]!.corrections).toHaveLength(2);
    expect(await exists(SCENE_PATH)).toBe(false);
  });

  // --- truncation fail-fast (issue #18) ---------------------------------------

  test("a truncated reply aborts after ONE call with the LLM_MAX_TOKENS message", async () => {
    const cut = '{"scenes":[{"path":"01-salzhafen/hafen/treffen-am-kai.md","content":"---\\nid: tre';
    const fake = useFake([{ text: cut, truncated: true, usage: usage(9000, 8000) }, reply()], 8000);
    const res = await generate(generateBody);
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
    // truncation is not a form error — no validation error list
    expect(body.validationErrors).toBeUndefined();

    // THE point of the fix: no correction turn, the second reply is unused
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.corrections).toEqual([]);
    expect(await exists(SCENE_PATH)).toBe(false);
  });

  test("without a configured cap the message names the endpoint default", async () => {
    const fake = useFake([{ text: "abgeschnitten", truncated: true }]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; usage?: GenerateUsage };
    expect(body.error).toBe(
      "Antwort wurde vom Modell abgeschnitten — LLM_MAX_TOKENS erhöhen " +
        "(aktuell: Standard des Endpoints) oder Quelltext verkleinern.",
    );
    // no usage reported by the endpoint => no usage in the body
    expect(body.usage).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });

  test("the raw reply in the 422 body is capped and says so", async () => {
    const long = `x${"y".repeat(RAW_REPLY_LIMIT + 500)}`;
    useFake([{ text: long, truncated: true }]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { rawReply: string };
    expect(body.rawReply).toBe(`${long.slice(0, RAW_REPLY_LIMIT)}… [gekürzt]`);
    expect(body.rawReply.startsWith("xyy")).toBe(true);
  });

  test("a reply exactly at the cap is not marked as capped", async () => {
    const exact = "z".repeat(RAW_REPLY_LIMIT);
    useFake([{ text: exact, truncated: true }]);
    const res = await generate(generateBody);
    const body = (await res.json()) as { rawReply: string };
    expect(body.rawReply).toBe(exact);
  });

  test("success carries the run's usage, summed over the correction turn", async () => {
    const bad = reply({
      scenes: [{ path: SCENE_PATH, content: sceneMarkdown({ npcs: "fenn, nobody" }) }],
      npc_stubs: [],
    });
    const fake = useFake([
      { text: bad, usage: usage(5000, 1200) },
      { text: reply(), usage: usage(6400, 1300) },
    ]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateResult;
    expect(result.usage).toEqual({ inputTokens: 11400, outputTokens: 2500, attempts: 2 });
    expect(fake.calls).toHaveLength(2);
  });

  // --- prose around the JSON (issue #20) --------------------------------------

  test("the PO case — explainer paragraph before the object — costs ONE call", async () => {
    const fake = useFake([proseThenJson(replyJson())]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateResult;
    // extraction only loosens the PARSING: the full validation still ran
    expect(result.scenes[0]!.path).toBe(SCENE_PATH);
    expect(result.scenes[0]!.markdown).toBe(sceneMarkdown());
    expect(result.stubs).toEqual([
      { kind: "npc", id: "grella", name: "Grella", markdown: STUB_MARKDOWN },
    ]);
    // no correction turn — that is the whole point of the fix
    expect(fake.calls).toHaveLength(1);
    expect(await exists(SCENE_PATH)).toBe(false);
  });

  test("prose around a fence, and prose on both sides of a bare object, cost ONE call", async () => {
    for (const raw of [
      `Hier ist das Ergebnis:\n\n${reply()}\n\nSag mir, ob das passt.`,
      `Vorbemerkung.\n\n${replyJson()}\n\nNachbemerkung ohne Klammern.`,
    ]) {
      const fake = useFake([raw]);
      const res = await generate(generateBody);
      expect(res.status).toBe(200);
      expect(fake.calls).toHaveLength(1);
    }
  });

  test("extraction does not weaken the validation: prose + invalid draft still corrects", async () => {
    const bad = proseThenJson(
      replyJson({ scenes: [{ path: SCENE_PATH, content: sceneMarkdown({ status: "ready" }) }] }),
    );
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]!.assistant).toBe(bad); // replayed verbatim
    expect(fake.calls[1]!.corrections[0]!.correction).toContain('"status" must be "draft"');
  });

  test("garbage without any brace still triggers the correction turn", async () => {
    const fake = useFake(["Ich kann diese Aufgabe leider nicht erfüllen.", reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("not valid JSON");
  });

  test("the 422 rawReply is the ORIGINAL reply text, not the extracted JSON", async () => {
    const bad = proseThenJson(
      replyJson({ scenes: [{ path: SCENE_PATH, content: sceneMarkdown({ status: "ready" }) }] }),
    );
    const fake = useFake([bad, bad]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { rawReply: string; validationErrors: string[] };
    expect(body.rawReply).toBe(bad);
    expect(body.rawReply.startsWith("I need to be careful")).toBe(true);
    expect(body.validationErrors).toEqual([expect.stringContaining('"status" must be "draft"')]);
    // initial call + the default single correction turn (issue #19)
    expect(fake.calls).toHaveLength(2);
  });

  test("truncation is still checked BEFORE extraction (issue #18 order)", async () => {
    // Extractable, valid JSON — but the transport saw the output cap. The run
    // must still abort after ONE call instead of extracting a maybe-complete
    // object out of a reply the model itself reported as cut off.
    const cut = proseThenJson(replyJson());
    const fake = useFake([{ text: cut, truncated: true, usage: usage(9000, 8000) }, reply()], 8000);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      rawReply: string;
      usage: GenerateUsage;
      validationErrors?: string[];
    };
    expect(body.error).toContain("abgeschnitten");
    expect(body.rawReply).toBe(cut);
    expect(body.usage).toEqual({ inputTokens: 9000, outputTokens: 8000, attempts: 1 });
    expect(body.validationErrors).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });

  test("scene path outside the requested chapter is a validation error", async () => {
    const bad = reply({
      scenes: [{ path: "02-anderswo/kai.md", content: sceneMarkdown() }],
    });
    const fake = useFake([bad, bad]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { validationErrors: string[] };
    expect(body.validationErrors[0]).toContain("01-salzhafen/");
    expect(fake.calls).toHaveLength(2);
  });

  test("400 on malformed bodies — provider never called", async () => {
    const fake = useFake([]);
    const bad = [
      {}, // missing everything
      { chapter: "01-salzhafen" }, // missing sourceText
      { chapter: "", sourceText: "x" }, // empty chapter
      { chapter: "01-salzhafen", sourceText: "  " }, // empty sourceText
      { chapter: "01-salzhafen", sourceText: "x", extra: 1 }, // unknown key
      { chapter: 42, sourceText: "x" }, // chapter not a string
      { chapter: "a/b", sourceText: "x" }, // chapter with a separator
      { chapter: "..", sourceText: "x" }, // traversal
    ];
    for (const b of bad) {
      expect((await generate(b)).status).toBe(400);
    }
    expect(fake.calls).toHaveLength(0);
  });

  test("404 for unknown campaign, unknown chapter, and reserved dirs", async () => {
    const fake = useFake([]);
    expect((await generate(generateBody, "nope")).status).toBe(404);
    expect(
      (await generate({ ...generateBody, chapter: "99-nope" })).status,
    ).toBe(404);
    expect(
      (await generate({ ...generateBody, chapter: "npcs" })).status,
    ).toBe(404);
    expect(fake.calls).toHaveLength(0);
  });

  test("newChapter: true generates into a chapter directory that does not exist yet", async () => {
    const chapter = "02-schmugglerbucht";
    const scenePath = `${chapter}/erste-szene.md`;
    const fake = useFake([
      reply({
        scenes: [
          {
            path: scenePath,
            content: sceneMarkdown({ npcs: "fenn" }).replace(
              "chapter: 01-salzhafen",
              `chapter: ${chapter}`,
            ),
          },
        ],
        npc_stubs: [],
      }),
    ]);
    const res = await generate({
      chapter,
      sourceText: "A hidden cove full of smugglers.",
      newChapter: true,
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateResult;
    expect(result.scenes[0]!.path).toBe(scenePath);

    // context still collected (npcs/locations/glossary are campaign-wide),
    // only the chapter directory is absent
    const req = fake.calls[0]!.req;
    expect(req.context.chapter).toBe(chapter);
    expect(req.context.npcs.map((n) => n.id).sort()).toEqual(["fenn", "jorna"]);
    expect(req.glossary).toContain("Leuchtturmwärter");

    // still a preview: neither the directory nor the scene exist
    expect(await exists(chapter)).toBe(false);
    expect(await exists(scenePath)).toBe(false);
  });

  test("newChapter does not weaken the other chapter checks", async () => {
    const fake = useFake([]);
    // reserved dirs are never chapters, not even new ones
    expect(
      (await generate({ ...generateBody, chapter: "npcs", newChapter: true }))
        .status,
    ).toBe(404);
    // an existing NON-directory of that name is not a chapter either
    expect(
      (
        await generate({
          ...generateBody,
          chapter: "glossary.md",
          newChapter: true,
        })
      ).status,
    ).toBe(404);
    // traversal stays a 400, and the flag itself is type-checked
    expect(
      (await generate({ ...generateBody, chapter: "..", newChapter: true }))
        .status,
    ).toBe(400);
    expect(
      (await generate({ ...generateBody, newChapter: "yes" })).status,
    ).toBe(400);
    // and without the flag a missing chapter is still a 404
    expect(
      (await generate({ ...generateBody, chapter: "02-nowhere" })).status,
    ).toBe(404);
    expect(fake.calls).toHaveLength(0);
  });

  test("503 with the factory message when no provider is configured", async () => {
    setProviderForTests(null);
    const savedKey = process.env.ANTHROPIC_API_KEY;
    const savedProvider = process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_PROVIDER;
    try {
      const res = await generate(generateBody);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "ANTHROPIC_API_KEY fehlt" });
    } finally {
      if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
      if (savedProvider !== undefined) process.env.LLM_PROVIDER = savedProvider;
    }
  });
});

// --- POST /api/:campaign/generate/apply ----------------------------------------------

describe("POST /api/:campaign/generate/apply", () => {
  test("writes the reviewed drafts — GenerateResult pieces pass through verbatim", async () => {
    // What the client sends is what /generate returned (frontmatter/name
    // keys included) — the endpoint accepts the documented shapes as-is.
    const fake = useFake([reply()]);
    const gen = await generate(generateBody);
    const result = (await gen.json()) as GenerateResult;
    expect(fake.calls).toHaveLength(1);

    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: result.scenes,
      stubs: result.stubs,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ written: [SCENE_PATH, "npcs/grella.md"] });

    // exact bytes on disk, status draft included
    const scene = await readFile(absOf(SCENE_PATH), "utf8");
    expect(scene).toBe(sceneMarkdown());
    expect(scene).toContain("\nstatus: draft\n");
    expect(await readFile(absOf("npcs/grella.md"), "utf8")).toBe(STUB_MARKDOWN);

    // and the read API sees them
    const get = await app.request(
      `/api/beispiel/file?path=${encodeURIComponent(SCENE_PATH)}`,
    );
    expect(get.status).toBe(200);
    const file = (await get.json()) as { kind: string; frontmatter: Record<string, unknown> };
    expect(file.kind).toBe("scene");
    expect(file.frontmatter.status).toBe("draft");
  });

  test("409 lists all conflicting paths and writes nothing", async () => {
    const existing = "01-salzhafen/hafen/ankunft-leuchtturm.md";
    const before = await readFile(absOf(existing), "utf8");
    const fresh = "01-salzhafen/hafen/ganz-neu.md";
    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: [
        { path: existing, markdown: sceneMarkdown() },
        { path: fresh, markdown: sceneMarkdown() },
        { path: SCENE_PATH, markdown: sceneMarkdown() }, // written by the previous test
      ],
      stubs: [{ kind: "npc", id: "grella", markdown: STUB_MARKDOWN }], // also exists now
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; conflicts: string[] };
    expect(body.conflicts).toEqual([existing, SCENE_PATH, "npcs/grella.md"]);
    // nothing written, nothing overwritten
    expect(await exists(fresh)).toBe(false);
    expect(await readFile(absOf(existing), "utf8")).toBe(before);
  });

  test("400 on path traversal and unsafe targets — nothing written", async () => {
    const md = sceneMarkdown();
    const bad = [
      { scenes: [{ path: "../evil.md", markdown: md }] },
      { scenes: [{ path: "01-salzhafen/../../evil.md", markdown: md }] },
      { scenes: [{ path: "/etc/evil.md", markdown: md }] },
      { scenes: [{ path: "01-salzhafen/evil.txt", markdown: md }] }, // not .md
      { scenes: [{ path: "toplevel.md", markdown: md }] }, // not inside a chapter
      { scenes: [{ path: "npcs/evil.md", markdown: md }] }, // reserved dir as scene
      { scenes: [{ path: "01-salzhafen/a/b/zu-tief.md", markdown: md }] }, // too deep
      { stubs: [{ kind: "npc", id: "../evil", markdown: STUB_MARKDOWN }] },
      { stubs: [{ kind: "monster", id: "grim", markdown: STUB_MARKDOWN }] },
    ];
    for (const b of bad) {
      expect((await postJson("/api/beispiel/generate/apply", b)).status).toBe(400);
    }
    expect(await exists("../evil.md")).toBe(false);
    expect(await exists("01-salzhafen/a/b/zu-tief.md")).toBe(false);
  });

  test("400 re-validation: broken frontmatter or status != draft", async () => {
    const rel = "01-salzhafen/hafen/nicht-draft.md";
    // status was flipped after review — apply must not trust the client
    let res = await postJson("/api/beispiel/generate/apply", {
      scenes: [{ path: rel, markdown: sceneMarkdown({ status: "ready" }) }],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('"status" must be "draft"');

    // broken YAML block
    res = await postJson("/api/beispiel/generate/apply", {
      scenes: [{ path: rel, markdown: "---\n: [broken\n---\n\nText.\n" }],
    });
    expect(res.status).toBe(400);

    // no frontmatter block at all
    res = await postJson("/api/beispiel/generate/apply", {
      scenes: [{ path: rel, markdown: "## Nur Text\n" }],
    });
    expect(res.status).toBe(400);
    expect(await exists(rel)).toBe(false);
  });

  test("400 re-validation: the stub status rules (issue #27) — nothing written", async () => {
    const brix = { id: "brix", name: "Brix" };
    const cases: Array<[unknown, string]> = [
      // the scene status sneaked into an npc stub after the review
      [
        { kind: "npc", id: "brix", markdown: npcStub({ ...brix, status: "draft" }) },
        "alive, dead, missing, unknown",
      ],
      // npc stub without any status
      [
        { kind: "npc", id: "brix", markdown: npcStub({ ...brix, status: null }) },
        '"status" fehlt',
      ],
      // a location stub must not carry a status key at all
      [
        { kind: "location", id: "raeucherkammer", markdown: locationStub({ status: "alive" }) },
        "locations haben keinen status",
      ],
    ];
    for (const [stub, expected] of cases) {
      const res = await postJson("/api/beispiel/generate/apply", { stubs: [stub] });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(expected);
    }
    expect(await exists("npcs/brix.md")).toBe(false);
    expect(await exists("locations/raeucherkammer.md")).toBe(false);

    // the prompt-conform forms write fine
    const ok = await postJson("/api/beispiel/generate/apply", {
      stubs: [
        { kind: "npc", id: "brix", markdown: npcStub({ ...brix, status: "missing" }) },
        { kind: "location", id: "raeucherkammer", markdown: locationStub() },
      ],
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      written: ["npcs/brix.md", "locations/raeucherkammer.md"],
    });
  });

  test("400 on malformed bodies", async () => {
    const bad = [
      {}, // nothing to apply
      { scenes: [], stubs: [] }, // still nothing to apply
      { scenes: "x" }, // not an array
      { scenes: [{ markdown: "x" }] }, // missing path
      { scenes: [{ path: SCENE_PATH }] }, // missing markdown
      { scenes: [{ path: SCENE_PATH, markdown: "" }] }, // empty markdown
      { scenes: [{ path: SCENE_PATH, markdown: "x", raw: "x" }] }, // unknown item key
      { stubs: [{ kind: "npc", markdown: "x" }] }, // missing id
      { scenes: [], stubs: [], extra: 1 }, // unknown top-level key
      {
        // duplicate targets
        scenes: [
          { path: "01-salzhafen/doppelt.md", markdown: sceneMarkdown() },
          { path: "01-salzhafen/doppelt.md", markdown: sceneMarkdown() },
        ],
      },
    ];
    for (const b of bad) {
      expect((await postJson("/api/beispiel/generate/apply", b)).status).toBe(400);
    }
    expect(await exists("01-salzhafen/doppelt.md")).toBe(false);
  });

  test("404 for an unknown campaign", async () => {
    const res = await postJson("/api/nope/generate/apply", {
      scenes: [{ path: SCENE_PATH, markdown: sceneMarkdown() }],
    });
    expect(res.status).toBe(404);
  });

  // --- new-chapter flow (issue #12) ------------------------------------------

  test("chapter + chapterTitle create _chapter.md once — and never twice", async () => {
    const chapter = "03-neues-kapitel";
    const scenePath = `${chapter}/erste-szene.md`;
    const chapterRel = `${chapter}/_chapter.md`;

    let res = await postJson("/api/beispiel/generate/apply", {
      scenes: [{ path: scenePath, markdown: sceneMarkdown() }],
      chapter,
      chapterTitle: "Kapitel 3: Die Schmugglerbucht",
    });
    expect(res.status).toBe(200);
    // the chapter file comes first — the drafts live inside it
    expect(await res.json()).toEqual({ written: [chapterRel, scenePath] });

    const written = await readFile(absOf(chapterRel), "utf8");
    expect(written).toBe(
      `---\nid: ${chapter}\ntitle: 'Kapitel 3: Die Schmugglerbucht'\nstatus: planned\n---\n`,
    );
    // and the read API sees it as a chapter with its title
    const get = await app.request(`/api/beispiel/file?path=${encodeURIComponent(chapterRel)}`);
    expect(get.status).toBe(200);
    const file = (await get.json()) as { frontmatter: Record<string, unknown> };
    expect(file.frontmatter.title).toBe("Kapitel 3: Die Schmugglerbucht");
    expect(file.frontmatter.status).toBe("planned");

    // second apply into the SAME chapter: the existing _chapter.md is left
    // untouched (not a conflict, not rewritten) — only the new scene lands
    const second = `${chapter}/zweite-szene.md`;
    res = await postJson("/api/beispiel/generate/apply", {
      scenes: [{ path: second, markdown: sceneMarkdown() }],
      chapter,
      chapterTitle: "Ein anderer Titel",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ written: [second] });
    expect(await readFile(absOf(chapterRel), "utf8")).toBe(written);
  });

  test("new-chapter batch stays all-or-nothing: a scene conflict writes no _chapter.md", async () => {
    const chapter = "04-konflikt";
    const existing = "01-salzhafen/hafen/ankunft-leuchtturm.md";
    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: [
        { path: `${chapter}/neu.md`, markdown: sceneMarkdown() },
        { path: existing, markdown: sceneMarkdown() },
      ],
      chapter,
      chapterTitle: "Kapitel 4",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { conflicts: string[] }).conflicts).toEqual([existing]);
    expect(await exists(`${chapter}/_chapter.md`)).toBe(false);
    expect(await exists(chapter)).toBe(false);
  });

  test("400 on half or unusable chapter arguments — nothing written", async () => {
    const md = sceneMarkdown();
    const bad = [
      // the two belong together
      { scenes: [{ path: "05-halb/neu.md", markdown: md }], chapter: "05-halb" },
      { scenes: [{ path: "05-halb/neu.md", markdown: md }], chapterTitle: "Halb" },
      // empty / whitespace-only title
      { scenes: [{ path: "05-halb/neu.md", markdown: md }], chapter: "05-halb", chapterTitle: "  " },
      // unsafe chapter ids
      { scenes: [{ path: "05-halb/neu.md", markdown: md }], chapter: "..", chapterTitle: "X" },
      { scenes: [{ path: "05-halb/neu.md", markdown: md }], chapter: "a/b", chapterTitle: "X" },
      // nothing to apply — a chapter alone is not a draft
      { chapter: "05-halb", chapterTitle: "Halb" },
    ];
    for (const b of bad) {
      expect((await postJson("/api/beispiel/generate/apply", b)).status).toBe(400);
    }
    // reserved dirs are not chapters
    expect(
      (
        await postJson("/api/beispiel/generate/apply", {
          scenes: [{ path: "05-halb/neu.md", markdown: md }],
          chapter: "npcs",
          chapterTitle: "X",
        })
      ).status,
    ).toBe(404);
    expect(await exists("05-halb/neu.md")).toBe(false);
    expect(await exists("05-halb/_chapter.md")).toBe(false);
  });
});

// --- background jobs (issue #19) --------------------------------------------

describe("generate jobs", () => {
  /** A reply into a fresh path, without stubs (npcs/grella.md exists by now). */
  function jobReply(scenePath: string): string {
    return reply({
      scenes: [
        {
          path: scenePath,
          content: sceneMarkdown({ npcs: "fenn" }).replace(
            "id: treffen-am-kai",
            `id: ${fileStem(scenePath)}`,
          ),
        },
      ],
      npc_stubs: [],
    });
  }
  const fileStem = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1, -3);

  test("202 { jobId }, status running, then done — the result waits in the store", async () => {
    const open = gate();
    const scenePath = "01-salzhafen/hafen/job-lifecycle.md";
    const fake = useFake([jobReply(scenePath)], undefined, open.promise);

    const res = await postJson("/api/beispiel/generate", generateBody);
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    expect(jobId).toEqual(expect.any(String));

    // The provider has not answered yet — the job is observably running.
    const running = await fetchJob();
    expect(running).toMatchObject({
      id: jobId,
      campaign: "beispiel",
      chapter: "01-salzhafen",
      status: "running",
      draftEdits: {},
    });
    expect(running!.startedAt).toEqual(expect.any(String));
    expect(running!.finishedAt).toBeUndefined();
    expect(running!.result).toBeUndefined();
    expect(running!.error).toBeUndefined();

    open.open();
    const done = await waitForJob();
    expect(done.status).toBe("done");
    expect(done.id).toBe(jobId);
    expect(done.finishedAt).toEqual(expect.any(String));
    expect(done.result!.scenes[0]!.path).toBe(scenePath);
    expect(done.error).toBeUndefined();
    expect(fake.calls).toHaveLength(1);

    // Still there on the next GET: only apply/discard/a new start remove it.
    expect((await fetchJob())!.id).toBe(jobId);
    // …and nothing was written (the pipeline is still a preview)
    expect(await exists(scenePath)).toBe(false);
  });

  test("a second start while one runs answers 409 with the running jobId", async () => {
    const open = gate();
    useFake([jobReply("01-salzhafen/hafen/job-parallel.md")], undefined, open.promise);

    const first = await postJson("/api/beispiel/generate", generateBody);
    expect(first.status).toBe(202);
    const { jobId } = (await first.json()) as { jobId: string };

    const second = await postJson("/api/beispiel/generate", generateBody);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: "a generate job is already running for this campaign",
      jobId,
    });

    open.open();
    expect((await waitForJob()).id).toBe(jobId);
  });

  test("a failed run keeps the 422 body — rawReply, usage, validationErrors", async () => {
    const bad = reply({
      scenes: [{ path: SCENE_PATH, content: sceneMarkdown({ status: "ready" }) }],
    });
    useFake([
      { text: bad, usage: usage(1000, 100) },
      { text: bad, usage: usage(2000, 200) },
    ]);
    expect((await postJson("/api/beispiel/generate", generateBody)).status).toBe(202);

    const job = await waitForJob();
    expect(job.status).toBe("failed");
    expect(job.result).toBeUndefined();
    expect(job.finishedAt).toEqual(expect.any(String));
    expect(job.error!.status).toBe(422);
    expect(job.error!.body.error).toContain("validation");
    expect(job.error!.body.validationErrors).toEqual([
      expect.stringContaining('"status" must be "draft"'),
    ]);
    expect(job.error!.body.rawReply).toBe(bad);
    expect(job.error!.body.usage).toEqual({ inputTokens: 3000, outputTokens: 300, attempts: 2 });
  });

  test("a truncated run keeps the fail-fast 422 body (issue #18 through the job)", async () => {
    const cut = '{"scenes":[{"path":"01-salzhafen/hafen/x.md","content":"---\\nid: x';
    const fake = useFake([{ text: cut, truncated: true, usage: usage(9000, 8000) }], 8000);
    expect((await postJson("/api/beispiel/generate", generateBody)).status).toBe(202);

    const job = await waitForJob();
    expect(job.status).toBe("failed");
    expect(job.error!.status).toBe(422);
    expect(job.error!.body.error).toContain("abgeschnitten");
    expect(job.error!.body.rawReply).toBe(cut);
    expect(job.error!.body.validationErrors).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });

  test("DELETE discards the job — also a finished one; 404 afterwards", async () => {
    useFake([jobReply("01-salzhafen/hafen/job-delete.md")]);
    await generate(generateBody);
    expect((await fetchJob())!.status).toBe("done");

    const res = await app.request("/api/beispiel/generate/job", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(await fetchJob()).toBeNull();
    // nothing left to discard
    expect(
      (await app.request("/api/beispiel/generate/job", { method: "DELETE" })).status,
    ).toBe(404);
  });

  test("DELETE of a RUNNING job abandons it — its result never lands", async () => {
    const open = gate();
    useFake([jobReply("01-salzhafen/hafen/job-abandon.md")], undefined, open.promise);
    expect((await postJson("/api/beispiel/generate", generateBody)).status).toBe(202);
    expect((await fetchJob())!.status).toBe("running");

    expect(
      (await app.request("/api/beispiel/generate/job", { method: "DELETE" })).status,
    ).toBe(200);
    open.open();
    // Let the abandoned run finish into nothing.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await fetchJob()).toBeNull();
  });

  test("PUT drafts: 404 without a job, 400 for an unknown path, and edits survive", async () => {
    const scenePath = "01-salzhafen/hafen/job-drafts.md";
    const edited = `${sceneMarkdown({ npcs: "fenn" })}\nHandgeschriebene Ergänzung.\n`;

    // no job at all
    let res = await putDraft("beispiel", { path: scenePath, markdown: edited });
    expect(res.status).toBe(404);

    useFake([jobReply(scenePath)]);
    await generate(generateBody);

    // a path that is not part of the result
    res = await putDraft("beispiel", { path: "01-salzhafen/hafen/fremd.md", markdown: edited });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("unknown draft path");

    // malformed bodies
    expect((await putDraft("beispiel", { path: scenePath })).status).toBe(400);
    expect((await putDraft("beispiel", { markdown: edited })).status).toBe(400);
    expect(
      (await putDraft("beispiel", { path: scenePath, markdown: 42 })).status,
    ).toBe(400);
    expect(
      (await putDraft("beispiel", { path: scenePath, markdown: edited, extra: 1 })).status,
    ).toBe(400);

    // the real thing
    res = await putDraft("beispiel", { path: scenePath, markdown: edited });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: scenePath });

    const job = await fetchJob();
    expect(job!.draftEdits).toEqual({ [scenePath]: edited });
    // the result itself is untouched — the edit sits next to it
    expect(job!.result!.scenes[0]!.markdown).not.toBe(edited);

    // last write wins
    expect((await putDraft("beispiel", { path: scenePath, markdown: "---\nid: x\n---\n" })).status)
      .toBe(200);
    expect((await fetchJob())!.draftEdits[scenePath]).toBe("---\nid: x\n---\n");
  });

  test("apply with jobId discards the job; a stale id leaves it alone", async () => {
    const scenePath = "01-salzhafen/hafen/job-apply.md";
    useFake([jobReply(scenePath)]);
    await generate(generateBody);
    const job = await fetchJob();

    // a stale id (a newer run started meanwhile) must not drop this job
    let res = await postJson("/api/beispiel/generate/apply", {
      scenes: [{ path: "01-salzhafen/hafen/job-apply-stale.md", markdown: sceneMarkdown() }],
      jobId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(200);
    expect((await fetchJob())!.id).toBe(job!.id);

    res = await postJson("/api/beispiel/generate/apply", {
      scenes: job!.result!.scenes,
      stubs: [],
      jobId: job!.id,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ written: [scenePath] });
    expect(await exists(scenePath)).toBe(true);
    // the drafts are on disk — there is nothing left to restore
    expect(await fetchJob()).toBeNull();
  });

  test("a FAILED apply keeps the job — the review must stay restorable", async () => {
    const scenePath = "01-salzhafen/hafen/job-apply.md"; // written by the test above
    useFake([jobReply(scenePath)]);
    await generate(generateBody);
    const job = await fetchJob();

    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: job!.result!.scenes,
      stubs: [],
      jobId: job!.id,
    });
    expect(res.status).toBe(409);
    expect((await fetchJob())!.id).toBe(job!.id);
  });

  test("400 for a jobId that is not a string", async () => {
    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: [{ path: "01-salzhafen/hafen/job-badid.md", markdown: sceneMarkdown() }],
      jobId: 7,
    });
    expect(res.status).toBe(400);
    expect(await exists("01-salzhafen/hafen/job-badid.md")).toBe(false);
  });

  test("a new start replaces a finished job", async () => {
    useFake([
      jobReply("01-salzhafen/hafen/job-first.md"),
      jobReply("01-salzhafen/hafen/job-second.md"),
    ]);
    await generate(generateBody);
    const first = await fetchJob();
    expect(first!.status).toBe("done");

    await generate(generateBody);
    const second = await fetchJob();
    expect(second!.status).toBe("done");
    expect(second!.id).not.toBe(first!.id);
    expect(second!.result!.scenes[0]!.path).toBe("01-salzhafen/hafen/job-second.md");
  });

  test("a restarted server has no jobs at all — GET answers 404", async () => {
    useFake([jobReply("01-salzhafen/hafen/job-restart.md")]);
    await generate(generateBody);
    expect((await fetchJob())!.status).toBe("done");

    // The store is the only place jobs live (issue #19 non-goal: no disk).
    clearJobsForTests();
    expect(await fetchJob()).toBeNull();
    const res = await app.request("/api/beispiel/generate/job");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no generate job for this campaign" });
  });

  test("jobs are per campaign — an unknown campaign simply has none", async () => {
    expect(await fetchJob("nope")).toBeNull();
    useFake([jobReply("01-salzhafen/hafen/job-scope.md")]);
    await generate(generateBody);
    expect((await fetchJob("beispiel"))!.status).toBe("done");
    expect(await fetchJob("nope")).toBeNull();
  });
});

// --- LLM_CORRECTION_TURNS (issue #19 AK6) -----------------------------------

describe("LLM_CORRECTION_TURNS", () => {
  test("parses 0..2 and falls back to the default on junk", () => {
    expect(DEFAULT_CORRECTION_TURNS).toBe(1);
    expect(parseCorrectionTurns({})).toBe(1);
    expect(parseCorrectionTurns({ LLM_CORRECTION_TURNS: "0" })).toBe(0);
    expect(parseCorrectionTurns({ LLM_CORRECTION_TURNS: "1" })).toBe(1);
    expect(parseCorrectionTurns({ LLM_CORRECTION_TURNS: "2" })).toBe(MAX_CORRECTION_TURNS);
    expect(parseCorrectionTurns({ LLM_CORRECTION_TURNS: " 2 " })).toBe(2);
    for (const junk of ["", "   ", "3", "-1", "1.5", "viele", "NaN", "true"]) {
      expect(parseCorrectionTurns({ LLM_CORRECTION_TURNS: junk })).toBe(1);
    }
  });

  /** One bad reply per attempt — the run can only end in a 422. */
  function badReplies(count: number): string[] {
    return Array.from({ length: count }, () =>
      reply({ scenes: [{ path: SCENE_PATH, content: sceneMarkdown({ status: "ready" }) }] }),
    );
  }

  test("0: no correction turn at all — one call, then 422", async () => {
    process.env.LLM_CORRECTION_TURNS = "0";
    const fake = useFake(badReplies(1));
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { validationErrors: string[] };
    expect(body.validationErrors).toEqual([
      expect.stringContaining('"status" must be "draft"'),
    ]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.corrections).toEqual([]);
  });

  test("1 (default): one correction turn", async () => {
    const fake = useFake(badReplies(2));
    expect((await generate(generateBody)).status).toBe(422);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections).toHaveLength(1);
  });

  test("2: two correction turns", async () => {
    process.env.LLM_CORRECTION_TURNS = "2";
    const fake = useFake(badReplies(3));
    expect((await generate(generateBody)).status).toBe(422);
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2]!.corrections).toHaveLength(2);
  });

  test("junk keeps the default instead of raising the spend", async () => {
    process.env.LLM_CORRECTION_TURNS = "9";
    const fake = useFake(badReplies(2));
    expect((await generate(generateBody)).status).toBe(422);
    expect(fake.calls).toHaveLength(2);
  });
});
