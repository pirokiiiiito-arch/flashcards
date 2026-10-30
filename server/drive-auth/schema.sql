-- NOT APPLIED. This is an additive, server-only prerequisite, not a card migration.
-- Google refresh credentials are encrypted by Vault. No browser role gets access.
begin;
create schema if not exists flashcards_auth_private;
revoke all on schema flashcards_auth_private from public, anon, authenticated;
create table if not exists flashcards_auth_private.drive_connections (
  owner uuid primary key references auth.users(id) on delete cascade,
  google_sub text not null,
  permission_id text not null,
  email text not null,
  secret_id uuid not null,
  version uuid not null default gen_random_uuid(),
  revoked boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists flashcards_auth_private.drive_oauth_intents (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  owner uuid not null references auth.users(id) on delete cascade,
  challenge text not null check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  expected_account text not null default '',
  expires_at timestamptz not null default (now()+interval '10 minutes')
);
alter table flashcards_auth_private.drive_connections enable row level security;
alter table flashcards_auth_private.drive_oauth_intents enable row level security;
revoke all on all tables in schema flashcards_auth_private from public, anon, authenticated;

-- A narrowly scoped privileged RPC, callable ONLY by the backend service role.
-- The Edge Function verifies Supabase /auth/v1/user and derives owner from that
-- response; owner is never accepted from the browser. SECURITY DEFINER is used
-- intentionally so service_role needs no general access to vault.decrypted_secrets.
create or replace function public.flashcards_drive_auth_store(
  operation text, owner_id uuid, payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  row_ flashcards_auth_private.drive_connections%rowtype;
  intent flashcards_auth_private.drive_oauth_intents%rowtype;
  secret_value text;
  secret_uuid uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise insufficient_privilege using message='Backend service role required';
  end if;
  if operation='config' then
    select decrypted_secret into secret_value from vault.decrypted_secrets
      where name='flashcards_google_client_secret';
    return jsonb_build_object('client_secret',secret_value);
  end if;
  if owner_id is null or not exists(select 1 from auth.users u where u.id=owner_id and u.email_confirmed_at is not null) then
    raise insufficient_privilege using message='Verified owner required';
  end if;
  if operation='begin' then
    delete from flashcards_auth_private.drive_oauth_intents where owner=owner_id and expires_at<now();
    if (select count(*) from flashcards_auth_private.drive_oauth_intents where owner=owner_id)>=20 then
      raise exception 'Too many pending login attempts';
    end if;
    insert into flashcards_auth_private.drive_oauth_intents(state_hash,owner,challenge,expected_account)
      values(payload->>'state_hash',owner_id,payload->>'challenge',coalesce(payload->>'expected_account',''));
    return '{"created":true}'::jsonb;
  elsif operation='take' then
    delete from flashcards_auth_private.drive_oauth_intents
      where state_hash=payload->>'state_hash' and owner=owner_id
        and challenge=payload->>'challenge' and expires_at>now()
      returning * into intent;
    if not found then return null; end if;
    return jsonb_build_object('expected_account',intent.expected_account);
  end if;
  -- Serializes link creation, refresh-token rotation, and revocation per user.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,381426));
  select * into row_ from flashcards_auth_private.drive_connections where owner=owner_id for update;
  if operation='read' then
    if row_.owner is null then return null; end if;
    select decrypted_secret into secret_value from vault.decrypted_secrets where id=row_.secret_id;
    return jsonb_build_object('sub',row_.google_sub,'account',row_.permission_id,
      'refresh_token',secret_value,'version',row_.version,'revoked',row_.revoked);
  elsif operation='save' then
    if length(coalesce(payload->>'refresh_token',''))<10 or length(payload->>'refresh_token')>8192 then raise exception 'Invalid refresh credential'; end if;
    if row_.owner is not null and (row_.google_sub is distinct from payload->>'sub' or row_.permission_id is distinct from payload->>'account') then
      raise exception 'Connection account mismatch';
    end if;
    if row_.owner is null then
      secret_uuid:=vault.create_secret(payload->>'refresh_token','flashcards_drive_refresh_'||owner_id::text,'Private Google Drive refresh credential');
      insert into flashcards_auth_private.drive_connections(owner,google_sub,permission_id,email,secret_id)
        values(owner_id,payload->>'sub',payload->>'account',payload->>'email',secret_uuid);
    else
      perform vault.update_secret(row_.secret_id,payload->>'refresh_token');
      update flashcards_auth_private.drive_connections set revoked=false,version=gen_random_uuid(),updated_at=now() where owner=owner_id;
    end if;
    return '{"saved":true}'::jsonb;
  elsif operation='rotate' then
    if row_.owner is null or row_.revoked or row_.version::text is distinct from payload->>'version' then return null; end if;
    if length(coalesce(payload->>'refresh_token',''))<10 or length(payload->>'refresh_token')>8192 then raise exception 'Invalid refresh credential'; end if;
    perform vault.update_secret(row_.secret_id,payload->>'refresh_token');
    update flashcards_auth_private.drive_connections set version=gen_random_uuid(),updated_at=now()
      where owner=owner_id returning * into row_;
    return jsonb_build_object('version',row_.version);
  elsif operation='invalidate' then
    update flashcards_auth_private.drive_connections set revoked=true,updated_at=now()
      where owner=owner_id and version::text=payload->>'version';
    return '{"invalidated":true}'::jsonb;
  elsif operation='remove' then
    if row_.owner is not null then
      delete from flashcards_auth_private.drive_connections where owner=owner_id;
      delete from vault.secrets where id=row_.secret_id;
    end if;
    delete from flashcards_auth_private.drive_oauth_intents where owner=owner_id;
    return '{"removed":true}'::jsonb;
  end if;
  raise exception 'Unsupported authentication operation';
end $$;
revoke all on function public.flashcards_drive_auth_store(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.flashcards_drive_auth_store(text,uuid,jsonb) to service_role;
comment on function public.flashcards_drive_auth_store(text,uuid,jsonb) is 'Server-only OAuth store; never call from a browser. JWT role and EXECUTE grants both require service_role.';
commit;
