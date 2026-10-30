import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  privateDecrypt,
  publicEncrypt,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PREFIX = "enc:v1:";
const KEY = ".bgbng/key.enc";
const RECIPIENTS = ".bgbng/recipients.txt";

function identity() {
  const candidates = [process.env.BGBNG_IDENTITY, ...["id_ed25519", "id_rsa"].map((f) => join(homedir(), ".ssh", f))];
  const id = candidates.find((f) => f && existsSync(f));
  if (!id) throw new Error("no SSH private key found, set BGBNG_IDENTITY");
  return id;
}

/** SSH wire format: uint32 values and uint32-length-prefixed strings. */
function reader(b: Buffer) {
  let i = 0;
  return {
    u32: () => ((i += 4), b.readUInt32BE(i - 4)),
    str: () => {
      const n = b.readUInt32BE(i);
      i += 4 + n;
      return b.subarray(i - n, i);
    },
  };
}

const big = (b: Buffer) => BigInt(`0x${b.toString("hex") || "0"}`);
const unbig = (n: bigint) => Buffer.from(n.toString(16).padStart(2 * Math.ceil(n.toString(16).length / 2), "0"), "hex");
const b64u = (b: Buffer) => unbig(big(b)).toString("base64url");

// ed25519 keys are converted to X25519 (same curve, Montgomery form) to do Diffie-Hellman.
const P = 2n ** 255n - 19n;
const pow = (b: bigint, e: bigint): bigint => (e ? (pow((b * b) % P, e >> 1n) * (e & 1n ? b : 1n)) % P : 1n);
function edToX(pub: Buffer) {
  const y = big(Buffer.from(pub).reverse()) & ((1n << 255n) - 1n);
  const u = ((1n + y) * pow((1n - y + P) % P, P - 2n)) % P;
  return Buffer.from(u.toString(16).padStart(64, "0"), "hex").reverse();
}
const X25519_SPKI = Buffer.from("302a300506032b656e032100", "hex");
const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const xPub = (raw: Buffer) => createPublicKey({ key: Buffer.concat([X25519_SPKI, raw]), format: "der", type: "spki" });
const xRaw = (k: KeyObject) => k.export({ format: "der", type: "spki" }).subarray(X25519_SPKI.length);
const kek = (secret: Buffer, eph: Buffer) => Buffer.from(hkdfSync("sha256", secret, eph, "bgbng", 32));

/** The user's SSH private key as an X25519 or RSA key. Passphrase-protected keys are refused. */
function myKey(): KeyObject {
  const file = identity();
  const text = readFileSync(file, "utf8");
  const refused = new Error(`${file} has a passphrase, not supported: point BGBNG_IDENTITY to a key without one`);
  if (!text.includes("OPENSSH PRIVATE KEY")) {
    try {
      return createPrivateKey(text); // legacy PEM RSA key
    } catch {
      throw refused;
    }
  }
  const r = reader(Buffer.from(text.replace(/-----[^-]+-----|\s/g, ""), "base64").subarray("openssh-key-v1\0".length));
  if (r.str().toString() !== "none") throw refused;
  r.str(), r.str(), r.u32(), r.str(); // kdf, kdf options, key count, public key
  const k = reader(r.str());
  k.u32(), k.u32(); // check ints
  const type = k.str().toString();
  if (type === "ssh-ed25519") {
    k.str(); // public key
    const scalar = createHash("sha512").update(k.str().subarray(0, 32)).digest().subarray(0, 32);
    return createPrivateKey({ key: Buffer.concat([X25519_PKCS8, scalar]), format: "der", type: "pkcs8" });
  }
  if (type === "ssh-rsa") {
    const [n, e, d, qi, p, q] = [k.str(), k.str(), k.str(), k.str(), k.str(), k.str()] as Buffer[];
    const crt = (x: Buffer) => unbig(big(d!) % (big(x) - 1n));
    const jwk = { kty: "RSA", n: b64u(n!), e: b64u(e!), d: b64u(d!), p: b64u(p!), q: b64u(q!), qi: b64u(qi!) };
    return createPrivateKey({ key: { ...jwk, dp: b64u(crt(p!)), dq: b64u(crt(q!)) }, format: "jwk" });
  }
  throw new Error(`${file}: ${type} keys are not supported, use ed25519 or rsa`);
}

/** Encrypts the data key for one "ssh-ed25519|ssh-rsa <base64> [comment]" recipient, as one line of key.enc. */
function wrap(key: Uint8Array, recipient: string) {
  const [type, b64] = recipient.split(/\s+/);
  const blob = reader(Buffer.from(b64!, "base64"));
  blob.str(); // type
  if (type === "ssh-ed25519") {
    const eph = generateKeyPairSync("x25519");
    const secret = diffieHellman({ privateKey: eph.privateKey, publicKey: xPub(edToX(blob.str())) });
    const iv = crypto.getRandomValues(Buffer.alloc(12));
    const c = createCipheriv("aes-256-gcm", kek(secret, xRaw(eph.publicKey)), iv);
    const ct = Buffer.concat([iv, c.update(key), c.final(), c.getAuthTag()]);
    return `x25519 ${xRaw(eph.publicKey).toString("base64")} ${ct.toString("base64")}`;
  }
  if (type === "ssh-rsa") {
    const [e, n] = [blob.str(), blob.str()];
    const pub = createPublicKey({ key: { kty: "RSA", n: b64u(n), e: b64u(e) }, format: "jwk" });
    return `rsa ${publicEncrypt({ key: pub, oaepHash: "sha256" }, key).toString("base64")}`;
  }
  throw new Error(`unsupported recipient key type ${type}, use ed25519 or rsa`);
}

/** Decrypts the data key from the key.enc line meant for this private key, if any. */
function unwrap(line: string, me: KeyObject) {
  const [type, a, b] = line.split(" ");
  try {
    if (type === "x25519" && me.asymmetricKeyType === "x25519") {
      const eph = Buffer.from(a!, "base64");
      const ct = Buffer.from(b!, "base64");
      const d = createDecipheriv("aes-256-gcm", kek(diffieHellman({ privateKey: me, publicKey: xPub(eph) }), eph), ct.subarray(0, 12));
      d.setAuthTag(ct.subarray(-16));
      return new Uint8Array(Buffer.concat([d.update(ct.subarray(12, -16)), d.final()]));
    }
    if (type === "rsa" && me.asymmetricKeyType === "rsa")
      return new Uint8Array(privateDecrypt({ key: me, oaepHash: "sha256" }, Buffer.from(a!, "base64")));
  } catch {} // line meant for another recipient
}

/** The data key, decrypted with the user's SSH key. */
export async function dek(path: string) {
  const file = Bun.file(join(path, KEY));
  if (!(await file.exists())) throw new Error(`no ${KEY}, run: bgbng key init`);
  const me = myKey();
  for (const line of (await file.text()).split("\n")) {
    const key = unwrap(line, me);
    if (key) return key;
  }
  throw new Error(`your SSH key is not in ${RECIPIENTS}, ask a teammate to run: bgbng key add`);
}

const share = async (path: string, key: Uint8Array) => {
  const recipients = (await Bun.file(join(path, RECIPIENTS)).text()).split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  await Bun.write(join(path, KEY), `${recipients.map((r) => wrap(key, r)).join("\n")}\n`);
};

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

/** New data key: re-encrypts every value of bgbng.toml, then key.enc for the current recipients. */
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
