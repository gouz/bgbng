#!/usr/bin/env -S bun --no-env-file
// --no-env-file: bun must not load the cwd's .env, it would leak main's ports into every instance
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Clipse } from "clipse";
import pkg from "../package.json";
import { allocSlot, isFree, ports, writeEnv } from "./env";
import { alive, envOf, logFile, start, stop } from "./procs";
import { dek, encrypt, keyAdd, keyInit, keyRotate } from "./secrets";
import { type Config, config, current, git, instance, load, repo, save } from "./state";

const NAME = /^[a-z0-9][a-z0-9_-]*$/;
const toplevel = () => git(["rev-parse", "--show-toplevel"]);

function sh(cmd: string, cwd: string, env: Record<string, string | undefined>) {
  if (Bun.spawnSync(["sh", "-c", cmd], { cwd, env, stdio: ["inherit", "inherit", "inherit"] }).exitCode !== 0)
    throw new Error(`setup step failed: ${cmd}`);
}

function excludeWorktrees() {
  const exclude = join(repo().root, ".git", "info", "exclude");
  if (!existsSync(exclude) || !readFileSync(exclude, "utf8").includes("/.worktrees/"))
    appendFileSync(exclude, "\n/.worktrees/\n");
}

const nameArg = [{ name: "name", description: "instance name (default: from cwd, or main)" }] as const;

const create = new Clipse("new", "create a worktree instance with its own ports and .env files")
  .addArguments([{ name: "name", description: "instance name (lowercase, digits, - and _)" }])
  .addOptions({ branch: { short: "b", description: "branch to check out or create (default: name)" } })
  .action(async ({ name }, { branch }) => {
    if (!name || !NAME.test(name) || name === "main") throw new Error("a valid name is required, e.g. bgbng new feat-x");
    const s = await load();
    if (s.instances[name]) throw new Error(`instance ${name} already exists`);
    const b = branch || name;
    const path = join(repo().root, ".worktrees", name);
    excludeWorktrees();
    const exists = Bun.spawnSync(["git", "show-ref", "--verify", "--quiet", `refs/heads/${b}`]).success;
    git(["worktree", "add", path, ...(exists ? [b] : ["-b", b])], repo().root);
    let c;
    try {
      c = await config(path);
    } catch (e) {
      git(["worktree", "remove", "--force", path], repo().root);
      throw e;
    }
    const i = (s.instances[name] = { slot: await allocSlot(c, s), branch: b, path, procs: {} });
    await save(s);
    await writeEnv(name, i, c);
    for (const cmd of c.setup ?? []) sh(cmd, path, envOf(name));
    console.log(`${name} ready in ${path} (slot ${i.slot})`);
  });

const env = new Clipse("env", "regenerate the .env files of an instance")
  .addArguments(nameArg)
  .action(async ({ name }) => {
    const s = await load();
    const n = current(name);
    const i = instance(s, n);
    await writeEnv(n, i, await config(i.path));
    await save(s);
  });

const up = new Clipse("up", "regenerate .env files and start the processes of an instance")
  .addArguments(nameArg)
  .action(async ({ name }) => {
    const s = await load();
    const n = current(name);
    const i = instance(s, n);
    const c = await config(i.path);
    await writeEnv(n, i, c);
    // slot 0 is never checked at allocation, and anything may have grabbed a port since
    if (!Object.values(i.procs).some(alive))
      for (const [k, p] of Object.entries(ports(c, i.slot)))
        if (!(await isFree(p))) console.warn(`warning: port ${p} (${k}) is already in use by another program`);
    start(n, i, c);
    await save(s);
    console.log(`${n} up: ${Object.entries(ports(c, i.slot)).map(([k, p]) => `${k}=${p}`).join(" ")}`);
  });

const down = new Clipse("down", "stop the processes of an instance")
  .addArguments(nameArg)
  .addOptions({ all: { short: "a", type: "boolean", description: "stop every instance" } })
  .action(async ({ name }, { all }) => {
    const s = await load();
    for (const n of all ? Object.keys(s.instances) : [current(name)]) await stop(instance(s, n));
    await save(s);
  });

