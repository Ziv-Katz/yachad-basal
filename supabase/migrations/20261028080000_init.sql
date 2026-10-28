-- יחד בסל: shared shopping lists with grouped alerts.
-- Additions are grouped per person in pending_batches and released as one "added" event after a quiet minute
-- (or right away while someone else is shopping). Every new event is handed to the send-push Edge Function.

-- Everything lives in its own schema, so it can share an existing Supabase project with other apps
-- (the free tier allows two active projects). Add "yachad" under Project Settings > Data API > Exposed schemas.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create schema if not exists yachad;
grant usage on schema yachad to anon, authenticated, service_role;

-- ---------- tables ----------

create table yachad.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default ''
);

create or replace function yachad.new_invite_code() returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

create table yachad.lists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  owner_id uuid not null default auth.uid() references yachad.profiles on delete cascade,
  invite_code text not null unique default yachad.new_invite_code(),
  -- [{ "name": "שופרסל דיל", "lat": 32.08, "lng": 34.78 }]
  stores jsonb not null default '[]',
  -- { "active": true, "shopper_id": uuid, "started_at": epoch ms, "store_name": text|null, "ended_at": epoch ms }
  trip jsonb,
  created_at timestamptz not null default now()
);

create table yachad.list_members (
  list_id uuid not null references yachad.lists on delete cascade,
  user_id uuid not null references yachad.profiles on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (list_id, user_id)
);
create index on yachad.list_members (user_id);

create table yachad.items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references yachad.lists on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  qty text not null default '' check (char_length(qty) <= 12),
  aisle text not null default 'שונות',
  created_by uuid not null default auth.uid() references yachad.profiles on delete cascade,
  created_at timestamptz not null default now(),
  done boolean not null default false,
  done_by uuid references yachad.profiles on delete set null,
  done_at timestamptz
);
create index on yachad.items (list_id);

create table yachad.events (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references yachad.lists on delete cascade,
  type text not null check (type in ('added', 'at_store', 'summary')),
  created_by uuid not null default auth.uid() references yachad.profiles on delete cascade,
  created_at timestamptz not null default now(),
  -- added: { items: text[], urgent?: bool } · at_store: { store_name } · summary: { bought, missing, minutes }
  payload jsonb not null default '{}'
);
create index on yachad.events (list_id, created_at desc);

create table yachad.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references yachad.profiles on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index on yachad.push_subscriptions (user_id);

