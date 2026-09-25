// Generator pipeline tests. They run against a DATABASE seeded from the
// example campaign, and the apply step writes ROWS — so "was it written?" is
// asked through the API. The database is seeded ONCE for this file (not
// per case): several cases build on what an earlier one applied (a conflict
// needs an existing entity).
//
// No real LLM and no ANTHROPIC_API_KEY: a FakeProvider with scripted raw
// replies is injected via setProviderForTests(). It records every call, so
// the tests can assert the correction-turn mechanics (assistant reply
// replayed + validation errors sent back, LLM_CORRECTION_TURNS turns).
//
// A scripted reply is either a plain string (fine, not truncated, no usage
// reported) or the full CompletionResult shape — that is how the truncation
// fail-fast and the token accounting are exercised.
//
// The run is a background job, so the pipeline tests go
// through `generate()`: POST /generate (202), poll the job in-process, then
// read the answer off the finished job. The job endpoints
// themselves (lifecycle, 409, drafts, apply cleanup, restart) have their own
// describe block at the end; a FakeProvider that waits on a manual gate
// makes "running" observable without a single timer.
//
// The job is a ROW, so a "restart" is `failInterruptedJobs()` — literally
// what the boot runs — over the same database. That is why the restart cases
// below call it directly.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type {
  Chapter,
  GenerateJob,
  GenerateResult,
  GenerateUsage,
  Location,
  Npc,
  Scene,
  SceneProposal,
} from "@grimoire/shared";
import { app } from "../src/server";
import { setKnowledge } from "./support/knowledge-items";
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
  parseCorrectionTurns,
  setProviderForTests,
} from "../src/generator";
import type { TokenUsage } from "../src/llm-provider";
import { parseJsonReply } from "../src/json-reply";
import {
  PipelineFake,
  entryReply,
  type ScriptedEntry,
  type ScriptedReply,
} from "./support/pipeline-fake";

/**
 * Whether a scene is there, on its own resource (ADR #31). A proposal that
 * was applied is a ROW, and the only thing that matters is that the app can
 * open it.
 */
async function exists(id: string): Promise<boolean> {
  const res = await app.request(`/api/campaigns/beispiel/scenes/${id}`);
  return res.status === 200;
}

/** Whether a chapter is there — its own resource (ADR #31). */
async function chapterExists(id: string): Promise<boolean> {
  const res = await app.request(`/api/campaigns/beispiel/chapters/${id}`);
  return res.status === 200;
}

/** GET of a location — its own resource (ADR #31); undefined when there is none. */
async function readLocation(id: string): Promise<Location | undefined> {
  const res = await app.request(`/api/campaigns/beispiel/locations/${id}`);
  return res.status === 200 ? ((await res.json()) as Location) : undefined;
}

/** A proposed location as the apply body carries it: the location without its guard. */
function locationItem(over: { status?: string } = {}): Record<string, unknown> {
  const stub = locationStub(over);
  return { ...stub.properties, body: stub.body };
}

/** GET of an npc — its own resource (ADR #31); undefined when there is none. */
async function readNpc(id: string): Promise<Npc | undefined> {
  const res = await app.request(`/api/campaigns/beispiel/npcs/${id}`);
  return res.status === 200 ? ((await res.json()) as Npc) : undefined;
}

/** A proposed npc as the job and the apply body carry it: the npc without its guard. */
function npcItem(entry: ScriptedEntry = PROPOSED_NPC): Record<string, unknown> {
  return { ...entry.properties, body: entry.body };
}

