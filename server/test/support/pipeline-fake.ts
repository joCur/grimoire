// The scripted provider of the generator tests, pipeline-aware.
//
// A scene run is the outline call plus one call per scene, per new npc and
// per new location, but what a test WANTS to say is still "the first answer is wrong,
// the second is right" — so the fake keeps one script per attempt and routes
// it over the run's calls:
//
//   outline call   a SYNTHETIC outline derived from the scripted batch reply
//                  (its scene ids/titles/types/locations, its npcs and
//                  locations — the script's `entries` by their `kind` — and
//                  its `chapterDescription`).
//                  Deriving it means a test does not have to hand-write an
//                  outline to say something about a scene — and a batch reply
//                  whose ids are unusable still fails the run, now at the
//                  outline step, with the same message.
//                  A reply that does not PARSE (garbage, a truncated one) is
//                  served verbatim here instead: that is a run that dies
//                  before it has parts, which is what those tests are about.
//   scene part     the scripted reply's scene entry, as the REPLY OBJECT:
//                  `properties`, `body`, and the batch reply's `warnings`.
//   npc/location   the scripted reply's matching `entries` item, in the
//   part           npc's or the location's own reply form.
//   single call    the npc/augment run's scripted entry, likewise — a
//                  reply that does NOT parse as a batch / `{ npc }` /
//                  `{ entry }` object travels verbatim, which is what the
//                  garbage and the truncation cases are about.
//
// A script writes every entry as `{ properties, body }`, so it says in one
// literal exactly what the run is about, and the fake adds what a
// schema-forced provider adds: the `warnings`, and for an npc or a location
// its own flat reply form (every field beside `body`, `null` for an optional
// field the script leaves out, an npc's `quickstats` as its list of pairs).
// Nothing here renders or parses an entry as one markdown text.
//
// Attempt N of a part reads script[N], so "bad, then good" still means one
// correction turn — per part.

import type {
  CompletionResult,
  CorrectionTurn,
  GenerateRequest,
  LLMProvider,
  TokenUsage,
} from "../../src/llm-provider";

/** A scripted reply: raw text, or text plus truncation/usage signals. */
export type ScriptedReply = string | { text: string; truncated?: boolean; usage?: TokenUsage };

/** One entry a script carries: the two halves of an entry. */
export interface ScriptedEntry {
  properties: Record<string, unknown>;
  body: string;
}

export interface RecordedCall {
  req: GenerateRequest;
  corrections: CorrectionTurn[];
  /** Which call of the run this was: the outline, a scene, an entry. */
  part: string;
}

interface BatchReply {
  scenes: Array<{ content: ScriptedEntry }>;
  entries: Array<{ kind?: string; content: ScriptedEntry }>;
  warnings: string[];
  /** Served as the outline's `chapterDescription`; null when the script has none. */
  chapterDescription: string | null;
}

function textOf(reply: ScriptedReply): string {
  return typeof reply === "string" ? reply : reply.text;
}

function completionOf(reply: ScriptedReply): CompletionResult {
  if (typeof reply === "string") return { text: reply, truncated: false };
  return { text: reply.text, truncated: reply.truncated ?? false, usage: reply.usage };
}

/** Is this value a scripted entry — both halves, in the right shape? */
function isEntry(value: unknown): value is ScriptedEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const properties = entry.properties;
  return (
    properties !== null &&
    typeof properties === "object" &&
    !Array.isArray(properties) &&
    typeof entry.body === "string"
  );
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
    (s): s is { content: ScriptedEntry } =>
      s !== null && typeof s === "object" && isEntry((s as { content?: unknown }).content),
  );
  if (scenes.length === 0) return null;
  return {
    scenes,
    entries: Array.isArray(obj.entries)
      ? obj.entries.filter(
          (e): e is { kind?: string; content: ScriptedEntry } =>
            e !== null && typeof e === "object" && isEntry((e as { content?: unknown }).content),
        )
      : [],
    warnings: Array.isArray(obj.warnings)
      ? obj.warnings.filter((w): w is string => typeof w === "string")
      : [],
    chapterDescription: typeof obj.chapterDescription === "string" ? obj.chapterDescription : null,
  };
}

/**
 * The REPLY OBJECT of a scripted entry plus the script's warnings — what a
 * schema-forced provider delivers.
 *
 * A scene replies with its two halves. An npc and a location reply with
 * their own fields (ADR #31): the script's fields stand beside `body` and
 * `warnings`, and an optional field the script leaves out is `null` — "not
 * given", exactly as a strict provider delivers it. An npc's status is one
 * of its four values in every reply the provider lets through, so a script
 * that names none answers `unknown`, and its `quickstats` set travels as the
 * list of pairs the schema asks for.
 */
