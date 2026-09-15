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
//   scene part     the scripted reply's scene document, as the REPLY OBJECT
//                  of issue #107: `properties` (the document's frontmatter,
//                  parsed), `body`, and the batch reply's `warnings`.
//   entry part     the scripted reply's matching `entries` item, likewise.
//   single call    the npc/augment run's scripted document, likewise — a
//                  reply that does NOT parse as a batch / `{ npc }` /
//                  `{ entry }` object travels verbatim, which is what the
//                  garbage and the truncation cases are about.
//
// The script keeps writing DOCUMENTS (`content`: markdown with a properties
// block), because that is how a test says what a run is about in one literal.
// The fake is what turns them into the object a schema-forced provider
// delivers — so the correction turns, the replayed assistant turns and the
// `rawReply` of an error body are all in the real shape. A `content` whose
// properties block does not parse travels VERBATIM: that is a reply the run
// has to fail on, and the failure is the test's subject.
//
// Attempt N of a part reads script[N], so "bad, then good" still means one
// correction turn — per part, which is the whole point of the ticket.

import { CORE_SCHEMA, load } from "js-yaml";
import { PAIR_KEY, PAIR_VALUE, propertyFieldsFor } from "@grimoire/shared";
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

/**
 * The REPLY OBJECT of issue #107, built out of a scripted document: the
 * properties block parsed into `properties`, everything below it as `body`,
 * plus the script's warnings. Returns null when the document has no parseable
 * properties block — such a script is served verbatim, because a reply the
 * server cannot read is exactly what those cases test.
 *
 * `quickstats` (and any other key/value field) is turned into the `{ key,
 * value }` LIST the schema asks for — a free mapping cannot be expressed in
 * strict mode (shared/document-schema.ts).
 */
export function documentReply(
  content: string,
  warnings: readonly string[] = [],
  kind: "scene" | "npc" | "location" = "scene",
): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (match === null) return null;
  let data: unknown;
  try {
    data = load(match[1]!, { schema: CORE_SCHEMA });
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const properties = { ...(data as Record<string, unknown>) };
  for (const field of propertyFieldsFor(kind) ?? []) {
    if (field.control !== "pairs") continue;
    const value = properties[field.key];
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    properties[field.key] = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => ({ [PAIR_KEY]: key, [PAIR_VALUE]: String(item) }),
    );
  }
  return JSON.stringify({
    properties,
    body: (match[2] ?? "").replace(/^\n+/, "").replace(/\s*$/, "\n"),
    warnings: [...warnings],
  });
}

/** The reply object of a scripted document, or the document verbatim. */
function replyOrVerbatim(
  content: string,
  warnings: readonly string[],
  kind: "scene" | "npc" | "location",
): string {
  return documentReply(content, warnings, kind) ?? content;
}

/**
 * The ONE document a scripted single-call reply carries: `{ npc }` for an NPC
 * run, `{ entry }` for an augment run — plus `scene`/`location`, so a script
 * can say any of them. Null when the reply is not such an object, and then it
 * travels verbatim.
 */
function singleDocument(reply: ScriptedReply): { content: string; warnings: string[] } | null {
  if (typeof reply !== "string" && reply.truncated === true) return null;
  const raw = textOf(reply);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const key of ["npc", "entry", "location", "scene"]) {
    const value = obj[key];
    if (value === null || typeof value !== "object") continue;
    const content = (value as { content?: unknown }).content;
    if (typeof content !== "string") continue;
    return {
      content,
      warnings: Array.isArray(obj.warnings)
        ? obj.warnings.filter((w): w is string => typeof w === "string")
        : [],
    };
  }
  return null;
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
  // Which scene this call writes is its own section of the prompt's VARIABLE
  // half since the review of issue #102 — inside the outline block it made
  // every part a different cached prefix.
  const assigned = /^([a-z0-9-]+) /.exec(req.assignment ?? "");
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

    if (part.kind === "single") {
      const document = singleDocument(scripted);
      if (document === null) return completionOf(scripted);
      return {
        ...completionOf(scripted),
        // Which kind the single call is about is not in the request; the npc
        // run and an npc augment are the ones with key/value fields, so npc
        // is the honest default here (a scene/location document simply has
        // no `pairs` field to convert).
        text: replyOrVerbatim(document.content, document.warnings, "npc"),
      };
    }

    if (part.kind === "scene") {
      const batch = parseBatch(scripted);
      // Not a batch object at all (garbage, a truncated reply): served
      // verbatim, because that is a reply the run has to fail on.
      if (batch === null) return completionOf(scripted);
      // The document this part is about — a batch with several scenes is
      // narrowed to the assigned one; serving them all would fail every part
      // for a reason that is about the fake, not about the code under test.
      const scene =
        batch.scenes.find((doc) => property(doc.content, "id") === part.id) ?? batch.scenes[0];
      return {
        text: replyOrVerbatim(scene!.content, batch.warnings, "scene"),
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
    return {
      text: replyOrVerbatim(entry.content, [], entry.kind === "location" ? "location" : "npc"),
      truncated: false,
      ...(typeof scripted === "string" || scripted.usage === undefined
        ? {}
        : { usage: scripted.usage }),
    };
  }
}
