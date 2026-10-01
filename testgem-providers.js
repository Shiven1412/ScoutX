const timeout = (milliseconds = 45_000) => AbortSignal.timeout(milliseconds);

function redact(value = "") {
  return String(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/(api[_-]?key|token|secret|authorization)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

function parseJsonBody(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

function responseSummary(body, contentType) {
  if (contentType.includes("json")) {
    const parsed = parseJsonBody(body);
    if (parsed === undefined) return { format: "invalid-json", bytes: Buffer.byteLength(body), preview: redact(body.slice(0, 180)) };
    if (Array.isArray(parsed)) return {
      format: "json-array",
      count: parsed.length,
      firstItemKeys: parsed[0] && typeof parsed[0] === "object" ? Object.keys(parsed[0]).slice(0, 15) : [],
      firstItemError: parsed[0] && typeof parsed[0] === "object" ? String(parsed[0]["#error"] ?? "") : undefined,
      firstItemDebug: parsed[0] && typeof parsed[0] === "object" ? redact(JSON.stringify(parsed[0]["#debug"] ?? "")).slice(0, 200) : undefined,
      firstItemSearchQuery: parsed[0] && typeof parsed[0] === "object" ? redact(parsed[0].searchQuery ?? "") : undefined,
      firstItemOrganicResultsCount: parsed[0] && typeof parsed[0] === "object" && Array.isArray(parsed[0].organicResults) ? parsed[0].organicResults.length : undefined,
      firstOrganicResultKeys: parsed[0]?.organicResults?.[0] && typeof parsed[0].organicResults[0] === "object" ? Object.keys(parsed[0].organicResults[0]).slice(0, 20) : undefined,
    };
    const error = parsed?.error;
    const candidates = parsed?.candidates;
    const data = parsed?.data;
    const organic = parsed?.organic;
    const hits = parsed?.hits;
    return {
      format: "json-object",
      keys: Object.keys(parsed ?? {}).slice(0, 20),
      providerError: error ? redact(typeof error === "string" ? error : error.message ?? error.status ?? JSON.stringify(error)) : undefined,
      candidateCount: Array.isArray(candidates) ? candidates.length : undefined,
      dataCount: Array.isArray(data) ? data.length : undefined,
      organicCount: Array.isArray(organic) ? organic.length : undefined,
      hitsCount: Array.isArray(hits) ? hits.length : undefined,
      nbHits: typeof parsed.nbHits === "number" ? parsed.nbHits : undefined,
      dataKeys: data && !Array.isArray(data) && typeof data === "object" ? Object.keys(data).slice(0, 15) : undefined,
    };
  }
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return { format: contentType.includes("html") || /<html/i.test(body) ? "html" : "non-json", title: title ? redact(title) : undefined, bytes: Buffer.byteLength(body), preview: redact(body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 140)) };
}

async function probe(name, url, init = {}, timeoutMs = 45_000) {
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: timeout(timeoutMs) });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const body = await response.text();
    const summary = responseSummary(body, contentType);
    console.log(JSON.stringify({ provider: name, status: response.status, ok: response.ok, contentType, durationMs: Date.now() - started, ...summary }));
    return { response, body, summary };
  } catch (error) {
    console.log(JSON.stringify({ provider: name, ok: false, durationMs: Date.now() - started, error: redact(error instanceof Error ? `${error.name}: ${error.message}` : "Unknown network error") }));
    return undefined;
  }
}

async function testGemini() {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!key) return console.log(JSON.stringify({ provider: "Gemini", skipped: true, reason: "GEMINI_API_KEY is missing from the loaded environment." }));
  const result = await probe("Gemini generateContent", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: 'Return exactly this JSON object: {"ok":true}' }] }], generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 64 } }),
  });
  if (result?.summary.format === "html") console.log(JSON.stringify({ provider: "Gemini diagnosis", finding: "HTTP response is HTML, likely a proxy/gateway response rather than Gemini JSON. Check headers/body title above and approved network CA/proxy routing." }));
}

async function testFirecrawl() {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return console.log(JSON.stringify({ provider: "Firecrawl", skipped: true, reason: "FIRECRAWL_API_KEY is missing from the loaded environment." }));
  const result = await probe("Firecrawl scrape", "https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ url: "https://example.com", formats: ["markdown"], onlyMainContent: true }),
  });
  if (result?.summary.format === "html") console.log(JSON.stringify({ provider: "Firecrawl diagnosis", finding: "Scrape endpoint returned HTML rather than JSON; inspect its title, content-type, and response preview for proxy/login/block page evidence. API key value was not printed." }));
}

