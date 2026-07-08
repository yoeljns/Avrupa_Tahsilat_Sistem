-- ============================================================================
-- AVRUPA TAHSİLAT SİSTEMİ — Veritabanı kurulumu
-- Bu dosyanın TAMAMINI Supabase Dashboard > SQL Editor'e yapıştırıp Run deyin.
-- Dosya idempotenttir: yanlışlıkla iki kez çalıştırmak zarar vermez.
-- ============================================================================

create extension if not exists pgcrypto;

-- Türkçe harf katlama (yalnız HARİÇ LİSTESİ eşleşmesinde kullanılır).
-- Firma kimliği (code_norm) Türkçe harfleri KORUR: '34 O02' ve '34 Ö02'
-- farklı firmalardır. Hariç listesi ise ASCII yazıldığı için ('54 C03')
-- eşleşme iki taraf da katlanarak yapılır.
create or replace function public.fold_tr(t text)
returns text language sql immutable strict as $$
  select upper(translate(t, 'İıŞşÇçĞğÜüÖöi', 'IISSCCGGUUOOI'))
$$;

-- ----------------------------------------------------------------------------
-- 1) PROFİLLER ve ROL YARDIMCILARI
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null check (role in ('yonetici', 'tahsilat_yoneticisi', 'pazarlamaci')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER: RLS politikaları içinden profillere sonsuz döngüsüz bakmak için.
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('yonetici', 'tahsilat_yoneticisi'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'yonetici', false)
$$;

-- ----------------------------------------------------------------------------
-- 2) FİRMALAR ve HARİÇ TUTULAN KODLAR
-- ----------------------------------------------------------------------------
create table if not exists public.firms (
  id uuid primary key default gen_random_uuid(),
  code_norm text not null unique,          -- boşlukları normalize edilmiş kod (Türkçe harfler korunur)
  code_raw text not null,
  name text not null default '',
  segment text,
  city text,
  phone text,
  borc_durumu text,
  pazarlamaci_email text,
  is_auto_created boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists firms_pazarlamaci_email_idx on public.firms (lower(pazarlamaci_email));

create table if not exists public.excluded_firm_codes (
  code_norm text primary key,
  note text,
  added_by text,
  created_at timestamptz not null default now()
);

-- Pazarlamacının sorumlu olduğu firma id'leri (firms tanımından sonra gelmeli)
create or replace function public.my_firm_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select f.id
  from public.firms f
  join public.profiles p on p.id = auth.uid() and p.is_active
  where f.pazarlamaci_email is not null
    and lower(f.pazarlamaci_email) = lower(p.email)
$$;

-- ----------------------------------------------------------------------------
-- 3) İRSALİYELER (fatura yerine geçen borç kaynağı)
--    Ham sütunlar YALNIZ içe aktarma tarafından, override sütunları YALNIZ
--    Tahsilat Yöneticisi düzenlemeleriyle yazılır. Etkin değer = COALESCE(override, ham).
-- ----------------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  fis_no text not null unique,
  firm_id uuid not null references public.firms (id),
  invoice_date date not null,
  belge_no_raw text not null default '',
  turu_raw text not null default '',
  odeme_plani_raw text not null default '',
  f_flag_raw text not null default '',
  amount_tl numeric(16, 2),
  amount_eur_cents bigint,
  dovizli_raw text not null default '',
  sale_type_auto text not null check (sale_type_auto in ('PESIN', 'KONSINYE', 'KONSINYE_PESIN', 'OTHER')),
  suggested_sale_type text check (suggested_sale_type in ('PESIN', 'KONSINYE', 'KONSINYE_PESIN')),
  plan_parse_status text not null check (plan_parse_status in ('ok', 'cash', 'empty_default', 'net_days', 'unparsed')),
  plan_parse_note text,
  classify_reason text,
  is_31_12 boolean not null default false,       -- 31/12 kuralı: borçlara asla sayılmaz
  fisno_nonstandard boolean not null default false,
  needs_review boolean not null default false,
  raw_changed_after_override boolean not null default false,
  -- Override'lar (Tahsilat Yöneticisi):
  sale_type_override text check (sale_type_override in ('PESIN', 'KONSINYE', 'KONSINYE_PESIN', 'OTHER')),
  amount_eur_cents_override bigint,
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text,
  excluded_override boolean,                     -- true: elle hariç; false: hariç listesine rağmen dahil
  plan_override_note text,
  last_import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_firm_idx on public.invoices (firm_id);
create index if not exists invoices_date_idx on public.invoices (invoice_date);
create index if not exists invoices_needs_review_idx on public.invoices (needs_review) where needs_review;

