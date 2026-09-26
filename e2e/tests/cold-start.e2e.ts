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
// id may be personalised (decisions/constraints) — the same lists at 390px, because creating
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
import { ui } from "../support/ui";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The chapter overview's scene rows in DOM order, by the title they show.
 *
 * Read off the move controls: they carry the row's title in their accessible
 * name, and a row has no other handle that says where in the order it stands.
 */
async function shownSceneOrder(page: Page): Promise<string[]> {
  const marker = "\u0000";
  const [before = "", after = ""] = ui("chapterOverview.scene.moveDown.aria", {
    title: marker,
  }).split(marker);
  const labels = await page
    .getByRole("button", { name: new RegExp(`${escapeRegExp(after)}$`) })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  return labels
    .filter((label) => label.startsWith(before) && label.endsWith(after))
    .map((label) => label.slice(before.length, label.length - after.length));
}

/** The sentence a create dialog shows when the id it would write is taken. */
function npcTaken(id: string, suggestion: string): string {
  return ui("server.slug_taken", { kind: ui("server.kind.npc"), id, suggestion });
}

// An EMPTY instance for every test in this file — the honest starting point.
test.use({ seed: { skip: true } });

// The name carries an umlaut on purpose: the derived id transliterates it
// (`ü` → `ue`), which is part of what the create dialog shows.
const CAMPAIGN_NAME = "The Coast of Kühlhaven";
const CAMPAIGN_ID = "the-coast-of-kuehlhaven";

const CHAPTER_TITLE = "01 Saltmarsh";
const CHAPTER_ID = "01-saltmarsh";
const CHAPTER_DESCRIPTION = "Find out why the beacon went dark.";

const FIRST_SCENE = "Arrival at the lighthouse";
const FIRST_SCENE_ID = "arrival-at-the-lighthouse";
/** Sorts BEFORE FIRST_SCENE alphabetically, which must decide nothing. */
const SECOND_SCENE = "Abbey supper with Jorna";
const SECOND_SCENE_ID = "abbey-supper-with-jorna";

const READALOUD = "The tower stands black against the evening sky.";

const SCENE_BODY = `## Flow

The party reaches the foot of the lighthouse; the fire has gone out.

> [!readaloud] ${READALOUD}
`;

const NPC_NAME = "Harbourmaster Jorna";
const NPC_ID = "harbourmaster-jorna";

