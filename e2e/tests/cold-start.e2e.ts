// Critical path 10: the cold start — see CLAUDE.md.
//
// A fresh installation is not a dead end. The boot imports nothing, so THIS
// is what a new instance looks like — `seed: { skip: true }`, an empty
// database, no campaign at all — and the path from there to a playable
// evening has to run entirely in the UI:
//
//   "/" → create the campaign → create a chapter → create a scene → fill the
//        scene → start a session → the scene is usable in the session view
//
// Nothing here uses the `api` fixture's default campaign: this spec CREATES
// the campaign, so its id is only known at runtime and the helper is built
// with `apiFor(server.url, id)` — the same reason no spec spells out a
// session id.
//
// The other create surfaces get their own tests below: the NPC and location
// lists (including the collision, which is the one branch that must not
// write), the ID LINE with its pencil — the create dialog is the one place an
// id may be personalised (ADR #21) — the same lists at 390px, because creating
// one has to work on a phone, and the TOPBAR SWITCHER, where the SECOND
// campaign is created — it is the UI's only entry point for one.

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";
import { apiFor } from "../support/api";
import { getCampaign } from "../support/campaign";
import { chapterExists, getChapter } from "../support/chapter";
import { getLocation } from "../support/location";
import { getNpc, npcExists, npcPath } from "../support/npc";
import { getScene, patchScene, scenePath } from "../support/scene";
import { getSession, runningSessionId } from "../support/session";

/**
 * The chapter overview's scene rows in DOM order, by the title they show.
 *
 * Read off the move controls: they carry the row's title in their accessible
 * name, and a row has no other handle that says where in the order it stands.
 */
async function shownSceneOrder(page: Page): Promise<string[]> {
  const labels = await page
    .getByRole("button", { name: /nach unten$/ })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  return labels.map((label) => label.replace(/^„|“ nach unten$/g, ""));
}

// An EMPTY instance for every test in this file — the honest starting point.
test.use({ seed: { skip: true } });

const CAMPAIGN_NAME = "Die Küste von Salzhafen";
const CAMPAIGN_ID = "die-kueste-von-salzhafen";

const SCENE_BODY = `## Flow

Die Gruppe erreicht den Fuß des Leuchtturms; das Feuer ist erloschen.

> [!readaloud] Der Turm steht schwarz gegen den Abendhimmel.
`;

