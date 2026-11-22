-- P2P Whiteboard: accounts. Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again. See docs/ACCOUNTS.md.
--
-- Two small tables. Drawings are NOT stored here (boards live in browsers and sync peer to peer);
-- only each person's list of boards and their display name / colour.
--
-- Row level security is what keeps accounts apart: every policy says "a row belongs to the
-- signed-in user whose id is in user_id". The public anon key in the web app can do nothing
-- without a signed-in user.

create table if not exists public.boards (
  user_id            uuid    not null references auth.users (id) on delete cascade,
  board_id           text    not null check (board_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  title              text    not null default 'Untitled board' check (char_length(title) between 1 and 80),
  role               text    not null default 'member' check (role in ('owner', 'member')),
  owner_key          text             check (owner_key is null or owner_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  view_only          boolean not null default false,
  password_protected boolean not null default false,
  created_at         bigint  not null,   -- milliseconds since 1970, set by the browser
  opened_at          bigint  not null,
  updated_at         bigint  not null,
  removed            boolean not null default false,  -- "removed from my list" (kept so it syncs to other devices)
  primary key (user_id, board_id)
);

create table if not exists public.profiles (
  user_id      uuid   primary key references auth.users (id) on delete cascade,
  display_name text   not null check (char_length(display_name) between 1 and 24),
  color        text   not null check (color ~* '^#[0-9a-f]{6}$'),
  updated_at   bigint not null
);

alter table public.boards   enable row level security;
alter table public.profiles enable row level security;

-- Recreate policies so re-running this file is harmless.
drop policy if exists "boards: own rows"   on public.boards;
drop policy if exists "profiles: own row"  on public.profiles;

create policy "boards: own rows" on public.boards
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "profiles: own row" on public.profiles
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Nothing for logged-out visitors.
revoke all on public.boards, public.profiles from anon;
grant select, insert, update, delete on public.boards, public.profiles to authenticated;

-- A per-account cap, so one account cannot fill the database.
create or replace function public.limit_boards_per_user() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.boards where user_id = new.user_id) >= 1000 then
    raise exception 'Too many boards in this account (limit 1000).';
  end if;
  return new;
end $$;

drop trigger if exists boards_limit on public.boards;
create trigger boards_limit before insert on public.boards
  for each row execute function public.limit_boards_per_user();
