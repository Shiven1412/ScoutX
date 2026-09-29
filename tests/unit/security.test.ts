// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { safeRedirectPath, hashSecret } from "@/lib/security";

const originalKey = process.env.WEBHOOK_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.WEBHOOK_ENCRYPTION_KEY;
  else process.env.WEBHOOK_ENCRYPTION_KEY = originalKey;
});

describe("security primitives", () => {
  it("allows only same-origin relative redirects", () => {
    expect(safeRedirectPath("/settings/team")).toBe("/settings/team");
    expect(safeRedirectPath("https://attacker.example/")).toBe("/dashboard");
    expect(safeRedirectPath("//attacker.example")).toBe("/dashboard");
    expect(safeRedirectPath("/\\attacker.example")).toBe("/dashboard");
  });

  it("encrypts webhook secrets with authenticated encryption", () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const secret = "whsec_test_secret_not_for_a_real_account";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
    const [version, iv, tag, ciphertext] = encrypted.split(".");
    const changedTag = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
    expect(() => decryptSecret(`${version}.${iv}.${changedTag}.${ciphertext}`)).toThrow();
    expect(hashSecret(secret)).not.toBe(secret);
  });
});