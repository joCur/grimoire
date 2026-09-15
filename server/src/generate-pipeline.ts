// The scene generator as a PIPELINE (issue #102).
//
// Before this ticket a scene run was ONE provider call that had to come back
// with every scene, every suggested entry and every warning at once. That is
// the most expensive way to be wrong: a single unknown callout in the third
// scene failed the whole reply, the correction turn resent the entire prompt
// plus the entire reply, and a run that hit the output cap produced nothing
// at all.
//
// So a run is now three steps instead of one:
//
//   1. OUTLINE — one small call. Which scenes exist, what they are called,
//      which location they belong to, which other scenes they reference, and
//      which npcs/locations the campaign does not know yet. Every id in the
//      whole run is decided HERE, which is what makes the cross references of
//      step 2 consistent (AK4). The outline has its own validation and its
//      own correction turns.
//
//      Each outline scene also names the FIRST and LAST sentence of its
//      source passage, verbatim. The server cuts the passage out of the
//      source text with those two quotes (`cutExcerpt`) — so the per-scene
//      call carries the paragraph it is about and not the whole book. When
//      the quotes cannot be found the scene simply gets the WHOLE source
//      text: more expensive, never wrong, and never a reason to fail a run
//      (PO decision, 15.09.).
//
//      The outline is INTERNAL. It is never shown to the DM and never
//      offered for editing — it exists to reduce errors, and the only thing
//      the DM is interested in is the finished scene (PO, 15.09.).
//
//   2. SCENES — one call per outline scene, three at a time. Prompt =
//      the scene prompt in „single scene from outline“ mode + the outline +
//      the excerpt. Validation, correction turns and the naming check happen
//      PER SCENE, so a form error costs that scene and nothing else, and a
//      finished scene is reviewable while its siblings are still running.
//
//   3. ENTRIES — one call per new npc/location of the outline, with the
//      scenes that reference it as context. Deduped by id.
//
// What does NOT change: the augment run (#36) and the NPC run (#21) stay
// single-call runs — one entry each, nothing to decompose (PO decision).

import {
  SCENE_TYPES,
  type GenerateJobPart,
  type GenerateUsage,
  type GeneratedSceneDraft,
  type GeneratedStub,
  type NamingHint,
} from "@grimoire/shared";
import { ENTITY_SLUG } from "@grimoire/shared/slug";
import {
  MAX_OUTLINE_ENTRIES,
  MAX_OUTLINE_SCENES,
  OUTLINE_ENTRY_KINDS,
  OUTLINE_SCHEMA_DESCRIPTION,
  OUTLINE_SCHEMA_NAME,
  outlineJsonSchema,
} from "@grimoire/shared/outline-schema";
import { ApiError } from "./campaign-fs";
import { checkDraftsNaming } from "./naming-check";
import {
  ASSET_FILES,
  buildCorrectionMessage,
  collectSceneContext,
  extractJsonReply,
  loadAsset,
  loadPromptAssets,
  obtainProvider,
  runPipeline,
  npcBodyErrors,
  quickstatsErrors,
  stubPath,
  validateEntry,
  validateSceneDocument,
  type AllowedRefs,
  type SceneContext,
} from "./generator";
export type { SceneContext } from "./generator";
import { parseWithProperties, reparseAtAddress, unknownCallouts } from "./generator";
import { parseDocumentReply } from "./document-reply";
import { jsonrepair } from "jsonrepair";
import type { LLMProvider } from "./llm-provider";
import { locationPath, npcPath } from "./store/paths";

/** How many scene/entry calls of one run are in flight at once (PO: 3). */
export const PART_CONCURRENCY = 3;

/**
 * The most parts ONE outline may produce — 12 scenes and 12 suggested
 * entries, counted separately.
 *
 * Without it the outline decides how many provider calls a run makes, and a
 * source text that is a whole adventure (or a model that splits every
 * paragraph) turns one „Entwürfe generieren“ into dozens of calls the DM
 * never asked for and cannot stop except by discarding the run. A chapter of
 * twelve playable scenes is already a long evening — beyond that the honest
 * answer is „cut the source text“, so an outline over the bound is a
 * VALIDATION ERROR and therefore a correction turn that asks the model to
 * consolidate, not a failed run.
 *
 * The numbers live in the SCHEMA module since issue #107 (`maxItems` states
 * them to the provider, the validation below enforces them) and are
 * re-exported here, where every caller already reads them.
 */
export { MAX_OUTLINE_ENTRIES, MAX_OUTLINE_SCENES } from "@grimoire/shared/outline-schema";

// --- the outline --------------------------------------------------------------

/** One scene of the outline — everything the per-scene call needs to know. */
export interface OutlineScene {
  id: string;
  title: string;
  type: string;
  location?: string;
  /** The verbatim first/last sentence of this scene's source passage. */
  sourceExcerpt?: { first: string; last: string };
  /** ids of OTHER outline scenes this one refers to. */
  refs: string[];
}

