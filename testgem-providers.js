const testCases = [
	{ endpoint: "search", query: "AI Chat Bot", tags: "story" },
	{ endpoint: "search_by_date", query: "AI Chat Bot", tags: "story" },
	{ endpoint: "search", query: "startup", tags: "story" },
	{ endpoint: "search", query: "the", tags: "story" },
];

for (const testCase of testCases) {
	const url = new URL(`https://hn.algolia.com/api/v1/${testCase.endpoint}`);
	url.searchParams.set("query", testCase.query);
	url.searchParams.set("tags", testCase.tags);
	url.searchParams.set("hitsPerPage", "5");

	const startedAt = Date.now();
	try {
		const response = await fetch(url, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(15_000),
		});
		const contentType = response.headers.get("content-type") ?? "";
		const body = await response.text();
		let payload;

		try {
			payload = JSON.parse(body);
		} catch {
			console.log(JSON.stringify({
				endpoint: testCase.endpoint,
				query: testCase.query,
				tags: testCase.tags,
				status: response.status,
				contentType,
				durationMs: Date.now() - startedAt,
				error: "Response was not valid JSON",
				bodyPreview: body.replace(/\s+/g, " ").slice(0, 180),
			}));
			continue;
		}

		const hits = Array.isArray(payload.hits) ? payload.hits : [];
		console.log(JSON.stringify({
			endpoint: testCase.endpoint,
			query: testCase.query,
			tags: testCase.tags,
			status: response.status,
			contentType,
			durationMs: Date.now() - startedAt,
			nbHits: payload.nbHits ?? null,
			returnedHits: hits.length,
			examples: hits.slice(0, 3).map((hit) => ({
				title: hit.title ?? hit.story_title ?? "(no title)",
				createdAt: hit.created_at ?? null,
				url: hit.url ?? hit.story_url ?? null,
			})),
		}));
	} catch (error) {
		console.log(JSON.stringify({
			endpoint: testCase.endpoint,
			query: testCase.query,
			tags: testCase.tags,
			durationMs: Date.now() - startedAt,
			error: error instanceof Error ? `${error.name}: ${error.message}` : "Unknown request error",
		}));
	}
}