test("cold start: empty instance → campaign → chapter → scene → usable in the session", async ({
  page,
  server,
}) => {
  const api = apiFor(server.url, CAMPAIGN_ID);

  // --- the empty instance ---------------------------------------------------
  // Not an error that asks for a seed command on the shell: a shell command
  // is a dead end for the person the tool is for.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("coldstart.title"));
  expect(await api.get<unknown[]>("campaigns")).toEqual([]);

  // --- create the campaign --------------------------------------------------
  // The hints are GENERIC: a fresh instance must not suggest the name of the
  // example campaign, which reads like a default.
  const nameField = page.getByLabel(ui("create.campaign.nameLabel"));
  await expect(nameField).toHaveAttribute("placeholder", ui("create.campaign.namePlaceholder"));
  await nameField.fill(CAMPAIGN_NAME);
  // The id is DERIVED and shown before it is created — it is permanent, so it
  // is never a surprise. Umlaut included: `Kühlhaven` → `kuehlhaven`.
  await expect(page.getByText(CAMPAIGN_ID, { exact: true })).toBeVisible();
  await page.getByLabel(ui("create.campaign.descriptionLabel")).fill("A lighthouse gone dark.");
  await page.getByRole("button", { name: ui("create.campaign.title") }).click();

  // Straight into the (empty) chapter overview of the new campaign.
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_NAME);
  // The campaign is its own resource: every field flat, the text among them.
  const created = await getCampaign(api);
  expect(created).toMatchObject({ id: CAMPAIGN_ID, name: CAMPAIGN_NAME, body: "" });
  expect(created.description).toBe("A lighthouse gone dark.");

  // The empty chapter overview names the NEXT STEP instead of the generator, which needs
  // an API key and source material.
  await expect(page.getByText(ui("chapterOverview.empty"))).toBeVisible();

  // --- create the chapter ---------------------------------------------------
  // Two triggers carry this label (the quiet header one and the empty state's
  // button); either opens the same dialog.
  await page.getByRole("button", { name: ui("create.chapter.title") }).last().click();
  const chapterTitle = page.getByLabel(ui("create.chapter.nameLabel"));
  await expect(chapterTitle).toHaveAttribute("placeholder", ui("create.chapter.namePlaceholder"));
  await chapterTitle.fill(CHAPTER_TITLE);
  await expect(page.getByText(CHAPTER_ID, { exact: true })).toBeVisible();
  const description = page.getByLabel(ui("create.chapter.descriptionLabel"));
  await expect(description).toHaveAttribute(
    "placeholder",
    ui("create.chapter.descriptionPlaceholder"),
  );
  await description.fill(CHAPTER_DESCRIPTION);
  await page.getByRole("button", { name: ui("common.create") }).click();

  // The chapter overview lists it, with the text the dialog wrote: the
  // description as typed, no heading around it.
  const chapter = page.getByRole("button", { name: new RegExp(escapeRegExp(CHAPTER_TITLE)) });
  await expect(chapter).toBeVisible();
  await expect(chapter).toContainText(ui("chapterOverview.sceneCount", { count: 0 }));
  // The chapter is its own resource: the description became its text, and it
  // starts planned.
  const createdChapter = await getChapter(api, CHAPTER_ID);
  expect(createdChapter).toMatchObject({
    id: CHAPTER_ID,
    title: CHAPTER_TITLE,
    status: "planned",
    body: `${CHAPTER_DESCRIPTION}\n`,
  });
  await expect(page.getByText(CHAPTER_DESCRIPTION, { exact: true })).toBeVisible();

  // --- create the scene -----------------------------------------------------
  // The trigger sits INSIDE the chapter, which is what prefills the chapter:
  // the dialog asks for a title and nothing else.
  await page.getByRole("button", { name: ui("create.scene.title") }).click();
  const sceneTitle = page.getByLabel(ui("create.scene.nameLabel"));
  await expect(sceneTitle).toHaveAttribute("placeholder", ui("create.scene.namePlaceholder"));
  await sceneTitle.fill(FIRST_SCENE);
  await expect(page.getByText(FIRST_SCENE_ID, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: ui("common.create") }).click();

  // A new scene OPENS IN THE EDITOR, on its own route — an empty scene is
  // there to be written.
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/scenes/${FIRST_SCENE_ID}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(FIRST_SCENE);
  await expect(page.getByRole("button", { name: ui("common.save") })).toBeVisible();
  // …and it is a draft, as every new scene is.
  await expect(
    page.getByRole("button", {
      name: ui("status.change.aria", { current: ui("status.scene.draft") }),
    }),
  ).toBeVisible();

  // --- fill the scene -------------------------------------------------------
  await page.getByRole("button", { name: ui("composer.mode.markdown"), exact: true }).click();
  await page
    .getByRole("textbox", { name: ui("bodyEditor.markdown.aria", { path: FIRST_SCENE }) })
    .fill(SCENE_BODY);
  await page.getByRole("button", { name: ui("common.save") }).click();

  // Rendered, and stored: the callout is a box, not a quote.
  await expect(page.getByRole("button", { name: ui("common.edit") })).toBeVisible();
  await expect(page.getByRole("article")).toContainText(READALOUD);
  const sceneDoc = await getScene(api, FIRST_SCENE_ID);
  expect(sceneDoc.body).toContain("[!readaloud]");
  expect(sceneDoc.status).toBe("draft");
  expect(sceneDoc.chapter).toBe(CHAPTER_ID);

  // --- a second scene goes to the END of the chapter ------------------------
  // The order is the DM's, and a new scene is appended to it (decisions/scene-order). This
  // title sorts BEFORE the first one alphabetically, which is exactly what
  // must not decide anything: it lands behind it, where it was created.
  await page.goto(`/campaigns/${CAMPAIGN_ID}`);
  await page.getByRole("button", { name: ui("create.scene.title") }).click();
  await page.getByLabel(ui("create.scene.nameLabel")).fill(SECOND_SCENE);
  await page.getByRole("button", { name: ui("common.create") }).click();
  await expect(page).toHaveURL(new RegExp(`/scenes/${SECOND_SCENE_ID}$`));

  await page.goto(`/campaigns/${CAMPAIGN_ID}`);
  await expect.poll(() => shownSceneOrder(page)).toEqual([FIRST_SCENE, SECOND_SCENE]);
  // …and that is the stored order, not a sorting of the display.
  const tree = await api.get<{ chapters: { id: string; scenes: { id: string }[] }[] }>(
    `campaigns/${CAMPAIGN_ID}/tree`,
  );
  expect(tree.chapters[0]?.scenes.map((scene) => scene.id)).toEqual([
    FIRST_SCENE_ID,
    SECOND_SCENE_ID,
  ]);

  // --- a change of chapter goes to the END of the target chapter -----------
  // A second chapter with a scene of its own; the first chapter's second
  // scene moves there through its field dialog and lands behind that scene.
  await api.send("POST", `campaigns/${CAMPAIGN_ID}/chapters`, { title: "The Bay", id: "02-bay" });
  await api.send("POST", scenePath(api), { title: "On the beach", chapter: "02-bay" });
  await page.goto(`/campaigns/${CAMPAIGN_ID}/scenes/${SECOND_SCENE_ID}`);
  await page.getByRole("button", { name: ui("properties.action") }).click();
  const fields = page.getByRole("dialog");
  await fields.getByLabel(ui("properties.scene.chapter.label")).fill("02-bay");
  await expect(fields.getByRole("paragraph").filter({ hasText: "The Bay" })).toBeVisible();
  await fields.getByRole("button", { name: ui("common.save") }).click();
  await expect(fields).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: ui("context.aria") })).toContainText("The Bay");
  const moved = await api.get<{ chapters: { id: string; scenes: { id: string }[] }[] }>(
    `campaigns/${CAMPAIGN_ID}/tree`,
  );
  expect(moved.chapters.map((chapter) => chapter.scenes.map((scene) => scene.id))).toEqual([
    [FIRST_SCENE_ID],
    ["on-the-beach", SECOND_SCENE_ID],
  ]);
  // …and back, so the session below finds the chapter as it was: again the end.
  await patchScene(api, SECOND_SCENE_ID, { chapter: CHAPTER_ID });

  // --- start the session, use the scene live --------------------------------
  expect(await runningSessionId(api)).toBeUndefined();
  await page.getByRole("button", { name: ui("session.start") }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/live$`));
  expect(await runningSessionId(api)).toBeDefined();

  // The scene created three steps ago is the live view's default selection,
  // its text is on screen, and a quick note lands in the session's log.
  const nav = page.getByRole("navigation", { name: ui("live.nav.aria") });
  await expect(nav).toContainText(CHAPTER_TITLE);
  await expect(nav.getByRole("button", { name: new RegExp(FIRST_SCENE) })).toBeVisible();
  // The session view reads the same order — the first scene is the open one.
  await expect(nav.getByRole("button")).toHaveText([
    new RegExp(`^${FIRST_SCENE}`),
    new RegExp(`^${SECOND_SCENE}`),
  ]);
  await expect(nav.getByRole("button", { name: new RegExp(FIRST_SCENE) })).toHaveAttribute(
    "aria-current",
    "true",
  );
  // `.last()`: the live view's own center column is nested inside the app
  // shell's <main>, and the responsive mobile note is in the DOM either way.
  await expect(page.getByRole("main").last()).toContainText(READALOUD);

  const note = "The party knocks at the tower door";
  await page.getByRole("textbox", { name: ui("live.note.aria") }).fill(note);
  await page.keyboard.press("Enter");
  const sessionId = (await runningSessionId(api)) ?? "";
  await expect(async () => {
    const log = (await getSession(api, sessionId)).log;
    expect(log.map((row) => [row.text, row.sceneId])).toContainEqual([note, FIRST_SCENE_ID]);
  }).toPass();
  // A note sets no status; with a note in it, the played box beside the
  // step starts ticked, and leaving the scene marks it played.
  expect((await getScene(api, FIRST_SCENE_ID)).status).not.toBe("played");
  await expect(page.getByRole("checkbox", { name: ui("live.next.played") })).toBeChecked();
  await page.getByRole("button", { name: ui("live.next", { title: SECOND_SCENE }) }).click();
  await expect(nav.getByRole("button", { name: new RegExp(SECOND_SCENE) })).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect((await getScene(api, FIRST_SCENE_ID)).status).toBe("played");
});

test("npc and location are created from their lists; a collision writes nothing", async ({
  page,
  server,
}) => {
  const api = apiFor(server.url, CAMPAIGN_ID);
  await page.goto("/");
  await page.getByLabel(ui("create.campaign.nameLabel")).fill(CAMPAIGN_NAME);
  await page.getByRole("button", { name: ui("create.campaign.title") }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));

  // --- create the npc -------------------------------------------------------
  // The npc list is the npc's own route (decisions/resources).
  await page.goto(`/campaigns/${CAMPAIGN_ID}/npcs`);
  await expect(page.getByText(ui("browse.empty.npcs"))).toBeVisible();
  await page.getByRole("button", { name: ui("create.npc.title") }).click();
  const npcName = page.getByLabel(ui("create.npc.nameLabel"));
  await expect(npcName).toHaveAttribute("placeholder", ui("create.npc.namePlaceholder"));
  await npcName.fill(NPC_NAME);
  await expect(page.getByText(NPC_ID, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: ui("common.create") }).click();

  // The dialog only ever asks for a name — the npc's reading view on its
  // own route opens, and the rest of the fields live in the properties form.
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/npcs/${NPC_ID}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  await expect(page.getByRole("button", { name: ui("properties.action") })).toBeVisible();
  // The create answers the npc itself: every field flat, no kind, no path,
  // no properties map (decisions/resources).
  const created = await getNpc(api, NPC_ID);
  expect(created.name).toBe(NPC_NAME);
  expect(created.status).toBe("unknown");
  expect(Object.keys(created).sort()).toEqual(["body", "id", "name", "rev", "status"]);
  // …and it lists on that route.
  await page.goto(`/campaigns/${CAMPAIGN_ID}/npcs`);
  await expect(page.getByRole("link", { name: new RegExp(NPC_NAME) })).toHaveAttribute(
    "href",
    `/campaigns/${CAMPAIGN_ID}/npcs/${NPC_ID}`,
  );

  // --- the collision --------------------------------------------------------
  // Same name again: the id is taken, so nothing is written and the dialog
  // says what is in the way — plus the free proposal as ONE click. No silent
  // `-2`: an id is permanent, so the DM decides.
  await page.goto(`/campaigns/${CAMPAIGN_ID}/npcs`);
  await page.getByRole("button", { name: ui("create.npc.title") }).click();
  await page.getByLabel(ui("create.npc.nameLabel")).fill(NPC_NAME);
  await page.getByRole("button", { name: ui("common.create") }).click();
  await expect(page.getByText(npcTaken(NPC_ID, `${NPC_ID}-2`))).toBeVisible();
  // Still exactly one npc — the 409 wrote nothing.
  expect(await npcExists(api, `${NPC_ID}-2`)).toBe(false);
  expect(await getNpc(api, NPC_ID)).toEqual(created);
  expect((await api.get<unknown[]>(npcPath(api))).length).toBe(1);

  await page
    .getByRole("button", { name: ui("create.useSuggestion", { id: `${NPC_ID}-2` }) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/npcs/${NPC_ID}-2$`));
  // The NAME is the one that was typed; only the id came from the proposal.
  expect((await getNpc(api, `${NPC_ID}-2`)).name).toBe(NPC_NAME);

  // The same collision on the wire: 409 slug_taken with the next free id,
  // and nothing is written.
  const taken = await api.fetch(npcPath(api), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Someone else", id: NPC_ID }),
  });
  expect(taken.status).toBe(409);
  expect(await taken.json()).toMatchObject({
    code: "slug_taken",
    id: NPC_ID,
    suggestion: `${NPC_ID}-3`,
  });
  expect((await getNpc(api, NPC_ID)).name).toBe(NPC_NAME);
  expect(await npcExists(api, `${NPC_ID}-3`)).toBe(false);

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
  // The location list is the location's own route (decisions/resources).
  await page.goto(`/campaigns/${CAMPAIGN_ID}/locations`);
  await page.getByRole("button", { name: ui("create.location.title") }).click();
  const locationName = page.getByLabel(ui("create.location.nameLabel"));
  await expect(locationName).toHaveAttribute("placeholder", ui("create.location.namePlaceholder"));
  await locationName.fill("Harbour quarter");
  await page.getByRole("button", { name: ui("common.create") }).click();
  // The create answers the location itself, and its reading view is the
  // location's own route.
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/locations/harbour-quarter$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Harbour quarter");
  expect((await getLocation(api, "harbour-quarter")).name).toBe("Harbour quarter");
  // …and it lists on that route.
  await page.goto(`/campaigns/${CAMPAIGN_ID}/locations`);
  await expect(page.getByRole("link", { name: /Harbour quarter/ })).toHaveAttribute(
    "href",
    `/campaigns/${CAMPAIGN_ID}/locations/harbour-quarter`,
  );
});