-- ----------------------------------------------------------------------------
-- 4) TAKSİTLER — her tahsis edilebilir irsaliyenin ≥1 taksiti olur.
--    PESIN irsaliye: tek taksit, vade = irsaliye tarihi.
-- ----------------------------------------------------------------------------
create table if not exists public.installments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  firm_id uuid not null references public.firms (id),
  side text not null check (side in ('PESIN', 'VADELI')),
  seq int not null,
  due_date date not null,
  amount_eur_cents bigint not null,
  source text not null check (source in ('auto_plan', 'default_invoice_date', 'manual')),
  no_date_flag boolean not null default false,   -- 'tarih girilmedi' rozeti
  remaining_eur_cents bigint,                    -- recompute yazar; kapsam dışıysa NULL
  created_at timestamptz not null default now(),
  unique (invoice_id, seq)
);
create index if not exists installments_side_due_idx on public.installments (side, due_date);
create index if not exists installments_firm_side_idx on public.installments (firm_id, side);
create index if not exists installments_invoice_idx on public.installments (invoice_id);

-- ----------------------------------------------------------------------------
-- 5) ÖDEMELER (gelen ödemeler dosyasının ham kopyası + bayraklar)
-- ----------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  islem_kodu text not null unique,
  sheet_side text not null check (sheet_side in ('PESIN', 'VADELI')),
  firm_id uuid not null references public.firms (id),
  islem_tarihi timestamptz,
  firma_raw text not null default '',
  firma_kodu_raw text not null default '',
  gelen_tl numeric(16, 2),
  doviz_eur_cents bigint,
  kur numeric(14, 6),
  toplam_tl numeric(16, 2),
  fark numeric(16, 2),
  odeme_sekli text,
  aciklama text,
  alacakli_durumu text,
  alacakli_tl numeric(16, 2),
  alacakli_eur_cents bigint,
  alacakli_islemi text,
  kdv15_durumu text,
  kdv_fatura_referansi text,
  kdv_fatura_toplami_eur_cents bigint,
  kdv15_on_odeme_eur_cents bigint,
  kdv_kalan_borc_eur_cents bigint,
  kdv_taksit_sayisi text,
  kdv_taksit_basi_eur_cents bigint,
  kayit_durumu text,
  eksik_alanlar text,
  isleyen text,
  islem_zamani_raw text,
  hedef_fis_no text,
  hedef_acik_eur_raw text,
  is_alc boolean not null default false,         -- eski sistemin türetilmiş alacak kaydı
  is_complete boolean not null default true,     -- KAYIT DURUMU = TAMAMLANDI
  allocatable boolean generated always as (not is_alc and is_complete) stored,
  last_import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_firm_side_idx on public.payments (firm_id, sheet_side);
create index if not exists payments_side_date_idx on public.payments (sheet_side, islem_tarihi);

-- ----------------------------------------------------------------------------
-- 6) MUTABAKAT KOŞULARI — sürümlü sonuçlar; okuyucular işaretçideki koşuyu görür
-- ----------------------------------------------------------------------------
create table if not exists public.recon_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  triggered_by text,
  trigger_kind text not null check (trigger_kind in ('import', 'edit', 'manual', 'setup')),
  stats jsonb not null default '{}'::jsonb
);

create table if not exists public.allocations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.recon_runs (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  installment_id uuid not null references public.installments (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  firm_id uuid not null references public.firms (id),
  side text not null check (side in ('PESIN', 'VADELI')),
  amount_eur_cents bigint not null
);
create index if not exists allocations_run_idx on public.allocations (run_id);
create index if not exists allocations_run_firm_idx on public.allocations (run_id, firm_id);
create index if not exists allocations_run_payment_idx on public.allocations (run_id, payment_id);
create index if not exists allocations_run_installment_idx on public.allocations (run_id, installment_id);

create table if not exists public.firm_side_balances (
  run_id uuid not null references public.recon_runs (id) on delete cascade,
  firm_id uuid not null references public.firms (id),
  side text not null check (side in ('PESIN', 'VADELI')),
  open_debt_eur_cents bigint not null default 0,
  overdue_eur_cents bigint not null default 0,
  credit_eur_cents bigint not null default 0,
  next_due_date date,
  total_debt_eur_cents bigint not null default 0,
  total_paid_eur_cents bigint not null default 0,
  primary key (run_id, firm_id, side)
);

-- ----------------------------------------------------------------------------
-- 7) İÇE AKTARMA (iki aşamalı: önizleme staging'i + commit)
-- ----------------------------------------------------------------------------
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('irsaliye', 'odemeler', 'bayiler')),
  filename text not null default '',
  uploaded_by text,
  status text not null default 'preview' check (status in ('preview', 'committed', 'discarded')),
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  row_index int not null,
  natural_key text not null default '',
  payload jsonb not null,
  diff_status text not null check (diff_status in ('new', 'updated', 'unchanged', 'needs_review', 'excluded_31_12', 'invalid')),
  changed_fields text[] not null default '{}',
  error text
);
create index if not exists import_rows_batch_idx on public.import_rows (batch_id);

