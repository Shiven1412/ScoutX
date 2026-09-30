import { describe, expect, it } from "vitest";
import { HACKER_NEWS_SEARCH_TAG, HackerNewsSignalProvider, normalizeApifyGoogleSearchPages } from "@/services/signals/providers";

describe("provider collection diagnostics", () => {
  it("queries only the first Hacker News tag, stories", () => {
    expect(HACKER_NEWS_SEARCH_TAG).toBe("story");
    expect(HACKER_NEWS_SEARCH_TAG).not.toContain(",");
  });

  it("normalizes Google Search Scraper organic results rather than the outer SERP page", () => {
    const page = {
      searchQuery: { term: "AI" },
      "#error": false,
      organicResults: [
        { title: "An AI tool for support", url: "https://example.com/ai-support", description: "A detailed product overview for AI customer support teams." },
      ],
    };
    const results = normalizeApifyGoogleSearchPages([page]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "https://example.com/ai-support", url: "https://example.com/ai-support", description: "A detailed product overview for AI customer support teams." });
  });

  it("distinguishes empty API responses from parser rejection and counts filtered records", () => {
    const provider = new HackerNewsSignalProvider();
    const empty = provider.collectionResult([], 0, [], [{ url: "https://hn.algolia.com/search", status: 200, recordsFetched: 0 }]);
    expect(empty.zeroReason).toBe("api_response_empty");

    const parserRejected = provider.collectionResult([], 2, [{ title: "short" }, { title: "unusable" }], [{ url: "https://hn.algolia.com/search", status: 200, recordsFetched: 2 }]);
    expect(parserRejected.recordsFetched).toBe(2);
    expect(parserRejected.recordsFiltered).toBe(2);
    expect(parserRejected.zeroReason).toBe("parser_failure");
    expect(parserRejected.rawPreview).toHaveLength(2);
  });

  it("classifies missing sources and rate limits and sanitizes raw previews", () => {
    const provider = new HackerNewsSignalProvider();
    const missingSource = provider.collectionResult([], 0, [], [], true);
    expect(missingSource.zeroReason).toBe("missing_source_list");

    const rateLimited = provider.collectionResult([], 0, [], [{ url: "https://api.example.test/search", status: 429, recordsFetched: 0 }]);
    expect(rateLimited.zeroReason).toBe("rate_limited");

    const preview = provider.collectionResult([], 1, [{ objectID: "123", title: "Email me at person@example.com", ignored_payload: "private" }], [{ url: "https://hn.algolia.com/search", status: 200, recordsFetched: 1 }]);
    expect(preview.rawPreview[0]).toEqual({ objectID: "123", title: "Email me at [REDACTED EMAIL]" });
  });
});