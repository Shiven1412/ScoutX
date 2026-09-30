import { describe, expect, it } from "vitest";
import { GeminiScoringError, geminiHttpError, parseStructuredJson, scoreIntentWithFallback, scoreIntentWithKeywords } from "@/services/ai";
import { insertSignalBatch, SignalInsertError } from "@/services/signals/persistence";

describe("keyword signal scoring fallback", () => {
  it("scores explicit product relevance and buying-intent cues deterministically", () => {
    const result = scoreIntentWithKeywords({
      keyword: "AI support chatbot",
      context: "We need an AI support chatbot for our team. We are looking for pricing and recommendations this week.",
    });

    expect(result.category).toBe("buying_intent");
    expect(result.confidence).toBeGreaterThan(35);
    expect(result.intent_score).toBeGreaterThan(25);
    expect(result.buying_probability).toBeGreaterThan(15);
    expect(result.urgency).toBeGreaterThan(10);
    expect(Object.keys(result)).toEqual([
      "category", "confidence", "intent_score", "pain_intensity", "buying_probability", "urgency", "decision_maker_likelihood", "budget_intent", "is_qualified", "rejection_reason", "sales_opportunity_summary", "detected_pain_point", "title_relevance", "snippet_relevance", "source_weight",
    ]);
  });

  it("uses category-specific pain and alternative language", () => {
    const pain = scoreIntentWithKeywords({ keyword: "analytics", context: "Our current analytics tool is broken and difficult to use." });
    const alternative = scoreIntentWithKeywords({ keyword: "analytics", context: "We need an alternative to replace our analytics platform." });

    expect(pain.category).toBe("pain_point");
    expect(pain.pain_intensity).toBeGreaterThan(alternative.pain_intensity);
    expect(alternative.category).toBe("seeking_alternative");
  });

  it("weights the title more heavily than the snippet and discounts lower-specificity sources", () => {
    const titleMatch = scoreIntentWithKeywords({ keyword: "analytics platform", title: "Analytics platform recommendations", context: "Somebody asked for recommendations.", source: "hackernews" });
    const snippetMatch = scoreIntentWithKeywords({ keyword: "analytics platform", title: "Product discussion", context: "We need an analytics platform and recommendations.", source: "serper" });
    expect(titleMatch.title_relevance).toBe(2);
    expect(snippetMatch.intent_score).toBeGreaterThan(titleMatch.intent_score);
    expect(titleMatch.source_weight).toBe(0.95);
    expect(snippetMatch.source_weight).toBe(0.85);
  });

  it("classifies Gemini failure types without exposing the API key", () => {
    const missingKey = new GeminiScoringError("missing_api_key", "Gemini API key missing.");
    const quota = new GeminiScoringError("quota_exceeded", "Gemini quota exceeded (HTTP 429).", 429);
    const malformed = new GeminiScoringError("response_parse_failed", "Gemini returned malformed JSON.");
    expect(missingKey.code).toBe("missing_api_key");
    expect(quota.code).toBe("quota_exceeded");
    expect(quota.status).toBe(429);
    expect(malformed.code).toBe("response_parse_failed");
    expect(() => parseStructuredJson("<html>proxy block</html>", "Gemini")).toThrow(/HTML or XML instead of JSON/);
    expect(() => parseStructuredJson("{invalid json", "Gemini")).toThrow(/malformed structured data/);
  });

  it("uses keyword fallback for missing Gemini and malformed responses", () => {
    const input = { keyword: "support chatbot", context: "We need a support chatbot recommendation for our team." };
    const unavailable = scoreIntentWithFallback(input, new GeminiScoringError("missing_api_key", "Gemini API key missing."));
    const malformed = scoreIntentWithFallback(input, new GeminiScoringError("response_parse_failed", "Gemini returned HTML instead of JSON."));
    expect(unavailable.model).toBe("deterministic-fallback");
    expect(unavailable.fallbackCode).toBe("missing_api_key");
    expect(unavailable.intent_score).toBeGreaterThan(0);
    expect(malformed.fallbackCode).toBe("response_parse_failed");
  });

  it("distinguishes Gemini quota exhaustion, rate limiting, and unavailable model errors", () => {
    expect(geminiHttpError(429, JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "quota exceeded" } })).code).toBe("quota_exceeded");
    expect(geminiHttpError(429, JSON.stringify({ error: { status: "TOO_MANY_REQUESTS", message: "try again" } })).code).toBe("rate_limited");
    expect(geminiHttpError(404, "").code).toBe("model_unavailable");
  });

  it("handles Supabase insert success and null result", async () => {
    await expect(insertSignalBatch([{ id: 1 }], async () => ({ data: 1, error: null }))).resolves.toBe(1);
    await expect(insertSignalBatch([{ id: 1 }], async () => ({ data: null, error: null }))).resolves.toBe(0);
  });

  it("passes all 73 prepared signals to persistence without a hidden eight-record cap", async () => {
    const rows = Array.from({ length: 73 }, (_, id) => ({ id }));
    let persistedCount = 0;
    await insertSignalBatch(rows, async (batch) => {
      persistedCount = batch.length;
      return { data: batch.length, error: null };
    });
    expect(persistedCount).toBe(73);
  });

  it("surfaces Supabase insert failure with saved-before-failure counts", async () => {
    await expect(insertSignalBatch([{ id: 2 }], async () => ({ data: null, error: { code: "23502", message: "NOT NULL constraint failed" } }), 3))
      .rejects.toMatchObject({ name: "SignalInsertError", code: "23502", signalsSavedBeforeFailure: 3, failedBatchSize: 1 } satisfies Partial<SignalInsertError>);
  });
});