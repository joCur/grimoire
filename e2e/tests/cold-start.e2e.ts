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
// write), the same lists at 390px, because creating one has to work on a
// phone, and the TOPBAR SWITCHER, where the SECOND campaign is created — it
// is the UI's only entry point for one.

import { apiFor, expect, test } from "../support/test";

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
  const campaignDoc = await api.entry("campaign");
  expect(campaignDoc.properties.name).toBe(CAMPAIGN_NAME);

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
  await expect(page.getByText("01-salzhafen", { exact: true })).toBeVisible();
  await page
    .getByLabel("Ziel des Kapitels (optional)")
    .fill("Herausfinden, warum das Leuchtfeuer erloschen ist.");
  await page.getByRole("button", { name: "Anlegen" }).click();

  // The chapter overview lists it, with the goal line the dialog wrote.
  const chapter = page.getByRole("button", { name: /01 Salzhafen/ });
  await expect(chapter).toBeVisible();
  await expect(chapter).toContainText("keine Szenen");
  const chapterDoc = await api.entry("01-salzhafen");
  expect(chapterDoc.body).toContain("## Ziel des Kapitels");
  await expect(
    page.getByText("Ziel: Herausfinden, warum das Leuchtfeuer erloschen ist."),
  ).toBeVisible();

  // --- create the scene -----------------------------------------------------
  // The trigger sits INSIDE the chapter, which is what prefills the chapter:
  // the dialog asks for a title and nothing else.
  await page.getByRole("button", { name: "Szene anlegen" }).click();
  const sceneTitle = page.getByLabel("Titel");
  await expect(sceneTitle).toHaveAttribute("placeholder", "Titel der Szene");
  await sceneTitle.fill("Ankunft am Leuchtturm");
  await expect(page.getByText("01-salzhafen/ankunft-am-leuchtturm", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Anlegen" }).click();

  // A new scene OPENS IN THE EDITOR — an empty scene is there to be written.
  await expect(page).toHaveURL(/\/01-salzhafen\/ankunft-am-leuchtturm$/);
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
  const sceneDoc = await api.entry("01-salzhafen/ankunft-am-leuchtturm");
  expect(sceneDoc.body).toContain("[!readaloud]");
  expect(sceneDoc.properties.status).toBe("draft");

  // --- start the session, use the scene live --------------------------------
  expect(await api.sessionPath()).toBeUndefined();
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/live$`));
  expect(await api.sessionPath()).toMatch(/^sessions\/.+$/);

  // The scene created three steps ago is the live view's default selection,
  // its text is on screen, and a quick note lands in the session's log.
  const nav = page.getByRole("navigation", { name: "Szenen der Session" });
  await expect(nav).toContainText("01 Salzhafen");
  await expect(nav.getByRole("button", { name: /Ankunft am Leuchtturm/ })).toBeVisible();
  // `.last()`: the live view's own center column is nested inside the app
  // shell's <main>, and the responsive mobile note is in the DOM either way.
  await expect(page.getByRole("main").last()).toContainText(
    "Der Turm steht schwarz gegen den Abendhimmel.",
  );

  const note = "Gruppe klopft an die Turmtür";
  await page.getByRole("textbox", { name: "Schnellnotiz" }).fill(note);
  await page.keyboard.press("Enter");
  const sessionPath = (await api.sessionPath()) ?? "";
  await expect(async () => {
    expect(await api.body(sessionPath)).toContain(note);
  }).toPass();
  // The note carried the scene, so the session knows what was played.
  expect(await api.body(sessionPath)).toContain("ankunft-am-leuchtturm");
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
  await page.goto(`/campaigns/${CAMPAIGN_ID}/list/npcs`);
  await expect(page.getByText("Noch keine NPCs.")).toBeVisible();
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  const npcName = page.getByLabel("Name");
  await expect(npcName).toHaveAttribute("placeholder", "Name des NPCs");
  await npcName.fill("Hafenmeisterin Jorna");
  await expect(page.getByText("npcs/hafenmeisterin-jorna", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Anlegen" }).click();

  // The dialog only ever asks for a name — the reading view opens, and the
  // rest of the fields live in the properties form.
  await expect(page).toHaveURL(/\/npcs\/hafenmeisterin-jorna$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  await expect(page.getByRole("button", { name: "Eigenschaften" })).toBeVisible();
  expect((await api.entry("npcs/hafenmeisterin-jorna")).properties.name).toBe(
    "Hafenmeisterin Jorna",
  );

  // --- the collision --------------------------------------------------------
  // Same name again: the id is taken, so nothing is written and the dialog
  // says what is in the way — plus the free proposal as ONE click. No silent
  // `-2`: an id is permanent, so the DM decides.
  await page.goto(`/campaigns/${CAMPAIGN_ID}/list/npcs`);
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  await page.getByLabel("Name").fill("Hafenmeisterin Jorna");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("existiert schon", { exact: false })).toBeVisible();
  // Still exactly one entry — the 409 wrote nothing.
  expect(await api.exists("npcs/hafenmeisterin-jorna-2")).toBe(false);

  await page.getByRole("button", { name: /„hafenmeisterin-jorna-2“ verwenden/ }).click();
  await expect(page).toHaveURL(/\/npcs\/hafenmeisterin-jorna-2$/);
  // The NAME is the one that was typed; only the id came from the proposal.
  expect((await api.entry("npcs/hafenmeisterin-jorna-2")).properties.name).toBe(
    "Hafenmeisterin Jorna",
  );

  // --- create the location --------------------------------------------------
  await page.goto(`/campaigns/${CAMPAIGN_ID}/list/locations`);
  await page.getByRole("button", { name: "Ort anlegen" }).click();
  const locationName = page.getByLabel("Name");
  await expect(locationName).toHaveAttribute("placeholder", "Name des Orts");
  await locationName.fill("Hafenviertel");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(/\/locations\/hafenviertel$/);
  expect((await api.entry("locations/hafenviertel")).properties.name).toBe("Hafenviertel");
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
  expect((await second.entry("campaign")).properties.name).toBe(SECOND_NAME);

  // Both campaigns are in the menu now, and the first one is untouched.
  await switcher.click();
  await expect(page.getByRole("menu")).toContainText(CAMPAIGN_NAME);
  await expect(page.getByRole("menu")).toContainText(SECOND_NAME);
  await expect(page.getByRole("menu")).toContainText("Nebel, Torf und ein Verschwundener.");
  expect((await first.entry("campaign")).properties.name).toBe(CAMPAIGN_NAME);

  // …and switching back works, which is what the menu was there for already.
  await page.getByRole("menu").getByRole("menuitem", { name: new RegExp(CAMPAIGN_NAME) }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));
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
  await expect(page).toHaveURL(/\/list\/npcs$/);
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  await page.getByLabel("Name").fill("Alte Fischerin");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(/\/npcs\/alte-fischerin$/);
  expect((await api.entry("npcs/alte-fischerin")).properties.name).toBe("Alte Fischerin");
});
