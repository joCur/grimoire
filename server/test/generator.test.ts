// Generator pipeline tests (issue #6). Since the cutover (issue #57) they run
// against a DATABASE seeded from the example campaign, and the apply step
// writes ROWS — so "was it written?" is asked through the API, never off disk.
// The database is seeded ONCE for the whole file (not per case): several
// cases build on what an earlier one applied (a conflict needs an existing
// entity), exactly as the shared temp copy used to allow.
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
//
// Since issue #23 the job is a ROW, so a "restart" is no longer "drop the
// Map": it is `failInterruptedJobs()` — literally what the boot runs — over
// the same database. That is why the restart cases below call it directly.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { FileResponse, GenerateJob, GenerateResult, GenerateUsage } from "@grimoire/shared";
import { app } from "../src/server";
import { eq } from "drizzle-orm";
import { clearJobsForTests, UNREADABLE_PAYLOAD_MESSAGE } from "../src/generate-jobs";
import { generateJobs } from "../src/db/schema";
import { failInterruptedJobs, RESTART_FAILURE_MESSAGE } from "../src/db/job-boot";
import { getDb } from "../src/store/handle";
import { dropStore, seedStore } from "./support/store";
import {
  DEFAULT_CORRECTION_TURNS,
  MAX_CORRECTION_TURNS,
  RAW_REPLY_LIMIT,
  extractJsonReply,
  parseCorrectionTurns,
  setProviderForTests,
} from "../src/generator";
import type { TokenUsage } from "../src/llm-provider";
import { PipelineFake, type ScriptedReply } from "./support/pipeline-fake";

/**
 * Whether an entity is there: the address resolves through GET /file. That
 * is the successor of the `stat()` this file used — a draft that was applied
 * is a ROW, and the only thing that matters is that the app can open it.
 */
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
  // No job may leak into the next test (a leftover RUNNING one would 409).
  await clearJobsForTests();
  delete process.env.LLM_CORRECTION_TURNS;
});

/** What the server does at boot with the jobs a dead process left behind. */
async function restartServer(): Promise<number> {
  return failInterruptedJobs(await getDb());
}

// --- fake provider ------------------------------------------------------------
//
// Scripted and PIPELINE-AWARE since issue #102 (see support/pipeline-fake.ts):
// a test still writes „first this reply, then that one", and the fake routes
// the script over the outline call, the per-scene call and the per-entry call
// of the run. `fake.calls` is therefore every call of the run; `fake.callsFor`
// narrows it to one part — which is what a per-part correction turn is about.

function useFake(
  replies: ScriptedReply[],
  maxTokens?: number,
  gate?: Promise<unknown>,
): PipelineFake {
  const fake = new PipelineFake(replies, maxTokens, gate);
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

/**
 * The address the server builds for the draft (issue #100): the run's
 * chapter plus the frontmatter `id`. The model names none.
 */
const SCENE_PATH = "01-salzhafen/treffen-am-kai";
/**
 * …and the address it is actually WRITTEN to: the group segment is the
 * draft's `location` (issue #100), so review key and stored address differ
 * whenever a scene names a location.
 */
const SCENE_ADDRESS = "01-salzhafen/leuchtturm/treffen-am-kai";

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
 * The same scene under its own ID. Needed wherever a case applies a SECOND
 * scene: the id is the primary key since the cutover, so reusing
 * `treffen-am-kai` would be a conflict rather than a fresh draft.
 */
function sceneWithId(id: string): string {
  return sceneMarkdown().replace("id: treffen-am-kai", `id: ${id}`);
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

const LOCATION_STUB_ID = "raeucherkammer";

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
  scenes?: Array<{ content: string }>;
  entries?: Array<{ kind?: string; content: string }>;
  warnings?: string[];
}

/** The reply's JSON object, bare — what a model SHOULD return (issue #20). */
function replyJson(over: ReplyOver = {}): string {
  const body = {
    scenes: over.scenes ?? [{ content: sceneMarkdown() }],
    entries: over.entries ?? [{ kind: "npc", content: STUB_MARKDOWN }],
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

/**
 * PATCH the review with one draft edit — the endpoint that replaced
 * `PUT …/job/drafts` (issue #97 review, finding 8). `jobId`/`rev` default to
 * the campaign's current job, which is what every caller here wants.
 */
async function patchReview(
  campaign: string,
  body: Record<string, unknown>,
  over: { jobId?: string; rev?: number } = {},
): Promise<Response> {
  const job = await fetchJob(campaign);
  const jobId = over.jobId ?? job?.id ?? "no-job";
  const rev = over.rev ?? job?.rev ?? 0;
  return app.request(`/api/${campaign}/generate/job/${jobId}/review`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev, ...body }),
  });
}

