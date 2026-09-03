-- Server-owned installation credentials and replay protection.
-- These objects must never be accessed directly by application clients.

begin;

create table public.installation_credentials (
  installation_id uuid primary key,
  client_uuid text not null unique
    check (char_length(trim(client_uuid)) between 8 and 80),
  token_version text not null default 'ti1' check (token_version = 'ti1'),
  secret_digest bytea not null check (octet_length(secret_digest) = 32),
  created_at timestamptz not null default now(),
  last_authenticated_at timestamptz,
  revoked_at timestamptz
);

create table public.installation_request_nonces (
  installation_id uuid not null
    references public.installation_credentials (installation_id) on delete cascade,
  request_id uuid not null,
  request_timestamp timestamptz not null,
  consumed_at timestamptz not null default now(),
  primary key (installation_id, request_id)
);

create index idx_installation_request_nonces_consumed_at
  on public.installation_request_nonces (consumed_at);

-- Keep access server-only even if a future database role inherits broad schema access.
revoke all on table public.installation_credentials from public;
revoke all on table public.installation_request_nonces from public;

commit;
