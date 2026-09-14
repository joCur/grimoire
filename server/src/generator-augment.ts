// „Mit KI ergänzen" (issue #36): the generator pipeline pointed at an entry
// that ALREADY EXISTS — an NPC, a location or a scene.
//
// It is deliberately the SAME pipeline as the two create runs
// (./generator.ts): same provider factory, same correction turns, same
// truncation fail-fast, same usage accounting, same background job, same
// naming check. Only three things differ, and they are the whole module:
//
//   1. the prompt carries the existing entry COMPLETE (properties + body)
//      plus the DM's instruction, under the augmentation rule of
//      generator/augment-system-prompt.md ("ergänze; Vorhandenes nur ändern,
//      wenn Quellmaterial/Anweisung es verlangt"),
//   2. the reply is turned into a PROPOSAL rather than into a draft file:
//      properties per field with the current value next to it, and the
//      proposed body whole,
//   3. accepting writes into the existing row with a `rev` guard, in ONE
//      transaction (store/write.ts `writePropertiesAndBody`) — it never
//      creates the entry, it only fills it.
//
// WHY THE PROPOSAL CARRIES WHOLE BODIES and not a block list: the block model
// is the Block-Composer's (app/src/lib/blocks.ts), and the review's decision
// unit has to be the unit the DM already edits. Cutting the diff in the app
// against that very model is the only way those two can never drift; the
// server stays the authority for what is WRITTEN, not for how it is shown.
// The app therefore sends back the body it assembled from the accepted
// blocks, and the server writes it like any other body write — same rev
// guard, same FTS, same reference rows, same #70 „referencing creates" rule.

import {
  CALLOUT_KINDS,
  SCENE_STATUSES,
  SCENE_TYPES,
  isAugmentKind,
  type AugmentKind,
  type AugmentPropertyProposal,
  type AugmentResult,
  type FileResponse,
} from "@grimoire/shared";
import { ApiError } from "./campaign-fs";
import {
  ASSET_FILES,
  collectContext,
  extractJsonReply,
  isRawEntry,
  loadAsset,
  npcStatusErrors,
  obtainProvider,
  parseWithProperties,
  quickstatsErrors,
  runPipeline,
  unknownCallouts,
  withNamingHints,
  type CampaignContext,
  type RawEntry,
} from "./generator";
import type { LLMProvider } from "./llm-provider";
import { readParsedFile } from "./store/read";
import { writePropertiesAndBody } from "./store/write";

/** The correction turn's tail — what a corrected reply must still contain. */
const AUGMENT_CORRECTION_TAIL = "den vollständigen ergänzten Eintrag enthalten";

/**
 * Properties keys a proposal may never touch. `id` is the primary key (and
 * the reference key of the whole campaign) — changing it is `POST /rename`'s
 * job, with its cascade; a model that „improves" it here would orphan every
 * reference to the entry. The others are APP-MANAGED bookkeeping that the
 * DM's own properties form does not offer either.
 */
const FROZEN_KEYS = new Set(["id", "scenes_played", "reviewed", "pauses"]);

// --- target -------------------------------------------------------------------

/**
 * The cheap request checks of an augment target, without touching the LLM:
 * an unsafe address or an unknown entry answer through `readParsedFile`
 * (400/404), a kind that has no augment prompt answers 400.
 *
 * Exported for the same reason `assertGenerateTarget` is: POST
 * …/generate/augment runs it BEFORE it creates a background job — a request
 * error must not become a failed job the DM has to go and read.
 */
export async function readAugmentTarget(
  campaign: string,
  rel: string,
): Promise<{ kind: AugmentKind; file: FileResponse }> {
  const file = await readParsedFile(campaign, rel); // 400 unsafe, 404 unknown
  if (!isAugmentKind(file.kind)) {
    throw new ApiError(400, `"${file.kind}" cannot be augmented — npc, location or scene only`);
  }
  return { kind: file.kind, file };
}

// --- prompt --------------------------------------------------------------------

/** The heading every create prompt describes the TARGET FILE under. */
const FORMAT_HEADING = "## Ziel-Format der Datei";

