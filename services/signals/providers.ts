import "server-only";

import { isIP } from "node:net";
import { getServerEnv } from "@/lib/env";

export type SignalTracker = {
  id: string;
  organization_id: string;
  keyword: string;
  negative_keywords: string[];
  communities: string[];
  platforms: string[];
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

export interface SignalProvider {
  readonly name: "reddit" | "firecrawl" | "serper" | "apify";
  collectSignals(tracker: SignalTracker): Promise<CollectedSignal[]>;
  normalizeSignals(records: unknown[], tracker: SignalTracker): CollectedSignal[];
  healthCheck(): Promise<boolean>;
}

abstract class BaseSignalProvider implements SignalProvider {
  abstract readonly name: SignalProvider["name"];
  abstract collectSignals(tracker: SignalTracker): Promise<CollectedSignal[]>;
  abstract healthCheck(): Promise<boolean>;

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
    const communities = tracker.communities.map((value) => value.replace(/^r\//i, "").trim()).filter((value) => /^[A-Za-z0-9_]{2,21}$/.test(value));
    const targets = communities.length ? communities : [""];
    const posts: unknown[] = [];
    for (const community of targets) {
      const path = community ? `/r/${encodeURIComponent(community)}/search.json` : "/search.json";
      const url = new URL(`https://oauth.reddit.com${path}`);
      url.searchParams.set("q", tracker.keyword);
      url.searchParams.set("sort", "new");
      url.searchParams.set("t", "week");
      url.searchParams.set("limit", "15");
      if (community) url.searchParams.set("restrict_sr", "on");
      const response = await providerFetch(url, { headers: { authorization: `Bearer ${token}`, "user-agent": getServerEnv().REDDIT_USER_AGENT! } });
      const result: unknown = await response.json();
      const children = isRecord(result) && isRecord(result.data) && Array.isArray(result.data.children) ? result.data.children : [];
      for (const child of children) {
        if (!isRecord(child) || !isRecord(child.data)) continue;
        const post = child.data;
        const postId = getString(post, ["id"]);
        const permalink = getString(post, ["permalink"]);
        posts.push({ ...post, id: `reddit:${postId}`, url: permalink ? `https://www.reddit.com${permalink}` : "" });
        if (postId) {
          const commentsUrl = `https://oauth.reddit.com/comments/${encodeURIComponent(postId)}.json?limit=10&depth=1`;
          try {
            const commentsResponse = await providerFetch(new URL(commentsUrl), { headers: { authorization: `Bearer ${token}`, "user-agent": getServerEnv().REDDIT_USER_AGENT! } });
            const comments: unknown = await commentsResponse.json();
            const listing = Array.isArray(comments) ? comments[1] : null;
            const commentChildren = isRecord(listing) && isRecord(listing.data) && Array.isArray(listing.data.children) ? listing.data.children : [];
            for (const item of commentChildren.slice(0, 5)) {
              if (!isRecord(item) || !isRecord(item.data)) continue;
              const comment = item.data;
              if (getString(comment, ["body"]).trim()) {
                const commentPermalink = getString(comment, ["permalink"]);
                posts.push({ ...comment, id: `reddit-comment:${getString(comment, ["id"])}`, url: commentPermalink ? `https://www.reddit.com${commentPermalink}` : "", post_title: getString(post, ["title"]) });
              }
            }
          } catch (error) {
            console.warn("Reddit comment collection failed for one post", error);
          }
        }
      }
    }
    return this.normalizeSignals(posts, tracker);
  }

  private async getAccessToken() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 30_000) return this.accessToken.value;
    const env = getServerEnv();
    if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET || !env.REDDIT_USER_AGENT) throw new Error("Reddit credentials are not configured.");
    const basic = Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString("base64");
    const response = await providerFetch(new URL("https://www.reddit.com/api/v1/access_token"), {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", "user-agent": env.REDDIT_USER_AGENT },
      body: "grant_type=client_credentials",
    });
    const payload: unknown = await response.json();
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
    const query = `"${tracker.keyword}" (looking for OR need OR recommend OR alternative OR switch OR problem)`;
    const response = await providerFetch(new URL("https://google.serper.dev/search"), {
      method: "POST", headers: { "content-type": "application/json", "X-API-KEY": apiKey }, body: JSON.stringify({ q: query, num: 10 }),
    });
    const payload: unknown = await response.json();
    const organic = isRecord(payload) && Array.isArray(payload.organic) ? payload.organic : [];
    return this.normalizeSignals(organic, tracker);
  }
}

