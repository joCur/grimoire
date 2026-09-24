// The canned LLM replies the stub endpoint serves (e2e/fixtures/stub-llm.ts).
//
// Every reply is an OBJECT, exactly as the schema the server forces through
// the provider describes it:
//
//   a scene call      `{ properties, body, warnings }` — the properties of
//                     the scene, its whole text as one string, and the
//                     notes the review shows the DM
//   an npc call       every field of the npc — `body` among them, an absent
//                     optional field as `null`, `quickstats` as a list of
//                     `{ key, value }` pairs — beside `warnings` (ADR #31)
//   a location call   every field of the location — `body` among them —
//                     beside `warnings` (ADR #31)
//   the outline call  the run's scenes, and its new npcs and new locations
//                     as two lists of their own
//
// The fixtures write those objects DIRECTLY. A reply that is a plain STRING
// is one a spec wrote to be unreadable on purpose, and it travels verbatim.
//
// These are FIXTURES, meant to be read and adjusted: they are what a
// well-behaved model would answer, written to pass the CURRENT mechanical
// validation of server/src/generator.ts:
//
//   scenes         no address at all — the server builds it from the run's
//                  chapter and the `id` property — a kebab `id` used only
//                  once, type planned|contingency, status draft, only known
//                  callouts, npc/location references either existing in the
//                  campaign or proposed by the same run, and a `location`
//                  that is an id (it IS the scene's group)
//   proposals      an npc carries a status (alive unless the source says
//                  otherwise), a location carries none
//   npc run        one npc, kebab `id`, no `chapter`, quickstats values
//                  as STRINGS ("+2" — a number would lose the plus on the
//                  way into the store)
//   every body     each `[[id]]` names something of the campaign or
//                  something the same run proposes; the sections (`## Weiß`,
//                  `## Beziehungen`, …) are free text and nothing checks them
//
// When a validation rule changes, THIS file is the place to follow along —
// the specs assert on the titles and ids defined here.
//
// The prose uses `[[slug]]` ENTITY REFERENCES, because that is what the
// prompt asks a well-behaved model for: `[[fenn]]` (exists in the campaign),
// `[[grella]]` (proposed by the same run, so it stays literal text until the
// proposal is accepted) and `[[smuggler-captured]]` (a scene — the third
// referenceable kind).

/** One scene reply, the shape the forced schema describes. */
export interface SceneReply {
  properties: Record<string, unknown>;
  body: string;
  warnings: string[];
}

/**
 * A location reply: every field of the location, `body` among them, beside
 * the notes (ADR #31). A field the source does not give is `null`, as the
 * schema asks.
 */
export interface LocationReply {
  id: string;
  name: string;
  chapter: string | null;
  roll20Page: string | null;
  atmosphere: string | null;
  body: string;
  warnings: string[];
}

/** One `quickstats` value of an npc reply: the key and its value as a string. */
export interface QuickstatPair {
  key: string;
  value: string;
}

/**
 * An npc as its reply form carries it (ADR #31): every field of the npc,
 * `body` among them, an optional one the source does not give as `null`,
 * and `quickstats` as its list of pairs — the very form an npc augment
 * prompt shows the npc in.
 */
export interface NpcFields {
  id: string;
  name: string;
  role: string | null;
  chapter: string | null;
  status: string;
  statblock: string | null;
  quickstats: QuickstatPair[] | null;
  voice: string | null;
  appearance: string | null;
  motivation: string | null;
  body: string;
}

/** An npc reply: the npc's fields beside the notes. */
export interface NpcReply extends NpcFields {
  warnings: string[];
}

/** A location as the augment prompt shows it — its fields, without its guard. */
export interface ExistingLocation {
  id: string;
  name: string;
  chapter?: string;
  roll20Page?: string;
  atmosphere?: string;
  body: string;
}

