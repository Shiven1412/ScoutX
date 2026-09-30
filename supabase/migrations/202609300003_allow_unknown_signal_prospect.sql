-- Public search results often have no attributable author or company. Keep these
-- values nullable, matching schema.sql, API validation, and generated types.
alter table public.intent_signals
  alter column prospect_name drop not null,
  alter column company drop not null;