/** One npc/location the outline says the campaign does not know yet. */
export interface OutlineEntry {
  kind: "npc" | "location";
  id: string;
  name: string;
  summary: string;
}

export interface RunOutline {
  scenes: OutlineScene[];
  entries: OutlineEntry[];
  warnings: string[];
}

const OUTLINE_CORRECTION_TAIL = "die vollständige Gliederung enthalten";

/**
 * The run warning a REPAIRED outline earns (issue #107, Zuschnitt 4). German,
 * like the excerpt-fallback warning next to it: it rides along in the run's
 * `warnings` and the review shows those verbatim.
 *
 * Why it is a warning at all: the repair is silent otherwise, and „the model
 * answered something JSON.parse could not read" is exactly the kind of thing
 * a DM wants to see once — a provider whose replies need patching every run
 * is a provider to reconsider, and without the note nobody would ever know.
 */
export const REPAIRED_REPLY_WARNING =
  "Antwort musste repariert werden — das Modell hat die Gliederung nicht als " +
  "gültiges JSON geliefert.";

/**
 * The outline reply as a JSON value — with ONE tolerant repair attempt before
 * a correction turn is spent (issue #107, Zuschnitt 4).
 *
 * `extractJsonReply` already handles prose and fences around a WELL-FORMED
 * object. What it cannot do is read an object that is merely almost JSON: a
 * trailing comma, a single-quoted key, an unescaped newline inside a string.
 * Those are the errors a model makes when it hand-writes JSON, and they are
 * mechanical — `jsonrepair` fixes them deterministically and much more
 * cheaply than a correction turn, which resends the whole prompt.
 *
 * `repaired` says which way in it was, so the run can say so too. The result
 * goes through the UNCHANGED validation either way: the repair loosens the
 * parsing, never the rules (the same line issue #20 drew for the extraction).
 */
export function parseOutlineJson(raw: string): { value: unknown; repaired: boolean } | null {
  const extracted = extractJsonReply(raw);
  if (extracted !== null) return { value: extracted.value, repaired: false };
  // A model that wrote no JSON at all is not repairable — jsonrepair would
  // happily turn prose into a string, which then fails validation with a
  // message about the wrong thing. So the repair only runs on a candidate
  // that at least LOOKS like an object.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return { value: JSON.parse(jsonrepair(raw.slice(start, end + 1))), repaired: true };
  } catch {
    return null;
  }
}

