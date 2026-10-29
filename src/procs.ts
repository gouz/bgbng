import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { basename, join } from "node:path";
import { type Config, type Instance, repo } from "./state";

// ponytail: a pid recycled by the OS after a reboot reads as alive, `bgbng down` clears it
export const alive = (pid: number) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const logFile = (name: string, proc: string) => join(repo().dir, "logs", `${name}.${proc}.log`);

/** Process env for an instance: main keeps compose's default project name, worktrees get their own. */
export const envOf = (name: string) => ({
  ...process.env,
  ...(name !== "main" && {
    COMPOSE_PROJECT_NAME: `${basename(repo().root)}-${name}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
  }),
});

export function start(name: string, i: Instance, c: Config) {
  for (const [proc, cmd] of Object.entries(c.procs ?? {})) {
    if (i.procs[proc] && alive(i.procs[proc])) continue;
    const log = openSync(logFile(name, proc), "a");
    // detached = own process group, so stop() can kill the whole tree (bun run dev spawns children)
    const child = spawn("sh", ["-c", cmd], { cwd: i.path, detached: true, stdio: ["ignore", log, log], env: envOf(name) });
    child.unref();
    i.procs[proc] = child.pid!;
  }
}

export async function stop(i: Instance) {
  const pids = Object.values(i.procs).filter(alive);
  const kill = (sig: NodeJS.Signals) => pids.forEach((p) => alive(p) && process.kill(-p, sig));
  kill("SIGTERM");
  for (let t = 0; t < 100 && pids.some(alive); t++) await Bun.sleep(100); // 10s, docker compose needs it
  kill("SIGKILL");
  i.procs = {};
}
