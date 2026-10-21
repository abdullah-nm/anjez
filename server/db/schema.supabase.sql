-- Optional Supabase SQL. The running app uses SQLite (data/platform.sqlite)
-- plus local logo files. Apply this in Supabase only if you enable SUPABASE_*.
-- Do not change RAG embedding dimensions here. Platform tables only; RAG stays in schema.postgres.sql as vector(1536) unless you migrate.

create table if not exists brand_profiles (
  company_id text primary key,
  company_name text not null,
  industry text not null default '',
  description text not null default '',
  language text not null default 'ar',
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  city text not null default '',
  primary_color text not null default '#142433',
  accent_color text not null default '#c4a46a',
  slogan text not null default '',
  tone text not null default 'فاخر',
  logo_path text,
  logo_mime text,
  updated_at timestamptz not null default now()
);

create table if not exists company_events (
  id text primary key,
  company_id text not null,
  title text not null,
  date date not null,
  time text,
  description text not null default '',
  category text not null,
  audience text not null default '',
  status text not null default 'planned',
  reminder_days jsonb not null default '[7,1]',
  occasion_key text,
  recurring boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists designs (
  id text primary key,
  company_id text not null,
  event_id text,
  product_id text not null,
  purpose text not null default '',
  audience text not null default '',
  language text not null default 'ar',
  style text not null default '',
  dimensions text not null default 'square',
  instructions text not null default '',
  headline text not null,
  subhead text not null,
  body text not null,
  svg text not null,
  background_kind text not null,
  background_note text not null,
  status text not null default 'draft',
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notifications (
  id text primary key,
  company_id text not null,
  user_id text not null,
  event_id text,
  design_id text,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists reminder_deliveries (
  id text primary key,
  company_id text not null,
  event_id text not null,
  offset_days int not null,
  delivered_on date not null,
  unique (company_id, event_id, offset_days, delivered_on)
);

alter table brand_profiles enable row level security;
alter table company_events enable row level security;
alter table designs enable row level security;
alter table notifications enable row level security;
alter table reminder_deliveries enable row level security;
-- Replace company_members with your membership table. Never trust client company_id.

-- Example (adapt to your auth schema before applying in production):
-- create policy events_select on company_events for select using (
--   exists (select 1 from company_members m
--           where m.company_id = company_events.company_id
--             and m.user_id = auth.uid())
-- );

insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', false)
on conflict (id) do nothing;
