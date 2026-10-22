-- Free-score leads. Run this once in the Supabase SQL editor if
-- supabase/schema.sql was already applied before free_scores existed.
-- Safe to run again.

begin;

create table if not exists public.free_scores (
  id bigint generated always as identity primary key,
  email text not null,
  business_name text,
  domain text,
  category text,
  city text,
  score integer,
  providers jsonb not null default '[]'::jsonb,
  utm_source text,
  utm_campaign text,
  gclid text,
  email_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists free_scores_email_idx on public.free_scores (email, created_at desc);

alter table public.free_scores enable row level security;
alter table public.free_scores force row level security;

revoke all on table public.free_scores from public, anon, authenticated;
grant all on table public.free_scores to service_role;

revoke all on sequence public.free_scores_id_seq from public, anon, authenticated;
grant usage, select on sequence public.free_scores_id_seq to service_role;

notify pgrst, 'reload schema';

commit;
