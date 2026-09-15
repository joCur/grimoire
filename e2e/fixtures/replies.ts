// The canned LLM replies the stub endpoint serves (e2e/fixtures/stub-llm.ts).
//
// These are FIXTURES, meant to be read and adjusted: they are exactly what a
// well-behaved model would answer for the scene run and the NPC run, and they
// are written to pass the CURRENT mechanical validation of
// server/src/generator.ts:
//
//   scenes         no path at all (issue #100 — the server builds the
//                  address from the run's chapter and the frontmatter `id`),
//                  parseable properties, a kebab `id` used only once,
//                  type planned|contingency, status draft, only known
//                  callouts, npc/location references either existing in the
//                  campaign or shipped as an entry in the same reply, and a
//                  `location` that is an id (it IS the scene's group)
//   entries        one array for both kinds, `kind: "npc" | "location"` plus
//                  the `id` in the entry's frontmatter. An npc entry carries
//                  a status (alive unless the source says otherwise), a
//                  location entry carries none (issue #27)
//   npc run        one document, no path, kebab `id` in the properties, no
//                  `chapter`, quickstats values QUOTED ("+2" — YAML would eat
//                  the plus otherwise), `## Weiß` only [!secret],
//                  `## Beziehungen` only npc ids that exist, `## Notizen`
//                  empty
//
// When a validation rule changes, THIS file is the place to follow along —
// the specs assert on the titles/ids defined here.
//
// The prose uses `[[slug]]` ENTITY REFERENCES (issue #68), because that is
// what the prompt asks a well-behaved model for: `[[fenn]]` (exists in the
// campaign), `[[grella]]` (shipped as a stub in the same reply, so it stays
// literal text until the stub is applied) and `[[smuggler-captured]]` (a
// scene — the third referenceable kind).

/** Trigger tokens a test puts into the source text to steer the stub. */
export const TRIGGER = {
  /** The stub answers with a reply that FAILS the mechanical validation. */
  invalid: "E2E_INVALID",
  /** The stub answers `finish_reason: "length"` (a cut-off reply). */
  truncated: "E2E_TRUNCATED",
  /**
   * The stub HOLDS the reply (see SLOW_REPLY_MS) instead of answering — the
   * only way a spec can look at a job while it is genuinely `running`, which
   * is what the restart case of issue #23 needs.
   */
  slow: "E2E_SLOW",
  /**
   * The stub answers with a draft that IGNORES the campaign's naming
   * convention — it writes `OLD_NAME` where the rule says otherwise (issue
   * #53 AK3). A badly-behaved model, on demand: without it the post-run check
   * can only be shown to find nothing.
   */
  oldName: "E2E_OLD_NAME",
  /**
   * Issue #102: the run is decomposed into THREE scenes instead of one, so a
   * spec can watch parts finish, fail and be retried one by one. The outline
   * then proposes no new entries — the entry calls have their own coverage in
   * the default (one-scene) run.
   */
  threeScenes: "E2E_THREE_SCENES",
  /**
   * The SECOND of those three scenes fails its first call and succeeds on
   * every call after it — which is what „Erneut versuchen“ has to fix. The
   * token is written as `E2E_PART_FAIL:<nonce>` and the nonce keys the stub's
   * counter, so the one stub endpoint can serve several workers at once
   * without their retries interfering.
   */
  partFail: "E2E_PART_FAIL",
  /**
   * The LAST scene's reply is held (SLOW_REPLY_MS) while the others answer
   * normally — the shape a restart mid-run needs: finished parts to keep and
   * one in flight to fail.
   */
  // Deliberately NOT "E2E_SLOW…": TRIGGER.slow is matched as a substring, so
  // a name starting with it would hold every call of the run — the outline
  // included — and no part would ever finish.
  slowPart: "E2E_HOLD_LAST",
  /**
   * Every scene part answers LATE (LATE_REPLY_MS) while the outline answers
   * at once — the only shape in which the browser sees a run that is
   * `running` with NOTHING to review yet, and therefore the only one that
   * exercises the switch from the spinner to the review on a POLLED update
   * (issue #102 review). Without it the parts are finished before the first
   * `GET …/generate/job` answers, and the review is simply the first thing
   * ever rendered.
   */
  latePart: "E2E_LATE_PARTS",
  // A part that FAILS answers at once even so — with `E2E_PART_FAIL` the run
  // therefore reaches the state in which its only reviewable part is a failed
  // one.
} as const;

