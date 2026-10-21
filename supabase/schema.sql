-- AI Mentions paid reports.
-- The Supabase project starts empty. Paste this whole file once into the
-- Supabase SQL editor (Dashboard → SQL) and run it before the first paid report.
-- Vercel already has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The key is an
-- sb_secret_ value. The server sends it as the PostgREST apikey. It maps to
-- service_role, which bypasses row level security. There are no policies, and
-- anon, authenticated, and public have no grants, so the public Data API cannot
-- read these tables.

begin;

create table if not exists public.reports (
  token text primary key,
  session_id text,
  subscription_id text,
  origin text not null,
  product_id text not null,
  product_name text not null,
  customer_email text,
  customer_id text,
  business jsonb not null,
  fingerprint text not null,
  view jsonb not null,
  email jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.subscribers (
  subscription_id text primary key,
  customer_id text,
  email text,
  product_id text not null,
  business jsonb not null,
  fingerprint text,
  last_report_at timestamptz,
  status text not null default 'active',
  inactive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.report_history (
  id bigint generated always as identity primary key,
  subscription_id text not null references public.subscribers (subscription_id) on delete cascade,
  token text not null references public.reports (token) on delete cascade,
  created_at timestamptz not null default now(),
  unique (subscription_id, token)
);

create table if not exists public.checkout_sessions (
  session_id text primary key,
  token text not null unique references public.reports (token) on delete cascade,
  created_at timestamptz not null default now()
);

-- Short-lived lock so one checkout or one subscriber cannot generate two reports at once.
create table if not exists public.report_locks (
  name text primary key,
  expires_at timestamptz not null
);

create index if not exists reports_subscription_idx on public.reports (subscription_id);
create index if not exists subscribers_due_idx on public.subscribers (status, last_report_at);
create index if not exists report_history_sub_idx on public.report_history (subscription_id, created_at);

alter table public.reports enable row level security;
alter table public.subscribers enable row level security;
alter table public.report_history enable row level security;
alter table public.checkout_sessions enable row level security;
alter table public.report_locks enable row level security;

alter table public.reports force row level security;
alter table public.subscribers force row level security;
alter table public.report_history force row level security;
alter table public.checkout_sessions force row level security;
alter table public.report_locks force row level security;

revoke all on table public.reports from public, anon, authenticated;
revoke all on table public.subscribers from public, anon, authenticated;
revoke all on table public.report_history from public, anon, authenticated;
revoke all on table public.checkout_sessions from public, anon, authenticated;
revoke all on table public.report_locks from public, anon, authenticated;

grant all on table public.reports to service_role;
grant all on table public.subscribers to service_role;
grant all on table public.report_history to service_role;
grant all on table public.checkout_sessions to service_role;
grant all on table public.report_locks to service_role;

revoke all on sequence public.report_history_id_seq from public, anon, authenticated;
grant usage, select on sequence public.report_history_id_seq to service_role;

notify pgrst, 'reload schema';

commit;
