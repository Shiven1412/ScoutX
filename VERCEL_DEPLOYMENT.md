# Vercel deployment

1. Connect the Git repository to Vercel and select the Next.js framework preset. Do not set a Vite output directory such as `dist`.
2. Set Node.js 20.9+ (Node 22 is used by CI). Keep the standard install/build commands: `npm ci` and `npm run build`.
3. Add the production environment variables from `ENVIRONMENT_VARIABLES.md` in Vercel. Add Supabase, Razorpay (or legacy Stripe), Gemini, source-provider, Resend, Slack/HubSpot OAuth, webhook encryption, Sentry, and PostHog credentials only to the environments that need them. Never prefix server secrets with `NEXT_PUBLIC_`.
4. Apply and verify the Supabase production schema/RLS first. Configure Auth callback and site URLs for the Vercel production domain. Ensure Google OAuth’s Supabase redirect is allowlisted.
5. Register Stripe endpoint `https://YOUR_DOMAIN/api/webhooks/stripe` for checkout completion, subscription created/updated/deleted, and invoice payment success/failure events. Set the endpoint signing secret in `STRIPE_WEBHOOK_SECRET`.
	Register Razorpay endpoint `https://YOUR_DOMAIN/api/webhooks/razorpay` for subscription and invoice events, and set `RAZORPAY_WEBHOOK_SECRET`. Configure Razorpay Plan IDs for Starter, Growth, and Agency.
6. Register Slack callback `https://YOUR_DOMAIN/api/integrations/slack/callback` and HubSpot callback `https://YOUR_DOMAIN/api/integrations/hubspot/callback` in each provider app. Enter provider OAuth credentials in Vercel and scopes as documented in the provider consoles.
7. Configure Supabase Auth SMTP with a verified Resend sender. Set `EMAIL_FROM` to a domain approved by Resend.
8. Verify Supabase Storage is private. Test production redirects, CSP and secure cookies over HTTPS, provider callbacks, tenant isolation, Stripe/Razorpay webhook replay, email delivery, cron authentication, and atomic workspace onboarding.
9. Enable Vercel Preview Deployments. Preview Supabase and Stripe projects should be isolated from production customer data and live payment methods.
10. Configure the GitHub Actions Vercel deploy job using repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. The job deploys only pushes to `main` and is skipped when those secrets are absent.

The checked-in `vercel.json` uses once-daily schedules so production deploys are compatible with Vercel Hobby. Hobby cron timing may vary by up to 59 minutes. More frequent monitoring requires Vercel Pro or a separately managed scheduler; update the cron expressions only after confirming the target account plan supports their frequency.

Sentry and PostHog may remain unset; the application disables those providers when their DSNs/keys are absent. Vercel schedules the authenticated collection and analytics jobs defined in `vercel.json`. New API keys use the `scoutx_` prefix; existing `scoutify_` keys remain accepted.