/** The common case: store the edited markdown of one draft. */
const putDraftEdit = (campaign: string, path: string, markdown: string): Promise<Response> =>
  patchReview(campaign, { edits: { [path]: markdown } });

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
    const cut = '{\n  "scenes": [\n    { "path": "01-salzhafen/kai", "content": "---\\nid: k';
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
    expect(result.scenes[0]!.properties.status).toBe("draft");
    expect(result.scenes[0]!.properties.npcs).toEqual(["fenn", "grella"]);
    expect(result.stubs).toEqual([
      { kind: "npc", id: "grella", name: "Grella", markdown: STUB_MARKDOWN },
    ]);
    expect(result.warnings).toEqual(["Quelltext nennt keinen DC — DC 12 gesetzt"]);
    // this provider reports no usage — then the field stays absent
    expect(result.usage).toBeUndefined();

    // Three provider calls since issue #102 — the outline, the one scene and
    // the one suggested entry — and not a correction turn among them.
    // Sorted: the parts run three at a time (PART_CONCURRENCY), so which of
    // them reaches the provider first is not a promise — only that the
    // outline came first and that each part cost exactly one call.
    expect(fake.calls[0]!.part).toBe("outline");
    expect(fake.calls.map((c) => c.part).sort()).toEqual([
      "grella",
      "outline",
      "treffen-am-kai",
    ]);
    for (const call of fake.calls) expect(call.corrections).toEqual([]);

    // the prompt carried the campaign context and assets
    const req = fake.callsFor("outline")[0]!.req;
    expect(req.context.chapter).toBe("01-salzhafen");
    expect(req.context.npcs.map((n) => n.id).sort()).toEqual(["fenn", "jorna"]);
    // `bucht` is an entry too since issue #100 — the contingency scene
    // names it, and a named location always has a row.
    expect(req.context.locations.map((l) => l.id).sort()).toEqual(["bucht", "leuchtturm"]);
    expect(req.glossary).toContain("Leuchtturmwärter");
    expect(req.systemPrompt).toContain("System-Prompt: Gliederung");
    expect(req.sourceText).toBe(generateBody.sourceText);
    // The per-scene call is the one that carries the scene prompt — in its
    // single-scene mode — plus the outline and the cut source passage.
    const sceneReq = fake.callsFor("treffen-am-kai")[0]!.req;
    expect(sceneReq.systemPrompt).toContain("System-Prompt: Szenen-Generator");
    expect(sceneReq.systemPrompt).toContain("GENAU EINE Szene");
    expect(sceneReq.fewShotTarget).toContain("id: smuggler-captured");
    expect(sceneReq.outline).toContain("treffen-am-kai");
    // WHICH scene this call writes is its own section of the variable half,
    // not a marker inside the (cacheable) outline block.
    expect(sceneReq.outline).not.toContain("DIESE Szene");
    expect(sceneReq.assignment).toContain("treffen-am-kai");
    expect(sceneReq.sourceText).toBe(generateBody.sourceText);

    // review preview only — NOTHING on disk
    expect(await exists(SCENE_PATH)).toBe(false);
    expect(await exists("npcs/grella")).toBe(false);
  });

  test("unknown npc without stub triggers a correction turn, then succeeds", async () => {
    const bad = reply({
      scenes: [{ content: sceneMarkdown({ npcs: "fenn, nobody" }) }],
      entries: [],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);

    // The SCENE part corrected itself; the outline call was untouched by it.
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(2);
    expect(fake.callsFor("outline")).toHaveLength(1);
    // the correction turn replays the failed reply verbatim ...
    expect(scene[1]!.corrections).toHaveLength(1);
    expect(scene[1]!.corrections[0]!.assistant).toBe(bad);
    // ... and names the mechanical error
    expect(scene[1]!.corrections[0]!.correction).toContain('npc "nobody"');
    expect(await exists(SCENE_PATH)).toBe(false);
  });

  test("unknown callout triggers a correction turn, then succeeds", async () => {
    const bad = reply({
      scenes: [{ content: sceneMarkdown({ callout: "danger" }) }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(2);
    expect(scene[1]!.corrections[0]!.correction).toContain("[!danger]");
  });

  // --- the id is the model's ONE addressing decision (issue #100 review) -------
  //
  // The shared parser degrades a missing `id` to the address's last segment,
  // and the validation used to parse the reply under its own PREVIEW LABEL —
  // so an NPC reply with no `id` inherited the id `npc` and was written to
  // `npcs/npc`. A missing id has to be the error it is.

  test("a scene without an id triggers a correction turn that says the id is missing", async () => {
    const bad = reply({
      scenes: [{ content: sceneMarkdown().replace("id: treffen-am-kai\n", "") }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(2);
    const correction = scene[1]!.corrections[0]!.correction;
    expect(correction).toContain('"id" fehlt');
    // The part is named by the id the OUTLINE gave it (issue #102), so the
    // message says which scene is meant instead of an array index.
    expect(correction).toContain('scene "treffen-am-kai"');
    // …and nothing was invented for it.
    expect(correction).not.toContain("treffen-am-kai/");
  });

  test("a suggested entry without an id triggers a correction turn", async () => {
    const bad = reply({
      entries: [{ kind: "npc", content: npcStub().replace("id: grella\n", "") }],
      scenes: [{ content: sceneMarkdown({ npcs: "fenn" }) }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const correction = fake.callsFor("grella")[1]!.corrections[0]!.correction;
    expect(correction).toContain('"id" fehlt');
  });

  // --- stub status rules (issue #27) -------------------------------------------

  test("npc stub with the SCENE status draft triggers a correction turn, then succeeds", async () => {
    const bad = reply({
      entries: [{ kind: "npc", content: npcStub({ status: "draft" }) }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);

    // The ENTRY part corrected itself — the scene part was right first time.
    const entry = fake.callsFor("grella");
    expect(entry).toHaveLength(2);
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(1);
    // The replayed assistant turn is the ENTRY's own reply — the per-part
    // call is what failed, so that is what goes back.
    expect(entry[1]!.corrections[0]!.assistant).toContain("status: draft");
    const correction = entry[1]!.corrections[0]!.correction;
    expect(correction).toContain('npc entry "grella"');
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
    expect(await exists("npcs/grella")).toBe(false);
  });

  test("npc stub without any status triggers a correction turn", async () => {
    const bad = reply({
      entries: [{ kind: "npc", content: npcStub({ status: null }) }],
    });
    const fake = useFake([bad, reply()]);
    expect((await generate(generateBody)).status).toBe(200);
    const entry = fake.callsFor("grella");
    expect(entry).toHaveLength(2);
    expect(entry[1]!.corrections[0]!.correction).toContain('"status" fehlt');
  });

  test("location stub with ANY status triggers a correction turn", async () => {
    for (const status of ["draft", "alive"]) {
      const bad = reply({
        entries: [{ kind: "location", content: locationStub({ status }) }],
      });
      const fake = useFake([
        bad,
        reply({ entries: [{ kind: "location", content: locationStub() }] }),
      ]);
      expect((await generate(generateBody)).status).toBe(200);
      const entry = fake.callsFor(LOCATION_STUB_ID);
      expect(entry).toHaveLength(2);
      const correction = entry[1]!.corrections[0]!.correction;
      expect(correction).toContain(`location entry "${LOCATION_STUB_ID}"`);
      expect(correction).toContain("locations haben keinen status");
    }
  });

  test("prompt-conform stubs pass in ONE call: npc dead/alive, location without status", async () => {
    const fake = useFake([
      reply({
        entries: [
          { kind: "npc", content: npcStub({ status: "dead" }) },
          { kind: "location", content: locationStub() },
        ],
      }),
    ]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    // One call per part and not one more: the outline, the scene, the npc and
    // the location. Sorted, because three parts run at once (PART_CONCURRENCY)
    // and which of them reaches the provider first is not a promise.
    expect(fake.calls.map((c) => c.part).sort()).toEqual([
      "grella",
      "outline",
      LOCATION_STUB_ID,
      "treffen-am-kai",
    ]);
    const result = (await res.json()) as GenerateResult;
    expect(result.stubs.map((s) => `${s.kind}:${s.id}`)).toEqual([
      "npc:grella",
      "location:raeucherkammer",
    ]);
  });

  test("422 with the remaining errors after 2 correction turns", async () => {
    // Two turns is the MAXIMUM, not the default any more (issue #19).
    process.env.LLM_CORRECTION_TURNS = "2";
    // `entries: []` on purpose: the run then has exactly ONE part, so „every
    // part failed" is what the 422 of this case is about. A run with a
    // surviving part is `done` with a failed part — its own case below.
    const bad = reply({
      scenes: [{ content: sceneMarkdown({ status: "ready" }) }],
      entries: [],
    });
    // same mechanical error, but distinguishable text — the 422 must carry
    // the LAST attempt's reply, not the first one's
    const last = reply({
      scenes: [{ content: sceneMarkdown({ status: "ready" }) }],
      entries: [],
      warnings: ["letzter Versuch"],
    });
    const fake = useFake([
      { text: "kein json", usage: usage(1000, 100) },
      { text: bad, usage: usage(2000, 200) },
      { text: last, usage: usage(3000, 300) },
    ]);
    const res = await generate(generateBody);
    // The run has exactly ONE part — the scene — and it failed, so the run
    // failed (a run with a surviving part is `done`; see the pipeline cases).
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      validationErrors: string[];
      rawReply: string;
      usage: GenerateUsage;
    };
    expect(body.error).toContain("validation");
    expect(body.validationErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('"status" must be "draft"')]),
    );
    // the raw reply of the LAST attempt, not of the first one
    expect(body.rawReply).toBe(last);

    // The SCENE part spent its initial call plus exactly 2 correction turns.
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(3);
    expect(scene[1]!.corrections[0]!.correction).toContain("not valid JSON");
    expect(scene[2]!.corrections).toHaveLength(2);
    // The OUTLINE step has correction turns of its own (Zuschnitt 1): the
    // first scripted answer is not JSON, so it took two calls.
    expect(fake.callsFor("outline")).toHaveLength(2);
    // …and the run's usage is summed over every call of every part.
    expect(body.usage.attempts).toBe(fake.calls.length);
    expect(await exists(SCENE_PATH)).toBe(false);
  });

  // --- truncation fail-fast (issue #18) ---------------------------------------

  test("a truncated reply aborts after ONE call with the LLM_MAX_TOKENS message", async () => {
    const cut = '{"scenes":[{"path":"01-salzhafen/hafen/treffen-am-kai","content":"---\\nid: tre';
    const fake = useFake([{ text: cut, truncated: true, usage: usage(9000, 8000) }, reply()], 8000);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code?: string;
      maxTokens?: number;
      error: string;
      rawReply: string;
      usage: GenerateUsage;
      validationErrors?: string[];
    };
    // Language-free since issue #69: the stable code plus the cap as a
    // PARAMETER, and the English fallback text next to them.
    expect(body.code).toBe("llm_truncated");
    expect(body.maxTokens).toBe(8000);
    expect(body.error).toBe(
      "the model's reply was cut off — raise LLM_MAX_TOKENS " +
        "(currently: 8000) or shorten the source text.",
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
    const body = (await res.json()) as {
      code?: string;
      maxTokens?: number;
      error: string;
      usage?: GenerateUsage;
    };
    expect(body.code).toBe("llm_truncated");
    // No cap configured, so none is reported — the app then names the
    // endpoint default itself (i18n/server-errors.ts).
    expect(body.maxTokens).toBeUndefined();
    expect(body.error).toBe(
      "the model's reply was cut off — raise LLM_MAX_TOKENS " +
        "(currently: the endpoint default) or shorten the source text.",
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
      scenes: [{ content: sceneMarkdown({ npcs: "fenn, nobody" }) }],
      entries: [],
    });
    const fake = useFake([
      { text: bad, usage: usage(5000, 1200) },
      { text: reply(), usage: usage(6400, 1300) },
    ]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateResult;
    // Summed over every call of every part, the outline included (issue
    // #102): outline (5000/1200, the script's first reply) + the scene's two
    // attempts + the entry's one.
    expect(result.usage).toEqual({
      inputTokens: 16400,
      outputTokens: 3700,
      attempts: fake.calls.length,
    });
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(2);
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
    // no correction turn on any part — that is the whole point of the fix
    expect(fake.calls).toHaveLength(3);
    for (const call of fake.calls) expect(call.corrections).toEqual([]);
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
      // One call per part, no correction turn anywhere.
      expect(fake.calls).toHaveLength(3);
      for (const call of fake.calls) expect(call.corrections).toEqual([]);
    }
  });

  test("extraction does not weaken the validation: prose + invalid draft still corrects", async () => {
    const bad = proseThenJson(
      replyJson({ scenes: [{ content: sceneMarkdown({ status: "ready" }) }] }),
    );
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(2);
    expect(scene[1]!.corrections[0]!.assistant).toBe(bad); // replayed verbatim
    expect(scene[1]!.corrections[0]!.correction).toContain('"status" must be "draft"');
  });

  test("garbage without any brace still triggers the correction turn", async () => {
    const fake = useFake(["Ich kann diese Aufgabe leider nicht erfüllen.", reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    // Garbage reaches the OUTLINE call first: a run whose outline is not
    // JSON has no parts yet, so that is where the correction turn happens.
    const outline = fake.callsFor("outline");
    expect(outline).toHaveLength(2);
    expect(outline[1]!.corrections[0]!.correction).toContain("not valid JSON");
  });

  test("the 422 rawReply is the ORIGINAL reply text, not the extracted JSON", async () => {
    const bad = proseThenJson(
      replyJson({
        scenes: [{ content: sceneMarkdown({ status: "ready" }) }],
        entries: [],
      }),
    );
    const fake = useFake([bad, bad]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { rawReply: string; validationErrors: string[] };
    expect(body.rawReply).toBe(bad);
    expect(body.rawReply.startsWith("I need to be careful")).toBe(true);
    expect(body.validationErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('"status" must be "draft"')]),
    );
    // initial call + the default single correction turn (issue #19), per part
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(2);
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
      code?: string;
      maxTokens?: number;
      error: string;
      rawReply: string;
      usage: GenerateUsage;
      validationErrors?: string[];
    };
    expect(body.code).toBe("llm_truncated");
    expect(body.rawReply).toBe(cut);
    expect(body.usage).toEqual({ inputTokens: 9000, outputTokens: 8000, attempts: 1 });
    expect(body.validationErrors).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });

  test("a scene id that is no kebab slug is a validation error (#100)", async () => {
    // The model names no address any more — the `id` is all it decides, so
    // that is what the validation is about.
    const bad = reply({
      scenes: [{ content: sceneMarkdown().replace("id: treffen-am-kai", "id: Treffen Am Kai") }],
    });
    const fake = useFake([bad, bad]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { validationErrors: string[] };
    expect(body.validationErrors[0]).toContain("kebab-case id");
    expect(fake.calls).toHaveLength(2);
  });

  test("two scenes with the SAME id are a validation error (#100)", async () => {
    // The id is the primary key AND the address, so a reply that uses one
    // twice describes two entities that cannot both exist.
    const bad = reply({
      scenes: [{ content: sceneMarkdown() }, { content: sceneMarkdown() }],
    });
    const fake = useFake([bad, bad]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { validationErrors: string[] };
    expect(body.validationErrors.some((e) => e.includes("duplicate id"))).toBe(true);
  });

  test("the chapter of a draft's address comes from the RUN, not the reply (#100)", async () => {
    // `chapter:` in the properties is decoration; the address is built from
    // the chapter the request named.
    const fake = useFake([
      reply({
        scenes: [{ content: sceneMarkdown().replace("chapter: 01-salzhafen", "chapter: 99-weg") }],
      }),
    ]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateResult;
    expect(result.scenes[0]!.path).toBe(SCENE_PATH);
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(1);
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
    const scenePath = `${chapter}/treffen-am-kai`;
    const fake = useFake([
      reply({
        scenes: [
          {
            content: sceneMarkdown({ npcs: "fenn" }).replace(
              "chapter: 01-salzhafen",
              `chapter: ${chapter}`,
            ),
          },
        ],
        entries: [],
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

    // still a preview: neither the chapter nor the scene exist
    expect(await exists(`${chapter}/_chapter`)).toBe(false);
    expect(await exists(scenePath)).toBe(false);
  });

  test("newChapter does not weaken the other chapter checks", async () => {
    const fake = useFake([]);
    // reserved dirs are never chapters, not even new ones
    expect(
      (await generate({ ...generateBody, chapter: "npcs", newChapter: true }))
        .status,
    ).toBe(404);
    // The file era also refused `chapter: "glossary"` here, because a
    // FILE of that name existed where the directory would go. There is no
    // file tree left to collide with, so that case is gone — what still
    // guards the chapter id is the reserved-name check above and the
    // traversal check below.
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
    // What the client sends is what /generate returned (properties/name
    // keys included) — the endpoint accepts the documented shapes as-is.
    const fake = useFake([reply()]);
    const gen = await generate(generateBody);
    const result = (await gen.json()) as GenerateResult;
    // outline + scene + entry (issue #102)
    expect(fake.calls).toHaveLength(3);

    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: result.scenes,
      stubs: result.stubs,
    });
    expect(res.status).toBe(200);
    // The review addressed the draft as `<chapter>/<id>`; it is WRITTEN
    // under its location (issue #100).
    expect(await res.json()).toEqual({ written: [SCENE_ADDRESS, "npcs/grella"] });

    // the drafts are entities now — every field the review showed survived
    // the insert, `status: draft` included (that is what the app filters on)
    const scene = await read(SCENE_ADDRESS);
    expect(scene.kind).toBe("scene");
    expect(scene.properties.id).toBe("treffen-am-kai");
    expect(scene.properties.title).toBe("Treffen am Kai");
    expect(scene.properties.status).toBe("draft");
    expect(scene.properties.npcs).toEqual(["fenn", "grella"]);
    expect(scene.properties.tags).toEqual(["social"]);
    expect(scene.body).toContain("> [!readaloud] Nebel liegt über dem Kai");
    expect(scene.body).toContain("> [!check] Wisdom (Perception) DC 12");

    const stub = await read("npcs/grella");
    expect(stub.kind).toBe("npc");
    expect(stub.properties.name).toBe("Grella");
    expect(stub.properties.status).toBe("alive");
    expect(stub.body).toContain("## Will");
  });

  test("409 lists all conflicting paths and writes nothing", async () => {
    // The conflict is decided by ID (draftTargetExists) and REPORTED under
    // the path the client sent — `<chapter>/<id>`, the only scene target
    // shape a client may send since issue #100.
    const existing = "01-salzhafen/lighthouse-arrival";
    const before = await read("01-salzhafen/leuchtturm/lighthouse-arrival");
    const fresh = "01-salzhafen/ganz-neu";
    // The free draft needs its own ID, not just its own file name: two
    // entities cannot share an id, so an id already in use would make this
    // one a conflict as well.
    const freshMarkdown = sceneWithId("ganz-neu");
    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: [
        { path: existing, markdown: sceneWithId("lighthouse-arrival") },
        { path: fresh, markdown: freshMarkdown },
        { path: SCENE_PATH, markdown: sceneMarkdown() }, // written by the previous test
      ],
      stubs: [{ kind: "npc", id: "grella", markdown: STUB_MARKDOWN }], // also exists now
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; conflicts: string[] };
    expect(body.conflicts).toEqual([existing, SCENE_PATH, "npcs/grella"]);
    // nothing written, nothing overwritten
    expect(await exists("01-salzhafen/leuchtturm/ganz-neu")).toBe(false);
    const after = await read("01-salzhafen/leuchtturm/lighthouse-arrival");
    expect(after.raw).toBe(before.raw);
    expect(after.rev).toBe(before.rev); // the row's rev never moved
  });

  test("422 when a draft's `id` cannot be addressed — nothing written", async () => {
    // The `id` BECOMES the primary key, and for a scene also the id segment
    // of its address. Taken on trust, `id: a/b` inserted a row whose address
    // parses as a completely different path — content written and lost in
    // the same request. Refused now, with the reason in the message.
    const bad = ["a/b", "Gross", "trailing-", "../evil", "mit leerzeichen"];
    for (const [index, id] of bad.entries()) {
      const rel = `01-salzhafen/unaddressable-${index}`;
      const res = await postJson("/api/beispiel/generate/apply", {
        scenes: [{ path: rel, markdown: sceneWithId(id) }],
      });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toContain("id");
      expect(await exists(rel)).toBe(false);
    }
  });

  test("an EMPTY id degrades to the file name, as the parser always did", async () => {
    // `id: ""` never reaches the store as an empty key: shared/parse.ts falls
    // a missing or empty id back to the file stem, which is the only stable
    // identity such a draft has. So this is addressable and applies — the
    // guard above is about ids that are present and unusable.
    const rel = "01-salzhafen/leere-id";
    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: [{ path: rel, markdown: sceneMarkdown().replace("id: treffen-am-kai", 'id: ""') }],
    });
    expect(res.status).toBe(200);
    expect((await read("01-salzhafen/leuchtturm/leere-id")).properties.id).toBe("leere-id");
  });

  // There is no extension rule any more (issue #79): an address carries
  // none, and what a draft is ADDRESSED as comes from its `id` anyway
  // (assertDraftId). So the cases below are the ones that are still unsafe:
  // traversal, absolute, a reserved directory, the wrong depth.
  test("400 on path traversal and unsafe targets — nothing written", async () => {
    const md = sceneMarkdown();
    const bad = [
      { scenes: [{ path: "../evil.md", markdown: md }] },
      { scenes: [{ path: "01-salzhafen/../../evil", markdown: md }] },
      { scenes: [{ path: "/etc/evil.md", markdown: md }] },
      { scenes: [{ path: "toplevel.md", markdown: md }] }, // not inside a chapter
      { scenes: [{ path: "npcs/evil", markdown: md }] }, // reserved dir as scene
      { scenes: [{ path: "01-salzhafen/a/b/zu-tief", markdown: md }] }, // too deep
      // A GROUP segment is no longer the client's to pick (issue #100): the
      // group is the draft's `location`, so a three-segment target is a
      // client naming a grouping of its own.
      { scenes: [{ path: "01-salzhafen/hafen/gruppe-selbst-gewaehlt", markdown: md }] },
      { stubs: [{ kind: "npc", id: "../evil", markdown: STUB_MARKDOWN }] },
      { stubs: [{ kind: "monster", id: "grim", markdown: STUB_MARKDOWN }] },
    ];
    for (const b of bad) {
      expect((await postJson("/api/beispiel/generate/apply", b)).status).toBe(400);
    }
    expect(await exists("../evil.md")).toBe(false);
    expect(await exists("01-salzhafen/a/b/zu-tief")).toBe(false);
  });

  test("400 re-validation: broken properties or status != draft", async () => {
    const rel = "01-salzhafen/nicht-draft";
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

    // no properties block at all
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
    expect(await exists("npcs/brix")).toBe(false);
    expect(await exists("locations/raeucherkammer")).toBe(false);

    // the prompt-conform forms write fine
    const ok = await postJson("/api/beispiel/generate/apply", {
      stubs: [
        { kind: "npc", id: "brix", markdown: npcStub({ ...brix, status: "missing" }) },
        { kind: "location", id: "raeucherkammer", markdown: locationStub() },
      ],
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      written: ["npcs/brix", "locations/raeucherkammer"],
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
          { path: "01-salzhafen/doppelt", markdown: sceneMarkdown() },
          { path: "01-salzhafen/doppelt", markdown: sceneMarkdown() },
        ],
      },
    ];
    for (const b of bad) {
      expect((await postJson("/api/beispiel/generate/apply", b)).status).toBe(400);
    }
    expect(await exists("01-salzhafen/doppelt")).toBe(false);
  });

  /**
   * TWO drafts, ONE row (issue #100 review): a scene's address carries its
   * `location`, so the same id under two locations produced two DIFFERENT
   * addresses. The duplicate check keyed on the address let the pair through,
   * and the insert then filled one row twice — last write wins, and the
   * review reported a clean apply for content it had silently dropped.
   */
  test("400 for two scene drafts with the same id under different locations", async () => {
    const markdown = sceneWithId("doppelter-ort");
    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: [
        { path: "01-salzhafen/doppelter-ort", markdown },
        {
          path: "01-salzhafen/doppelter-ort",
          markdown: markdown.replace("location: leuchtturm", "location: hafen"),
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("duplicate target path");
    // Neither address exists — nothing was written at all.
    expect(await exists("01-salzhafen/leuchtturm/doppelter-ort")).toBe(false);
    expect(await exists("01-salzhafen/hafen/doppelter-ort")).toBe(false);
  });

  /**
   * The last segment of a scene path IS the id whenever the properties carry
   * none (issue #79 review) — so a path segment that is not a slug has to be
   * rejected at the door, or the insert stores a row whose id ("foo.md")
   * contradicts the address contract and nothing can open it again.
   */
  test("400 for a scene path whose last segment is not a slug", async () => {
    const noId = sceneMarkdown().replace("id: treffen-am-kai\n", "");
    for (const path of ["01-salzhafen/foo.md", "01-salzhafen/hafen/foo.md", "01-salzhafen/Foo"]) {
      const res = await postJson("/api/beispiel/generate/apply", {
        scenes: [{ path, markdown: noId }],
      });
      expect(res.status).toBe(400);
      expect(await exists(path)).toBe(false);
      expect(await exists(path.replace(/\.md$/, ""))).toBe(false);
    }
  });

  test("404 for an unknown campaign", async () => {
    const res = await postJson("/api/nope/generate/apply", {
      scenes: [{ path: SCENE_PATH, markdown: sceneMarkdown() }],
    });
    expect(res.status).toBe(404);
  });

  // --- new-chapter flow (issue #12) ------------------------------------------

  test("chapter + chapterTitle create _chapter once — and never twice", async () => {
    const chapter = "03-neues-kapitel";
    const scenePath = `${chapter}/erste-szene`;
    const chapterRel = `${chapter}/_chapter`;

    let res = await postJson("/api/beispiel/generate/apply", {
      scenes: [{ path: scenePath, markdown: sceneWithId("erste-szene") }],
      chapter,
      chapterTitle: "Kapitel 3: Die Schmugglerbucht",
    });
    expect(res.status).toBe(200);
    // the chapter file comes first — the drafts live inside it
    expect(await res.json()).toEqual({
      written: [chapterRel, `${chapter}/leuchtturm/erste-szene`],
    });

    // the chapter row carries the title the app sent, and the `planned`
    // status the generator gives a chapter it created (never `active`)
    const written = await read(chapterRel);
    expect(written.kind).toBe("chapter");
    expect(written.properties.id).toBe(chapter);
    expect(written.properties.title).toBe("Kapitel 3: Die Schmugglerbucht");
    expect(written.properties.status).toBe("planned");

    // second apply into the SAME chapter: the existing _chapter is left
    // untouched (not a conflict, not rewritten) — only the new scene lands
    const second = `${chapter}/zweite-szene`;
    res = await postJson("/api/beispiel/generate/apply", {
      scenes: [{ path: second, markdown: sceneWithId("zweite-szene") }],
      chapter,
      chapterTitle: "Ein anderer Titel",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ written: [`${chapter}/leuchtturm/zweite-szene`] });
    const again = await read(chapterRel);
    expect(again.properties.title).toBe(written.properties.title);
    expect(again.rev).toBe(written.rev); // not even a rev bump
  });

  test("new-chapter batch stays all-or-nothing: a scene conflict writes no _chapter", async () => {
    const chapter = "04-konflikt";
    const existing = "01-salzhafen/lighthouse-arrival";
    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: [
        { path: `${chapter}/neu`, markdown: sceneWithId("konflikt-neu") },
        { path: existing, markdown: sceneMarkdown() },
      ],
      chapter,
      chapterTitle: "Kapitel 4",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { conflicts: string[] }).conflicts).toEqual([existing]);
    expect(await exists(`${chapter}/_chapter`)).toBe(false);
    expect(await exists(`${chapter}/leuchtturm/konflikt-neu`)).toBe(false);
  });

  test("400 on half or unusable chapter arguments — nothing written", async () => {
    const md = sceneMarkdown();
    const bad = [
      // the two belong together
      { scenes: [{ path: "05-halb/neu", markdown: md }], chapter: "05-halb" },
      { scenes: [{ path: "05-halb/neu", markdown: md }], chapterTitle: "Halb" },
      // empty / whitespace-only title
      { scenes: [{ path: "05-halb/neu", markdown: md }], chapter: "05-halb", chapterTitle: "  " },
      // unsafe chapter ids
      { scenes: [{ path: "05-halb/neu", markdown: md }], chapter: "..", chapterTitle: "X" },
      { scenes: [{ path: "05-halb/neu", markdown: md }], chapter: "a/b", chapterTitle: "X" },
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
          scenes: [{ path: "05-halb/neu", markdown: md }],
          chapter: "npcs",
          chapterTitle: "X",
        })
      ).status,
    ).toBe(404);
    expect(await exists("05-halb/neu")).toBe(false);
    expect(await exists("05-halb/_chapter")).toBe(false);
  });
});

// --- background jobs (issue #19) --------------------------------------------

describe("generate jobs", () => {
  /** A reply into a fresh path, without stubs (npcs/grella exists by now). */
  function jobReply(scenePath: string): string {
    return reply({
      scenes: [
        {
          content: sceneMarkdown({ npcs: "fenn" }).replace(
            "id: treffen-am-kai",
            `id: ${addressId(scenePath)}`,
          ),
        },
      ],
      entries: [],
    });
  }
  /** Last segment of an address — the entity id (issue #79: no extension). */
  const addressId = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);
  /**
   * The address a `<chapter>/<id>` review key is WRITTEN to: the fixture's
   * scenes all carry `location: leuchtturm`, and the group is the location
   * (issue #100).
   */
  const withLocation = (rel: string) =>
    `${rel.slice(0, rel.indexOf("/"))}/leuchtturm/${addressId(rel)}`;

  test("202 { jobId }, status running, then done — the result waits in the store", async () => {
    const open = gate();
    const scenePath = "01-salzhafen/job-lifecycle";
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
    // outline + the one scene (this reply proposes no entries)
    expect(fake.calls).toHaveLength(2);

    // Still there on the next GET: only apply/discard/a new start remove it.
    expect((await fetchJob())!.id).toBe(jobId);
    // …and nothing was written (the pipeline is still a preview)
    expect(await exists(scenePath)).toBe(false);
  });

  test("a second start while one runs answers 409 with the running jobId", async () => {
    const open = gate();
    useFake([jobReply("01-salzhafen/job-parallel")], undefined, open.promise);

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
    // One part only (`entries: []`), and it fails: then the whole run failed
    // and answers exactly the 422 the synchronous endpoint used to answer.
    const bad = reply({
      scenes: [{ content: sceneMarkdown({ status: "ready" }) }],
      entries: [],
    });
    const fake = useFake([
      { text: bad, usage: usage(1000, 100) },
      { text: bad, usage: usage(2000, 200) },
    ]);
    expect((await postJson("/api/beispiel/generate", generateBody)).status).toBe(202);

    const job = await waitForJob();
    expect(job.status).toBe("failed");
    expect(job.finishedAt).toEqual(expect.any(String));
    expect(job.error!.status).toBe(422);
    expect(job.error!.body.error).toContain("validation");
    expect(job.error!.body.validationErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('"status" must be "draft"')]),
    );
    expect(job.error!.body.rawReply).toBe(bad);
    // Summed over every call of the run — the outline's included.
    expect(job.error!.body.usage).toEqual({
      inputTokens: 3000,
      outputTokens: 300,
      attempts: fake.calls.length,
    });
    // The part itself says what happened, which is what „Erneut versuchen"
    // hangs off (issue #102).
    expect(job.pipeline!.parts).toEqual([
      expect.objectContaining({
        key: "scene:treffen-am-kai",
        kind: "scene",
        status: "failed",
        error: expect.stringContaining("validation"),
      }),
    ]);
  });

  test("a truncated run keeps the fail-fast 422 body (issue #18 through the job)", async () => {
    const cut = '{"scenes":[{"path":"01-salzhafen/hafen/x","content":"---\\nid: x';
    const fake = useFake([{ text: cut, truncated: true, usage: usage(9000, 8000) }], 8000);
    expect((await postJson("/api/beispiel/generate", generateBody)).status).toBe(202);

    const job = await waitForJob();
    expect(job.status).toBe("failed");
    expect(job.error!.status).toBe(422);
    expect(job.error!.body.code).toBe("llm_truncated");
    expect(job.error!.body.rawReply).toBe(cut);
    expect(job.error!.body.validationErrors).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });

  test("DELETE discards the job — also a finished one; 404 afterwards", async () => {
    useFake([jobReply("01-salzhafen/job-delete")]);
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
    useFake([jobReply("01-salzhafen/job-abandon")], undefined, open.promise);
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

  test("review edits: 404 without a job, 400 for an unknown path, and edits survive", async () => {
    const scenePath = "01-salzhafen/job-drafts";
    const edited = `${sceneMarkdown({ npcs: "fenn" })}\nHandgeschriebene Ergänzung.\n`;

    // no job at all
    let res = await putDraftEdit("beispiel", scenePath, edited);
    expect(res.status).toBe(404);

    useFake([jobReply(scenePath)]);
    await generate(generateBody);

    // a path that is not part of the result (issue #97 review, finding 8:
    // the review patch used to store any key it was handed)
    res = await putDraftEdit("beispiel", "01-salzhafen/fremd", edited);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("unknown draft path");
    expect((await fetchJob())!.draftEdits).toEqual({});

    // malformed bodies
    expect((await patchReview("beispiel", { edits: { [scenePath]: 42 } })).status).toBe(400);
    expect((await patchReview("beispiel", { edits: edited })).status).toBe(400);
    expect(
      (await patchReview("beispiel", { edits: { [scenePath]: edited }, extra: 1 })).status,
    ).toBe(400);

    // the real thing
    res = await putDraftEdit("beispiel", scenePath, edited);
    expect(res.status).toBe(200);

    const job = await fetchJob();
    expect(job!.draftEdits).toEqual({ [scenePath]: edited });
    // the result itself is untouched — the edit sits next to it
    expect(job!.result!.scenes[0]!.markdown).not.toBe(edited);

    // last write wins
    const rewritten = `${sceneMarkdown({ npcs: "fenn" })}\nNoch einmal anders.\n`;
    expect((await putDraftEdit("beispiel", scenePath, rewritten)).status).toBe(200);
    expect((await fetchJob())!.draftEdits[scenePath]).toBe(rewritten);
  });

  test("apply with jobId discards the job; a stale id leaves it alone", async () => {
    const scenePath = "01-salzhafen/job-apply";
    useFake([jobReply(scenePath)]);
    await generate(generateBody);
    const job = await fetchJob();

    // a stale id (a newer run started meanwhile) must not drop this job
    let res = await postJson("/api/beispiel/generate/apply", {
      scenes: [
        { path: "01-salzhafen/job-apply-stale", markdown: sceneWithId("job-apply-stale") },
      ],
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
    expect(await res.json()).toEqual({ written: [withLocation(scenePath)] });
    expect(await exists(scenePath)).toBe(true);
    // the drafts are on disk — there is nothing left to restore
    expect(await fetchJob()).toBeNull();
  });

  test("a FAILED apply keeps the job — the review must stay restorable", async () => {
    const scenePath = "01-salzhafen/job-apply"; // written by the test above
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
      scenes: [{ path: "01-salzhafen/job-badid", markdown: sceneMarkdown() }],
      jobId: 7,
    });
    expect(res.status).toBe(400);
    expect(await exists("01-salzhafen/job-badid")).toBe(false);
  });

  test("a new start replaces a finished job", async () => {
    useFake([
      jobReply("01-salzhafen/job-first"),
      jobReply("01-salzhafen/job-second"),
    ]);
    await generate(generateBody);
    const first = await fetchJob();
    expect(first!.status).toBe("done");

    await generate(generateBody);
    const second = await fetchJob();
    expect(second!.status).toBe("done");
    expect(second!.id).not.toBe(first!.id);
    expect(second!.result!.scenes[0]!.path).toBe("01-salzhafen/job-second");
  });

  // --- surviving a restart (issue #23) --------------------------------------

  test("a FINISHED job survives a restart whole — result, edits, applyable", async () => {
    const scenePath = "01-salzhafen/job-restart";
    const edited = `${sceneMarkdown({ npcs: "fenn" })}\nNach dem Neustart noch da.\n`;
    useFake([jobReply(scenePath)]);
    await generate(generateBody);
    const before = (await fetchJob())!;
    expect(before.status).toBe("done");
    expect((await putDraftEdit("beispiel", scenePath, edited)).status).toBe(200);

    // The boot touches nothing that already finished.
    expect(await restartServer()).toBe(0);

    const after = (await fetchJob())!;
    expect(after.id).toBe(before.id);
    expect(after.status).toBe("done");
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.finishedAt).toBe(before.finishedAt);
    expect(after.kind).toBe("scene");
    expect(after.chapter).toBe("01-salzhafen");
    expect(after.result).toEqual(before.result!);
    expect(after.draftEdits).toEqual({ [scenePath]: edited });

    // …and it can still be applied, which is the whole point of keeping it.
    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: after.result!.scenes,
      stubs: [],
      jobId: after.id,
    });
    expect(res.status).toBe(200);
    expect(await exists(scenePath)).toBe(true);
    expect(await fetchJob()).toBeNull();
  });

  test("a RUNNING job cannot survive — the boot fails it with a German message", async () => {
    const open = gate();
    useFake([jobReply("01-salzhafen/job-interrupted")], undefined, open.promise);
    expect((await postJson("/api/beispiel/generate", generateBody)).status).toBe(202);
    const started = (await fetchJob())!;
    expect(started.status).toBe("running");

    // The process that owned that provider call is gone.
    expect(await restartServer()).toBe(1);

    const failed = (await fetchJob())!;
    expect(failed.id).toBe(started.id);
    expect(failed.status).toBe("failed");
    expect(failed.finishedAt).toEqual(expect.any(String));
    expect(failed.error!.status).toBe(503);
    expect(failed.error!.body.error).toBe(RESTART_FAILURE_MESSAGE);
    expect(failed.result).toBeUndefined();

    // The abandoned run finishing later must NOT resurrect the job as done.
    open.open();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await fetchJob())!.status).toBe("failed");
  });

  test("a discarded job stays gone across a restart — GET answers 404", async () => {
    useFake([jobReply("01-salzhafen/job-discarded")]);
    await generate(generateBody);
    expect(
      (await app.request("/api/beispiel/generate/job", { method: "DELETE" })).status,
    ).toBe(200);

    expect(await restartServer()).toBe(0);
    const res = await app.request("/api/beispiel/generate/job");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no generate job for this campaign" });
  });

  // --- a row that cannot be read (issue #62 review) -------------------------

  test("a done job with an unreadable result is served as FAILED and can be discarded", async () => {
    useFake([jobReply("01-salzhafen/job-unreadable")]);
    await generate(generateBody);
    const before = (await fetchJob())!;
    expect(before.status).toBe("done");

    // Whatever broke the column (a truncated write, a hand-edited database):
    // the payload no longer parses.
    const db = await getDb();
    db.update(generateJobs).set({ result: "{not json" }).where(eq(generateJobs.id, before.id)).run();

    const job = (await fetchJob())!;
    expect(job.id).toBe(before.id);
    // NOT "done with no result" — that would render a review with no drafts
    // and no way out; it is a failure with a message the DM can act on.
    expect(job.status).toBe("failed");
    expect(job.result).toBeUndefined();
    expect(job.error!.body.error).toBe(UNREADABLE_PAYLOAD_MESSAGE);

    // …and the promise of that message holds: discarding works.
    expect((await app.request("/api/beispiel/generate/job", { method: "DELETE" })).status).toBe(200);
    expect(await fetchJob()).toBeNull();
  });

  test("a failed job with an unreadable error body still carries a message", async () => {
    useFake([jobReply("01-salzhafen/job-unreadable-error")]);
    await generate(generateBody);
    const before = (await fetchJob())!;
    const db = await getDb();
    db.update(generateJobs)
      .set({ status: "failed", result: null, error: "" })
      .where(eq(generateJobs.id, before.id))
      .run();

    const job = (await fetchJob())!;
    expect(job.status).toBe("failed");
    expect(job.error!.status).toBe(500);
    expect(job.error!.body.error).toBe(UNREADABLE_PAYLOAD_MESSAGE);
  });

  // --- a row written BEFORE the address upgrade (issue #79 review) ---------

  test("a persisted job with legacy .md draft paths is normalized on the way out", async () => {
    // The row an old process left behind: paths WITH the file suffix, in the
    // result AND as the draftEdits key. Written directly — no old build to
    // run — which is exactly the situation after the deploy.
    const legacyScene = "01-salzhafen/legacy-scene.md";
    const legacyNpc = "npcs/legacy-npc.md";
    const npcMarkdown = [
      "---",
      "id: legacy-npc",
      "name: Legacy Npc",
      "status: alive",
      "---",
      "",
      "## Notizen",
      "",
    ].join("\n");
    const db = await getDb();
    db.insert(generateJobs)
      .values({
        id: "legacy-row",
        campaignId: "beispiel",
        kind: "npc",
        status: "done",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        result: JSON.stringify({
          scenes: [{ path: legacyScene, markdown: sceneWithId("legacy-scene"), properties: {} }],
          stubs: [],
          warnings: [],
        }),
        npcResult: JSON.stringify({
          npc: { path: legacyNpc, markdown: npcMarkdown, properties: { id: "legacy-npc" } },
          warnings: [],
        }),
        draftEdits: JSON.stringify({ [legacyNpc]: npcMarkdown }),
      })
      .run();

    const job = (await fetchJob())!;
    expect(job.npcResult!.npc.path).toBe("npcs/legacy-npc");
    expect(job.result!.scenes[0]!.path).toBe("01-salzhafen/legacy-scene");
    expect(Object.keys(job.draftEdits)).toEqual(["npcs/legacy-npc"]);

    // …and the edit store accepts the normalized path (it used to 400 on
    // both spellings: the stored one is unknown, the new one had no draft).
    expect((await putDraftEdit("beispiel", "npcs/legacy-npc", npcMarkdown)).status).toBe(200);

    // The point of all of it: "Übernehmen" works, under the new address.
    const res = await postJson("/api/beispiel/generate/apply", {
      npc: job.npcResult!.npc,
      jobId: job.id,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ written: ["npcs/legacy-npc"] });
    expect(await exists("npcs/legacy-npc")).toBe(true);
  });

  // --- a row written BEFORE the group cutover (issue #100 review) ----------

  test("a persisted job with a three-segment scene draft path is collapsed", async () => {
    // The row a pre-#100 process left behind: the scene draft's path carries
    // the GROUP segment the model used to choose. `applySceneTarget` answers
    // 400 for that shape now, so without this normalization the job could
    // never be applied again — it would sit there for good.
    const legacy = "01-salzhafen/hafen/legacy-grouped";
    const markdown = sceneWithId("legacy-grouped");
    const db = await getDb();
    db.insert(generateJobs)
      .values({
        id: "legacy-grouped-row",
        campaignId: "beispiel",
        kind: "scene",
        chapter: "01-salzhafen",
        status: "done",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        result: JSON.stringify({
          scenes: [{ path: legacy, markdown, properties: { id: "legacy-grouped" } }],
          stubs: [],
          warnings: [],
        }),
        draftEdits: JSON.stringify({ [legacy]: markdown }),
        review: JSON.stringify({
          entries: {},
          dropped: ["01-salzhafen/hafen/legacy-dropped"],
          fields: {},
          blocks: {},
          written: { "01-salzhafen/hafen/legacy-written": "01-salzhafen/hafen/legacy-written" },
        }),
      })
      .run();

    const job = (await fetchJob())!;
    expect(job.result!.scenes[0]!.path).toBe("01-salzhafen/legacy-grouped");
    expect(Object.keys(job.draftEdits)).toEqual(["01-salzhafen/legacy-grouped"]);
    expect(job.review!.dropped).toEqual(["01-salzhafen/legacy-dropped"]);
    // The KEY is the draft path and collapses; the VALUE is the address the
    // part landed at, and a scene address legitimately has three segments.
    expect(job.review!.written).toEqual({
      "01-salzhafen/legacy-written": "01-salzhafen/hafen/legacy-written",
    });
    // An npc draft path keeps its two segments — only scenes collapse.
    expect(Object.keys(job.draftEdits).every((k) => !k.startsWith("npcs/"))).toBe(true);

    // The point of all of it: „Übernehmen" works again.
    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: job.result!.scenes,
      stubs: [],
      jobId: job.id,
    });
    expect(res.status).toBe(200);
    expect(await exists("01-salzhafen/leuchtturm/legacy-grouped")).toBe(true);
  });

  // --- the invariant is a constraint (issue #62 review) ---------------------

  test("a second job row for the same campaign is rejected by the database", async () => {
    useFake([jobReply("01-salzhafen/job-unique")]);
    await generate(generateBody);
    const db = await getDb();

    expect(() =>
      db
        .insert(generateJobs)
        .values({
          id: "second-row",
          campaignId: "beispiel",
          kind: "scene",
          status: "running",
          startedAt: new Date().toISOString(),
          draftEdits: "{}",
        })
        .run(),
    ).toThrow(/constraint/i);
  });

  // --- apply and job cleanup commit together (issue #62 review) ------------

  test("apply discards the job in the SAME commit as the drafts", async () => {
    const scenePath = "01-salzhafen/job-atomic";
    useFake([jobReply(scenePath)]);
    await generate(generateBody);
    const job = (await fetchJob())!;

    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: job.result!.scenes,
      stubs: [],
      jobId: job.id,
    });
    expect(res.status).toBe(200);
    // Both halves of the commit are visible…
    expect(await exists(scenePath)).toBe(true);
    expect(await fetchJob()).toBeNull();
    // …and no leftover row is there for a restart to revive.
    const db = await getDb();
    expect(
      db.select().from(generateJobs).where(eq(generateJobs.campaignId, "beispiel")).all(),
    ).toHaveLength(0);
    expect(await restartServer()).toBe(0);
  });

  test("a 409 apply rolls back BOTH halves — job kept, nothing written", async () => {
    const taken = "01-salzhafen/job-atomic"; // written by the test above
    const fresh = "01-salzhafen/job-atomic-fresh";
    useFake([
      reply({
        scenes: [
          { content: sceneWithId(addressId(taken)) },
          { content: sceneWithId(addressId(fresh)) },
        ],
        entries: [],
      }),
    ]);
    await generate(generateBody);
    const job = (await fetchJob())!;

    const res = await postJson("/api/beispiel/generate/apply", {
      scenes: job.result!.scenes,
      stubs: [],
      jobId: job.id,
    });
    expect(res.status).toBe(409);
    expect((await fetchJob())!.id).toBe(job.id);
    expect(await exists(fresh)).toBe(false);
  });

  test("jobs are per campaign — an unknown campaign simply has none", async () => {
    expect(await fetchJob("nope")).toBeNull();
    useFake([jobReply("01-salzhafen/job-scope")]);
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
      // `entries: []`: one part, so a failed part IS a failed run.
      reply({ scenes: [{ content: sceneMarkdown({ status: "ready" }) }], entries: [] }),
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
    // The SCENE part spent exactly one call — no correction turn at all.
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(1);
    expect(fake.calls.every((call) => call.corrections.length === 0)).toBe(true);
  });

  test("1 (default): one correction turn", async () => {
    const fake = useFake(badReplies(2));
    expect((await generate(generateBody)).status).toBe(422);
    // Per PART since issue #102 — the bound is the same, the unit is smaller.
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(2);
    expect(scene[1]!.corrections).toHaveLength(1);
  });

  test("2: two correction turns", async () => {
    process.env.LLM_CORRECTION_TURNS = "2";
    const fake = useFake(badReplies(3));
    expect((await generate(generateBody)).status).toBe(422);
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(3);
    expect(scene[2]!.corrections).toHaveLength(2);
  });

  test("junk keeps the default instead of raising the spend", async () => {
    process.env.LLM_CORRECTION_TURNS = "9";
    const fake = useFake(badReplies(2));
    expect((await generate(generateBody)).status).toBe(422);
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(2);
  });
});

