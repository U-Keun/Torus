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

alter table public.scores
  add column if not exists daily_has_submission boolean not null default false;

alter table public.scores
  add column if not exists active_attempt_token text;

alter table public.scores
  add column if not exists active_attempt_started_at timestamptz;

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

update public.scores
set daily_has_submission = case
  when mode = 'daily' then true
  else false
end;

update public.scores
set active_attempt_token = null,
    active_attempt_started_at = null
where mode <> 'daily';

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

drop index if exists public.idx_scores_daily_rank;

create index if not exists idx_scores_daily_rank
  on public.scores (challenge_key, score desc, level desc, created_at desc)
  where mode = 'daily' and daily_has_submission = true;

alter table public.scores enable row level security;

drop policy if exists scores_select_public on public.scores;
create policy scores_select_public
  on public.scores
  for select
  using (true);

drop policy if exists scores_insert_public on public.scores;

drop policy if exists scores_update_public on public.scores;

drop function if exists public.submit_daily_score(
  text,
  text,
  text,
  integer,
  integer,
  timestamptz,
  jsonb
);

drop function if exists public.submit_global_score(
  text,
  text,
  integer,
  integer,
  timestamptz,
  jsonb
);

create or replace function public.submit_global_score(
  p_client_uuid text,
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
  v_player_name text := left(trim(coalesce(p_player_name, '')), 20);
  v_score integer := greatest(coalesce(p_score, 0), 0);
  v_level integer := greatest(coalesce(p_level, 0), 0);
  v_created_at timestamptz := coalesce(p_created_at, now());
  v_skill_usage jsonb := coalesce(p_skill_usage, '[]'::jsonb);
  v_existing_id bigint;
  v_existing_score integer := 0;
  v_existing_level integer := 0;
  v_is_better boolean := false;
begin
  if char_length(v_client_uuid) < 8 then
    raise exception 'INVALID_CLIENT_UUID';
  end if;

  if v_player_name = '' then
    raise exception 'INVALID_PLAYER_NAME';
  end if;

  if jsonb_typeof(v_skill_usage) <> 'array' then
    v_skill_usage := '[]'::jsonb;
  end if;

  select id, score, level
  into v_existing_id, v_existing_score, v_existing_level
  from public.scores
  where mode = 'classic'
    and challenge_key = 'classic'
    and client_uuid = v_client_uuid
  limit 1
  for update;

  if not found then
    insert into public.scores (
      player_name,
      client_uuid,
      score,
      level,
      skill_usage,
      mode,
      challenge_key,
      attempts_used,
      daily_has_submission,
      active_attempt_token,
      active_attempt_started_at,
      created_at
    ) values (
      v_player_name,
      v_client_uuid,
      v_score,
      v_level,
      v_skill_usage,
      'classic',
      'classic',
      0,
      false,
      null,
      null,
      v_created_at
    );

    return jsonb_build_object(
      'accepted', true,
      'improved', true
    );
  end if;

  v_is_better := v_score > v_existing_score
    or (v_score = v_existing_score and v_level > v_existing_level);

  if v_is_better then
    update public.scores
    set
      player_name = v_player_name,
      score = v_score,
      level = v_level,
      created_at = v_created_at,
      skill_usage = v_skill_usage,
      attempts_used = 0,
      daily_has_submission = false,
      active_attempt_token = null,
      active_attempt_started_at = null
    where id = v_existing_id;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'improved', v_is_better
  );
end;
$$;