/** One of the schema's entry kinds (#107) — the list is the schema's own. */
function isOutlineEntryKind(v: unknown): v is (typeof OUTLINE_ENTRY_KINDS)[number] {
  return typeof v === "string" && (OUTLINE_ENTRY_KINDS as readonly string[]).includes(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Mechanical validation of the outline reply. The rules are the ones the
 * batch reply always had, moved one level up: kebab ids, no duplicate id in
 * the whole run, a known scene `type`, a `location` that resolves against the
 * campaign OR the outline's own entries, and `refs` that name outline scenes.
 *
 * The chapter is NOT the model's (issue #100): a scene that names one has to
 * name the run's, and anything else is a correction turn rather than a
 * silently ignored key — a model that invents chapters also invents addresses.
 */
export function validateOutlineReply(
  raw: string,
  ctx: SceneContext,
): { ok: true; result: RunOutline } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const parsedReply = parseOutlineJson(raw);
  if (parsedReply === null) return { ok: false, errors: ["reply is not valid JSON"] };
  if (!isRecord(parsedReply.value)) return { ok: false, errors: ["reply must be a JSON object"] };
  const obj = parsedReply.value;

  const rawScenes = obj.scenes ?? [];
  if (!Array.isArray(rawScenes)) return { ok: false, errors: ['"scenes" must be an array'] };
  const rawEntries = obj.entries ?? [];
  if (!Array.isArray(rawEntries)) return { ok: false, errors: ['"entries" must be an array'] };

  const seen = new Set<string>();
  const entries: OutlineEntry[] = [];
  rawEntries.forEach((item, index) => {
    const label = `entries[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${label}: must be an object`);
      return;
    }
    const kind = item.kind;
    // The schema's own list (#107): the shape the provider is forced into and
    // the shape the validation accepts read the same constant.
    if (!isOutlineEntryKind(kind)) {
      errors.push(`${label}: "kind" must be ${OUTLINE_ENTRY_KINDS.join(" or ")}`);
      return;
    }
    const id = stringField(item, "id");
    if (id === undefined || !ENTITY_SLUG.test(id)) {
      errors.push(`${label}: "id" must be a kebab-case id (a-z, 0-9, single dashes)`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`${label}: duplicate id "${id}" — jede id kommt im Durchlauf nur einmal vor`);
      return;
    }
    // An id the campaign ALREADY has is deliberately not an error here: since
    // issue #70 a reference creates an empty row, so „locations/bucht exists“
    // routinely means „a scene mentioned it and nobody has written it yet“ —
    // exactly the entry this run should fill. The apply path is what decides
    // whether a write collides, and it always was.
    seen.add(id);
    entries.push({
      kind,
      id,
      name: stringField(item, "name") ?? id,
      summary: stringField(item, "summary") ?? "",
    });
  });

  const entryLocationIds = new Set(entries.filter((e) => e.kind === "location").map((e) => e.id));
  const scenes: OutlineScene[] = [];
  rawScenes.forEach((item, index) => {
    const label = `scenes[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${label}: must be an object`);
      return;
    }
    const id = stringField(item, "id");
    if (id === undefined || !ENTITY_SLUG.test(id)) {
      errors.push(`${label}: "id" must be a kebab-case id (a-z, 0-9, single dashes)`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`${label}: duplicate id "${id}" — jede id kommt im Durchlauf nur einmal vor`);
      return;
    }
    seen.add(id);
    const type = stringField(item, "type") ?? "";
    if (!(SCENE_TYPES as readonly string[]).includes(type)) {
      errors.push(`scene "${id}": "type" must be one of ${SCENE_TYPES.join(", ")}`);
    }
    const chapter = stringField(item, "chapter");
    if (chapter !== undefined && chapter !== ctx.chapter) {
      errors.push(
        `scene "${id}": "chapter" ist "${ctx.chapter}" — das Kapitel kommt aus dem Kontext ` +
          "und wird nicht vergeben",
      );
    }
    const location = stringField(item, "location");
    if (location !== undefined && !ctx.locationIds.has(location) && !entryLocationIds.has(location)) {
      errors.push(
        `scene "${id}": location "${location}" does not exist in the campaign and ` +
          `no suggested entry provides it`,
      );
    }
    const rawRefs = item.refs ?? [];
    if (!Array.isArray(rawRefs) || rawRefs.some((r) => typeof r !== "string")) {
      errors.push(`scene "${id}": "refs" must be an array of scene ids`);
    }
    const excerpt = item.sourceExcerpt;
    let sourceExcerpt: { first: string; last: string } | undefined;
    if (excerpt !== undefined && excerpt !== null) {
      if (!isRecord(excerpt)) {
        errors.push(`scene "${id}": "sourceExcerpt" must be an object with "first" and "last"`);
      } else {
        const first = stringField(excerpt, "first");
        const last = stringField(excerpt, "last");
        if (first === undefined || last === undefined) {
          errors.push(
            `scene "${id}": "sourceExcerpt" braucht "first" und "last" — ` +
              "je ein wörtliches Zitat aus dem Quelltext",
          );
        } else {
          sourceExcerpt = { first, last };
        }
      }
    }
    scenes.push({
      id,
      title: stringField(item, "title") ?? id,
      type,
      ...(location === undefined ? {} : { location }),
      ...(sourceExcerpt === undefined ? {} : { sourceExcerpt }),
      refs: Array.isArray(rawRefs) ? rawRefs.filter((r): r is string => typeof r === "string") : [],
    });
  });

  if (scenes.length === 0) errors.push('"scenes" must contain at least one scene');
  // The run's cost bound (MAX_OUTLINE_SCENES): one call per part, so an
  // outline that is too long is asked to consolidate instead of being run.
  if (scenes.length > MAX_OUTLINE_SCENES) {
    errors.push(
      `"scenes": ${scenes.length} Szenen sind zu viele für einen Durchlauf — ` +
        `fasse sie zu höchstens ${MAX_OUTLINE_SCENES} tragfähigen Szenen zusammen ` +
        "(Verzweigungen derselben Situation gehören in EINE Szene)",
    );
  }
  if (entries.length > MAX_OUTLINE_ENTRIES) {
    errors.push(
      `"entries": ${entries.length} neue Figuren und Orte sind zu viele für einen ` +
        `Durchlauf — nenne höchstens ${MAX_OUTLINE_ENTRIES}, die das Kapitel wirklich braucht`,
    );
  }

  // Cross references LAST: they can only be checked once every scene id is
  // known, and an unknown ref is the one outline error that would otherwise
  // reach the DM as a dangling `[[id]]` in a finished scene (AK4).
  const sceneIds = new Set(scenes.map((s) => s.id));
  for (const scene of scenes) {
    for (const ref of scene.refs) {
      if (ref === scene.id) {
        errors.push(`scene "${scene.id}": "refs" verweist auf sich selbst`);
        continue;
      }
      if (!sceneIds.has(ref)) {
        errors.push(`scene "${scene.id}": ref "${ref}" ist keine Szene dieser Gliederung`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];
  return {
    ok: true,
    result: {
      scenes,
      entries,
      // The repair is recorded as a run warning, not swallowed.
      warnings: parsedReply.repaired ? [...warnings, REPAIRED_REPLY_WARNING] : warnings,
    },
  };
}

// --- cutting the source passage ----------------------------------------------

/**
 * Cut one scene's source passage out of the whole source text by the outline's
 * two verbatim quotes.
 *
 * Matching is done on a WHITESPACE-NORMALIZED copy (every run of whitespace
 * becomes one space) with an index map back into the original, because that is
 * the one difference a model reliably introduces: it re-wraps a quote that was
 * hard-wrapped in the source. Everything else — a changed word, a translated
 * sentence, an invented ellipsis — counts as a MISS.
 *
 * A miss is not an error. The scene then gets the whole source text (`matched:
 * false`), which is more expensive and never wrong; the caller records which
 * of the two happened.
 */
export function cutExcerpt(
  source: string,
  excerpt: { first: string; last: string } | undefined,
): { text: string; matched: boolean } {
  if (excerpt === undefined) return { text: source, matched: false };
  const norm = normalizeWithMap(source);
  const first = normalizeText(excerpt.first);
  const last = normalizeText(excerpt.last);
  if (first === "" || last === "") return { text: source, matched: false };

  const start = norm.text.indexOf(first);
  if (start === -1) return { text: source, matched: false };
  // The last sentence is searched from the FIRST one on, so a sentence that
  // occurs twice in the source cannot cut the passage backwards.
  const lastStart = norm.text.indexOf(last, start);
  if (lastStart === -1) return { text: source, matched: false };
  const end = lastStart + last.length;
  const from = norm.offsets[start];
  const to = norm.offsets[end - 1];
  if (from === undefined || to === undefined) return { text: source, matched: false };
  return { text: source.slice(from, to + 1).trim(), matched: true };
}

/** Collapse whitespace runs into single spaces. */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The same normalization over the SOURCE, keeping for every normalized
 * character the offset it came from — that map is what turns a match in the
 * normalized copy back into a slice of the original text.
 */
function normalizeWithMap(source: string): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (/\s/.test(ch)) {
      if (text !== "") pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      text += " ";
      offsets.push(i);
      pendingSpace = false;
    }
    text += ch;
    offsets.push(i);
  }
  return { text, offsets };
}