/**
 * The FILE-FORMAT half of a create prompt: its title line plus the
 * „## Ziel-Format der Datei" section, and nothing else.
 *
 * Why the slice: a create prompt also carries its own „## Ausgabeformat" —
 * `scenes`/`npc_stubs` for a scene run, `npc` for an NPC run — and its
 * „## Regeln" speak of stubs the augment run can never produce. Embedding
 * the whole document put TWO contradictory output schemas in front of the
 * model, and „this prompt wins" is a sentence, not a guarantee. The augment
 * run brings its own output schema and its own rules; all it needs from the
 * create prompt is what the target file looks like.
 *
 * Degrades: a document without the heading travels whole rather than empty —
 * a missing section must not silently strip the format contract.
 */
export function formatContract(doc: string): string {
  const start = doc.indexOf(FORMAT_HEADING);
  if (start === -1) return doc;
  const rest = doc.slice(start + FORMAT_HEADING.length);
  const next = rest.indexOf("\n## ");
  const section = next === -1 ? rest : rest.slice(0, next);
  const title = doc.startsWith("# ") ? `${doc.slice(0, doc.indexOf("\n"))}\n\n` : "";
  return `${title}${FORMAT_HEADING}${section.trimEnd()}\n`;
}

/**
 * The augment system prompt of one kind: the shared augmentation rule
 * (augment-system-prompt.md, which ends on the heading „## Format der
 * Ziel-Datei") followed by that kind's own FILE format contract — the format
 * is still described exactly ONCE, but only the half that is about the file.
 */
export async function augmentSystemPrompt(kind: AugmentKind): Promise<string> {
  const [rule, format] = await Promise.all([
    loadAsset(ASSET_FILES.augment.systemPrompt),
    loadAsset(ASSET_FILES[kind].systemPrompt),
  ]);
  return `${rule.trimEnd()}\n\n${formatContract(format)}`;
}

/** The few-shot target of a kind — its example document. */
export function augmentFewShotFile(kind: AugmentKind): string {
  return ASSET_FILES[kind].fewShotTarget;
}

// --- validation ------------------------------------------------------------------

interface RawAugmentReply {
  entry: RawEntry;
  warnings: string[];
}

function parseRawAugmentReply(raw: string, errors: string[]): RawAugmentReply | null {
  const extracted = extractJsonReply(raw);
  if (extracted === null) {
    errors.push("reply is not valid JSON");
    return null;
  }
  const parsed = extracted.value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push("reply must be a JSON object");
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (!isRawEntry(obj.entry)) {
    errors.push('"entry" must be an object with string "path" and "content"');
    return null;
  }
  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];
  return { entry: obj.entry, warnings };
}

/**
 * The kind's own mechanical rules, as far as they apply to an entry that
 * already exists. Deliberately NARROWER than the create runs':
 *
 *   * a scene's `status` is whatever the DM made it (`ready`, `played`, …) —
 *     forcing `draft` would reset the pool state of a prepared scene,
 *   * `npcs`/`location` pointing at something unknown is NOT an error: on an
 *     existing entry the #70 rule applies (referencing creates the empty
 *     entry) and the write path does exactly that, so failing here would be
 *     stricter than the properties dialog sitting next to the button,
 *   * `## Beziehungen` targets are not checked, for the same reason.
 *
 * What IS checked is what would make the entry unreadable or would break the
 * data contract: parseable properties, an unchanged id, only known callouts,
 * a legal status per kind, quoted quickstats.
 */
function kindErrors(
  kind: AugmentKind,
  fm: Record<string, unknown>,
  current: Record<string, unknown>,
  label: string,
  errors: string[],
): void {
  if (kind === "npc") {
    for (const msg of npcStatusErrors(fm, "NPC-Dateien")) errors.push(`${label}: ${msg}`);
    // Only a quickstats the proposal CHANGES is checked. The rule ("+2" as a
    // quoted string, or YAML eats the plus) is about what a MODEL writes; a
    // campaign that carries bare numbers from its own history — the example
    // campaign does — must not make every augment run fail on a value the DM
    // authored and this run does not touch.
    if (!sameValue(current.quickstats, fm.quickstats)) {
      for (const msg of quickstatsErrors(fm)) errors.push(`${label}: ${msg}`);
    }
    return;
  }
  if (kind === "location") {
    if (Object.hasOwn(fm, "status")) {
      errors.push(`${label}: "status" ist nicht erlaubt — locations haben keinen status`);
    }
    return;
  }
  if (fm.type !== undefined && !(SCENE_TYPES as readonly string[]).includes(String(fm.type))) {
    errors.push(`${label}: "type" muss einer von ${SCENE_TYPES.join(", ")} sein`);
  }
  if (
    fm.status !== undefined &&
    !(SCENE_STATUSES as readonly string[]).includes(String(fm.status))
  ) {
    errors.push(
      `${label}: "status" muss einer von ${SCENE_STATUSES.join(", ")} sein — ` +
        "der bestehende Status bleibt, wenn das Quellmaterial nichts anderes sagt",
    );
  }
}

