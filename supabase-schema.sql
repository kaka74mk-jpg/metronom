create table if not exists public.mk_studio_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.mk_studio_data enable row level security;
drop policy if exists "users can read own studio data" on public.mk_studio_data;
drop policy if exists "users can insert own studio data" on public.mk_studio_data;
drop policy if exists "users can update own studio data" on public.mk_studio_data;
create policy "users can read own studio data" on public.mk_studio_data for select using (auth.uid() = user_id);
create policy "users can insert own studio data" on public.mk_studio_data for insert with check (auth.uid() = user_id);
create policy "users can update own studio data" on public.mk_studio_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter publication supabase_realtime add table public.mk_studio_data;

-- Recording Storage
insert into storage.buckets (id, name, public) values ('mk-studio-recordings', 'mk-studio-recordings', false) on conflict (id) do nothing;
drop policy if exists "MK Studio recordings read own" on storage.objects;
drop policy if exists "MK Studio recordings upload own" on storage.objects;
drop policy if exists "MK Studio recordings delete own" on storage.objects;
create policy "MK Studio recordings read own" on storage.objects for select to authenticated using (bucket_id = 'mk-studio-recordings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "MK Studio recordings upload own" on storage.objects for insert to authenticated with check (bucket_id = 'mk-studio-recordings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "MK Studio recordings delete own" on storage.objects for delete to authenticated using (bucket_id = 'mk-studio-recordings' and (storage.foldername(name))[1] = auth.uid()::text);
