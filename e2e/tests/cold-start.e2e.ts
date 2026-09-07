// Critical path 10: Kaltstart — see CLAUDE.md.
//
// The whole point of issue #56: a fresh installation is not a dead end. Since
// issue #79 the boot imports nothing, so THIS is what a new instance looks
// like — `seed: { skip: true }`, an empty database, no campaign at all — and
// the path from there to a playable evening has to run entirely in the UI:
//
//   "/" → Kampagne anlegen → Kapitel anlegen → Szene anlegen → Szene befüllen
//        → Session starten → die Szene ist in der Live-Ansicht nutzbar
//
// Nothing here uses the `api` fixture's default campaign: this spec CREATES
// the campaign, so its id is only known at runtime and the helper is built
// with `apiFor(server.url, id)` — the same reason no spec spells out a
// session id.
//
// The two other create surfaces get their own tests below: the NPC/Ort lists
// (including the collision, which is the one branch that must not write) and
// the same lists at 390px, because "NPC/Ort anlegen" is the mobile half of
// the ticket.

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
  // Not "keine Kampagne gefunden, bitte grimoire seed": a shell command is a
  // dead end for the person the tool is for (issue #56).
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Willkommen bei Grimoire");
  expect(await api.get<unknown[]>("campaigns")).toEqual([]);

  // --- Kampagne anlegen -----------------------------------------------------
  await page.getByLabel("Name der Kampagne").fill(CAMPAIGN_NAME);
  // The id is DERIVED and shown before it is created — it is permanent, so it
  // is never a surprise. Umlaut included: „Küste" → `kueste`.
  await expect(page.getByText(`id: ${CAMPAIGN_ID}`)).toBeVisible();
  await page.getByLabel("Beschreibung (optional)").fill("Ein erloschener Leuchtturm.");
  await page.getByRole("button", { name: "Kampagne anlegen" }).click();

  // Straight into the (empty) pool of the new campaign.
  await expect(page).toHaveURL(new RegExp(`/${CAMPAIGN_ID}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_NAME);
  const campaignDoc = await api.file("_campaign");
  expect(campaignDoc.properties.name).toBe(CAMPAIGN_NAME);

  // The empty pool names the NEXT STEP instead of the generator (which needs
  // an API key and source material — the old dead end).
  await expect(page.getByText("Noch keine Kapitel", { exact: false })).toBeVisible();

  // --- Kapitel anlegen ------------------------------------------------------
  // Two triggers carry this label (the quiet header one and the empty state's
  // button); either opens the same dialog.
  await page.getByRole("button", { name: "Kapitel anlegen" }).last().click();
  await page.getByLabel("Titel").fill("01 Salzhafen");
  await expect(page.getByText("01-salzhafen", { exact: true })).toBeVisible();
  await page
    .getByLabel("Ziel des Kapitels (optional)")
    .fill("Herausfinden, warum das Leuchtfeuer erloschen ist.");
  await page.getByRole("button", { name: "Anlegen" }).click();

  // The pool lists it, with the goal line the dialog wrote.
  const chapter = page.getByRole("button", { name: /01 Salzhafen/ });
  await expect(chapter).toBeVisible();
  await expect(chapter).toContainText("keine Szenen");
  const chapterDoc = await api.file("01-salzhafen/_chapter");
  expect(chapterDoc.body).toContain("## Ziel des Kapitels");
  await expect(
    page.getByText("Ziel: Herausfinden, warum das Leuchtfeuer erloschen ist."),
  ).toBeVisible();

  // --- Szene anlegen --------------------------------------------------------
  // The trigger sits INSIDE the chapter, which is what prefills the chapter:
  // the dialog asks for a title and nothing else.
  await page.getByRole("button", { name: "Szene anlegen" }).click();
  await page.getByLabel("Titel").fill("Ankunft am Leuchtturm");
  await expect(page.getByText("01-salzhafen/ankunft-am-leuchtturm", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Anlegen" }).click();

  // A new scene OPENS IN THE EDITOR — an empty scene is there to be written.
  await expect(page).toHaveURL(/\/01-salzhafen\/ankunft-am-leuchtturm$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(page.getByRole("button", { name: "Speichern" })).toBeVisible();
  // …and it is a draft, as every new scene is.
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Entwurf" })).toBeVisible();

  // --- Szene befüllen -------------------------------------------------------
  await page.getByRole("button", { name: "Roh", exact: true }).click();
  await page.getByRole("textbox", { name: /^Markdown-Text von/ }).fill(SCENE_BODY);
  await page.getByRole("button", { name: "Speichern" }).click();

  // Rendered, and stored: the callout is a box, not a quote.
  await expect(page.getByRole("button", { name: "Bearbeiten" })).toBeVisible();
  await expect(page.getByRole("article")).toContainText(
    "Der Turm steht schwarz gegen den Abendhimmel.",
  );
  const sceneDoc = await api.file("01-salzhafen/ankunft-am-leuchtturm");
  expect(sceneDoc.body).toContain("[!readaloud]");
  expect(sceneDoc.properties.status).toBe("draft");

  // --- Session starten, Szene live nutzen -----------------------------------
  expect(await api.sessionPath()).toBeUndefined();
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(new RegExp(`/${CAMPAIGN_ID}/live$`));
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
    expect(await api.raw(sessionPath)).toContain(note);
  }).toPass();
  // The note carried the scene, so the session knows what was played.
  expect(await api.raw(sessionPath)).toContain("ankunft-am-leuchtturm");
});

test("NPC und Ort entstehen in ihren Listen; eine Kollision schreibt nichts", async ({
  page,
  server,
}) => {
  const api = apiFor(server.url, CAMPAIGN_ID);
  await page.goto("/");
  await page.getByLabel("Name der Kampagne").fill(CAMPAIGN_NAME);
  await page.getByRole("button", { name: "Kampagne anlegen" }).click();
  await expect(page).toHaveURL(new RegExp(`/${CAMPAIGN_ID}$`));

  // --- NPC anlegen ----------------------------------------------------------
  await page.goto(`/${CAMPAIGN_ID}/list/npcs`);
  await expect(page.getByText("Noch keine NPCs.")).toBeVisible();
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  await page.getByLabel("Name").fill("Hafenmeisterin Jorna");
  await expect(page.getByText("npcs/hafenmeisterin-jorna", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Anlegen" }).click();

  // The dialog only ever asks for a name — the reading view opens, and the
  // rest of the fields live in „Eigenschaften" (issue #42).
  await expect(page).toHaveURL(/\/npcs\/hafenmeisterin-jorna$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  await expect(page.getByRole("button", { name: "Eigenschaften" })).toBeVisible();
  expect((await api.file("npcs/hafenmeisterin-jorna")).properties.name).toBe(
    "Hafenmeisterin Jorna",
  );

  // --- the collision --------------------------------------------------------
  // Same name again: the id is taken, so nothing is written and the dialog
  // says what is in the way — plus the free proposal as ONE click. No silent
  // `-2`: an id is permanent, so the DM decides.
  await page.goto(`/${CAMPAIGN_ID}/list/npcs`);
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  await page.getByLabel("Name").fill("Hafenmeisterin Jorna");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("gibt es schon", { exact: false })).toBeVisible();
  // Still exactly one entry — the 409 wrote nothing.
  expect(await api.exists("npcs/hafenmeisterin-jorna-2")).toBe(false);

  await page.getByRole("button", { name: /„hafenmeisterin-jorna-2" verwenden/ }).click();
  await expect(page).toHaveURL(/\/npcs\/hafenmeisterin-jorna-2$/);
  // The NAME is the one that was typed; only the id came from the proposal.
  expect((await api.file("npcs/hafenmeisterin-jorna-2")).properties.name).toBe(
    "Hafenmeisterin Jorna",
  );

  // --- Ort anlegen ----------------------------------------------------------
  await page.goto(`/${CAMPAIGN_ID}/list/locations`);
  await page.getByRole("button", { name: "Ort anlegen" }).click();
  await page.getByLabel("Name").fill("Hafenviertel");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(/\/locations\/hafenviertel$/);
  expect((await api.file("locations/hafenviertel")).properties.name).toBe("Hafenviertel");
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
  // Touch target (Qualitäts-Boden) and inside the viewport.
  const box = await submit.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  await submit.click();
  await expect(page).toHaveURL(new RegExp(`/${CAMPAIGN_ID}$`));

  // The mobile start surface reaches the lists ("Nachschlagen"), and the list
  // is where an NPC is created — the mobile half of issue #56.
  await page.getByRole("link", { name: /NPCs/ }).click();
  await expect(page).toHaveURL(/\/list\/npcs$/);
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  await page.getByLabel("Name").fill("Alte Fischerin");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(/\/npcs\/alte-fischerin$/);
  expect((await api.file("npcs/alte-fischerin")).properties.name).toBe("Alte Fischerin");
});
