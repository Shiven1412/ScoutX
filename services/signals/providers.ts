import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getServerEnv } from "@/lib/env";
import { readJsonResponse } from "@/lib/http";

export type SignalTracker = {
  id: string;
  organization_id: string;
  keyword: string;
  negative_keywords: string[];
  communities: string[];
  platforms: string[];
  alert_threshold?: number;
  keywords?: string[];
  queries?: string[];
  sources?: Array<{ source_type: string; provider: string; source_value: string }>;
};

export type CollectedSignal = {
  platform: string;
  external_id: string;
  keyword: string;
  prospect_name: string | null;
  company: string | null;
  source_url: string | null;
  post_snippet: string;
  raw_payload: Record<string, string | number | boolean>;
  tracker_id: string;
};

export type ProviderRequestDiagnostic = { url: string; status: number | null; recordsFetched: number };
export type ProviderCollectionResult = {
  signals: CollectedSignal[];
  recordsFetched: number;
  recordsFiltered: number;
  requests: ProviderRequestDiagnostic[];
  rawPreview: Array<Record<string, string | number | boolean | null>>;
  warnings: string[];
  zeroReason: "missing_source_list" | "api_response_empty" | "parser_failure" | "rate_limited" | "provider_request_failed" | null;
};
export type ProviderCollectionOptions = { diagnosticMode?: boolean };
export const HACKER_NEWS_SEARCH_TAG = "story";

export interface SignalProvider {
  readonly name: "reddit" | "firecrawl" | "serper" | "apify" | "rss" | "hackernews";
  collectSignals(tracker: SignalTracker, options?: ProviderCollectionOptions): Promise<ProviderCollectionResult>;
  normalizeSignals(records: unknown[], tracker: SignalTracker): CollectedSignal[];
  healthCheck(): Promise<boolean>;
}

abstract class BaseSignalProvider implements SignalProvider {
  abstract readonly name: SignalProvider["name"];
  abstract collectSignals(tracker: SignalTracker, options?: ProviderCollectionOptions): Promise<ProviderCollectionResult>;
  abstract healthCheck(): Promise<boolean>;

  collectionResult(signals: CollectedSignal[], recordsFetched: number, records: unknown[], requests: ProviderRequestDiagnostic[], missingSource = false, warnings: string[] = []): ProviderCollectionResult {
    const recordsFiltered = Math.max(0, recordsFetched - signals.length);
    const rateLimited = requests.some((request) => request.status === 429);
    const requestFailed = requests.some((request) => request.status === null || request.status < 200 || request.status >= 300);
    const result: ProviderCollectionResult = {
      signals,
      recordsFetched,
      recordsFiltered,
      requests,
      rawPreview: records.slice(0, 10).map(safeRawPreview),
      warnings,
      zeroReason: signals.length ? null : missingSource ? "missing_source_list" : rateLimited ? "rate_limited" : warnings.length || (recordsFetched > 0 && signals.length === 0) ? "parser_failure" : requestFailed ? "provider_request_failed" : recordsFetched ? "parser_failure" : "api_response_empty",
    };
    console.log("Tracker provider collection summary", { provider: this.name, recordsFetched, recordsFiltered, signalsProduced: signals.length, zeroReason: result.zeroReason, requests });
    return result;
  }

  normalizeSignals(records: unknown[], tracker: SignalTracker): CollectedSignal[] {
    return records.flatMap((record) => {
      if (!isRecord(record)) return [];
      const externalId = getString(record, ["id", "external_id", "url", "link"]);
      const snippet = getString(record, ["text", "selftext", "body", "snippet", "description", "markdown", "title"]);
      if (!externalId || snippet.length < 20) return [];
      const url = getString(record, ["url", "permalink", "link", "source_url"]);
      const author = getString(record, ["author", "username", "user"]);
      return [{
        platform: this.name,
        external_id: externalId.slice(0, 500),
        keyword: tracker.keyword,
        prospect_name: author ? author.slice(0, 160) : null,
        company: null,
        source_url: isPublicHttpUrl(url) ? url : null,
        post_snippet: snippet.slice(0, 10_000),
        raw_payload: pickSafePayload(record),
        tracker_id: tracker.id,
      }];
    });
  }
}

export class RedditSignalProvider extends BaseSignalProvider {
  readonly name = "reddit" as const;
  private accessToken: { value: string; expiresAt: number } | undefined;

