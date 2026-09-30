import "server-only";

import { getPublicEnv, getServerEnv } from "@/lib/env";

type DiagnosticStatus = "healthy" | "error" | "configured" | "missing" | "not tested";
export type SystemDiagnostic = { name: string; status: DiagnosticStatus; detail: string };
type Probe = () => Promise<Response>;
type DiagnosticCheck = { name: string; variables: Array<[string, boolean]>; probe?: Probe; probeReady?: boolean; note?: string };

const timeoutSignal = () => AbortSignal.timeout(8_000);

export function explainProviderFailure(provider: string, status: number): string {
  if (status === 401) return `${provider} rejected the credentials (HTTP 401). Check that the key/token is correct and active.`;
  if (status === 403) return `${provider} denied access (HTTP 403). Check account permissions, plan access, and enabled API scopes.`;
  if (status === 404) return `${provider} endpoint or account resource was not found (HTTP 404). Check the provider account and API configuration.`;
  if (status === 400) return `${provider} rejected the diagnostic request (HTTP 400). Check the API configuration and account settings.`;
  if (status === 402) return `${provider} reports a billing or quota problem (HTTP 402). Check the account's payment method and remaining credits.`;
  if (status === 429) return `${provider} rate-limited the diagnostic (HTTP 429). Wait and retry.`;
  if (status >= 500) return `${provider} returned a server error (HTTP ${status}). Retry later; the provider may be experiencing an outage.`;
  return `${provider} returned HTTP ${status}. Check the provider account and credentials.`;
}

async function probeResult(name: string, probe: Probe): Promise<SystemDiagnostic> {
  try {
    const response = await probe();
    return response.ok
      ? { name, status: "healthy", detail: `Live credential check succeeded (HTTP ${response.status}).` }
      : { name, status: "error", detail: explainProviderFailure(name, response.status) };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      name,
      status: "error",
      detail: timedOut ? `${name} did not respond within 8 seconds. Check network access or retry later.` : `${name} could not be reached from the server. Check outbound network access and provider availability.`,
    };
  }
}

function configurationResult(name: string, variables: Array<[string, boolean]>, safelyProbeable: boolean): SystemDiagnostic {
  const missing = variables.filter(([, present]) => !present).map(([variable]) => variable);
  if (missing.length) return { name, status: "missing", detail: `Missing required configuration: ${missing.join(", ")}.` };
  if (safelyProbeable) return { name, status: "configured", detail: "Credentials are present; live verification is pending." };
  return { name, status: "not tested", detail: "Credentials are present. A safe, non-billable credential check is not available; the next real provider operation will verify connectivity." };
}

