import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ports } from "./env";
import { decrypt, dek, encrypt, keyAdd, keyInit } from "./secrets";

test("encrypt/decrypt round trip, tampering is rejected", async () => {
  const k = crypto.getRandomValues(new Uint8Array(32));
  const v = await encrypt("p@ss {{ports.db}} é", k);
  expect(v).toStartWith("enc:v1:");
  expect(await decrypt(v, k)).toBe("p@ss {{ports.db}} é");
  expect(await encrypt("x", k)).not.toBe(await encrypt("x", k)); // random iv
  const raw = Buffer.from(v.slice(7), "base64");
  raw[raw.length - 1]! ^= 1;
  expect(decrypt(`enc:v1:${raw.toString("base64")}`, k)).rejects.toThrow();
  expect(decrypt(v, crypto.getRandomValues(new Uint8Array(32)))).rejects.toThrow();
});

test("ports shift by slot * step", () => {
  expect(ports({ ports: { web: 3000, db: 5432 } }, 0)).toEqual({ web: 3000, db: 5432 });
  expect(ports({ ports: { web: 3000 } }, 2)).toEqual({ web: 3020 });
  expect(ports({ step: 100, ports: { web: 3000 } }, 3)).toEqual({ web: 3300 });
});

test("data key is shared with ed25519 and rsa SSH keys, passphrase keys are refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bgbng-"));
  const ssh = (name: string, type: string, pass = "") =>
    Bun.spawnSync(["ssh-keygen", "-q", "-t", type, "-N", pass, "-f", join(dir, name)]) && join(dir, name);
  const ed = ssh("ed", "ed25519"), rsa = ssh("rsa", "rsa"), other = ssh("other", "ed25519"), locked = ssh("locked", "ed25519", "pw");
  const as = (id: string) => ((process.env.BGBNG_IDENTITY = id), dek(dir));
  await keyInit(dir, `${ed}.pub`);
  const key = await as(ed);
  expect(key).toHaveLength(32);
  await keyAdd(dir, `${rsa}.pub`);
  expect(await as(rsa)).toEqual(key);
  expect(await as(ed)).toEqual(key);
  await expect(as(other)).rejects.toThrow("not in");
  await expect(as(locked)).rejects.toThrow("passphrase");
  delete process.env.BGBNG_IDENTITY;
});
