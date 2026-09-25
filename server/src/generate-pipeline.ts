// The scene generator as a PIPELINE.
//
// A single provider call returning every scene, every proposed npc and
// location and every warning at once is the most expensive way to be wrong: one unknown
// callout in the third scene fails the whole reply, the correction turn
// resends the entire prompt plus the entire reply, and a run that hits the
// output cap produces nothing at all.
//
// So a run is three steps instead of one:
//
//   1. OUTLINE — one small call. Which scenes exist, what they are called,
//      which location they belong to, which other scenes they reference, and
//      which npcs and which locations the campaign does not know yet — two
//      lists of their own. Every id in the whole run is decided HERE, which
//      is what makes the cross references of step 2 consistent. The outline
//      has its own validation and its own correction turns.
//
//      Each outline scene also names the FIRST and LAST sentence of its
//      source passage, verbatim. The server cuts the passage out of the
//      source text with those two quotes (`cutExcerpt`) — so the per-scene
//      call carries the paragraph it is about and not the whole book. When
//      the quotes cannot be found the scene simply gets the WHOLE source
//      text: more expensive, never wrong, and never a reason to fail a run.
//
//      The outline is INTERNAL. It is never shown to the DM and never
//      offered for editing — it exists to reduce errors, and the only thing
//      the DM is interested in is the finished scene.
//
//   2. SCENES — one call per outline scene, three at a time. Prompt =
//      the scene prompt in single-scene-from-outline mode + the outline +
//      the excerpt. Validation, correction turns and the naming check happen
//      PER SCENE, so a form error costs that scene and nothing else, and a
//      finished scene is reviewable while its siblings are still running.
//
//   3. NPCS AND LOCATIONS — one call per new npc and per new location of the
//      outline, each with the scenes that reference it as context and each
//      answered in its entity's own reply form. Deduped by id.
//
// The augment runs and the NPC run stay single-call runs — one row each,
// nothing to decompose.

import {
  SCENE_TYPES,
  type GenerateJobPart,
  type GenerateUsage,
  type GeneratedSceneDraft,
  type LocationProposal,
  type NamingHint,
  type NpcProposal,
} from "@grimoire/shared";
import { ENTITY_SLUG } from "@grimoire/shared/slug";
import {
  MAX_OUTLINE_PROPOSALS,
  MAX_OUTLINE_SCENES,
  OUTLINE_SCHEMA_DESCRIPTION,
  OUTLINE_SCHEMA_NAME,
  outlineJsonSchema,
} from "@grimoire/shared/outline-schema";
import { entryReplySchema } from "@grimoire/shared/entry-schema";
import { ApiError } from "./api-error";
import { checkDraftsNaming } from "./naming-check";
import {
  ASSET_FILES,
  campaignRefIds,
  collectSceneContext,
  loadAsset,
  loadPromptAssets,
  obtainProvider,
  runPipeline,
  unknownCallouts,
  unknownRefErrors,
  validateLocationProposal,
  validateNpcProposal,
  validateSceneEntry,
  type AllowedRefs,
  type SceneContext,
} from "./generator";
export type { SceneContext } from "./generator";
import { parseEntryReply, parseJsonReply } from "./entry-reply";
import { locationReplyRequest, parseLocationReply } from "./location-reply";
import { npcReplyRequest, parseNpcReply } from "./npc-reply";
import type { LLMProvider } from "./llm-provider";

/** How many scene, npc and location calls of one run are in flight at once. */
export const PART_CONCURRENCY = 3;

/**
 * The most parts ONE outline may produce — 12 scenes, and 12 new npcs and
 * locations counted together.
 *
 * Without it the outline decides how many provider calls a run makes, and a
 * source text that is a whole adventure (or a model that splits every
 * paragraph) turns one generate action into dozens of calls the DM never
 * asked for and cannot stop except by discarding the run. A chapter of
 * twelve playable scenes is already a long evening — beyond that the honest
 * answer is to cut the source text, so an outline over the bound is a
 * VALIDATION ERROR and therefore a correction turn that asks the model to
 * consolidate, not a failed run.
 *
 * The numbers live in the SCHEMA module (`maxItems` states
 * them to the provider, the validation below enforces them) and are
 * re-exported here, where every caller already reads them.
 */
export { MAX_OUTLINE_PROPOSALS, MAX_OUTLINE_SCENES } from "@grimoire/shared/outline-schema";

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

