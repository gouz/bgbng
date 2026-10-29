import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { repo } from "./state";

export const PREFIX = "enc:v1:";
const KEY = ".bgbng/key.age";
const RECIPIENTS = ".bgbng/recipients.txt";

function age(args: string[], stdin: Uint8Array | "inherit" = "inherit") {
  let r: ReturnType<typeof Bun.spawnSync>;
  try {
    r = Bun.spawnSync(["age", ...args], { stdin, stderr: "inherit" });
  } catch {
    throw new Error("age not found, install it: brew install age");
  }
  if (!r.success) throw new Error("age failed");
  return new Uint8Array(r.stdout as Buffer);
}

function identity() {
  const candidates = [process.env.BGBNG_IDENTITY, ...["id_ed25519", "id_rsa"].map((f) => join(homedir(), ".ssh", f))];
  const id = candidates.find((f) => f && existsSync(f));
  if (!id) throw new Error("no SSH private key found, set BGBNG_IDENTITY");
  return id;
}

/** The data key, decrypted with the user's SSH key, cached per key.age content in .git/bgbng. */
export async function dek(path: string) {
  const file = Bun.file(join(path, KEY));
  if (!(await file.exists())) throw new Error(`no ${KEY}, run: bgbng key init`);
  const hash = new Bun.CryptoHasher("sha256").update(await file.text()).digest("hex").slice(0, 16);
  const cache = Bun.file(join(repo().dir, `key-${hash}`));
  if (await cache.exists()) return new Uint8Array(await cache.arrayBuffer());
  const key = age(["-d", "-i", identity(), join(path, KEY)]);
  writeFileSync(cache.name!, key, { mode: 0o600 });
  return key;
}

const share = (path: string, key: Uint8Array) =>
  Bun.write(join(path, KEY), age(["-a", "-R", join(path, RECIPIENTS)], key));

const aes = (k: Uint8Array) => crypto.subtle.importKey("raw", new Uint8Array(k), "AES-GCM", false, ["encrypt", "decrypt"]);

export async function encrypt(v: string, k: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(k), new TextEncoder().encode(v));
  return PREFIX + Buffer.concat([iv, new Uint8Array(ct)]).toString("base64");
}

export async function decrypt(v: string, k: Uint8Array) {
  const b = Buffer.from(v.slice(PREFIX.length), "base64");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, await aes(k), b.subarray(12));
  return new TextDecoder().decode(pt);
}

export async function keyInit(path: string, pub = `${identity()}.pub`) {
  if (existsSync(join(path, KEY))) throw new Error(`${KEY} already exists`);
  mkdirSync(join(path, ".bgbng"), { recursive: true });
  await Bun.write(join(path, RECIPIENTS), await Bun.file(pub).text());
  await share(path, crypto.getRandomValues(new Uint8Array(32)));
}

/** who: "@github-user", a .pub file, or a literal "ssh-ed25519 AAAA..." line. */
export async function keyAdd(path: string, who: string) {
  const key = await dek(path); // fails early if the caller has no access
  let pubs: string;
  if (who.startsWith("@")) {
    const res = await fetch(`https://github.com/${who.slice(1)}.keys`);
    if (!res.ok) throw new Error(`cannot fetch keys of ${who}`);
    pubs = (await res.text()).split("\n").filter((l) => /^ssh-(ed25519|rsa) /.test(l)).join("\n");
    if (!pubs) throw new Error(`${who} has no ed25519/rsa key on GitHub`);
  } else pubs = existsSync(who) ? await Bun.file(who).text() : who;
  const recipients = Bun.file(join(path, RECIPIENTS));
  await Bun.write(recipients, `${(await recipients.text()).trimEnd()}\n# ${who}\n${pubs.trim()}\n`);
  await share(path, key);
}

/** New data key: re-encrypts every value of bgbng.toml, then key.age for the current recipients. */
export async function keyRotate(path: string) {
  const old = await dek(path);
  const next = crypto.getRandomValues(new Uint8Array(32));
  const toml = Bun.file(join(path, "bgbng.toml"));
  let text = await toml.text();
  for (const v of new Set(text.match(/enc:v1:[A-Za-z0-9+/=]+/g)))
    text = text.replaceAll(v, await encrypt(await decrypt(v, old), next));
  await share(path, next);
  await Bun.write(toml, text);
}