  async healthCheck() {
    const env = getServerEnv();
    return Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_USER_AGENT);
  }

  async collectSignals(tracker: SignalTracker) {
    const token = await this.getAccessToken();
    const savedSubreddits = tracker.sources?.filter((source) => source.source_type === "subreddit" && source.provider === "reddit").map((source) => source.source_value) ?? [];
    const communities = [...savedSubreddits, ...tracker.communities].map((value) => value.replace(/^r\//i, "").trim()).filter((value) => /^[A-Za-z0-9_]{2,21}$/.test(value));
    const targets = [...new Set(communities)].slice(0, 5);
    if (!targets.length) targets.push("");
    const keywords = [...new Set([...(tracker.keywords ?? []), tracker.keyword])].slice(0, 3);
    const posts: unknown[] = [];
    const rawRecords: unknown[] = [];
    const requests: ProviderRequestDiagnostic[] = [];
    let recordsFetched = 0;
    console.log("Tracker provider configuration", { provider: this.name, trackerId: tracker.id, keywords, sources: { subreddits: targets, communities: tracker.communities } });
    for (const community of targets) {
      for (const keyword of keywords) {
        const path = community ? `/r/${encodeURIComponent(community)}/search.json` : "/search.json";
        const url = new URL(`https://oauth.reddit.com${path}`);
        url.searchParams.set("q", keyword);
        url.searchParams.set("sort", "new");
        url.searchParams.set("t", "week");
        url.searchParams.set("limit", "15");
        if (community) url.searchParams.set("restrict_sr", "on");
        const result = await providerFetchJson(url, { headers: { authorization: `Bearer ${token}`, "user-agent": getServerEnv().REDDIT_USER_AGENT! } }, "Reddit", requests);
        const children = isRecord(result) && isRecord(result.data) && Array.isArray(result.data.children) ? result.data.children : [];
        recordsFetched += children.length;
        setRequestRecordCount(requests, children.length);
        for (const child of children) {
        if (!isRecord(child) || !isRecord(child.data)) continue;
        const post = child.data;
        rawRecords.push(post);
        const postId = getString(post, ["id"]);
        const permalink = getString(post, ["permalink"]);
        posts.push({ ...post, id: `reddit:${postId}`, url: permalink ? `https://www.reddit.com${permalink}` : "", matched_keyword: keyword });
        if (postId) {
          const commentsUrl = `https://oauth.reddit.com/comments/${encodeURIComponent(postId)}.json?limit=10&depth=1`;
          try {
            const comments = await providerFetchJson(new URL(commentsUrl), { headers: { authorization: `Bearer ${token}`, "user-agent": getServerEnv().REDDIT_USER_AGENT! } }, "Reddit comments", requests);
            const listing = Array.isArray(comments) ? comments[1] : null;
            const commentChildren = isRecord(listing) && isRecord(listing.data) && Array.isArray(listing.data.children) ? listing.data.children : [];
            recordsFetched += commentChildren.length;
            setRequestRecordCount(requests, commentChildren.length);
            for (const item of commentChildren.slice(0, 5)) {
              if (!isRecord(item) || !isRecord(item.data)) continue;
              const comment = item.data;
              rawRecords.push(comment);
              if (getString(comment, ["body"]).trim()) {
                const commentPermalink = getString(comment, ["permalink"]);
                posts.push({ ...comment, id: `reddit-comment:${getString(comment, ["id"])}`, url: commentPermalink ? `https://www.reddit.com${commentPermalink}` : "", post_title: getString(post, ["title"]), matched_keyword: keyword });
              }
            }
          } catch (error) {
            console.warn("Reddit comment collection failed for one post", error);
          }
        }
      }
      }
    }
    const signals = posts.flatMap((post) => isRecord(post) ? this.normalizeSignals([post], { ...tracker, keyword: getString(post, ["matched_keyword"]) || tracker.keyword }) : []);
    return this.collectionResult(signals, recordsFetched, rawRecords, requests);
  }

  private async getAccessToken() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 30_000) return this.accessToken.value;
    const env = getServerEnv();
    if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET || !env.REDDIT_USER_AGENT) throw new Error("Reddit credentials are not configured.");
    const basic = Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString("base64");
    const payload = await providerFetchJson(new URL("https://www.reddit.com/api/v1/access_token"), {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", "user-agent": env.REDDIT_USER_AGENT },
      body: "grant_type=client_credentials",
    }, "Reddit");
    if (!isRecord(payload) || typeof payload.access_token !== "string") throw new Error("Reddit did not issue an access token.");
    this.accessToken = { value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in ?? 3600) * 1000 };
    return this.accessToken.value;
  }
}

