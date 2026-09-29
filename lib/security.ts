import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function safeRedirectPath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}

export function slugify(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function createSecret(prefix: string) {
  const token = `${prefix}_${randomBytes(32).toString("base64url")}`;
  return { token, hash: createHash("sha256").update(token).digest("hex"), prefix: token.slice(0, 12) };
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function equalOAuthState(expected: string | undefined, received: string | null) {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