/** GET of an applied scene — its own resource (ADR #31). */
async function read(id: string): Promise<Scene> {
  const res = await app.request(`/api/campaigns/beispiel/scenes/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Scene;
}

/** GET of a chapter — its own resource (ADR #31). */
async function readChapter(id: string): Promise<Chapter> {
  const res = await app.request(`/api/campaigns/beispiel/chapters/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Chapter;
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
// Scripted and PIPELINE-AWARE (see support/pipeline-fake.ts):
// a test still writes "first this reply, then that one", and the fake routes
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

/** The id of the scene the scripted run proposes — the key it is reviewed and written by. */
const SCENE_ID = "treffen-am-kai";

/**
 * One scene draft: the pair a draft is. `over` is spelled as the properties
 * a case cares about — an id of its own, a status, other npcs — and `drop`
 * names the keys a case wants MISSING, which is how the validation cases say
 * „ohne id"/„ohne chapter".
 */
function sceneDraft(
  over: {
    id?: string;
    title?: string;
    status?: string;
    type?: string;
    chapter?: string;
    location?: string;
    npcs?: string[];
    callout?: string;
  } = {},
  drop: readonly string[] = [],
): ScriptedEntry {
  const { callout, ...properties } = over;
  return without(
    {
      properties: {
        id: "treffen-am-kai",
        title: "Treffen am Kai",
        type: "planned",
        chapter: "01-salzhafen",
        location: "leuchtturm",
        npcs: ["fenn", "grella"],
        tags: ["social"],
        status: "draft",
        ...properties,
      },
      body: [
        "## Flow",
        "",
        "Fenn wartet am Kai; Grella beobachtet aus dem Schatten.",
        "",
        `> [!${callout ?? "readaloud"}] Nebel liegt über dem Kai, ihr hört`,
        "> nur das Knarren der Taue.",
        "",
        "> [!check] Wisdom (Perception) DC 12, um Grella zu bemerken.",
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
 * The same scene under its own ID. Needed wherever a case applies a SECOND
 * scene: the id is the primary key, so reusing
 * `treffen-am-kai` would be a conflict rather than a fresh draft.
 */
function sceneWithId(id: string): ScriptedEntry {
  return sceneDraft({ id });
}

/**
 * An npc the run proposes. `status` defaults to what the prompt asks for
 * (`alive`); `null` drops the key entirely.
 */
function proposedNpc(over: { id?: string; name?: string; status?: string | null } = {}): ScriptedEntry {
  const status = over.status === undefined ? "alive" : over.status;
  return {
    properties: {
      id: over.id ?? "grella",
      name: over.name ?? "Grella",
      role: "Schmugglerin mit eigenen Plänen",
      chapter: "01-salzhafen",
      ...(status === null ? {} : { status }),
      motivation: "Im Quelltext nur erwähnt — Details fehlen.",
    },
    body: ["## Weiß", "", "> [!secret] Kennt den Weg durch die Bucht.", ""].join("\n"),
  };
}

const PROPOSED_NPC = proposedNpc();

const LOCATION_STUB_ID = "raeucherkammer";

/** A location stub — correct form carries NO status key at all. */
function locationStub(over: { status?: string } = {}): ScriptedEntry {
  return {
    properties: {
      id: "raeucherkammer",
      name: "Die alte Räucherkammer",
      chapter: "01-salzhafen",
      ...(over.status === undefined ? {} : { status: over.status }),
      atmosphere: "Im Quelltext nur erwähnt — Details fehlen.",
    },
    body: ["## Wer ist hier", "", "- niemand", ""].join("\n"),
  };
}

interface ReplyOver {
  scenes?: Array<{ content: ScriptedEntry }>;
  entries?: Array<{ kind?: string; content: ScriptedEntry }>;
  warnings?: string[];
}

/** The reply's JSON object, bare — what a model SHOULD return. */
function replyJson(over: ReplyOver = {}): string {
  const body = {
    scenes: over.scenes ?? [{ content: sceneDraft() }],
    entries: over.entries ?? [{ kind: "npc", content: PROPOSED_NPC }],
    warnings: over.warnings ?? ["Quelltext nennt keinen DC — DC 12 gesetzt"],
  };
  return JSON.stringify(body, null, 2);
}

/**
 * What the fake actually SENDS for the scene part of `reply(over)`: the reply
 * OBJECT — the scene's properties, its body and the script's
 * warnings. The script above keeps writing entries (it is how a test says
 * which entries a run is about); this is what the server sees, so it is what
 * the correction-turn and `rawReply` assertions compare against.
 */
function servedScene(over: ReplyOver = {}): string {
  const content = (over.scenes ?? [{ content: sceneDraft() }])[0]!.content;
  const warnings = over.warnings ?? ["Quelltext nennt keinen DC — DC 12 gesetzt"];
  return entryReply(content, warnings, "scene", "01-salzhafen");
}

/**
 * A proposed scene as the result and the apply body carry it: the scripted
 * scene as the scene without its guard, read back from its reply form — an
 * optional field the script leaves out absent, a list it leaves out empty.
 */
function sceneItem(entry: ScriptedEntry = sceneDraft()): SceneProposal {
  const { warnings: _warnings, trigger, location, ...fields } = JSON.parse(
    entryReply(entry, [], "scene", "01-salzhafen"),
  ) as Record<string, unknown>;
  return {
    ...fields,
    ...(trigger === null ? {} : { trigger }),
    ...(location === null ? {} : { location }),
  } as SceneProposal;
}

function reply(over: ReplyOver = {}): string {
  // Wrapped in a fence like real models tend to do — the extraction
  // (stage b) takes the fence content.
  return "```json\n" + replyJson(over) + "\n```";
}

/**
 * A production-shaped reply: an English explainer paragraph, a blank line,
 * then the JSON object — valid JSON that only a parse which EXTRACTS the
 * object can read.
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

// --- job helpers ------------------------------------------------------------

/** GET the campaign's job, or null on the 404 "there is none". */
async function fetchJob(campaign = "beispiel"): Promise<GenerateJob | null> {
  const res = await app.request(`/api/campaigns/${campaign}/generate/job`);
  if (res.status === 404) return null;
  expect(res.status).toBe(200);
  return (await res.json()) as GenerateJob;
}

/**
 * PATCH the review with one draft edit — the endpoint that replaced
 * `PUT …/job/drafts`. `jobId`/`rev` default to
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
  return app.request(`/api/campaigns/${campaign}/generate/job/${jobId}/review`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev, ...body }),
  });
}

/** The common case: store the edited body of one proposed scene. */
const putSceneEdit = (campaign: string, id: string, body: string): Promise<Response> =>
  patchReview(campaign, { sceneEdits: { [id]: { body } } });

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

/** What the synchronous endpoint answered, rebuilt over the job flow. */
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
  const res = await postJson(`/api/campaigns/${campaign}/generate`, body);
  if (res.status !== 202) return { status: res.status, json: () => res.json() };
  expect(await res.json()).toEqual({ jobId: expect.any(String) });
  const job = await waitForJob(campaign);
  if (job.status === "done") return { status: 200, json: async () => job.result };
  return { status: job.error?.status ?? 500, json: async () => job.error?.body };
}

// --- reading a reply: by schema ---------------------------------------------

describe("parseJsonReply", () => {
  const OBJ = { scenes: [{ path: "a.md" }], warnings: ["w"] };
  const JSON_TEXT = JSON.stringify(OBJ, null, 2);
  /** Convenience: the extracted value, or undefined when nothing parsed. */
  const value = (raw: string) => parseJsonReply(raw)?.value;

  test("stage (a): the whole text, leading/trailing whitespace included", () => {
    expect(value(JSON_TEXT)).toEqual(OBJ);
    expect(value(`\n\n${JSON_TEXT}\n  `)).toEqual(OBJ);
    // a parseable non-object still wins the stage — the validation below
    // rejects it with "reply must be a JSON object", not with a parse error
    expect(value("[1, 2]")).toEqual([1, 2]);
    expect(parseJsonReply("null")).toEqual({ value: null, repaired: false });
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
    // Prose is deliberately NOT handed to the repair: jsonrepair would turn a
    // sentence into a JSON string, and the run would fail with a message
    // about the wrong thing.
    expect(parseJsonReply("Ich kann diese Aufgabe nicht erfüllen.")).toBeNull();
    expect(parseJsonReply("")).toBeNull();
    expect(parseJsonReply("   \n  ")).toBeNull();
  });

  test("an almost-object is repaired once, and says so", () => {
    // The one thing this reader does beyond extracting: the
    // mechanical mistakes of a hand-written object — a trailing comma, a
    // single-quoted key — cost no correction turn.
    expect(parseJsonReply('{"scenes": [], "warnings": [],}')).toEqual({
      value: { scenes: [], warnings: [] },
      repaired: true,
    });
  });

  test("a truncated object does not parse (all three stages)", () => {
    const cut = '{\n  "properties": {\n    "id": "kai",\n    "title": "Am K';
    expect(parseJsonReply(cut)).toBeNull();
    // …also when the model prefixed it with prose and opened a fence
    expect(parseJsonReply(`Los geht's:\n\n\`\`\`json\n${cut}`)).toBeNull();
  });
});

// --- POST /api/campaigns/:campaign/generate --------------------------------------------------

describe("POST /api/campaigns/:campaign/generate", () => {
  test("happy path: GenerateResult from one call, nothing written", async () => {
    const fake = useFake([reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateResult;

    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.id).toBe(SCENE_ID);
    expect(result.scenes[0]).toEqual(sceneItem());
    expect(result.scenes[0]!.body).toBe(sceneDraft().body);
    expect(result.scenes[0]!.status).toBe("draft");
    expect(result.scenes[0]!.npcs).toEqual(["fenn", "grella"]);
    // A proposed npc is an npc of its own list — the npc without its guard.
    expect(result.npcs as unknown).toEqual([npcItem()]);
    expect(result.warnings).toEqual(["Quelltext nennt keinen DC — DC 12 gesetzt"]);
    // this provider reports no usage — then the field stays absent
    expect(result.usage).toBeUndefined();

    // Three provider calls — the outline, the one scene and
    // the one proposed npc — and not a correction turn among them.
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
    // `bucht` is an entry too — the contingency scene
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
    expect(sceneReq.fewShotTarget).toContain('"id": "smuggler-captured"');
    expect(sceneReq.outline).toContain("treffen-am-kai");
    // WHICH scene this call writes is its own section of the variable half,
    // not a marker inside the (cacheable) outline block.
    expect(sceneReq.outline).not.toContain("DIESE Szene");
    expect(sceneReq.assignment).toContain("treffen-am-kai");
    expect(sceneReq.sourceText).toBe(generateBody.sourceText);

    // review preview only — NOTHING on disk
    expect(await exists(SCENE_ID)).toBe(false);
    expect(await readNpc("grella")).toBeUndefined();
  });

  test("unknown npc without stub triggers a correction turn, then succeeds", async () => {
    const bad = reply({
      scenes: [{ content: sceneDraft({ npcs: ["fenn", "nobody"] }) }],
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
    expect(scene[1]!.corrections[0]!.assistant).toBe(
      servedScene({ scenes: [{ content: sceneDraft({ npcs: ["fenn", "nobody"] }) }] }),
    );
    // ... and names the mechanical error
    expect(scene[1]!.corrections[0]!.correction).toContain('npc "nobody"');
    expect(await exists(SCENE_ID)).toBe(false);
  });

  test("unknown callout triggers a correction turn, then succeeds", async () => {
    const bad = reply({
      scenes: [{ content: sceneDraft({ callout: "danger" }) }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(2);
    expect(scene[1]!.corrections[0]!.correction).toContain("[!danger]");
  });

  // --- `[[id]]` references in the bodies of a run ---------------------------

  test("an unknown [[id]] in a scene body triggers a correction turn, then succeeds", async () => {
    const withRef = (slug: string): ScriptedEntry => {
      const draft = sceneDraft();
      return { ...draft, body: `${draft.body}\n[[${slug}]] wartet am Ende der Mole.\n` };
    };
    const fake = useFake([reply({ scenes: [{ content: withRef("nobody") }] }), reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(2);
    const correction = scene[1]!.corrections[0]!.correction;
    expect(correction).toContain('scene "treffen-am-kai": [[nobody]] nennt nichts');
    expect(correction.match(/^- /gm)).toHaveLength(1);
  });

  test("[[id]] of the campaign and of the run's own proposals pass in one call", async () => {
    // `grella` and the location exist only as proposals of this run, the
    // other scene only in its outline; `fenn`, `bucht` and `smuggler-captured`
    // are the campaign's. None of them costs a correction turn — neither in
    // the scene nor in the proposed entries.
    const draft = sceneDraft();
    const scene: ScriptedEntry = {
      ...draft,
      body:
        `${draft.body}\n[[grella]] führt [[fenn]] zur [[${LOCATION_STUB_ID}]], weiter nach ` +
        "[[bucht]] — sonst folgt [[smuggler-captured]] oder [[zweite-szene]].\n",
    };
    const location: ScriptedEntry = {
      ...locationStub(),
      body: "## Wer ist hier\n\n- [[grella]], wenn die Ladung kommt\n",
    };
    const npc: ScriptedEntry = {
      ...PROPOSED_NPC,
      body: `${PROPOSED_NPC.body}\n## Beziehungen\n\n- [[fenn]]: Rivale\n- Versteck in der [[${LOCATION_STUB_ID}]]\n`,
    };
    const fake = useFake([
      reply({
        scenes: [{ content: scene }, { content: sceneWithId("zweite-szene") }],
        entries: [
          { kind: "npc", content: npc },
          { kind: "location", content: location },
        ],
      }),
    ]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    for (const call of fake.calls) expect(call.corrections).toEqual([]);
  });

  test("an unknown [[id]] in a proposed entry is that entry's correction turn", async () => {
    const bad: ScriptedEntry = {
      ...locationStub(),
      body: "## Wer ist hier\n\n- [[der-wirt]] hinter dem Tresen\n",
    };
    const fake = useFake([
      reply({ entries: [{ kind: "npc", content: PROPOSED_NPC }, { kind: "location", content: bad }] }),
      reply({
        entries: [
          { kind: "npc", content: PROPOSED_NPC },
          { kind: "location", content: locationStub() },
        ],
      }),
    ]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const entry = fake.callsFor(LOCATION_STUB_ID);
    expect(entry).toHaveLength(2);
    expect(entry[1]!.corrections[0]!.correction).toContain(
      `location "${LOCATION_STUB_ID}": [[der-wirt]] nennt nichts`,
    );
    // The scene part was not affected by its sibling's reference.
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(1);
  });

  // --- the id is the model's ONE addressing decision ------------------------
  //
  // A reply parsed under its own preview label would silently inherit that
  // label as its id if a missing `id` degraded to anything. A missing id has
  // to be the error it is.

  test("a scene without an id triggers a correction turn that says the id is missing", async () => {
    const bad = reply({
      scenes: [{ content: sceneDraft({}, ["id"]) }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(2);
    const correction = scene[1]!.corrections[0]!.correction;
    expect(correction).toContain('"id"');
    // The part is named by the id the OUTLINE gave it, so the
    // message says which scene is meant instead of an array index.
    expect(correction).toContain('scene "treffen-am-kai"');
    // …and nothing was invented for it.
    expect(correction).not.toContain("treffen-am-kai/");
  });

  test("a proposed npc without an id triggers a correction turn", async () => {
    const bad = reply({
      entries: [{ kind: "npc", content: without(proposedNpc(), ["id"]) }],
      scenes: [{ content: sceneDraft({ npcs: ["fenn"] }) }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const correction = fake.callsFor("grella")[1]!.corrections[0]!.correction;
    expect(correction).toContain('npc "grella"');
    expect(correction).toContain('"id"');
  });

  // --- status rules ------------------------------------------------------------

  test("a proposed npc with the SCENE status draft triggers a correction turn, then succeeds", async () => {
    const bad = reply({
      entries: [{ kind: "npc", content: proposedNpc({ status: "draft" }) }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);

    // The npc part corrected itself — the scene part was right first time.
    const entry = fake.callsFor("grella");
    expect(entry).toHaveLength(2);
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(1);
    // The replayed assistant turn is the npc's own reply — the per-part
    // call is what failed, so that is what goes back.
    expect(entry[1]!.corrections[0]!.assistant).toContain('"status":"draft"');
    const correction = entry[1]!.corrections[0]!.correction;
    expect(correction).toContain('npc "grella"');
    expect(correction).toContain('"alive"|"dead"|"missing"|"unknown"');
    // the draft status is the ONLY error — the npc's own reply schema names
    // it, and the scene part is not touched
    expect(correction.match(/^- /gm)).toHaveLength(1);

    // the corrected second reply is the one that got through
    const result = (await res.json()) as GenerateResult;
    // A proposed npc is an npc of its own list — the npc without its guard.
    expect(result.npcs as unknown).toEqual([npcItem()]);
    expect(await readNpc("grella")).toBeUndefined();
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
      expect(correction).toContain(`location "${LOCATION_STUB_ID}"`);
      // The location's reply schema catches it: a location has no `status`
      // field at all, so the message names the key and the fields it does
      // have — which is more to go on, not less.
      expect(correction).toContain('"status"');
      expect(correction).toContain("erlaubt sind");
      expect(correction).toContain("roll20Page");
    }
  });

  test("prompt-conform proposals pass in ONE call: npc dead/alive, location without status", async () => {
    const fake = useFake([
      reply({
        entries: [
          { kind: "npc", content: proposedNpc({ status: "dead" }) },
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
    // An npc and a location are each a proposal of its own list.
    expect(result.npcs.map((npc) => `${npc.id}:${npc.status}`)).toEqual(["grella:dead"]);
    expect(result.locations).toEqual([
      {
        id: "raeucherkammer",
        name: "Die alte Räucherkammer",
        chapter: "01-salzhafen",
        atmosphere: "Im Quelltext nur erwähnt — Details fehlen.",
        body: "## Wer ist hier\n\n- niemand\n",
      },
    ]);
  });

  test("422 with the remaining errors after 2 correction turns", async () => {
    // Two turns is the MAXIMUM, not the default.
    process.env.LLM_CORRECTION_TURNS = "2";
    // `entries: []` on purpose: the run then has exactly ONE part, so "every
    // part failed" is what the 422 of this case is about. A run with a
    // surviving part is `done` with a failed part — its own case below.
    const bad = reply({
      scenes: [{ content: sceneDraft({ status: "ready" }) }],
      entries: [],
    });
    // same mechanical error, but distinguishable text — the 422 must carry
    // the LAST attempt's reply, not the first one's
    const last = reply({
      scenes: [{ content: sceneDraft({ status: "ready" }) }],
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
      expect.arrayContaining([expect.stringContaining('scene "treffen-am-kai": "status"')]),
    );
    // the raw reply of the LAST attempt, not of the first one
    expect(body.rawReply).toBe(
      servedScene({
        scenes: [{ content: sceneDraft({ status: "ready" }) }],
        warnings: ["letzter Versuch"],
      }),
    );

    // The SCENE part spent its initial call plus exactly 2 correction turns.
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(3);
    // The scene part got the un-parseable text verbatim, so its correction
    // turn is the ONE shape message — the three keys of the
    // reply object, and the schema it belongs to.
    expect(scene[1]!.corrections[0]!.correction).toContain("kein Objekt des Schemas");
    expect(scene[1]!.corrections[0]!.correction).toContain("scene");
    expect(scene[1]!.corrections[0]!.correction).toContain("`warnings`");
    expect(scene[2]!.corrections).toHaveLength(2);
    // The OUTLINE step has correction turns of its own (Zuschnitt 1): the
    // first scripted answer is not JSON, so it took two calls.
    expect(fake.callsFor("outline")).toHaveLength(2);
    // …and the run's usage is summed over every call of every part.
    expect(body.usage.attempts).toBe(fake.calls.length);
    expect(await exists(SCENE_ID)).toBe(false);
  });

  // --- truncation fail-fast -------------------------------------------------

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
    // Language-free: the stable code plus the cap as a
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
    expect(await exists(SCENE_ID)).toBe(false);
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
      scenes: [{ content: sceneDraft({ npcs: ["fenn", "nobody"] }) }],
      entries: [],
    });
    const fake = useFake([
      { text: bad, usage: usage(5000, 1200) },
      { text: reply(), usage: usage(6400, 1300) },
    ]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateResult;
    // Summed over every call of every part, the outline included:
    // outline (5000/1200, the script's first reply) + the scene's two
    // attempts + the entry's one.
    expect(result.usage).toEqual({
      inputTokens: 16400,
      outputTokens: 3700,
      attempts: fake.calls.length,
    });
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(2);
  });

  // --- prose around the JSON ------------------------------------------------

  test("the PO case — explainer paragraph before the object — costs ONE call", async () => {
    const fake = useFake([proseThenJson(replyJson())]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateResult;
    // extraction only loosens the PARSING: the full validation still ran
    expect(result.scenes[0]!.id).toBe(SCENE_ID);
    expect(result.scenes[0]).toEqual(sceneItem());
    expect(result.scenes[0]!.body).toBe(sceneDraft().body);
    // A proposed npc is an npc of its own list — the npc without its guard.
    expect(result.npcs as unknown).toEqual([npcItem()]);
    // no correction turn on any part — that is the whole point of the fix
    expect(fake.calls).toHaveLength(3);
    for (const call of fake.calls) expect(call.corrections).toEqual([]);
    expect(await exists(SCENE_ID)).toBe(false);
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
      replyJson({ scenes: [{ content: sceneDraft({ status: "ready" }) }] }),
    );
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(2);
    // The entry the part answered, replayed verbatim.
    expect(scene[1]!.corrections[0]!.assistant).toBe(
      servedScene({ scenes: [{ content: sceneDraft({ status: "ready" }) }] }),
    );
    expect(scene[1]!.corrections[0]!.correction).toContain('scene "treffen-am-kai": "status"');
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

  test("the 422 rawReply is the reply the failing PART got, verbatim", async () => {
    const bad = proseThenJson(
      replyJson({
        scenes: [{ content: sceneDraft({ status: "ready" }) }],
        entries: [],
      }),
    );
    const fake = useFake([bad, bad]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { rawReply: string; validationErrors: string[] };
    // The part's own last reply — the reply OBJECT, not the
    // run's outline call and not an extracted fragment of it.
    expect(body.rawReply).toBe(
      servedScene({ scenes: [{ content: sceneDraft({ status: "ready" }) }] }),
    );
    expect(JSON.parse(body.rawReply).id).toBe("treffen-am-kai");
    expect(body.validationErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('scene "treffen-am-kai": "status"')]),
    );
    // initial call + the default single correction turn, per part
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(2);
  });

  test("truncation is still checked BEFORE extraction", async () => {
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

  test("a scene id that is no kebab slug is a validation error", async () => {
    // The model names no address — the `id` is all it decides, so
    // that is what the validation is about.
    const bad = reply({
      scenes: [{ content: sceneDraft({ id: "Treffen Am Kai" }) }],
    });
    const fake = useFake([bad, bad]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { validationErrors: string[] };
    expect(body.validationErrors[0]).toContain("kebab-case id");
    expect(fake.calls).toHaveLength(2);
  });

  test("two scenes with the SAME id are a validation error", async () => {
    // The id is the primary key AND the address, so a reply that uses one
    // twice describes two entities that cannot both exist.
    const bad = reply({
      scenes: [{ content: sceneDraft() }, { content: sceneDraft() }],
    });
    const fake = useFake([bad, bad]);
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { validationErrors: string[] };
    expect(body.validationErrors.some((e) => e.includes("duplicate id"))).toBe(true);
  });

  test("a proposed scene belongs to the run's chapter", async () => {
    const fake = useFake([reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const result = (await res.json()) as GenerateResult;
    expect(result.scenes[0]!.id).toBe(SCENE_ID);
    expect(result.scenes[0]!.chapter).toBe("01-salzhafen");
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(1);
  });

  test("a scene without a type is a planned one — no correction turn", async () => {
    // A reply that leaves the type out means what an unmarked scene has
    // always meant: `planned` (contingency is the exception, and it says so).
    // Hard-failing would make that reply cost a turn.
    const fake = useFake([
      reply({ scenes: [{ content: sceneDraft({}, ["type"]) }] }),
    ]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(1);
    expect(((await res.json()) as GenerateResult).scenes[0]!.type).toBe("planned");
  });

  test("a scene whose chapter is not the run's triggers a correction turn", async () => {
    // A reply that names a DIFFERENT chapter would produce a scene in a
    // chapter the run is not about. Cheaper as a correction turn than as a
    // scene the DM has to find and move by hand.
    const bad = reply({
      scenes: [{ content: sceneDraft({ chapter: "99-weg" }) }],
    });
    const fake = useFake([bad, reply()]);
    const res = await generate(generateBody);
    expect(res.status).toBe(200);
    const scene = fake.callsFor("treffen-am-kai");
    expect(scene).toHaveLength(2);
    expect(scene[1]!.corrections[0]!.correction).toContain('"chapter" muss "01-salzhafen" sein');
    expect(((await res.json()) as GenerateResult).scenes[0]!.chapter).toBe("01-salzhafen");
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
    const fake = useFake([
      reply({
        scenes: [
          {
            content: sceneDraft({ npcs: ["fenn"], chapter }),
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
    expect(result.scenes[0]!.chapter).toBe(chapter);

    // context still collected (npcs/locations/glossary are campaign-wide),
    // only the chapter directory is absent
    const req = fake.calls[0]!.req;
    expect(req.context.chapter).toBe(chapter);
    expect(req.context.npcs.map((n) => n.id).sort()).toEqual(["fenn", "jorna"]);
    expect(req.glossary).toContain("Leuchtturmwärter");

    // still a preview: neither the chapter nor the scene exist
    expect(await chapterExists(chapter)).toBe(false);
    expect(await exists(SCENE_ID)).toBe(false);
  });

  test("newChapter does not weaken the other chapter checks", async () => {
    const fake = useFake([]);
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

// --- POST /api/campaigns/:campaign/generate/apply ----------------------------------------------

describe("POST /api/campaigns/:campaign/generate/apply", () => {
  test("writes the reviewed proposals — GenerateResult pieces pass through verbatim", async () => {
    // What the client sends is what /generate returned — the endpoint accepts
    // the documented shapes as-is.
    const fake = useFake([reply()]);
    const gen = await generate(generateBody);
    const result = (await gen.json()) as GenerateResult;
    // outline + scene + npc
    expect(fake.calls).toHaveLength(3);

    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: result.scenes,
      npcs: result.npcs,
    });
    expect(res.status).toBe(200);
    // Every proposal is named by its id.
    expect(await res.json()).toEqual({ scenes: [SCENE_ID], npcs: ["grella"], locations: [] });

    // the proposals are rows now — every field the review showed survived
    // the insert, `status: draft` included (that is what the app filters on)
    const scene = await read(SCENE_ID);
    expect(scene).toEqual({ ...sceneItem(), rev: scene.rev });
    expect(scene.status).toBe("draft");
    expect(scene.body).toContain("> [!readaloud] Nebel liegt über dem Kai");
    expect(scene.body).toContain("> [!check] Wisdom (Perception) DC 12");

    const npc = await readNpc("grella");
    expect(npc?.name).toBe("Grella");
    expect(npc?.status).toBe("alive");
    // The prose field rode along with the proposal and was written.
    expect(npc?.motivation).toBe("Im Quelltext nur erwähnt — Details fehlen.");
    expect(npc?.body).toContain("## Weiß");
  });

  test("409 lists every conflicting scene and npc by id and writes nothing", async () => {
    const before = await read("lighthouse-arrival");
    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: [
        sceneItem(sceneWithId("lighthouse-arrival")),
        sceneItem(sceneWithId("ganz-neu")),
        sceneItem(), // written by the previous test
      ],
      npcs: [npcItem()], // also exists now
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { scenes: string[]; npcs: string[] };
    expect(body.scenes).toEqual(["lighthouse-arrival", SCENE_ID]);
    expect(body.npcs).toEqual(["grella"]);
    // nothing written, nothing overwritten
    expect(await exists("ganz-neu")).toBe(false);
    expect(await read("lighthouse-arrival")).toEqual(before); // the row's rev never moved
  });

  test("400 for a scene id that is no kebab slug — nothing written", async () => {
    // The `id` BECOMES the primary key: an id nothing can reach is refused
    // before anything is written.
    for (const id of ["a/b", "Gross", "trailing-", "../evil", "mit leerzeichen", ""]) {
      const res = await postJson("/api/campaigns/beispiel/generate/apply", {
        scenes: [sceneItem(sceneWithId(id))],
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("id");
    }
  });

  test("400 re-validation: a status other than draft, or a key a scene does not have", async () => {
    // status was flipped after review — apply must not trust the client
    let res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: [sceneItem(sceneDraft({ id: "nicht-draft", status: "ready" }))],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('"status" must be "draft"');

    // A proposal is the scene itself: no address, no halves.
    for (const [key, value] of [
      ["path", "01-salzhafen/nicht-draft"],
      ["properties", { title: "X" }],
      ["kind", "scene"],
    ] as const) {
      res = await postJson("/api/campaigns/beispiel/generate/apply", {
        scenes: [{ ...sceneItem(sceneWithId("nicht-draft")), [key]: value }],
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(key);
    }

    // `body` is not a text
    res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: [{ ...sceneItem(sceneWithId("nicht-draft")), body: 7 }],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("body");
    expect(await exists("nicht-draft")).toBe(false);
  });

  test("400 re-validation: the status rules of npc and location — nothing written", async () => {
    const brix = { id: "brix", name: "Brix" };
    for (const npc of [
      // the scene status sneaked into an npc after the review
      npcItem(proposedNpc({ ...brix, status: "draft" })),
      // an npc without any status
      npcItem(proposedNpc({ ...brix, status: null })),
    ]) {
      const res = await postJson("/api/campaigns/beispiel/generate/apply", { npcs: [npc] });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("status");
    }
    // A location is no npc at all…
    const asNpc = await postJson("/api/campaigns/beispiel/generate/apply", {
      npcs: [locationItem()],
    });
    expect(asNpc.status).toBe(400);
    // …and a proposed location carries no status: its schema has no such field.
    const withStatus = await postJson("/api/campaigns/beispiel/generate/apply", {
      locations: [locationItem({ status: "alive" })],
    });
    expect(withStatus.status).toBe(400);
    expect(((await withStatus.json()) as { error: string }).error).toContain("status");
    expect(await readNpc("brix")).toBeUndefined();
    expect(await readLocation("raeucherkammer")).toBeUndefined();

    // the prompt-conform forms write fine
    const ok = await postJson("/api/campaigns/beispiel/generate/apply", {
      npcs: [npcItem(proposedNpc({ ...brix, status: "missing" }))],
      locations: [locationItem()],
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ scenes: [], npcs: ["brix"], locations: ["raeucherkammer"] });
    // The location's atmosphere came through the accept as its own field.
    expect((await readLocation("raeucherkammer"))?.atmosphere).toBe(
      "Im Quelltext nur erwähnt — Details fehlen.",
    );
  });

  test("400 on malformed bodies", async () => {
    const bad = [
      {}, // nothing to apply
      { scenes: [], npcs: [] }, // still nothing to apply
      { scenes: "x" }, // not an array
      { scenes: [{ body: "" }] }, // no scene at all
      { npcs: [{ ...npcItem(), id: undefined }] }, // missing id
      { scenes: [], npcs: [], extra: 1 }, // unknown top-level key
    ];
    for (const b of bad) {
      expect((await postJson("/api/campaigns/beispiel/generate/apply", b)).status).toBe(400);
    }
  });

  test("TWO proposals for one scene are a 409 naming it — nothing is written", async () => {
    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: [
        sceneItem(sceneWithId("doppelt")),
        sceneItem(sceneDraft({ id: "doppelt", location: "bucht" })),
      ],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { scenes: string[] }).scenes).toEqual(["doppelt"]);
    expect(await exists("doppelt")).toBe(false);
  });

  test("404 for an unknown campaign", async () => {
    const res = await postJson("/api/campaigns/nope/generate/apply", {
      scenes: [sceneItem()],
    });
    expect(res.status).toBe(404);
  });

  // --- new-chapter flow -----------------------------------------------------

  test("chapter + chapterTitle create chapter entry once — and never twice", async () => {
    const chapter = "03-neues-kapitel";
    let res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: [sceneItem(sceneDraft({ id: "erste-szene", chapter }))],
      chapter,
      chapterTitle: "Kapitel 3: Die Schmugglerbucht",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scenes: ["erste-szene"], npcs: [], locations: [] });
    expect((await read("erste-szene")).chapter).toBe(chapter);

    // the chapter row carries the title the app sent, and the `planned`
    // status the generator gives a chapter it created (never `active`)
    const written = await readChapter(chapter);
    expect(written).toEqual({
      id: chapter,
      title: "Kapitel 3: Die Schmugglerbucht",
      status: "planned",
      body: "",
      rev: written.rev,
    });

    // second apply into the SAME chapter: the existing chapter is left
    // untouched (not a conflict, not rewritten) — only the new scene lands
    res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: [sceneItem(sceneDraft({ id: "zweite-szene", chapter }))],
      chapter,
      chapterTitle: "Ein anderer Titel",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scenes: ["zweite-szene"], npcs: [], locations: [] });
    const again = await readChapter(chapter);
    expect(again.title).toBe(written.title);
    expect(again.rev).toBe(written.rev); // not even a rev bump
  });

  test("new-chapter batch stays all-or-nothing: a scene conflict writes no chapter entry", async () => {
    const chapter = "04-konflikt";
    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: [
        sceneItem(sceneDraft({ id: "konflikt-neu", chapter })),
        sceneItem(sceneDraft({ id: "lighthouse-arrival", chapter })),
      ],
      chapter,
      chapterTitle: "Kapitel 4",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { scenes: string[] }).scenes).toEqual(["lighthouse-arrival"]);
    expect(await chapterExists(chapter)).toBe(false);
    expect(await exists("konflikt-neu")).toBe(false);
  });

  test("400 on half or unusable chapter arguments — nothing written", async () => {
    const scene = sceneItem(sceneDraft({ id: "neu", chapter: "05-halb" }));
    const bad = [
      // the two belong together
      { scenes: [scene], chapter: "05-halb" },
      { scenes: [scene], chapterTitle: "Halb" },
      // empty / whitespace-only title
      { scenes: [scene], chapter: "05-halb", chapterTitle: "  " },
      // unsafe chapter ids
      { scenes: [scene], chapter: "..", chapterTitle: "X" },
      { scenes: [scene], chapter: "a/b", chapterTitle: "X" },
      // nothing to apply — a chapter alone is not a proposal
      { chapter: "05-halb", chapterTitle: "Halb" },
    ];
    for (const b of bad) {
      expect((await postJson("/api/campaigns/beispiel/generate/apply", b)).status).toBe(400);
    }
    expect(await exists("neu")).toBe(false);
    expect(await chapterExists("05-halb")).toBe(false);
  });
});

// --- background jobs --------------------------------------------------------

describe("generate jobs", () => {
  /** A reply proposing one fresh scene, without a proposed npc (grella exists by now). */
  function jobReply(id: string): string {
    return reply({
      scenes: [{ content: sceneDraft({ npcs: ["fenn"], id }) }],
      entries: [],
    });
  }

  test("202 { jobId }, status running, then done — the result waits in the store", async () => {
    const open = gate();
    const sceneId = "job-lifecycle";
    const fake = useFake([jobReply(sceneId)], undefined, open.promise);

    const res = await postJson("/api/campaigns/beispiel/generate", generateBody);
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
      sceneEdits: {},
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
    expect(done.result!.scenes[0]!.id).toBe(sceneId);
    expect(done.error).toBeUndefined();
    // outline + the one scene (this reply proposes no entries)
    expect(fake.calls).toHaveLength(2);

    // Still there on the next GET: only apply/discard/a new start remove it.
    expect((await fetchJob())!.id).toBe(jobId);
    // …and nothing was written (the pipeline is still a preview)
    expect(await exists(sceneId)).toBe(false);
  });

  test("a second start while one runs answers 409 with the running jobId", async () => {
    const open = gate();
    useFake([jobReply("job-parallel")], undefined, open.promise);

    const first = await postJson("/api/campaigns/beispiel/generate", generateBody);
    expect(first.status).toBe(202);
    const { jobId } = (await first.json()) as { jobId: string };

    const second = await postJson("/api/campaigns/beispiel/generate", generateBody);
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
    // and the 422 carries rawReply, usage and validationErrors.
    const bad = reply({
      scenes: [{ content: sceneDraft({ status: "ready" }) }],
      entries: [],
    });
    const fake = useFake([
      { text: bad, usage: usage(1000, 100) },
      { text: bad, usage: usage(2000, 200) },
    ]);
    expect((await postJson("/api/campaigns/beispiel/generate", generateBody)).status).toBe(202);

    const job = await waitForJob();
    expect(job.status).toBe("failed");
    expect(job.finishedAt).toEqual(expect.any(String));
    expect(job.error!.status).toBe(422);
    expect(job.error!.body.error).toContain("validation");
    expect(job.error!.body.validationErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('scene "treffen-am-kai": "status"')]),
    );
    expect(job.error!.body.rawReply).toBe(
      servedScene({ scenes: [{ content: sceneDraft({ status: "ready" }) }] }),
    );
    // Summed over every call of the run — the outline's included.
    expect(job.error!.body.usage).toEqual({
      inputTokens: 3000,
      outputTokens: 300,
      attempts: fake.calls.length,
    });
    // The part itself says what happened, which is what the per-part retry
    // hangs off.
    expect(job.pipeline!.parts).toEqual([
      expect.objectContaining({
        key: "scene:treffen-am-kai",
        kind: "scene",
        status: "failed",
        error: expect.stringContaining("validation"),
      }),
    ]);
  });

  test("a truncated run keeps the fail-fast 422 body (through the job)", async () => {
    const cut = '{"scenes":[{"path":"01-salzhafen/hafen/x","content":"---\\nid: x';
    const fake = useFake([{ text: cut, truncated: true, usage: usage(9000, 8000) }], 8000);
    expect((await postJson("/api/campaigns/beispiel/generate", generateBody)).status).toBe(202);

    const job = await waitForJob();
    expect(job.status).toBe("failed");
    expect(job.error!.status).toBe(422);
    expect(job.error!.body.code).toBe("llm_truncated");
    expect(job.error!.body.rawReply).toBe(cut);
    expect(job.error!.body.validationErrors).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });

  test("DELETE discards the job — also a finished one; 404 afterwards", async () => {
    useFake([jobReply("job-delete")]);
    await generate(generateBody);
    expect((await fetchJob())!.status).toBe("done");

    const res = await app.request("/api/campaigns/beispiel/generate/job", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(await fetchJob()).toBeNull();
    // nothing left to discard
    expect(
      (await app.request("/api/campaigns/beispiel/generate/job", { method: "DELETE" })).status,
    ).toBe(404);
  });

  test("DELETE of a RUNNING job abandons it — its result never lands", async () => {
    const open = gate();
    useFake([jobReply("job-abandon")], undefined, open.promise);
    expect((await postJson("/api/campaigns/beispiel/generate", generateBody)).status).toBe(202);
    expect((await fetchJob())!.status).toBe("running");

    expect(
      (await app.request("/api/campaigns/beispiel/generate/job", { method: "DELETE" })).status,
    ).toBe(200);
    open.open();
    // Let the abandoned run finish into nothing.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await fetchJob()).toBeNull();
  });

  test("review edits: 404 without a job, 400 for an unknown path, and edits survive", async () => {
    const sceneId = "job-drafts";
    const edited = `${sceneDraft({ npcs: ["fenn"] }).body}\nHandgeschriebene Ergänzung.\n`;

    // no job at all
    let res = await putSceneEdit("beispiel", sceneId, edited);
    expect(res.status).toBe(404);

    useFake([jobReply(sceneId)]);
    await generate(generateBody);

    // a path that is not part of the result: the review patch stores only
    // keys the result knows
    res = await putSceneEdit("beispiel", "fremd", edited);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("unknown scene");
    expect((await fetchJob())!.sceneEdits).toEqual({});

    // malformed bodies: an edit is an object of the scene's fields, each of
    // its own shape
    expect((await patchReview("beispiel", { sceneEdits: { [sceneId]: 42 } })).status).toBe(400);
    expect((await patchReview("beispiel", { sceneEdits: { [sceneId]: edited } })).status).toBe(
      400,
    );
    expect(
      (await patchReview("beispiel", { sceneEdits: { [sceneId]: { body: 42 } } })).status,
    ).toBe(400);
    expect(
      (await patchReview("beispiel", { sceneEdits: { [sceneId]: { properties: "x" } } })).status,
    ).toBe(400);
    expect(
      (await patchReview("beispiel", { sceneEdits: { [sceneId]: { name: "x" } } })).status,
    ).toBe(400);
    expect((await patchReview("beispiel", { sceneEdits: edited })).status).toBe(400);
    expect(
      (await patchReview("beispiel", { sceneEdits: { [sceneId]: { body: edited } }, extra: 1 }))
        .status,
    ).toBe(400);
    // The old key names a form that is gone.
    expect((await patchReview("beispiel", { edits: { [sceneId]: { body: edited } } })).status).toBe(
      400,
    );

    // the real thing
    res = await putSceneEdit("beispiel", sceneId, edited);
    expect(res.status).toBe(200);

    const job = await fetchJob();
    expect(job!.sceneEdits).toEqual({ [sceneId]: { body: edited } });
    // the result itself is untouched — the edit sits next to it
    expect(job!.result!.scenes[0]!.body).not.toBe(edited);

    // last write wins
    const rewritten = `${sceneDraft({ npcs: ["fenn"] }).body}\nNoch einmal anders.\n`;
    expect((await putSceneEdit("beispiel", sceneId, rewritten)).status).toBe(200);
    expect((await fetchJob())!.sceneEdits[sceneId]).toEqual({ body: rewritten });
  });

  test("review edits merge field by field, and a later one keeps the earlier", async () => {
    const sceneId = "job-halves";
    useFake([jobReply(sceneId)]);
    await generate(generateBody);
    const served = (await fetchJob())!.result!.scenes[0]!;

    // Only the body: every other field stays the model's.
    const body = `${served.body}\nNur der Text.\n`;
    expect((await putSceneEdit("beispiel", sceneId, body)).status).toBe(200);
    expect((await fetchJob())!.sceneEdits[sceneId]).toEqual({ body });

    // Only the title: the body edit above SURVIVES — the fields and the text
    // of one proposal save through the same endpoint.
    expect(
      (await patchReview("beispiel", { sceneEdits: { [sceneId]: { title: "Von Hand benannt" } } }))
        .status,
    ).toBe(200);
    expect((await fetchJob())!.sceneEdits[sceneId]).toEqual({ title: "Von Hand benannt", body });

    // …and the accept writes exactly those fields on top of the model's scene.
    const job = await fetchJob();
    const res = await postJson(
      `/api/campaigns/beispiel/generate/job/${job!.id}/accept`,
      { rev: job!.rev, scenes: [sceneId] },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { scenes: string[] }).scenes).toEqual([sceneId]);
    const stored = await read(sceneId);
    expect(stored.title).toBe("Von Hand benannt");
    expect(stored.body).toBe(body);
    expect(stored.npcs).toEqual(served.npcs);
  });

  test("apply with jobId discards the job; a stale id leaves it alone", async () => {
    const sceneId = "job-apply";
    useFake([jobReply(sceneId)]);
    await generate(generateBody);
    const job = await fetchJob();

    // a stale id (a newer run started meanwhile) must not drop this job
    let res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: [sceneItem(sceneWithId("job-apply-stale"))],
      jobId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(200);
    expect((await fetchJob())!.id).toBe(job!.id);

    res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: job!.result!.scenes,
      npcs: [],
      jobId: job!.id,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scenes: [sceneId], npcs: [], locations: [] });
    expect(await exists(sceneId)).toBe(true);
    // the scenes are rows now — there is nothing left to restore
    expect(await fetchJob()).toBeNull();
  });

  test("a FAILED apply keeps the job — the review must stay restorable", async () => {
    const sceneId = "job-apply"; // written by the test above
    useFake([jobReply(sceneId)]);
    await generate(generateBody);
    const job = await fetchJob();

    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: job!.result!.scenes,
      npcs: [],
      jobId: job!.id,
    });
    expect(res.status).toBe(409);
    expect((await fetchJob())!.id).toBe(job!.id);
  });

  test("400 for a jobId that is not a string", async () => {
    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: [sceneItem(sceneWithId("job-badid"))],
      jobId: 7,
    });
    expect(res.status).toBe(400);
    expect(await exists("job-badid")).toBe(false);
  });

  test("a new start replaces a finished job", async () => {
    useFake([
      jobReply("job-first"),
      jobReply("job-second"),
    ]);
    await generate(generateBody);
    const first = await fetchJob();
    expect(first!.status).toBe("done");

    await generate(generateBody);
    const second = await fetchJob();
    expect(second!.status).toBe("done");
    expect(second!.id).not.toBe(first!.id);
    expect(second!.result!.scenes[0]!.id).toBe("job-second");
  });

  // --- surviving a restart --------------------------------------------------

  test("a FINISHED job survives a restart whole — result, edits, applyable", async () => {
    const sceneId = "job-restart";
    const edited = `${sceneDraft({ npcs: ["fenn"] }).body}\nNach dem Neustart noch da.\n`;
    useFake([jobReply(sceneId)]);
    await generate(generateBody);
    const before = (await fetchJob())!;
    expect(before.status).toBe("done");
    expect((await putSceneEdit("beispiel", sceneId, edited)).status).toBe(200);

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
    expect(after.sceneEdits).toEqual({ [sceneId]: { body: edited } });

    // …and it can still be applied, which is the whole point of keeping it.
    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: after.result!.scenes,
      npcs: [],
      jobId: after.id,
    });
    expect(res.status).toBe(200);
    expect(await exists(sceneId)).toBe(true);
    expect(await fetchJob()).toBeNull();
  });

  test("a RUNNING job cannot survive — the boot fails it with the restart message", async () => {
    const open = gate();
    useFake([jobReply("job-interrupted")], undefined, open.promise);
    expect((await postJson("/api/campaigns/beispiel/generate", generateBody)).status).toBe(202);
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
    useFake([jobReply("job-discarded")]);
    await generate(generateBody);
    expect(
      (await app.request("/api/campaigns/beispiel/generate/job", { method: "DELETE" })).status,
    ).toBe(200);

    expect(await restartServer()).toBe(0);
    const res = await app.request("/api/campaigns/beispiel/generate/job");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no generate job for this campaign" });
  });

  // --- a row that cannot be read --------------------------------------------

  test("a done job with an unreadable result is served as FAILED and can be discarded", async () => {
    useFake([jobReply("job-unreadable")]);
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
    expect((await app.request("/api/campaigns/beispiel/generate/job", { method: "DELETE" })).status).toBe(200);
    expect(await fetchJob()).toBeNull();
  });

  test("a failed job with an unreadable error body still carries a message", async () => {
    useFake([jobReply("job-unreadable-error")]);
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

  // --- the invariant is a constraint ----------------------------------------

  test("a second job row for the same campaign is rejected by the database", async () => {
    useFake([jobReply("job-unique")]);
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
        })
        .run(),
    ).toThrow(/constraint/i);
  });

  // --- apply and job cleanup commit together --------------------------------

  test("apply discards the job in the SAME commit as the scenes", async () => {
    const sceneId = "job-atomic";
    useFake([jobReply(sceneId)]);
    await generate(generateBody);
    const job = (await fetchJob())!;

    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: job.result!.scenes,
      npcs: [],
      jobId: job.id,
    });
    expect(res.status).toBe(200);
    // Both halves of the commit are visible…
    expect(await exists(sceneId)).toBe(true);
    expect(await fetchJob()).toBeNull();
    // …and no leftover row is there for a restart to revive.
    const db = await getDb();
    expect(
      db.select().from(generateJobs).where(eq(generateJobs.campaignId, "beispiel")).all(),
    ).toHaveLength(0);
    expect(await restartServer()).toBe(0);
  });

  test("a 409 apply rolls back BOTH halves — job kept, nothing written", async () => {
    const taken = "job-atomic"; // written by the test above
    const fresh = "job-atomic-fresh";
    useFake([
      reply({
        scenes: [{ content: sceneWithId(taken) }, { content: sceneWithId(fresh) }],
        entries: [],
      }),
    ]);
    await generate(generateBody);
    const job = (await fetchJob())!;

    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: job.result!.scenes,
      npcs: [],
      jobId: job.id,
    });
    expect(res.status).toBe(409);
    expect((await fetchJob())!.id).toBe(job.id);
    expect(await exists(fresh)).toBe(false);
  });

  test("jobs are per campaign — an unknown campaign simply has none", async () => {
    expect(await fetchJob("nope")).toBeNull();
    useFake([jobReply("job-scope")]);
    await generate(generateBody);
    expect((await fetchJob("beispiel"))!.status).toBe("done");
    expect(await fetchJob("nope")).toBeNull();
  });
});

// --- LLM_CORRECTION_TURNS ---------------------------------------------------

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
      reply({ scenes: [{ content: sceneDraft({ status: "ready" }) }], entries: [] }),
    );
  }

  test("0: no correction turn at all — one call, then 422", async () => {
    process.env.LLM_CORRECTION_TURNS = "0";
    const fake = useFake(badReplies(1));
    const res = await generate(generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { validationErrors: string[] };
    expect(body.validationErrors).toEqual([
      expect.stringContaining('scene "treffen-am-kai": "status"'),
    ]);
    // The SCENE part spent exactly one call — no correction turn at all.
    expect(fake.callsFor("treffen-am-kai")).toHaveLength(1);
    expect(fake.calls.every((call) => call.corrections.length === 0)).toBe(true);
  });

  test("1 (default): one correction turn", async () => {
    const fake = useFake(badReplies(2));
    expect((await generate(generateBody)).status).toBe(422);
    // Per PART — the bound is the same, the unit is smaller.
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

// --- campaign knowledge in the run ------------------------------------------
//
// Two claims, both about the WIRING rather than about the wording: the
// knowledge reaches the provider on every run kind (the wording itself is
// llm-provider.test.ts's buildPrompt block), and the naming check runs over
// the finished drafts and lands in the result.

describe("campaign knowledge", () => {
  /**
   * A reply whose proposed npc is one the campaign does NOT have yet. The
   * database is shared by this file and the apply cases above already
   * wrote the npc `grella`, and a proposal for an npc that holds content
   * cannot be accepted, so these cases bring their own.
   */
  const FRESH_NPC = "grella-vom-kai";
  function freshReply(over: { scenes?: Array<{ content: ScriptedEntry }> } = {}): string {
    return reply({
      ...over,
      entries: [{ kind: "npc", content: proposedNpc({ id: FRESH_NPC, name: "Grella" }) }],
    });
  }

  // The database is shared by this file, so the list must not leak into
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
    expect(knowledge).toContain('schreibe „Salt Harbour“ immer als „Salzhafen“');
    expect(knowledge).toContain("- Stilregel: Keine Würfelwerte im Read-Aloud.");
  });

  // The NPC run's half of this (knowledge travels, `[[slug]]` resolved) is in
  // generate-npc.test.ts — it needs the harness that stands there.

  test("a draft that keeps the old spelling produces a hint with its position", async () => {
    await setKnowledge([
      { kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" },
    ]);
    const base = sceneDraft();
    const scene = {
      ...base,
      body: base.body.replace(
        "Fenn wartet am Kai; Grella beobachtet aus dem Schatten.",
        "Fenn wartet am Kai von Salt Harbour.",
      ),
    };
    useFake([freshReply({ scenes: [{ content: scene }] })]);
    const result = (await (await generate(generateBody)).json()) as GenerateResult;
    // A HINT, not a failure: the run succeeded and the draft is in the result.
    expect(result.scenes).toHaveLength(1);
    expect(result.namingHints).toHaveLength(1);
    const hint = result.namingHints![0]!;
    expect(hint).toMatchObject({
      from: "Salt Harbour",
      to: "Salzhafen",
      scene: SCENE_ID,
      field: "body",
      excerpt: "Fenn wartet am Kai von Salt Harbour.",
    });
    expect(hint.line).toBeGreaterThan(0);
  });

  test("a proposed npc is checked too, and its hint names it by id", async () => {
    await setKnowledge([{ kind: "naming", from: "Grella", to: "Grellwyn", text: "" }]);
    useFake([freshReply({ scenes: [{ content: sceneWithId("kai-zwei") }] })]);
    const result = (await (await generate(generateBody)).json()) as GenerateResult;
    const npcs = (result.namingHints ?? []).map((h) => h.npc);
    expect(npcs).toContain(FRESH_NPC);
  });

  test("a draft that FOLLOWS the convention produces no hint at all", async () => {
    await setKnowledge([{ kind: "naming", from: "Salt Harbour", to: "Salzhafen", text: "" }]);
    useFake([freshReply({ scenes: [{ content: sceneWithId("kai-drei") }] })]);
    const result = (await (await generate(generateBody)).json()) as GenerateResult;
    expect(result.namingHints).toBeUndefined();
  });
});

// --- the write-layer net under a generated chapter ------------------------------

describe("a proposed scene whose chapter has no row", () => {
  test("gets the chapter in the same write, named by its id", async () => {
    // The apply path is the ONE scene write without a dialog in front of it,
    // and it is what let scenes land under a chapter that had none: the
    // overview lists chapters, so chapter and scenes were both unreachable.
    // `ensureChapterRow` closes it, and it is the ONE creation path inside
    // the accept: the run decided the chapter, so accepting has to write it
    // (ADR #18). A location a scene names is not created that way — the
    // proposal has to bring it, or the scene is refused.
    const draft = sceneDraft({ id: "brut-im-dunkeln", chapter: "03-drachenbrut" });
    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      // No `chapter`/`chapterTitle` in the body on purpose — this is the net
      // under the job-driven creation, not the creation itself.
      scenes: [sceneItem(draft)],
    });
    expect(res.status).toBe(200);

    const chapter = await readChapter("03-drachenbrut");
    // No title was known here, so the chapter is called by its slug — which
    // is at least readable in the overview, where an unreachable chapter was not.
    expect(chapter.title).toBe("03-drachenbrut");
    expect(chapter.status).toBe("planned");

    // …and the scene really hangs in it.
    const tree = (await (await app.request("/api/campaigns/beispiel/tree")).json()) as {
      chapters: Array<{ id: string; scenes: Array<{ id: string }> }>;
    };
    const node = tree.chapters.find((c) => c.id === "03-drachenbrut");
    expect(node?.scenes.map((s) => s.id)).toContain("brut-im-dunkeln");
  });

  test("a chapter id that is no slug answers 400 and names the chapter", async () => {
    // `ensureChapterRow` only creates a chapter for a real entity slug. An id
    // like `Kapitel_1` is not one, so the apply says so instead of storing a
    // scene nothing can reach.
    const draft = sceneDraft({ id: "brut-im-schacht", chapter: "Kapitel_1" });
    const res = await postJson("/api/campaigns/beispiel/generate/apply", {
      scenes: [sceneItem(draft)],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("Kapitel_1");
    // Nothing was written — not the scene, and not a chapter either.
    expect(await chapterExists("Kapitel_1")).toBe(false);
  });

  test("a DIALOG still refuses an unknown chapter — ADR #19 stands", async () => {
    // The rule is about reachability, not about inventing chapters: where a
    // DM typed the chapter, an unknown one is a typo and the honest answer is
    // the 400.
    const res = await postJson("/api/campaigns/beispiel/scenes", {
      title: "Szene im Nichts",
      chapter: "99-gibt-es-nicht",
    });
    expect(res.status).toBe(400);
  });
});
