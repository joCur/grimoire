// Critical path 5: the session review ("Nachbereitung", formerly "Ernte" —
// the harvest metaphor survives only in file names and code); see CLAUDE.md.
//
// Adopt a thread → chapter, tick off an inbox line, create an NPC stub,
// and the progress counter.
//
// TODAY's session is the harvest's data, so it is SEEDED as an entry of its
// own (the same lines the live view would have written — path 4 covers the
// writing itself).
//
// The source chip of a log line names the SCENE by its title (resolved via
// the tree), not by the id in the log line.

import {
  expect,
  test,
  todaySessionId,
  todaySessionPath,
  type SeedEntry,
} from "../support/test";

const THREAD_LINE = "- 22:40 — Cliffhanger: Lichter in der Bucht gesichtet #thread";
const THREAD_TEXT = "Cliffhanger: Lichter in der Bucht gesichtet";
const NPC_TEXT = 'Improvisiert: Fischerin „Old Metta“ am Steg';
const INBOX_TEXT = "Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug";
/** An idea thrown in on the go — no hashtag at all. */
const NOTE_TEXT = "Die Laternen am Kai brennen bei Ebbe nie";
/** A note ABOUT a player character — `#pc` plus the name tag. */
const PC_TEXT = "Geburtstags-Item für Kaela vorbereiten";

/** Today's session with the three tagged log lines the review harvests. */
function sessionEntry(id: string): SeedEntry {
  return {
    kind: "session",
    properties: {
      id,
      started: `${id}T19:30`,
      ended: `${id}T22:45`,
      scenes_played: ["lighthouse-arrival"],
    },
    log: [
      {
        raw: "- 19:52 (lighthouse-arrival) Spuren gefunden, Gruppe will sofort zur Bucht #decision",
      },
      { raw: `- 21:10 (lighthouse-arrival) ${NPC_TEXT} #npc` },
      { raw: THREAD_LINE },
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
      started: `${yesterday}T21:30`,
      ended: `${today}T01:40`,
      scenes_played: ["lighthouse-arrival"],
    },
    log: [{ raw: THREAD_LINE }],
    body: "",
  };
  return { path: `sessions/${yesterday}`, entry };
})();

test("adopting a thread lands in the chapter, the inbox line gets ticked off", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel/review");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session-Nachbereitung");

  // The topbar carries the harvest progress (the page repeats it below md).
  const progress = page.getByRole("banner").getByText(/von \d+ gesichtet/);

  // Three tagged log lines + the tagged inbox line of the example campaign.
  await expect(progress).toHaveText("0 von 4 gesichtet");
  await expect(page.getByText("Noch keine offenen Handlungsstränge in diesem Kapitel.")).toHaveCount(0);
  // The chapter already carries one open thread.
  await expect(page.getByText("Wer bezahlt die Schmuggler?")).toBeVisible();

  // --- adopt the #thread log line -----------------------------------------
  const threadCard = page.locator("div").filter({ hasText: THREAD_TEXT }).last();
  // This line was logged without a scene marker, so the chip stays bare
  // (the scene part only appears when the line names one).
  await expect(threadCard.getByText("Log", { exact: true })).toBeVisible();
  await threadCard.getByRole("button", { name: "Als Handlungsstrang übernehmen" }).click();

  await expect(threadCard.getByText("Als Handlungsstrang übernommen")).toBeVisible();
  await expect(progress).toHaveText("1 von 4 gesichtet");
  // The thread list shows the new item with the "neu" chip.
  await expect(page.getByText("neu", { exact: true })).toBeVisible();

  // Stored: the chapter gained the checklist item …
  await expect
    .poll(() => api.body("01-salzhafen"))
    .toContain(`- [ ] ${THREAD_TEXT}`);
  // … and the source line is marked as seen via its short hash.
  await expect.poll(() => api.properties(todaySessionPath())).toHaveProperty("reviewed");

  // --- tick off the inbox line --------------------------------------------
  const inboxCard = page.locator("div").filter({ hasText: INBOX_TEXT }).last();
  await expect(inboxCard.getByText("Idee", { exact: true })).toBeVisible();
  await inboxCard.getByRole("button", { name: "Verwerfen" }).click();

  await expect(inboxCard.getByText("Verworfen")).toBeVisible();
  await expect(progress).toHaveText("2 von 4 gesichtet");
  await expect
    .poll(() => api.body("inbox"))
    .toMatch(/- \[x\] 2026-01-10 Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug #thread/);

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
  await expect.poll(() => api.body("inbox")).toContain(`- ${NOTE_TEXT}`);

  // At the desk it shows up in the session review — in its own "Ungetaggte Einträge" section,
  // and counted with everything else (one source for page and topbar).
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
  // The line is ticked off in the inbox document itself.
  await expect.poll(() => api.body("inbox")).toContain(`- [x] ${NOTE_TEXT}`);

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
  // „Behalten" persists nothing — it is an honest toggle for this sitting.
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
  // The line is ticked off in the inbox document itself.
  await expect
    .poll(() => api.body("inbox"))
    .toContain(`- [x] ${PC_TEXT} #pc #kaela`);

  // Back at the desk the chapter overview affordance counts what is still open.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Fertig — zurück zu den Kapiteln" }).click();
  await expect(page.getByRole("link", { name: "Nachbereitung · 4 offen" })).toBeVisible();
});

test("creating an NPC entry from a #npc log line", async ({ page, api }) => {
  await page.goto("/campaigns/beispiel/review");

  const npcCard = page.locator("div").filter({ hasText: NPC_TEXT }).last();
  // The source chip names the SCENE the line was logged under, resolved from
  // the tree — never the `(lighthouse-arrival)` id of the log line.
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
  const stub = await api.file("npcs/old-metta");
  expect(stub.properties.id).toBe("old-metta");
  expect(stub.properties.name).toBe("Old Metta");
  // The log line said nothing about the NPC's state, so the entry claims
  // nothing either.
  expect(stub.properties.status).toBe("unknown");
  expect(stub.body).toContain("## Notizen");
  expect(stub.body).toContain(NPC_TEXT);

  // The new NPC is in the tree right away (list page, search index).
  await page.goto("/campaigns/beispiel/list/npcs");
  await expect(page.getByRole("link", { name: /Old Metta/ })).toBeVisible();
});

test("an id that already has an entry is linked, not refused", async ({ page, api }) => {
  // The call is idempotent: the entry stands, untouched.
  const before = await api.file("npcs/fenn");
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
  const after = await api.file("npcs/fenn");
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
    const rel = PAST_MIDNIGHT.path;

    await page.goto("/campaigns/beispiel/review");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session-Nachbereitung");
    const threadCard = page.locator("div").filter({ hasText: THREAD_TEXT }).last();
    await expect(threadCard).toBeVisible();
    await threadCard.getByRole("button", { name: "Als Handlungsstrang übernehmen" }).click();
    await expect(threadCard.getByText("Als Handlungsstrang übernommen")).toBeVisible();

    // The `reviewed` hash lands in YESTERDAY's session — the one that is
    // running — and no session was invented for today.
    await expect.poll(() => api.properties(rel)).toHaveProperty("reviewed");
    expect(await api.exists(todaySessionPath())).toBe(false);
    await expect
      .poll(() => api.body("01-salzhafen"))
      .toContain(`- [ ] ${THREAD_TEXT}`);
  });
});
