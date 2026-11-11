-- Loto Scanner: run this once in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.loto_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cards jsonb not null default '[]'::jsonb,
  called jsonb not null default '[]'::jsonb,
  rule text not null default 'line',
  updated_at timestamptz not null default now()
);

alter table public.loto_states enable row level security;
drop policy if exists "Users can read own loto state" on public.loto_states;
drop policy if exists "Users can insert own loto state" on public.loto_states;
drop policy if exists "Users can update own loto state" on public.loto_states;
create policy "Users can read own loto state" on public.loto_states for select using (auth.uid() = user_id);
create policy "Users can insert own loto state" on public.loto_states for insert with check (auth.uid() = user_id);
create policy "Users can update own loto state" on public.loto_states for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Optional shareable game sessions. Add this before enabling the Share button.
create table if not exists public.loto_shares (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  owner_id uuid references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.loto_shares enable row level security;
drop policy if exists "Owners manage shares" on public.loto_shares;
drop policy if exists "Anyone can read active shares" on public.loto_shares;
create policy "Owners manage shares" on public.loto_shares for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Guests can create shares" on public.loto_shares for insert to anon with check (owner_id is null);
create policy "Anyone can update shared rooms" on public.loto_shares for update to public using (expires_at is null or expires_at > now()) with check (owner_id is null);
create policy "Anyone can read active shares" on public.loto_shares for select using (expires_at is null or expires_at > now());

-- Migration for an existing table:
-- alter table public.loto_shares add column if not exists updated_at timestamptz not null default now();
-- alter table public.loto_shares alter column owner_id drop not null;
-- create policy "Anyone can update shared rooms" on public.loto_shares for update to public using (expires_at is null or expires_at > now()) with check (owner_id is null);

-- If loto_shares was already created with owner_id NOT NULL, run this migration too:
-- alter table public.loto_shares alter column owner_id drop not null;