// --- campaign knowledge in the run (issue #53) -------------------------------
//
// Two claims, both about the WIRING rather than about the wording: the
// knowledge reaches the provider on every run kind (the wording itself is
// llm-provider.test.ts's buildPrompt block), and the naming check runs over
// the finished drafts and lands in the result.

describe("campaign knowledge", () => {
  /**
   * A reply whose suggested entry is one the campaign does NOT have yet. The
   * database is shared by the whole file and the apply cases above already
   * wrote `npcs/grella`; since issue #102 the OUTLINE step refuses an entry
   * that exists (proposing it again would mean a second file for the same
   * reference key), so these cases bring their own.
   */
  const FRESH_NPC = "grella-vom-kai";
  function freshReply(over: { scenes?: Array<{ content: string }> } = {}): string {
    return reply({
      ...over,
      entries: [{ kind: "npc", content: npcStub({ id: FRESH_NPC, name: "Grella" }) }],
    });
  }

  /** Write the campaign's knowledge list against its current rev. */
  async function setKnowledge(entries: unknown[]): Promise<void> {
    const current = await app.request("/api/beispiel/knowledge");
    const { rev } = (await current.json()) as { rev: number };
    const res = await app.request("/api/beispiel/knowledge", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries, rev }),
    });
    expect(res.status).toBe(200);
  }

  // The database is shared by the whole file, so the list must not leak into
  // the cases above (a naming hint appearing in an unrelated result).
  afterEach(async () => {
    await setKnowledge([]);
  });

  test("no knowledge: the request carries an empty block and no hints", async () => {
    const fake = useFake([reply()]);
    const result = (await (await generate(generateBody)).json()) as GenerateResult;
    expect(fake.calls[0]!.req.knowledge).toBe("");
    expect(result.namingHints).toBeUndefined();
  });

  test("the rendered knowledge block travels with a SCENE run", async () => {
    await setKnowledge([
      { kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" },
      { kind: "style", from: "", to: "", text: "Keine Würfelwerte im Read-Aloud." },
    ]);
    const fake = useFake([freshReply()]);
    expect((await generate(generateBody)).status).toBe(200);
    const knowledge = fake.calls[0]!.req.knowledge;
    expect(knowledge).toContain('schreibe „Salt Harbour" immer als „Salzhafen"');
    expect(knowledge).toContain("- Stilregel: Keine Würfelwerte im Read-Aloud.");
  });

  // The NPC run's half of AK2 (knowledge travels, `[[slug]]` resolved) is in
  // generate-npc.test.ts — it needs that file's harness.

  test("a draft that keeps the old spelling produces a hint with its position", async () => {
    await setKnowledge([
      { kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" },
    ]);
    const scene = sceneMarkdown().replace(
      "Fenn wartet am Kai; Grella beobachtet aus dem Schatten.",
      "Fenn wartet am Kai von Salt Harbour.",
    );
    useFake([freshReply({ scenes: [{ content: scene }] })]);
    const result = (await (await generate(generateBody)).json()) as GenerateResult;
    // A HINT, not a failure: the run succeeded and the draft is in the result.
    expect(result.scenes).toHaveLength(1);
    expect(result.namingHints).toHaveLength(1);
    const hint = result.namingHints![0]!;
    expect(hint).toMatchObject({
      from: "Salt Harbour",
      to: "Salzhafen",
      path: SCENE_PATH,
      field: "body",
      excerpt: "Fenn wartet am Kai von Salt Harbour.",
    });
    expect(hint.line).toBeGreaterThan(0);
  });

  test("stubs are checked too — a stub is a file the run creates", async () => {
    await setKnowledge([{ kind: "naming", from: "Grella", to: "Grellwyn", text: "" }]);
    useFake([freshReply({ scenes: [{ content: sceneWithId("kai-zwei") }] })]);
    const result = (await (await generate(generateBody)).json()) as GenerateResult;
    const paths = (result.namingHints ?? []).map((h) => h.path);
    expect(paths).toContain(`npcs/${FRESH_NPC}`);
  });

  test("a draft that FOLLOWS the convention produces no hint at all", async () => {
    await setKnowledge([{ kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }]);
    useFake([freshReply({ scenes: [{ content: sceneWithId("kai-drei") }] })]);
    const result = (await (await generate(generateBody)).json()) as GenerateResult;
    expect(result.namingHints).toBeUndefined();
  });
});