export class SerperSignalProvider extends BaseSignalProvider {
  readonly name = "serper" as const;

  async healthCheck() { return Boolean(getServerEnv().SERPER_API_KEY); }

  async collectSignals(tracker: SignalTracker) {
    const apiKey = getServerEnv().SERPER_API_KEY;
    if (!apiKey) throw new Error("Serper is not configured.");
    const baseQueries = [...new Set([...(tracker.queries ?? []), ...(tracker.keywords ?? []), tracker.keyword])].slice(0, 8);
    const siteTargets = (tracker.sources ?? [])
      .filter((source) => source.source_type === "community" && source.provider === "serper")
      .map((source) => serperSiteTarget(source.source_value))
      .filter((site): site is string => Boolean(site));
    const queries = siteTargets.length
      ? siteTargets.flatMap((siteGroup) => baseQueries.slice(0, Math.max(1, Math.floor(8 / siteTargets.length))).map((query) => `${siteGroup.split("|").map((site) => `site:${site}`).join(" OR ")} ${query}`)).slice(0, 8)
      : baseQueries;
    const collected: CollectedSignal[] = [];
    const requests: ProviderRequestDiagnostic[] = [];
    const rawRecords: unknown[] = [];
    let recordsFetched = 0;
    console.log("Tracker provider configuration", { provider: this.name, trackerId: tracker.id, keywords: baseQueries, sources: siteTargets, requestCount: queries.length });
    for (const query of queries) {
      console.log("Tracker provider API request", { provider: this.name, url: "https://google.serper.dev/search", method: "POST", query });
      const payload = await providerFetchJson(new URL("https://google.serper.dev/search"), {
        method: "POST", headers: { "content-type": "application/json", "X-API-KEY": apiKey }, body: JSON.stringify({ q: query, num: 10 }),
      }, "Serper", requests);
      const organic = isRecord(payload) && Array.isArray(payload.organic) ? payload.organic : [];
      recordsFetched += organic.length;
      rawRecords.push(...organic);
      setRequestRecordCount(requests, organic.length);
      for (const record of organic) {
        if (!isRecord(record)) continue;
        const url = getString(record, ["link", "url"]);
        const externalId = getString(record, ["link", "url", "title"]);
        const snippet = [getString(record, ["title"]), getString(record, ["snippet"]), getString(record, ["description"])].filter(Boolean).join("\n");
        if (!externalId || snippet.length < 20) continue;
        collected.push({ platform: sourcePlatformFromQuery(query), external_id: externalId.slice(0, 500), keyword: query, prospect_name: null, company: null, source_url: isPublicHttpUrl(url) ? url : null, post_snippet: snippet.slice(0, 10_000), raw_payload: pickSafePayload(record), tracker_id: tracker.id });
      }
    }
    return this.collectionResult(collected, recordsFetched, rawRecords, requests, queries.length === 0);
  }
}

export class FirecrawlSignalProvider extends BaseSignalProvider {
  readonly name = "firecrawl" as const;

  async healthCheck() { return Boolean(getServerEnv().FIRECRAWL_API_KEY); }