test("Kaltstart: leere Instanz → Kampagne → Kapitel → Szene → in der Session nutzbar", async ({
  page,
  server,
}) => {
  const api = apiFor(server.url, CAMPAIGN_ID);

  // --- the empty instance ---------------------------------------------------
  // Not an error that asks for a seed command on the shell: a shell command
  // is a dead end for the person the tool is for.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Willkommen bei Grimoire");
  expect(await api.get<unknown[]>("campaigns")).toEqual([]);

  // --- create the campaign --------------------------------------------------
  // The hints are GENERIC: a fresh instance must not suggest the name of the
  // example campaign, which reads like a default.
  const nameField = page.getByLabel("Name der Kampagne");
  await expect(nameField).toHaveAttribute("placeholder", "Name der Kampagne");
  await nameField.fill(CAMPAIGN_NAME);
  // The id is DERIVED and shown before it is created — it is permanent, so it
  // is never a surprise. Umlaut included: `Küste` → `kueste`.
  await expect(page.getByText(`Kennung: ${CAMPAIGN_ID}`)).toBeVisible();
  await page.getByLabel("Beschreibung (optional)").fill("Ein erloschener Leuchtturm.");
  await page.getByRole("button", { name: "Kampagne anlegen" }).click();

  // Straight into the (empty) chapter overview of the new campaign.
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_NAME);
  // The campaign is its own resource: every field flat, the text among them.
  const created = await getCampaign(api);
  expect(created).toMatchObject({ id: CAMPAIGN_ID, name: CAMPAIGN_NAME, body: "" });
  expect(created.description).toBe("Ein erloschener Leuchtturm.");

  // The empty chapter overview names the NEXT STEP instead of the generator, which needs
  // an API key and source material.
  await expect(page.getByText("Noch keine Kapitel", { exact: false })).toBeVisible();

  // --- create the chapter ---------------------------------------------------
  // Two triggers carry this label (the quiet header one and the empty state's
  // button); either opens the same dialog.
  await page.getByRole("button", { name: "Kapitel anlegen" }).last().click();
  const chapterTitle = page.getByLabel("Titel");
  await expect(chapterTitle).toHaveAttribute("placeholder", "Titel des Kapitels");
  await chapterTitle.fill("01 Salzhafen");
  await expect(page.getByText("Kennung: 01-salzhafen", { exact: true })).toBeVisible();
  const description = page.getByLabel("Beschreibung (optional)");
  await expect(description).toHaveAttribute(
    "placeholder",
    "Worum es in diesem Kapitel geht und was die Gruppe erreichen soll",
  );
  await description.fill("Herausfinden, warum das Leuchtfeuer erloschen ist.");
  await page.getByRole("button", { name: "Anlegen" }).click();

  // The chapter overview lists it, with the text the dialog wrote: the
  // description as typed, no heading around it.
  const chapter = page.getByRole("button", { name: /01 Salzhafen/ });
  await expect(chapter).toBeVisible();
  await expect(chapter).toContainText("keine Szenen");
  // The chapter is its own resource: the description became its text, and it
  // starts planned.
  const createdChapter = await getChapter(api, "01-salzhafen");
  expect(createdChapter).toMatchObject({
    id: "01-salzhafen",
    title: "01 Salzhafen",
    status: "planned",
    body: "Herausfinden, warum das Leuchtfeuer erloschen ist.\n",
  });
  await expect(
    page.getByText("Herausfinden, warum das Leuchtfeuer erloschen ist.", { exact: true }),
  ).toBeVisible();

  // --- create the scene -----------------------------------------------------
  // The trigger sits INSIDE the chapter, which is what prefills the chapter:
  // the dialog asks for a title and nothing else.
  await page.getByRole("button", { name: "Szene anlegen" }).click();
  const sceneTitle = page.getByLabel("Titel");
  await expect(sceneTitle).toHaveAttribute("placeholder", "Titel der Szene");
  await sceneTitle.fill("Ankunft am Leuchtturm");
  await expect(page.getByText("Kennung: ankunft-am-leuchtturm", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Anlegen" }).click();

  // A new scene OPENS IN THE EDITOR, on its own route — an empty scene is
  // there to be written.
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/scenes/ankunft-am-leuchtturm$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(page.getByRole("button", { name: "Speichern" })).toBeVisible();
  // …and it is a draft, as every new scene is.
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Entwurf" })).toBeVisible();

  // --- fill the scene -------------------------------------------------------
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.getByRole("textbox", { name: /^Markdown-Text von/ }).fill(SCENE_BODY);
  await page.getByRole("button", { name: "Speichern" }).click();

  // Rendered, and stored: the callout is a box, not a quote.
  await expect(page.getByRole("button", { name: "Bearbeiten" })).toBeVisible();
  await expect(page.getByRole("article")).toContainText(
    "Der Turm steht schwarz gegen den Abendhimmel.",
  );
  const sceneDoc = await getScene(api, "ankunft-am-leuchtturm");
  expect(sceneDoc.body).toContain("[!readaloud]");
  expect(sceneDoc.status).toBe("draft");
  expect(sceneDoc.chapter).toBe("01-salzhafen");

  // --- a second scene goes to the END of the chapter ------------------------
  // The order is the DM's, and a new scene is appended to it (ADR #27). This
  // title sorts BEFORE the first one alphabetically, which is exactly what
  // must not decide anything: it lands behind it, where it was created.
  await page.goto(`/campaigns/${CAMPAIGN_ID}`);
  await page.getByRole("button", { name: "Szene anlegen" }).click();
  await page.getByLabel("Titel").fill("Abendessen bei Jorna");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(/\/scenes\/abendessen-bei-jorna$/);

  await page.goto(`/campaigns/${CAMPAIGN_ID}`);
  await expect
    .poll(() => shownSceneOrder(page))
    .toEqual(["Ankunft am Leuchtturm", "Abendessen bei Jorna"]);
  // …and that is the stored order, not a sorting of the display.
  const tree = await api.get<{ chapters: { id: string; scenes: { id: string }[] }[] }>(
    `campaigns/${CAMPAIGN_ID}/tree`,
  );
  expect(tree.chapters[0]?.scenes.map((scene) => scene.id)).toEqual([
    "ankunft-am-leuchtturm",
    "abendessen-bei-jorna",
  ]);

  // --- a change of chapter goes to the END of the target chapter -----------
  // A second chapter with a scene of its own; the first chapter's second
  // scene moves there through its field dialog and lands behind that scene.
  await api.send("POST", `campaigns/${CAMPAIGN_ID}/chapters`, { title: "Die Bucht", id: "02-bucht" });
  await api.send("POST", scenePath(api), { title: "Am Strand", chapter: "02-bucht" });
  await page.goto(`/campaigns/${CAMPAIGN_ID}/scenes/abendessen-bei-jorna`);
  await page.getByRole("button", { name: "Eigenschaften" }).click();
  const fields = page.getByRole("dialog");
  await fields.getByLabel("Kapitel").fill("02-bucht");
  await expect(fields.getByRole("paragraph").filter({ hasText: "Die Bucht" })).toBeVisible();
  await fields.getByRole("button", { name: "Speichern" }).click();
  await expect(fields).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Kontext" })).toContainText("Die Bucht");
  const moved = await api.get<{ chapters: { id: string; scenes: { id: string }[] }[] }>(
    `campaigns/${CAMPAIGN_ID}/tree`,
  );
  expect(moved.chapters.map((chapter) => chapter.scenes.map((scene) => scene.id))).toEqual([
    ["ankunft-am-leuchtturm"],
    ["am-strand", "abendessen-bei-jorna"],
  ]);
  // …and back, so the session below finds the chapter as it was: again the end.
  await patchScene(api, "abendessen-bei-jorna", { chapter: "01-salzhafen" });

  // --- start the session, use the scene live --------------------------------
  expect(await runningSessionId(api)).toBeUndefined();
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/live$`));
  expect(await runningSessionId(api)).toBeDefined();

  // The scene created three steps ago is the live view's default selection,
  // its text is on screen, and a quick note lands in the session's log.
  const nav = page.getByRole("navigation", { name: "Szenen der Session" });
  await expect(nav).toContainText("01 Salzhafen");
  await expect(nav.getByRole("button", { name: /Ankunft am Leuchtturm/ })).toBeVisible();
  // The session view reads the same order — the first scene is the open one.
  await expect(nav.getByRole("button")).toHaveText([
    /^Ankunft am Leuchtturm/,
    /^Abendessen bei Jorna/,
  ]);
  await expect(nav.getByRole("button", { name: /Ankunft am Leuchtturm/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  // `.last()`: the live view's own center column is nested inside the app
  // shell's <main>, and the responsive mobile note is in the DOM either way.
  await expect(page.getByRole("main").last()).toContainText(
    "Der Turm steht schwarz gegen den Abendhimmel.",
  );

  const note = "Gruppe klopft an die Turmtür";
  await page.getByRole("textbox", { name: "Schnellnotiz" }).fill(note);
  await page.keyboard.press("Enter");
  const sessionId = (await runningSessionId(api)) ?? "";
  await expect(async () => {
    const log = (await getSession(api, sessionId)).log;
    expect(log.map((row) => [row.text, row.sceneId])).toContainEqual([note, "ankunft-am-leuchtturm"]);
  }).toPass();
  // A note plays nothing; leaving the scene with a note in it does.
  expect((await getSession(api, sessionId)).playedScenes).toEqual([]);
  await page.getByRole("button", { name: "Nächste Szene: Abendessen bei Jorna" }).click();
  await expect(nav.getByRole("button", { name: /Abendessen bei Jorna/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect
    .poll(async () => (await getSession(api, sessionId)).playedScenes.map((row) => row.sceneId))
    .toEqual(["ankunft-am-leuchtturm"]);
});

test("NPC und Ort entstehen in ihren Listen; eine Kollision schreibt nichts", async ({
  page,
  server,
}) => {
  const api = apiFor(server.url, CAMPAIGN_ID);
  await page.goto("/");
  await page.getByLabel("Name der Kampagne").fill(CAMPAIGN_NAME);
  await page.getByRole("button", { name: "Kampagne anlegen" }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));

  // --- create the npc -------------------------------------------------------
  // The npc list is the npc's own route (ADR #31).
  await page.goto(`/campaigns/${CAMPAIGN_ID}/npcs`);
  await expect(page.getByText("Noch keine NPCs.")).toBeVisible();
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  const npcName = page.getByLabel("Name");
  await expect(npcName).toHaveAttribute("placeholder", "Name des NPCs");
  await npcName.fill("Hafenmeisterin Jorna");
  await expect(page.getByText("Kennung: hafenmeisterin-jorna", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Anlegen" }).click();

  // The dialog only ever asks for a name — the npc's reading view on its
  // own route opens, and the rest of the fields live in the properties form.
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/npcs/hafenmeisterin-jorna$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  await expect(page.getByRole("button", { name: "Eigenschaften" })).toBeVisible();
  // The create answers the npc itself: every field flat, no kind, no path,
  // no properties map (ADR #31).
  const created = await getNpc(api, "hafenmeisterin-jorna");
  expect(created.name).toBe("Hafenmeisterin Jorna");
  expect(created.status).toBe("unknown");
  expect(Object.keys(created).sort()).toEqual(["body", "id", "name", "rev", "status"]);
  // …and it lists on that route.
  await page.goto(`/campaigns/${CAMPAIGN_ID}/npcs`);
  await expect(page.getByRole("link", { name: /Hafenmeisterin Jorna/ })).toHaveAttribute(
    "href",
    `/campaigns/${CAMPAIGN_ID}/npcs/hafenmeisterin-jorna`,
  );

  // --- the collision --------------------------------------------------------
  // Same name again: the id is taken, so nothing is written and the dialog
  // says what is in the way — plus the free proposal as ONE click. No silent
  // `-2`: an id is permanent, so the DM decides.
  await page.goto(`/campaigns/${CAMPAIGN_ID}/npcs`);
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  await page.getByLabel("Name").fill("Hafenmeisterin Jorna");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("existiert schon", { exact: false })).toBeVisible();
  // Still exactly one npc — the 409 wrote nothing.
  expect(await npcExists(api, "hafenmeisterin-jorna-2")).toBe(false);
  expect(await getNpc(api, "hafenmeisterin-jorna")).toEqual(created);
  expect((await api.get<unknown[]>(npcPath(api))).length).toBe(1);

  await page.getByRole("button", { name: /„hafenmeisterin-jorna-2“ verwenden/ }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/npcs/hafenmeisterin-jorna-2$`));
  // The NAME is the one that was typed; only the id came from the proposal.
  expect((await getNpc(api, "hafenmeisterin-jorna-2")).name).toBe("Hafenmeisterin Jorna");

  // The same collision on the wire: 409 slug_taken with the next free id,
  // and nothing is written.
  const taken = await api.fetch(npcPath(api), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Jemand anderes", id: "hafenmeisterin-jorna" }),
  });
  expect(taken.status).toBe(409);
  expect(await taken.json()).toMatchObject({
    code: "slug_taken",
    id: "hafenmeisterin-jorna",
    suggestion: "hafenmeisterin-jorna-3",
  });
  expect((await getNpc(api, "hafenmeisterin-jorna")).name).toBe("Hafenmeisterin Jorna");
  expect(await npcExists(api, "hafenmeisterin-jorna-3")).toBe(false);

  // A key the create does not take is a 400 that names it, and writes nothing.
  const unknownField = await api.fetch(npcPath(api), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Holm", status: "alive" }),
  });
  expect(unknownField.status).toBe(400);
  expect(((await unknownField.json()) as { error: string }).error).toContain('"status"');
  expect(await npcExists(api, "holm")).toBe(false);

  // --- create the location --------------------------------------------------
  // The location list is the location's own route (ADR #31).
  await page.goto(`/campaigns/${CAMPAIGN_ID}/locations`);
  await page.getByRole("button", { name: "Ort anlegen" }).click();
  const locationName = page.getByLabel("Name");
  await expect(locationName).toHaveAttribute("placeholder", "Name des Orts");
  await locationName.fill("Hafenviertel");
  await page.getByRole("button", { name: "Anlegen" }).click();
  // The create answers the location itself, and its reading view is the
  // location's own route.
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/locations/hafenviertel$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenviertel");
  expect((await getLocation(api, "hafenviertel")).name).toBe("Hafenviertel");
  // …and it lists on that route.
  await page.goto(`/campaigns/${CAMPAIGN_ID}/locations`);
  await expect(page.getByRole("link", { name: /Hafenviertel/ })).toHaveAttribute(
    "href",
    `/campaigns/${CAMPAIGN_ID}/locations/hafenviertel`,
  );
});