/** One npc the outline says the campaign does not know yet. */
export interface OutlineNpc {
  id: string;
  name: string;
  /** One sentence on what the npc is in the adventure. */
  summary: string;
}

/** One location the outline says the campaign does not know yet. */
export interface OutlineLocation {
  id: string;
  name: string;
  /** One sentence on what the location is in the adventure. */
  summary: string;
}

/**
 * The outline of a run: its scenes, and the npcs and the locations it
 * introduces as two lists of their own — the same split the job's result has
 * (`result.npcs`, `result.locations`).
 */
export interface RunOutline {
  scenes: OutlineScene[];
  npcs: OutlineNpc[];
  locations: OutlineLocation[];
  warnings: string[];
  /**
   * What the chapter a new-chapter run creates is about, from the source
   * material — it becomes that chapter's text when the run is accepted.
   * Only a new-chapter run's outline carries it; for a run into an existing
   * chapter whatever the reply says is dropped here, so the chapter's text
   * cannot be reached from a run.
   */
  chapterDescription?: string;
}

const OUTLINE_CORRECTION_TAIL = "die vollständige Gliederung enthalten";

/**
 * The run warning a REPAIRED outline earns. German,
 * like the excerpt-fallback warning next to it: it rides along in the run's
 * `warnings` and the review shows those verbatim.
 *
 * Why it is a warning at all: the repair is silent otherwise, and "the model
 * answered something JSON.parse could not read" is exactly the kind of thing
 * a DM wants to see once — a provider whose replies need patching every run
 * is a provider to reconsider, and without the note nobody would ever know.
 */
export const REPAIRED_REPLY_WARNING =
  "Antwort musste repariert werden — das Modell hat die Gliederung nicht als " +
  "gültiges JSON geliefert.";

/**
 * The outline reply as a JSON value — read by the tolerant reader every reply
 * shares (`parseJsonReply`, ./entry-reply): the whole text first (which is
 * what a schema-forced reply is), then a fence, then the brace span, and ONE
 * deterministic `jsonrepair` attempt before a correction turn is spent.
 *
 * Kept as a named function of its own because the outline's `repaired` flag
 * becomes a RUN WARNING here, and because the tests of this step address it.
 */
