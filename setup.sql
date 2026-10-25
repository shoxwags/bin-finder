-- ============================================================
--  Barcode Bin Finder — Supabase setup
--  Paste this whole file into Supabase > SQL Editor > New query, then click Run. Run it once.
-- ============================================================

-- 1. A private storage bucket for the product file (not public: no one can read it without signing in).
insert into storage.buckets (id, name, public, file_size_limit)
values ('product-data', 'product-data', false, 52428800)
on conflict (id) do nothing;

-- 2. Who may upload new product lists.
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;

drop policy if exists "Users can see whether they are admin" on public.app_admins;
create policy "Users can see whether they are admin"
  on public.app_admins for select to authenticated
  using (user_id = auth.uid());

-- 3. Storage rules.
--    Any signed-in staff member can read (download) the product file.
drop policy if exists "Staff can read product data" on storage.objects;
create policy "Staff can read product data"
  on storage.objects for select to authenticated
  using (bucket_id = 'product-data');

--    Only admins can upload or replace it.
drop policy if exists "Admins can upload product data" on storage.objects;
create policy "Admins can upload product data"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-data' and exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

drop policy if exists "Admins can replace product data" on storage.objects;
create policy "Admins can replace product data"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-data' and exists (select 1 from public.app_admins a where a.user_id = auth.uid()))
  with check (bucket_id = 'product-data' and exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

drop policy if exists "Admins can delete product data" on storage.objects;
create policy "Admins can delete product data"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-data' and exists (select 1 from public.app_admins a where a.user_id = auth.uid()));


-- ============================================================
--  AFTER you have created your own user (Authentication > Users > Add user),
--  make yourself admin: change the email below, select ONLY these lines, and click Run.
-- ============================================================
-- insert into public.app_admins (user_id)
-- select id from auth.users where email = 'your.email@othaim.com'
-- on conflict do nothing;
