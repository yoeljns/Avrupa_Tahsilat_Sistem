-- ============================================================================
-- 0002 — TEK HAVUZ TAHSİS KURALI + KDV 1/5 HARİÇ + BORÇ/ÖDEME/KALAN GÖRÜNÜMÜ
--
-- Kural değişikliği: ödemelerde PEŞİN/VADELİ sayfa ayrımı tahsisi etkilemez.
-- Firma başına tek ödeme havuzu: önce peşin borçlar (en eski önce), sonra
-- vadeli taksitler (en yakın vade önce). KDV 1/5 ödemeleri tahsise girmez.
--
-- Bu dosyayı 0001_init.sql'den SONRA Supabase SQL Editor'de çalıştırın.
-- İdempotenttir: yanlışlıkla iki kez çalıştırmak zarar vermez.
-- Çalıştırdıktan sonra uygulamada Pano > "Yeniden Hesapla"ya basın.
-- ============================================================================

-- 1) KDV 1/5 ödemeleri: satır bazında tahsis dışı
alter table public.payments add column if not exists is_kdv boolean not null default false;

update public.payments
set is_kdv = (public.fold_tr(coalesce(kdv15_durumu, '')) = 'EVET')
where is_kdv <> (public.fold_tr(coalesce(kdv15_durumu, '')) = 'EVET');

-- allocatable yeniden tanımlanır: ALC değil + tamamlanmış + KDV değil
alter table public.payments drop column if exists allocatable;
alter table public.payments add column allocatable boolean
  generated always as (not is_alc and is_complete and not is_kdv) stored;

-- 2) Firma bazlı bakiyeler (havuz modeli) — eski firm_side_balances artık yazılmaz
create table if not exists public.firm_balances (
  run_id uuid not null references public.recon_runs (id) on delete cascade,
  firm_id uuid not null references public.firms (id),
  pesin_open_eur_cents bigint not null default 0,
  vadeli_open_eur_cents bigint not null default 0,
  vadeli_overdue_eur_cents bigint not null default 0,
  credit_eur_cents bigint not null default 0,
  next_due_date date,
  total_debt_eur_cents bigint not null default 0,
  total_paid_eur_cents bigint not null default 0,
  primary key (run_id, firm_id)
);

alter table public.firm_balances enable row level security;

drop policy if exists firm_balances_select on public.firm_balances;
create policy firm_balances_select on public.firm_balances for select
  using (public.is_staff() or firm_id in (select public.my_firm_ids()));

-- 3) BORÇ/ÖDEME/KALAN matrisi için kapsam içi TÜM taksitler
--    (tam ödenmişler dahil — v_open_installments yalnız kalan>0 verir)
create or replace view public.v_installments_scope with (security_invoker = true) as
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
    (t.amount_eur_cents - t.remaining_eur_cents) as paid_eur_cents,
    t.no_date_flag,
    t.source
  from public.installments t
  join public.v_invoices_effective v on v.id = t.invoice_id
  where t.remaining_eur_cents is not null;
