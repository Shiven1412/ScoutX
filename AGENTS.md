# ScoutX contributor instructions

## Application architecture

- This is a Next.js 15 App Router application. Use React Server Components by default and add `"use client"` only for browser interaction.
- Use server actions in `actions/`, Route Handlers in `app/api/`, validation schemas in `lib/validation/`, provider logic in `services/`, and typed Supabase clients in `lib/supabase/`.
- Read/write tenant records through the authenticated server Supabase client and always constrain queries by the current organization. RLS is a required second boundary.
- Never import the service-role client into a Client Component. Keep secrets server-only. Do not add `NEXT_PUBLIC_*` secrets.
- Do not add mock users, seed/demo records, invented metric values, fake source providers, local-storage backends, or hardcoded customer data. An empty database must render honest empty states.
- Validate all submitted input with Zod. Revalidate affected paths after mutations. Write activity/audit history for meaningful state changes.
- Keep schema edits in `schema.sql` repeatable and safe for existing customer data. No sample inserts.

## Quality

Before completing changes, run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`. For navigation/auth changes, also run `npm run test:e2e`.

## Setup references

- [Architecture](ARCHITECTURE.md)
- [Environment variables](ENVIRONMENT_VARIABLES.md)
- [Supabase](SUPABASE_SETUP.md)
- [Vercel](VERCEL_DEPLOYMENT.md)
- [Troubleshooting](TROUBLESHOOTING.md)
