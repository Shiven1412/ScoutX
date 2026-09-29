# Architecture

## Runtime boundaries

- `app/` owns URL routes and App Router layouts. `(auth)`, `(workspace)`, and `(admin)` are layout groups; organization and platform-admin checks run on the server before protected pages render.
- `middleware.ts` refreshes Supabase sessions for protected routes, redirects unauthenticated or unverified users, forwards a CSP nonce, and sets security headers. Server-side `requireUser`, `requireOrganization`, and `requirePlatformAdmin` remain authoritative checks.
- `actions/` contains validated Server Actions. Each organization mutation verifies the current user and membership, uses the caller-scoped Supabase client where possible, writes activity, and revalidates affected routes.
- `app/api/` contains signed Stripe callbacks, provider OAuth callbacks, and the API-key-protected ingestion endpoint.
- `lib/supabase/client.ts` is browser-safe. `server.ts` uses request cookies. `admin.ts` is marked `server-only` and requires the service-role key.
- `types/database.ts` defines the app-facing Supabase database types. Regenerate/refine it whenever the schema changes.

## Organization isolation

`requireOrganization()` selects an active membership for the authenticated user. Every server data query also filters the selected organization ID. PostgreSQL RLS calls `is_org_member` or `has_org_role`; their `SECURITY DEFINER` functions use an empty `search_path` and narrowly scoped access. A user-provided organization ID is never treated as authorization.

The schema provisions profile rows after Supabase Auth user creation, a trial subscription after organization creation, the initial owner membership, seat counts, and database audit rows. Existing prototype tables are evolved in place; legacy duplicate subscription rows are retained in `subscription_history` before enforcing one current subscription per organization. Seed/demo rows are not created.

## Signal ingestion

An external authorized collector sends batches of up to 100 source records to `POST /api/v1/signals` with `Authorization: Bearer scoutx_…`. The legacy `scoutify_` key prefix remains supported for existing credentials. The handler hashes and looks up the API key, checks expiry/revocation/scope, consumes a database-backed per-key rate limit, then invokes a transaction-safe function that enforces subscription status and signal quotas, deduplicates by source ID, stores records, and meters inserted usage. Raw provider payloads are JSON-validated. No credentials or fake source records are generated.

## Authentication

Supabase Auth owns email/password, verification, Google identity, and recovery. PKCE callback codes are exchanged server-side into secure cookies. Redirect paths are constrained to same-origin paths. Organization setup is a separate authenticated route so new users can establish membership before the workspace layout is applied. Invitations use Supabase Admin and Resend/Supabase email delivery, then require the signed-in invited account to accept the membership.

## Integrations and secrets

OAuth access/refresh tokens and webhook signing secrets are encrypted with AES-256-GCM using `WEBHOOK_ENCRYPTION_KEY`. Integration tables are admin-only under RLS; the encrypted credential field is never selected into ordinary UI queries. API keys store only SHA-256 hashes and a display prefix. Stripe webhook events store event IDs and body hashes, not billing payloads.

Slack channel notifications and external HTTPS webhook deliveries are best effort after business data commits; provider outage does not roll back a saved lead/signal. HubSpot sync uses deduplicated contact search and stored remote IDs. OAuth registration, approved outbound email, and Slack delivery require real provider credentials.

## Billing and usage

Checkout and customer-portal URLs are created on the server after owner/admin authorization. Stripe webhooks require signature verification, use an event ledger for idempotency, validate organization/subscription metadata, and are the source of subscription status. Signal and AI usage are recorded atomically in PostgreSQL. Plan/price IDs and Stripe customer portal setup are external configuration.

## Observability and analytics

Sentry initializes in server, edge, and browser runtimes only when a DSN is configured and does not send default PII. PostHog captures pageviews only, with autocapture and session recordings disabled. Monitoring status is derived from actual database connectivity and environment configuration, never synthetic probes or fixed uptime figures.

## Data lifecycle

Organizations cascade-delete their tenant records when explicitly deleted, while application workflows use soft-delete columns for leads, trackers, and outreach. User identity deletion cascades Auth profiles and memberships. Historical Stripe rows and audit logs keep narrowly scoped references where appropriate. Private uploaded files use organization UUID as their first Storage path segment.
