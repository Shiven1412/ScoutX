create or replace function public.create_workspace(target_name text, target_industry text, target_slug text, target_keywords text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := (select auth.uid());
  created_org_id uuid;
  keyword_count integer;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if char_length(trim(target_name)) < 2 or char_length(trim(target_name)) > 120 then raise exception 'Invalid workspace name'; end if;
  if char_length(coalesce(target_industry, '')) > 100 then raise exception 'Invalid workspace industry'; end if;
  if target_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or position('-' || left(replace(caller_id::text, '-', ''), 8) || '-' in target_slug) = 0
    or right(target_slug, 6) !~ '^[a-f0-9]{6}$' then raise exception 'Invalid workspace slug'; end if;
  keyword_count := coalesce(cardinality(target_keywords), 0);
  if keyword_count > 10 or exists (
    select 1 from unnest(coalesce(target_keywords, array[]::text[])) as supplied(keyword)
    where char_length(trim(supplied.keyword)) < 2 or char_length(trim(supplied.keyword)) > 180
  ) then raise exception 'Invalid workspace keywords'; end if;

  insert into public.organizations (name, slug, industry, created_by)
  values (trim(target_name), nullif(target_slug, ''), nullif(trim(target_industry), ''), caller_id)
  returning id into created_org_id;

  if keyword_count > 0 then
    insert into public.keyword_trackers (organization_id, created_by, keyword, platforms, communities, negative_keywords)
    select created_org_id, caller_id, trim(supplied.keyword), array[]::text[], array[]::text[], array[]::text[]
    from unnest(target_keywords) as supplied(keyword);
  end if;

  insert into public.profiles (id, company, industry)
  values (caller_id, trim(target_name), nullif(trim(target_industry), ''))
  on conflict (id) do update set company = excluded.company, industry = excluded.industry;

  insert into public.activity_logs (organization_id, user_id, action, entity_type, entity_id)
  values (created_org_id, caller_id, 'workspace.created', 'organization', created_org_id);
  return created_org_id;
end;
$$;

revoke all on function public.create_workspace(text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.create_workspace(text, text, text, text[]) to authenticated;