  async collectSignals(tracker: SignalTracker) {
    const apiKey = getServerEnv().FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("Firecrawl is not configured.");
    const records: unknown[] = [];
    const rawRecords: unknown[] = [];
    const requests: ProviderRequestDiagnostic[] = [];
    const warnings: string[] = [];
    const savedWebsites = tracker.sources?.filter((source) => source.source_type === "website" && source.provider === "firecrawl" && !isFeedUrl(source.source_value)).map((source) => source.source_value) ?? [];
    const trackedUrls = [...new Set([...savedWebsites, ...tracker.communities.filter((value) => /^https:\/\//i.test(value))].filter(isPublicHttpUrl))].slice(0, 10);
    const queries = [...new Set([...(tracker.queries ?? []), ...(tracker.keywords ?? []), tracker.keyword])];
    console.log("Tracker provider configuration", { provider: this.name, trackerId: tracker.id, keywords: queries, sources: trackedUrls });
    if (trackedUrls.length) {
      for (const url of trackedUrls) {
        try {
          const payload = await providerFetchJson(new URL("https://api.firecrawl.dev/v2/scrape"), {
            method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ url, formats: ["markdown", "rawHtml"], onlyMainContent: true }),
          }, "Firecrawl", requests);
          if (!isRecord(payload) || !isRecord(payload.data)) continue;
          const data = payload.data;
          recordsFetchedFromRequest(requests, 1);
          rawRecords.push({ url, ...data });
          const metadata = isRecord(data.metadata) ? data.metadata : {};
          const isFeed = /\.(rss|xml|atom)(?:$|\?)/i.test(new URL(url).pathname) || /\b(feed|rss|atom)\b/i.test(url);
          if (isFeed) records.push(...parseFeedRecords(url, data.rawHtml ?? data.html ?? data.markdown));
          else records.push({ id: url, url, markdown: data.markdown, title: metadata.title });
        } catch (error) {
          const warning = error instanceof Error ? error.message : "Unknown provider error";
          warnings.push(`${redactUrl(url)}: ${warning}`.slice(0, 500));
          console.warn("Firecrawl failed for one tracked source URL", { trackerId: tracker.id, url: redactUrl(url), message: warning });
        }
      }
    } else {
      if (!queries.length) return this.collectionResult([], 0, [], requests, true);
      const payload = await providerFetchJson(new URL("https://api.firecrawl.dev/v2/search"), {
        method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ query: queries[0], limit: 10 }),
      }, "Firecrawl", requests);
      const results = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
      recordsFetchedFromRequest(requests, results.length);
      rawRecords.push(...results);
      records.push(...results);
    }
    const signals = this.normalizeSignals(records, tracker);
    return this.collectionResult(signals, requests.reduce((sum, request) => sum + request.recordsFetched, 0), rawRecords, requests, trackedUrls.length === 0 && !queries.length, warnings);
  }
}

export class ApifySignalProvider extends BaseSignalProvider {
  readonly name = "apify" as const;

  async healthCheck() { const env = getServerEnv(); return Boolean(env.APIFY_TOKEN && env.APIFY_ACTOR_ID); }

  async collectSignals(tracker: SignalTracker) {
    const env = getServerEnv();
    if (!env.APIFY_TOKEN || !env.APIFY_ACTOR_ID) throw new Error("Apify token or actor ID is not configured.");
    const actor = encodeURIComponent(env.APIFY_ACTOR_ID);
    const url = new URL(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`);
    url.searchParams.set("timeout", "60");
    url.searchParams.set("limit", "50");
    const requests: ProviderRequestDiagnostic[] = [];
    console.log("Tracker provider configuration", { provider: this.name, trackerId: tracker.id, keywords: [tracker.keyword], sources: { actorId: env.APIFY_ACTOR_ID, maximumResults: 50 } });
    const isGoogleSearchScraper = /(?:^|\/)google-search-scraper$/i.test(env.APIFY_ACTOR_ID);
    const actorInput = isGoogleSearchScraper
      ? { queries: tracker.keyword, maxPagesPerQuery: 1, resultsPerPage: 10 }
      : { searchStringsArray: [tracker.keyword], maxResults: 50 };
    const payload = await providerFetchJson(url, {
      method: "POST", headers: { authorization: `Bearer ${env.APIFY_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(actorInput),
    }, "Apify", requests);
    const datasetItems = Array.isArray(payload) ? payload : [];
    const searchPages = isGoogleSearchScraper ? datasetItems.filter(isRecord) : [];
    const googleResults = isGoogleSearchScraper ? normalizeApifyGoogleSearchPages(datasetItems) : [];
    const rawRecords = isGoogleSearchScraper ? googleResults : datasetItems;
    const recordsFetched = isGoogleSearchScraper ? googleResults.length : datasetItems.length;
    recordsFetchedFromRequest(requests, recordsFetched);
    const signals = this.normalizeSignals(rawRecords, tracker);
    const warnings = isGoogleSearchScraper
      ? searchPages.flatMap((page) => page["#error"] !== undefined && page["#error"] !== false && page["#error"] !== "false" ? [`Apify Google Search Scraper reported an error: ${scrubPreviewText(String(page["#error"]))}`] : [])
      : [];
    return this.collectionResult(signals, recordsFetched, rawRecords, requests, false, warnings);
  }
}

export function normalizeApifyGoogleSearchPages(pages: unknown[]) {
  return pages.filter(isRecord).flatMap((page) => Array.isArray(page.organicResults) ? page.organicResults.filter(isRecord).map((record) => ({
    ...record,
    id: getString(record, ["url", "link"]),
    url: getString(record, ["url", "link"]),
    description: getString(record, ["description", "snippet"]),
  })) : []);
}

