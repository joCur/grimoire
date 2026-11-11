// Critical path 15: the quick-ideas chat of a running session; see CLAUDE.md.
//
// The chat opens from its button at the bottom right of the live view — left
// of the aside, so nothing covers the quick note — as a popup above the
// page, which docks as a side panel at the right (the page narrows, nothing
// covers the open scene) and back; Esc closes the popup and the focus returns
// to the button.
//
// A question shows the DM's message at once and the reply as running, with
// the send action disabled until it stands; the stub LLM echoes what the
// context block carried — the open scene, its npc, its location and the
// session's log lines — rendered as Markdown with its `[[id]]` resolved and a
// copy action. A second question sees the whole conversation, and after the
// next-scene step the next question carries the new scene. A reply cut off
// at the output cap says why in a whole sentence, keeps the DM's question
// and is asked for again. NOTHING IS STORED: the session's rows stay as they
// were, and a reload starts the chat empty.
//
// Every claim about what was stored reads the rows through the API; the page
// is reached by roles, test ids and catalog keys only.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";
import type { Scene } from "@grimoire/shared/scene";
import type { Session } from "@grimoire/shared/session";

import { TRIGGER } from "../fixtures/replies";
import type { Api } from "../support/api";
import { FIXTURES_ROOT } from "../support/paths";
import { getSession, logEntryPath, sessionPath } from "../support/session";
import { expect, test } from "../support/test";
import { ui } from "../support/ui";

const LIVE_URL = "/campaigns/example/live";
const NOTE = "The keeper hides a second key";
const ARRIVAL = "lighthouse-arrival";
const CAPTURED = "smuggler-captured";

/**
 * The second scene of the chapter as a PLANNED one, so the next-scene step of
 * the first leads to it.
 */
const captured = JSON.parse(
  readFileSync(path.join(FIXTURES_ROOT, "scenes", `${CAPTURED}.json`), "utf8"),
) as Omit<Scene, "rev">;
const { trigger: _trigger, ...capturedFields } = captured;

test.use({ seed: { scenes: [{ ...capturedFields, type: "planned" }] } });

function chat(page: Page) {
  return page.getByTestId("quick-ideas");
}

function opener(page: Page) {
  return page.getByRole("button", { name: ui("quickIdeas.open") });
}

function input(page: Page) {
  return chat(page).getByRole("textbox", { name: ui("chat.input.label") });
}

function sendButton(page: Page) {
  return chat(page).getByRole("button", { name: ui("chat.send"), exact: true });
}

function messages(page: Page) {
  return chat(page).getByTestId("quick-ideas-message");
}

function reply(page: Page, index: number) {
  return chat(page).locator('[data-testid="quick-ideas-message"][data-role="model"]').nth(index);
}

function action(page: Page, key: "chat.expand" | "chat.collapse" | "chat.close") {
  return chat(page).getByRole("button", { name: ui(key), exact: true });
}

async function openChat(page: Page): Promise<void> {
  await opener(page).click();
  await expect(chat(page)).toBeVisible();
}

async function ask(page: Page, text: string): Promise<void> {
  await input(page).fill(text);
  await sendButton(page).click();
}

/** A running session with one note taken in the first scene. */
async function startSession(api: Api): Promise<Session> {
  const session = await api.send<Session>("POST", sessionPath(api), {});
  await api.send("POST", logEntryPath(api, session.id), { text: NOTE, sceneId: ARRIVAL });
  return getSession(api, session.id);
}

