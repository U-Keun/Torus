create table if not exists public.scores (
  id bigserial primary key,
  player_name text not null check (char_length(trim(player_name)) between 1 and 20),
  client_uuid text not null check (char_length(trim(client_uuid)) between 8 and 80),
  score integer not null check (score >= 0),
  level integer not null check (level >= 0),
  skill_usage jsonb not null default '[]'::jsonb,
  mode text not null default 'classic',
  challenge_key text not null default 'classic',
  attempts_used integer not null default 0 check (attempts_used between 0 and 3),
  created_at timestamptz not null default now()
);

alter table public.scores
  add column if not exists client_uuid text;

alter table public.scores
  add column if not exists skill_usage jsonb not null default '[]'::jsonb;

alter table public.scores
  add column if not exists mode text not null default 'classic';

alter table public.scores
  add column if not exists challenge_key text not null default 'classic';

alter table public.scores
  add column if not exists attempts_used integer not null default 0;

update public.scores
set client_uuid = concat('legacy-', id::text)
where client_uuid is null or trim(client_uuid) = '';

update public.scores
set mode = 'classic'
where mode is null or trim(mode) = '';

update public.scores
set challenge_key = 'classic'
where challenge_key is null or trim(challenge_key) = '';

update public.scores
set attempts_used = case
  when mode = 'daily' then greatest(1, least(3, coalesce(attempts_used, 1)))
  else 0
end;

alter table public.scores
  alter column client_uuid set not null;

alter table public.scores
  alter column mode set not null;

alter table public.scores
  alter column challenge_key set not null;

alter table public.scores
  alter column attempts_used set not null;

alter table public.scores
  drop constraint if exists scores_client_uuid_key;

drop index if exists public.idx_scores_client_uuid;

create unique index if not exists idx_scores_mode_challenge_client_uuid
  on public.scores (mode, challenge_key, client_uuid);

create index if not exists idx_scores_rank
  on public.scores (score desc, level desc, created_at desc);

create index if not exists idx_scores_classic_rank
  on public.scores (score desc, level desc, created_at desc)
  where mode = 'classic' and challenge_key = 'classic';

create index if not exists idx_scores_daily_rank
  on public.scores (challenge_key, score desc, level desc, created_at desc)
  where mode = 'daily';

alter table public.scores enable row level security;

drop policy if exists scores_select_public on public.scores;
create policy scores_select_public
  on public.scores
  for select
  using (true);

drop policy if exists scores_insert_public on public.scores;
create policy scores_insert_public
  on public.scores
  for insert
  with check (
    char_length(trim(player_name)) between 1 and 20
    and char_length(trim(client_uuid)) between 8 and 80
    and score >= 0
    and level >= 0
    and mode = 'classic'
    and challenge_key = 'classic'
    and attempts_used = 0
  );

drop policy if exists scores_update_public on public.scores;
create policy scores_update_public
  on public.scores
  for update
  using (
    mode = 'classic'
    and challenge_key = 'classic'
  )
  with check (
    char_length(trim(player_name)) between 1 and 20
    and char_length(trim(client_uuid)) between 8 and 80
    and score >= 0
    and level >= 0
    and mode = 'classic'
    and challenge_key = 'classic'
    and attempts_used = 0
  );

create or replace function public.submit_daily_score(
  p_client_uuid text,
  p_challenge_key text,
  p_player_name text,
  p_score integer,
  p_level integer,
  p_created_at timestamptz,
  p_skill_usage jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_uuid text := trim(coalesce(p_client_uuid, ''));
  v_challenge_key text := trim(coalesce(p_challenge_key, ''));
  v_player_name text := left(trim(coalesce(p_player_name, '')), 20);
  v_score integer := greatest(coalesce(p_score, 0), 0);
  v_level integer := greatest(coalesce(p_level, 0), 0);
  v_created_at timestamptz := coalesce(p_created_at, now());
  v_skill_usage jsonb := coalesce(p_skill_usage, '[]'::jsonb);
  v_existing_id bigint;
  v_existing_score integer;
  v_existing_level integer;
  v_existing_attempts integer;
  v_attempts_used integer;
  v_attempts_left integer;
  v_is_better boolean;
  v_today_key text := to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD');
begin
  if char_length(v_client_uuid) < 8 then
    raise exception 'INVALID_CLIENT_UUID';
  end if;

  if v_player_name = '' then
    raise exception 'INVALID_PLAYER_NAME';
  end if;

  if v_challenge_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'INVALID_CHALLENGE_KEY';
  end if;

  if v_challenge_key <> v_today_key then
    raise exception 'CHALLENGE_KEY_MISMATCH';
  end if;

  if jsonb_typeof(v_skill_usage) <> 'array' then
    v_skill_usage := '[]'::jsonb;
  end if;

  select id, score, level, attempts_used
  into v_existing_id, v_existing_score, v_existing_level, v_existing_attempts
  from public.scores
  where mode = 'daily'
    and challenge_key = v_challenge_key
    and client_uuid = v_client_uuid
  limit 1
  for update;

  if not found then
    v_attempts_used := 1;
    insert into public.scores (
      player_name,
      client_uuid,
      score,
      level,
      skill_usage,
      mode,
      challenge_key,
      attempts_used,
      created_at
    ) values (
      v_player_name,
      v_client_uuid,
      v_score,
      v_level,
      v_skill_usage,
      'daily',
      v_challenge_key,
      v_attempts_used,
      v_created_at
    );

    v_attempts_left := greatest(0, 3 - v_attempts_used);
    return jsonb_build_object(
      'accepted', true,
      'improved', true,
      'challengeKey', v_challenge_key,
      'attemptsUsed', v_attempts_used,
      'attemptsLeft', v_attempts_left,
      'maxAttempts', 3,
      'canSubmit', v_attempts_left > 0
    );
  end if;

  v_attempts_used := least(3, greatest(0, coalesce(v_existing_attempts, 0)));
  if v_attempts_used >= 3 then
    return jsonb_build_object(
      'accepted', false,
      'improved', false,
      'challengeKey', v_challenge_key,
      'attemptsUsed', v_attempts_used,
      'attemptsLeft', 0,
      'maxAttempts', 3,
      'canSubmit', false
    );
  end if;

  v_attempts_used := v_attempts_used + 1;
  v_is_better := v_score > v_existing_score
    or (v_score = v_existing_score and v_level > v_existing_level);

  update public.scores
  set
    attempts_used = v_attempts_used,
    player_name = case when v_is_better then v_player_name else player_name end,
    score = case when v_is_better then v_score else score end,
    level = case when v_is_better then v_level else level end,
    created_at = case when v_is_better then v_created_at else created_at end,
    skill_usage = case when v_is_better then v_skill_usage else skill_usage end
  where id = v_existing_id;

  v_attempts_left := greatest(0, 3 - v_attempts_used);
  return jsonb_build_object(
    'accepted', true,
    'improved', v_is_better,
    'challengeKey', v_challenge_key,
    'attemptsUsed', v_attempts_used,
    'attemptsLeft', v_attempts_left,
    'maxAttempts', 3,
    'canSubmit', v_attempts_left > 0
  );
end;
$$;

grant execute on function public.submit_daily_score(
  text,
  text,
  text,
  integer,
  integer,
  timestamptz,
  jsonb
) to anon, authenticated;
