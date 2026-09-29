import { describe, expect, it } from "vitest";
import { emailSchema, signInSchema, signUpSchema } from "@/lib/validation/auth";
import { leadSchema, outreachSchema, trackerSchema } from "@/lib/validation/records";
import { businessProfileSchema, discoveryBackendBySource, discoverySourcesSchema, manualTrackerSchema } from "@/lib/validation/tracker-profile";
import { parseStructuredJson } from "@/services/ai";
import { explainProviderFailure } from "@/services/system-diagnostics";
import { readJsonResponse } from "@/lib/http";

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

  it("validates structured AI tracker profiles and public sources", () => {
    const profile = {
      businessSummary: "Mobile development services for early-stage startups.",
      industry: "Software development",
      targetAudience: ["Seed-stage founders"],
      painPoints: ["Limited engineering capacity"],
      competitors: ["Development agencies"],
      keywords: ["mobile app development"],
      intentKeywords: ["looking for an app developer"],
      negativeKeywords: ["jobs", "careers"],
      subreddits: ["r/startups"],
      communities: ["Indie Hackers"],
      websites: ["https://example.com/feed.xml"],
      searchQueries: ["startup mobile app development agency"],
      buyingSignals: ["looking for an app developer"],
      outreachAngles: ["Discuss launch scope and delivery timelines"],
    };
    expect(businessProfileSchema.safeParse(profile).success).toBe(true);
    expect(businessProfileSchema.safeParse({ ...profile, keywords: [] }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...profile, subreddits: ["startups"] }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...profile, websites: ["http://localhost/admin"] }).success).toBe(false);
  });

  it("parses fenced JSON and rejects HTML responses from AI providers", () => {
    expect(parseStructuredJson('```json\n{"businessSummary":"Hello"}\n```')).toEqual({ businessSummary: "Hello" });
    expect(() => parseStructuredJson('<!DOCTYPE html><html><body>bad</body></html>')).toThrow(/HTML|non-JSON/i);
  });

  it("explains common live provider diagnostic failures", () => {
    expect(explainProviderFailure("Gemini AI", 401)).toMatch(/credentials.*correct and active/i);
    expect(explainProviderFailure("Apify", 403)).toMatch(/permissions.*scopes/i);
    expect(explainProviderFailure("Serper", 402)).toMatch(/billing or quota/i);
    expect(explainProviderFailure("Reddit", 503)).toMatch(/outage/i);
  });

  it("rejects HTML, malformed JSON, and failed HTTP responses safely", async () => {
    await expect(readJsonResponse(new Response("<!doctype html><html>not found</html>", { headers: { "content-type": "text/html" } }), "Gemini"))
      .rejects.toThrow(/HTML instead of JSON/);
    await expect(readJsonResponse(new Response("{broken", { headers: { "content-type": "application/json" } }), "Serper"))
      .rejects.toThrow(/malformed JSON/);
    await expect(readJsonResponse(new Response("<!doctype html>secret stack", { status: 404, headers: { "content-type": "text/html" } }), "Provider"))
      .rejects.toThrow(/status 404/);
  });

  it("validates selected sources and maps them to real collectors", () => {
    expect(discoverySourcesSchema.safeParse(["reddit", "rss", "hackernews"]).success).toBe(true);
    expect(discoverySourcesSchema.safeParse([]).success).toBe(false);
    expect(discoverySourcesSchema.safeParse(["linkedin", "unsupported"]).success).toBe(false);
    expect(discoveryBackendBySource.reddit).toBe("reddit");
    expect(discoveryBackendBySource.hackernews).toBe("hackernews");
    expect(discoveryBackendBySource.rss).toBe("rss");
    expect(discoveryBackendBySource.github).toBe("serper");
  });

  it("validates manually configured trackers and requires a real provider", () => {
    const manual = {
      keyword: "support software",
      keywords: ["support software", "customer service platform"],
      intentKeywords: ["looking for a support tool"],
      negativeKeywords: ["hiring"],
      communities: ["r/SaaS"],
      sources: ["reddit", "serper"],
      websites: ["https://example.com/feed.xml"],
      queries: ["best customer support tool"],
      alertThreshold: 75,
    };
    expect(manualTrackerSchema.safeParse(manual).success).toBe(true);
    expect(manualTrackerSchema.safeParse({ ...manual, sources: [] }).success).toBe(false);
    expect(manualTrackerSchema.safeParse({ ...manual, communities: ["not a subreddit"] }).success).toBe(false);
    expect(manualTrackerSchema.safeParse({ ...manual, websites: ["http://localhost/private"] }).success).toBe(false);
  });
});
