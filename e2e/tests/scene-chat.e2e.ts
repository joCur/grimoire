// Critical path 14: the brainstorming chat of a scene; see CLAUDE.md.
//
// The chat opens from its button at the bottom right of the scene's reading
// view: as a popup above the page, which docks as a side panel at the right
// (the page narrows, nothing overlaps the text) and back; on the phone as a
// sheet from the bottom. Where it stands lives in the URL (`?chat=`), so a
// reload keeps it; Esc closes the popup and the focus returns to the button.
//
// Sending answers at once with the DM's message; the reply is written on the
// server against the stub LLM and the app polls until it stands — the stub
// echoes what the context block carried (the scene, its npc, its location,
// the campaign knowledge), and the reply is rendered Markdown with its
// `[[id]]` resolved. A reload keeps the chat (it is rows on the server,
// nothing in the browser). The send action waits while a reply runs; a
// failed reply says why in a whole sentence and keeps the DM's message.
// Clearing asks first, puts the chat in the trash, and the trash page
// restores it.
//
// Every claim about what was stored reads the rows through the API; the page
// is reached by roles, test ids and catalog keys only.

import type { Page } from "@playwright/test";

import { TRIGGER } from "../fixtures/replies";
import { expect, test } from "../support/test";
import { getSceneChat, getTrashedSceneChats } from "../support/scene-chat";
import { ui } from "../support/ui";

/** The reference scene: it names the npc Fenn and plays at the north cove. */
const SCENE = "smuggler-captured";
const SCENE_TITLE = "Caught by the Smugglers";
const SCENE_URL = `/campaigns/example/scenes/${SCENE}`;
const FACT = "The harbour belongs to the smugglers' guild.";

test.use({
  seed: { knowledgeItems: [{ id: "harbour-guild", kind: "fact", from: "", to: "", text: FACT }] },
});

function chat(page: Page) {
  return page.getByTestId("scene-chat");
}

function opener(page: Page) {
  return page.getByRole("button", { name: ui("sceneChat.open") });
}

function input(page: Page) {
  return chat(page).getByRole("textbox", { name: ui("sceneChat.input.label") });
}

function messages(page: Page) {
  return chat(page).getByTestId("scene-chat-message");
}

function reply(page: Page, index: number) {
  return chat(page).locator('[data-testid="scene-chat-message"][data-role="model"]').nth(index);
}

function action(page: Page, key: "sceneChat.expand" | "sceneChat.collapse" | "sceneChat.clear" | "sceneChat.close") {
  return chat(page).getByRole("button", { name: ui(key), exact: true });
}

async function openChat(page: Page): Promise<void> {
  await opener(page).click();
  await expect(chat(page)).toBeVisible();
}

async function send(page: Page, text: string): Promise<void> {
  await input(page).fill(text);
  await chat(page).getByRole("button", { name: ui("sceneChat.send"), exact: true }).click();
}