export class RssSignalProvider extends BaseSignalProvider {
  readonly name = "rss" as const;

  async healthCheck() { return true; }

  async collectSignals(tracker: SignalTracker) {
    const feedUrls = tracker.sources?.filter((source) => source.source_type === "website" && source.provider === "firecrawl" && isFeedUrl(source.source_value)).map((source) => source.source_value) ?? [];
    if (!feedUrls.length) throw new Error("No public RSS feed URLs were added to this tracker. Add a feed URL in the tracker plan or select another source.");
    const records: unknown[] = [];
    const requests: ProviderRequestDiagnostic[] = [];
    const rawRecords: unknown[] = [];
    const warnings: string[] = [];
    let recordsFetched = 0;
    const targets = [...new Set(feedUrls)].slice(0, 10);
    console.log("Tracker provider configuration", { provider: this.name, trackerId: tracker.id, keywords: tracker.queries ?? [tracker.keyword], sources: targets.map(redactUrl) });
    for (const feedUrl of targets) {
      if (!await isSafeFeedUrl(feedUrl)) {
        console.warn("RSS source skipped", { trackerId: tracker.id, reason: "unsafe_or_unresolvable_feed_url", url: redactUrl(feedUrl) });
        continue;
      }
      let response: Response;
      try {
        response = await fetch(feedUrl, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
      } catch {
        const request: ProviderRequestDiagnostic = { url: redactUrl(feedUrl), status: null, recordsFetched: 0 };
        requests.push(request);
        console.error("Tracker provider request failed", { provider: this.name, url: request.url, status: null, reason: "RSS feed could not be reached." });
        const failure = new Error("RSS feed could not be reached. Check the public feed URL and retry.");
        Object.assign(failure, { providerRequests: requests });
        throw failure;
      }
      const request: ProviderRequestDiagnostic = { url: redactUrl(feedUrl), status: response.status, recordsFetched: 0 };
      requests.push(request);
      console.log("Tracker provider HTTP response", { provider: this.name, url: request.url, status: response.status });
      if (!response.ok) {
        const warning = `RSS feed ${redactUrl(feedUrl)} returned HTTP ${response.status}.`;
        warnings.push(warning);
        console.warn("RSS source request failed", { trackerId: tracker.id, url: request.url, status: response.status });
        continue;
      }
      const body = await response.text();
      if (body.length > 1_000_000) throw new Error("RSS feed response was too large to process.");
      const entryCount = body.match(/<(?:item|entry)\b/gi)?.length ?? 0;
      recordsFetched += entryCount;
      const parsedRecords = parseFeedRecords(feedUrl, body);
      request.recordsFetched = entryCount;
      rawRecords.push(...(body.match(/<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)>/gi) ?? []).slice(0, 10));
      records.push(...parsedRecords);
    }
    const signals = records.flatMap((record) => isRecord(record) ? this.normalizeSignals([record], tracker) : []);
    return this.collectionResult(signals, recordsFetched, rawRecords, requests, targets.length === 0, warnings);
  }
}

export class HackerNewsSignalProvider extends BaseSignalProvider {
  readonly name = "hackernews" as const;

  async healthCheck() { return true; }

  async collectSignals(tracker: SignalTracker) {
    const queries = [...new Set([...(tracker.queries ?? []), ...(tracker.keywords ?? []), tracker.keyword])].slice(0, 5);
    const signals: CollectedSignal[] = [];
    const requests: ProviderRequestDiagnostic[] = [];
    const rawRecords: unknown[] = [];
    let recordsFetched = 0;
    console.log("Tracker provider configuration", { provider: this.name, trackerId: tracker.id, keywords: queries, sources: tracker.sources ?? [] });
    for (const query of queries) {
      const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
      url.searchParams.set("query", query);
      url.searchParams.set("tags", HACKER_NEWS_SEARCH_TAG);
      url.searchParams.set("hitsPerPage", "20");
      const payload = await providerFetchJson(url, { headers: { accept: "application/json" } }, "Hacker News", requests);
      const hits = isRecord(payload) && Array.isArray(payload.hits) ? payload.hits : [];
      recordsFetched += hits.length;
      rawRecords.push(...hits);
      setRequestRecordCount(requests, hits.length);
      for (const hit of hits) {
        if (!isRecord(hit)) continue;
        const id = getString(hit, ["objectID"]);
        const content = getString(hit, ["comment_text", "story_text", "title"]);
        if (!id || content.replace(/<[^>]*>/g, " ").trim().length < 20) continue;
        const storyUrl = getString(hit, ["url", "story_url"]);
        const itemUrl = `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`;
        signals.push({ platform: "hackernews", external_id: id, keyword: query, prospect_name: getString(hit, ["author"]) || null, company: null, source_url: isPublicHttpUrl(storyUrl) ? storyUrl : itemUrl, post_snippet: content.replace(/<[^>]*>/g, " ").slice(0, 10_000), raw_payload: pickSafePayload(hit), tracker_id: tracker.id });
      }
    }
    return this.collectionResult(signals, recordsFetched, rawRecords, requests, queries.length === 0);
  }
}