// --- the per-call prompt assets ----------------------------------------------

/**
 * The scene system prompt in „genau eine Szene aus der Gliederung“ mode: the
 * scene prompt with its own output section swapped for the outline-bound one
 * (`scene-single-output.md`).
 *
 * A swap rather than a second prompt file, for the reason the augment run's
 * `formatContract` exists: the rules (#93 orthography and quotation marks,
 * #96 tables, the callout list, the reference rules) must be the SAME text in
 * both, and the one way to guarantee that is to have them in one file.
 *
 * Both sections describe the RAW document since issue #107 — the swap adds
 * what only the pipeline knows: the outline is binding, and every id of the
 * run is already decided.
 */
export async function sceneSystemPrompt(): Promise<string> {
  const doc = await loadAsset(ASSET_FILES.scene.systemPrompt);
  const replacement = await loadAsset(ASSET_FILES.sceneSingle.systemPrompt);
  const start = doc.indexOf("## Ausgabeformat");
  if (start === -1) return `${doc.trimEnd()}\n\n${replacement}`;
  const rest = doc.slice(start + "## Ausgabeformat".length);
  const next = rest.indexOf("\n## ");
  const tail = next === -1 ? "" : rest.slice(next + 1);
  return `${doc.slice(0, start)}${replacement.trimEnd()}\n\n${tail}`;
}

/**
 * The outline block every per-part prompt carries (llm-provider
 * OUTLINE_HEADING) — and it carries NOTHING about which part this call is
 * about. That marker used to live here, which silently defeated the prompt
 * caching this ticket built: the block is part of the CONSTANT half, so one
 * changed character per part made every part a cache miss. Which scene is
 * assigned is now a line of its own in the variable half
 * (`assignmentBlock`, llm-provider ASSIGNMENT_HEADING).
 */
export function outlineBlock(outline: RunOutline): string {
  const lines: string[] = [];
  lines.push("Szenen dieses Durchlaufs (in dieser Reihenfolge):");
  for (const scene of outline.scenes) {
    const bits = [`- ${scene.id} — ${scene.title} (${scene.type}`];
    bits.push(scene.location === undefined ? ")" : `, location: ${scene.location})`);
    const refs = scene.refs.length === 0 ? "" : ` → verweist auf: ${scene.refs.join(", ")}`;
    lines.push(`${bits.join("")}${refs}`);
  }
  if (outline.entries.length > 0) {
    lines.push("");
    lines.push("Neue Figuren und Orte dieses Durchlaufs (ids nutzbar wie bestehende):");
    for (const entry of outline.entries) {
      lines.push(`- ${entry.kind}: ${entry.id} (${entry.name}) — ${entry.summary}`);
    }
  }
  return lines.join("\n");
}

/** Which scene of the outline THIS call writes (llm-provider ASSIGNMENT_HEADING). */
export function assignmentBlock(scene: OutlineScene): string {
  return `${scene.id} — ${scene.title}`;
}

// --- per-part validation -------------------------------------------------------