-- Server-only: items waiting to be announced together.
create table yachad.pending_batches (
  list_id uuid not null references yachad.lists on delete cascade,
  user_id uuid not null references yachad.profiles on delete cascade,
  items text[] not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

-- ---------- helpers ----------

create or replace function yachad.is_member(_list_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from yachad.list_members where list_id = _list_id and user_id = auth.uid());
$$;

create or replace function yachad.shares_list_with(_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select _user_id = auth.uid() or exists (
    select 1 from yachad.list_members a join yachad.list_members b using (list_id)
    where a.user_id = auth.uid() and b.user_id = _user_id
  );
$$;

-- Called by the app after sign-in. Profiles are created lazily, so other apps' users in the same project are untouched.
create or replace function yachad.ensure_profile(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  insert into yachad.profiles (id, name) values (auth.uid(), left(coalesce(trim(p_name), ''), 40))
  on conflict (id) do update set name = excluded.name where excluded.name <> '';
end $$;

-- Whoever creates a list is its first member.
create or replace function yachad.add_owner_as_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into yachad.list_members (list_id, user_id) values (new.id, new.owner_id);
  return new;
end $$;
create trigger on_list_created after insert on yachad.lists for each row execute function yachad.add_owner_as_member();

-- Join with an invite code. The only way to become a member of someone else's list.
create or replace function yachad.join_list(code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare _list_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select id into _list_id from yachad.lists where invite_code = upper(trim(code));
  if _list_id is null then raise exception 'invite code not found' using errcode = 'P0002'; end if;
  insert into yachad.list_members (list_id, user_id) values (_list_id, auth.uid()) on conflict do nothing;
  return _list_id;
end $$;

-- ---------- grouping additions ----------

create or replace function yachad.queue_item_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  _label text := new.name || case when new.qty <> '' then ' (' || new.qty || ')' else '' end;
  _trip jsonb;
  _waiting text[];
begin
  select trip into _trip from yachad.lists where id = new.list_id;
  if coalesce((_trip->>'active')::boolean, false) and (_trip->>'shopper_id')::uuid <> new.created_by then
    -- Someone is in the store: announce now, together with anything this person still had waiting.
    delete from yachad.pending_batches where list_id = new.list_id and user_id = new.created_by returning items into _waiting;
    insert into yachad.events (list_id, type, created_by, payload)
    values (new.list_id, 'added', new.created_by,
            jsonb_build_object('items', to_jsonb(coalesce(_waiting, '{}') || _label), 'urgent', true));
  else
    insert into yachad.pending_batches (list_id, user_id, items) values (new.list_id, new.created_by, array[_label])
    on conflict (list_id, user_id) do update set items = yachad.pending_batches.items || _label, last_at = now();
  end if;
  return new;
end $$;
create trigger on_item_created after insert on yachad.items for each row execute function yachad.queue_item_alert();

-- Release batches that have been quiet for a minute, or have waited five minutes in total.
create or replace function yachad.flush_batches() returns integer
language plpgsql security definer set search_path = '' as $$
declare _n integer;
begin
  with ready as (
    delete from yachad.pending_batches
    where last_at <= now() - interval '1 minute' or first_at <= now() - interval '5 minutes'
    returning *
  )
  insert into yachad.events (list_id, type, created_by, payload)
  select list_id, 'added', user_id, jsonb_build_object('items', to_jsonb(items)) from ready;
  get diagnostics _n = row_count;
  return _n;
end $$;

select cron.schedule('yachad-flush-item-batches', '* * * * *', 'select yachad.flush_batches()');

-- ---------- push dispatch ----------
-- Needs two Vault secrets (see README): project_url and push_webhook_secret.
create or replace function yachad.dispatch_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare _url text; _secret text;
begin
  select decrypted_secret into _url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into _secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if _url is null or _secret is null then
    raise log 'push skipped: vault secrets project_url / push_webhook_secret are not set';
    return new;
  end if;
  perform net.http_post(
    url := _url || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', _secret),
    body := jsonb_build_object('event_id', new.id)
  );
  return new;
end $$;
create trigger on_event_created after insert on yachad.events for each row execute function yachad.dispatch_push();

-- ---------- row level security ----------

alter table yachad.profiles enable row level security;
alter table yachad.lists enable row level security;
alter table yachad.list_members enable row level security;
alter table yachad.items enable row level security;
alter table yachad.events enable row level security;
alter table yachad.push_subscriptions enable row level security;
alter table yachad.pending_batches enable row level security; -- no policies: server only

create policy "see people I share a list with" on yachad.profiles for select to authenticated using (yachad.shares_list_with(id));
create policy "edit my own name" on yachad.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members see the list" on yachad.lists for select to authenticated using (yachad.is_member(id) or owner_id = auth.uid());
create policy "anyone signed in creates a list they own" on yachad.lists for insert to authenticated with check (owner_id = auth.uid());
create policy "members edit the list" on yachad.lists for update to authenticated using (yachad.is_member(id)) with check (yachad.is_member(id));
create policy "owner deletes the list" on yachad.lists for delete to authenticated using (owner_id = auth.uid());

create policy "members see each other" on yachad.list_members for select to authenticated using (yachad.is_member(list_id));
create policy "leave a list" on yachad.list_members for delete to authenticated using (user_id = auth.uid());

create policy "members read items" on yachad.items for select to authenticated using (yachad.is_member(list_id));
create policy "members add items" on yachad.items for insert to authenticated with check (yachad.is_member(list_id) and created_by = auth.uid());
create policy "members tick items" on yachad.items for update to authenticated using (yachad.is_member(list_id)) with check (yachad.is_member(list_id));
create policy "members remove items" on yachad.items for delete to authenticated using (yachad.is_member(list_id));

create policy "members read events" on yachad.events for select to authenticated using (yachad.is_member(list_id));
create policy "members announce arrival and summary" on yachad.events for insert to authenticated
  with check (yachad.is_member(list_id) and created_by = auth.uid() and type in ('at_store', 'summary'));

create policy "my devices" on yachad.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on all tables in schema yachad to authenticated, service_role;
revoke all on yachad.pending_batches from authenticated;
-- Members may change the name, saved stores and current trip, never the owner or invite code.
revoke update on yachad.lists from authenticated;
grant update (name, stores, trip) on yachad.lists to authenticated;
revoke execute on all functions in schema yachad from public, anon;
grant execute on function yachad.join_list(text), yachad.ensure_profile(text), yachad.is_member(uuid), yachad.shares_list_with(uuid),
  yachad.new_invite_code() to authenticated;

-- ---------- realtime ----------
alter publication supabase_realtime add table yachad.lists, yachad.list_members, yachad.items, yachad.events;
