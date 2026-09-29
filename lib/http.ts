export class SafeHttpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SafeHttpError";
  }
}

/** Read an HTTP response as untrusted JSON without leaking HTML or provider bodies. */
export async function readJsonResponse(response: Response, provider: string): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new SafeHttpError(`${provider} returned an unreadable response.`, response.status);
  }

  if (!response.ok) {
    throw new SafeHttpError(`${provider} request failed with status ${response.status}.`, response.status);
  }
  if (!contentType.includes("json")) {
    const isHtml = /<\s*!doctype\s+html|<\s*html[\s>]/i.test(body);
    throw new SafeHttpError(`${provider} returned ${isHtml ? "HTML" : "a non-JSON response"} instead of JSON.`, response.status);
  }
  if (body.length > 2_000_000) throw new SafeHttpError(`${provider} response was too large to process.`, response.status);

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SafeHttpError(`${provider} returned malformed JSON.`, response.status);
  }
}

export async function fetchJson(url: URL | string, init: RequestInit, provider: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new SafeHttpError(`${provider} request timed out.`, undefined);
    }
    throw new SafeHttpError(`${provider} could not be reached. Check network access and retry.`, undefined);
  }
  return readJsonResponse(response, provider);
}