/** The nonce of a `E2E_PART_FAIL:<nonce>` token, or "" when there is none. */
export function partFailNonce(source: string): string {
  return new RegExp(`${TRIGGER.partFail}:([A-Za-z0-9_-]+)`).exec(source)?.[1] ?? "";
}

/**
 * The spelling `TRIGGER.oldName` puts into the draft. The spec writes a
 * naming convention „<OLD_NAME> → …" on the settings page and then expects
 * the review to flag exactly this word.
 */
export const OLD_NAME = "Saltmarsh";

/** How long a TRIGGER.slow request is held before it would answer. */
export const SLOW_REPLY_MS = 60_000;

/**
 * How long a `TRIGGER.latePart` reply waits before it answers NORMALLY —
 * longer than the app's first job poll, shorter than a test's patience.
 */
export const LATE_REPLY_MS = 5_000;

// --- scene run ---------------------------------------------------------------

/** Title of the generated scene draft — asserted in the specs. */
export const SCENE_TITLE = "Nachtwache am Kai";
/**
 * The draft's `id` — the ONE thing the model decides about addressing since
 * issue #100. The review addresses the draft as `<chapter>/<id>`; the address
 * it is WRITTEN to is `<chapter>/<location>/<id>`, because a scene's group is
 * its location (server/src/generator.ts, draftAddress).
 */
export const SCENE_ID = "night-watch-quay";
/** The npc stub the scene reply ships (does not exist in examples/beispiel). */
export const NPC_STUB_ID = "grella";
export const NPC_STUB_NAME = "Grella";
/** The location stub the scene reply ships. */
export const LOCATION_STUB_ID = "bucht";
export const LOCATION_STUB_NAME = "Nordbucht";

/**
 * How the stub reports back WHAT CONTEXT it was sent (issue #53 AK2). The
 * echo rides along as a `warning`, because that is the one field of the reply
 * the review shows verbatim — so a spec can assert on the prompt's knowledge
 * block through the BROWSER instead of reaching into the server.
 *
 * Only emitted when the campaign actually has knowledge, so every other spec
 * sees exactly the warnings it saw before.
 */
export const CONTEXT_ECHO = "Kontext-Echo:";

export function contextEchoWarnings(knowledge: string): string[] {
  const trimmed = knowledge.trim();
  return trimmed === "" ? [] : [`${CONTEXT_ECHO} ${trimmed.replace(/\n/g, " | ")}`];
}

function sceneDraft(chapter: string, oldName = false): string {
  if (oldName) {
    return `---
id: ${SCENE_ID}
title: Nachtwache in ${OLD_NAME}
type: planned
chapter: ${chapter}
handouts: []
tags: [stealth]
status: draft
---

## Flow

Die Gruppe beobachtet den Kai von ${OLD_NAME}, während die Flut fällt.

> [!readaloud] Über den Dächern von ${OLD_NAME} hängt der Nebel.
`;
  }
  return `---
id: ${SCENE_ID}
title: ${SCENE_TITLE}
type: planned
chapter: ${chapter}
location: ${LOCATION_STUB_ID}
npcs: [fenn, ${NPC_STUB_ID}]
handouts: []
tags: [stealth, social]
status: draft
---

## Flow

Die Gruppe beobachtet den Kai, während die Flut fällt. Zwei Laternen
wandern über die Mole — [[fenn]]s Leute räumen eine Ladung fort, bevor
der Morgen kommt.

> [!readaloud] Die Flut zieht sich zurück und lässt schwarzen Schlick
> zurück. Zwei Laternen schwanken über die Mole, und irgendwo unter
> euch knirscht ein Kiel gegen Stein.

> [!check] Dexterity (Stealth) DC 13, um bis unter die Mole zu kommen,
> ohne die Wache am Kran zu alarmieren.

> [!loot] In der abgestellten Kiste: drei Ballen Schmuggeltabak und ein
> Frachtbrief mit dem Siegel des Auftraggebers.

> [!note] Wenn die Gruppe die Wache alarmiert → Kontingenz
> [[smuggler-captured]].

## If: die Gruppe bleibt unentdeckt

Sie können den Frachtbrief an sich nehmen und [[grella]] folgen, die
die Ladung ins Dorf bringt.

## If: die Gruppe wird entdeckt

[[fenn]] ruft seine Leute zurück und stellt sich selbst auf die Mole —
er will reden, nicht kämpfen.
`;
}

const npcStub = `---
id: ${NPC_STUB_ID}
name: ${NPC_STUB_NAME}
status: alive
---

## Will

Ihren Anteil an der Ladung, ohne dafür in den Kerker zu gehen — und
zwar von [[fenn]] persönlich.
`;

