// Critical path 5: the harvest ("Ernte"); see CLAUDE.md.
//
// Adopt a thread → _chapter.md, tick off an inbox line, create an NPC stub,
// and the progress counter.
//
// TODAY's session is the harvest's data, so it is SEEDED into the markdown
// tree the test's database is imported from (the same lines the live view
// would have written — path 4 covers the writing itself).
//
// Issue #34 touches this path too: the source chip of a log line names the
// SCENE by its title (resolved via the tree), not by the id in the log line.

import { expect, test, todaySessionId, todaySessionPath } from "../support/test";

const THREAD_LINE = "- 22:40 — Cliffhanger: Lichter in der Bucht gesichtet #thread";
const THREAD_TEXT = "Cliffhanger: Lichter in der Bucht gesichtet";
const NPC_TEXT = 'Improvisiert: Fischerin "Old Metta" am Steg';
const INBOX_TEXT = "Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug";

/** Today's session with the three tagged log lines the review harvests. */
function sessionFile(id: string): string {
  return `---
id: ${id}
started: ${id}T19:30
ended: ${id}T22:45
scenes_played: [lighthouse-arrival]
---

## Log

- 19:52 (lighthouse-arrival) Spuren gefunden, Gruppe will sofort zur Bucht #decision
- 21:10 (lighthouse-arrival) ${NPC_TEXT} #npc
${THREAD_LINE}
`;
}

test.use({ seed: { files: { [todaySessionPath()]: sessionFile(todaySessionId()) } } });

/**
 * The evening of YESTERDAY, ENDED after midnight: `ended` sits in yesterday's
 * file and there is no file for today at all. The describe block below imports
 * ONLY this one.
 */
const PAST_MIDNIGHT = (() => {
  const today = todaySessionId();
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    path: `sessions/${yesterday}.md`,
    content: `---\nid: ${yesterday}\nstarted: ${yesterday}T21:30\nended: ${today}T01:40\nscenes_played: [lighthouse-arrival]\n---\n\n## Log\n\n${THREAD_LINE}\n`,
  };
})();

