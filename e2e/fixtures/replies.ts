// The canned LLM replies the stub endpoint serves (e2e/fixtures/stub-llm.ts).
//
// These are FIXTURES, meant to be read and adjusted: they are exactly what a
// well-behaved model would answer for the scene run and the NPC run, and they
// are written to pass the CURRENT mechanical validation of
// server/src/generator.ts:
//
//   scenes         path inside the target chapter, parseable properties,
//                  type planned|contingency, status draft, only known
//                  callouts, npc/location references either existing in the
//                  campaign or shipped as a stub in the same reply
//   npc_stubs      npcs/<kebab-id> WITH a status (alive unless the source
//                  says otherwise)
//   location_stubs locations/<kebab-id> WITHOUT any status (locations have
//                  none — issue #27)
//   npc run        npcs/<kebab-id>, properties id == file name, no
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
} as const;

/**
 * The spelling `TRIGGER.oldName` puts into the draft. The spec writes a
 * naming convention „<OLD_NAME> → …" on the settings page and then expects
 * the review to flag exactly this word.
 */
export const OLD_NAME = "Saltmarsh";

/** How long a TRIGGER.slow request is held before it would answer. */
export const SLOW_REPLY_MS = 60_000;

// --- scene run ---------------------------------------------------------------

/** Title of the generated scene draft — asserted in the specs. */
export const SCENE_TITLE = "Nachtwache am Kai";
/**
 * File name the model puts the scene draft under, inside the target chapter —
 * what the review shows and what the apply request sends.
 */
export const SCENE_SLUG = "nachtwache-am-kai";
/**
 * The draft's `id`, deliberately DIFFERENT from the file name above: since the
 * cutover (issue #57) a scene's address is `<chapter>/<id>`, so this is the
 * path the draft ends up under once it is applied — the model's file name
 * decides nothing (server/src/generator.ts, draftAddress).
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

/**
 * The good scene reply for the chapter the prompt names.
 *
 * `knowledge` is the campaign-knowledge block the prompt carried — echoed
 * back as a warning so a spec can see it (see contextEchoWarnings).
 * `oldName` is TRIGGER.oldName: the same well-formed reply, but written in
 * the spelling a naming convention forbids.
 */
export function sceneReply(chapter: string, knowledge = "", oldName = false): unknown {
  if (oldName) {
    return {
      scenes: [{ path: `${chapter}/${SCENE_SLUG}`, content: sceneDraft(chapter, true) }],
      npc_stubs: [],
      location_stubs: [],
      warnings: contextEchoWarnings(knowledge),
    };
  }
  return {
    scenes: [{ path: `${chapter}/${SCENE_SLUG}`, content: sceneDraft(chapter) }],
    npc_stubs: [{ path: `npcs/${NPC_STUB_ID}`, content: npcStub }],
    location_stubs: [{ path: `locations/${LOCATION_STUB_ID}`, content: locationStub }],
    warnings: [
      "Der Frachtbrief ist erfunden — im Quelltext steht kein Siegel.",
      ...contextEchoWarnings(knowledge),
    ],
  };
}

/**
 * A scene reply that FAILS validation, on purpose and in two ways at once:
 * `status: ready` (drafts only) and an unknown callout. Both messages end up
 * in the job's 422 body and thus in the UI's error block.
 */
export function invalidSceneReply(chapter: string): unknown {
  return {
    scenes: [
      {
        path: `${chapter}/${SCENE_SLUG}`,
        content: `---
id: ${SCENE_ID}
title: ${SCENE_TITLE}
type: planned
chapter: ${chapter}
status: ready
---

## Flow

> [!combat] Zwei Wachen, Initiative wie üblich.
`,
      },
    ],
    npc_stubs: [],
    location_stubs: [],
    warnings: [],
  };
}

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
    npc: { path: `npcs/${id}`, content: npcFile(id) },
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
      path: `npcs/${id}`,
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