test("die zweite Kampagne entsteht im Switcher der Topbar", async ({ page, server }) => {
  const SECOND_NAME = "Das Moor von Grauwacht";
  const SECOND_ID = "das-moor-von-grauwacht";
  const first = apiFor(server.url, CAMPAIGN_ID);
  const second = apiFor(server.url, SECOND_ID);

  // The first campaign comes from the cold start, as it always does.
  await page.goto("/");
  await page.getByLabel("Name der Kampagne").fill(CAMPAIGN_NAME);
  await page.getByRole("button", { name: "Kampagne anlegen" }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));

  // --- the switcher ---------------------------------------------------------
  const switcher = page.getByRole("banner").getByRole("button", { name: /^Kampagne: / });
  await switcher.click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText(CAMPAIGN_NAME);
  // No developer jargon and no replacement for it: no shell command anywhere
  // in the chrome.
  await expect(menu).not.toContainText("grimoire seed");
  await expect(menu).not.toContainText("Datenbank");

  // --- create a campaign, from the menu -------------------------------------
  await menu.getByRole("menuitem", { name: "Kampagne anlegen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Kampagne anlegen");
  const nameField = dialog.getByLabel("Name der Kampagne");
  // The very same dialog as the cold start: generic hint, derived id on screen
  // before anything is written, optional description.
  await expect(nameField).toHaveAttribute("placeholder", "Name der Kampagne");
  await nameField.fill(SECOND_NAME);
  await expect(dialog.getByText(`Kennung: ${SECOND_ID}`)).toBeVisible();
  await dialog.getByLabel("Beschreibung (optional)").fill("Nebel, Torf und ein Verschwundener.");
  await dialog.getByRole("button", { name: "Anlegen" }).click();

  // Success NAVIGATES into the new campaign — its own (empty) chapter overview.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/campaigns/${SECOND_ID}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SECOND_NAME);
  await expect(switcher).toHaveAccessibleName(`Kampagne: ${SECOND_NAME}`);
  expect((await getCampaign(second)).name).toBe(SECOND_NAME);

  // Both campaigns are in the menu now, and the first one is untouched.
  await switcher.click();
  await expect(page.getByRole("menu")).toContainText(CAMPAIGN_NAME);
  await expect(page.getByRole("menu")).toContainText(SECOND_NAME);
  await expect(page.getByRole("menu")).toContainText("Nebel, Torf und ein Verschwundener.");
  expect((await getCampaign(first)).name).toBe(CAMPAIGN_NAME);

  // …and switching back works, which is what the menu was there for already.
  await page.getByRole("menu").getByRole("menuitem", { name: new RegExp(CAMPAIGN_NAME) }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));
});

