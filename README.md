# ScoutX

ScoutX is a multi-tenant intent, CRM, and outreach application built with Next.js 15 App Router, TypeScript, Tailwind CSS, and Supabase. It reads and writes organization-scoped production records. It does not include demo users, seed organizations, sample metrics, simulated sources, or local-storage persistence.

## Stack

- Next.js 15 App Router, React 19, TypeScript strict mode
- Supabase Auth, PostgreSQL, RLS, and private Storage
- Zod, React Hook Form, accessible shadcn-style primitives, Tailwind CSS v4
- Recharts for database-backed analytics
- OpenAI for reviewed outreach drafts
- Slack OAuth, HubSpot OAuth/CRM sync, signed outbound webhooks
- Stripe Checkout, customer portal, verified webhooks, usage/seat limits
- Resend for existing-account invitations and approved email delivery; Supabase Auth email delivery for registration/new-user invitations
- Sentry and PostHog, disabled unless configured
- Vercel deployment, Vitest, Playwright, and GitHub Actions

## Local development

Requirements: Node.js 20.9 or later and npm.

1. Run `npm ci`.
2. Copy `.env.example` to `.env.local` and provide the Supabase public URL and anon/publishable key. Never put service-role, OAuth client-secret, Stripe, Resend, OpenAI, or encryption secrets in `NEXT_PUBLIC_*` variables.
3. Follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md) to configure the Supabase project and apply `schema.sql`.
4. Run `npm run dev` and open `http://localhost:3000`.

Quality commands: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:e2e`, `npm run build`.

The app remains usable for marketing and sign-in UI without backend configuration. Authenticated product routes deliberately require configured Supabase Auth; there is no demo login or fallback dataset.

## Product flows

- Email/password registration, Supabase email verification, Google OAuth, password recovery, and signed-out route protection.
- First-user onboarding creates an organization; database triggers create the owner membership and trial subscription.
- Tenant-scoped dashboard, signals, tracker CRUD, leads/pipeline, saved outreach and version history, analytics, billing, team administration, and private Storage policies.
- Public source collection is intentionally not fabricated. Authorized provider jobs send validated records through `POST /api/v1/signals` using an organization API key with `signals:write`. The server validates records, enforces organization quota and API-key rate limits, and stores signals in PostgreSQL.
- Slack/HubSpot use OAuth credentials configured in the server environment. HubSpot sync writes workspace leads with email to actual HubSpot contacts. Slack posts workspace event IDs/counts to an admin-selected channel. Webhook signing secrets are AES-GCM encrypted at rest.

See [ARCHITECTURE.md](ARCHITECTURE.md), [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md), and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Database and security

`schema.sql` is the production Supabase schema and upgrade script for existing ScoutX installations. It contains no fixture inserts. Apply it using the Supabase SQL editor or the documented migration workflow. It enables RLS across application tables, limits tenant access to active members, restricts billing/secret/admin operations, provisions Auth user profiles, tracks seats and usage, archives legacy duplicate subscriptions, and configures a private Storage bucket.

Keep Supabase RLS enabled. Service-role access is isolated to server-only modules, verified provider callbacks, API-key ingestion, Stripe processing, and platform administration. Never expose service-role credentials to browser code.

## Deployment

Vercel builds the Next.js app with `npm run build`; the output directory is managed by Next/Vercel and must not be set to `dist`. Complete [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) and set deployment secrets before enabling integrations.

## Credential incident notice

The original workspace contained a service-role credential and a provider API credential in `src/.env`. The file has been removed from the project. Treat every value from that file as compromised: revoke/rotate it at its provider, check git history and shared artifacts, and configure replacements only in a secret manager. Do not re-add the old file.
