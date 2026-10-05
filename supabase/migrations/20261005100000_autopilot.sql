-- Autopilot: the scheduled writer (a Claude routine) proposes ideas and submits drafts
-- through a narrow token. It can only call the functions below; it never sees the
-- service key and cannot read or change anything else.
-- Applied to shoebox-studio (tfjoqdcysltgmggeyryd) on 2026-10-05 as migrations
-- "autopilot" and "autopilot_tighten".

alter table public.episodes
  add column autopilot boolean not null default false,
  add column pitch jsonb,            -- { logline, whyNow, angle, sources: [{title, url}] }
  add column fact_sheet text,        -- markdown with sources, from the writer
  add column draft jsonb,            -- the writer's submission (shots, prompts, shorts...)
  add column claimed_at timestamptz; -- a writing run is working on this idea

alter table public.episodes drop constraint episodes_status_check;
alter table public.episodes add constraint episodes_status_check check (status in (
  'idea', 'researched', 'scripted', 'voiced', 'edited',
  'awaiting-approval', 'approved', 'scheduled', 'published', 'passed'));

create table private.autopilot_tokens (
  id          bigint generated always as identity primary key,
  label       text not null,
  token_hash  text not null unique,   -- sha256 hex; the token itself is never stored
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);

create function private.autopilot_check(p_token text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_token is null or not exists (
    select 1 from private.autopilot_tokens
     where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and not revoked
  ) then
    raise exception 'invalid autopilot token' using errcode = '28000';
  end if;
end $$;

create function public.autopilot_context(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.autopilot_check(p_token);
  return jsonb_build_object(
    'shows', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'profile', s.profile))
                        from public.shows s where coalesce((s.profile->'autopilot'->>'enabled')::boolean, false)), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('show', e.show, 'id', e.id, 'title', e.title, 'status', e.status, 'logline', e.pitch->>'logline'))
                        from (select * from public.episodes order by created_at desc limit 80) e), '[]'::jsonb),
    'waitingIdeas', coalesce((select jsonb_object_agg(show, n) from (select show, count(*) n from public.episodes where status = 'idea' group by show) c), '{}'::jsonb),
    'approvedToWrite', (select count(*) from public.episodes where status = 'researched' and autopilot and draft is null)
  );
end $$;

create function public.autopilot_submit_ideas(p_token text, p_show text, p_ideas jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  idea jsonb;
  base text;
  slug text;
  n int;
  ids jsonb := '[]'::jsonb;
  prefix text;
begin
  perform private.autopilot_check(p_token);
  if not exists (select 1 from public.shows where id = p_show and coalesce((profile->'autopilot'->>'enabled')::boolean, false)) then
    raise exception 'show % does not exist or autopilot is off', p_show;
  end if;
  if jsonb_typeof(p_ideas) <> 'array' or jsonb_array_length(p_ideas) = 0 or jsonb_array_length(p_ideas) > 10 then
    raise exception 'send 1 to 10 ideas';
  end if;
  prefix := (select string_agg(left(w, 1), '') from regexp_split_to_table(p_show, '-') w);
  for idea in select * from jsonb_array_elements(p_ideas) loop
    if coalesce(idea->>'title', '') = '' or coalesce(idea->>'logline', '') = '' then
      raise exception 'each idea needs a title and a logline';
    end if;
    base := prefix || '-' || trim(both '-' from left(regexp_replace(lower(idea->>'title'), '[^a-z0-9]+', '-', 'g'), 40));
    slug := base; n := 2;
    while exists (select 1 from public.episodes where id = slug) loop
      slug := base || '-' || n; n := n + 1;
    end loop;
    insert into public.episodes (id, show, title, status, autopilot, pitch)
    values (slug, p_show, left(idea->>'title', 120), 'idea', true,
            jsonb_build_object('logline', idea->>'logline', 'whyNow', idea->>'whyNow', 'angle', idea->>'angle',
                               'sources', coalesce(idea->'sources', '[]'::jsonb)));
    ids := ids || to_jsonb(slug);
  end loop;
  return ids;
end $$;

create function public.autopilot_claim(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.episodes;
begin
  perform private.autopilot_check(p_token);
  select * into e from public.episodes
   where status = 'researched' and autopilot and draft is null
     and (claimed_at is null or claimed_at < now() - interval '6 hours')
   order by updated_at
   for update skip locked
   limit 1;
  if not found then return null; end if;
  update public.episodes set claimed_at = now() where id = e.id;
  return jsonb_build_object('id', e.id, 'show', e.show, 'title', e.title, 'pitch', e.pitch,
                            'profile', (select profile from public.shows where id = e.show));
end $$;

create function public.autopilot_submit_draft(p_token text, p_episode text, p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.episodes;
  v_script text := p_draft->>'script';
  job uuid;
begin
  perform private.autopilot_check(p_token);
  select * into e from public.episodes where id = p_episode for update;
  if not found or not e.autopilot or e.status <> 'researched' or e.draft is not null then
    raise exception 'episode % is not an approved idea waiting for a draft', p_episode;
  end if;
  if coalesce(v_script, '') = '' or coalesce(p_draft->>'title', '') = '' or coalesce(p_draft->>'factSheet', '') = '' then
    raise exception 'a draft needs title, script and factSheet';
  end if;
  if length(v_script) > 40000 then raise exception 'script is too long (% characters)', length(v_script); end if;

  update public.episodes
     set draft = p_draft, script = v_script, fact_sheet = p_draft->>'factSheet',
         title = left(p_draft->>'title', 120), status = 'scripted', claimed_at = null
   where id = p_episode;
  insert into public.render_jobs (episode_id, kind, plan, assets, options, max_attempts)
  values (p_episode, 'voice', '{}'::jsonb, '{}'::jsonb,
          jsonb_build_object('script', v_script, 'maxCharacters', length(v_script) + 50, 'autopilot', true), 1)
  returning id into job;
  return jsonb_build_object('episode', p_episode, 'voiceJob', job);
end $$;

revoke execute on function private.autopilot_check(text) from public, anon, authenticated;
revoke execute on function public.autopilot_context(text) from public, authenticated;
revoke execute on function public.autopilot_submit_ideas(text, text, jsonb) from public, authenticated;
revoke execute on function public.autopilot_claim(text) from public, authenticated;
revoke execute on function public.autopilot_submit_draft(text, text, jsonb) from public, authenticated;
grant execute on function public.autopilot_context(text) to anon, service_role;
grant execute on function public.autopilot_submit_ideas(text, text, jsonb) to anon, service_role;
grant execute on function public.autopilot_claim(text) to anon, service_role;
grant execute on function public.autopilot_submit_draft(text, text, jsonb) to anon, service_role;

comment on function public.autopilot_context(text) is 'Autopilot writer entry point; intentionally callable by anon, gated by private.autopilot_check(token).';
comment on function public.autopilot_submit_ideas(text, text, jsonb) is 'Autopilot writer entry point; intentionally callable by anon, gated by private.autopilot_check(token).';
comment on function public.autopilot_claim(text) is 'Autopilot writer entry point; intentionally callable by anon, gated by private.autopilot_check(token).';
comment on function public.autopilot_submit_draft(text, text, jsonb) is 'Autopilot writer entry point; intentionally callable by anon, gated by private.autopilot_check(token).';