export class FirecrawlSignalProvider extends BaseSignalProvider {
  readonly name = "firecrawl" as const;

  async healthCheck() { return Boolean(getServerEnv().FIRECRAWL_API_KEY); }

  async collectSignals(tracker: SignalTracker) {
    const apiKey = getServerEnv().FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("Firecrawl is not configured.");
    const records: unknown[] = [];
    const trackedUrls = tracker.communities.filter(isPublicHttpUrl).slice(0, 10);
    if (trackedUrls.length) {
      for (const url of trackedUrls) {
        try {
          const response = await providerFetch(new URL("https://api.firecrawl.dev/v2/scrape"), {
            method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ url, formats: ["markdown", "rawHtml"], onlyMainContent: true }),
          });
          const payload: unknown = await response.json();
          if (!isRecord(payload) || !isRecord(payload.data)) continue;
          const data = payload.data;
          const metadata = isRecord(data.metadata) ? data.metadata : {};
          const isFeed = /\.(rss|xml|atom)(?:$|\?)/i.test(new URL(url).pathname) || /\b(feed|rss|atom)\b/i.test(url);
          if (isFeed) records.push(...parseFeedRecords(url, data.rawHtml ?? data.html ?? data.markdown));
          else records.push({ id: url, url, markdown: data.markdown, title: metadata.title });
        } catch (error) {
          console.warn("Firecrawl failed for one tracked source URL", error);
        }
      }
    } else {
      const response = await providerFetch(new URL("https://api.firecrawl.dev/v2/search"), {
        method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ query: tracker.keyword, limit: 10 }),
      });
      const payload: unknown = await response.json();
      const results = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
      records.push(...results);
    }
    return this.normalizeSignals(records, tracker);
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
    url.searchParams.set("token", env.APIFY_TOKEN);
    url.searchParams.set("timeout", "60");
    url.searchParams.set("limit", "50");
    const response = await providerFetch(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ searchStringsArray: [tracker.keyword], maxResults: 50 }),
    });
    const payload: unknown = await response.json();
    return this.normalizeSignals(Array.isArray(payload) ? payload : [], tracker);
  }
}

export const signalProviders: Record<SignalProvider["name"], SignalProvider> = {
  reddit: new RedditSignalProvider(),
  firecrawl: new FirecrawlSignalProvider(),
  serper: new SerperSignalProvider(),
  apify: new ApifySignalProvider(),
};

export async function discoverSerperKeywords(seed: string) {
  const apiKey = getServerEnv().SERPER_API_KEY;
  if (!apiKey) throw new Error("Serper is not configured.");
  const response = await providerFetch(new URL("https://google.serper.dev/search"), {
    method: "POST", headers: { "content-type": "application/json", "X-API-KEY": apiKey }, body: JSON.stringify({ q: seed, num: 10 }),
  });
  const payload: unknown = await response.json();
  const related = isRecord(payload) && Array.isArray(payload.relatedSearches) ? payload.relatedSearches : [];
  return related.flatMap((item) => isRecord(item) && typeof item.query === "string" ? [item.query] : []).slice(0, 10);
}

export async function discoverSerperIntent(keyword: string) {
  const apiKey = getServerEnv().SERPER_API_KEY;
  if (!apiKey) throw new Error("Serper is not configured.");
  const response = await providerFetch(new URL("https://google.serper.dev/search"), {
    method: "POST", headers: { "content-type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ q: `"${keyword}" (looking for OR need OR recommend OR alternative OR switch OR problem)`, num: 10 }),
  });
  const payload: unknown = await response.json();
  return isRecord(payload) && Array.isArray(payload.organic) ? payload.organic : [];
}

export async function providerFetch(url: URL, init: RequestInit) {
  if (url.protocol !== "https:" || !["oauth.reddit.com", "www.reddit.com", "google.serper.dev", "api.firecrawl.dev", "api.apify.com"].includes(url.hostname)) throw new Error("Provider URL is not permitted.");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    if (response.ok) return response;
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    throw new Error(`Signal provider request failed with status ${response.status}.`);
  }
  throw new Error("Signal provider request failed.");
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
function pickSafePayload(record: Record<string, unknown>): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(record).slice(0, 30)) {
    if (/token|secret|email|phone|credential/i.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") safe[key] = value;
  }
  return safe;
}