const locationStub = `---
id: ${LOCATION_STUB_ID}
name: ${LOCATION_STUB_NAME}
---

Die flache Bucht nördlich des Hafens — bei Ebbe zu Fuß erreichbar.
`;

// --- npc run -----------------------------------------------------------------

/** Id the stub uses when the DM pinned none. */
export const NPC_DEFAULT_ID = "brakk";
export const NPC_DEFAULT_NAME = "Brakk Sturmhand";
export const NPC_ROLE = "Fischer, kennt jede Sandbank der Nordbucht";
export const NPC_VOICE = "langsam, sucht Worte, lacht über eigene Witze";

function npcFile(id: string): string {
  return `---
id: ${id}
name: ${NPC_DEFAULT_NAME}
role: ${NPC_ROLE}
status: alive
statblock: "Roll20: Commoner"
quickstats: { insight: "+1", passive-perception: "11" }
voice: ${NPC_VOICE}
appearance: geflickter Ölmantel, Hände voller Angelschnüre
---

## Will

Dass die Boote wieder sicher rausfahren können — er hat seit drei
Nächten keinen Fang verkauft und traut [[fenn]] nicht.

## Weiß

> [!secret] Hat gesehen, wie zwei Fremde nachts Kisten von der Mole
> trugen, und schweigt aus Angst.

## Beziehungen

- fenn: kennt ihn vom Kai, geht ihm seit dem Sommer aus dem Weg

## Notizen

<!-- wird von der App im Review-Schritt befüllt -->
`;
}

/** The good NPC reply; `id` is the DM's pin when there was one. */
export function npcReply(id: string = NPC_DEFAULT_ID, knowledge = ""): unknown {
  return {
    npc: { content: npcFile(id) },
    warnings: contextEchoWarnings(knowledge),
  };
}

/**
 * An NPC reply that FAILS validation: unquoted quickstats (YAML eats the
 * plus), a missing status and an invented `chapter`.
 */
export function invalidNpcReply(id: string = NPC_DEFAULT_ID): unknown {
  return {
    npc: {
      content: `---
id: ${id}
name: ${NPC_DEFAULT_NAME}
chapter: 01-salzhafen
quickstats: { insight: +1 }
---

## Will

Irgendwas.
`,
    },
    warnings: [],
  };
}

// --- augment run (issue #36) ---------------------------------------------

/**
 * The heading the „Mit KI ergänzen" prompt puts the existing entry under —
 * server/src/llm-provider.ts EXISTING_ENTRY_HEADING. Duplicated on purpose,
 * like KNOWLEDGE_HEADING in the stub: the fixture reads the prompt the way a
 * model does, so the server agrees with it by ASSERTION and not by import.
 */
export const EXISTING_ENTRY_HEADING = "## Bestehender Eintrag — ergänzen, nicht ersetzen";

/** The `## If:` section a scene augment run adds — asserted in the spec. */
export const AUGMENT_THREAD_CONDITION = "die Gruppe fragt nach dem Spitzel";

/** The paragraph inside that section. */
export const AUGMENT_THREAD_TEXT =
  "[[jorna]] wird einsilbig und schiebt die Frage auf den nächsten Morgen.";

/**
 * What an augment run proposes for an EMPTY npc (the kind issue #70's
 * „Referenzieren legt an" leaves behind: id, name == id, `status: unknown`,
 * no body). Deliberately a MIX, because the default rule of AK2 is what the
 * spec is about:
 *
 *   role, voice   the entry has nothing there  -> `new`,     preselected
 *   name, status  the entry HAS a value        -> `changed`, kept
 *
 * so an accept with the defaults fills the holes and leaves the two fields
 * the DM (or the reference) already authored exactly as they were.
 */
export const AUGMENT_NPC_ROLE = "Spitzel der Schmuggler in der Hafenwache";
export const AUGMENT_NPC_VOICE = "leise, weicht Blicken aus";
export const AUGMENT_NPC_NAME = "Kell Stichbein";
export const AUGMENT_NPC_STATUS = "alive";
export const AUGMENT_NPC_WILL =
  "Nicht auffliegen — und trotzdem bezahlt werden. Beides geht nicht mehr lange gut.";
export const AUGMENT_NPC_SECRET = "Meldet [[fenn]], wann die Hafenwache wechselt.";

