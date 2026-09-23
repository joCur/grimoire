// Critical path 5: the session review; the harvest metaphor lives on in spec
// and identifier names only. See CLAUDE.md.
//
// Adopt a thread → a row of the chapter's thread list, tick off an inbox
// line, create an NPC stub, and the progress counter. The thread list itself
// — its rows, its guard and the chapter overview that keeps it — is
// threads.e2e.ts.
//
// TODAY's session is the harvest's data, so it is SEEDED as a session of its
// own (the same rows the live view would have written — path 4 covers the
// writing itself).
//
// Sessions, ideas and a chapter's open threads are LISTS (ADR #26): the
// review reads rows and names them back by their id — `POST /review/seen
// { sessionId, logId }` and `POST /review/inbox-done { id }` — and adopting a
// thread appends a row to the chapter's list. So every assertion about what
// was harvested reads a row, not a rendered text, and the chapter's own text
// and `rev` stay exactly as they were.
//
// The source chip of a log row names the SCENE by its title (resolved via
// the tree), not by the row's `sceneId`.

import { expect, test, todaySessionId, type ApiThreads, type SeedEntry } from "../support/test";

const THREAD_TEXT = "Cliffhanger: Lichter in der Bucht gesichtet";
const NPC_TEXT = 'Improvisiert: Fischerin „Old Metta“ am Steg';
const INBOX_TEXT = "Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug";
/** An idea thrown in on the go — no hashtag at all. */
const NOTE_TEXT = "Die Laternen am Kai brennen bei Ebbe nie";
/** A note ABOUT a player character — `#pc` plus the name tag. */
const PC_TEXT = "Geburtstags-Item für Kaela vorbereiten";

/** Today's session with the three tagged log rows the review harvests. */
function sessionEntry(id: string): SeedEntry {
  return {
    kind: "session",
    properties: {
      id,
      started: `${id}T19:30:00`,
      ended: `${id}T22:45:00`,
      scenes_played: ["lighthouse-arrival"],
    },
    log: [
      {
        at: "19:52",
        sceneId: "lighthouse-arrival",
        text: "Spuren gefunden, Gruppe will sofort zur Bucht #decision",
      },
      { at: "21:10", sceneId: "lighthouse-arrival", text: `${NPC_TEXT} #npc` },
      // No scene: the source chip of this row stays bare.
      { at: "22:40", text: `${THREAD_TEXT} #thread` },
    ],
    body: "",
  };
}

test.use({ seed: { entries: { "session-today": sessionEntry(todaySessionId()) } } });

/**
 * The evening of YESTERDAY, ENDED after midnight: `ended` sits on yesterday's
 * session and there is no session for today at all.
 */
const PAST_MIDNIGHT = (() => {
  const today = todaySessionId();
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const entry: SeedEntry = {
    kind: "session",
    properties: {
      id: yesterday,
      started: `${yesterday}T21:30:00`,
      ended: `${today}T01:40:00`,
      scenes_played: ["lighthouse-arrival"],
    },
    log: [{ at: "22:40", text: `${THREAD_TEXT} #thread` }],
    body: "",
  };
  return { id: yesterday, entry };
})();