test("adopting a thread lands in _chapter.md, the inbox line gets ticked off", async ({
  page,
  api,
}) => {
  await page.goto("/beispiel/review");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fünf Minuten Ernte");

  // The topbar carries the harvest progress (the page repeats it below md).
  const progress = page.getByRole("banner").getByText(/von \d+ gesichtet/);

  // Three tagged log lines + the tagged inbox line from examples/beispiel.
  await expect(progress).toHaveText("0 von 4 gesichtet");
  await expect(page.getByText("Noch keine offenen Fäden in diesem Kapitel.")).toHaveCount(0);
  // The chapter already carries one open thread.
  await expect(page.getByText("Wer bezahlt die Schmuggler?")).toBeVisible();

  // --- adopt the #thread log line -----------------------------------------
  const threadCard = page.locator("div").filter({ hasText: THREAD_TEXT }).last();
  // This line was logged without a scene marker, so the chip stays bare
  // (issue #34 — the scene part only appears when the line names one).
  await expect(threadCard.getByText("Log", { exact: true })).toBeVisible();
  await threadCard.getByRole("button", { name: "Als Faden übernehmen" }).click();

  await expect(threadCard.getByText("Als Faden übernommen")).toBeVisible();
  await expect(progress).toHaveText("1 von 4 gesichtet");
  // The thread list shows the new item with the "neu" chip.
  await expect(page.getByText("neu", { exact: true })).toBeVisible();

  // On disk: the chapter file gained the checklist item …
  await expect
    .poll(() => api.raw("01-salzhafen/_chapter.md"))
    .toContain(`- [ ] ${THREAD_TEXT}`);
  // … and the source line is marked as seen via its short hash.
  await expect.poll(() => api.raw(todaySessionPath())).toContain("reviewed:");

  // --- tick off the inbox line --------------------------------------------
  const inboxCard = page.locator("div").filter({ hasText: INBOX_TEXT }).last();
  await expect(inboxCard).toContainText("Inbox");
  await inboxCard.getByRole("button", { name: "Verwerfen" }).click();

  await expect(inboxCard.getByText("Verworfen")).toBeVisible();
  await expect(progress).toHaveText("2 von 4 gesichtet");
  await expect
    .poll(() => api.raw("inbox.md"))
    .toMatch(/- \[x\] 2026-01-10 Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug #thread/);

  // "Fertig" goes back to the pool.
  await page.getByRole("button", { name: "Fertig — zurück zum Pool" }).click();
  await expect(page).toHaveURL(/\/beispiel$/);
  // The pool's quiet review affordance counts what is still open.
  await expect(page.getByRole("link", { name: "Review · 2 offen" })).toBeVisible();
});

test("creating an NPC entry from a #npc log line", async ({ page, api }) => {
  await page.goto("/beispiel/review");

  const npcCard = page.locator("div").filter({ hasText: NPC_TEXT }).last();
  // The source chip names the SCENE the line was logged under, resolved from
  // the tree — never the `(lighthouse-arrival)` id of the log line (issue #34).
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
  const stub = await api.raw("npcs/old-metta.md");
  expect(stub).toContain("id: old-metta");
  expect(stub).toContain("name: Old Metta");
  // The log line said nothing about the NPC's state, so the entry claims
  // nothing either (issue #70 — it used to write "alive").
  expect(stub).toContain("status: unknown");
  expect(stub).toContain("## Notizen");
  expect(stub).toContain(NPC_TEXT);

  // The new NPC is in the tree right away (list page, search index).
  await page.goto("/beispiel/list/npcs");
  await expect(page.getByRole("link", { name: /Old Metta/ })).toBeVisible();
});

test("an id that already has an entry is linked, not refused (#70)", async ({ page, api }) => {
  // The file era answered 409 here and made the DM correct an id that was
  // right. The call is idempotent now: the entry stands, untouched.
  const before = await api.raw("npcs/fenn.md");
  await page.goto("/beispiel/review");

  const npcCard = page.locator("div").filter({ hasText: NPC_TEXT }).last();
  await npcCard.getByRole("button", { name: "NPC anlegen" }).click();
  const dialog = page.getByRole("dialog");
  const idField = dialog.getByRole("textbox").first();
  await idField.fill("fenn");
  await dialog.getByRole("button", { name: "Anlegen" }).click();

  // The action counts as done and nothing was overwritten.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(npcCard.getByText("NPC angelegt")).toBeVisible();
  expect(await api.raw("npcs/fenn.md")).toBe(before);
});

test.describe("with yesterday's session, ended after midnight", () => {
  test.use({ seed: { files: { [PAST_MIDNIGHT.path]: PAST_MIDNIGHT.content } } });

  test("a session that ran past midnight is still the harvest (issue #40 review)", async ({
    page,
    api,
  }) => {
    // The evening of yesterday was ENDED after midnight, so `ended` sits in
    // YESTERDAY's file and there is no file for today at all. The review used
    // to look at `sessions/<today>.md` and found nothing to harvest; now the
    // server names the session (GET /session?includeEnded=1).
    const rel = PAST_MIDNIGHT.path;

    await page.goto("/beispiel/review");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fünf Minuten Ernte");
    const threadCard = page.locator("div").filter({ hasText: THREAD_TEXT }).last();
    await expect(threadCard).toBeVisible();
    await threadCard.getByRole("button", { name: "Als Faden übernehmen" }).click();
    await expect(threadCard.getByText("Als Faden übernommen")).toBeVisible();

    // The `reviewed` hash lands in YESTERDAY's file — the one the session
    // actually lives in — and no file was invented for today.
    await expect.poll(() => api.raw(rel)).toContain("reviewed:");
    expect(await api.exists(todaySessionPath())).toBe(false);
    await expect
      .poll(() => api.raw("01-salzhafen/_chapter.md"))
      .toContain(`- [ ] ${THREAD_TEXT}`);
  });
});
