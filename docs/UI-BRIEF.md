# UI-BRIEF — Grimoire

## Subject and job

Grimoire is a game master's digital spellbook. User: exactly one person, in
the evening, often in dim light, while they are talking, listening and
operating Roll20 at the same time. The one job of every view: **deliver the
next piece of information in under three seconds without breaking the flow
of the story.**

Grimoire is a tool with character, not a fantasy theme park. The metaphor
(book, pages, prepared spells) may be felt in material and typography —
never in ornamental frames, parchment textures, dragon decor or blackletter.

## Design direction

**Mood:** a quiet library by candlelight, not a dungeon. Dark primary mode
(evening sessions), warm rather than cold — deep anthracite with a brown
undertone instead of blue-black. A single accent color in the range of muted
gold/brass (taken from gilt page edges and ribbon bookmarks), used
sparingly: active scene, focus, primary action. Semantic colors
(success/warning/danger) only for status, never for decoration.

**Typography carries the personality:**
- Read-aloud text is the star: a literary serif
  (e.g. Source Serif 4 or Literata), 18–20px, generous line spacing.
  This is the text that is read out loud — it has to look like it comes from
  a book, not from an admin panel.
- UI chrome: an unexcited sans (e.g. Inter or system-ui), small and quiet.
  The UI whispers, the content speaks.
- Monospace only for ids and quick-stats badges.

**Signature element (the one bold decision):** the read-aloud block. It is
treated as a "book page inside the interface" — a slightly set-off,
somewhat lighter/warmer background, serif, a fine ribbon-bookmark detail as
the left accent line, and a copy button (for Roll20) only on hover/focus.
Everything else in the interface is deliberately quiet so that this block
carries the page.

**Iconography:** Lucide for the functional (navigation, actions, status).
game-icons.net (CC BY, checked in as React components of our own) ONLY as
type markers: scene, NPC, location, contingency scene and the six callout
types. Monochrome, in the text color, 16–20px. No colorful icon
illustrations.

## The views

### 1. Chapters (prep mode, desktop; route `/campaigns/:id`)
Job: overview and order. Chapter > scenes as a quiet list (no card grids),
status as subtle markers, contingency scenes visually as their own group
(the UI calls them "Eventualszenen"). The list stands in the order the DM
laid down — the location is not a level above the scenes but a word in the
row's meta line, next to type and tags. The order is rearranged right here,
with up/down on the row: quiet like everything else, noticeable on the row
currently being moved, and not as a permanent label next to every scene.
Filter by tags/status, global search prominent (Cmd/Ctrl-K). From here:
open a scene, start a session, open the generator.

### 2. Scene (reading)
Job: take in a scene completely. Properties as a compact header line (type,
trigger, location, tags), the scene's NPC cards on the right (voice, will,
quick stats — exactly these three), the body with the rendered flow,
collapsible `If:` branches and the callout blocks. Read-aloud: see the
signature element. `[!check]` clearly recognizable (accent frame),
`[!secret]` with an eye marker and slightly dimmed — secrets look secret.

### 3. Session view (session mode, desktop; route `live`)
Job: moderate without searching. Three quiet zones: on the left the
chapter's scene list in the order from the preparation (planned on top,
contingency scenes below; it is rearranged in the chapter overview, not
here), in the middle the current scene, on the right NPCs + the quick-note
field (always focusable, Enter sends). The evening's common thread is a
single step below the open scene: the next-scene link (the UI says
"Nächste Szene: <title>") — it says where the DM reaches next without having
to search the list. On entry, the first scene that has not been played yet
is up. Header line: session time (computed from `started`), pause, end
session. After the read-aloud, the quick note is the second most important
element — nothing may cover it.

### 4. Mobile
Job: look things up and drop things in, not moderate. Two things on the
start surface: search and idea input. Scenes/NPCs as a pure reading view.
Never force the session view onto mobile.

### 5. Session review (after the session; route `review`)
Job: five minutes of follow-up (the former term "Ernte", harvest, has been
replaced in the UI — its metaphor was unclear). Notes and ideas filtered by
`#thread`/`#npc`, one-click actions per note (adopt the storyline, create
the suggested NPC, discard). Progress visible (the UI says e.g.
"3 von 7 gesichtet", 3 of 7 reviewed).

## Tone of the UI copy

In German: short sentences, verbs first (e.g. "Session starten",
"Szene öffnen"). No exclamation marks, no fantasy speak in functional copy
(never something like "Beschwöre eine neue Szene", summon a new scene).
Empty states invite action (e.g. "Noch keine Szenen in diesem Kapitel —
erste Szene anlegen", no scenes in this chapter yet — create the first
scene).

### Terms in the UI

Every view and every action is named after its function — no internal
names, no metaphors, and in the German UI no anglicisms where a German word
does the job. Routes, query keys, catalog keys and format tokens (the
`inbox` list, hashtags, callout types, status values) are not affected by
this.

| UI says (de) | UI says (en) | formerly |
|---|---|---|
| Kapitel | Chapters | Pool |
| Session-Ansicht | Session view | Live-Modus / Live-Ansicht |
| Nachbereitung | Session review | Ernte, Wrap-up |
| Ideen ohne Tag | Ideas without a tag | Ungetaggte Einträge, Notizen (section of the session review) |
| Ideen | Ideas | Inbox |
| Entwürfe prüfen | Check drafts | Review (generator) |
| Vorschlag prüfen | Check the proposal | Review (NPC generator) |
| Vorgeschlagene NPCs und Orte | Suggested NPCs and locations | Vorgeschlagene Einträge, Stubs |
| Eventualszene | Contingency scene | Kontingenz, "Falls es schiefgeht" |
| Probe | Check | Check (de) |
| Ergebnis | Outcome | Konsequenz |
| Markdown-Block | Markdown block | Roh-Block |
| Kurzwerte | Quick stats | Quickstats |
| Handlungsstrang | Storyline | Thread (en) |
| Eigenschaften | Properties | Frontmatter |
| Text | Text | Body |

## Non-goals

No stat blocks, no dice rolling, no initiative, no player view, no
ornamental graphics, no parallax/scroll effects. Motion only as short,
functional transitions (collapsing, focus changes);
`prefers-reduced-motion` turns them off.

## Acceptance test per view

"Does the DM, in the middle of a spoken sentence, find the information
without interrupting the sentence?" If a design decision does not improve
the answer to that question, it is decoration — leave it out.
