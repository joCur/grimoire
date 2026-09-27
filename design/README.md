# design/ — binding design reference

Export from the PO's Claude Design project (source:
https://claude.ai/design/p/bdec0f7c-9772-4d68-91f1-49623f1b530a).
These files are the design truth for every view; docs/UI-BRIEF.md stays the
layer of intent above them. Where the two disagree, this reference wins.

- `Grimoire.dc.html` — desktop prototype: topbar (campaign switcher, ⌘K,
  session control), chapter overview (chapter accordions), scene, live mode
  (three zones with log panel and quick note), session review ("five minute
  harvest"), ⌘K palette.
- `Grimoire-Mobil.dc.html` — mobile: start surface (search, idea capture,
  recently viewed) and reading view.
- `grimoire-icon.svg` — app icon (book and spark, brass on anthracite).

Binding core values (from the prototype):
Palette: bg #1d1a16 · panel #23201b · border #2e2925/#38322a ·
text #e7dfd2/#d6ccbc · secondary #a2968a · muted #7a6f61 · faint #5d554a ·
accent #c8a35a (hover #dcb96e) · read-aloud #29241d/#ece2cf ·
green #8fae7e/#93a888 (status). Serif: Literata (self-hosted).
Callout labels: check · secret · outcome · loot · note; read-aloud has no
label. Status labels: ready · draft · played.
`If:` branches: borderless row, chevron, italic condition, content
indented, OPEN by default.

## Deviations by PO decision (newer than the prototype)

- No scene `id` in the topbar (the prototype shows it on the right) — ids
  appear nowhere in the UI, not even optionally.
- ONE CAMPAIGN MENU for every area of a campaign. It replaces the topbar's
  former section navigation (chapters · NPCs · locations) and its debrief
  link, as well as the chapter overview's lookup line and the lookup rows of
  the mobile start surface: each area has exactly ONE entry point, the menu,
  plus the ⌘K palette, which reads the same list. The menu IS the campaign
  switcher: closed, it names the campaign and the area of the current view
  (`<campaign> › NPCs`); on a view that belongs to no area (live mode,
  generator, a past session, settings) it names only the campaign — an
  arbitrary area would be a lie. A reading view belongs to the area of its
  list: a scene to the scenes, an NPC to the NPCs, a chapter to the chapters.
  Opened, it lists the campaigns (switch, create) and the areas in three
  groups: prepare (chapters, scenes, NPCs, locations), look up (glossary,
  campaign knowledge), tidy up (session review, trash). The current area is
  marked with `aria-current="page"` and a brass bar; the session review's
  entry carries the number of rows still open while there are any. The menu
  is keyboard driven (arrow keys, Enter, Escape). A new area is one new row
  in the list of areas and appears in the menu and in ⌘K at once. No other
  button or link leads into an area — no navigation next to the menu, no
  lookup line, no link in a page's content. If the areas ever outgrow the
  menu, the same groups can move into a sidebar.
- THE CHROME IS GLOBAL AND STABLE. The topbar is the same on ALL
  campaign-scoped views — chapter overview, lists, reading views, generator,
  session review, live mode:

      Grimoire │ <campaign> › <area> ⌄ │ … ⌘K · generator · ⚙ · ● 0:12:33

  Moving between them, nothing appears or disappears and nothing shifts; the
  only difference is the area the menu names. The right side holds the
  tools, not places: search, the generator entry (always on the chapter
  overview, elsewhere while the campaign has a job), the settings gear, and
  the session chip at the rightmost position.
- ONE SESSION CHIP instead of a live control. The running session used to be
  spread over six elements — green live pill, separate timer, pause, end
  session, discard session, a mobile live bar of its own — in a count and
  order that changed per route, and at medium widths the bar ran over. Now:
  ONE chip, in the same place on every campaign-scoped route, `/live`
  included. Brass (the accent) IS the state — no "live" label any more; the
  runtime reads H:MM:SS with a tick per second (a 15s tick on minutes looked
  frozen). Outside `/live` a click leads back into the session, in `/live`
  it opens the session menu (pause · end session · discard session, the
  last only for an empty session). Below `md` the same chip sits in a slim
  row of its own (link mode — there is no mobile live mode). The chapter
  label of the old live topbar stands above the live mode's scene nav.
  Deviation from the prototype, which has two topbar layouts: stability of
  the session control wins.
- THE SAME CHIP IN EVERY STATE. The chip is not only the display of the
  running session, it IS the session control — one element, one slot, same
  height, shape, padding and font size; only content and color change:
  "start session" (or "continue session" when today's session has ended)
  as a brass call to action · ● H:MM:SS in muted brass while a session runs
  · "status unknown", dimmed and not clickable, when the session query
  fails. From `lg` up a minimum width keeps the states at a comparable size;
  below that the bar is too tight for it. The runtime uses tabular figures,
  so the tick moves nothing. The start appears only on the server's explicit
  answer "nothing is running" — never during the query and never after an
  error.
- NO HORIZONTAL OVERFLOW AT ANY WIDTH ≥390px. The elastic element of the bar
  is the ⌘K chip (its label truncates); the campaign name truncates with an
  ellipsis (harder below `xl`); the generator entry carries only its icon
  below `xl` (its name stays accessible). The topbar E2E checks several
  medium widths with and without a running session.
- NO BREADCRUMBS IN THE TOPBAR — anywhere. They repeated the campaign name,
  competed with the navigation next to them, and on a reading view claimed a
  chapter path that was plainly wrong for an NPC opened from the NPC list.
- PAGE CONTEXT LIVES IN THE PAGE. A scene's hierarchy stands as a quiet
  context line above its title, right by what it describes:
  `<chapter title> › <location>`, as text. Where the menu already says it
  (an NPC's or a location's list, a chapter), there is no line.
- THE CAMPAIGN NAME EXACTLY ONCE in the chrome: in the campaign menu. Never
  in crumbs, never in context lines.
- Display names instead of ids: a scene row shows the location's name when
  the location exists (otherwise the id as written), the review's source
  chip the scene title (id as fallback). Visible ids remain only in
  identification contexts, set in mono: the create dialogs' id field, the id
  badge of an NPC card, the generator's previews.
- The edit action in the chapter overview's header: a dialog over name,
  description and text (writes the campaign, guarded by `rev`). Not in the
  prototype either.
- THE PHONE'S START IS THE CHAPTER OVERVIEW. Below `md` the campaign's route
  shows the wordmark with the campaign menu, the search field and the idea
  capture above the chapter overview itself, laid out for 390px; the
  language switch closes the page. Every other campaign view on the phone
  carries the campaign menu in a row of its own; the menu opens as a sheet
  from the bottom edge.

## Update: generator view

`Grimoire.dc.html` contains the GENERATOR section (four states: input →
working → review → written) plus its topbar entry. Key points: target
chapter as chips including a "new chapter" flow (title input, id preview),
source text area with a context hint line, spinner with an explanation of
the correction turn, review with warning callouts, scene card (rendered body
OR raw Markdown edit, switchable), stub rows accepted or rejected one by
one, "accept (n)" plus discard, success state with the written rows.