/**
 * Mechanical validation of one raw augment reply against the entry it is
 * about. Returns the PROPOSAL, or the error list for the correction turn.
 */
export function validateAugmentReply(
  raw: string,
  target: { kind: AugmentKind; file: FileResponse },
): { ok: true; result: AugmentResult } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const reply = parseRawAugmentReply(raw, errors);
  if (reply === null) return { ok: false, errors };

  const { kind, file } = target;
  const entry = reply.entry;
  const label = `entry "${entry.path}"`;
  if (entry.path !== file.path) {
    return {
      ok: false,
      errors: [
        `${label}: path muss unverändert "${file.path}" sein — der Eintrag existiert schon`,
      ],
    };
  }
  const { parsed, error } = parseWithProperties(entry.content, file.path);
  if (error !== undefined) return { ok: false, errors: [`${label}: ${error}`] };
  const fm = parsed.properties;

  const currentId = file.properties.id;
  if (currentId !== undefined && fm.id !== currentId) {
    errors.push(
      `${label}: die id bleibt "${String(currentId)}" — sie ist der Referenzschlüssel ` +
        "der Kampagne und wird beim Ergänzen nie geändert",
    );
  }
  for (const callout of unknownCallouts(parsed.body)) {
    errors.push(
      `${label}: unknown callout "[!${callout}]" — allowed: ` +
        CALLOUT_KINDS.map((k) => `[!${k}]`).join(", "),
    );
  }
  kindErrors(kind, fm, file.properties, label, errors);
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    result: {
      path: file.path,
      kind,
      rev: file.rev,
      properties: propertyProposals(file.properties, fm),
      currentBody: file.body,
      proposedBody: parsed.body,
      warnings: reply.warnings,
    },
  };
}

// --- the properties proposal --------------------------------------------------

/**
 * „The entry has no value here" — what makes a proposed field a `new` one
 * (and therefore preselected in the review). Absent, null, a blank string and
 * an empty list/mapping all count; `false` and `0` do NOT — those are values
 * the DM chose.
 */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/** Structural equality over the JSON-shaped values a properties can hold. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => sameValue(left[key], right[key]));
}

/**
 * What the model wants to do to the properties, field by field (issue #36
 * AK2). Only what CHANGES is listed: a key the proposal repeats verbatim is
 * not a decision the DM has to make.
 *
 * A key the proposal DROPS is not listed either — „nichts löschen" is the
 * augmentation rule, and a model that simply forgot a key must not turn into
 * a deletion the DM has to notice and undo.
 */
export function propertyProposals(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
): AugmentPropertyProposal[] {
  const out: AugmentPropertyProposal[] = [];
  for (const [key, value] of Object.entries(proposed)) {
    if (FROZEN_KEYS.has(key)) continue;
    const before = current[key];
    if (sameValue(before, value)) continue;
    out.push({
      key,
      ...(Object.hasOwn(current, key) ? { current: before } : {}),
      proposed: value,
      state: isEmptyValue(before) ? "new" : "changed",
    });
  }
  return out;
}

// --- the run -----------------------------------------------------------------

/**
 * Run the augment pipeline: context -> augment prompt -> provider ->
 * mechanical validation, with the same correction turns, truncation
 * fail-fast and usage accounting as every other run. Writes NOTHING.
 *
 * At least one of `sourceText`/`instruction` is required — the route checks
 * that before a job exists, and this asserts it again because the pipeline
 * must never depend on a caller having done it.
 */