-- ----------------------------------------------------------------------------
-- 8) DENETİM KAYDI (salt ekleme — kimse güncelleyemez/silemez)
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  field text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

-- ----------------------------------------------------------------------------
-- 9) UYGULAMA AYARLARI
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 10) GÖRÜNÜMLER
-- ----------------------------------------------------------------------------
create or replace view public.v_current_run with (security_invoker = true) as
  select (value ->> 'run_id')::uuid as run_id
  from public.app_settings
  where key = 'current_recon_run';

create or replace view public.v_invoices_effective with (security_invoker = true) as
  select
    i.id,
    i.fis_no,
    i.firm_id,
    f.code_norm as firm_code,
    f.name as firm_name,
    i.invoice_date,
    i.belge_no_raw,
    i.turu_raw,
    i.odeme_plani_raw,
    i.amount_tl,
    i.dovizli_raw,
    coalesce(i.sale_type_override, i.sale_type_auto) as sale_type,
    coalesce(i.amount_eur_cents_override, i.amount_eur_cents) as amount_eur_cents,
    i.sale_type_auto,
    i.suggested_sale_type,
    i.sale_type_override,
    i.amount_eur_cents_override,
    i.plan_parse_status,
    i.plan_parse_note,
    i.classify_reason,
    i.is_31_12,
    i.fisno_nonstandard,
    i.needs_review,
    i.raw_changed_after_override,
    (i.cancelled_at is not null) as is_cancelled,
    i.cancelled_at,
    i.cancelled_by,
    i.cancel_reason,
    i.excluded_override,
    (exists (select 1 from public.excluded_firm_codes e where public.fold_tr(e.code_norm) = public.fold_tr(f.code_norm))) as is_excluded_firm,
    case
      when coalesce(i.sale_type_override, i.sale_type_auto) = 'PESIN' then 'PESIN'
      when coalesce(i.sale_type_override, i.sale_type_auto) in ('KONSINYE', 'KONSINYE_PESIN') then 'VADELI'
      else null
    end as side,
    (
      i.cancelled_at is null
      and not i.is_31_12
      and coalesce(i.sale_type_override, i.sale_type_auto) <> 'OTHER'
      and coalesce(
        not i.excluded_override,
        not exists (select 1 from public.excluded_firm_codes e where public.fold_tr(e.code_norm) = public.fold_tr(f.code_norm))
      )
    ) as is_allocatable
  from public.invoices i
  join public.firms f on f.id = i.firm_id;

create or replace view public.v_open_installments with (security_invoker = true) as
  select
    t.id as installment_id,
    t.invoice_id,
    t.firm_id,
    v.firm_code,
    v.firm_name,
    t.side,
    t.seq,
    t.due_date,
    v.invoice_date,
    v.fis_no,
    t.amount_eur_cents,
    t.remaining_eur_cents,
    t.no_date_flag,
    t.source
  from public.installments t
  join public.v_invoices_effective v on v.id = t.invoice_id
  where t.remaining_eur_cents is not null and t.remaining_eur_cents > 0;

-- ----------------------------------------------------------------------------
-- 11) RLS — istemci SALT OKUNUR; tüm yazmalar sunucudaki service-role ile.
--     Staff (yönetici + tahsilat yöneticisi) her şeyi, pazarlamacı yalnız
--     kendi firmalarını görür. Hiçbir tabloda istemci yazma politikası YOKTUR.
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.firms enable row level security;
alter table public.excluded_firm_codes enable row level security;
alter table public.invoices enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;
alter table public.recon_runs enable row level security;
alter table public.allocations enable row level security;
alter table public.firm_side_balances enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists firms_select on public.firms;
create policy firms_select on public.firms for select
  using (public.is_staff() or id in (select public.my_firm_ids()));

drop policy if exists excluded_codes_select on public.excluded_firm_codes;
create policy excluded_codes_select on public.excluded_firm_codes for select
  using (auth.role() = 'authenticated');

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using (public.is_staff() or firm_id in (select public.my_firm_ids()));

drop policy if exists installments_select on public.installments;
create policy installments_select on public.installments for select
  using (public.is_staff() or firm_id in (select public.my_firm_ids()));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (public.is_staff() or firm_id in (select public.my_firm_ids()));