/** Everything above the properties' closing `---`, and the body below it. */
function splitEntry(markdown: string): { properties: string[]; body: string } {
  const lines = markdown.split("\n");
  if (lines[0] !== "---") return { properties: [], body: markdown };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { properties: [], body: markdown };
  return { properties: lines.slice(1, end), body: lines.slice(end + 1).join("\n") };
}

/** `key: value` of the properties block, or undefined. */
function propertyValue(properties: string[], key: string): string | undefined {
  const line = properties.find((l) => l.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim();
}

/**
 * The augment reply: the existing entry, byte for byte, plus what the run
 * adds. Which addition depends on what the entry IS — that is the whole
 * point of the two E2E cases:
 *
 *   an EMPTY npc (one a reference created, issue #70)  ->  properties and
 *       the two body sections are filled,
 *   anything else (a prepared scene, a location)       ->  one NEW `## If:`
 *       section at the end; every existing block comes back unchanged.
 */
export function augmentReply(path: string, markdown: string, knowledge = ""): unknown {
  const { properties, body } = splitEntry(markdown);
  const id = propertyValue(properties, "id") ?? path.slice(path.lastIndexOf("/") + 1);
  const isEmptyNpc =
    path.startsWith("npcs/") &&
    propertyValue(properties, "role") === undefined &&
    body.trim() === "";
  const content = isEmptyNpc
    ? [
        "---",
        `id: ${id}`,
        `name: ${AUGMENT_NPC_NAME}`,
        `role: ${AUGMENT_NPC_ROLE}`,
        `status: ${AUGMENT_NPC_STATUS}`,
        `voice: ${AUGMENT_NPC_VOICE}`,
        "---",
        "",
        "## Will",
        "",
        AUGMENT_NPC_WILL,
        "",
        "## Weiß",
        "",
        `> [!secret] ${AUGMENT_NPC_SECRET}`,
        "",
      ].join("\n")
    : [
        markdown.replace(/\n*$/, "\n"),
        `## If: ${AUGMENT_THREAD_CONDITION}`,
        "",
        AUGMENT_THREAD_TEXT,
        "",
      ].join("\n");
  return { entry: { content }, warnings: contextEchoWarnings(knowledge) };
}

/**
 * An augment reply that FAILS validation: it CHANGES the id. The model does
 * not address anything any more (issue #100), so "answers for another entry"
 * is no longer a shape a reply can have — rewriting the reference key is,
 * and it is the rule the augment run cares about most.
 */
export function invalidAugmentReply(_path: string): unknown {
  return { entry: { content: "---\nid: not-the-entry\n---\n" }, warnings: [] };
}

// --- the pipelined scene run (issue #102) ------------------------------------
//
// A scene run is the OUTLINE call plus one call per scene and per suggested
// entry. The stub answers all of them (see stub-llm.ts, which tells them apart
// by the prompt), and these are the canned answers:
//
//   outline        the scene list with a verbatim `sourceExcerpt` per scene —
//                  the server cuts the passage with it, so the fixture has to
//                  quote the SOURCE TEXT and not paraphrase it.
//   scene          one document, `{ scene: { content } }` — the same document
//                  the batch reply used to carry.
//   entry          `{ npc }` / `{ location }` — the npc/location prompt's own
//                  schema, one file per call.
//
// The default run has ONE scene and the two entries the specs already know.
// TRIGGER.threeScenes turns it into three scenes and no entries, which is what
// „ein Teil schlägt fehl, zwei sind prüfbar“ needs.

/** The three scenes of the pipelined run — ids asserted in the specs. */
export const THREE_SCENES = [
  // Ids of their own — none of them is SCENE_ID, so the rich one-scene draft
  // (with its entry references) can never be served for a run whose outline
  // proposes no entries.
  { id: "night-watch", title: "Nachtwache an der Mole" },
  { id: "smuggler-caught", title: "Von Schmugglern erwischt" },
  { id: "dawn-escape", title: "Flucht im Morgengrauen" },
] as const;

/** The scene the failure trigger breaks — the middle one, so two survive. */
export const FAILING_SCENE_ID = THREE_SCENES[1].id;

/**
 * The first and the last sentence of the source text, verbatim — what the
 * outline quotes so the server's excerpt cut actually matches. Every scene
 * gets the same pair here: the fixture is about the PARTS, not about which
 * paragraph a scene came from, and a mismatch would add a warning to every
 * single spec.
 */
function wholeSourceExcerpt(source: string): { first: string; last: string } {
  const sentences = source
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part !== "");
  return { first: sentences[0] ?? source.trim(), last: sentences.at(-1) ?? source.trim() };
}