export function entryReply(
  entry: ScriptedEntry,
  warnings: readonly string[] = [],
  kind: "scene" | "npc" | "location" = "scene",
): string {
  if (kind === "npc") {
    const { quickstats, ...fields } = entry.properties;
    const pairs =
      quickstats !== null && typeof quickstats === "object" && !Array.isArray(quickstats)
        ? Object.entries(quickstats as Record<string, unknown>).map(([key, value]) => ({
            key,
            value: String(value),
          }))
        : (quickstats ?? null);
    return JSON.stringify({
      role: null,
      chapter: null,
      status: "unknown",
      statblock: null,
      voice: null,
      appearance: null,
      motivation: null,
      ...fields,
      quickstats: pairs,
      body: entry.body,
      warnings: [...warnings],
    });
  }
  if (kind === "location") {
    return JSON.stringify({
      chapter: null,
      roll20Page: null,
      atmosphere: null,
      ...entry.properties,
      body: entry.body,
      warnings: [...warnings],
    });
  }
  return JSON.stringify({
    properties: entry.properties,
    body: entry.body,
    warnings: [...warnings],
  });
}

/**
 * The ONE entry a scripted single-call reply carries: `{ npc }` for an NPC
 * run, `{ entry }` for an augment run — plus `scene`/`location`, so a script
 * can say any of them. Null when the reply is not such an object, and then it
 * travels verbatim.
 */
function singleEntry(reply: ScriptedReply): { content: ScriptedEntry; warnings: string[] } | null {
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
    if (!isEntry(content)) continue;
    return {
      content,
      warnings: Array.isArray(obj.warnings)
        ? obj.warnings.filter((w): w is string => typeof w === "string")
        : [],
    };
  }
  return null;
}

/** One property of a scripted entry, as a string — the outline reads these. */
function property(entry: ScriptedEntry, key: string): string | undefined {
  const value = entry.properties[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The first and the last sentence of the run's source text — the verbatim
 * quotes the outline names so the server's excerpt cut actually MATCHES. Every
 * scene gets the same pair, which cuts the whole source: a scripted test is
 * about the entries, not about which paragraph a scene came from, and a
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
      npcs: batch.entries
        .filter((entry) => entry.kind !== "location")
        .map((entry) => ({
          id: property(entry.content, "id") ?? "",
          name: property(entry.content, "name") ?? "",
          summary: "aus dem Quelltext erwähnt",
        })),
      locations: batch.entries
        .filter((entry) => entry.kind === "location")
        .map((entry) => ({
          id: property(entry.content, "id") ?? "",
          name: property(entry.content, "name") ?? "",
          summary: "aus dem Quelltext erwähnt",
        })),
      // Whatever the script says, for every run kind: dropping it for a run
      // into an existing chapter is the server's job, not the fake's.
      chapterDescription: batch.chapterDescription,
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
  // half: inside the outline block it made every part a different cached
  // prefix.
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
      const entry = singleEntry(scripted);
      if (entry === null) return completionOf(scripted);
      return {
        ...completionOf(scripted),
        // A scene augment run carries the scene it works on and a location
        // augment run the location; the npc run and the npc augment run
        // answer in the npc's own form.
        text: entryReply(
          entry.content,
          entry.warnings,
          req.existingEntry !== undefined
            ? "scene"
            : req.existingLocation !== undefined
              ? "location"
              : "npc",
        ),
      };
    }

    if (part.kind === "scene") {
      const batch = parseBatch(scripted);
      // Not a batch object at all (garbage, a truncated reply): served
      // verbatim, because that is a reply the run has to fail on.
      if (batch === null) return completionOf(scripted);
      // The entry this part is about — a batch with several scenes is
      // narrowed to the assigned one; serving them all would fail every part
      // for a reason that is about the fake, not about the code under test.
      const scene =
        batch.scenes.find((doc) => property(doc.content, "id") === part.id) ?? batch.scenes[0];
      return {
        text: entryReply(scene!.content, batch.warnings, "scene"),
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
      // entry is wrong, then it is right"; the set of scenes and entries
      // the run is ABOUT is what the right one names.
      const batch = this.lastBatch();
      if (batch === null) return completionOf(scripted);
      return { text: outlineOf(batch, req.sourceText), truncated: false };
    }

    // An entry part: the scripted reply's matching entry, in the npc/location
    // prompt's own schema.
    const batch = parseBatch(scripted) ?? this.lastBatch();
    if (batch === null) return completionOf(scripted);
    const byId = (e: { content: ScriptedEntry }) => property(e.content, "id") === part.id;
    // This attempt's own entry when it has one — by id, else the first one it
    // carries, because an entry whose id is MISSING is exactly the one a test
    // wants served. Only a reply with no entries at all falls back to the
    // script's final intent.
    const entry =
      batch.entries.find(byId) ?? batch.entries[0] ?? this.lastBatch()?.entries.find(byId);
    if (entry === undefined) return completionOf(scripted);
    return {
      text: entryReply(entry.content, [], entry.kind === "location" ? "location" : "npc"),
      truncated: false,
      ...(typeof scripted === "string" || scripted.usage === undefined
        ? {}
        : { usage: scripted.usage }),
    };
  }
}