const ls = new Clipse("ls", "list instances, their ports and processes").action(async () => {
  const s = await load();
  instance(s, "main");
  const rows = await Promise.all(
    Object.entries(s.instances).map(async ([n, i]) => {
      const c = await config(i.path).catch((): Config => ({}));
      const p = Object.entries(ports(c, i.slot)).map(([k, v]) => `${k}:${v}`).join(" ");
      const procs = Object.keys(c.procs ?? {}).map((k) => `${k}:${i.procs[k] && alive(i.procs[k]) ? "up" : "down"}`);
      return [n, String(i.slot), i.branch || "-", p || "-", procs.join(" ") || "-"];
    }),
  );
  rows.unshift(["NAME", "SLOT", "BRANCH", "PORTS", "PROCS"]);
  const w = rows[0]!.map((_, col) => Math.max(...rows.map((r) => r[col]!.length)));
  for (const r of rows) console.log(r.map((v, col) => v.padEnd(w[col]!)).join("  ").trimEnd());
});

const logs = new Clipse("logs", "follow the logs of an instance")
  .addArguments([...nameArg, { name: "proc", description: "a single process (default: all)" }])
  .action(async ({ name, proc }) => {
    const n = current(name);
    const i = instance(await load(), n);
    const procs = proc ? [proc] : Object.keys((await config(i.path)).procs ?? {});
    const files = procs.map((p) => logFile(n, p)).filter(existsSync);
    if (!files.length) throw new Error(`no logs for ${n}`);
    await Bun.spawn(["tail", "-n", "100", "-f", ...files], { stdio: ["inherit", "inherit", "inherit"] }).exited;
  });

const rm = new Clipse("rm", "stop an instance, remove its worktree and free its slot (the branch is kept)")
  .addArguments([{ name: "name", description: "instance name" }])
  .addOptions({ force: { short: "f", type: "boolean", description: "remove even with uncommitted changes" } })
  .action(async ({ name }, { force }) => {
    if (!name || name === "main") throw new Error("name of a worktree instance required");
    const s = await load();
    const i = instance(s, name);
    await stop(i);
    git(["worktree", "remove", ...(force ? ["--force"] : []), i.path], repo().root);
    delete s.instances[name];
    await save(s);
  });

const enc = new Clipse("encrypt", "encrypt a value for bgbng.toml (reads stdin when no value is given)")
  .addArguments([{ name: "value", description: "plain value, prefer stdin to keep it out of shell history" }])
  .action(async ({ value }) => {
    const v = value ?? (await Bun.stdin.text()).replace(/\n$/, "");
    console.log(await encrypt(v, await dek(toplevel())));
  });

const key = new Clipse("key", "manage who can decrypt the secrets").addSubcommands([
  new Clipse("init", "create the data key, readable by your SSH key")
    .addOptions({ pub: { description: "SSH public key file (default: ~/.ssh/id_ed25519.pub)", optional: true } })
    .action(async (_, { pub }) => {
      await keyInit(toplevel(), pub);
      console.log("created .bgbng/key.age and .bgbng/recipients.txt, commit them");
    }),
  new Clipse("add", "give a teammate access")
    .addArguments([{ name: "who", description: "@github-user, a .pub file, or a public key line" }])
    .action(async ({ who }) => {
      if (!who) throw new Error("who is required");
      await keyAdd(toplevel(), who);
      console.log(`${who} added, commit .bgbng/`);
    }),
  new Clipse("rotate", "new data key, re-encrypt bgbng.toml (after removing someone from recipients.txt)").action(
    async () => {
      await keyRotate(toplevel());
      console.log("rotated, commit bgbng.toml and .bgbng/");
    },
  ),
]);

const cli = new Clipse("bgbng", pkg.description, pkg.version)
  .addSubcommands([create, env, up, down, ls, logs, rm, enc, key])
  .action(() => cli.help());

await cli.ready().catch((e: Error) => {
  console.error(`bgbng: ${e.message}`);
  process.exit(1);
});
