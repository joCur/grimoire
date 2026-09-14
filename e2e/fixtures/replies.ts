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
      scenes: [{ content: sceneDraft(chapter, true) }],
      entries: [],
      warnings: contextEchoWarnings(knowledge),
    };
  }
  return {
    scenes: [{ content: sceneDraft(chapter) }],
    entries: [
      { kind: "npc", content: npcStub },
      { kind: "location", content: locationStub },
    ],
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
    entries: [],
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
