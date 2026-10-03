-- Keep the owner check out of the exposed API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_owners where user_id = (select auth.uid()));
$$;
revoke execute on function private.is_owner() from public, anon;
grant execute on function private.is_owner() to authenticated, service_role;

alter policy "owner all episodes" on public.episodes
  using ((select private.is_owner())) with check ((select private.is_owner()));
alter policy "owner all jobs" on public.render_jobs
  using ((select private.is_owner())) with check ((select private.is_owner()));
alter policy "owner all events" on public.episode_events
  using ((select private.is_owner())) with check ((select private.is_owner()));
alter policy "owner reads studio" on storage.objects
  using (bucket_id = 'studio' and (select private.is_owner()));

drop function public.is_owner();

create index episode_events_user_idx on public.episode_events (user_id);
