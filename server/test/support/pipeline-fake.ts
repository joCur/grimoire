// The scripted provider of the generator tests, pipeline-aware (issue #102).
//
// Before this ticket a scene run was ONE provider call, so a test scripted one
// batch reply per attempt: `useFake([badReply, goodReply])` meant "the first
// answer is wrong, the second is right". The run is now the outline call plus
// one call per scene and per suggested entry — but what a test WANTS to say is
// still exactly that sentence, so the fake keeps the same script and routes it:
//
//   outline call   a SYNTHETIC outline derived from the scripted batch reply
//                  (its scene ids/titles/types/locations and its entries).
//                  Deriving it means a test does not have to hand-write an
//                  outline to say something about a scene document — and a
//                  batch reply whose ids are unusable still fails the run,
//                  now at the outline step, with the same message.
//                  A reply that does not PARSE (garbage, a truncated one) is
//                  served verbatim here instead: that is a run that dies
//                  before it has parts, which is what those tests are about.
//   scene part     the scripted reply VERBATIM. The single-scene validation
//                  accepts a one-element `scenes` array, so a batch reply
//                  with one scene is a legal single-scene reply — which keeps
//                  the correction-turn assertions (the replayed assistant
//                  text, the raw reply in the error body) byte-exact.
//   entry part     the scripted reply's matching `entries` item, rewrapped as
//                  the npc/location prompt's own `{ npc }` / `{ location }`
//                  schema.
//
// Attempt N of a part reads script[N], so "bad, then good" still means one
// correction turn — per part, which is the whole point of the ticket.

import type {
  CompletionResult,
  CorrectionTurn,
  GenerateRequest,
  LLMProvider,
  TokenUsage,
} from "../../src/llm-provider";

/** A scripted reply: raw text, or text plus truncation/usage signals. */
export type ScriptedReply = string | { text: string; truncated?: boolean; usage?: TokenUsage };

export interface RecordedCall {
  req: GenerateRequest;
  corrections: CorrectionTurn[];
  /** Which call of the run this was: the outline, a scene, an entry. */
  part: string;
}

interface BatchReply {
  scenes: Array<{ content: string }>;
  entries: Array<{ kind?: string; content: string }>;
  warnings: string[];
}

function textOf(reply: ScriptedReply): string {
  return typeof reply === "string" ? reply : reply.text;
}

function completionOf(reply: ScriptedReply): CompletionResult {
  if (typeof reply === "string") return { text: reply, truncated: false };
  return { text: reply.text, truncated: reply.truncated ?? false, usage: reply.usage };
}

/** The batch object inside a scripted reply, or null when there is none. */
function parseBatch(reply: ScriptedReply): BatchReply | null {
  if (typeof reply !== "string" && reply.truncated === true) return null;
  const raw = textOf(reply);
  const fence = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/.exec(raw);
  const body = fence?.[1] ?? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  if (body === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.scenes)) return null;
  const scenes = obj.scenes.filter(
    (s): s is { content: string } =>
      s !== null && typeof s === "object" && typeof (s as { content?: unknown }).content === "string",
  );
  if (scenes.length === 0) return null;
  return {
    scenes,
    entries: Array.isArray(obj.entries)
      ? obj.entries.filter(
          (e): e is { kind?: string; content: string } =>
            e !== null &&
            typeof e === "object" &&
            typeof (e as { content?: unknown }).content === "string",
        )
      : [],
    warnings: Array.isArray(obj.warnings)
      ? obj.warnings.filter((w): w is string => typeof w === "string")
      : [],
  };
}

/** One `key: value` line of a document's properties block. */
function property(document: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(document);
  return match?.[1]?.trim();
}

/**
 * The first and the last sentence of the run's source text — the verbatim
 * quotes the outline names so the server's excerpt cut actually MATCHES. Every
 * scene gets the same pair, which cuts the whole source: a scripted test is
 * about the documents, not about which paragraph a scene came from, and a
 * fallback warning on every single case would be noise.
 */
function excerptOf(sourceText: string): { first: string; last: string } | undefined {
  const sentences = sourceText
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part !== "");
  const first = sentences[0];
  const last = sentences.at(-1);
  if (first === undefined || last === undefined) return undefined;
  return { first, last };
}

/** The outline a batch reply describes — the fake's synthetic first answer. */
function outlineOf(batch: BatchReply, sourceText: string): string {
  const sourceExcerpt = excerptOf(sourceText);
  return JSON.stringify(
    {
      scenes: batch.scenes.map((scene) => {
        const location = property(scene.content, "location");
        return {
          id: property(scene.content, "id") ?? "",
          title: property(scene.content, "title") ?? "",
          type: property(scene.content, "type") ?? "planned",
          ...(location === undefined ? {} : { location }),
          ...(sourceExcerpt === undefined ? {} : { sourceExcerpt }),
          refs: [],
        };
      }),
      entries: batch.entries.map((entry) => ({
        kind: entry.kind,
        id: property(entry.content, "id") ?? "",
        name: property(entry.content, "name") ?? "",
        summary: "aus dem Quelltext erwähnt",
      })),
      warnings: batch.warnings,
    },
    null,
    2,
  );
}

