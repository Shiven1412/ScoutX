import { describe, expect, it } from "vitest";
import { emailSchema, signInSchema, signUpSchema } from "@/lib/validation/auth";
import { leadSchema, outreachSchema, trackerSchema } from "@/lib/validation/records";

 describe("server-side validation", () => {
  it("rejects invalid email and weak passwords", () => {
    expect(emailSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "user@example.com", password: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ fullName: "A User", email: "a@example.com", password: "short", company: "Example" }).success).toBe(false);
  });

  it("normalizes tracker lists and rejects out-of-range thresholds", () => {
    const parsed = trackerSchema.safeParse({ keyword: " buyer intent ", negativeKeywords: "spam, spam", communities: "r/sales", platforms: "reddit", alertThreshold: 80 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.negativeKeywords).toEqual(["spam"]);
    expect(trackerSchema.safeParse({ keyword: "a", negativeKeywords: "", communities: "", platforms: "", alertThreshold: 101 }).success).toBe(false);
  });

  it("requires real lead data and bounded outreach content", () => {
    expect(leadSchema.safeParse({ name: "", company: "Polar", status: "new" }).success).toBe(false);
    expect(outreachSchema.safeParse({ channel: "email", subject: "Hi", content: "short" }).success).toBe(false);
    expect(outreachSchema.safeParse({ channel: "email", subject: "Hello", content: "This is a sufficiently complete message for review." }).success).toBe(true);
  });
});
