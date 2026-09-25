// A SCENE — its one zod schema and the forms derived from it (ADR #31).
//
// `sceneSchema` is the scene as `GET /api/campaigns/:c/scenes/:id` answers
// it. The TypeScript type, the PATCH the resource accepts, the scene a
// fixture holds and a generator run proposes, and the generator's reply are
// each derived from it below with zod's own API, so a new field of a scene is
// one line in the schema and one in its form fields.
//
// A scene lies flat under its campaign: its id is unique per campaign, and
// its chapter is a field that may change. Where it stands among the scenes of
// its chapter is not a field of the scene — the chapter's scene order says
// that (ADR #27).

import { z } from "zod";

/** A scene's lifecycle states. A CHECK constraint holds the column to them (ADR #25). */
export const SCENE_STATUSES = ["draft", "ready", "played", "dropped"] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

/** A scene's two kinds, CHECKed like the status. */
export const SCENE_TYPES = ["planned", "contingency"] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

/**
 * A scene, exactly as `GET /api/campaigns/:c/scenes/:id` answers it: `id` its
 * stable key, `title` the display name (the id stands in for a scene that has
 * none), `type` planned or a contingency, `trigger` when a contingency fires,
 * `chapter` the chapter it belongs to (always one), `location` the location
 * it plays at, `npcs` the npcs it names in their order, `handouts` the Roll20
 * handouts it refers to (never copies), `tags` free words, `status` where it
 * stands in the campaign, `body` its markdown, and `rev` the row version a
 * PATCH sends back as its guard. The three lists are always there, empty when
 * the scene names nothing.
 */
export const sceneSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  type: z.enum(SCENE_TYPES),
  trigger: z.string().optional(),
  chapter: z.string(),
  location: z.string().optional(),
  npcs: z.array(z.string()),
  handouts: z.array(z.string()),
  tags: z.array(z.string()),
  status: z.enum(SCENE_STATUSES),
  body: z.string(),
  rev: z.number(),
});

export type Scene = z.infer<typeof sceneSchema>;

/**
 * A scene without its guard: what a fixture holds
 * (`fixtures/<campaign>/scenes/<id>.json`), what a generator run proposes and
 * what accepting that proposal writes.
 */
export const sceneProposalSchema = sceneSchema.omit({ rev: true });

export type SceneProposal = z.infer<typeof sceneProposalSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/scenes/:id`: the guard, the optional
 * `force`, and any subset of the fields — `body` is one of them, and `null`
 * clears an optional one. The chapter can change but never be cleared, and
 * the id may be echoed, never changed. Strict like the schema it comes from:
 * a key that is none of these is a 400 naming it.
 */
export const scenePatchSchema = sceneProposalSchema
  .extend({
    trigger: z.string().nullable(),
    location: z.string().nullable(),
  })
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional() });

export type ScenePatch = z.infer<typeof scenePatchSchema>;

/** The fields of one scene write, guard and `force` aside — what an editing surface builds. */
export const sceneChangeSchema = scenePatchSchema.omit({ rev: true, force: true });

export type SceneChange = z.infer<typeof sceneChangeSchema>;

/**
 * The body of `POST /api/campaigns/:c/scenes`: the typed title, the chapter
 * the scene belongs to, and the id the DM set (absent: derived from the
 * title).
 */
export const sceneCreateSchema = z.strictObject({
  title: z.string(),
  chapter: z.string(),
  id: z.string().optional(),
});

export type SceneCreate = z.infer<typeof sceneCreateSchema>;

/**
 * The reply of a scene AUGMENT call, in the strict form a provider enforces:
 * the proposed scene with every optional field nullable instead — the model
 * says „not given" with `null` — and the model's `warnings` for the DM
 * beside the fields. An existing scene keeps whatever status the DM gave it,
 * so the reply offers all four.
 */
export const sceneReplySchema = sceneProposalSchema.extend({
  trigger: z.string().nullable(),
  location: z.string().nullable(),
  warnings: z.array(z.string()),
});

export type SceneReplyObject = z.infer<typeof sceneReplySchema>;

/** The scene in its reply form, `warnings` aside — how an augment prompt shows it. */
export type SceneReplyFields = Omit<SceneReplyObject, "warnings">;

/**
 * The reply of a call that writes a NEW scene: the same reply, with the
 * status narrowed to `draft` — a generated scene is always a draft until the
 * DM says otherwise.
 */
export const newSceneReplySchema = sceneReplySchema.extend({
  status: z.enum(["draft"]),
});

/**
 * A scene reply as the proposal it stands for, the one conversion every run
 * uses: the scene without its guard — an optional field the model answered
 * with `null` is absent, never `null` — and the model's `warnings` apart from
 * it.
 */
export function sceneFromReply(reply: SceneReplyObject): {
  scene: SceneProposal;
  warnings: string[];
} {
  const { trigger, location, warnings, ...fields } = reply;
  return {
    scene: {
      ...fields,
      ...(trigger === null ? {} : { trigger }),
      ...(location === null ? {} : { location }),
    },
    warnings,
  };
}

/**
 * A scene in the reply form, `warnings` aside — the reverse of
 * `sceneFromReply`: an absent optional field is `null`. An augment prompt
 * shows the scene this way, so the model reads it in the very shape it has to
 * answer in.
 */
export function sceneToReply(scene: SceneProposal): SceneReplyFields {
  return {
    id: scene.id,
    title: scene.title,
    type: scene.type,
    trigger: scene.trigger ?? null,
    chapter: scene.chapter,
    location: scene.location ?? null,
    npcs: scene.npcs,
    handouts: scene.handouts,
    tags: scene.tags,
    status: scene.status,
    body: scene.body,
  };
}

/**
 * A change applied to a scene proposal: a named field replaces the value,
 * `null` clears an optional one, and a field the change leaves out keeps the
 * proposal's value. What a review edit does to a proposed scene before it is
 * written.
 */
export function withSceneChange(scene: SceneProposal, change: SceneChange): Record<string, unknown> {
  const next: Record<string, unknown> = { ...scene };
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}
