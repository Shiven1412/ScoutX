import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerEnv } from "@/lib/env";

function encryptionKey() {
  if (typeof window !== "undefined") throw new Error("Secret encryption is server-only.");
  const encoded = getServerEnv().WEBHOOK_ENCRYPTION_KEY;
  if (!encoded) throw new Error("WEBHOOK_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) throw new Error("WEBHOOK_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(encrypted: string) {
  const [version, iv, tag, ciphertext] = encrypted.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unsupported encrypted secret format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