export function parseOutlineJson(raw: string): { value: unknown; repaired: boolean } | null {
  return parseJsonReply(raw);
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
 * the whole run — across scenes, npcs and locations —, a known scene `type`,
 * a `location` that resolves against the campaign OR the outline's own
 * locations, and `refs` that name outline scenes.
 *
 * The chapter is NOT the model's: a scene that names one has to
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
  const rawNpcs = obj.npcs ?? [];
  if (!Array.isArray(rawNpcs)) return { ok: false, errors: ['"npcs" must be an array'] };
  const rawLocations = obj.locations ?? [];
  if (!Array.isArray(rawLocations)) return { ok: false, errors: ['"locations" must be an array'] };

  const seen = new Set<string>();
  /**
   * One new npc or location of the outline: its id a kebab slug that the
   * whole run uses only once, its name (the id when none), its one-liner.
   * The two lists share the rule, not the result: each keeps its own items.
   */
  const readNew = (item: unknown, label: string): OutlineNpc | OutlineLocation | null => {
    if (!isRecord(item)) {
      errors.push(`${label}: must be an object`);
      return null;
    }
    const id = stringField(item, "id");
    if (id === undefined || !ENTITY_SLUG.test(id)) {
      errors.push(`${label}: "id" must be a kebab-case id (a-z, 0-9, single dashes)`);
      return null;
    }
    if (seen.has(id)) {
      errors.push(`${label}: duplicate id "${id}" — jede id kommt im Durchlauf nur einmal vor`);
      return null;
    }
    // An id the campaign ALREADY has is deliberately not an error here: an
    // npc or location may exist and hold nothing, so "the location `bucht`
    // exists" routinely means "a scene mentioned it and nobody has written it
    // yet" — exactly what this run should fill. The accept is what decides
    // whether a write collides.
    seen.add(id);
    return { id, name: stringField(item, "name") ?? id, summary: stringField(item, "summary") ?? "" };
  };
  const npcs: OutlineNpc[] = [];
  rawNpcs.forEach((item, index) => {
    const npc = readNew(item, `npcs[${index}]`);
    if (npc !== null) npcs.push(npc);
  });
  const locations: OutlineLocation[] = [];
  rawLocations.forEach((item, index) => {
    const location = readNew(item, `locations[${index}]`);
    if (location !== null) locations.push(location);
  });

  const outlineLocationIds = new Set(locations.map((location) => location.id));
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
    if (location !== undefined && !ctx.locationIds.has(location) && !outlineLocationIds.has(location)) {
      errors.push(
        `scene "${id}": location "${location}" does not exist in the campaign and ` +
          `"locations" of this outline does not propose it`,
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
  // Every new npc and every new location is a provider call of its own, so
  // the two lists share one bound.
  const proposals = npcs.length + locations.length;
  if (proposals > MAX_OUTLINE_PROPOSALS) {
    errors.push(
      `"npcs" und "locations": ${proposals} neue Figuren und Orte sind zu viele für einen ` +
        `Durchlauf — nenne zusammen höchstens ${MAX_OUTLINE_PROPOSALS}, die das Kapitel ` +
        "wirklich braucht",
    );
  }

  // Cross references LAST: they can only be checked once every scene id is
  // known, and an unknown ref is the one outline error that would otherwise
  // reach the DM as a dangling `[[id]]` in a finished scene.
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
  // A missing description is no correction turn: the chapter then starts
  // with an empty text, which the DM fills like any other.
  const chapterDescription = ctx.newChapter
    ? stringField(obj, "chapterDescription")?.trim()
    : undefined;
  return {
    ok: true,
    result: {
      scenes,
      npcs,
      locations,
      // The repair is recorded as a run warning, not swallowed.
      warnings: parsedReply.repaired ? [...warnings, REPAIRED_REPLY_WARNING] : warnings,
      ...(chapterDescription === undefined ? {} : { chapterDescription }),
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
 * The scene system prompt in exactly-one-scene-from-the-outline mode: the
 * scene prompt with its own output section swapped for the outline-bound one
 * (`scene-single-output.md`).
 *
 * A swap rather than a second prompt file, for the reason the augment run's
 * `formatContract` exists: the rules (orthography and quotation marks,
 * tables, the callout list, the reference rules) must be the SAME text in
 * both, and the one way to guarantee that is to keep them side by side.
 *
 * Both sections describe the RAW entry — the swap adds
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
 * about. A marker here would silently defeat the prompt caching: the block is
 * part of the CONSTANT half, so one changed character per part makes every
 * part a cache miss. Which scene is assigned is a line of its own in the
 * variable half (`assignmentBlock`, llm-provider ASSIGNMENT_HEADING).
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
  if (outline.npcs.length > 0) {
    lines.push("");
    lines.push("Neue Figuren dieses Durchlaufs (ids nutzbar wie bestehende):");
    for (const npc of outline.npcs) lines.push(`- ${npc.id} (${npc.name}) — ${npc.summary}`);
  }
  if (outline.locations.length > 0) {
    lines.push("");
    lines.push("Neue Orte dieses Durchlaufs (ids nutzbar wie bestehende):");
    for (const location of outline.locations) {
      lines.push(`- ${location.id} (${location.name}) — ${location.summary}`);
    }
  }
  return lines.join("\n");
}

/** Which scene of the outline THIS call writes (llm-provider ASSIGNMENT_HEADING). */
export function assignmentBlock(scene: OutlineScene): string {
  return `${scene.id} — ${scene.title}`;
}

// --- per-part validation -------------------------------------------------------

/** What a single-scene reply must look like: one entry plus warnings. */
export function validateSingleSceneReply(input: {
  raw: string;
  ctx: SceneContext;
  scene: OutlineScene;
  allowed: AllowedRefs;
}): { ok: true; result: { scene: GeneratedSceneDraft; warnings: string[] } } | { ok: false; errors: string[] } {
  // The reply is the schema-forced OBJECT: `properties`,
  // `body`, `warnings` (./entry-reply reads it and composes the entry
  // the server would store). Everything below judges that object.
  const read = parseEntryReply(input.raw, "scene");
  // Labelled like every other error of this part: the review shows the list
  // per part, and "which scene" is the first thing the DM looks for.
  if (!read.ok) return { ok: false, errors: read.errors.map((e) => `scene "${input.scene.id}": ${e}`) };
  const reply = read.reply;
  const errors: string[] = [];
  const draft = validateSceneEntry({
    reply,
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
 * The body rules every proposed npc and location of a run shares: known
 * callouts and `[[id]]` references that name something of the campaign or of
 * the outline (`allowed.refIds`), and the id the outline gave it.
 */
function proposalErrors(
  label: string,
  id: string,
  expectedId: string,
  body: string,
  allowed: AllowedRefs,
): string[] {
  if (id !== expectedId) {
    return [
      `${label}: die id muss "${expectedId}" bleiben — sie kommt aus der Gliederung und ` +
        "die Szenen dieses Durchlaufs verweisen darauf",
    ];
  }
  const errors: string[] = [];
  for (const callout of unknownCallouts(body)) errors.push(`${label}: unknown callout "[!${callout}]"`);
  for (const msg of unknownRefErrors(body, allowed.refIds)) errors.push(`${label}: ${msg}`);
  return errors;
}

/**
 * One npc the outline proposes, validated as a part of a scene run: read by
 * the npc's own reply schema (./npc-reply.ts), a kebab id, and the body rules
 * every generated text shares. What it does NOT take from the NPC RUN are
 * the rules that are about that run rather than about the npc: an NPC run
 * forbids a `chapter` (it has no target chapter) while a scene run's npc
 * legitimately belongs to the run's chapter, and its pinned-id rule is
 * replaced by the outline's id.
 */
export function validateNpcPartReply(
  raw: string,
  outlineNpc: OutlineNpc,
  allowed: AllowedRefs,
): { ok: true; result: { npc: NpcProposal; warnings: string[] } } | { ok: false; errors: string[] } {
  const label = `npc "${outlineNpc.id}"`;
  const read = parseNpcReply(raw);
  if (!read.ok) return { ok: false, errors: read.errors.map((e) => `${label}: ${e}`) };
  const errors: string[] = [];
  const npc = validateNpcProposal(read.reply, errors);
  if (npc === null || errors.length > 0) return { ok: false, errors };
  errors.push(...proposalErrors(label, npc.id, outlineNpc.id, npc.body, allowed));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, result: { npc, warnings: read.reply.warnings } };
}

/**
 * One location the outline proposes, validated as a part of a scene run:
 * read by the location's own reply schema (./location-reply.ts), a kebab id,
 * and the body rules every generated text shares.
 */
export function validateLocationPartReply(
  raw: string,
  outlineLocation: OutlineLocation,
  allowed: AllowedRefs,
):
  | { ok: true; result: { location: LocationProposal; warnings: string[] } }
  | { ok: false; errors: string[] } {
  const label = `location "${outlineLocation.id}"`;
  const read = parseLocationReply(raw);
  if (!read.ok) return { ok: false, errors: read.errors.map((e) => `${label}: ${e}`) };
  const errors: string[] = [];
  const location = validateLocationProposal(read.reply, errors);
  if (location === null || errors.length > 0) return { ok: false, errors };
  errors.push(...proposalErrors(label, location.id, outlineLocation.id, location.body, allowed));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, result: { location, warnings: read.reply.warnings } };
}

// --- the run ------------------------------------------------------------------

/** What one finished part contributes to the job's result. */
export interface PartOutcome {
  scene?: GeneratedSceneDraft;
  npc?: NpcProposal;
  location?: LocationProposal;
  warnings: string[];
  namingHints: NamingHint[];
  /** The excerpt could not be matched, so the part got the WHOLE source. */
  excerptFallback?: boolean;
}

/** Usage of one part — `calls` is what the review header sums into its call count. */
export interface PartUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

/**
 * How the job store follows a run. Every callback PERSISTS: a part that
 * finished has to be on the row before the next one starts, because "done
 * parts survive a restart" is only true of what was written down.
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
  /** True once the run was discarded or replaced. */
  cancelled(): boolean;
}

/** The part key the retry endpoint addresses. */
export function scenePartKey(id: string): string {
  return `scene:${id}`;
}

export function npcPartKey(id: string): string {
  return `npc:${id}`;
}

export function locationPartKey(id: string): string {
  return `location:${id}`;
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
    ...outline.npcs.map(
      (npc): GenerateJobPart => ({
        key: npcPartKey(npc.id),
        kind: "npc",
        id: npc.id,
        title: npc.name,
        status: "pending",
      }),
    ),
    ...outline.locations.map(
      (location): GenerateJobPart => ({
        key: locationPartKey(location.id),
        kind: "location",
        id: location.id,
        title: location.name,
        status: "pending",
      }),
    ),
  ];
}

/**
 * A part's usage, from a successful result or from a thrown ApiError, with the
 * CALL COUNT taken from the counter rather than from `usage.attempts`: a local
 * endpoint reports no usage at all, and the displayed call count must be
 * true anyway.
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

/** The message and the error list the DM reads next to the retry action. */
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
   * `npcContext` and `locationContext` need every scene's passage for every
   * npc and location they build, and the cut normalizes the WHOLE source text
   * per call — so an outline with ten scenes and ten npcs would otherwise
   * normalize it a hundred times.
   */
  excerpts: Map<string, { text: string; matched: boolean }>;
}

/**
 * The plan of a run: the campaign context plus the outline, and the id sets
 * its parts may reference (the campaign's plus the outline's own npcs,
 * locations and scenes: every id of the run comes from the outline, so the
 * validation checks against outline + context and nothing else).
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
      npcIds: new Set([...ctx.npcIds, ...outline.npcs.map((npc) => npc.id)]),
      locationIds: new Set([
        ...ctx.locationIds,
        ...outline.locations.map((location) => location.id),
      ]),
      refIds: new Set([
        ...campaignRefIds(ctx),
        ...outline.npcs.map((npc) => npc.id),
        ...outline.locations.map((location) => location.id),
        ...outline.scenes.map((scene) => scene.id),
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
      // Only the outline hears that the chapter is new: it is the one call
      // that describes the chapter.
      context: {
        chapter: ctx.chapter,
        ...(ctx.newChapter ? { newChapter: true } : {}),
        npcs: ctx.npcs,
        locations: ctx.locations,
      },
      sourceText,
      // The one call of a run that still answers JSON — so it is the one
      // call whose shape the API can GUARANTEE: Claude gets a
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
      // Forced like the outline: the reply is the scene object.
      jsonSchema: entryReplySchema("scene", "create"),
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
        // pipeline can produce silently.
        ...(cut.matched
          ? []
          : [
              `Der Quelltext-Ausschnitt für „${scene.title}“ ließ sich nicht wörtlich ` +
                "zuordnen — diese Szene wurde aus dem ganzen Quelltext geschrieben.",
            ]),
      ],
      namingHints: checkDraftsNaming([result.scene], plan.ctx.namingRules),
      ...(cut.matched ? {} : { excerptFallback: true }),
    },
    usage: usageOf(result.usage, counter.count()),
  };
}

/** Step 3: one proposed npc, with the scenes that mention it as context. */
export async function runNpcPart(
  plan: RunPlan,
  outlineNpc: OutlineNpc,
  provider: LLMProvider,
  counter: CallCounter = callCounter(),
): Promise<{ outcome: PartOutcome; usage: PartUsage }> {
  const assets = await loadPromptAssets("npc");
  const result = await runPipeline<{ npc: NpcProposal; warnings: string[]; usage?: GenerateUsage }>({
    req: {
      systemPrompt: assets.systemPrompt,
      fewShotTarget: assets.fewShotTarget,
      knowledge: plan.ctx.knowledge,
      glossary: plan.ctx.glossary,
      context: { npcs: plan.ctx.npcs, locations: plan.ctx.locations, targetId: outlineNpc.id },
      outline: outlineBlock(plan.outline),
      // What this ONE call is about: the npc, and the passages of the scenes
      // that mention it — rather than no context of its own at all.
      sourceText: npcContext(plan, outlineNpc),
      jsonSchema: npcReplyRequest("create"),
    },
    provider,
    validate: (raw) => validateNpcPartReply(raw, outlineNpc, plan.allowed),
    correctionTail: "den vollständigen NPC enthalten",
    onCall: counter.onCall,
  });
  const { body, ...fields } = result.npc;
  return {
    outcome: {
      npc: result.npc,
      warnings: result.warnings,
      namingHints: checkDraftsNaming([{ npc: result.npc.id, fields, body }], plan.ctx.namingRules),
    },
    usage: usageOf(result.usage, counter.count()),
  };
}

/** Step 3: one proposed location, with the scenes set there as context. */
export async function runLocationPart(
  plan: RunPlan,
  outlineLocation: OutlineLocation,
  provider: LLMProvider,
  counter: CallCounter = callCounter(),
): Promise<{ outcome: PartOutcome; usage: PartUsage }> {
  const assets = await loadPromptAssets("location");
  const result = await runPipeline<{
    location: LocationProposal;
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
        targetId: outlineLocation.id,
      },
      outline: outlineBlock(plan.outline),
      sourceText: locationContext(plan, outlineLocation),
      jsonSchema: locationReplyRequest("create"),
    },
    provider,
    validate: (raw) => validateLocationPartReply(raw, outlineLocation, plan.allowed),
    correctionTail: "den vollständigen Ort enthalten",
    onCall: counter.onCall,
  });
  const { body, ...fields } = result.location;
  return {
    outcome: {
      location: result.location,
      warnings: result.warnings,
      namingHints: checkDraftsNaming(
        [{ location: result.location.id, fields, body }],
        plan.ctx.namingRules,
      ),
    },
    usage: usageOf(result.usage, counter.count()),
  };
}

