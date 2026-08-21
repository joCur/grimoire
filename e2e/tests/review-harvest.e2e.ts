// Kritischer Pfad 5: Ernte — siehe CLAUDE.md.
//
// Thread übernehmen → _chapter.md, Inbox abhaken, NPC-Stub anlegen, und der
// Fortschrittszähler.
//
// Die Session von HEUTE ist die Datenlage der Ernte, deshalb legt der Test sie
// direkt in seine Kampagnen-Kopie (dieselben Zeilen, die die Live-Ansicht
// geschrieben hätte — Pfad 4 prüft das Schreiben selbst).

import { expect, test } from "../support/test";

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

test.beforeEach(async ({ files }) => {
  const rel = files.todaySession();
  await files.write(rel, sessionFile(rel.slice("sessions/".length, -".md".length)));
});

test("Faden übernehmen landet in _chapter.md, Inbox-Zeile wird abgehakt", async ({
  page,
  files,
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
  await threadCard.getByRole("button", { name: "Als Faden übernehmen" }).click();

  await expect(threadCard.getByText("Als Faden übernommen")).toBeVisible();
  await expect(progress).toHaveText("1 von 4 gesichtet");
  // The thread list shows the new item with the "neu" chip.
  await expect(page.getByText("neu", { exact: true })).toBeVisible();

  // On disk: the chapter file gained the checklist item …
  await expect
    .poll(() => files.read("01-salzhafen/_chapter.md"))
    .toContain(`- [ ] ${THREAD_TEXT}`);
  // … and the source line is marked as seen via its short hash.
  await expect.poll(() => files.read(files.todaySession())).toContain("reviewed:");

  // --- tick off the inbox line --------------------------------------------
  const inboxCard = page.locator("div").filter({ hasText: INBOX_TEXT }).last();
  await expect(inboxCard).toContainText("Inbox");
  await inboxCard.getByRole("button", { name: "Verwerfen" }).click();

  await expect(inboxCard.getByText("Verworfen")).toBeVisible();
  await expect(progress).toHaveText("2 von 4 gesichtet");
  await expect
    .poll(() => files.read("inbox.md"))
    .toMatch(/- \[x\] 2026-01-10 Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug #thread/);

  // "Fertig" goes back to the pool.
  await page.getByRole("button", { name: "Fertig — zurück zum Pool" }).click();
  await expect(page).toHaveURL(/\/beispiel$/);
  // The pool's quiet review affordance counts what is still open.
  await expect(page.getByRole("link", { name: "Review · 2 offen" })).toBeVisible();
});

test("NPC-Stub aus einer #npc-Zeile anlegen", async ({ page, files }) => {
  await page.goto("/beispiel/review");

  const npcCard = page.locator("div").filter({ hasText: NPC_TEXT }).last();
  await npcCard.getByRole("button", { name: "NPC-Stub anlegen" }).click();

  // The dialog proposes id and name from the log text.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("NPC-Stub anlegen");
  await expect(dialog.getByRole("textbox").first()).toHaveValue("old-metta");
  await expect(dialog.getByRole("textbox").nth(1)).toHaveValue("Old Metta");
  await dialog.getByRole("button", { name: "Anlegen" }).click();

  await expect(npcCard.getByText("NPC-Stub angelegt")).toBeVisible();
  const stub = await files.read("npcs/old-metta.md");
  expect(stub).toContain("id: old-metta");
  expect(stub).toContain("name: Old Metta");
  expect(stub).toContain("status: alive");
  expect(stub).toContain("## Notizen");
  expect(stub).toContain(NPC_TEXT);

  // The new NPC is in the tree right away (list page, search index).
  await page.goto("/beispiel/list/npcs");
  await expect(page.getByRole("link", { name: /Old Metta/ })).toBeVisible();
});
