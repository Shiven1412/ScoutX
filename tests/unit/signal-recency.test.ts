import { describe, expect, it } from "vitest";
import { HackerNewsSignalProvider, type CollectedSignal } from "@/services/signals/providers";
import { isRecentSignal } from "@/services/signals/recency";

describe("signal recency", () => {
  it("accepts recent timestamps and Unix timestamps in seconds", () => {
    const now = Date.now();
    expect(isRecentSignal(new Date(now))).toBe(true);
    expect(isRecentSignal(Math.floor(now / 1000))).toBe(true);
  });

  it("rejects signals older than the six-month default", () => {
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 7);
    expect(isRecentSignal(oldDate)).toBe(false);
  });

  it("honors an explicit month window and rejects invalid dates", () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    expect(isRecentSignal(threeMonthsAgo, 2)).toBe(false);
    expect(isRecentSignal(threeMonthsAgo, 4)).toBe(true);
    expect(isRecentSignal("not-a-date")).toBe(false);
  });

  it("filters old and undated records at the shared provider boundary", () => {
    const provider = new HackerNewsSignalProvider();
    const makeSignal = (externalId: string, source_created_at?: string): CollectedSignal => ({
      platform: "hackernews",
      external_id: externalId,
      keyword: "analytics",
      prospect_name: null,
      company: null,
      source_url: "https://news.ycombinator.com/item?id=123",
      post_snippet: "A sufficiently detailed example public discussion signal.",
      source_created_at,
      raw_payload: {},
      tracker_id: "tracker-id",
    });
    const old = new Date();
    old.setMonth(old.getMonth() - 8);
    const result = provider.collectionResult(
      [makeSignal("old", old.toISOString()), makeSignal("undated"), makeSignal("recent", new Date().toISOString())],
      3,
      [],
      [],
    );
    expect(result.signals.map((signal) => signal.external_id)).toEqual(["recent"]);
    expect(result.signalsFilteredOld).toBe(1);
    expect(result.signalsFilteredUndated).toBe(1);
  });
});