test("a question gets a reply from the open scene's context; the chat docks, follows the scene and is gone after a reload", async ({
  page,
  api,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const session = await startSession(api);
  await page.goto(LIVE_URL);

  // --- closed at first; its button leaves the quick note free ---------------
  await expect(chat(page)).toHaveCount(0);
  const button = (await opener(page).boundingBox())!;
  const note = (await page.getByLabel(ui("live.note.aria")).boundingBox())!;
  expect(button.x + button.width <= note.x || button.y + button.height <= note.y).toBe(true);

  await openChat(page);
  await expect(page).toHaveURL(/[?&]chat=popup$/);
  await expect(chat(page)).toHaveAttribute("data-mode", "popup");
  await expect(chat(page).getByRole("heading", { name: ui("quickIdeas.heading") })).toBeVisible();
  await expect(input(page)).toBeFocused();
  await expect(chat(page)).toContainText(ui("quickIdeas.empty"));

  // --- a reply that takes its time: the send action waits --------------------
  await ask(page, `A name for the keeper's dog? ${TRIGGER.latePart}`);
  await expect(messages(page).first()).toHaveAttribute("data-role", "dm");
  await expect(reply(page, 0)).toHaveAttribute("data-status", "running");
  await expect(reply(page, 0)).toContainText(ui("chat.running"));
  await input(page).fill("And another one?");
  await expect(sendButton(page)).toBeDisabled();

  // --- the reply stands, rendered, from the context as it is stored ----------
  await expect(reply(page, 0)).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  const first = reply(page, 0);
  await expect(first.getByRole("heading", { name: "Stub idea" })).toBeVisible();
  await expect(first).toContainText(`Scene: ${ARRIVAL}`);
  await expect(first).toContainText("Location: lighthouse");
  await expect(first).toContainText(`(${ARRIVAL}): ${NOTE}`);
  // The npc travels as `[[jorna]]` and reads as her current name.
  await expect(
    first.getByRole("button", {
      name: ui("markdown.ref.aria", { kind: ui("kind.npc"), name: "Harbourmaster Jorna" }),
    }),
  ).toBeVisible();
  await first.getByRole("button", { name: ui("chat.copy.aria") }).click();
  await expect(first.getByRole("button", { name: ui("chat.copied.aria") })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("[[jorna]]");

  // --- the conversation goes on: the second reply sees the first -------------
  await sendButton(page).click();
  await expect(reply(page, 1)).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  await expect(reply(page, 1)).toContainText("Messages: 4");

  // --- docked as a side panel: the page narrows, nothing is covered ----------
  await action(page, "chat.expand").click();
  await expect(page).toHaveURL(/[?&]chat=side$/);
  await expect(chat(page)).toHaveAttribute("data-mode", "side");
  const panel = (await chat(page).boundingBox())!;
  const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
  expect(title.x + title.width).toBeLessThanOrEqual(panel.x);
  const aside = (await page.getByLabel(ui("live.note.aria")).boundingBox())!;
  expect(aside.x + aside.width).toBeLessThanOrEqual(panel.x);

  // --- back to the popup; Esc closes it and the button has the focus ---------
  await action(page, "chat.collapse").click();
  await expect(chat(page)).toHaveAttribute("data-mode", "popup");
  await input(page).focus();
  await page.keyboard.press("Escape");
  await expect(chat(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/chat=/);
  await expect(opener(page)).toBeFocused();

  // --- the next scene: the conversation stays, the context follows ----------
  await page.getByRole("button", { name: ui("live.next", { title: captured.title }) }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(captured.title);
  await openChat(page);
  await expect(messages(page)).toHaveCount(4);
  await ask(page, "What does Fenn want now?");
  await expect(reply(page, 2)).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  await expect(reply(page, 2)).toContainText(`Scene: ${CAPTURED}`);
  await expect(reply(page, 2)).toContainText("Location: cove");
  await expect(reply(page, 2)).toContainText("Messages: 6");

  // --- nothing was stored: the session's rows are as they were ---------------
  const stored = await getSession(api, session.id);
  expect(stored.log).toEqual(session.log);
  expect(stored.rev).toBe(session.rev);

  // --- a reload starts the chat empty -----------------------------------------
  await page.reload();
  await expect(chat(page)).toHaveAttribute("data-mode", "popup");
  await expect(messages(page)).toHaveCount(0);
  await expect(chat(page)).toContainText(ui("quickIdeas.empty"));
});

test("a reply cut off at the output cap says why in a whole sentence, keeps the question and is asked for again", async ({
  page,
  api,
}) => {
  await startSession(api);
  await page.goto(`${LIVE_URL}?chat=popup`);
  const nonce = `quick-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await ask(page, `Cut this one off once. ${TRIGGER.partFail}:${nonce}`);
  await expect(reply(page, 0)).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
  // The suite sets no output cap: the sentence names the endpoint's default.
  await expect(reply(page, 0)).toContainText(
    ui("server.quick_ideas_reply_truncated", { max: ui("server.llm_truncated.defaultCap") }),
  );
  await expect(messages(page).first()).toContainText("Cut this one off once.");

  await reply(page, 0).getByRole("button", { name: ui("chat.retry") }).click();
  await expect(reply(page, 0)).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  await expect(reply(page, 0)).toContainText(`Scene: ${ARRIVAL}`);
  await expect(messages(page)).toHaveCount(2);
});
