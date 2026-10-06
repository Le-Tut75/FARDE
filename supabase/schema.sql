-- =====================================================================
--  FARDE : schéma de la base de données
--  À coller en entier dans Supabase > SQL Editor > New query > Run.
--  Le script peut être relancé sans risque (il ne supprime aucune donnée).
-- =====================================================================

-- ---------- Fonctions utilitaires ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- =====================================================================
--  1. DONNÉES PERSONNELLES (chaque utilisateur ne voit que les siennes)
-- =====================================================================

create table if not exists public.user_settings (
  user_id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  basis            text not null default 'trend' check (basis in ('trend','avg30','avg7','avg1','low','avg')),
  default_lang     text not null default 'fr',
  cond             jsonb not null default '{"NM":1,"EX":0.85,"GD":0.7,"LP":0.55,"PL":0.4,"PO":0.25}'::jsonb,
  telegram_chat_id text,
  updated_at       timestamptz not null default now()
);

create table if not exists public.binders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  layout     text not null default '3x3' check (layout in ('3x3','4x3','4x4')),
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists binders_user_idx on public.binders(user_id);

create table if not exists public.collection (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lang            text not null,
  card_id         text not null,                 -- identifiant TCGdex, ex. "sv03.5-199"
  name            text not null,
  local_id        text,                          -- numéro dans la série, ex. "199"
  set_id          text,
  set_name        text,
  set_total       int,
  image           text,
  rarity          text,
  variant         text not null default 'normal',
  condition       text not null default 'NM' check (condition in ('NM','EX','GD','LP','PL','PO')),
  qty             int  not null default 1 check (qty between 1 and 9999),
  buy_price       numeric(12,2) check (buy_price >= 0),
  buy_date        date,
  binder_id       uuid references public.binders(id) on delete set null,
  grading_company text,
  grade           text,
  manual_price    numeric(12,2) check (manual_price >= 0),
  notes           text,
  source          text not null default 'manuel',  -- 'manuel' ou 'import'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists collection_user_idx on public.collection(user_id);
create index if not exists collection_card_idx on public.collection(lang, card_id);

create table if not exists public.sealed (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cm_id        int,                              -- identifiant produit Cardmarket (cote automatique)
  name         text not null,
  category     text,
  lang         text not null default 'fr',
  qty          int  not null default 1 check (qty between 1 and 9999),
  buy_price    numeric(12,2) check (buy_price >= 0),
  buy_date     date,
  manual_price numeric(12,2) check (manual_price >= 0),
  url          text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sealed_user_idx on public.sealed(user_id);

create table if not exists public.wishlist (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lang          text not null,
  card_id       text not null,
  name          text not null,
  local_id      text,
  set_name      text,
  image         text,
  variant       text not null default 'normal',
  target_price  numeric(12,2) check (target_price >= 0),
  last_alert_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, lang, card_id, variant)
);
create index if not exists wishlist_user_idx on public.wishlist(user_id);

create table if not exists public.portfolio_history (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  d            date not null,
  value        numeric(14,2) not null,
  invested     numeric(14,2) not null,
  cards_value  numeric(14,2),
  sealed_value numeric(14,2),
  primary key (user_id, d)
);

-- =====================================================================
--  2. DONNÉES DE MARCHÉ (écrites par la tâche quotidienne, lues par tous)
-- =====================================================================

-- Dernière cote connue de chaque carte suivie
create table if not exists public.card_prices (
  lang       text not null,
  card_id    text not null,
  cm_id      int,
  name       text,
  set_name   text,
  local_id   text,
  image      text,
  cm         jsonb,          -- cote Cardmarket : trend, avg30, low, trend-holo…
  tcgplayer  jsonb,
  source     text,           -- 'tcgdex' ou 'cardmarket'
  updated_at timestamptz not null default now(),
  primary key (lang, card_id)
);

-- Historique quotidien des cotes ("card:fr:sv03.5-199" ou "sealed:123456")
create table if not exists public.price_history (
  item       text not null,
  d          date not null,
  trend      numeric(12,2),
  trend_holo numeric(12,2),
  avg30      numeric(12,2),
  avg30_holo numeric(12,2),
  low        numeric(12,2),
  low_holo   numeric(12,2),
  primary key (item, d)
);

-- Catalogue des produits scellés Cardmarket avec leur cote du jour
create table if not exists public.cm_sealed (
  id           int primary key,
  name         text not null,
  category_id  int,
  category     text,
  expansion_id int,
  trend        numeric(12,2),
  low          numeric(12,2),
  avg1         numeric(12,2),
  avg7         numeric(12,2),
  avg30        numeric(12,2),
  updated_at   timestamptz not null default now()
);
create index if not exists cm_sealed_name_idx on public.cm_sealed (lower(name));

-- Journal des exécutions de la tâche quotidienne
create table if not exists public.job_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  summary     jsonb
);

-- =====================================================================
--  3. TRIGGERS
-- =====================================================================
drop trigger if exists collection_touch on public.collection;
create trigger collection_touch before update on public.collection
  for each row execute function public.touch_updated_at();
drop trigger if exists sealed_touch on public.sealed;
create trigger sealed_touch before update on public.sealed
  for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.user_settings;
create trigger settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- =====================================================================
--  4. SÉCURITÉ : Row Level Security
-- =====================================================================
alter table public.user_settings     enable row level security;
alter table public.binders           enable row level security;
alter table public.collection        enable row level security;
alter table public.sealed            enable row level security;
alter table public.wishlist          enable row level security;
alter table public.portfolio_history enable row level security;
alter table public.card_prices       enable row level security;
alter table public.price_history     enable row level security;
alter table public.cm_sealed         enable row level security;
alter table public.job_runs          enable row level security;

do $$
declare t text;
begin
  -- Données personnelles : lecture et écriture de ses propres lignes uniquement
  foreach t in array array['user_settings','binders','collection','sealed','wishlist','portfolio_history'] loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
  -- Données de marché : lecture seule pour les utilisateurs connectés
  foreach t in array array['card_prices','price_history','cm_sealed','job_runs'] loop
    execute format('drop policy if exists read_all on public.%I', t);
    execute format('create policy read_all on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Aucun accès pour les visiteurs non connectés
revoke all on public.user_settings, public.binders, public.collection, public.sealed, public.wishlist,
              public.portfolio_history, public.card_prices, public.price_history, public.cm_sealed,
              public.job_runs from anon;
grant select, insert, update, delete on public.user_settings, public.binders, public.collection,
              public.sealed, public.wishlist, public.portfolio_history to authenticated;
grant select on public.card_prices, public.price_history, public.cm_sealed, public.job_runs to authenticated;

-- La tâche quotidienne (clé secrète / service_role) lit et écrit toutes les tables
grant usage on schema public to authenticated, service_role;
grant all on public.user_settings, public.binders, public.collection, public.sealed, public.wishlist,
             public.portfolio_history, public.card_prices, public.price_history, public.cm_sealed,
             public.job_runs to service_role;
grant usage, select on all sequences in schema public to service_role;
