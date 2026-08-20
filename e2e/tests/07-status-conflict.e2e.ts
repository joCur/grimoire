// Kritischer Pfad 7: Frontmatter-Patch über den Status-Regler, inklusive
// 409-Konflikt bei extern geänderter Datei.
//
// Der Patch geht durch die dokumentierte API mit mtime-Check (CLAUDE.md); der
// Konflikt wird provoziert, indem der Test die Datei hinter der App verändert
// — genau der Fall "im Editor gespeichert, während die App offen war".

import { expect, test } from "../support/test";

const SCENE = "01-salzhafen/hafen/ankunft-leuchtturm.md";
const SCENE_URL = `/beispiel/file/${SCENE}`;
const STALE_MESSAGE = "Datei extern geändert — neu laden";

test("Status-Regler schreibt den Status in die Datei", async ({ page, files }) => {
  await page.goto(SCENE_URL);
  expect(await files.read(SCENE)).toContain("status: ready");

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
  await expect.poll(() => files.read(SCENE)).toContain("status: played");

  // …and back to "bereit" — the file follows every pick.
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "bereit" }).click();
  await expect(trigger).toHaveText(/bereit/);
  await expect.poll(() => files.read(SCENE)).toContain("status: ready");

  // The pool row shows the same control with the same label.
  await page.goto("/beispiel");
  await expect(
    page.getByRole("button", { name: "Status ändern, aktuell bereit" }).first(),
  ).toBeVisible();
});

test("Extern geänderte Datei: der Status-Pick meldet den Konflikt inline", async ({
  page,
  files,
}) => {
  await page.goto(SCENE_URL);
  const trigger = page.getByRole("button", { name: /^Status ändern, aktuell/ });
  await expect(trigger).toHaveText(/bereit/);

  const message = page.getByText(STALE_MESSAGE);
  const externalEdit = (n: number) =>
    `${
      // Same frontmatter, new body — the status stays "ready", only the mtime
      // moves. That is what the server compares against.
      "---\nid: lighthouse-arrival\ntitle: Ankunft am Leuchtturm\ntype: planned\n" +
      "chapter: 01-salzhafen\nlocation: leuchtturm\nnpcs: [jorna]\n" +
      'handouts: ["Karte von Salzhafen"]\ntags: [social, travel]\nstatus: ready\n---\n'
    }\n## Flow\n\nVon Hand im Editor geändert (${n}).\n`;

  // The app refreshes its mtime on the next version poll (~5s), so the
  // conflict window is short: change the file, then pick immediately. A poll
  // that lands in between heals the staleness — hence up to three attempts.
  let conflicted = false;
  for (let attempt = 1; attempt <= 3 && !conflicted; attempt++) {
    await files.write(SCENE, externalEdit(attempt));
    await trigger.click();
    await page.getByRole("menuitemradio", { name: "gespielt" }).click();
    conflicted = await message
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => true)
      .catch(() => false);
  }
  expect(conflicted, "the 409 conflict message never appeared").toBe(true);

  // Nothing was written: the external content stands, unchanged.
  const onDisk = await files.read(SCENE);
  expect(onDisk).toContain("status: ready");
  expect(onDisk).toContain("Von Hand im Editor geändert");

  // The control re-read the file, so the SAME pick works now.
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "gespielt" }).click();
  await expect(trigger).toHaveText(/gespielt/);
  await expect(message).toHaveCount(0);
  await expect.poll(() => files.read(SCENE)).toContain("status: played");
});
