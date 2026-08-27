-- thread-ai-coach-circle: Supabaseセットアップ用SQL
-- Supabase Dashboard > SQL Editor で全文貼り付けて Run

create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '（タイトル未設定）',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_user_updated_idx
  on public.sessions(user_id, updated_at desc);

alter table public.sessions enable row level security;

drop policy if exists "users select own sessions" on public.sessions;
drop policy if exists "users insert own sessions" on public.sessions;
drop policy if exists "users update own sessions" on public.sessions;
drop policy if exists "users delete own sessions" on public.sessions;

create policy "users select own sessions" on public.sessions
  for select using (auth.uid() = user_id);
create policy "users insert own sessions" on public.sessions
  for insert with check (auth.uid() = user_id);
create policy "users update own sessions" on public.sessions
  for update using (auth.uid() = user_id);
create policy "users delete own sessions" on public.sessions
  for delete using (auth.uid() = user_id);
