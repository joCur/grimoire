// Generator pipeline tests (issue #6). Like the write-API tests they run
// against a TEMP COPY of the example campaign (examples/ is the committed
// format reference and must never be mutated).
//
// No real LLM and no ANTHROPIC_API_KEY: a FakeProvider with scripted raw
// replies is injected via setProviderForTests(). It records every call, so
// the tests can assert the correction-turn mechanics (assistant reply
// replayed + validation errors sent back, max 2 correction turns).

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GenerateResult } from "@grimoire/shared";
import { app } from "../src/server";
import { getCampaignRoot, setCampaignRoot } from "../src/config";
import { setProviderForTests } from "../src/generator";
import type { CorrectionTurn, GenerateRequest, LLMProvider } from "../src/llm-provider";

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
});

// --- fake provider ------------------------------------------------------------

interface RecordedCall {
  req: GenerateRequest;
  corrections: CorrectionTurn[];
}

/** Scripted provider: returns its replies in order and records every call. */
class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: RecordedCall[] = [];
  constructor(private replies: string[]) {}

  async complete(req: GenerateRequest, corrections: CorrectionTurn[] = []): Promise<string> {
    this.calls.push({ req, corrections: corrections.map((c) => ({ ...c })) });
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error("FakeProvider: no scripted reply left");
    return reply;
  }
}

function useFake(replies: string[]): FakeProvider {
  const fake = new FakeProvider(replies);
  setProviderForTests(fake);
  return fake;
}

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

const STUB_MARKDOWN = [
  "---",
  "id: grella",
  "name: Grella",
  "role: Schmugglerin mit eigenen Plänen",
  "chapter: 01-salzhafen",
  "status: alive",
  "---",
  "",
  "## Will",
  "",
  "Im Quelltext nur erwähnt — Details fehlen.",
  "",
].join("\n");

function reply(
  over: {
    scenes?: Array<{ path: string; content: string }>;
    npc_stubs?: Array<{ path: string; content: string; reason?: string }>;
    location_stubs?: Array<{ path: string; content: string; reason?: string }>;
    warnings?: string[];
  } = {},
): string {
  const body = {
    scenes: over.scenes ?? [{ path: SCENE_PATH, content: sceneMarkdown() }],
    npc_stubs: over.npc_stubs ?? [
      { path: "npcs/grella.md", content: STUB_MARKDOWN, reason: "im Quelltext erwähnt" },
    ],
    location_stubs: over.location_stubs ?? [],
    warnings: over.warnings ?? ["Quelltext nennt keinen DC — DC 12 gesetzt"],
  };
  // Wrapped in a fence like real models tend to do — the parser strips it.
  return "```json\n" + JSON.stringify(body, null, 2) + "\n```";
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

const generateBody = { chapter: "01-salzhafen", sourceText: "Fenn waits at the docks." };

// --- POST /api/:campaign/generate --------------------------------------------------

describe("POST /api/:campaign/generate", () => {
  test("happy path: GenerateResult from one call, nothing written", async () => {
    const fake = useFake([reply()]);
    const res = await postJson("/api/beispiel/generate", generateBody);
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
    const res = await postJson("/api/beispiel/generate", generateBody);
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
    const res = await postJson("/api/beispiel/generate", generateBody);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("[!danger]");
  });

  test("422 with the remaining errors after 2 correction turns", async () => {
    const bad = reply({
      scenes: [{ path: SCENE_PATH, content: sceneMarkdown({ status: "ready" }) }],
    });
    const fake = useFake(["kein json", bad, bad]);
    const res = await postJson("/api/beispiel/generate", generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; validationErrors: string[] };
    expect(body.error).toContain("validation");
    expect(body.validationErrors).toEqual([expect.stringContaining('"status" must be "draft"')]);

    // initial call + exactly 2 correction turns = 3 provider calls
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[1]!.corrections[0]!.correction).toContain("not valid JSON");
    expect(fake.calls[2]!.corrections).toHaveLength(2);
    expect(await exists(SCENE_PATH)).toBe(false);
  });

  test("scene path outside the requested chapter is a validation error", async () => {
    const bad = reply({
      scenes: [{ path: "02-anderswo/kai.md", content: sceneMarkdown() }],
    });
    const fake = useFake([bad, bad, bad]);
    const res = await postJson("/api/beispiel/generate", generateBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { validationErrors: string[] };
    expect(body.validationErrors[0]).toContain("01-salzhafen/");
    expect(fake.calls).toHaveLength(3);
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
      expect((await postJson("/api/beispiel/generate", b)).status).toBe(400);
    }
    expect(fake.calls).toHaveLength(0);
  });

  test("404 for unknown campaign, unknown chapter, and reserved dirs", async () => {
    const fake = useFake([]);
    expect((await postJson("/api/nope/generate", generateBody)).status).toBe(404);
    expect(
      (await postJson("/api/beispiel/generate", { ...generateBody, chapter: "99-nope" })).status,
    ).toBe(404);
    expect(
      (await postJson("/api/beispiel/generate", { ...generateBody, chapter: "npcs" })).status,
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
      const res = await postJson("/api/beispiel/generate", generateBody);
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
    const gen = await postJson("/api/beispiel/generate", generateBody);
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
});