/** The outline reply: one scene plus two entries, or three scenes and none. */
export function outlineReply(input: {
  source: string;
  knowledge?: string;
  three?: boolean;
  /**
   * TRIGGER.oldName: the naming-check case. Its draft proposes no entries, so
   * the outline must not either — otherwise „Übernehmen“ leaves two undecided
   * entries behind and the run does not finish (the badly-behaved model this
   * trigger stands for is about SPELLING, nothing else).
   */
  oldName?: boolean;
}): unknown {
  const sourceExcerpt = wholeSourceExcerpt(input.source);
  // The outline is the step that reads the WHOLE source text, so the run's
  // „der Quelltext gibt das nicht her“ notes belong to it.
  const warnings = [
    "Der Frachtbrief ist erfunden — im Quelltext steht kein Siegel.",
    ...contextEchoWarnings(input.knowledge ?? ""),
  ];
  if (input.three === true) {
    return {
      scenes: THREE_SCENES.map((scene) => ({
        id: scene.id,
        title: scene.title,
        type: "planned",
        sourceExcerpt,
        refs: [],
      })),
      entries: [],
      warnings,
    };
  }
  if (input.oldName === true) {
    return {
      scenes: [{ id: SCENE_ID, title: SCENE_TITLE, type: "planned", sourceExcerpt, refs: [] }],
      entries: [],
      warnings,
    };
  }
  return {
    scenes: [
      {
        id: SCENE_ID,
        title: SCENE_TITLE,
        type: "planned",
        location: LOCATION_STUB_ID,
        sourceExcerpt,
        refs: [],
      },
    ],
    entries: [
      { kind: "npc", id: NPC_STUB_ID, name: NPC_STUB_NAME, summary: "Schmugglerin am Kai." },
      {
        kind: "location",
        id: LOCATION_STUB_ID,
        name: LOCATION_STUB_NAME,
        summary: "Die flache Bucht nördlich des Hafens.",
      },
    ],
    warnings,
  };
}

/**
 * An outline that FAILS validation (TRIGGER.invalid): one scene, no entries —
 * so the broken scene document below is the run's only part and „jeder Teil
 * ist fehlgeschlagen“ is what the DM sees. The outline itself is fine; the
 * error is in the document, which is where the 422 block's messages come from.
 */
export function invalidRunOutline(source: string): unknown {
  return {
    scenes: [
      {
        id: SCENE_ID,
        title: SCENE_TITLE,
        type: "planned",
        sourceExcerpt: wholeSourceExcerpt(source),
        refs: [],
      },
    ],
    entries: [],
    warnings: [],
  };
}

/** One finished scene document, as the per-scene call answers it. */
export function scenePartReply(chapter: string, sceneId: string, oldName = false): unknown {
  if (sceneId === SCENE_ID) {
    return { scene: { content: sceneDraft(chapter, oldName) }, warnings: [] };
  }
  const scene = THREE_SCENES.find((s) => s.id === sceneId);
  return {
    scene: { content: plainSceneDraft(chapter, sceneId, scene?.title ?? sceneId) },
    warnings: [],
  };
}

/** A scene document that FAILS validation — `status: ready` is drafts only. */
export function invalidScenePartReply(chapter: string, sceneId: string): unknown {
  const title = THREE_SCENES.find((s) => s.id === sceneId)?.title ?? SCENE_TITLE;
  return {
    scene: {
      content: `---
id: ${sceneId}
title: ${title}
type: planned
chapter: ${chapter}
status: ready
---

## Flow

> [!combat] Zwei Wachen, Initiative wie üblich.
`,
    },
    warnings: [],
  };
}

/**
 * A plain, well-formed scene of the three-scene run. No entry references and
 * no location: the pipelined specs are about the PARTS, and every reference a
 * fixture adds is one more thing that can fail for another reason.
 */
function plainSceneDraft(chapter: string, id: string, title: string): string {
  return `---
id: ${id}
title: ${title}
type: planned
chapter: ${chapter}
npcs: [fenn]
handouts: []
tags: [stealth]
status: draft
---

## Flow

[[fenn]]s Leute räumen eine Ladung fort, bevor der Morgen kommt.

> [!readaloud] Über der Mole hängt der Nebel, und irgendwo unter euch
> knirscht ein Kiel gegen Stein.
`;
}

/** One suggested entry, in the npc/location prompt's own reply schema. */
export function entryPartReply(kind: "npc" | "location"): unknown {
  return kind === "location"
    ? { location: { content: locationStub }, warnings: [] }
    : { npc: { content: npcStub }, warnings: [] };
}
