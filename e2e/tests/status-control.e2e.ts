// Critical path 7: frontmatter patch via the status control, including the
// 409 conflict; see CLAUDE.md.
//
// The patch goes through the documented API with its guard token (CLAUDE.md);
// the conflict is provoked by a SECOND WRITER through the same API — since the
// cutover (issue #57) that is what "the row moved under the app" means.

import { expect, test } from "../support/test";

const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";
const SCENE_URL = `/beispiel/file/${SCENE}`;
const STALE_MESSAGE = "Inzwischen geändert — neu laden";

test("the status control writes the status into the file", async ({ page, api }) => {
  await page.goto(SCENE_URL);
  expect(await api.raw(SCENE)).toContain("status: ready");

  // The pill IS the control (issue #28).
  const trigger = page.getByRole("button", { name: /^Status ändern, aktuell/ });
  await expect(trigger).toHaveText(/bereit/);
  await trigger.click();

  // All four options, the current one checked.
  for (const label of ["Entwurf", "bereit", "gespielt", "verworfen"]) {
    await expect(page.getByRole("menuitemradio", { name: label })).toBeVisible();
  }
  await page.getByRole("menuitemradio", { name: "gespielt" }).click();

  await expect(trigger).toHaveText(/gespielt/);
  await expect.poll(() => api.raw(SCENE)).toContain("status: played");

  // …and back to "bereit" — the file follows every pick.
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "bereit" }).click();
  await expect(trigger).toHaveText(/bereit/);
  await expect.poll(() => api.raw(SCENE)).toContain("status: ready");

  // The pool row shows the same control with the same label.
  await page.goto("/beispiel");
  await expect(
    page.getByRole("button", { name: "Status ändern, aktuell bereit" }).first(),
  ).toBeVisible();
});

test("a second writer: the status pick reports the conflict inline", async ({
  page,
  api,
}) => {
  await page.goto(SCENE_URL);
  const trigger = page.getByRole("button", { name: /^Status ändern, aktuell/ });
  await expect(trigger).toHaveText(/bereit/);

  const message = page.getByText(STALE_MESSAGE);
  // A new BODY, same status: only the row's version moves, and that is what
  // the server compares against.
  const secondWriter = (n: number) => `\n## Flow\n\nVon einem zweiten Schreiber geändert (${n}).\n`;

  // The app refreshes its token on the next version poll (~5s), so the
  // conflict window is short: write, then pick immediately. A poll that lands
  // in between heals the staleness — hence up to three attempts.
  let conflicted = false;
  for (let attempt = 1; attempt <= 3 && !conflicted; attempt++) {
    await api.writeBody(SCENE, secondWriter(attempt));
    await trigger.click();
    await page.getByRole("menuitemradio", { name: "gespielt" }).click();
    conflicted = await message
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => true)
      .catch(() => false);
  }
  expect(conflicted, "the 409 conflict message never appeared").toBe(true);

  // Nothing was written: the other writer's content stands, unchanged.
  const stored = await api.raw(SCENE);
  expect(stored).toContain("status: ready");
  expect(stored).toContain("Von einem zweiten Schreiber geändert");

  // The control re-read the file, so the SAME pick works now.
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "gespielt" }).click();
  await expect(trigger).toHaveText(/gespielt/);
  await expect(message).toHaveCount(0);
  await expect.poll(() => api.raw(SCENE)).toContain("status: played");
});
