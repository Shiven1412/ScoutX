# Environment variables

Copy `.env.example` to `.env.local` for local development. Configure the same names in Vercel project settings for Preview/Production. Use Vercel/Supabase/provider secret managers for production secrets. Never commit `.env.local`, service-role keys, OAuth client secrets, bearer tokens, or webhook signing/encryption keys.

| Variable | Browser visible | Required for | Notes |
| --- | ---: | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | OAuth and email callback URLs | Canonical HTTPS production URL; `http://localhost:3000` locally. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Auth and DB | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Auth and DB | Supabase anon/publishable key. RLS must be enabled. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Admin operations, ingestion, Stripe | Never expose to the browser. |
| `INITIAL_ADMIN_EMAIL` | No | Bootstrap initial platform admin | Exact verified account email; unset after secure bootstrap if desired. |
| `OPENAI_API_KEY` | No | AI outreach fallback | Server-side only; AI generation consumes organization credits. |
| `GEMINI_API_KEY` | No | Gemini intent analysis and outreach generation | Server-side only; configure to enable Gemini as the primary AI provider. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | No | Slack OAuth | Register callback `{NEXT_PUBLIC_APP_URL}/api/integrations/slack/callback`; required scopes are requested by the app. |
| `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | No | HubSpot OAuth/sync | Register callback `{NEXT_PUBLIC_APP_URL}/api/integrations/hubspot/callback`; grant the contact scopes requested by the app. |
| `STRIPE_SECRET_KEY` | No | Checkout, portal, invoice list | Use the correct test/live account key. |
| `STRIPE_WEBHOOK_SECRET` | No | Subscription synchronization | Signing secret from the Stripe webhook endpoint. |
| `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_AGENCY` | No | Checkout and plan quotas | Stripe Price IDs must map to the corresponding subscription plan. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | No | Razorpay subscriptions | Server-side API credentials. |
| `RAZORPAY_WEBHOOK_SECRET` | No | Razorpay subscription synchronization | Webhook secret from the Razorpay webhook configuration. |
| `RAZORPAY_PLAN_STARTER`, `RAZORPAY_PLAN_GROWTH`, `RAZORPAY_PLAN_AGENCY` | No | Razorpay subscription checkout | Razorpay Plan IDs for the three supported plans. Required to start a Razorpay subscription. |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` | No | Reddit collection | OAuth app credentials and descriptive user agent; observe Reddit API limits and terms. |
| `FIRECRAWL_API_KEY` | No | Firecrawl website/RSS collection | Server-side only; collection is restricted to tracked public sources. |
| `SERPER_API_KEY` | No | Serper search collection | Server-side only; collection is restricted to tracked keywords. |
| `APIFY_TOKEN` | No | Apify actor runs | Server-side only. |
| `APIFY_ACTOR_ID` | No | Apify actor selection | Actor ID permitted for this deployment; actor input must be configured to collect tracked keywords only. |
| `RESEND_API_KEY` | No | Existing-account invitations and email delivery | New Supabase Auth invitations/verification use configured Supabase Auth email delivery. |
| `EMAIL_FROM` | No | Resend delivery | Verified sender, e.g. `ScoutX <noreply@yourdomain.com>`. Replace the example. |
| `WEBHOOK_ENCRYPTION_KEY` | No | Slack/HubSpot and webhook credential encryption | Base64-encoded random 32-byte key. Back it up securely; losing it requires provider reconnection. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Yes | Pageview analytics | Optional. Pageviews only; autocapture and recordings are disabled. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Yes | PostHog endpoint | Defaults to `https://us.i.posthog.com`; change for your data region/self-hosted endpoint. |
| `NEXT_PUBLIC_DEMO_BOOKING_URL` | Yes | Public landing-page demo booking | Optional HTTPS scheduling link. The landing-page button is disabled until this is configured. |
| `NEXT_PUBLIC_SENTRY_DSN` | Yes | Error monitoring | Optional DSN; no default PII. |
| `CRON_SECRET` | No | Vercel scheduled collectors | At least 32 characters. Vercel sends this as a Bearer token to the authenticated `/api/cron/*` endpoints. |

The legacy `VITE_*` variables and `NEXTAUTH_*` variables are not used. Google OAuth is configured through Supabase Auth and the Google Cloud OAuth console; no Google client secret is read by this application.

The checked-in Vercel schedules are Hobby-compatible daily jobs: analytics at 02:00 UTC, Reddit at 01:00, Serper at 03:00, Firecrawl at 05:00, RSS at 07:00, Hacker News at 09:00, and low-confidence signal reprocessing at 11:00. Hobby scheduling has up to ±59 minutes of timing variance. For more frequent monitoring, upgrade to Vercel Pro and restore the desired cadence in `vercel.json`, or invoke the authenticated `/api/cron/*` endpoints through an approved external scheduler. The protected Apify collection endpoint can also be triggered externally. Collection only uses configured provider credentials and active tracker keywords.

On Windows development machines using enterprise HTTPS inspection, install the trusted organization root CA in the Windows certificate store. The dev/start scripts set Node’s `NODE_USE_SYSTEM_CA=1` so server-side Supabase requests validate certificates against approved system roots; certificate verification remains enabled.