test("a message gets a reply from the scene's context; the chat docks, survives a reload, is cleared and restored", async ({
  page,
  api,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(SCENE_URL);

  // --- closed at first: the button opens it as a popup ----------------------
  await expect(chat(page)).toHaveCount(0);
  await openChat(page);
  await expect(page).toHaveURL(/[?&]chat=popup$/);
  await expect(chat(page)).toHaveAttribute("data-mode", "popup");
  await expect(chat(page).getByRole("heading", { name: ui("sceneChat.heading") })).toBeVisible();
  await expect(input(page)).toBeFocused();
  await expect(chat(page)).toContainText(ui("sceneChat.empty"));
  expect(await getSceneChat(api, SCENE)).toBeUndefined();

  // --- a reply that takes its time: the send action waits ------------------
  await send(page, `What does Fenn want? ${TRIGGER.latePart}`);
  await expect(messages(page).first()).toHaveAttribute("data-role", "dm");
  await expect(reply(page, 0)).toHaveAttribute("data-status", "running");
  await expect(reply(page, 0)).toContainText(ui("sceneChat.running"));
  await input(page).fill("And then?");
  await expect(chat(page).getByRole("button", { name: ui("sceneChat.send"), exact: true })).toBeDisabled();

  // --- the reply stands, rendered, from the context as it is stored --------
  await expect(reply(page, 0)).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  const first = reply(page, 0);
  await expect(first.getByRole("heading", { name: "Stub reply" })).toBeVisible();
  await expect(first).toContainText(`Scene: ${SCENE}`);
  await expect(first).toContainText("Location: cove");
  await expect(first).toContainText(FACT);
  // The npc travels as `[[fenn]]` and reads as its current name.
  await expect(
    first.getByRole("link", { name: ui("markdown.ref.aria", { kind: ui("kind.npc"), name: "Fenn" }) }),
  ).toHaveAttribute("href", "/campaigns/example/npcs/fenn");
  await first.getByRole("button", { name: ui("sceneChat.copy.aria") }).click();
  await expect(first.getByRole("button", { name: ui("sceneChat.copied.aria") })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("[[fenn]]");

  // --- the conversation goes on: the second reply sees the first ------------
  await chat(page).getByRole("button", { name: ui("sceneChat.send"), exact: true }).click();
  await expect(reply(page, 1)).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  await expect(reply(page, 1)).toContainText("Messages: 4");
  const stored = await getSceneChat(api, SCENE);
  expect(stored?.messages.map((message) => [message.role, message.status])).toEqual([
    ["dm", "done"],
    ["model", "done"],
    ["dm", "done"],
    ["model", "done"],
  ]);

  // --- docked as a side panel: the page narrows, nothing is covered --------
  await action(page, "sceneChat.expand").click();
  await expect(page).toHaveURL(/[?&]chat=side$/);
  await expect(chat(page)).toHaveAttribute("data-mode", "side");
  const panel = (await chat(page).boundingBox())!;
  const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
  expect(title.x + title.width).toBeLessThanOrEqual(panel.x);

  // --- a reload keeps the chat and where it stands ---------------------------
  await page.reload();
  await expect(chat(page)).toHaveAttribute("data-mode", "side");
  await expect(messages(page)).toHaveCount(4);
  await expect(reply(page, 0)).toContainText(FACT);

  // --- back to the popup; Esc closes it and the button has the focus --------
  await action(page, "sceneChat.collapse").click();
  await expect(chat(page)).toHaveAttribute("data-mode", "popup");
  await input(page).focus();
  await page.keyboard.press("Escape");
  await expect(chat(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/chat=/);
  await expect(opener(page)).toBeFocused();

  // --- clearing asks first and puts it in the trash -------------------------
  await openChat(page);
  await action(page, "sceneChat.clear").click();
  const dialog = page.getByRole("dialog", { name: ui("sceneChat.clear.title") });
  await dialog.getByRole("button", { name: ui("editMode.delete.confirm") }).click();
  await expect(chat(page)).toContainText(ui("sceneChat.empty"));
  await expect.poll(() => getSceneChat(api, SCENE)).toBeUndefined();
  const [trashed] = await getTrashedSceneChats(api);
  expect(trashed?.id).toBe(stored?.id);
  expect(trashed?.messages).toHaveLength(4);

  // --- the trash page restores it --------------------------------------------
  await page.goto("/campaigns/example/trash");
  const name = ui("trash.sceneChat.name", { scene: SCENE_TITLE });
  const group = page.getByRole("region", { name: ui("trash.group.sceneChats"), exact: true });
  await expect(group.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  await page.getByRole("button", { name: ui("trash.restore.aria", { name }) }).click();
  await expect(page.getByText(ui("trash.empty"))).toBeVisible();
  expect(await getTrashedSceneChats(api)).toEqual([]);

  await page.goto(`${SCENE_URL}?chat=popup`);
  await expect(messages(page)).toHaveCount(4);
});

test("a failed reply says why in a whole sentence and keeps the DM's message", async ({ page, api }) => {
  await page.goto(SCENE_URL);
  await openChat(page);
  await send(page, `Cut this one off. ${TRIGGER.truncated}`);
  await expect(reply(page, 0)).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
  // The suite sets no output cap: the sentence names the endpoint's default.
  await expect(reply(page, 0)).toContainText(
    ui("server.scene_chat_reply_truncated", { max: ui("server.llm_truncated.defaultCap") }),
  );
  await expect(messages(page).first()).toContainText("Cut this one off.");
  await expect(reply(page, 0).getByRole("button", { name: ui("sceneChat.retry") })).toBeEnabled();
  const stored = await getSceneChat(api, SCENE);
  expect(stored?.messages.map((message) => message.status)).toEqual(["done", "failed"]);
});

test("on the phone the chat is a sheet from the bottom, without a side panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SCENE_URL);
  await openChat(page);
  await expect(chat(page)).toHaveAttribute("data-mode", "sheet");
  await expect(action(page, "sceneChat.expand")).toHaveCount(0);
  await send(page, "What does Fenn want?");
  await expect(reply(page, 0)).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  await expect(chat(page).getByRole("button", { name: ui("sceneChat.send"), exact: true })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  // A reload keeps the sheet open; closing it takes the parameter away.
  await page.reload();
  await expect(chat(page)).toHaveAttribute("data-mode", "sheet");
  await action(page, "sceneChat.close").click();
  await expect(chat(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/chat=/);
});