test("adopting a thread lands in the chapter's list, the inbox line gets ticked off", async ({
  page,
  api,
}) => {
  const chapterBefore = await api.entry("01-salzhafen");
  const threadsBefore = await api.threads("01-salzhafen");
  await page.goto("/campaigns/beispiel/review");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session-Nachbereitung");

  // The topbar carries the harvest progress (the page repeats it below md).
  const progress = page.getByRole("banner").getByText(/von \d+ gesichtet/);

  // Three tagged log rows + the tagged idea of the example campaign.
  await expect(progress).toHaveText("0 von 4 gesichtet");
  await expect(page.getByText("Noch keine offenen Handlungsstränge in diesem Kapitel.")).toHaveCount(0);
  // The chapter already carries one open thread — a row of its list.
  await expect(page.getByText("Wer bezahlt die Schmuggler?")).toBeVisible();
  expect(threadsBefore.entries.map((row) => row.text)).toEqual(["Wer bezahlt die Schmuggler?"]);

  // --- adopt the #thread log line -----------------------------------------
  const threadCard = page.locator("div").filter({ hasText: THREAD_TEXT }).last();
  // This row carries no `sceneId`, so the chip stays bare (the scene part
  // only appears when the row names one).
  await expect(threadCard.getByText("Log", { exact: true })).toBeVisible();
  await threadCard.getByRole("button", { name: "Als Handlungsstrang übernehmen" }).click();

  await expect(threadCard.getByText("Als Handlungsstrang übernommen")).toBeVisible();
  await expect(progress).toHaveText("1 von 4 gesichtet");
  // The thread list shows the new item with the "neu" chip.
  await expect(page.getByText("neu", { exact: true })).toBeVisible();

  // Stored: the chapter's thread list gained a ROW at its end …
  await expect
    .poll(async () =>
      (await api.threads("01-salzhafen")).entries.map((row) => [row.text, row.done]),
    )
    .toEqual([
      ["Wer bezahlt die Schmuggler?", false],
      [THREAD_TEXT, false],
    ]);
  // … and the chapter ENTRY did not move: not its text, not its guard.
  const chapterAfter = await api.entry("01-salzhafen");
  expect(chapterAfter.body).toBe(chapterBefore.body);
  expect(chapterAfter.rev).toBe(chapterBefore.rev);
  // The list's own guard moved instead.
  expect((await api.threads("01-salzhafen")).rev).toBe(threadsBefore.rev + 1);

  // The adopted thread is a row with an id, and ticking it names that id.
  const list = await api.threads("01-salzhafen");
  const adopted = list.entries.at(-1)!;
  const ticked = await api.send<ApiThreads>("PATCH", api.threadsPath("01-salzhafen", adopted.id), {
    rev: list.rev,
    done: true,
  });
  expect(ticked.entries.at(-1)).toEqual({ ...adopted, done: true });
  expect((await api.entry("01-salzhafen")).rev).toBe(chapterBefore.rev);
  const patchThread = (id: string, body: unknown) =>
    api.fetch(api.threadsPath("01-salzhafen", id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  // An id the list does not hold is 404 — never a quiet 200.
  expect((await patchThread("no-such-thread", { rev: ticked.rev, done: true })).status).toBe(404);
  // A stale token is 409, writes nothing and hands back the current list.
  const stale = await patchThread(adopted.id, { rev: list.rev, done: false });
  expect(stale.status).toBe(409);
  expect(((await stale.json()) as { threads: ApiThreads }).threads).toEqual(ticked);
  expect(await api.threads("01-salzhafen")).toEqual(ticked);
  // … and the source ROW carries the flag: the review named it by the `id`
  // the log handed out, so exactly that row is marked and no other.
  await expect
    .poll(async () =>
      (await api.session(todaySessionId())).log
        .filter((row) => row.reviewed)
        .map((row) => row.text),
    )
    .toEqual([`${THREAD_TEXT} #thread`]);

  // --- tick off the idea ---------------------------------------------------
  const inboxCard = page.locator("div").filter({ hasText: INBOX_TEXT }).last();
  await expect(inboxCard.getByText("Idee", { exact: true })).toBeVisible();
  await inboxCard.getByRole("button", { name: "Verwerfen" }).click();

  await expect(inboxCard.getByText("Verworfen")).toBeVisible();
  await expect(progress).toHaveText("2 von 4 gesichtet");
  // `done` is a column of the row, not a checkbox marker in a text.
  await expect
    .poll(async () => (await api.inbox()).entries.map((row) => [row.done, row.text]))
    .toEqual([[true, expect.stringContaining(INBOX_TEXT)]]);

  // "Fertig" goes back to the chapters.
  await page.getByRole("button", { name: "Fertig — zurück zu den Kapiteln" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  // The chapter overview's quiet review affordance counts what is still open.
  await expect(page.getByRole("link", { name: "Nachbereitung · 2 offen" })).toBeVisible();
});

test("an untagged inbox note is reviewable and can be ticked off", async ({
  page,
  api,
}) => {
  // Thrown in the way it happens on the go: the mobile start surface at
  // 390px (critical path 8), no hashtag.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/campaigns/beispiel");
  await page.getByLabel("Ideen").fill(NOTE_TEXT);
  await page.getByRole("button", { name: "Einwerfen" }).click();
  await expect(page.getByText("Eingeworfen.")).toBeVisible();
  // The idea arrives as its own row, appended to the list.
  await expect
    .poll(async () => (await api.inbox()).entries.map((row) => row.text))
    .toContain(NOTE_TEXT);

  // At the desk it shows up in the session review — in its own untagged-entries
  // section, and counted with everything else (one source for page and topbar).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/campaigns/beispiel/review");
  const progress = page.getByRole("banner").getByText(/von \d+ gesichtet/);
  await expect(progress).toHaveText("0 von 5 gesichtet");
  await expect(page.getByRole("heading", { name: "Ungetaggte Einträge" })).toBeVisible();

  const noteCard = page.locator("div").filter({ hasText: NOTE_TEXT }).last();
  await expect(noteCard).toContainText("Idee");
  // No tag means no tag-derived affordance — both harvest actions are offered.
  await expect(
    noteCard.getByRole("button", { name: "Als Handlungsstrang übernehmen" }),
  ).toBeVisible();
  await expect(noteCard.getByRole("button", { name: "NPC anlegen" })).toBeVisible();

  await noteCard.getByRole("button", { name: "Erledigt" }).click();
  await expect(noteCard.getByText("Erledigt", { exact: true })).toBeVisible();
  await expect(progress).toHaveText("1 von 5 gesichtet");
  // The ROW is ticked off — and only that one.
  await expect
    .poll(async () =>
      (await api.inbox()).entries.filter((row) => row.done).map((row) => row.text),
    )
    .toEqual([NOTE_TEXT]);

  // The chapter overview affordance counts the same entries the page does.
  await page.getByRole("button", { name: "Fertig — zurück zu den Kapiteln" }).click();
  await expect(page.getByRole("link", { name: "Nachbereitung · 4 offen" })).toBeVisible();
});

test("a #pc note is grouped by character and ticked off", async ({ page, api }) => {
  // Thrown in the way it happens on the go: the mobile start surface at
  // 390px (critical path 8), tagged `#pc #kaela`.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/campaigns/beispiel");
  await page.getByLabel("Ideen").fill(`${PC_TEXT} #pc #kaela`);
  await page.getByRole("button", { name: "Einwerfen" }).click();
  await expect(page.getByText("Eingeworfen.")).toBeVisible();

  // Still at 390px: the session review is a desk task, but it has to stay readable
  // and operable on the phone (quality floor).
  await page.goto("/campaigns/beispiel/review");
  const section = page.getByRole("heading", { name: "Spielercharaktere" });
  await expect(section).toBeVisible();
  // Grouped under the second tag — not under "Allgemein".
  await expect(page.getByRole("heading", { name: "#kaela" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Allgemein" })).toHaveCount(0);
  // The page repeats the counter below md: the `#pc` line counts with.
  await expect(page.getByText(/von \d+ gesichtet/).first()).toHaveText("0 von 5 gesichtet");

  const pcCard = page.locator("div").filter({ hasText: PC_TEXT }).last();
  await expect(pcCard).toContainText("Idee");
  // A PC note is no campaign content: neither harvest action is offered.
  await expect(
    pcCard.getByRole("button", { name: "Als Handlungsstrang übernehmen" }),
  ).toHaveCount(0);
  await expect(pcCard.getByRole("button", { name: "NPC anlegen" })).toHaveCount(0);
  // The keep action persists nothing — it is an honest toggle for this sitting.
  const keep = pcCard.getByRole("button", { name: "Behalten" });
  await expect(keep).toBeVisible();
  await expect(keep).toHaveAttribute("aria-pressed", "false");
  await keep.click();
  await expect(keep).toHaveAttribute("aria-pressed", "true");
  await keep.click();
  await expect(keep).toHaveAttribute("aria-pressed", "false");
  // …and it does not turn up among the untagged notes either.
  await expect(page.getByRole("heading", { name: "Ungetaggte Einträge" })).toHaveCount(0);

  await pcCard.getByRole("button", { name: "Erledigt" }).click();
  await expect(pcCard.getByText("Erledigt", { exact: true })).toBeVisible();
  await expect(page.getByText(/von \d+ gesichtet/).first()).toHaveText("1 von 5 gesichtet");
  // The ROW is ticked off, hashtags and all — the text is stored as typed.
  await expect
    .poll(async () =>
      (await api.inbox()).entries.filter((row) => row.done).map((row) => row.text),
    )
    .toEqual([`${PC_TEXT} #pc #kaela`]);

  // Back at the desk the chapter overview affordance counts what is still open.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Fertig — zurück zu den Kapiteln" }).click();
  await expect(page.getByRole("link", { name: "Nachbereitung · 4 offen" })).toBeVisible();
});

test("creating an NPC entry from a #npc log row", async ({ page, api }) => {
  await page.goto("/campaigns/beispiel/review");

  const npcCard = page.locator("div").filter({ hasText: NPC_TEXT }).last();
  // The source chip names the SCENE the row was logged under, resolved from
  // the tree — never the row's `sceneId`.
  await expect(npcCard.getByText("Log · Ankunft am Leuchtturm")).toBeVisible();
  await expect(npcCard.getByText("lighthouse-arrival")).toHaveCount(0);
  await npcCard.getByRole("button", { name: "NPC anlegen" }).click();

  // The dialog proposes id and name from the log text.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("NPC anlegen");
  await expect(dialog.getByRole("textbox").first()).toHaveValue("old-metta");
  await expect(dialog.getByRole("textbox").nth(1)).toHaveValue("Old Metta");
  await dialog.getByRole("button", { name: "Anlegen" }).click();

  await expect(npcCard.getByText("NPC angelegt")).toBeVisible();
  const stub = await api.entry("npcs/old-metta");
  expect(stub.properties.id).toBe("old-metta");
  expect(stub.properties.name).toBe("Old Metta");
  // The log row said nothing about the NPC's state, so the entry claims
  // nothing either.
  expect(stub.properties.status).toBe("unknown");
  // The text IS the log line (its hashtags stripped) — no heading around it.
  expect(stub.body).toBe(NPC_TEXT);

  // The new NPC is in the tree right away (list page, search index).
  await page.goto("/campaigns/beispiel/list/npcs");
  await expect(page.getByRole("link", { name: /Old Metta/ })).toBeVisible();
});

test("an id that already has an entry is linked, not refused", async ({ page, api }) => {
  // The call is idempotent: the entry stands, untouched.
  const before = await api.entry("npcs/fenn");
  await page.goto("/campaigns/beispiel/review");

  const npcCard = page.locator("div").filter({ hasText: NPC_TEXT }).last();
  await npcCard.getByRole("button", { name: "NPC anlegen" }).click();
  const dialog = page.getByRole("dialog");
  const idField = dialog.getByRole("textbox").first();
  await idField.fill("fenn");
  await dialog.getByRole("button", { name: "Anlegen" }).click();

  // The action counts as done and nothing was overwritten.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(npcCard.getByText("NPC angelegt")).toBeVisible();
  const after = await api.entry("npcs/fenn");
  expect(after.properties).toEqual(before.properties);
  expect(after.body).toBe(before.body);
});

test.describe("with yesterday's session, ended after midnight", () => {
  test.use({ seed: { entries: { "session-past-midnight": PAST_MIDNIGHT.entry } } });

  test("a session that ran past midnight is still the session review's session", async ({
    page,
    api,
  }) => {
    // The evening of yesterday was ENDED after midnight, so `ended` sits on
    // YESTERDAY's session and there is none for today at all: the server is
    // what names the session (GET /session?includeEnded=1), not the date.
    const yesterday = PAST_MIDNIGHT.id;

    await page.goto("/campaigns/beispiel/review");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session-Nachbereitung");
    const threadCard = page.locator("div").filter({ hasText: THREAD_TEXT }).last();
    await expect(threadCard).toBeVisible();
    await threadCard.getByRole("button", { name: "Als Handlungsstrang übernehmen" }).click();
    await expect(threadCard.getByText("Als Handlungsstrang übernommen")).toBeVisible();

    // The `reviewed` flag lands on the row of YESTERDAY's session — the one
    // the server named — and no session was invented for today.
    await expect
      .poll(async () => (await api.session(yesterday)).log.map((row) => row.reviewed))
      .toEqual([true]);
    expect(await api.sessionExists(todaySessionId())).toBe(false);
    await expect
      .poll(async () => (await api.threads("01-salzhafen")).entries.map((row) => row.text))
      .toContain(THREAD_TEXT);
  });
});
