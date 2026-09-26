// Critical path 5: the session review; the harvest metaphor lives on in spec
// and identifier names only. See CLAUDE.md.
//
// Adopt a thread → a thread of the chapter, `POST …/threads`; tick off an
// idea → `PATCH …/ideas/:id { rev, done }`; create an NPC from a note — on
// the npc's own resource, `POST …/npcs` (decisions/resources) — and the progress counter.
// The threads themselves — their guard and the chapter overview that keeps
// them — are threads.e2e.ts.
//
// TODAY's session is the harvest's data, so it is SEEDED as a session of its
// own (the same rows the live view would have written — path 4 covers the
// writing itself).
//
// The review harvests the first session of the list (`GET …/sessions`,
// newest first) and writes each row on its own resource, with its own guard —
// a log entry with `PATCH …/sessions/:id/log/:logId { rev, reviewed }`, an
// idea with `PATCH …/ideas/:id { rev, done }` — and adopting a thread creates
// a thread of the chapter. So every assertion about
// what was harvested reads a row, not a rendered text, and the chapter's own
// text and `rev` stay exactly as they were.
//
// The source chip of a log row names the SCENE by its title (resolved via
// the tree), not by the row's `sceneId`.

import type { SessionSeed } from "@grimoire/shared/session";

import { expect, test } from "../support/test";
import { underCampaign, type Api } from "../support/api";
import { getChapter } from "../support/chapter";
import { getIdeas, ideaPath } from "../support/idea";
import { createNpc, getNpc, npcExists } from "../support/npc";
import {
  getSession,
  logEntryPath,
  sessionExists,
  todaySessionId,
} from "../support/session";
import { getThreads, patchThread, threadPath } from "../support/thread";

const THREAD_TEXT = "Cliffhanger: Lichter in der Bucht gesichtet";
const NPC_TEXT = 'Improvisiert: Fischerin „Old Metta“ am Steg';
const IDEA_TEXT = "Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug";
/** An idea thrown in on the go — no hashtag at all. */
const NOTE_TEXT = "Die Laternen am Kai brennen bei Ebbe nie";
/** A note ABOUT a player character — `#pc` plus the name tag. */
const PC_TEXT = "Geburtstags-Item für Kaela vorbereiten";

/** Today's session with the three tagged log rows the review harvests. */
function reviewedSession(id: string): SessionSeed {
  return {
    id,
    started: `${id}T19:30:00`,
    ended: `${id}T22:45:00`,
    body: "",
    pauses: [],
    log: [
      {
        id: "spuren",
        at: "19:52",
        sceneId: "lighthouse-arrival",
        text: "Spuren gefunden, Gruppe will sofort zur Bucht #decision",
        reviewed: false,
      },
      {
        id: "metta",
        at: "21:10",
        sceneId: "lighthouse-arrival",
        text: `${NPC_TEXT} #npc`,
        reviewed: false,
      },
      // No scene: the source chip of this row stays bare.
      { id: "lichter", at: "22:40", text: `${THREAD_TEXT} #thread`, reviewed: false },
    ],
  };
}

test.use({ seed: { sessions: [reviewedSession(todaySessionId())] } });

/**
 * The evening of YESTERDAY, ENDED after midnight: `ended` sits on yesterday's
 * session and there is no session for today at all.
 */
const PAST_MIDNIGHT = (() => {
  const today = todaySessionId();
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const session: SessionSeed = {
    id: yesterday,
    started: `${yesterday}T21:30:00`,
    ended: `${today}T01:40:00`,
    body: "",
    pauses: [],
    log: [{ id: "lichter", at: "22:40", text: `${THREAD_TEXT} #thread`, reviewed: false }],
  };
  return { id: yesterday, session };
})();

