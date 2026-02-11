create table if not exists public.scores (
  id bigserial primary key,
  player_name text not null check (char_length(trim(player_name)) between 1 and 20),
  client_uuid text not null unique check (char_length(trim(client_uuid)) between 8 and 80),
  score integer not null check (score >= 0),
  level integer not null check (level >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_scores_rank
  on public.scores (score desc, level desc, created_at desc);

alter table public.scores
  add column if not exists client_uuid text;

update public.scores
set client_uuid = concat('legacy-', id::text)
where client_uuid is null or trim(client_uuid) = '';

alter table public.scores
  alter column client_uuid set not null;

create unique index if not exists idx_scores_client_uuid
  on public.scores (client_uuid);

alter table public.scores enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'scores'
      and policyname = 'scores_select_public'
  ) then
    create policy scores_select_public
      on public.scores
      for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'scores'
      and policyname = 'scores_insert_public'
  ) then
    create policy scores_insert_public
      on public.scores
      for insert
      with check (
        char_length(trim(player_name)) between 1 and 20
        and char_length(trim(client_uuid)) between 8 and 80
        and score >= 0
        and level >= 0
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'scores'
      and policyname = 'scores_update_public'
  ) then
    create policy scores_update_public
      on public.scores
      for update
      using (true)
      with check (
        char_length(trim(player_name)) between 1 and 20
        and char_length(trim(client_uuid)) between 8 and 80
        and score >= 0
        and level >= 0
      );
  end if;
end $$;
