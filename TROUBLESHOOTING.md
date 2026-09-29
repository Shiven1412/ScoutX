# Troubleshooting

## Sign-in redirects back to login

- Verify the production `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in Vercel and redeploy.
- Confirm Supabase Site URL and redirect allowlist contain the exact `{NEXT_PUBLIC_APP_URL}/auth/callback` URL.
- Confirm email verification completed. Password auth rejects unconfirmed users when confirmation is enabled.
- Inspect middleware redirects and Supabase Auth logs. The app does not create a local/demo account when Supabase is unavailable.

## Registration says Supabase Auth is unavailable

- Confirm `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in the root `.env`/`.env.local` and point to the same Supabase project. Never print or paste the key into logs.
- Check the Next server terminal for `Supabase signup rejected` (an Auth provider code) or `Supabase signup request failed` (a network/certificate issue). The action intentionally excludes email, password, and token values from those diagnostic records.
- If Node reports `SELF_SIGNED_CERT_IN_CHAIN` on a Windows network with HTTPS inspection, install the organization’s approved root CA in the Windows trusted-root store. `npm run dev` and `npm start` enable Node’s system CA trust using `NODE_USE_SYSTEM_CA=1`; restart the server after installing/changing certificates. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` or otherwise disable TLS validation.
- Confirm Email signups are enabled in Supabase Authentication settings. `disable_signup: false` means signup is enabled; email confirmation can still be required, so check SMTP/provider delivery and Supabase Auth logs.

## User signs in but is sent to onboarding

The account has no active `organization_members` row. Complete onboarding or accept an invitation at `/settings/team/invitations`. Review organization membership and the `bootstrap_organization_owner` / invitation SQL functions.

## Organization or profile bootstrap fails

Review Supabase Postgres logs for the `provision_auth_user`, organization membership, seat-limit, and subscription triggers. Verify `schema.sql` was applied completely and profiles/users rows were backfilled. Do not disable RLS to hide schema errors.

## Slack or HubSpot connect fails

Verify provider client ID/secret, provider callback URL, requested scopes, provider allowlist, and `NEXT_PUBLIC_APP_URL`. Reconnect after changing credentials. `WEBHOOK_ENCRYPTION_KEY` must decode from base64 to exactly 32 bytes; changing it without migrating encrypted values makes existing provider credentials unreadable.

## Slack connection works but no message appears

Set a real channel/conversation ID, invite the ScoutX bot to private channels, and ensure Slack granted `chat:write` (and any needed channel scope). Check the integration row’s sync status and server logs. Provider delivery is best effort and does not roll back saved application data.

## HubSpot sync reports failures

Check that OAuth granted contact read/write scopes and the app still has valid refresh credentials. Sync only leads with a real email. Inspect HubSpot app logs and `hubspot_contact_id` mappings. Reauthorize if provider credentials were revoked.

## Webhooks do not deliver

Use an HTTPS public destination reachable from Vercel. Local, private, and loopback DNS resolutions are refused. Ensure `WEBHOOK_ENCRYPTION_KEY` is unchanged and the endpoint verifies `x-scoutify-signature` as `sha256=` HMAC-SHA256 over the exact request body. Delivery failures are logged but do not undo committed data.

## Stripe status does not update

Verify webhook signature secret and endpoint event subscriptions. Stripe events are idempotently recorded by event ID/body hash in `stripe_events`. Check unprocessed events and server logs. Ensure price IDs match the selected plan and metadata retains `organization_id`/`plan`.

## Stripe checkout cannot reopen a canceled plan

Review the latest Stripe subscription state and its webhook receipt. A canceled provider subscription must be synchronized before starting a new checkout. Active subscriptions are changed in the Stripe customer portal.

## Usage or seats are rejected

The database enforces active subscription state, plan signal/AI limits, and seat limits (including pending invitations). Review `subscriptions` and `usage_records`; verify Stripe price-to-plan configuration and billing period events.

## No intent signals or dashboard metrics appear

This is expected for an empty organization. Add an authorized signal collector and source credentials, then send valid records to `POST /api/v1/signals`. Counts only reflect database records. The application deliberately does not fabricate values or sample source posts.

## Production build/lint problems

Run `npm ci`, then `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`. Delete only generated `.next` build output if a failed build left stale manifests; never delete or rewrite production database data to fix a frontend build.