create or replace function public.start_daily_attempt(
  p_client_uuid text,
  p_challenge_key text,
  p_player_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_uuid text := trim(coalesce(p_client_uuid, ''));
  v_challenge_key text := trim(coalesce(p_challenge_key, ''));
  v_player_name text := left(trim(coalesce(p_player_name, 'Pending')), 20);
  v_existing_id bigint;
  v_attempts_used integer := 0;
  v_attempts_left integer := 0;
  v_active_attempt_token text := null;
  v_today_key text := to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD');
begin
  if char_length(v_client_uuid) < 8 then
    raise exception 'INVALID_CLIENT_UUID';
  end if;

  if v_challenge_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'INVALID_CHALLENGE_KEY';
  end if;

  if v_challenge_key <> v_today_key then
    raise exception 'CHALLENGE_KEY_MISMATCH';
  end if;

  if v_player_name = '' then
    v_player_name := 'Pending';
  end if;

  -- Retain only today's Daily rows. Older Daily rows are not used by the app.
  delete from public.scores
  where mode = 'daily'
    and challenge_key <> v_today_key;

  select id, attempts_used, active_attempt_token
  into v_existing_id, v_attempts_used, v_active_attempt_token
  from public.scores
  where mode = 'daily'
    and challenge_key = v_challenge_key
    and client_uuid = v_client_uuid
  limit 1
  for update;

  if not found then
    insert into public.scores (
      player_name,
      client_uuid,
      score,
      level,
      skill_usage,
      mode,
      challenge_key,
      attempts_used,
      daily_has_submission,
      active_attempt_token,
      active_attempt_started_at,
      created_at
    ) values (
      v_player_name,
      v_client_uuid,
      0,
      0,
      '[]'::jsonb,
      'daily',
      v_challenge_key,
      0,
      false,
      null,
      null,
      now()
    )
    returning id, attempts_used, active_attempt_token
    into v_existing_id, v_attempts_used, v_active_attempt_token;
  end if;

  v_attempts_used := least(3, greatest(0, coalesce(v_attempts_used, 0)));
  v_active_attempt_token := nullif(trim(coalesce(v_active_attempt_token, '')), '');

  if v_active_attempt_token is not null then
    v_attempts_left := greatest(0, 3 - v_attempts_used);
    return jsonb_build_object(
      'accepted', true,
      'resumed', true,
      'attemptToken', v_active_attempt_token,
      'challengeKey', v_challenge_key,
      'attemptsUsed', v_attempts_used,
      'attemptsLeft', v_attempts_left,
      'maxAttempts', 3,
      'canSubmit', v_attempts_left > 0,
      'hasActiveAttempt', true
    );
  end if;

  if v_attempts_used >= 3 then
    return jsonb_build_object(
      'accepted', false,
      'resumed', false,
      'attemptToken', null,
      'challengeKey', v_challenge_key,
      'attemptsUsed', v_attempts_used,
      'attemptsLeft', 0,
      'maxAttempts', 3,
      'canSubmit', false,
      'hasActiveAttempt', false
    );
  end if;

  v_attempts_used := v_attempts_used + 1;
  v_active_attempt_token := md5(
    random()::text || clock_timestamp()::text || v_client_uuid || v_challenge_key
  );

  update public.scores
  set
    attempts_used = v_attempts_used,
    active_attempt_token = v_active_attempt_token,
    active_attempt_started_at = now()
  where id = v_existing_id;

  v_attempts_left := greatest(0, 3 - v_attempts_used);
  return jsonb_build_object(
    'accepted', true,
    'resumed', false,
    'attemptToken', v_active_attempt_token,
    'challengeKey', v_challenge_key,
    'attemptsUsed', v_attempts_used,
    'attemptsLeft', v_attempts_left,
    'maxAttempts', 3,
    'canSubmit', v_attempts_left > 0,
    'hasActiveAttempt', true
  );
end;
$$;

create or replace function public.submit_daily_score(
  p_client_uuid text,
  p_challenge_key text,
  p_attempt_token text,
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
  v_attempt_token text := trim(coalesce(p_attempt_token, ''));
  v_player_name text := left(trim(coalesce(p_player_name, '')), 20);
  v_score integer := greatest(coalesce(p_score, 0), 0);
  v_level integer := greatest(coalesce(p_level, 0), 0);
  v_created_at timestamptz := coalesce(p_created_at, now());
  v_skill_usage jsonb := coalesce(p_skill_usage, '[]'::jsonb);
  v_existing_id bigint;
  v_existing_score integer := 0;
  v_existing_level integer := 0;
  v_existing_attempts integer := 0;
  v_existing_active_attempt_token text := null;
  v_existing_has_submission boolean := false;
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

  if v_attempt_token = '' then
    raise exception 'INVALID_ATTEMPT_TOKEN';
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

  -- Retain only today's Daily rows. Older Daily rows are not used by the app.
  delete from public.scores
  where mode = 'daily'
    and challenge_key <> v_today_key;

  select id, score, level, attempts_used, active_attempt_token, daily_has_submission
  into v_existing_id, v_existing_score, v_existing_level, v_existing_attempts,
    v_existing_active_attempt_token, v_existing_has_submission
  from public.scores
  where mode = 'daily'
    and challenge_key = v_challenge_key
    and client_uuid = v_client_uuid
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'accepted', false,
      'improved', false,
      'challengeKey', v_challenge_key,
      'attemptsUsed', 0,
      'attemptsLeft', 3,
      'maxAttempts', 3,
      'canSubmit', true,
      'hasActiveAttempt', false
    );
  end if;

  v_attempts_used := least(3, greatest(0, coalesce(v_existing_attempts, 0)));
  v_attempts_left := greatest(0, 3 - v_attempts_used);
  v_existing_active_attempt_token := nullif(trim(coalesce(v_existing_active_attempt_token, '')), '');

  if v_existing_active_attempt_token is null then
    return jsonb_build_object(
      'accepted', false,
      'improved', false,
      'challengeKey', v_challenge_key,
      'attemptsUsed', v_attempts_used,
      'attemptsLeft', v_attempts_left,
      'maxAttempts', 3,
      'canSubmit', v_attempts_left > 0,
      'hasActiveAttempt', false
    );
  end if;

  if v_existing_active_attempt_token <> v_attempt_token then
    return jsonb_build_object(
      'accepted', false,
      'improved', false,
      'challengeKey', v_challenge_key,
      'attemptsUsed', v_attempts_used,
      'attemptsLeft', v_attempts_left,
      'maxAttempts', 3,
      'canSubmit', v_attempts_left > 0,
      'hasActiveAttempt', true
    );
  end if;

  v_is_better := (not v_existing_has_submission)
    or v_score > v_existing_score
    or (v_score = v_existing_score and v_level > v_existing_level);

  update public.scores
  set
    attempts_used = v_attempts_used,
    active_attempt_token = null,
    active_attempt_started_at = null,
    daily_has_submission = true,
    player_name = case when v_is_better then v_player_name else player_name end,
    score = case when v_is_better then v_score else score end,
    level = case when v_is_better then v_level else level end,
    created_at = case when v_is_better then v_created_at else created_at end,
    skill_usage = case when v_is_better then v_skill_usage else skill_usage end
  where id = v_existing_id;

  return jsonb_build_object(
    'accepted', true,
    'improved', v_is_better,
    'challengeKey', v_challenge_key,
    'attemptsUsed', v_attempts_used,
    'attemptsLeft', v_attempts_left,
    'maxAttempts', 3,
    'canSubmit', v_attempts_left > 0,
    'hasActiveAttempt', false
  );
end;
$$;

create or replace function public.forfeit_daily_attempt(
  p_client_uuid text,
  p_challenge_key text,
  p_attempt_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_uuid text := trim(coalesce(p_client_uuid, ''));
  v_challenge_key text := trim(coalesce(p_challenge_key, ''));
  v_attempt_token text := trim(coalesce(p_attempt_token, ''));
  v_existing_id bigint;
  v_existing_attempts integer := 0;
  v_existing_active_attempt_token text := null;
  v_attempts_used integer := 0;
  v_attempts_left integer := 0;
  v_today_key text := to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD');
begin
  if char_length(v_client_uuid) < 8 then
    raise exception 'INVALID_CLIENT_UUID';
  end if;

  if v_attempt_token = '' then
    raise exception 'INVALID_ATTEMPT_TOKEN';
  end if;

  if v_challenge_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'INVALID_CHALLENGE_KEY';
  end if;

  if v_challenge_key <> v_today_key then
    raise exception 'CHALLENGE_KEY_MISMATCH';
  end if;

  -- Retain only today's Daily rows. Older Daily rows are not used by the app.
  delete from public.scores
  where mode = 'daily'
    and challenge_key <> v_today_key;

  select id, attempts_used, active_attempt_token
  into v_existing_id, v_existing_attempts, v_existing_active_attempt_token
  from public.scores
  where mode = 'daily'
    and challenge_key = v_challenge_key
    and client_uuid = v_client_uuid
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'accepted', false,
      'challengeKey', v_challenge_key,
      'attemptsUsed', 0,
      'attemptsLeft', 3,
      'maxAttempts', 3,
      'canSubmit', true,
      'hasActiveAttempt', false
    );
  end if;

  v_attempts_used := least(3, greatest(0, coalesce(v_existing_attempts, 0)));
  v_attempts_left := greatest(0, 3 - v_attempts_used);
  v_existing_active_attempt_token := nullif(trim(coalesce(v_existing_active_attempt_token, '')), '');

  if v_existing_active_attempt_token is null or v_existing_active_attempt_token <> v_attempt_token then
    return jsonb_build_object(
      'accepted', false,
      'challengeKey', v_challenge_key,
      'attemptsUsed', v_attempts_used,
      'attemptsLeft', v_attempts_left,
      'maxAttempts', 3,
      'canSubmit', v_attempts_left > 0,
      'hasActiveAttempt', v_existing_active_attempt_token is not null
    );
  end if;

  update public.scores
  set
    active_attempt_token = null,
    active_attempt_started_at = null
  where id = v_existing_id;

  return jsonb_build_object(
    'accepted', true,
    'challengeKey', v_challenge_key,
    'attemptsUsed', v_attempts_used,
    'attemptsLeft', v_attempts_left,
    'maxAttempts', 3,
    'canSubmit', v_attempts_left > 0,
    'hasActiveAttempt', false
  );
end;
$$;

grant execute on function public.start_daily_attempt(
  text,
  text,
  text
) to anon, authenticated;

grant execute on function public.submit_global_score(
  text,
  text,
  integer,
  integer,
  timestamptz,
  jsonb
) to service_role;

revoke execute on function public.submit_global_score(
  text,
  text,
  integer,
  integer,
  timestamptz,
  jsonb
) from anon, authenticated;

grant execute on function public.submit_daily_score(
  text,
  text,
  text,
  text,
  integer,
  integer,
  timestamptz,
  jsonb
) to service_role;

revoke execute on function public.submit_daily_score(
  text,
  text,
  text,
  text,
  integer,
  integer,
  timestamptz,
  jsonb
) from anon, authenticated;

grant execute on function public.forfeit_daily_attempt(
  text,
  text,
  text
) to anon, authenticated;
