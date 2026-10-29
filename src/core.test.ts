import { expect, test } from "bun:test";
import { ports } from "./env";
import { decrypt, encrypt } from "./secrets";

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
