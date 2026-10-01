import { z } from "zod";

export const discoverySourceIds = ["reddit", "x", "linkedin", "hackernews", "indiehackers", "producthunt", "quora", "techforums", "github", "websites", "rss"] as const;
export const discoveryBackendBySource = {
  reddit: "reddit",
  x: "serper",
  linkedin: "serper",
  hackernews: "hackernews",
  indiehackers: "serper",
  producthunt: "serper",
  quora: "serper",
  techforums: "serper",
  github: "serper",
  websites: "firecrawl",
  rss: "rss",
} as const;
export const discoverySourcesSchema = z.array(z.enum(discoverySourceIds)).min(1, "Select at least one discovery source.").max(discoverySourceIds.length).transform((items) => [...new Set(items)]);

const manualList = z.array(z.string().trim().min(2).max(240)).max(30).transform((items) => [...new Set(items)]);
const manualWebsiteList = z.array(z.string().trim().url().max(500).refine((value) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !["localhost", "127.0.0.1", "::1"].includes(host) && !host.endsWith(".local") && !host.endsWith(".internal");
  } catch { return false; }
}, "Use public HTTPS website or feed URLs.")).max(20).transform((items) => [...new Set(items)]);

export const manualTrackerSchema = z.object({
  keyword: z.string().trim().min(2).max(180),
  keywords: z.array(z.string().trim().min(2).max(240)).min(1).max(30).transform((items) => [...new Set(items)]),
  intentKeywords: manualList,
  negativeKeywords: manualList,
  communities: z.array(z.string().trim().regex(/^(?:r\/)?[A-Za-z0-9_]{2,21}$/, "Use subreddit names such as r/SaaS.")).max(20).transform((items) => [...new Set(items)]),
  sources: z.array(z.enum(["reddit", "serper", "firecrawl", "rss", "hackernews"])).min(1, "Select at least one discovery provider.").max(5).transform((items) => [...new Set(items)]),
  websites: manualWebsiteList,
  queries: manualList,
  alertThreshold: z.coerce.number().int().min(0).max(100),
});
export type ManualTrackerInput = z.infer<typeof manualTrackerSchema>;

const suggestionList = z.array(z.string().trim().min(2).max(240)).max(30).transform((items) => [...new Set(items.map((item) => item.trim()).filter(Boolean))]);
const productKeywordList = z.array(z.string().trim().min(2).max(240)).min(1).max(20).transform((items) => [...new Set(items.map((item) => item.trim()).filter(Boolean))]);
const subredditList = z.array(
  z.string().trim()
    .transform((value) => {
      const redditUrl = value.match(/^https?:\/\/(?:www\.)?reddit\.com\/r\/([^/?#]+)\/?$/i);
      const name = (redditUrl?.[1] ?? value).replace(/^\/?r\//i, "");
      return `r/${name}`;
    })
    .pipe(z.string().regex(/^r\/[A-Za-z0-9_]{2,21}$/, "Use a subreddit name such as r/SaaS.")),
  ).max(20).transform((items) => [...new Set(items)]);
const publicWebsiteList = z.array(z.string().trim().url().max(500).refine((value) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !["localhost", "127.0.0.1", "::1"].includes(host) && !host.endsWith(".local") && !host.endsWith(".internal");
  } catch { return false; }
}, "Use public HTTPS websites or feed URLs.")).max(20).transform((items) => [...new Set(items)]);

export const businessProfileSchema = z.object({
  businessSummary: z.string().trim().min(20).max(1200),
  industry: z.string().trim().min(2).max(120),
  targetAudience: suggestionList,
  painPoints: suggestionList,
  competitors: suggestionList,
  keywords: productKeywordList,
  intentKeywords: suggestionList,
  negativeKeywords: suggestionList,
  subreddits: subredditList,
  communities: suggestionList,
  websites: publicWebsiteList,
  searchQueries: suggestionList,
  buyingSignals: suggestionList,
  outreachAngles: suggestionList,
});

export const generatedBusinessProfileSchema = businessProfileSchema.extend({
  businessDescription: z.string().trim().min(20).max(3000),
  generatedAt: z.string().datetime(),
  model: z.string().min(1).max(80),
  promptVersion: z.string().min(1).max(40),
});

export type BusinessProfile = z.infer<typeof businessProfileSchema>;
export type GeneratedBusinessProfile = z.infer<typeof generatedBusinessProfileSchema>;
