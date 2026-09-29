# Supabase setup

1. Create a Supabase project in the intended region and keep the project owner account secured with MFA.
2. Configure application environment values from `ENVIRONMENT_VARIABLES.md`: project URL, anon/publishable key, and server-only service-role key. Never expose the latter.
3. Apply `schema.sql` to the project using the Supabase SQL editor during a maintenance window. The script creates/updates schema, policies, triggers, private storage, organization subscription history, and user backfills. Review the SQL before applying it to a production database and take a backup first. The script intentionally inserts no users, workspaces, or demo data.
4. In Authentication → URL Configuration, add the exact production, preview, and local callback URLs:
   - `{APP_URL}/auth/callback`
   - `{APP_URL}/api/integrations/slack/callback`
   - `{APP_URL}/api/integrations/hubspot/callback`
5. Enable Email provider and email confirmations. Configure SMTP using a verified Resend domain (or another approved SMTP provider), sender identity, and rate limits. The app enforces verified email before protected access.
6. Enable Google provider, configure the OAuth client in Google Cloud Console, and enter the Google client ID/secret in Supabase Auth provider settings. Set its authorized redirect URI to the Supabase provider callback URL shown by Supabase. The application uses Supabase OAuth; it does not use NextAuth.
7. Verify database RLS is enabled on every application table and on `storage.objects`. Run checks as anon, authenticated member, admin, and service-role clients. Use two test organizations to check cross-tenant denial.
8. The schema creates a private `organization-files` bucket with organization-folder policies. Use paths beginning `{organization-uuid}/...`; never make the bucket public.
9. Set `INITIAL_ADMIN_EMAIL` to the exact verified platform operator email for first bootstrap. Sign up/verify that account, follow the callback, verify its platform role in `profiles`, then remove the bootstrap variable and manage admin roles through the audited platform admin UI.
10. Apply reviewed timestamped SQL migrations from `supabase/migrations/` after the initial schema, through the team’s Supabase migration workflow. Do not execute production SQL from an unreviewed local branch.

## Existing installations

The script upgrades the legacy product schema in place, removes only the exact built-in fixture organization ID used by the prototype, copies old daily usage into `usage_records`, backfills Auth users/profiles, archives duplicate subscriptions in `subscription_history`, then enforces one current subscription per organization. Review existing data and take a database backup before applying. Legacy records whose old schema had no actor/creator identifier remain with nullable creator IDs; new writes require a real authenticated actor. The timestamped ScoutX migrations are additive and preserve the existing provider and tenant tables.
