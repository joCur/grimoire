// Managed child processes: the stub LLM and the real Grimoire server.
//
// Both are ordinary processes started with bun — no in-process shortcuts, so
// the suite exercises the production topology (one server process serving the
// built app AND /api, talking HTTP to the LLM endpoint).

import { spawn, type ChildProcess } from "node:child_process";

export interface ManagedProcess {
  readonly pid: number | undefined;
  /** Everything the process wrote — dumped when a start-up wait times out. */
  output(): string;
  stop(): Promise<void>;
}

export interface StartOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /** Prefix for the forwarded output lines (quiet unless E2E_VERBOSE=1). */
  label: string;
}

/** Start a child process, collecting its output for diagnostics. */
export function startProcess({ command, args, cwd, env, label }: StartOptions): ManagedProcess {
  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new Error(`${label}: could not start "${command}" — ${String(err)}`);
  }

  let log = "";
  const collect = (chunk: Buffer) => {
    const text = chunk.toString();
    log += text;
    if (process.env.E2E_VERBOSE === "1") process.stdout.write(`[${label}] ${text}`);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("error", (err) => {
    log += `\n${label}: process error — ${String(err)}\n`;
  });

  return {
    get pid() {
      return child.pid;
    },
    output: () => log,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        // SIGTERM first (the http server shuts down on it), SIGKILL as the
        // backstop so a hung process never blocks the run. Specs that restart
        // a server rely on this being a HARD stop: whatever was in flight —
        // a generator job, for instance — really dies here.
        const hard = setTimeout(() => child.kill("SIGKILL"), 2000);
        child.once("exit", () => {
          clearTimeout(hard);
          resolve();
        });
        child.kill("SIGTERM");
      }),
  };
}

/** Poll `url` until it answers, or fail with the process output attached. */
export async function waitForHttp(
  url: string,
  proc: ManagedProcess,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `${label}: ${url} did not become ready within ${timeoutMs}ms (last: ${lastError})\n` +
      `--- process output ---\n${proc.output()}`,
  );
}