test("die Kennung lässt sich im Anlege-Dialog selbst setzen", async ({ page, server }) => {
  // The id is permanent (ADR #21), and the create dialog is the one place that
  // may personalise it. So the quiet preview line carries a pencil: it opens
  // as a field prefilled with the id on screen, the name stops feeding it once
  // something is typed, and an id the slug rule rejects never reaches the
  // server.
  const MANUAL_CAMPAIGN = "salzhafen";
  const api = apiFor(server.url, MANUAL_CAMPAIGN);
  await page.goto("/");

  // --- the very first id of an instance, set by hand ------------------------
  const campaignName = page.getByLabel("Name der Kampagne");
  await campaignName.fill(CAMPAIGN_NAME);
  await expect(page.getByText(`Kennung: ${CAMPAIGN_ID}`)).toBeVisible();
  // The pencil is a real button with a name, and toggling moves focus into the
  // field — the whole line is usable from the keyboard alone.
  await page.getByRole("button", { name: "Kennung selbst setzen" }).click();
  const campaignId = page.getByLabel("Kennung", { exact: true });
  await expect(campaignId).toBeFocused();
  await expect(campaignId).toHaveValue(CAMPAIGN_ID);

  // After the first manual character the name no longer feeds the id.
  await campaignId.fill("salzhafen-kueste");
  await campaignName.fill("Ganz anderer Titel");
  await expect(campaignId).toHaveValue("salzhafen-kueste");

  // An id the rule rejects is caught BEFORE the submit, and names the rule.
  await campaignId.fill("Salzhafen Küste!");
  await expect(
    page.getByText("Die Kennung braucht Kleinbuchstaben, Ziffern und einzelne Bindestriche."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Kampagne anlegen" })).toBeDisabled();

  // Emptying the field hands the id back to the name — the derivation of the
  // name as it stands NOW, not the one that was there before.
  await campaignId.fill("");
  await expect(campaignId).toHaveValue("ganz-anderer-titel");
  await campaignName.fill(CAMPAIGN_NAME);
  await expect(campaignId).toHaveValue(CAMPAIGN_ID);

  // The id the DM actually wants — short, and it is what gets created.
  await campaignId.fill(MANUAL_CAMPAIGN);
  await page.getByRole("button", { name: "Kampagne anlegen" }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${MANUAL_CAMPAIGN}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_NAME);
  expect((await getCampaign(api)).name).toBe(CAMPAIGN_NAME);

  // --- a chapter, with an id of its own -------------------------------------
  await page.getByRole("button", { name: "Kapitel anlegen" }).last().click();
  const chapterDialog = page.getByRole("dialog");
  await chapterDialog.getByLabel("Titel").fill("Erstes Kapitel");
  await expect(chapterDialog.getByText("Kennung: erstes-kapitel", { exact: true })).toBeVisible();
  await chapterDialog.getByRole("button", { name: "Kennung selbst setzen" }).click();
  const chapterId = chapterDialog.getByLabel("Kennung", { exact: true });
  await chapterId.fill("nummer-eins");

  // Pressing the pencil again is the other way back to automatic.
  await chapterDialog.getByRole("button", { name: "Kennung selbst setzen" }).click();
  await expect(chapterDialog.getByText("Kennung: erstes-kapitel", { exact: true })).toBeVisible();

  await chapterDialog.getByRole("button", { name: "Kennung selbst setzen" }).click();
  await chapterId.fill("01-salzhafen");
  await chapterDialog.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("button", { name: /Erstes Kapitel/ })).toBeVisible();
  expect(await chapterExists(api, "01-salzhafen")).toBe(true);
  // The derived id was never written — only the one that was typed.
  expect(await chapterExists(api, "erstes-kapitel")).toBe(false);

  // --- an NPC: the label stays in front, only the id is typed --------------
  await page.goto(`/campaigns/${MANUAL_CAMPAIGN}/npcs`);
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  const npcDialog = page.getByRole("dialog");
  await npcDialog.getByLabel("Name").fill("Hafenmeisterin Jorna");
  await expect(npcDialog.getByText("Kennung: hafenmeisterin-jorna", { exact: true })).toBeVisible();
  await npcDialog.getByRole("button", { name: "Kennung selbst setzen" }).click();
  const npcId = npcDialog.getByLabel("Kennung", { exact: true });
  await npcId.fill("jorna");
  // The label is context, outside the field.
  await expect(npcDialog.getByText("Kennung:", { exact: true })).toBeVisible();
  await expect(npcId).toHaveValue("jorna");
  await npcDialog.getByRole("button", { name: "Anlegen" }).click();

  // The typed id is the npc's id AND in the URL of its own route.
  await expect(page).toHaveURL(new RegExp(`/campaigns/${MANUAL_CAMPAIGN}/npcs/jorna$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  expect((await getNpc(api, "jorna")).name).toBe("Hafenmeisterin Jorna");
  // The derived id was never written — only the one that was typed.
  expect(await npcExists(api, "hafenmeisterin-jorna")).toBe(false);

  // --- a typed id that is TAKEN: the 409 path is unchanged -----------------
  // No silent `-2` here either: nothing is written, the dialog says what is in
  // the way and offers the free proposal as ONE click.
  await page.goto(`/campaigns/${MANUAL_CAMPAIGN}/npcs`);
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  await page.getByLabel("Name").fill("Hafenarbeiter Holm");
  await page.getByRole("button", { name: "Kennung selbst setzen" }).click();
  await page.getByLabel("Kennung", { exact: true }).fill("jorna");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("existiert schon", { exact: false })).toBeVisible();
  expect(await npcExists(api, "jorna-2")).toBe(false);
  expect((await getNpc(api, "jorna")).name).toBe("Hafenmeisterin Jorna");

  await page.getByRole("button", { name: /„jorna-2“ verwenden/ }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${MANUAL_CAMPAIGN}/npcs/jorna-2$`));
  // The NAME is the one that was typed; only the id came from the proposal.
  expect((await getNpc(api, "jorna-2")).name).toBe("Hafenarbeiter Holm");
});

test("Kaltstart und NPC anlegen funktionieren bei 390px", async ({ page, server }) => {
  const api = apiFor(server.url, CAMPAIGN_ID);
  await page.setViewportSize({ width: 390, height: 780 });

  // The cold-start surface is a page, not a dialog — which is exactly why it
  // works on a phone: no chrome to fit around it.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Willkommen bei Grimoire");
  await page.getByLabel("Name der Kampagne").fill(CAMPAIGN_NAME);
  const submit = page.getByRole("button", { name: "Kampagne anlegen" });
  // Touch target (quality floor) and inside the viewport.
  const box = await submit.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  await submit.click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));

  // The mobile start surface reaches the lists through its lookup section,
  // and the list is where an NPC is created.
  await page.getByRole("link", { name: /NPCs/ }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/npcs$`));
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  await page.getByLabel("Name").fill("Alte Fischerin");
  // The pencil works on a phone too: the line wraps instead of pushing the
  // dialog wider, and the field it opens takes focus.
  await page.getByRole("button", { name: "Kennung selbst setzen" }).click();
  const npcId = page.getByLabel("Kennung", { exact: true });
  await expect(npcId).toBeFocused();
  const idBox = await npcId.boundingBox();
  expect((idBox?.x ?? 0) + (idBox?.width ?? 0)).toBeLessThanOrEqual(390);
  await npcId.fill("fischerin");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/npcs/fischerin$`));
  expect((await getNpc(api, "fischerin")).name).toBe("Alte Fischerin");
});
