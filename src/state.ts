import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type Instance = { slot: number; branch: string; path: string; procs: Record<string, number> };
export type State = { instances: Record<string, Instance> };
export type Config = {
  step?: number;
  setup?: string[];
  ports?: Record<string, number>;
  env?: Record<string, Record<string, unknown>>;
  procs?: Record<string, string>;
};

export function git(args: string[], cwd?: string) {
  const r = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe" });
  if (!r.success) throw new Error(r.stderr.toString().trim() || `git ${args.join(" ")} failed`);
  return r.stdout.toString().trim();
}

let cached: { root: string; dir: string } | undefined;
/** Main checkout root and bgbng's private dir inside the shared .git (common to every worktree). */
export function repo() {
  if (cached) return cached;
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  // ponytail: assumes a non-bare repo whose .git sits at the root
  cached = { root: dirname(common), dir: join(common, "bgbng") };
  mkdirSync(join(cached.dir, "logs"), { recursive: true });
  return cached;
}

const stateFile = () => Bun.file(join(repo().dir, "state.json"));

export async function load(): Promise<State> {
  const f = stateFile();
  return (await f.exists()) ? f.json() : { instances: {} };
}

// ponytail: no lock, two bgbng commands mutating state at the same instant can lose an update
export const save = (s: State) => Bun.write(stateFile(), JSON.stringify(s, null, 2));

/** Instance name from the argument, or from the cwd (.worktrees/<name>), or "main". */
export function current(name?: string) {
  if (name) return name;
  const rel = process.cwd().startsWith(repo().root) ? process.cwd().slice(repo().root.length) : "";
  return rel.match(/^\/\.worktrees\/([^/]+)/)?.[1] ?? "main";
}

export function instance(s: State, name: string): Instance {
  if (name === "main") return (s.instances.main ??= { slot: 0, branch: "", path: repo().root, procs: {} });
  const i = s.instances[name];
  if (!i) throw new Error(`unknown instance: ${name}`);
  return i;
}

export async function config(path: string): Promise<Config> {
  const f = Bun.file(join(path, "bgbng.toml"));
  if (!(await f.exists())) throw new Error(`no bgbng.toml in ${path} (is it committed on this branch?)`);
  return Bun.TOML.parse(await f.text()) as Config;
}