/** What a single-scene reply must look like: one document plus warnings. */
export function validateSingleSceneReply(input: {
  raw: string;
  ctx: SceneContext;
  scene: OutlineScene;
  allowed: AllowedRefs;
}): { ok: true; result: { scene: GeneratedSceneDraft; warnings: string[] } } | { ok: false; errors: string[] } {
  // Since issue #107 the reply IS the document: no wrapper to be tolerant
  // about any more, only the document itself and — after `---warnings---` —
  // the warnings. `parseDocumentReply` strips a fence and a leading sentence;
  // everything below judges the markdown, exactly as it did before.
  const split = parseDocumentReply(input.raw);
  if (!split.ok) return { ok: false, errors: [split.error] };
  const reply = split.reply;
  const errors: string[] = [];
  const draft = validateSceneDocument({
    content: reply.content,
    label: `scene "${input.scene.id}"`,
    chapter: input.ctx.chapter,
    allowed: input.allowed,
    seenIds: new Set(),
    errors,
    expectedId: input.scene.id,
  });
  if (draft === null || errors.length > 0) return { ok: false, errors };
  return { ok: true, result: { scene: draft, warnings: reply.warnings } };
}

/**
 * One suggested ENTRY, validated as the entry of a scene run (issue #102).
 *
 * Deliberately built on `validateEntry` — the very function that judged the
 * `entries` of the batch reply — plus the npc FORMAT rules of the npc run
 * (`npcBodyErrors`, quickstats). What it does NOT take from the npc RUN are
 * the rules that are about that run rather than about the file: an npc run
 * forbids a `chapter` key (it has no target chapter) while a scene run's
 * entry legitimately belongs to the run's chapter, and its pinned-id rule is
 * replaced by the outline's id.
 */
export function validateEntryReply(
  raw: string,
  entry: OutlineEntry,
  ctx: SceneContext,
): { ok: true; result: { stub: GeneratedStub; warnings: string[] } } | { ok: false; errors: string[] } {
  const split = parseDocumentReply(raw);
  if (!split.ok) return { ok: false, errors: [split.error] };
  const reply = split.reply;
  const errors: string[] = [];
  const stub = validateEntry({ kind: entry.kind, content: reply.content }, 0, errors);
  if (stub === null || errors.length > 0) return { ok: false, errors };
  const label = `${entry.kind} "${entry.id}"`;
  if (stub.id !== entry.id) {
    return {
      ok: false,
      errors: [
        `${label}: die id muss "${entry.id}" bleiben — sie kommt aus der Gliederung und ` +
          "die Szenen dieses Durchlaufs verweisen darauf",
      ],
    };
  }
  const { parsed } = parseWithProperties(reply.content, entryAddress(entry.kind, entry.id));
  for (const callout of unknownCallouts(parsed.body)) {
    errors.push(`${label}: unknown callout "[!${callout}]"`);
  }
  if (entry.kind === "npc") {
    for (const msg of quickstatsErrors(parsed.properties)) errors.push(`${label}: ${msg}`);
    for (const msg of npcBodyErrors(parsed.body, ctx)) errors.push(`${label}: ${msg}`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, result: { stub, warnings: reply.warnings } };
}

// --- the run ------------------------------------------------------------------

/** What one finished part contributes to the job's result. */
export interface PartOutcome {
  scene?: GeneratedSceneDraft;
  stub?: GeneratedStub;
  warnings: string[];
  namingHints: NamingHint[];
  /** The excerpt could not be matched, so the part got the WHOLE source. */
  excerptFallback?: boolean;
}

/** Usage of one part — `calls` is what the review header sums into „M Aufrufe“. */
export interface PartUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

/**
 * How the job store follows a run. Every callback PERSISTS: a part that
 * finished has to be on the row before the next one starts, because "done
 * parts survive a restart" (AK3) is only true of what was written down.
 */
export interface PipelineSink {
  /**
   * The outline is in: the job now knows its parts (in outline order). The
   * OUTLINE ITSELF is stored too — a per-part retry and a restart both need
   * it, and neither has anything but the row to read it from. It is never
   * serialized to the client (PipelineRecord).
   */
  outlineReady(outline: RunOutline, parts: GenerateJobPart[], usage: PartUsage): Promise<void>;
  partRunning(key: string): Promise<void>;
  partDone(key: string, outcome: PartOutcome, usage: PartUsage): Promise<void>;
  partFailed(
    key: string,
    failure: { error: string; validationErrors?: string[]; rawReply?: string },
    usage: PartUsage,
  ): Promise<void>;
  /** True once the run was cancelled („Verwerfen“) or replaced. */
  cancelled(): boolean;
}

/** The part key the retry endpoint addresses. */
export function scenePartKey(id: string): string {
  return `scene:${id}`;
}

export function entryPartKey(kind: "npc" | "location", id: string): string {
  return `${kind}:${id}`;
}

/** The parts an outline produces, in the order the review shows them. */
export function outlineParts(outline: RunOutline): GenerateJobPart[] {
  return [
    ...outline.scenes.map(
      (scene): GenerateJobPart => ({
        key: scenePartKey(scene.id),
        kind: "scene",
        id: scene.id,
        title: scene.title,
        status: "pending",
      }),
    ),
    ...outline.entries.map(
      (entry): GenerateJobPart => ({
        key: entryPartKey(entry.kind, entry.id),
        kind: entry.kind,
        id: entry.id,
        title: entry.name,
        status: "pending",
      }),
    ),
  ];
}

/**
 * A part's usage, from a successful result or from a thrown ApiError, with the
 * CALL COUNT taken from the counter rather than from `usage.attempts`: a local
 * endpoint reports no usage at all, and „M Aufrufe“ must be true anyway.
 */
function usageOf(value: unknown, calls: number): PartUsage {
  const usage = (value ?? {}) as Partial<GenerateUsage>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: num(usage.inputTokens),
    outputTokens: num(usage.outputTokens),
    calls: Math.max(calls, 1),
  };
}

