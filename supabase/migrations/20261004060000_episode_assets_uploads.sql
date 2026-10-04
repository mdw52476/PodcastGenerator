-- Phase 5: shot images uploaded from the web app.
-- episodes.assets maps a plan-relative path (e.g. "images/s04-desk.jpg") to its storage key;
-- render jobs merge it with the files uploaded by `pnpm job submit`.
alter table public.episodes add column assets jsonb not null default '{}';

-- The owner may upload into inputs/<episode>/images/ (insert, and overwrite the same key).
create policy "owner uploads episode images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'studio' and (storage.foldername(name))[1] = 'inputs' and (storage.foldername(name))[3] = 'images' and (select private.is_owner()));
create policy "owner replaces episode images" on storage.objects
  for update to authenticated
  using (bucket_id = 'studio' and (storage.foldername(name))[1] = 'inputs' and (storage.foldername(name))[3] = 'images' and (select private.is_owner()))
  with check (bucket_id = 'studio' and (storage.foldername(name))[1] = 'inputs' and (storage.foldername(name))[3] = 'images' and (select private.is_owner()));