export const signalProviders: Record<SignalProvider["name"], SignalProvider> = {
  reddit: new RedditSignalProvider(),
  firecrawl: new FirecrawlSignalProvider(),
  serper: new SerperSignalProvider(),
  apify: new ApifySignalProvider(),
  rss: new RssSignalProvider(),
  hackernews: new HackerNewsSignalProvider(),
};

export async function discoverSerperKeywords(seed: string) {
  const apiKey = getServerEnv().SERPER_API_KEY;
  if (!apiKey) throw new Error("Serper is not configured.");
  const payload = await providerFetchJson(new URL("https://google.serper.dev/search"), {
    method: "POST", headers: { "content-type": "application/json", "X-API-KEY": apiKey }, body: JSON.stringify({ q: seed, num: 10 }),
  }, "Serper");
  const related = isRecord(payload) && Array.isArray(payload.relatedSearches) ? payload.relatedSearches : [];
  return related.flatMap((item) => isRecord(item) && typeof item.query === "string" ? [item.query] : []).slice(0, 10);
}

export async function discoverSerperIntent(keyword: string) {
  const apiKey = getServerEnv().SERPER_API_KEY;
  if (!apiKey) throw new Error("Serper is not configured.");
  const payload = await providerFetchJson(new URL("https://google.serper.dev/search"), {
    method: "POST", headers: { "content-type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ q: `"${keyword}" (looking for OR need OR recommend OR alternative OR switch OR problem)`, num: 10 }),
  }, "Serper");
  return isRecord(payload) && Array.isArray(payload.organic) ? payload.organic : [];
}

async function providerFetchJson(url: URL, init: RequestInit, provider: string, diagnostics: ProviderRequestDiagnostic[] = []) {
  if (url.protocol !== "https:" || !["oauth.reddit.com", "www.reddit.com", "google.serper.dev", "api.firecrawl.dev", "api.apify.com", "hn.algolia.com"].includes(url.hostname)) throw new Error("Provider URL is not permitted.");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      const request: ProviderRequestDiagnostic = { url: redactUrl(url.toString()), status: response.status, recordsFetched: 0 };
      diagnostics.push(request);
      console.log("Tracker provider HTTP response", { provider, url: request.url, status: response.status, attempt: attempt + 1 });
      return await readJsonResponse(response, provider);
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
      const requestError = status !== undefined && (status < 200 || status >= 300);
      console.error(requestError ? "Tracker provider request failed" : "Tracker provider response could not be parsed", { provider, url: redactUrl(url.toString()), status: status ?? null, reason: error instanceof Error ? error.message : "Unknown response error" });
      if (!diagnostics.length || diagnostics.at(-1)?.status !== status) {
        const request: ProviderRequestDiagnostic = { url: redactUrl(url.toString()), status: status ?? null, recordsFetched: 0 };
        diagnostics.push(request);
        console.error("Tracker provider HTTP request failed", { provider, url: request.url, status: status ?? null, message: error instanceof Error ? error.message : "Unknown request error" });
      }
      if (attempt === 0 && (status === undefined || status === 429 || status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      if (error instanceof Error) Object.assign(error, { providerRequests: diagnostics });
      throw error;
    }
  }
  throw new Error(`${provider} request failed.`);
}

function setRequestRecordCount(requests: ProviderRequestDiagnostic[], count: number) {
  const request = requests.at(-1);
  if (request) request.recordsFetched = Math.max(0, count);
}

function recordsFetchedFromRequest(requests: ProviderRequestDiagnostic[], count: number) {
  setRequestRecordCount(requests, count);
}

function redactUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|auth|credential|signature/i.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch { return "[invalid provider URL]"; }
}