/**
 * Counts the provider calls of one part (runPipeline `onCall`). Created by
 * `runPart` and handed to the step, so a part that FAILS can report its
 * attempts too — the error body carries no call count.
 */
export interface CallCounter {
  onCall: () => void;
  count: () => number;
}

export function callCounter(): CallCounter {
  let calls = 0;
  return {
    onCall: () => {
      calls += 1;
    },
    count: () => calls,
  };
}

/** The message and the error list the DM reads next to „Erneut versuchen“. */
function failureOf(
  err: unknown,
  calls: number,
): {
  error: string;
  validationErrors?: string[];
  rawReply?: string;
  usage: PartUsage;
} {
  if (err instanceof ApiError) {
    const extra = err.extra ?? {};
    const errors = extra.validationErrors;
    return {
      error: err.message,
      ...(Array.isArray(errors) && errors.every((e) => typeof e === "string")
        ? { validationErrors: errors as string[] }
        : {}),
      ...(typeof extra.rawReply === "string" ? { rawReply: extra.rawReply } : {}),
      usage: usageOf(extra.usage, calls),
    };
  }
  console.error(err);
  return {
    error: "internal server error",
    usage: { inputTokens: 0, outputTokens: 0, calls: Math.max(calls, 1) },
  };
}

/**
 * Everything one part needs, gathered once per run so a retry can rebuild a
 * single part without redoing the context reads.
 */
export interface RunPlan {
  campaign: string;
  ctx: SceneContext;
  outline: RunOutline;
  sourceText: string;
  allowed: AllowedRefs;
  /**
   * The cut source passage per scene id, computed once for the whole run.
   * `entryContext` needs every scene's passage for every entry it builds, and
   * the cut normalizes the WHOLE source text per call — so an outline with
   * ten scenes and ten entries used to normalize it a hundred times.
   */
  excerpts: Map<string, { text: string; matched: boolean }>;
}

/**
 * The plan of a run: the campaign context plus the outline, and the id sets a
 * scene may reference (the campaign's plus the outline's own entries — AK4:
 * every id comes from the outline, so the validation checks against outline +
 * context and nothing else).
 */
export function planOf(input: {
  campaign: string;
  ctx: SceneContext;
  outline: RunOutline;
  sourceText: string;
}): RunPlan {
  const { ctx, outline } = input;
  return {
    ...input,
    excerpts: new Map(
      outline.scenes.map((scene) => [
        scene.id,
        cutExcerpt(input.sourceText, scene.sourceExcerpt),
      ]),
    ),
    allowed: {
      npcIds: new Set([
        ...ctx.npcIds,
        ...outline.entries.filter((e) => e.kind === "npc").map((e) => e.id),
      ]),
      locationIds: new Set([
        ...ctx.locationIds,
        ...outline.entries.filter((e) => e.kind === "location").map((e) => e.id),
      ]),
    },
  };
}

/** Step 1: the outline call, with its own correction turns. */
export async function runOutlineStep(
  ctx: SceneContext,
  sourceText: string,
  provider: LLMProvider,
): Promise<{ outline: RunOutline; usage: PartUsage }> {
  const counter = callCounter();
  const assets = await loadPromptAssets("outline");
  const result = await runPipeline<{ outline: RunOutline; usage?: GenerateUsage }>({
    req: {
      systemPrompt: assets.systemPrompt,
      fewShotTarget: assets.fewShotTarget,
      knowledge: ctx.knowledge,
      glossary: ctx.glossary,
      context: { chapter: ctx.chapter, npcs: ctx.npcs, locations: ctx.locations },
      sourceText,
      // The one call of a run that still answers JSON — so it is the one
      // call whose shape the API can GUARANTEE (issue #107): Claude gets a
      // forced tool, an OpenAI-compatible endpoint `json_schema`.
      jsonSchema: {
        name: OUTLINE_SCHEMA_NAME,
        description: OUTLINE_SCHEMA_DESCRIPTION,
        schema: outlineJsonSchema(),
      },
    },
    provider,
    validate: (raw) => {
      const outcome = validateOutlineReply(raw, ctx);
      return outcome.ok ? { ok: true, result: { outline: outcome.result } } : outcome;
    },
    correctionTail: OUTLINE_CORRECTION_TAIL,
    correctionFormat: "outline",
    onCall: counter.onCall,
  });
  return { outline: result.outline, usage: usageOf(result.usage, counter.count()) };
}