drop policy if exists recon_runs_select on public.recon_runs;
create policy recon_runs_select on public.recon_runs for select
  using (auth.role() = 'authenticated');

drop policy if exists allocations_select on public.allocations;
create policy allocations_select on public.allocations for select
  using (public.is_staff() or firm_id in (select public.my_firm_ids()));

drop policy if exists firm_side_balances_select on public.firm_side_balances;
create policy firm_side_balances_select on public.firm_side_balances for select
  using (public.is_staff() or firm_id in (select public.my_firm_ids()));

drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_select on public.import_batches for select
  using (public.is_staff());

drop policy if exists import_rows_select on public.import_rows;
create policy import_rows_select on public.import_rows for select
  using (public.is_staff());

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select
  using (public.is_staff());

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select
  using (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- 12) SUNUCU YARDIMCI FONKSİYONLARI (yalnız service role çağırır)
-- ----------------------------------------------------------------------------
-- Mutabakat sonrası taksit kalanlarını tek çağrıda topluca günceller.
create or replace function public.bulk_set_installment_remaining(updates jsonb)
returns void language sql security definer set search_path = public as $$
  update public.installments t
  set remaining_eur_cents = nullif(u ->> 'remaining', '')::bigint
  from jsonb_array_elements(updates) as u
  where t.id = (u ->> 'id')::uuid
$$;
revoke execute on function public.bulk_set_installment_remaining(jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 13) SEED — hariç tutulan 42 firma kodu (normalize edilmiş biçim) ve ayarlar.
--     Not: '34 S01' ve '54 C03' kodları veride '34 Ş01' / '54 Ç03' olarak
--     geçer; uygulama tüm kodları Türkçe katlamayla karşılaştırır.
-- ----------------------------------------------------------------------------
insert into public.excluded_firm_codes (code_norm, note) values
  ('01 K01', 'Kurulumda tanımlı'),
  ('10 K01', 'Kurulumda tanımlı'),
  ('14 Y01', 'Kurulumda tanımlı'),
  ('33 K02', 'Kurulumda tanımlı'),
  ('33 Y01', 'Kurulumda tanımlı'),
  ('34 K56', 'Kurulumda tanımlı'),
  ('34 S01', 'Kurulumda tanımlı'),
  ('34 T32', 'Kurulumda tanımlı'),
  ('37 K01', 'Kurulumda tanımlı'),
  ('37 K02', 'Kurulumda tanımlı'),
  ('41 Y01', 'Kurulumda tanımlı'),
  ('41 Y02', 'Kurulumda tanımlı'),
  ('45 Y01', 'Kurulumda tanımlı'),
  ('52 C02', 'Kurulumda tanımlı'),
  ('54 C03', 'Kurulumda tanımlı'),
  ('55 K05', 'Kurulumda tanımlı'),
  ('81 D02', 'Kurulumda tanımlı'),
  ('99 A16', 'Kurulumda tanımlı'),
  ('99 A19', 'Kurulumda tanımlı'),
  ('99 A20', 'Kurulumda tanımlı'),
  ('99 C02', 'Kurulumda tanımlı'),
  ('99 D01', 'Kurulumda tanımlı'),
  ('99 D02', 'Kurulumda tanımlı'),
  ('99 E01', 'Kurulumda tanımlı'),
  ('99 G03', 'Kurulumda tanımlı'),
  ('99 H01', 'Kurulumda tanımlı'),
  ('99 I03', 'Kurulumda tanımlı'),
  ('99 K06', 'Kurulumda tanımlı'),
  ('99 K07', 'Kurulumda tanımlı'),
  ('99 K08', 'Kurulumda tanımlı'),
  ('99 N01', 'Kurulumda tanımlı'),
  ('99 P02', 'Kurulumda tanımlı'),
  ('99 P04', 'Kurulumda tanımlı'),
  ('99 R01', 'Kurulumda tanımlı'),
  ('99 R02', 'Kurulumda tanımlı'),
  ('99 S01', 'Kurulumda tanımlı'),
  ('99 T02', 'Kurulumda tanımlı'),
  ('99 T03', 'Kurulumda tanımlı'),
  ('99 T07', 'Kurulumda tanımlı'),
  ('99 T11', 'Kurulumda tanımlı'),
  ('99 V03', 'Kurulumda tanımlı'),
  ('99 Y02', 'Kurulumda tanımlı')
on conflict (code_norm) do nothing;

insert into public.app_settings (key, value) values
  ('setup_completed', 'false'::jsonb),
  ('current_recon_run', '{}'::jsonb)
on conflict (key) do nothing;