/** Which call of the run a request is. */
function classify(req: GenerateRequest): { kind: "outline" | "scene" | "entry" | "single"; id: string } {
  if (req.context.chapter === undefined && req.outline === undefined) {
    // No chapter and no outline: an npc run or an augment run — single call.
    return { kind: "single", id: "single" };
  }
  if (req.outline === undefined) return { kind: "outline", id: "outline" };
  if (req.context.chapter === undefined) {
    return { kind: "entry", id: req.context.targetId ?? "" };
  }
  const assigned = /^- ([a-z0-9-]+) .*← DIESE Szene/m.exec(req.outline);
  return { kind: "scene", id: assigned?.[1] ?? "" };
}

/**
 * Scripted provider: routes the script over the pipeline's calls and records
 * every one of them.
 */
export class PipelineFake implements LLMProvider {
  readonly name = "fake";
  readonly calls: RecordedCall[] = [];

  constructor(
    private replies: ScriptedReply[],
    readonly maxTokens?: number,
    /** Awaited before the FIRST reply — the "still running" gate. */
    private gate?: Promise<unknown>,
  ) {}

  /** The calls of one part — `"outline"`, a scene id, an entry id. */
  callsFor(part: string): RecordedCall[] {
    return this.calls.filter((call) => call.part === part);
  }

  /** The last scripted reply that carries a usable batch object. */
  private lastBatch(): BatchReply | null {
    for (let i = this.replies.length - 1; i >= 0; i -= 1) {
      const batch = parseBatch(this.replies[i] as ScriptedReply);
      if (batch !== null) return batch;
    }
    return null;
  }

  async complete(
    req: GenerateRequest,
    corrections: CorrectionTurn[] = [],
  ): Promise<CompletionResult> {
    const part = classify(req);
    this.calls.push({ req, corrections: corrections.map((c) => ({ ...c })), part: part.id });
    if (this.gate !== undefined) {
      const gate = this.gate;
      this.gate = undefined;
      await gate;
    }
    const attempt = corrections.length;
    const scripted = this.replies[Math.min(attempt, this.replies.length - 1)];
    if (scripted === undefined) throw new Error("PipelineFake: no scripted reply left");

    if (part.kind === "single") return completionOf(scripted);

    if (part.kind === "scene") {
      const batch = parseBatch(scripted);
      // A one-scene batch reply IS a legal single-scene reply, so it travels
      // VERBATIM — which is what keeps the replayed assistant turn and the
      // raw reply in an error body byte-exact. A batch with several scenes is
      // narrowed to the one this part is about; serving it whole would fail
      // every part with „genau EINE Szene", which is a statement about the
      // fake and not about the code under test.
      if (batch === null || batch.scenes.length <= 1) return completionOf(scripted);
      const scene =
        batch.scenes.find((doc) => property(doc.content, "id") === part.id) ?? batch.scenes[0];
      return {
        text: JSON.stringify({ scene: { content: scene!.content }, warnings: batch.warnings }),
        truncated: false,
        ...(typeof scripted === "string" || scripted.usage === undefined
          ? {}
          : { usage: scripted.usage }),
      };
    }

    if (part.kind === "outline") {
      // Unparseable or truncated: the run has to die HERE, with this text.
      if (parseBatch(scripted) === null) return completionOf(scripted);
      // Otherwise the outline is derived from the script's FINAL intent — the
      // last reply that carries a batch object. A script says "first this
      // document is wrong, then it is right"; the set of scenes and entries
      // the run is ABOUT is what the right one names.
      const batch = this.lastBatch();
      if (batch === null) return completionOf(scripted);
      return { text: outlineOf(batch, req.sourceText), truncated: false };
    }

    // An entry part: the scripted reply's matching entry, in the npc/location
    // prompt's own schema.
    const batch = parseBatch(scripted) ?? this.lastBatch();
    if (batch === null) return completionOf(scripted);
    const byId = (e: { content: string }) => property(e.content, "id") === part.id;
    // This attempt's own entry when it has one — by id, else the first one it
    // carries, because an entry whose id is MISSING is exactly the document a
    // test wants served. Only a reply with no entries at all falls back to
    // the script's final intent.
    const entry =
      batch.entries.find(byId) ?? batch.entries[0] ?? this.lastBatch()?.entries.find(byId);
    if (entry === undefined) return completionOf(scripted);
    const key = entry.kind === "location" ? "location" : "npc";
    return {
      text: JSON.stringify({ [key]: { content: entry.content }, warnings: [] }),
      truncated: false,
      ...(typeof scripted === "string" || scripted.usage === undefined
        ? {}
        : { usage: scripted.usage }),
    };
  }
}