/**
 * The source material of an npc call: the one-liner from the outline plus the
 * source passages of every scene that mentions the npc — by its name or its
 * id. The outline does not list npcs per scene, and a text search over the
 * passages is both cheap and honest.
 */
export function npcContext(plan: RunPlan, outlineNpc: OutlineNpc): string {
  const needle = outlineNpc.name.toLowerCase();
  // The id is kebab-case ENGLISH while the name is German ("harbour-master" /
  // "Hafenmeisterin"), so the whole id rarely appears in an English source
  // text but its WORDS do. Each word is required, in any order — matching on
  // one word alone would pull "old" or "the" into every npc's context.
  const idWords = outlineNpc.id.split("-").filter((word) => word.length > 2);
  return contextOf(plan, outlineNpc, (_scene, passage) => {
    const lower = passage.toLowerCase();
    return (
      lower.includes(needle) ||
      passage.includes(outlineNpc.id) ||
      (idWords.length > 0 && idWords.every((word) => lower.includes(word)))
    );
  });
}

/**
 * The source material of a location call: the one-liner from the outline
 * plus the source passages of every scene whose `location` it is.
 */
export function locationContext(plan: RunPlan, outlineLocation: OutlineLocation): string {
  return contextOf(plan, outlineLocation, (scene) => scene.location === outlineLocation.id);
}