test("the second campaign is created in the top bar's switcher", async ({ page, server }) => {
  const SECOND_NAME = "The Moor of Greywatch";
  const SECOND_ID = "the-moor-of-greywatch";
  const SECOND_DESCRIPTION = "Fog, peat and a missing man.";
  const first = apiFor(server.url, CAMPAIGN_ID);
  const second = apiFor(server.url, SECOND_ID);

  // The first campaign comes from the cold start, as it always does.
  await page.goto("/");
  await page.getByLabel(ui("create.campaign.nameLabel")).fill(CAMPAIGN_NAME);
  await page.getByRole("button", { name: ui("create.campaign.title") }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));

  // --- the switcher ---------------------------------------------------------
  const marker = "\u0000";
  const [switcherPrefix = ""] = ui("campaign.switcher.current", { name: marker }).split(marker);
  const switcher = page
    .getByRole("banner")
    .getByRole("button", { name: new RegExp(`^${escapeRegExp(switcherPrefix)}`) });
  await switcher.click();
  const menu = page.getByRole("menu");
  // No developer jargon and no replacement for it: the menu holds the
  // campaign and the create item, and nothing else — no shell command, no
  // word about the database.
  await expect(menu.getByRole("menuitem")).toHaveText([
    CAMPAIGN_NAME,
    ui("create.campaign.title"),
  ]);
  await expect(menu).not.toContainText("grimoire seed");

  // --- create a campaign, from the menu -------------------------------------
  await menu.getByRole("menuitem", { name: ui("create.campaign.title") }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(ui("create.campaign.title"));
  const nameField = dialog.getByLabel(ui("create.campaign.nameLabel"));
  // The very same dialog as the cold start: generic hint, derived id on screen
  // before anything is written, optional description.
  await expect(nameField).toHaveAttribute("placeholder", ui("create.campaign.namePlaceholder"));
  await nameField.fill(SECOND_NAME);
  await expect(dialog.getByText(SECOND_ID, { exact: true })).toBeVisible();
  await dialog.getByLabel(ui("create.campaign.descriptionLabel")).fill(SECOND_DESCRIPTION);
  await dialog.getByRole("button", { name: ui("common.create") }).click();

  // Success NAVIGATES into the new campaign — its own (empty) chapter overview.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/campaigns/${SECOND_ID}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SECOND_NAME);
  await expect(switcher).toHaveAccessibleName(
    ui("campaign.switcher.current", { name: SECOND_NAME }),
  );
  expect((await getCampaign(second)).name).toBe(SECOND_NAME);

  // Both campaigns are in the menu now, and the first one is untouched.
  await switcher.click();
  await expect(page.getByRole("menu")).toContainText(CAMPAIGN_NAME);
  await expect(page.getByRole("menu")).toContainText(SECOND_NAME);
  await expect(page.getByRole("menu")).toContainText(SECOND_DESCRIPTION);
  expect((await getCampaign(first)).name).toBe(CAMPAIGN_NAME);

  // …and switching back works, which is what the menu was there for already.
  await page.getByRole("menu").getByRole("menuitem", { name: new RegExp(CAMPAIGN_NAME) }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));
});

