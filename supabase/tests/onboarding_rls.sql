-- Run after applying the onboarding migration in the Supabase SQL editor or test database.
-- These checks are read-only and verify that tenant RLS remains enabled and the RPC
-- can be called only by authenticated users (it never depends on service-role access).
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.organizations'::regclass), 'organizations RLS must remain enabled';
  assert (select relrowsecurity from pg_class where oid = 'public.organization_members'::regclass), 'organization_members RLS must remain enabled';
  assert (select relrowsecurity from pg_class where oid = 'public.keyword_trackers'::regclass), 'keyword_trackers RLS must remain enabled';
  assert (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles RLS must remain enabled';
  assert (select relrowsecurity from pg_class where oid = 'public.activity_logs'::regclass), 'activity_logs RLS must remain enabled';

  assert exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'organizations'
      and policyname = 'organizations_create_self' and cmd = 'INSERT'
      and with_check like '%created_by%auth.uid%'
  ), 'organization insertion must remain restricted to the authenticated creator';
  assert exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'keyword_trackers'
      and policyname = 'trackers_member_access' and cmd = 'ALL'
  ), 'tracker writes must remain membership-scoped';
  assert exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_update_self' and cmd = 'UPDATE'
  ), 'profile updates must remain self-scoped';
  assert exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'activity_logs'
      and policyname = 'activity_member_insert' and cmd = 'INSERT'
  ), 'activity writes must remain membership- and actor-scoped';

  assert has_function_privilege('authenticated', 'public.create_workspace(text,text,text,text[])', 'EXECUTE'), 'authenticated users need the onboarding RPC';
  assert not has_function_privilege('anon', 'public.create_workspace(text,text,text,text[])', 'EXECUTE'), 'anonymous users must not execute the onboarding RPC';
  assert (select prosecdef from pg_proc where oid = 'public.create_workspace(text,text,text,text[])'::regprocedure), 'workspace provisioning must execute transactionally as a security definer';
end
$$;