/** Step 2: one scene. */
export async function runScenePart(
  plan: RunPlan,
  scene: OutlineScene,
  provider: LLMProvider,
  counter: CallCounter = callCounter(),
): Promise<{ outcome: PartOutcome; usage: PartUsage }> {
  const [systemPrompt, fewShotTarget] = await Promise.all([
    sceneSystemPrompt(),
    loadAsset(ASSET_FILES.scene.fewShotTarget),
  ]);
  const cut = excerptOf(plan, scene);
  const result = await runPipeline<{
    scene: GeneratedSceneDraft;
    warnings: string[];
    usage?: GenerateUsage;
  }>({
    req: {
      systemPrompt,
      fewShotTarget,
      knowledge: plan.ctx.knowledge,
      glossary: plan.ctx.glossary,
      context: { chapter: plan.ctx.chapter, npcs: plan.ctx.npcs, locations: plan.ctx.locations },
      outline: outlineBlock(plan.outline),
      assignment: assignmentBlock(scene),
      sourceText: cut.text,
    },
    provider,
    validate: (raw) => validateSingleSceneReply({ raw, ctx: plan.ctx, scene, allowed: plan.allowed }),
    correctionTail: "die vollständige Szene enthalten",
    onCall: counter.onCall,
  });
  return {
    outcome: {
      scene: result.scene,
      warnings: [
        ...result.warnings,
        // The DM has to know when a scene was written from the WHOLE source
        // instead of its passage: it is the one quality difference the
        // pipeline can produce silently (PO decision, 15.09.).
        ...(cut.matched
          ? []
          : [
              `Der Quelltext-Ausschnitt für „${scene.title}“ ließ sich nicht wörtlich ` +
                "zuordnen — diese Szene wurde aus dem ganzen Quelltext geschrieben.",
            ]),
      ],
      namingHints: checkDraftsNaming(
        [{ path: result.scene.path, markdown: result.scene.markdown }],
        plan.ctx.namingRules,
      ),
      ...(cut.matched ? {} : { excerptFallback: true }),
    },
    usage: usageOf(result.usage, counter.count()),
  };
}

/** Step 3: one suggested entry, with the scenes that reference it as context. */
export async function runEntryPart(
  plan: RunPlan,
  entry: OutlineEntry,
  provider: LLMProvider,
  counter: CallCounter = callCounter(),
): Promise<{ outcome: PartOutcome; usage: PartUsage }> {
  const assets = await loadPromptAssets(entry.kind);
  const result = await runPipeline<{
    stub: GeneratedStub;
    warnings: string[];
    usage?: GenerateUsage;
  }>({
    req: {
      systemPrompt: assets.systemPrompt,
      fewShotTarget: assets.fewShotTarget,
      knowledge: plan.ctx.knowledge,
      glossary: plan.ctx.glossary,
      context: {
        npcs: plan.ctx.npcs,
        locations: plan.ctx.locations,
        targetId: entry.id,
      },
      outline: outlineBlock(plan.outline),
      // What this ONE call is about: the entry, and the passages of the
      // scenes that mention it (Zuschnitt 3). An entry used to fall out of
      // the batch reply with no context of its own at all.
      sourceText: entryContext(plan, entry),
    },
    provider,
    validate: (raw) => validateEntryReply(raw, entry, plan.ctx),
    correctionTail:
      entry.kind === "npc" ? "die vollständige NPC-Datei enthalten" : "die vollständige Ort-Datei enthalten",
    onCall: counter.onCall,
  });
  return {
    outcome: {
      stub: result.stub,
      warnings: result.warnings,
      namingHints: checkDraftsNaming(
        [{ path: stubPath(result.stub), markdown: result.stub.markdown }],
        plan.ctx.namingRules,
      ),
    },
    usage: usageOf(result.usage, counter.count()),
  };
}

/**
 * The source material of an entry call: the one-liner from the outline plus
 * the source passages of every scene that references the entry. A location is
 * referenced by the scenes whose `location` it is; an npc by the scenes whose
 * passage mentions its id or its name — the outline does not list npcs per
 * scene, and a text search over the passages is both cheap and honest.
 */