function safeRawPreview(value: unknown): Record<string, string | number | boolean | null> {
  if (!isRecord(value)) return { value: typeof value === "string" ? scrubPreviewText(value).slice(0, 500) : null };
  const safe: Record<string, string | number | boolean | null> = {};
  const allowed = /^(id|objectID|title|text|selftext|body|comment_text|story_text|snippet|description|markdown|url|link|permalink|author|username|subreddit|feed_url|matched_keyword)$/i;
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.test(key) || /email|phone|token|secret|credential/i.test(key)) continue;
    if (typeof item === "string") safe[key] = /^(url|link|permalink|feed_url)$/i.test(key) ? redactUrl(item).slice(0, 500) : scrubPreviewText(item).slice(0, 500);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) safe[key] = item;
    if (Object.keys(safe).length >= 12) break;
  }
  return safe;
}

function scrubPreviewText(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]")
    .replace(/(\b(?:token|api[_-]?key|secret|authorization|password)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
}

function sourcePlatformFromQuery(query: string) {
  if (/site:(?:www\.)?reddit\.com/i.test(query)) return "reddit";
  if (/site:(?:www\.)?x\.com/i.test(query)) return "x";
  if (/site:(?:www\.)?linkedin\.com/i.test(query)) return "linkedin";
  if (/site:(?:www\.)?news\.ycombinator\.com/i.test(query)) return "hackernews";
  if (/site:(?:www\.)?indiehackers\.com/i.test(query)) return "indiehackers";
  if (/site:(?:www\.)?producthunt\.com/i.test(query)) return "producthunt";
  if (/site:(?:www\.)?quora\.com/i.test(query)) return "quora";
  if (/site:(?:www\.)?github\.com/i.test(query)) return "github";
  if (/site:(?:www\.)?(?:stackoverflow\.com|discourse\.group|community\.atlassian\.com)/i.test(query)) return "techforums";
  return "serper";
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function getString(value: Record<string, unknown>, keys: string[]) { for (const key of keys) if (typeof value[key] === "string" && value[key].trim()) return value[key].trim(); return ""; }
function parseFeedRecords(feedUrl: string, value: unknown): unknown[] {
  if (typeof value !== "string") return [];
  const blocks = value.match(/<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  return blocks.slice(0, 25).flatMap((block, index) => {
    const title = xmlText(block, "title");
    const description = xmlText(block, "description") || xmlText(block, "summary") || xmlText(block, "content:encoded") || xmlText(block, "content");
    const linkTag = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
    const link = xmlText(block, "link") || linkTag?.[1] || "";
    const id = xmlText(block, "guid") || xmlText(block, "id") || link || `${feedUrl}#item-${index}`;
    const body = [title, description].filter(Boolean).join("\n");
    return body.length >= 20 ? [{ id, url: link, title, description: body, feed_url: feedUrl }] : [];
  });
}
function xmlText(block: string, tag: string) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() ?? "";
}
function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (isIP(host) !== 0) return false;
    return true;
  } catch { return false; }
}
async function isSafeFeedUrl(value: string) {
  if (!isPublicHttpUrl(value)) return false;
  try {
    const host = new URL(value).hostname;
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}
function isPrivateAddress(address: string) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.") || normalized.startsWith("::ffff:169.254.");
  }
  const [first, second] = address.split(".").map(Number);
  return first === 0 || first === 10 || first === 127 || first >= 224 || (first === 169 && second === 254) || (first === 172 && second !== undefined && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
function pickSafePayload(record: Record<string, unknown>): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(record).slice(0, 30)) {
    if (/token|secret|email|phone|credential/i.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") safe[key] = value;
  }
  return safe;
}

function serperSiteTarget(source: string) {
  const targets: Record<string, string> = {
    x: "x.com",
    linkedin: "linkedin.com",
    hackernews: "news.ycombinator.com",
    indiehackers: "indiehackers.com",
    producthunt: "producthunt.com",
    quora: "quora.com",
    github: "github.com",
    techforums: "stackoverflow.com|discourse.group|community.atlassian.com",
  };
  return targets[source];
}
function isFeedUrl(value: string) { return /\.(?:rss|xml|atom)(?:$|\?)/i.test(value) || /\b(?:feed|rss|atom)\b/i.test(value); }