async function testApify() {
  const token = process.env.APIFY_TOKEN;
  const actorId = process.env.APIFY_ACTOR_ID;
  if (!token) return console.log(JSON.stringify({ provider: "Apify", skipped: true, reason: "APIFY_TOKEN is missing from the loaded environment." }));
  if (!actorId) return console.log(JSON.stringify({ provider: "Apify", skipped: true, reason: "APIFY_ACTOR_ID is missing from the loaded environment." }));
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  await probe("Apify token validation", "https://api.apify.com/v2/users/me", { headers });
  const actorPath = encodeURIComponent(actorId);
  const actorInfo = await probe("Apify actor metadata", `https://api.apify.com/v2/acts/${actorPath}`, { headers });
  const actorData = parseJsonBody(actorInfo?.body ?? "")?.data;
  if (actorData?.exampleRunInput && typeof actorData.exampleRunInput === "object") {
    const example = actorData.exampleRunInput;
    console.log(JSON.stringify({ provider: "Apify actor input hints", actor: actorId, inputKeys: Object.keys(example).slice(0, 30), exampleBody: typeof example.body === "string" ? redact(example.body).slice(0, 300) : undefined, queryFieldCandidates: Object.fromEntries(Object.entries(example).filter(([key]) => /query|search|result|page/i.test(key)).map(([key, value]) => [key, typeof value === "string" ? redact(value).slice(0, 100) : value])) }));
  }
  const runUrl = new URL(`https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items`);
  runUrl.searchParams.set("timeout", "60");
  runUrl.searchParams.set("limit", "5");
  let input;
  if (/google-search-scraper/i.test(actorId)) {
    input = { queries: "AI", maxPagesPerQuery: 1, resultsPerPage: 5 };
  } else {
    console.log(JSON.stringify({ provider: "Apify run", skipped: true, reason: "Configured actor is not the known Google Search Scraper; actor-specific input is not guessed. Metadata probe above verifies token and actor access." }));
    return;
  }
  await probe("Apify Google Search Scraper run", runUrl, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(input),
  }, 75_000);
}

async function testSerper() {
  const key = process.env.SERPER_API_KEY;
  if (!key) return console.log(JSON.stringify({ provider: "Serper", skipped: true, reason: "SERPER_API_KEY is missing from the loaded environment." }));
  await probe("Serper search", "https://google.serper.dev/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, accept: "application/json" },
    body: JSON.stringify({ q: "AI", num: 3 }),
  });
}

async function testHackerNews() {
  for (const [endpoint, query, tag] of [["search_by_date", "AI", "story,comment"], ["search", "AI", "story,comment"], ["search", "startup", "story,comment"], ["search", "the", "story"]]) {
    const url = new URL(`https://hn.algolia.com/api/v1/${endpoint}`);
    url.searchParams.set("query", query);
    url.searchParams.set("tags", tag);
    url.searchParams.set("hitsPerPage", "5");
    await probe(`Hacker News ${endpoint} query ${query}`, url, { headers: { accept: "application/json" } });
  }
}

async function testReddit() {
  const { REDDIT_CLIENT_ID: id, REDDIT_CLIENT_SECRET: secret, REDDIT_USER_AGENT: userAgent } = process.env;
  if (!id || !secret || !userAgent) return console.log(JSON.stringify({ provider: "Reddit", skipped: true, reason: "One or more of REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT are missing." }));
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const tokenResult = await probe("Reddit OAuth token", "https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", "user-agent": userAgent, accept: "application/json" },
    body: "grant_type=client_credentials",
  });
  const accessToken = parseJsonBody(tokenResult?.body ?? "")?.access_token;
  if (typeof accessToken !== "string") return console.log(JSON.stringify({ provider: "Reddit search", skipped: true, reason: "OAuth token request did not return an access token." }));
  const url = new URL("https://oauth.reddit.com/search.json");
  url.searchParams.set("q", "AI");
  url.searchParams.set("sort", "new");
  url.searchParams.set("limit", "3");
  await probe("Reddit search AI", url, { headers: { authorization: `Bearer ${accessToken}`, "user-agent": userAgent, accept: "application/json" } });
}

console.log("Provider connectivity test: API keys are never printed. External API probes may consume provider credits.");
console.log(JSON.stringify({ loaded: { GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY), GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash", FIRECRAWL_API_KEY: Boolean(process.env.FIRECRAWL_API_KEY), APIFY_TOKEN: Boolean(process.env.APIFY_TOKEN), APIFY_ACTOR_ID: process.env.APIFY_ACTOR_ID || null, SERPER_API_KEY: Boolean(process.env.SERPER_API_KEY), REDDIT_CLIENT_ID: Boolean(process.env.REDDIT_CLIENT_ID), REDDIT_CLIENT_SECRET: Boolean(process.env.REDDIT_CLIENT_SECRET), REDDIT_USER_AGENT: Boolean(process.env.REDDIT_USER_AGENT) } }));

const tests = new Map([["gemini", testGemini], ["firecrawl", testFirecrawl], ["apify", testApify], ["serper", testSerper], ["hackernews", testHackerNews], ["reddit", testReddit]]);
const requested = process.env.PROVIDER_TESTS?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
for (const [name, test] of tests) {
  if (requested?.length && !requested.includes(name)) continue;
  try { await test(); }
  catch (error) { console.log(JSON.stringify({ provider: test.name, ok: false, error: redact(error instanceof Error ? error.message : "Unknown test error") })); }
}