export function entryContext(plan: RunPlan, entry: OutlineEntry): string {
  const blocks: string[] = [`${entry.name} (${entry.id}): ${entry.summary}`];
  const needle = entry.name.toLowerCase();
  // The id is kebab-case ENGLISH while the name is German („harbour-master“ /
  // „Hafenmeisterin“), so the whole id rarely appears in an English source
  // text but its WORDS do. Each word is required, in any order — matching on
  // one word alone would pull „old“ or „the“ into every entry's context.
  const idWords = entry.id.split("-").filter((word) => word.length > 2);
  for (const scene of plan.outline.scenes) {
    const passage = excerptOf(plan, scene).text;
    const lower = passage.toLowerCase();
    const mentions =
      entry.kind === "location"
        ? scene.location === entry.id
        : lower.includes(needle) ||
          passage.includes(entry.id) ||
          (idWords.length > 0 && idWords.every((word) => lower.includes(word)));
    if (!mentions) continue;
    blocks.push(`### Szene „${scene.title}“ (${scene.id})\n\n${passage}`);
  }
  // Nothing matched: the whole source text is the honest fallback — the same
  // rule the excerpt cut follows.
  if (blocks.length === 1) blocks.push(plan.sourceText);
  return blocks.join("\n\n");
}

/** This scene's source passage — cut once per run (RunPlan.excerpts). */
function excerptOf(plan: RunPlan, scene: OutlineScene): { text: string; matched: boolean } {
  return plan.excerpts.get(scene.id) ?? cutExcerpt(plan.sourceText, scene.sourceExcerpt);
}

/**
 * Run one part and report it into the sink. The ONE place a part's outcome
 * becomes job state, so a fresh run and a „Erneut versuchen“ cannot drift.
 */
export async function runPart(
  plan: RunPlan,
  part: GenerateJobPart,
  provider: LLMProvider,
  sink: PipelineSink,
): Promise<void> {
  if (sink.cancelled()) return;
  await sink.partRunning(part.key);
  const counter = callCounter();
  try {
    const run =
      part.kind === "scene"
        ? await runScenePart(plan, sceneOf(plan.outline, part.id), provider, counter)
        : await runEntryPart(plan, entryOf(plan.outline, part.kind, part.id), provider, counter);
    if (sink.cancelled()) return;
    await sink.partDone(part.key, run.outcome, run.usage);
  } catch (err) {
    if (sink.cancelled()) return;
    const failure = failureOf(err, counter.count());
    await sink.partFailed(
      part.key,
      {
        error: failure.error,
        ...(failure.validationErrors === undefined
          ? {}
          : { validationErrors: failure.validationErrors }),
        ...(failure.rawReply === undefined ? {} : { rawReply: failure.rawReply }),
      },
      failure.usage,
    );
  }
}

export function sceneOf(outline: RunOutline, id: string): OutlineScene {
  const scene = outline.scenes.find((s) => s.id === id);
  if (scene === undefined) throw new ApiError(404, `unknown outline scene: ${id}`);
  return scene;
}

export function entryOf(
  outline: RunOutline,
  kind: "npc" | "location",
  id: string,
): OutlineEntry {
  const entry = outline.entries.find((e) => e.kind === kind && e.id === id);
  if (entry === undefined) throw new ApiError(404, `unknown outline entry: ${kind}/${id}`);
  return entry;
}

/** Run `parts` with at most PART_CONCURRENCY in flight; failures never stop siblings. */
export async function runPartsPooled(
  plan: RunPlan,
  parts: readonly GenerateJobPart[],
  provider: LLMProvider,
  sink: PipelineSink,
): Promise<void> {
  const queue = [...parts];
  const workers = Array.from({ length: Math.min(PART_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined || sink.cancelled()) return;
      // runPart swallows its own failure into the sink, so one bad part can
      // never take the pool — or its siblings — down (Zuschnitt 2).
      await runPart(plan, next, provider, sink);
    }
  });
  await Promise.all(workers);
}

/**
 * The whole scene run: outline, then every part. Writes NOTHING — the drafts
 * land in the job and only „Übernehmen“ touches the store.
 */
export async function runScenePipeline(input: {
  campaign: string;
  chapter: string;
  sourceText: string;
  newChapter: boolean;
  sink: PipelineSink;
  getProvider?: () => LLMProvider;
}): Promise<void> {
  const provider = (input.getProvider ?? obtainProvider)();
  const ctx = await collectSceneContext(input.campaign, input.chapter, input.newChapter);
  const { outline, usage } = await runOutlineStep(ctx, input.sourceText, provider);
  if (input.sink.cancelled()) return;
  const parts = outlineParts(outline);
  await input.sink.outlineReady(outline, parts, usage);
  const plan = planOf({
    campaign: input.campaign,
    ctx,
    outline,
    sourceText: input.sourceText,
  });
  await runPartsPooled(plan, parts, provider, input.sink);
}

/** Rebuild the plan of a STORED outline — what a per-part retry runs with. */
export async function replanStoredRun(input: {
  campaign: string;
  chapter: string;
  sourceText: string;
  newChapter: boolean;
  outline: RunOutline;
}): Promise<RunPlan> {
  const ctx = await collectSceneContext(input.campaign, input.chapter, input.newChapter);
  return planOf({
    campaign: input.campaign,
    ctx,
    outline: input.outline,
    sourceText: input.sourceText,
  });
}

/** `npcs/<id>` / `locations/<id>` — the address a stub part lands at. */
export function entryAddress(kind: "npc" | "location", id: string): string {
  return kind === "npc" ? npcPath(id) : locationPath(id);
}
