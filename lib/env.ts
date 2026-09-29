import { z } from "zod";

const blankAsUndefined = (value: unknown) => value === "" ? undefined : value;
const optionalSecret = z.preprocess(blankAsUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(blankAsUndefined, z.string().url().optional());

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.preprocess(blankAsUndefined, z.string().url().default("http://localhost:3000")),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalSecret,
  NEXT_PUBLIC_POSTHOG_KEY: z.preprocess(blankAsUndefined, z.string().optional()),
  NEXT_PUBLIC_POSTHOG_HOST: z.preprocess(blankAsUndefined, z.string().url().default("https://us.i.posthog.com")),
  NEXT_PUBLIC_SENTRY_DSN: optionalUrl,
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  SLACK_CLIENT_ID: optionalSecret,
  SLACK_CLIENT_SECRET: optionalSecret,
  HUBSPOT_CLIENT_ID: optionalSecret,
  HUBSPOT_CLIENT_SECRET: optionalSecret,
  STRIPE_SECRET_KEY: optionalSecret,
  STRIPE_WEBHOOK_SECRET: optionalSecret,
  STRIPE_PRICE_STARTER: optionalSecret,
  STRIPE_PRICE_GROWTH: optionalSecret,
  STRIPE_PRICE_AGENCY: optionalSecret,
  RAZORPAY_KEY_ID: optionalSecret,
  RAZORPAY_KEY_SECRET: optionalSecret,
  RAZORPAY_WEBHOOK_SECRET: optionalSecret,
  RAZORPAY_PLAN_STARTER: optionalSecret,
  RAZORPAY_PLAN_GROWTH: optionalSecret,
  RAZORPAY_PLAN_AGENCY: optionalSecret,
  REDDIT_CLIENT_ID: optionalSecret,
  REDDIT_CLIENT_SECRET: optionalSecret,
  REDDIT_USER_AGENT: optionalSecret,
  SERPER_API_KEY: optionalSecret,
  FIRECRAWL_API_KEY: optionalSecret,
  APIFY_TOKEN: optionalSecret,
  APIFY_ACTOR_ID: optionalSecret,
  RESEND_API_KEY: optionalSecret,
  WEBHOOK_ENCRYPTION_KEY: optionalSecret,
  INITIAL_ADMIN_EMAIL: z.preprocess(blankAsUndefined, z.string().email().optional()),
  EMAIL_FROM: optionalSecret,
  CRON_SECRET: z.preprocess(blankAsUndefined, z.string().min(32).optional()),
});

export function getPublicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });
}

export function getServerEnv() {
  return serverSchema.parse(process.env);
}

export function requireSupabasePublicEnv() {
  const env = getPublicEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable authentication and database access.");
  }
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
}
