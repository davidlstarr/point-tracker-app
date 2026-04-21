-- Star Points HQ — Postgres schema for Supabase
--
-- Apply once:
--   Supabase Dashboard → SQL Editor → New query → paste this file → Run
--
-- Then:
--   Settings → API → copy Project URL + anon public key into config.js
--   (copy config.example.js → config.js and fill values)
--
-- Serve the app over http(s) (not file://) so ES module + Supabase requests work.
-- GitHub Pages: repo Settings → Pages → deploy from branch/folder containing index.html;
-- this repo includes .nojekyll and a <base> tag so assets work under /repo-name/.

create table if not exists public.kid_points (
    kid_id text primary key,
    points integer not null default 0,
    updated_at timestamptz not null default now(),
    constraint kid_points_kid_id_check check (kid_id in ('kts', 'kes')),
    constraint kid_points_points_nonnegative check (points >= 0)
);

comment on table public.kid_points is 'Point totals for each kid; updated by app via RPC.';

insert into public.kid_points (kid_id, points) values
    ('kts', 0),
    ('kes', 0)
on conflict (kid_id) do nothing;

-- Atomic add/subtract (avoids lost updates when two devices tap at once)
create or replace function public.increment_kid_points(p_kid_id text, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_new integer;
begin
    if p_kid_id is null or p_kid_id not in ('kts', 'kes') then
        raise exception 'invalid kid_id';
    end if;

    update public.kid_points
    set
        points = greatest(0, kid_points.points + p_delta),
        updated_at = now()
    where kid_id = p_kid_id
    returning points into v_new;

    if v_new is null then
        raise exception 'kid row missing; re-run seed insert';
    end if;

    return v_new;
end;
$$;

create or replace function public.reset_all_kid_points()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.kid_points
    set points = 0, updated_at = now();
end;
$$;

grant usage on schema public to anon, authenticated;

grant select on table public.kid_points to anon, authenticated;

revoke insert, update, delete on table public.kid_points from anon, authenticated;

grant execute on function public.increment_kid_points(text, integer) to anon, authenticated;
grant execute on function public.reset_all_kid_points() to anon, authenticated;

alter table public.kid_points enable row level security;

-- Direct reads for the app (writes go through SECURITY DEFINER RPCs above)
create policy kid_points_select_all
    on public.kid_points
    for select
    to anon, authenticated
    using (true);

-- Realtime: multi-device / multi-tab sync (idempotent)
do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'kid_points'
    ) then
        alter publication supabase_realtime add table public.kid_points;
    end if;
end $$;
