// `grimoire seed` (issue #54). The point of the CLI is that it runs the SAME
// migration code the boot path will run — so what is worth testing is the
// wiring: source resolution, GRIMOIRE_DATA, the printed report, the exit code
// and the no-op on a second run.
//
// Run as a real child process rather than by importing cli.ts: the module has
// a top-level `process.exitCode` assignment, and an in-process import would
// leak that into the test runner.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = path.join(SERVER_DIR, "src", "cli.ts");
const EXAMPLES = path.resolve(SERVER_DIR, "../examples");

let dataDir = "";
let sourceDir = "";

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
  sourceDir = await mkdtemp(path.join(os.tmpdir(), "grimoire-seed-src-"));
  await cp(EXAMPLES, sourceDir, { recursive: true });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await rm(sourceDir, { recursive: true, force: true });
});

describe("grimoire seed", () => {
  test("imports a given directory into GRIMOIRE_DATA/grimoire.db", async () => {
    const { code, out } = await runCli(["seed", sourceDir]);
    expect(code).toBe(0);
    expect(out).toContain("imported: beispiel");
    expect(out).toContain("clean import");
    // The database really landed in GRIMOIRE_DATA (WAL companions included).
    const files = await readdir(dataDir);
    expect(files).toContain("grimoire.db");
  });

  test("the second run is a no-op and says so", async () => {
    expect((await runCli(["seed", sourceDir])).code).toBe(0);
    const second = await runCli(["seed", sourceDir]);
    expect(second.code).toBe(0);
    expect(second.out).toContain("nothing to do");
    expect(second.out).toContain("already migrated");
  });

  test("without a directory it defaults to examples/", async () => {
    const { code, out } = await runCli(["seed"]);
    expect(code).toBe(0);
    expect(out).toContain(EXAMPLES);
    expect(out).toContain("imported: beispiel");
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