/**
 * The one-liner plus the passage of every scene `mentions` picks. Nothing
 * matched: the whole source text is the honest fallback — the same rule the
 * excerpt cut follows.
 */
function contextOf(
  plan: RunPlan,
  item: { id: string; name: string; summary: string },
  mentions: (scene: OutlineScene, passage: string) => boolean,
): string {
  const blocks: string[] = [`${item.name} (${item.id}): ${item.summary}`];
  for (const scene of plan.outline.scenes) {
    const passage = excerptOf(plan, scene).text;
    if (!mentions(scene, passage)) continue;
    blocks.push(`### Szene „${scene.title}“ (${scene.id})\n\n${passage}`);
  }
  if (blocks.length === 1) blocks.push(plan.sourceText);
  return blocks.join("\n\n");
}

/** This scene's source passage — cut once per run (RunPlan.excerpts). */
function excerptOf(plan: RunPlan, scene: OutlineScene): { text: string; matched: boolean } {
  return plan.excerpts.get(scene.id) ?? cutExcerpt(plan.sourceText, scene.sourceExcerpt);
}

/**
 * Run one part and report it into the sink. The ONE place a part's outcome
 * becomes job state, so a fresh run and a per-part retry cannot drift.
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
        : part.kind === "npc"
          ? await runNpcPart(plan, npcOf(plan.outline, part.id), provider, counter)
          : await runLocationPart(plan, locationOf(plan.outline, part.id), provider, counter);
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

export function npcOf(outline: RunOutline, id: string): OutlineNpc {
  const npc = outline.npcs.find((n) => n.id === id);
  if (npc === undefined) throw new ApiError(404, `unknown outline npc: ${id}`);
  return npc;
}

export function locationOf(outline: RunOutline, id: string): OutlineLocation {
  const location = outline.locations.find((l) => l.id === id);
  if (location === undefined) throw new ApiError(404, `unknown outline location: ${id}`);
  return location;
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
      // never take the queue — or its siblings — down.
      await runPart(plan, next, provider, sink);
    }
  });
  await Promise.all(workers);
}

/**
 * The whole scene run: outline, then every part. Writes NOTHING — the drafts
 * land in the job and only the apply step touches the store.
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