test("adopting a thread creates a thread of the chapter, the idea gets ticked off", async ({
  page,
  api,
}) => {
  const chapterBefore = await getChapter(api, "01-salzhafen");
  const threadsBefore = await getThreads(api, "01-salzhafen");
  await page.goto("/campaigns/beispiel/review");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session-Nachbereitung");

  // The topbar carries the harvest progress (the page repeats it below md).
  const progress = page.getByRole("banner").getByText(/von \d+ gesichtet/);

  // Three tagged log rows + the tagged idea of the example campaign.
  await expect(progress).toHaveText("0 von 4 gesichtet");
  await expect(page.getByText("Noch keine offenen Handlungsstränge in diesem Kapitel.")).toHaveCount(0);
  // The chapter already carries one open thread.
  await expect(page.getByText("Wer bezahlt die Schmuggler?")).toBeVisible();
  expect(threadsBefore.map((row) => row.text)).toEqual(["Wer bezahlt die Schmuggler?"]);

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

  // Stored: the chapter gained a THREAD at its end …
  await expect
    .poll(async () =>
      (await getThreads(api, "01-salzhafen")).map((row) => [row.text, row.done]),
    )
    .toEqual([
      ["Wer bezahlt die Schmuggler?", false],
      [THREAD_TEXT, false],
    ]);
  // … and the CHAPTER did not move: not its text, not its guard. Neither did
  // the thread that was there.
  const chapterAfter = await getChapter(api, "01-salzhafen");
  expect(chapterAfter.body).toBe(chapterBefore.body);
  expect(chapterAfter.rev).toBe(chapterBefore.rev);
  const [seededThread, adopted] = await getThreads(api, "01-salzhafen");
  expect(seededThread).toEqual(threadsBefore[0]);

  // The adopted thread is its own resource, flat, with its own guard.
  expect(adopted).toEqual({
    id: adopted!.id,
    chapter: "01-salzhafen",
    text: THREAD_TEXT,
    done: false,
    rev: 1,
  });
  const ticked = await patchThread(api, adopted!.id, { rev: adopted!.rev, done: true });
  expect(ticked).toEqual({ ...adopted, done: true, rev: 2 });
  expect((await getChapter(api, "01-salzhafen")).rev).toBe(chapterBefore.rev);
  const patchRaw = (id: string, body: unknown) =>
    api.fetch(threadPath(api, id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  // An id no thread has is 404 — never a quiet 200.
  expect((await patchRaw("no-such-thread", { rev: 1, done: true })).status).toBe(404);
  // A stale `rev` is 409, writes nothing and hands back the current thread.
  const stale = await patchRaw(adopted!.id, { rev: adopted!.rev, done: false });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "rev_conflict", thread: ticked });
  expect((await getThreads(api, "01-salzhafen")).at(-1)).toEqual(ticked);
  // … and the source ROW carries the flag: the review named it by the `id`
  // the log handed out, so exactly that row is marked and no other.
  await expect
    .poll(async () =>
      (await getSession(api, todaySessionId())).log
        .filter((row) => row.reviewed)
        .map((row) => row.text),
    )
    .toEqual([`${THREAD_TEXT} #thread`]);

  // --- tick off the idea ---------------------------------------------------
  const [ideaBefore] = await getIdeas(api);
  const ideaCard = page.locator("div").filter({ hasText: IDEA_TEXT }).last();
  await expect(ideaCard.getByText("Idee", { exact: true })).toBeVisible();
  await ideaCard.getByRole("button", { name: "Verwerfen" }).click();

  await expect(ideaCard.getByText("Verworfen")).toBeVisible();
  await expect(progress).toHaveText("2 von 4 gesichtet");
  // Ticking it off is a PATCH of the idea's `done` against its own guard.
  await expect
    .poll(async () => await getIdeas(api))
    .toEqual([{ ...ideaBefore, done: true, rev: ideaBefore!.rev + 1 }]);
  const [ideaAfter] = await getIdeas(api);
  const patchIdea = (body: unknown) =>
    api.fetch(ideaPath(api, ideaAfter!.id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  // A stale `rev` is 409 with the current idea, and writes nothing.
  const staleIdea = await patchIdea({ rev: ideaBefore!.rev, done: false });
  expect(staleIdea.status).toBe(409);
  expect(await staleIdea.json()).toMatchObject({ code: "rev_conflict", idea: ideaAfter });
  // An idea's text is written once: a PATCH naming it is a 400 that says so.
  const textPatch = await patchIdea({ rev: ideaAfter!.rev, text: "Umformuliert" });
  expect(textPatch.status).toBe(400);
  expect(await textPatch.text()).toContain("text");
  expect(await getIdeas(api)).toEqual([ideaAfter]);
  // The inbox and its tick-off action name nothing.
  expect((await api.fetch(underCampaign(api, "inbox"))).status).toBe(404);
  const inboxDone = await api.fetch(underCampaign(api, "review", "inbox-done"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: ideaAfter!.id }),
  });
  expect(inboxDone.status).toBe(404);

  // "Fertig" goes back to the chapters.
  await page.getByRole("button", { name: "Fertig — zurück zu den Kapiteln" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  // The chapter overview's quiet review affordance counts what is still open.
  await expect(page.getByRole("link", { name: "Nachbereitung · 2 offen" })).toBeVisible();
});

test("an untagged idea is reviewable and can be ticked off", async ({
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
  // The idea arrives as an idea of its own, at the end.
  await expect
    .poll(async () => (await getIdeas(api)).map((row) => row.text))
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
  // The IDEA is ticked off — and only that one.
  await expect
    .poll(async () =>
      (await getIdeas(api)).filter((row) => row.done).map((row) => row.text),
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
  // The IDEA is ticked off, hashtags and all — the text is stored as typed.
  await expect
    .poll(async () =>
      (await getIdeas(api)).filter((row) => row.done).map((row) => row.text),
    )
    .toEqual([`${PC_TEXT} #pc #kaela`]);

  // Back at the desk the chapter overview affordance counts what is still open.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Fertig — zurück zu den Kapiteln" }).click();
  await expect(page.getByRole("link", { name: "Nachbereitung · 4 offen" })).toBeVisible();
});

/** The description the review's „NPC anlegen" dialog opens with. */
const NPC_DIALOG_DESCRIPTION =
  "Legt einen neuen NPC mit dem Status „Unbekannt“ an und übernimmt diese Notiz als seinen Text. " +
  "Ist unter der Kennung schon ein leerer NPC angelegt, bekommt er die Notiz. " +
  "Hat ein NPC mit dieser Kennung schon Inhalt, wird nichts geschrieben, und die Notiz bleibt offen.";

/** The `reviewed` flag of today's `#npc` log row, read from the session. */
async function npcRowReviewed(api: Api): Promise<boolean | undefined> {
  const { log } = await getSession(api, todaySessionId());
  return log.find((row) => row.text === `${NPC_TEXT} #npc`)?.reviewed;
}

test("creating an NPC from a #npc log row", async ({ page, api }) => {
  await page.goto("/campaigns/beispiel/review");

  const npcCard = page.locator("div").filter({ hasText: NPC_TEXT }).last();
  // The source chip names the SCENE the row was logged under, resolved from
  // the tree — never the row's `sceneId`.
  await expect(npcCard.getByText("Log · Ankunft am Leuchtturm")).toBeVisible();
  await expect(npcCard.getByText("lighthouse-arrival")).toHaveCount(0);
  await npcCard.getByRole("button", { name: "NPC anlegen" }).click();

  // The dialog proposes id and name from the log text, and says what it
  // writes.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("NPC anlegen");
  await expect(dialog).toContainText(NPC_DIALOG_DESCRIPTION);
  await expect(dialog.getByRole("textbox").first()).toHaveValue("old-metta");
  await expect(dialog.getByRole("textbox").nth(1)).toHaveValue("Old Metta");
  await dialog.getByRole("button", { name: "Anlegen" }).click();

  await expect(npcCard.getByText("NPC angelegt")).toBeVisible();
  // The npc's own resource answers it — flat, no kind, no path, no
  // properties map (decisions/resources).
  const npc = await getNpc(api, "old-metta");
  expect(npc.id).toBe("old-metta");
  expect(npc.name).toBe("Old Metta");
  for (const key of ["kind", "path", "properties"]) {
    expect(Object.keys(npc)).not.toContain(key);
  }
  // The log row said nothing about the NPC's state, so the npc claims
  // nothing either.
  expect(npc.status).toBe("unknown");
  // The text IS the log line (its hashtags stripped) — no heading around it.
  expect(npc.body).toBe(`${NPC_TEXT}\n`);
  // …and the row is reviewed.
  await expect.poll(() => npcRowReviewed(api)).toBe(true);

  // The new NPC is in the list right away, linking to its own route.
  await page.goto("/campaigns/beispiel/npcs");
  await expect(page.getByRole("link", { name: /Old Metta/ })).toHaveAttribute(
    "href",
    "/campaigns/beispiel/npcs/old-metta",
  );
});

test("an EMPTY npc under the id gets the note", async ({ page, api }) => {
  // An npc created with nothing but its id — the DM prepared the name and
  // left it at that. The note fills it instead of colliding.
  const empty = await createNpc(api, { name: "old-metta" });
  expect(empty.body).toBe("");
  await page.goto("/campaigns/beispiel/review");

  const npcCard = page.locator("div").filter({ hasText: NPC_TEXT }).last();
  await npcCard.getByRole("button", { name: "NPC anlegen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox").first()).toHaveValue("old-metta");
  await dialog.getByRole("button", { name: "Anlegen" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(npcCard.getByText("NPC angelegt")).toBeVisible();
  const filled = await getNpc(api, "old-metta");
  expect(filled.name).toBe("Old Metta");
  expect(filled.body).toBe(`${NPC_TEXT}\n`);
  expect(filled.rev).toBe(empty.rev + 1);
  await expect.poll(() => npcRowReviewed(api)).toBe(true);
});

test("an id whose npc has content is refused — nothing written, the note stays open", async ({
  page,
  api,
}) => {
  const before = await getNpc(api, "fenn");
  await page.goto("/campaigns/beispiel/review");
  const progress = page.getByRole("banner").getByText(/von \d+ gesichtet/);
  await expect(progress).toHaveText("0 von 4 gesichtet");

  const npcCard = page.locator("div").filter({ hasText: NPC_TEXT }).last();
  await npcCard.getByRole("button", { name: "NPC anlegen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").first().fill("fenn");
  await dialog.getByRole("button", { name: "Anlegen" }).click();

  // The dialog stays open and says why, with the free id as a proposal.
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Den NPC „fenn“ gibt es schon, deshalb wurde die Notiz nicht übernommen. " +
      "Wähle eine andere Kennung, zum Beispiel „fenn-2“.",
  );

  // The server wrote nothing: the npc stands exactly as it was, and no
  // other npc appeared.
  const after = await getNpc(api, "fenn");
  expect(after).toEqual(before);
  expect(await npcExists(api, "fenn-2")).toBe(false);
  // …and the note is still OPEN: the row is not reviewed.
  expect(await npcRowReviewed(api)).toBe(false);

  // Closed without a second try (the modal hides the page behind it), the
  // count is unchanged and the card still offers its actions.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(progress).toHaveText("0 von 4 gesichtet");
  await expect(npcCard.getByText("NPC angelegt")).toHaveCount(0);
  await expect(npcCard.getByRole("button", { name: "NPC anlegen" })).toBeVisible();
  expect(await npcRowReviewed(api)).toBe(false);
});

test.describe("with yesterday's session, ended after midnight", () => {
  test.use({ seed: { sessions: [PAST_MIDNIGHT.session] } });

  test("a session that ran past midnight is still the session review's session", async ({
    page,
    api,
  }) => {
    // The evening of yesterday was ENDED after midnight, so `ended` sits on
    // YESTERDAY's session and there is none for today at all: the server is
    // what names the session (the first of `GET …/sessions`), not the date.
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
      .poll(async () => (await getSession(api, yesterday)).log.map((row) => row.reviewed))
      .toEqual([true]);
    expect(await sessionExists(api, todaySessionId())).toBe(false);
    await expect
      .poll(async () => (await getThreads(api, "01-salzhafen")).map((row) => row.text))
      .toContain(THREAD_TEXT);
  });
});

// --- the log entry is its own resource under its session ---------------------

test("a log entry is reviewed on its own resource: unknown id 404, stale rev 409, the old address 404", async ({
  api,
}) => {
  const id = todaySessionId();
  const sessionBefore = await getSession(api, id);
  const before = sessionBefore.log.find((row) => row.id === "metta");
  expect(before?.reviewed).toBe(false);
  const patchRaw = (logId: string, body: unknown) =>
    api.fetch(logEntryPath(api, id, logId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // Reviewing answers the ONE entry, with its guard moved on.
  const reviewed = await patchRaw("metta", { rev: before!.rev, reviewed: true });
  expect(reviewed.status).toBe(200);
  const entry = await reviewed.json();
  expect(entry).toEqual({ ...before, reviewed: true, rev: before!.rev + 1 });
  // An id the session does not hold is 404 — no silent 200.
  expect((await patchRaw("no-such-entry", { rev: 1, reviewed: true })).status).toBe(404);
  // A stale `rev` is 409, writes nothing and hands back the current entry.
  const stale = await patchRaw("metta", { rev: before!.rev, reviewed: false });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "rev_conflict", logEntry: entry });
  expect((await getSession(api, id)).log.find((row) => row.id === "metta")).toEqual(entry);
  // The note itself is written once: its text is no field of the PATCH.
  expect((await patchRaw("metta", { rev: entry.rev, text: "neu" })).status).toBe(400);

  // The action endpoint `review/seen` answers nothing.
  const seen = await api.fetch(`${underCampaign(api, "review", "seen")}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id, logId: "metta" }),
  });
  expect(seen.status).toBe(404);
  // …and the session's own guard never moved for it.
  expect((await getSession(api, id)).rev).toBe(sessionBefore.rev);
});

test("a log entry changed elsewhere: the card says so, nothing is written, the next click works", async ({
  page,
  api,
}) => {
  const id = todaySessionId();
  await page.goto("/campaigns/beispiel/review");
  const progress = page.getByRole("banner").getByText(/von \d+ gesichtet/);
  await expect(progress).toHaveText("0 von 4 gesichtet");
  const card = page.locator("div").filter({ hasText: "Spuren gefunden" }).last();
  await expect(card.getByRole("button", { name: "Verwerfen" })).toBeVisible();

  // Another writer moves the entry's guard, and the card is clicked in the
  // SAME turn, so the version poll cannot bring the fresh guard into the page
  // in between: the page still holds the `rev` it read, and the write is 409.
  const entry = (await getSession(api, id)).log.find((row) => row.id === "spuren")!;
  const written = await page.evaluate(
    async ({ url, body, text }) => {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const cards = [...document.querySelectorAll("div")].filter((div) =>
        div.textContent?.includes(text),
      );
      const button = [...(cards.at(-1)?.querySelectorAll("button") ?? [])].find(
        (candidate) => candidate.textContent === "Verwerfen",
      );
      button?.click();
      return res.status;
    },
    {
      url: api.url(logEntryPath(api, id, "spuren")),
      body: { rev: entry.rev, reviewed: false },
      text: "Spuren gefunden",
    },
  );
  expect(written).toBe(200);
  await expect(
    card.getByText("Diese Notiz wurde inzwischen anderswo geändert. Die Session ist neu geladen."),
  ).toBeVisible();
  // Nothing was written by the page: the entry is the other writer's.
  const after = (await getSession(api, id)).log.find((row) => row.id === "spuren")!;
  expect(after).toEqual({ ...entry, rev: entry.rev + 1 });
  await expect(progress).toHaveText("0 von 4 gesichtet");

  // The session was read again, so the next click carries the current guard.
  await card.getByRole("button", { name: "Verwerfen" }).click();
  await expect(card.getByText("Verworfen")).toBeVisible();
  await expect(progress).toHaveText("1 von 4 gesichtet");
  await expect
    .poll(async () => (await getSession(api, id)).log.find((row) => row.id === "spuren")?.reviewed)
    .toBe(true);
});