test("the id can be set by hand in the create dialog", async ({ page, server }) => {
  // The id is permanent (decisions/constraints), and the create dialog is the one place that
  // may personalise it. So the quiet preview line carries a pencil: it opens
  // as a field prefilled with the id on screen, the name stops feeding it once
  // something is typed, and an id the slug rule rejects never reaches the
  // server.
  const MANUAL_CAMPAIGN = "saltmarsh";
  const api = apiFor(server.url, MANUAL_CAMPAIGN);
  await page.goto("/");

  // --- the very first id of an instance, set by hand ------------------------
  const campaignName = page.getByLabel(ui("create.campaign.nameLabel"));
  await campaignName.fill(CAMPAIGN_NAME);
  await expect(page.getByText(CAMPAIGN_ID, { exact: true })).toBeVisible();
  // The pencil is a real button with a name, and toggling moves focus into the
  // field — the whole line is usable from the keyboard alone.
  await page.getByRole("button", { name: ui("idField.edit") }).click();
  const campaignId = page.getByLabel(ui("idField.label"), { exact: true });
  await expect(campaignId).toBeFocused();
  await expect(campaignId).toHaveValue(CAMPAIGN_ID);

  // After the first manual character the name no longer feeds the id.
  await campaignId.fill("saltmarsh-coast");
  await campaignName.fill("A completely different title");
  await expect(campaignId).toHaveValue("saltmarsh-coast");

  // An id the rule rejects is caught BEFORE the submit, and names the rule.
  await campaignId.fill("Saltmarsh Coast!");
  await expect(page.getByText(ui("idField.invalid"))).toBeVisible();
  await expect(page.getByRole("button", { name: ui("create.campaign.title") })).toBeDisabled();

  // Emptying the field hands the id back to the name — the derivation of the
  // name as it stands NOW, not the one that was there before.
  await campaignId.fill("");
  await expect(campaignId).toHaveValue("a-completely-different-title");
  await campaignName.fill(CAMPAIGN_NAME);
  await expect(campaignId).toHaveValue(CAMPAIGN_ID);

  // The id the DM actually wants — short, and it is what gets created.
  await campaignId.fill(MANUAL_CAMPAIGN);
  await page.getByRole("button", { name: ui("create.campaign.title") }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${MANUAL_CAMPAIGN}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_NAME);
  expect((await getCampaign(api)).name).toBe(CAMPAIGN_NAME);

  // --- a chapter, with an id of its own -------------------------------------
  await page.getByRole("button", { name: ui("create.chapter.title") }).last().click();
  const chapterDialog = page.getByRole("dialog");
  await chapterDialog.getByLabel(ui("create.chapter.nameLabel")).fill("First chapter");
  await expect(chapterDialog.getByText("first-chapter", { exact: true })).toBeVisible();
  await chapterDialog.getByRole("button", { name: ui("idField.edit") }).click();
  const chapterId = chapterDialog.getByLabel(ui("idField.label"), { exact: true });
  await chapterId.fill("number-one");

  // Pressing the pencil again is the other way back to automatic.
  await chapterDialog.getByRole("button", { name: ui("idField.edit") }).click();
  await expect(chapterDialog.getByText("first-chapter", { exact: true })).toBeVisible();

  await chapterDialog.getByRole("button", { name: ui("idField.edit") }).click();
  await chapterId.fill(CHAPTER_ID);
  await chapterDialog.getByRole("button", { name: ui("common.create") }).click();
  await expect(page.getByRole("button", { name: /First chapter/ })).toBeVisible();
  expect(await chapterExists(api, CHAPTER_ID)).toBe(true);
  // The derived id was never written — only the one that was typed.
  expect(await chapterExists(api, "first-chapter")).toBe(false);

  // --- an NPC: only the id is typed ----------------------------------------
  await page.goto(`/campaigns/${MANUAL_CAMPAIGN}/npcs`);
  await page.getByRole("button", { name: ui("create.npc.title") }).click();
  const npcDialog = page.getByRole("dialog");
  await npcDialog.getByLabel(ui("create.npc.nameLabel")).fill(NPC_NAME);
  await expect(npcDialog.getByText(NPC_ID, { exact: true })).toBeVisible();
  await npcDialog.getByRole("button", { name: ui("idField.edit") }).click();
  const npcId = npcDialog.getByLabel(ui("idField.label"), { exact: true });
  await npcId.fill("jorna");
  await expect(npcId).toHaveValue("jorna");
  await npcDialog.getByRole("button", { name: ui("common.create") }).click();

  // The typed id is the npc's id AND in the URL of its own route.
  await expect(page).toHaveURL(new RegExp(`/campaigns/${MANUAL_CAMPAIGN}/npcs/jorna$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  expect((await getNpc(api, "jorna")).name).toBe(NPC_NAME);
  // The derived id was never written — only the one that was typed.
  expect(await npcExists(api, NPC_ID)).toBe(false);

  // --- a typed id that is TAKEN: the 409 path is unchanged -----------------
  // No silent `-2` here either: nothing is written, the dialog says what is in
  // the way and offers the free proposal as ONE click.
  await page.goto(`/campaigns/${MANUAL_CAMPAIGN}/npcs`);
  await page.getByRole("button", { name: ui("create.npc.title") }).click();
  await page.getByLabel(ui("create.npc.nameLabel")).fill("Dockhand Holm");
  await page.getByRole("button", { name: ui("idField.edit") }).click();
  await page.getByLabel(ui("idField.label"), { exact: true }).fill("jorna");
  await page.getByRole("button", { name: ui("common.create") }).click();
  await expect(page.getByText(npcTaken("jorna", "jorna-2"))).toBeVisible();
  expect(await npcExists(api, "jorna-2")).toBe(false);
  expect((await getNpc(api, "jorna")).name).toBe(NPC_NAME);

  await page.getByRole("button", { name: ui("create.useSuggestion", { id: "jorna-2" }) }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${MANUAL_CAMPAIGN}/npcs/jorna-2$`));
  // The NAME is the one that was typed; only the id came from the proposal.
  expect((await getNpc(api, "jorna-2")).name).toBe("Dockhand Holm");
});