export async function runSystemDiagnostics(): Promise<SystemDiagnostic[]> {
  const env = getServerEnv();
  const publicEnv = getPublicEnv();
  const checks: DiagnosticCheck[] = [
    {
      name: "Gemini AI",
      variables: [["GEMINI_API_KEY", Boolean(env.GEMINI_API_KEY)]],
      probeReady: Boolean(env.GEMINI_API_KEY),
      probe: () => fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash", { headers: { "x-goog-api-key": env.GEMINI_API_KEY! }, signal: timeoutSignal() }),
    },
    {
      name: "OpenAI fallback",
      variables: [["OPENAI_API_KEY", Boolean(env.OPENAI_API_KEY)]],
      probeReady: Boolean(env.OPENAI_API_KEY),
      probe: () => fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: timeoutSignal() }),
    },
    {
      name: "Reddit",
      variables: [["REDDIT_CLIENT_ID", Boolean(env.REDDIT_CLIENT_ID)], ["REDDIT_CLIENT_SECRET", Boolean(env.REDDIT_CLIENT_SECRET)], ["REDDIT_USER_AGENT", Boolean(env.REDDIT_USER_AGENT)]],
      probeReady: Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_USER_AGENT),
      probe: () => fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", "user-agent": env.REDDIT_USER_AGENT! },
        body: "grant_type=client_credentials",
        signal: timeoutSignal(),
      }),
    },
    {
      name: "Apify",
      variables: [["APIFY_TOKEN", Boolean(env.APIFY_TOKEN)], ["APIFY_ACTOR_ID", Boolean(env.APIFY_ACTOR_ID)]],
      probeReady: Boolean(env.APIFY_TOKEN),
      probe: () => fetch("https://api.apify.com/v2/users/me", { headers: { authorization: `Bearer ${env.APIFY_TOKEN}` }, signal: timeoutSignal() }),
    },
    {
      name: "Stripe billing",
      variables: [["STRIPE_SECRET_KEY", Boolean(env.STRIPE_SECRET_KEY)], ["STRIPE_WEBHOOK_SECRET", Boolean(env.STRIPE_WEBHOOK_SECRET)], ["STRIPE_PRICE_STARTER", Boolean(env.STRIPE_PRICE_STARTER)], ["STRIPE_PRICE_GROWTH", Boolean(env.STRIPE_PRICE_GROWTH)], ["STRIPE_PRICE_AGENCY", Boolean(env.STRIPE_PRICE_AGENCY)]],
      probeReady: Boolean(env.STRIPE_SECRET_KEY),
      probe: () => fetch("https://api.stripe.com/v1/account", { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }, signal: timeoutSignal() }),
    },
    {
      name: "Razorpay billing",
      variables: [["RAZORPAY_KEY_ID", Boolean(env.RAZORPAY_KEY_ID)], ["RAZORPAY_KEY_SECRET", Boolean(env.RAZORPAY_KEY_SECRET)], ["RAZORPAY_WEBHOOK_SECRET", Boolean(env.RAZORPAY_WEBHOOK_SECRET)], ["RAZORPAY_PLAN_STARTER", Boolean(env.RAZORPAY_PLAN_STARTER)], ["RAZORPAY_PLAN_GROWTH", Boolean(env.RAZORPAY_PLAN_GROWTH)], ["RAZORPAY_PLAN_AGENCY", Boolean(env.RAZORPAY_PLAN_AGENCY)]],
      probeReady: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
      probe: () => fetch("https://api.razorpay.com/v1/customers?count=1", { headers: { authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}` }, signal: timeoutSignal() }),
    },
    {
      name: "Resend email",
      variables: [["RESEND_API_KEY", Boolean(env.RESEND_API_KEY)], ["EMAIL_FROM", Boolean(env.EMAIL_FROM)]],
      probeReady: Boolean(env.RESEND_API_KEY),
      probe: () => fetch("https://api.resend.com/domains", { headers: { authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: timeoutSignal() }),
    },
    { name: "Supabase service role", variables: [["SUPABASE_SERVICE_ROLE_KEY", Boolean(env.SUPABASE_SERVICE_ROLE_KEY)]], note: "Database connectivity is checked separately above; this confirms the server key is present." },
    { name: "Supabase Auth", variables: [["NEXT_PUBLIC_SUPABASE_URL", Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_URL)], ["NEXT_PUBLIC_SUPABASE_ANON_KEY", Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY)]], note: "Project URL and anon key are present; authentication operations verify the auth service." },
    { name: "Application URL", variables: [["NEXT_PUBLIC_APP_URL", Boolean(process.env.NEXT_PUBLIC_APP_URL)]], note: "Set this to the externally reachable application URL for production callbacks and links." },
    { name: "Serper", variables: [["SERPER_API_KEY", Boolean(env.SERPER_API_KEY)]], note: "Search checks can consume provider quota; no billable query was run." },
    { name: "Firecrawl", variables: [["FIRECRAWL_API_KEY", Boolean(env.FIRECRAWL_API_KEY)]], note: "Scrape/search checks can consume provider credits; no billable operation was run." },
    { name: "RSS feeds", variables: [], note: "RSS collection is available for public feeds selected on trackers; health is determined per feed during an actual run." },
    { name: "Hacker News API", variables: [], probe: () => fetch("https://hn.algolia.com/api/v1/search?query=scoutx-health-check&hitsPerPage=0", { signal: timeoutSignal() }) },
    { name: "Slack OAuth", variables: [["SLACK_CLIENT_ID", Boolean(env.SLACK_CLIENT_ID)], ["SLACK_CLIENT_SECRET", Boolean(env.SLACK_CLIENT_SECRET)]], note: "OAuth app credentials are present; a user authorization flow is required to verify a connected account." },
    { name: "HubSpot OAuth", variables: [["HUBSPOT_CLIENT_ID", Boolean(env.HUBSPOT_CLIENT_ID)], ["HUBSPOT_CLIENT_SECRET", Boolean(env.HUBSPOT_CLIENT_SECRET)]], note: "OAuth app credentials are present; a user authorization flow is required to verify a connected account." },
    { name: "PostHog analytics", variables: [["NEXT_PUBLIC_POSTHOG_KEY", Boolean(publicEnv.NEXT_PUBLIC_POSTHOG_KEY)], ["NEXT_PUBLIC_POSTHOG_HOST", Boolean(publicEnv.NEXT_PUBLIC_POSTHOG_HOST)]], note: "Configuration is present; event ingestion is verified when the client sends events." },
    { name: "Sentry monitoring", variables: [["NEXT_PUBLIC_SENTRY_DSN", Boolean(publicEnv.NEXT_PUBLIC_SENTRY_DSN)]], note: "Configuration is present; event ingestion is verified when the SDK sends events." },
    { name: "Webhook encryption", variables: [["WEBHOOK_ENCRYPTION_KEY", Boolean(env.WEBHOOK_ENCRYPTION_KEY)]], note: "Key presence is checked; encryption functionality is exercised when a webhook secret is saved." },
    { name: "Initial admin bootstrap", variables: [["INITIAL_ADMIN_EMAIL", Boolean(env.INITIAL_ADMIN_EMAIL)]], note: "Bootstrap configuration is present; it is only used when assigning the initial platform administrator." },
    { name: "Cron authentication", variables: [["CRON_SECRET", Boolean(env.CRON_SECRET)]], note: "Cron authentication secret is present; scheduled-job records show whether jobs are reaching the application." },
  ];

  return Promise.all(checks.map(async ({ name, variables, probe, probeReady, note }) => {
    const config = configurationResult(name, variables, Boolean(probe));
    if (probe && probeReady) {
      const liveResult = await probeResult(name, probe);
      const missing = variables.filter(([, present]) => !present).map(([variable]) => variable);
      return missing.length ? { ...liveResult, detail: `${liveResult.detail} Also missing required configuration: ${missing.join(", ")}.` } : liveResult;
    }
    if (config.status === "missing") return config;
    return { ...config, detail: note ?? config.detail };
  }));
}