export async function runAugment(
  campaign: string,
  rel: string,
  input: { sourceText?: string; instruction?: string },
  getProvider: () => LLMProvider = obtainProvider,
): Promise<AugmentResult> {
  const sourceText = (input.sourceText ?? "").trim();
  const instruction = (input.instruction ?? "").trim();
  if (sourceText === "" && instruction === "") {
    throw new ApiError(400, "sourceText or instruction is required");
  }
  const target = await readAugmentTarget(campaign, rel);
  const ctx: CampaignContext = await collectContext(campaign);
  const [systemPrompt, fewShotTarget] = await Promise.all([
    augmentSystemPrompt(target.kind),
    loadAsset(augmentFewShotFile(target.kind)),
  ]);
  const result = await runPipeline({
    req: {
      systemPrompt,
      fewShotTarget,
      knowledge: ctx.knowledge,
      glossary: ctx.glossary,
      context: {
        npcs: ctx.npcs,
        locations: ctx.locations,
        // A scene's chapter is part of its address, so it belongs in the
        // context exactly as it does for a scene run.
        ...(target.kind === "scene" ? { chapter: chapterOf(target.file) } : {}),
      },
      sourceText,
      existingEntry: { path: target.file.path, markdown: target.file.raw },
      ...(instruction === "" ? {} : { instruction }),
    },
    provider: getProvider(),
    validate: (raw) => validateAugmentReply(raw, target),
    correctionTail: AUGMENT_CORRECTION_TAIL,
  });
  // The naming check runs on the PROPOSAL (issue #53 AK3), as hints — never
  // a reason to fail a run. It reads the proposed document, because that is
  // the text the DM is about to accept.
  return withNamingHints(
    result,
    [{ path: result.path, markdown: proposedDocument(result) }],
    ctx.namingRules,
  );
}

/** The chapter segment of a scene address (`<chapter>/…`). */
function chapterOf(file: FileResponse): string {
  return file.path.split("/")[0] ?? "";
}

/** The proposed body under the proposed properties — what the check reads. */
function proposedDocument(result: AugmentResult): string {
  const lines = result.properties.map((p) => `${p.key}: ${String(p.proposed)}`);
  return `---\n${lines.join("\n")}\n---\n${result.proposedBody}`;
}

// --- accepting ---------------------------------------------------------------

/**
 * POST /api/:campaign/generate/augment/apply — write the DM's decisions.
 *
 * The client sends the accepted properties fields and the body it assembled
 * out of the accepted blocks; the server does not re-derive either (the
 * decisions ARE the payload) but it does everything a normal write does,
 * because it IS one: rev guard (409 `rev_conflict`), FTS, `[[slug]]`
 * reference rows, the #70 rule, and the job discarded in the SAME
 * transaction.
 */
export async function applyAugment(
  campaign: string,
  body: { path?: unknown; rev?: unknown; properties?: unknown; body?: unknown },
  jobId?: string,
): Promise<FileResponse> {
  const rel = body.path;
  if (typeof rel !== "string" || rel === "") throw new ApiError(400, "path must be a string");
  const rev = body.rev;
  if (typeof rev !== "number" || !Number.isFinite(rev)) {
    throw new ApiError(400, "rev must be a number");
  }
  const patch = body.properties;
  if (
    patch !== undefined &&
    (patch === null || typeof patch !== "object" || Array.isArray(patch))
  ) {
    throw new ApiError(400, "properties must be an object");
  }
  const markdown = body.body;
  if (markdown !== undefined && typeof markdown !== "string") {
    throw new ApiError(400, "body must be a string");
  }
  const fields = { ...((patch as Record<string, unknown> | undefined) ?? {}) };
  for (const key of Object.keys(fields)) {
    if (FROZEN_KEYS.has(key)) throw new ApiError(400, `"${key}" cannot be augmented`);
  }
  if (Object.keys(fields).length === 0 && markdown === undefined) {
    throw new ApiError(400, "nothing to apply");
  }
  // The kind gate again — apply is a separate request and must never trust
  // the client to have come through the dialog.
  await readAugmentTarget(campaign, rel);
  return writePropertiesAndBody(campaign, rel, rev, fields, markdown, jobId);
}
