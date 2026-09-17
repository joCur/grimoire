// `grimoire seed`. The point of the CLI is that it runs the SAME loader the
// test suite runs — so what is worth testing is the wiring: source
// resolution, GRIMOIRE_DATA, the printed report, the exit code and the
// refusal on a database that already holds campaigns.
//
// Run as a real child process rather than by importing cli.ts: the module has
// a top-level `process.exitCode` assignment, and an in-process import would
// leak that into the test runner.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = path.join(SERVER_DIR, "src", "cli.ts");
const FIXTURES = path.resolve(SERVER_DIR, "../fixtures");

let dataDir = "";

async function runCli(args: string[]): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: SERVER_DIR,
    env: { ...process.env, GRIMOIRE_DATA: dataDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out: stdout + stderr };
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "grimoire-seed-data-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("grimoire seed", () => {
  test("loads a given directory into GRIMOIRE_DATA/grimoire.db", async () => {
    const { code, out } = await runCli(["seed", FIXTURES]);
    expect(code).toBe(0);
    // One line per campaign, with the number of entries it brought.
    expect(out.trim()).toBe("seeded: beispiel (11 entries)");
    // The database really landed in GRIMOIRE_DATA.
    expect(await readdir(dataDir)).toContain("grimoire.db");
  });

  test("without a directory it defaults to fixtures/", async () => {
    const { code, out } = await runCli(["seed"]);
    expect(code).toBe(0);
    expect(out).toContain("seeded: beispiel");
  });

  test("a database that holds campaigns is REFUSED, and --force seeds anyway", async () => {
    expect((await runCli(["seed"])).code).toBe(0);

    const second = await runCli(["seed"]);
    expect(second.code).toBe(0);
    expect(second.out).toContain("already holds campaigns");
    expect(second.out).toContain("--force");

    // `--force` is for a scratch database: rows are ADDED, nothing deleted.
    const extra = path.join(dataDir, "extra");
    await mkdir(path.join(extra, "zweite"), { recursive: true });
    await writeFile(
      path.join(extra, "zweite", "campaign.json"),
      JSON.stringify({ kind: "campaign", properties: { id: "zweite", name: "Zweite" }, body: "" }),
    );
    const forced = await runCli(["seed", "--force", extra]);
    expect(forced.code).toBe(0);
    expect(forced.out.trim()).toBe("seeded: zweite (1 entry)");
  });

  test("an unreadable directory exits 1 with a message", async () => {
    const { code, out } = await runCli(["seed", path.join(dataDir, "gibt-es-nicht")]);
    expect(code).toBe(1);
    expect(out).toContain("seed failed");
  });

  test("help works and an unknown command fails loudly", async () => {
    const help = await runCli([]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("grimoire seed");

    const bogus = await runCli(["frobnicate"]);
    expect(bogus.code).toBe(2);
    expect(bogus.out).toContain("unknown command");
  });
});