/** Trigger tokens a test puts into the source text to steer the stub. */
export const TRIGGER = {
  /** The stub answers with a reply that FAILS the mechanical validation. */
  invalid: "E2E_INVALID",
  /** The stub answers `finish_reason: "length"` (a cut-off reply). */
  truncated: "E2E_TRUNCATED",
  /**
   * The stub HOLDS the reply (see SLOW_REPLY_MS) instead of answering — the
   * only way a spec can look at a job while it is genuinely `running`, which
   * is what a restart mid-run needs.
   */
  slow: "E2E_SLOW",
  /**
   * The stub answers with a draft that IGNORES the campaign's naming
   * convention — it writes `OLD_NAME` where the rule says otherwise. A
   * badly-behaved model, on demand: without it the post-run check can only
   * be shown to find nothing.
   */
  oldName: "E2E_OLD_NAME",
  /**
   * The run is decomposed into THREE scenes instead of one, so a spec can
   * watch parts finish, fail and be retried one by one. The outline then
   * proposes no new npc and no new location — those calls have their own
   * coverage in the default (one-scene) run.
   */
  threeScenes: "E2E_THREE_SCENES",
  /**
   * The outline describes the chapter even though the run goes into an
   * EXISTING one — a model that ignores the prompt's rule. The server has to
   * drop it, so that chapter's text stays the DM's.
   */
  describeAnyway: "E2E_DESCRIBE_ANYWAY",
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
   * exercises the switch from the spinner to the review on a POLLED update.
   * Without it the parts are finished before the first `GET …/generate/job`
   * answers, and the review is simply the first thing ever rendered.
   */
  latePart: "E2E_LATE_PARTS",
  /**
   * The scene body carries German quotation marks closed with an ASCII `"`.
   * A reply the model had to escape itself paid for that `"` with a
   * correction turn; as the `body` of a forced object it is just text, so
   * the run has to reach `done` with no correction at all.
   */
  asciiQuotes: "E2E_ASCII_QUOTES",
  /**
   * The FIRST reply of an npc or augment run names an id nobody has
   * (UNKNOWN_REF_ID); the correction turn — the call that carries the
   * previous reply as an assistant turn — gets the good reply. So the run
   * costs exactly one correction and ends with a draft that has no such
   * reference.
   */
  unknownRef: "E2E_UNKNOWN_REF",
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

/**
 * The id TRIGGER.unknownRef puts into a first reply as `[[…]]` — neither the
 * example campaign nor any run of the suite has anything by that id.
 */
export const UNKNOWN_REF_ID = "der-fremde";

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
 * The draft's `id` — the ONE thing the model decides about addressing. The
 * review addresses the draft as `<chapter>/<id>`; the address it is WRITTEN
 * to is `<chapter>/<location>/<id>`, because a scene's group is its location
 * (server/src/generator.ts, draftAddress).
 */
export const SCENE_ID = "night-watch-quay";
/**
 * The npc and the location the scene run proposes. Both ids are deliberately
 * ABSENT from the example campaign: a proposal for an id that already exists
 * is the apply step's 409, not a proposal.
 */
export const NPC_STUB_ID = "grella";
export const NPC_STUB_NAME = "Grella";
export const LOCATION_STUB_ID = "raeucherkammer";
export const LOCATION_STUB_NAME = "Die alte Räucherkammer";

/**
 * How the stub reports back WHAT CONTEXT it was sent. The echo rides along as
 * a `warning`, because that is the one field of the reply the review shows
 * verbatim — so a spec can assert on the prompt's knowledge block through the
 * BROWSER instead of reaching into the server.
 *
 * Only emitted when the campaign actually has knowledge, so every other spec
 * sees exactly the warnings it saw before.
 */
export const CONTEXT_ECHO = "Kontext-Echo:";

export function contextEchoWarnings(knowledge: string): string[] {
  const trimmed = knowledge.trim();
  return trimmed === "" ? [] : [`${CONTEXT_ECHO} ${trimmed.replace(/\n/g, " | ")}`];
}

/**
 * The read-aloud the ASCII-quote case adds — opening `„`, closing with the
 * ASCII `"`. A spec asserts it survives into the review character for
 * character.
 */
export const ASCII_QUOTE_LINE =
  '„Bleibt, wo ihr seid", ruft jemand aus dem Dunkeln — und die Stimme klingt';

/** The scene draft of the default one-scene run, in its three variants. */
function sceneDraft(chapter: string, oldName = false, asciiQuotes = false): SceneReply {
  if (asciiQuotes) {
    // Deliberately WITHOUT the references of the rich draft below: this
    // case is about the quotation marks, and every reference is one more
    // thing that could fail for another reason.
    return {
      properties: {
        id: SCENE_ID,
        title: SCENE_TITLE,
        type: "planned",
        chapter,
        npcs: ["fenn"],
        tags: ["stealth"],
        status: "draft",
      },
      body: `## Flow

Die Wache am Kran murrt: „Wer nachts hier steht, hat was zu verbergen".
[[fenn]]s Leute räumen eine Ladung fort, bevor der Morgen kommt.

> [!readaloud] ${ASCII_QUOTE_LINE}
> jünger, als sie sein sollte.
`,
      warnings: [],
    };
  }
  if (oldName) {
    return {
      properties: {
        id: SCENE_ID,
        title: `Nachtwache in ${OLD_NAME}`,
        type: "planned",
        chapter,
        tags: ["stealth"],
        status: "draft",
      },
      body: `## Flow

Die Gruppe beobachtet den Kai von ${OLD_NAME}, während die Flut fällt.

> [!readaloud] Über den Dächern von ${OLD_NAME} hängt der Nebel.
`,
      warnings: [],
    };
  }
  return {
    properties: {
      id: SCENE_ID,
      title: SCENE_TITLE,
      type: "planned",
      chapter,
      location: LOCATION_STUB_ID,
      npcs: ["fenn", NPC_STUB_ID],
      tags: ["stealth", "social"],
      status: "draft",
    },
    body: `## Flow

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
`,
    warnings: [],
  };
}

/** The motivation of the npc a scene run proposes — a field, not a section. */
export const NPC_STUB_MOTIVATION =
  "Ihren Anteil an der Ladung, ohne dafür in den Kerker zu gehen — und zwar von [[fenn]] persönlich.";

/** The npc a scene run's npc call answers with. */
const npcStub: NpcReply = {
  id: NPC_STUB_ID,
  name: NPC_STUB_NAME,
  role: null,
  chapter: null,
  status: "alive",
  statblock: null,
  quickstats: null,
  voice: null,
  appearance: null,
  motivation: NPC_STUB_MOTIVATION,
  body: `## Weiß

> [!secret] Weiß, an welchem Poller [[fenn]] sein Boot festmacht.
`,
  warnings: [],
};

/** The atmosphere of the location a scene run proposes. */
export const LOCATION_STUB_ATMOSPHERE = "Salz in der Luft, Möwen über dem Schlick, kein Mensch zu sehen.";

/** The location a scene run's location call answers with. */
const locationStub: LocationReply = {
  id: LOCATION_STUB_ID,
  name: LOCATION_STUB_NAME,
  chapter: null,
  roll20Page: null,
  atmosphere: LOCATION_STUB_ATMOSPHERE,
  // `[[grella]]` is the npc the SAME run proposes: a reference to it is
  // valid before either of them is written.
  body: `Die flache Bucht nördlich des Hafens — bei Ebbe zu Fuß erreichbar.

## Wer ist hier

- [[grella]], wenn eine Ladung kommt
`,
  warnings: [],
};

// --- npc run -----------------------------------------------------------------

/** Id the stub uses when the DM pinned none. */
export const NPC_DEFAULT_ID = "brakk";
export const NPC_DEFAULT_NAME = "Brakk Sturmhand";
export const NPC_ROLE = "Fischer, kennt jede Sandbank der Nordbucht";
export const NPC_VOICE = "langsam, sucht Worte, lacht über eigene Witze";
export const NPC_MOTIVATION =
  "Dass die Boote wieder sicher rausfahren können — er hat seit drei Nächten keinen Fang verkauft und traut [[fenn]] nicht.";

/** The good NPC reply; `id` is the DM's pin when there was one. */
export function npcReply(id: string = NPC_DEFAULT_ID, knowledge = ""): NpcReply {
  return {
    id,
    name: NPC_DEFAULT_NAME,
    role: NPC_ROLE,
    chapter: null,
    status: "alive",
    statblock: "Roll20: Commoner",
    // A key/value field travels as the `{ key, value }` LIST the schema
    // asks for — strict mode cannot express a free mapping — and the
    // values are strings, plus sign included.
    quickstats: [
      { key: "insight", value: "+1" },
      { key: "passive-perception", value: "11" },
    ],
    voice: NPC_VOICE,
    appearance: "geflickter Ölmantel, Hände voller Angelschnüre",
    motivation: NPC_MOTIVATION,
    body: `## Weiß

> [!secret] Hat gesehen, wie zwei Fremde nachts Kisten von der Mole
> trugen, und schweigt aus Angst.

## Beziehungen

- [[fenn]]: kennt ihn vom Kai, geht ihm seit dem Sommer aus dem Weg
`,
    warnings: contextEchoWarnings(knowledge),
  };
}

/** The relation line TRIGGER.unknownRef adds to the first npc reply. */
export const UNKNOWN_REF_LINE = `- [[${UNKNOWN_REF_ID}]]: schuldet ihm Geld`;

/**
 * The first reply of a TRIGGER.unknownRef npc run: the good reply plus one
 * relation to an id nothing has — a correction turn.
 */
export function unknownRefNpcReply(id: string = NPC_DEFAULT_ID): NpcReply {
  const good = npcReply(id);
  return { ...good, body: `${good.body}${UNKNOWN_REF_LINE}\n` };
}

/**
 * An NPC reply that FAILS validation: a quickstats value that is a NUMBER
 * (the plus is gone), a missing status and an invented `chapter`. Written
 * as a plain object because it breaks the reply form on purpose.
 */
export function invalidNpcReply(id: string = NPC_DEFAULT_ID): Record<string, unknown> {
  return {
    id,
    name: NPC_DEFAULT_NAME,
    role: null,
    chapter: "01-salzhafen",
    statblock: null,
    quickstats: [{ key: "insight", value: 1 }],
    voice: null,
    appearance: null,
    motivation: "Irgendwas.",
    body: `## Weiß

> [!secret] Irgendwas.
`,
    warnings: [],
  };
}

// --- augment run -------------------------------------------------------------

/**
 * The heading the „Mit KI ergänzen" prompt of a scene puts the existing scene
 * under — server/src/llm-provider.ts EXISTING_ENTRY_HEADING. Duplicated on
 * purpose, like KNOWLEDGE_HEADING in the stub: the fixture reads the prompt
 * the way a model does, so the server agrees with it by ASSERTION and not by
 * import.
 */
export const EXISTING_ENTRY_HEADING = "## Bestehender Eintrag — ergänzen, nicht ersetzen";

/** The same heading of an npc augment run — EXISTING_NPC_HEADING there. */
export const EXISTING_NPC_HEADING = "## Bestehender NPC — ergänzen, nicht ersetzen";

/** The same heading of a location augment run — EXISTING_LOCATION_HEADING there. */
export const EXISTING_LOCATION_HEADING = "## Bestehender Ort — ergänzen, nicht ersetzen";

/** The `## If:` section an augment run adds — asserted in the spec. */
export const AUGMENT_THREAD_CONDITION = "die Gruppe fragt nach dem Spitzel";

/** The paragraph inside that section. */
export const AUGMENT_THREAD_TEXT =
  "[[jorna]] wird einsilbig und schiebt die Frage auf den nächsten Morgen.";

/**
 * What an augment run proposes for an EMPTY npc (one created with a name and
 * nothing else: id, name == id, `status: unknown`, no body). Deliberately a
 * MIX, because the default rule of the accept step is what the spec is
 * about:
 *
 *   role, voice, motivation   the npc has nothing there  -> `new`,     preselected
 *   name, status              the npc HAS a value        -> `changed`, kept
 *
 * so an accept with the defaults fills the holes and leaves the two fields
 * the DM already authored exactly as they were.
 */
export const AUGMENT_NPC_ROLE = "Spitzel der Schmuggler in der Hafenwache";
export const AUGMENT_NPC_VOICE = "leise, weicht Blicken aus";
export const AUGMENT_NPC_NAME = "Kell Stichbein";
export const AUGMENT_NPC_STATUS = "alive";
export const AUGMENT_NPC_MOTIVATION =
  "Nicht auffliegen — und trotzdem bezahlt werden. Beides geht nicht mehr lange gut.";
export const AUGMENT_NPC_SECRET = "Meldet [[fenn]], wann die Hafenwache wechselt.";

/**
 * The existing scene as the PROMPT shows it: the `properties` and `body` pair
 * as JSON, which is the same shape the reply is forced into (ADR #24). The
 * augment run is the one case that has to read it — its reply echoes the
 * scene it was given, so nothing here reconstructs properties from text.
 */
export interface ExistingScene {
  properties: Record<string, unknown>;
  body: string;
}

/**
 * The reply of a scene augment run: the scene as it was shown, unchanged,
 * plus one NEW `## If:` section at the end — every existing block comes back
 * unchanged.
 */
export function augmentReply(scene: ExistingScene, knowledge = ""): SceneReply {
  const kept = scene.body.replace(/^\n+/, "").replace(/\n*$/, "\n");
  return {
    properties: scene.properties,
    body: `${kept}\n## If: ${AUGMENT_THREAD_CONDITION}\n\n${AUGMENT_THREAD_TEXT}\n`,
    warnings: contextEchoWarnings(knowledge),
  };
}

/**
 * The first reply of a TRIGGER.unknownRef augment run: the good proposal plus
 * a sentence naming an id nothing has — a correction turn.
 */
export function unknownRefAugmentReply(scene: ExistingScene): SceneReply {
  const good = augmentReply(scene);
  return { ...good, body: `${good.body}\nDahinter steckt [[${UNKNOWN_REF_ID}]].\n` };
}

/**
 * An augment reply that FAILS validation: it CHANGES the id — the rule the
 * augment run cares about most.
 */
export function invalidAugmentReply(): SceneReply {
  return { properties: { id: "not-the-scene" }, body: "", warnings: [] };
}

// --- augmenting an npc -------------------------------------------------------

/**
 * The reply of an npc augment run (ADR #31). Which addition depends on what
 * the npc IS — that is the whole point of the two E2E cases:
 *
 *   an EMPTY npc (created, never filled in)  ->  its fields (the motivation
 *       among them) and the body's `## Weiß` are filled,
 *   a filled npc  ->  every field echoed as it was shown, plus one NEW
 *       `## If:` section at the end of its text; every existing block comes
 *       back unchanged.
 */
export function npcAugmentReply(npc: NpcFields, knowledge = ""): NpcReply {
  const warnings = contextEchoWarnings(knowledge);
  if (npc.role === null && npc.body.trim() === "") {
    return {
      ...npc,
      name: AUGMENT_NPC_NAME,
      role: AUGMENT_NPC_ROLE,
      status: AUGMENT_NPC_STATUS,
      voice: AUGMENT_NPC_VOICE,
      motivation: AUGMENT_NPC_MOTIVATION,
      body: `## Weiß

> [!secret] ${AUGMENT_NPC_SECRET}
`,
      warnings,
    };
  }
  const kept = npc.body.replace(/^\n+/, "").replace(/\n*$/, "\n");
  return {
    ...npc,
    body: `${kept}\n## If: ${AUGMENT_THREAD_CONDITION}\n\n${AUGMENT_THREAD_TEXT}\n`,
    warnings,
  };
}

/** An npc augment reply that FAILS validation: it changes the id. */
export function invalidNpcAugmentReply(npc: NpcFields): NpcReply {
  return { ...npcAugmentReply(npc), id: "not-the-npc" };
}

/** The first reply of a TRIGGER.unknownRef npc augment run — a correction turn. */
export function unknownRefNpcAugmentReply(npc: NpcFields): NpcReply {
  const good = npcAugmentReply(npc);
  return { ...good, body: `${good.body}\nDahinter steckt [[${UNKNOWN_REF_ID}]].\n` };
}

// --- augmenting a location ---------------------------------------------------

/**
 * The reply of a location augment run (ADR #31): the location as it was
 * shown, every field echoed, plus one NEW `## If:` section at the end of its
 * text — every existing block comes back unchanged.
 */
export function locationAugmentReply(location: ExistingLocation, knowledge = ""): LocationReply {
  const kept = location.body.replace(/^\n+/, "").replace(/\n*$/, "\n");
  return {
    id: location.id,
    name: location.name,
    chapter: location.chapter ?? null,
    roll20Page: location.roll20Page ?? null,
    atmosphere: location.atmosphere ?? null,
    body: `${kept}\n## If: ${AUGMENT_THREAD_CONDITION}\n\n${AUGMENT_THREAD_TEXT}\n`,
    warnings: contextEchoWarnings(knowledge),
  };
}

/** A location augment reply that FAILS validation: it changes the id. */
export function invalidLocationAugmentReply(location: ExistingLocation): LocationReply {
  return { ...locationAugmentReply(location), id: "not-the-location" };
}

/** The first reply of a TRIGGER.unknownRef location augment run — a correction turn. */
export function unknownRefLocationAugmentReply(location: ExistingLocation): LocationReply {
  const good = locationAugmentReply(location);
  return { ...good, body: `${good.body}\nDahinter steckt [[${UNKNOWN_REF_ID}]].\n` };
}

// --- the pipelined scene run -------------------------------------------------
//
// A scene run is the OUTLINE call plus one call per scene, per proposed npc
// and per proposed location. The stub answers all of them (see stub-llm.ts,
// which tells them apart by the prompt), and these are the canned answers:
//
//   outline        the scene list with a verbatim `sourceExcerpt` per scene —
//                  the server cuts the passage with it, so the fixture has to
//                  quote the SOURCE TEXT and not paraphrase it — and the lists
//                  of new npcs and new locations
//   scene          the scene as a scene reply
//   npc, location  the proposed npc or location, each in its own reply form
//
// The default run has ONE scene, one npc and one location the specs already
// know. TRIGGER.threeScenes turns it into three scenes and no proposals, which
// is what „ein Teil schlägt fehl, zwei sind prüfbar“ needs.

/** The three scenes of the pipelined run — ids asserted in the specs. */
export const THREE_SCENES = [
  // Ids of their own — none of them is SCENE_ID, so the rich one-scene draft
  // (with its references) can never be served for a run whose outline
  // proposes no npc and no location.
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

/**
 * The context line of a new-chapter run's outline call —
 * server/src/llm-provider.ts NEW_CHAPTER_LINE, duplicated on purpose like
 * EXISTING_ENTRY_HEADING: the stub reads the prompt the way a model does.
 */
export const NEW_CHAPTER_LINE = "neues Kapitel: ja";

/**
 * What a well-behaved model writes as the description of a new chapter —
 * the text the chapter starts with once the run is accepted. Two paragraphs,
 * so the overview has something to clamp.
 */
export const CHAPTER_DESCRIPTION =
  "Nachts verschwinden Ladungen aus dem Hafen, und an der Nordbucht brennen " +
  "Laternen, wo niemand sein sollte.\n\nDie Gruppe soll herausfinden, wer die " +
  "Schmuggler deckt, und die Ladung sicherstellen, bevor sie ins Dorf gelangt.";

/** The outline reply: one scene plus one npc and one location, or three scenes and none. */
export function outlineReply(input: {
  source: string;
  knowledge?: string;
  /**
   * The context says the run creates its chapter: the outline then carries the
   * chapter's description — and only then, as the prompt asks. A model that
   * describes an existing chapter anyway is the server's to ignore, and the
   * specs check that with `describeAnyway`.
   */
  newChapter?: boolean;
  /** TRIGGER.describeAnyway: a description for an EXISTING chapter as well. */
  describeAnyway?: boolean;
  three?: boolean;
  /**
   * TRIGGER.oldName: the naming-check case. Its draft references no new npc
   * or location, so the outline must not propose one either — otherwise
   * „Übernehmen“ leaves two undecided proposals behind and the run does not
   * finish (the badly-behaved model this trigger stands for is about
   * SPELLING, nothing else).
   */
  oldName?: boolean;
  /**
   * TRIGGER.asciiQuotes: same reasoning as `oldName` — the draft references
   * nothing new, so the outline proposes nothing and the run is exactly one
   * part.
   * The case is about the quotation marks.
   */
  asciiQuotes?: boolean;
}): unknown {
  const sourceExcerpt = wholeSourceExcerpt(input.source);
  // The outline is the step that reads the WHOLE source text, so the run's
  // „der Quelltext gibt das nicht her“ notes belong to it.
  const warnings = [
    "Der Frachtbrief ist erfunden — im Quelltext steht kein Siegel.",
    ...contextEchoWarnings(input.knowledge ?? ""),
  ];
  const chapterDescription =
    input.newChapter === true || input.describeAnyway === true ? CHAPTER_DESCRIPTION : null;
  if (input.three === true) {
    return {
      scenes: THREE_SCENES.map((scene) => ({
        id: scene.id,
        title: scene.title,
        type: "planned",
        sourceExcerpt,
        refs: [],
      })),
      npcs: [],
      locations: [],
      chapterDescription,
      warnings,
    };
  }
  if (input.oldName === true || input.asciiQuotes === true) {
    return {
      scenes: [{ id: SCENE_ID, title: SCENE_TITLE, type: "planned", sourceExcerpt, refs: [] }],
      npcs: [],
      locations: [],
      chapterDescription,
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
    npcs: [{ id: NPC_STUB_ID, name: NPC_STUB_NAME, summary: "Schmugglerin am Kai." }],
    locations: [
      {
        id: LOCATION_STUB_ID,
        name: LOCATION_STUB_NAME,
        summary: "Die flache Bucht nördlich des Hafens.",
      },
    ],
    chapterDescription,
    warnings,
  };
}

/**
 * An outline that FAILS validation (TRIGGER.invalid): one scene, nothing else —
 * so the broken scene draft below is the run's only part and „jeder Teil
 * ist fehlgeschlagen“ is what the DM sees. The outline itself is fine; the
 * error is in the draft, which is where the 422 block's messages come from.
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
    npcs: [],
    locations: [],
    chapterDescription: null,
    warnings: [],
  };
}

/** One finished scene draft, as the per-scene call answers it. */
export function scenePartReply(
  chapter: string,
  sceneId: string,
  oldName = false,
  asciiQuotes = false,
): SceneReply {
  if (sceneId === SCENE_ID) return sceneDraft(chapter, oldName, asciiQuotes);
  const scene = THREE_SCENES.find((s) => s.id === sceneId);
  return plainSceneDraft(chapter, sceneId, scene?.title ?? sceneId);
}

/** A scene draft that FAILS validation — `status: ready` is drafts only. */
export function invalidScenePartReply(chapter: string, sceneId: string): SceneReply {
  const title = THREE_SCENES.find((s) => s.id === sceneId)?.title ?? SCENE_TITLE;
  return {
    properties: { id: sceneId, title, type: "planned", chapter, status: "ready" },
    body: `## Flow

> [!combat] Zwei Wachen, Initiative wie üblich.
`,
    warnings: [],
  };
}

/**
 * A plain, well-formed scene of the three-scene run. No references and no
 * location: the pipelined specs are about the PARTS, and every reference a
 * fixture adds is one more thing that can fail for another reason.
 */
function plainSceneDraft(chapter: string, id: string, title: string): SceneReply {
  return {
    properties: {
      id,
      title,
      type: "planned",
      chapter,
      npcs: ["fenn"],
      tags: ["stealth"],
      status: "draft",
    },
    body: `## Flow

[[fenn]]s Leute räumen eine Ladung fort, bevor der Morgen kommt.

> [!readaloud] Über der Mole hängt der Nebel, und irgendwo unter euch
> knirscht ein Kiel gegen Stein.
`,
    warnings: [],
  };
}

/** One proposed npc or location — each in its own reply form. */
export function proposalPartReply(kind: "npc" | "location"): NpcReply | LocationReply {
  return kind === "location" ? locationStub : npcStub;
}
