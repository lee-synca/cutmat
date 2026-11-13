-- Cutmat Design: accounts and cloud copies of designs.
-- Run once in a Supabase project (SQL editor), then put the project's URL and publishable key in cloud-config.js.
--
-- Each design is stored twice:
--   * storage bucket "cutmat-designs", file "<user id>/<design id>.json": the full design, images included
--   * table public.cutmat_designs: one small row per design (name, size, thumbnail) for the "My designs" list
-- Row level security limits every signed-in person to their own rows and files.

create table if not exists public.cutmat_designs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (char_length(id) between 1 and 64),
  name       text        not null default 'Untitled design' check (char_length(name) <= 60),
  width      integer     not null check (width between 16 and 8000),
  height     integer     not null check (height between 16 and 8000),
  pages      integer     not null default 1 check (pages >= 1),
  thumb      text        check (thumb is null or char_length(thumb) < 400000),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.cutmat_designs enable row level security;

create policy "Cutmat: people read their own designs"
  on public.cutmat_designs for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Cutmat: people add their own designs"
  on public.cutmat_designs for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Cutmat: people change their own designs"
  on public.cutmat_designs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Cutmat: people delete their own designs"
  on public.cutmat_designs for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Private bucket for the design files: 50 MB per design, JSON only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cutmat-designs', 'cutmat-designs', false, 52428800, array['application/json'])
on conflict (id) do nothing;

create policy "Cutmat: people read their own design files"
  on storage.objects for select to authenticated
  using (bucket_id = 'cutmat-designs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Cutmat: people add their own design files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cutmat-designs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Cutmat: people change their own design files"
  on storage.objects for update to authenticated
  using (bucket_id = 'cutmat-designs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'cutmat-designs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Cutmat: people delete their own design files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cutmat-designs' and (storage.foldername(name))[1] = (select auth.uid())::text);