test("cold start and creating an npc work at 390px", async ({ page, server }) => {
  const api = apiFor(server.url, CAMPAIGN_ID);
  await page.setViewportSize({ width: 390, height: 780 });

  // The cold-start surface is a page, not a dialog — which is exactly why it
  // works on a phone: no chrome to fit around it.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("coldstart.title"));
  await page.getByLabel(ui("create.campaign.nameLabel")).fill(CAMPAIGN_NAME);
  const submit = page.getByRole("button", { name: ui("create.campaign.title") });
  // Touch target (quality floor) and inside the viewport.
  const box = await submit.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  await submit.click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}$`));

  // The mobile start surface reaches the lists through its lookup section,
  // and the list is where an NPC is created.
  await page.getByRole("link", { name: ui("browse.title.npcs") }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/npcs$`));
  await page.getByRole("button", { name: ui("create.npc.title") }).click();
  await page.getByLabel(ui("create.npc.nameLabel")).fill("Old fisherwoman");
  // The pencil works on a phone too: the line wraps instead of pushing the
  // dialog wider, and the field it opens takes focus.
  await page.getByRole("button", { name: ui("idField.edit") }).click();
  const npcId = page.getByLabel(ui("idField.label"), { exact: true });
  await expect(npcId).toBeFocused();
  const idBox = await npcId.boundingBox();
  expect((idBox?.x ?? 0) + (idBox?.width ?? 0)).toBeLessThanOrEqual(390);
  await npcId.fill("fisherwoman");
  await page.getByRole("button", { name: ui("common.create") }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN_ID}/npcs/fisherwoman$`));
  expect((await getNpc(api, "fisherwoman")).name).toBe("Old fisherwoman");
});
