-- ============================================================================
-- 0007_kategoriler.sql — SATIŞ KATEGORİLERİ (panelden yönetilir) + YÖNETİM ÖZETİ
--
-- Bugüne kadar Peşin / Konsinye / Konsinye Peşin kodun içinde sabitti. Artık:
--   * sale_categories: kategori (kod, ad, renk, sıra, görünüm) ve DAVRANIŞ:
--       taraf = 'PESIN'  → "Peşin gibi": ödemeler önce bunları kapatır (Peşin sayfası)
--       taraf = 'VADELI' → "Vadeli gibi": plana göre, en yakın vadeden (Konsinye sayfası)
--       taraf = NULL     → "Hesaba katılmaz" (OTHER = sınıflandırılmadı da NULL'dır)
--     Hesap motoru DEĞİŞMEZ: yine yalnız PESIN/VADELI bilir; kategori onu seçer.
--   * sale_category_rules: Belge No / Türü kuralları (sıralı; ATA = ata, ONER = öner).
--     Tohum = bugünkü sabit kurallar birebir. İade kontrolü uygulamada sabittir.
--   * invoices.sale_type_* CHECK'leri → sale_categories(kod) yabancı anahtarı.
--   * v_invoices_effective: taraf kategoriden okunur (eski CASE ile aynı sonuç).
--   * Sayfa fonksiyonlarına kategori bilgisi eklenir (aynı imza, yalnız yeni anahtar).
--   * Yönetim paneli için tek turlu özet (rpc_yonetim_ozeti) ve yazma fonksiyonları.
--
-- GERİ UYUM: canlıdaki önceki sürüm bu göçten sonra aynen çalışır (yalnız 4 sistem
-- kodunu yazar; görünüm kolonları ve fonksiyon imzaları aynı).
--
-- 0006_takvim.sql'den SONRA çalıştırın. İdempotenttir.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Kategoriler
-- ---------------------------------------------------------------------------
create table if not exists public.sale_categories (
  kod text primary key check (kod ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  ad text not null check (char_length(btrim(ad)) between 1 and 60),
  kisa_ad text check (kisa_ad is null or char_length(kisa_ad) <= 20),
  renk text not null default 'gri' check (renk ~ '^[a-z]{2,20}$'),
  taraf text check (taraf in ('PESIN', 'VADELI')),
  sira int not null default 100,
  aktif boolean not null default true,
  sistem boolean not null default false,
  aciklama text check (aciklama is null or char_length(aciklama) <= 300),
  sayfada_suzgec boolean not null default true,
  panoda_kart boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint sale_categories_other_tarafsiz check (kod <> 'OTHER' or taraf is null)
);

insert into public.sale_categories (kod, ad, kisa_ad, renk, taraf, sira, aktif, sistem, sayfada_suzgec, panoda_kart, aciklama) values
  ('PESIN', 'Peşin', 'Peşin', 'lacivert', 'PESIN', 10, true, true, true, false,
   'Belge No "+" ile başlayan satışlar. Ödemeler önce peşin borçları kapatır.'),
  ('KONSINYE', 'Konsinye', 'Konsinye', 'mavi', 'VADELI', 20, true, true, true, false,
   'Ödeme planına göre taksitlendirilen konsinye satışlar.'),
  ('KONSINYE_PESIN', 'Konsinye Peşin', 'K. Peşin', 'camgobegi', 'VADELI', 30, true, true, true, false,
   'Hesapta Konsinye ile aynıdır; Belge No''da "KONSİNYE PEŞİN" yazar.'),
  ('OTHER', 'Sınıflandırılmadı', 'Sınıfsız', 'gri', null, 999, true, true, false, false,
   'Tipi belirlenemeyen irsaliyeler: borca yazılmaz, İnceleme ekranında onay bekler.')
on conflict (kod) do nothing;

-- Koruma: kod değişmez; sistem kategorilerinin davranışı değişmez, pasifleşmez, silinmez.
-- (service_role dahil herkese işler — uygulama hatasına karşı son savunma)
create or replace function public.sale_categories_koru()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.sistem then
      raise exception 'Sistem kategorisi silinemez: %', old.kod using errcode = '42501';
    end if;
    return old;
  end if;
  if new.kod <> old.kod then
    raise exception 'Kategori kodu değiştirilemez: %', old.kod using errcode = '42501';
  end if;
  if old.sistem and (new.taraf is distinct from old.taraf or new.sistem is distinct from old.sistem or not new.aktif) then
    raise exception 'Sistem kategorisinin davranışı değiştirilemez ve pasifleştirilemez: %', old.kod using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists sale_categories_koru on public.sale_categories;
create trigger sale_categories_koru
  before update or delete on public.sale_categories
  for each row execute function public.sale_categories_koru();

-- ---------------------------------------------------------------------------
-- 2) Tanıma kuralları
--    Değerler yazıldığı gibi saklanır; eşleştirme uygulamada Türkçe harf katlamalı
--    (İ→I, Ş→S …) BÜYÜK harfli metin üzerinde yapılır. REGEX değeri katlanmaz.
-- ---------------------------------------------------------------------------
create table if not exists public.sale_category_rules (
  id bigint generated always as identity primary key,
  kategori_kod text not null references public.sale_categories (kod) on delete restrict
    check (kategori_kod <> 'OTHER'),
  alan text not null check (alan in ('BELGE_NO', 'TURU')),
  islec text not null check (islec in ('ICERIR', 'BASLAR', 'BITER', 'ESIT', 'REGEX')),
  deger text not null check (char_length(deger) between 1 and 200),
  sonuc text not null default 'ATA' check (sonuc in ('ATA', 'ONER')),
  sira int not null default 100,
  aktif boolean not null default true,
  aciklama text check (aciklama is null or char_length(aciklama) <= 200),
  created_at timestamptz not null default now(),
  updated_by text
);
create index if not exists sale_category_rules_sira_idx on public.sale_category_rules (sonuc, sira, id);

-- Tohum: bugünkü sabit kurallar birebir (yalnız tablo BOŞSA — yönetici silerse geri gelmez)
insert into public.sale_category_rules (kategori_kod, alan, islec, deger, sonuc, sira, aciklama)
select v.kategori_kod, v.alan, v.islec, v.deger, v.sonuc, v.sira, v.aciklama
from (values
  ('KONSINYE_PESIN', 'BELGE_NO', 'ICERIR', 'KONSİNYE PEŞİN', 'ATA', 10, 'Belge No: KONSİNYE PEŞİN'),
  ('KONSINYE', 'BELGE_NO', 'ICERIR', 'KONSİNYE', 'ATA', 20, 'Belge No: KONSİNYE'),
  ('PESIN', 'BELGE_NO', 'BASLAR', '+', 'ATA', 30, 'Belge No: + (peşin)'),
  ('PESIN', 'BELGE_NO', 'REGEX', '^\d+$', 'ONER', 110, 'Belge No müşteri sipariş numarası görünüyor'),
  ('KONSINYE', 'BELGE_NO', 'REGEX', 'AVI\d+|REVIZE|IRS', 'ONER', 120, 'Belge No başka bir irsaliyeye/revizyona atıf yapıyor')
) as v(kategori_kod, alan, islec, deger, sonuc, sira, aciklama)
where not exists (select 1 from public.sale_category_rules);

-- ---------------------------------------------------------------------------
-- 3) Sabit tip listesi (CHECK) → kategori tablosuna yabancı anahtar
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.invoices'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%KONSINYE%'
  loop
    execute format('alter table public.invoices drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.invoices drop constraint if exists invoices_sale_type_auto_fkey;
alter table public.invoices add constraint invoices_sale_type_auto_fkey
  foreign key (sale_type_auto) references public.sale_categories (kod);
alter table public.invoices drop constraint if exists invoices_sale_type_override_fkey;
alter table public.invoices add constraint invoices_sale_type_override_fkey
  foreign key (sale_type_override) references public.sale_categories (kod);
alter table public.invoices drop constraint if exists invoices_suggested_sale_type_fkey;
alter table public.invoices add constraint invoices_suggested_sale_type_fkey
  foreign key (suggested_sale_type) references public.sale_categories (kod);
alter table public.invoices drop constraint if exists invoices_suggested_not_other;
alter table public.invoices add constraint invoices_suggested_not_other
  check (suggested_sale_type is distinct from 'OTHER');

-- ---------------------------------------------------------------------------
-- 4) Yetkiler (RLS). ŞART: v_invoices_effective security_invoker'dır ve bu
--    tabloya katılır — okunamazsa pazarlamacıda taraf NULL görünür, borç kaybolur.
-- ---------------------------------------------------------------------------
alter table public.sale_categories enable row level security;
alter table public.sale_category_rules enable row level security;

drop policy if exists sale_categories_select on public.sale_categories;
create policy sale_categories_select on public.sale_categories
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists sale_category_rules_select on public.sale_category_rules;
create policy sale_category_rules_select on public.sale_category_rules
  for select using ((select public.is_staff()));

revoke all on public.sale_categories from anon;
revoke all on public.sale_category_rules from anon;
revoke insert, update, delete, truncate on public.sale_categories from authenticated;
revoke insert, update, delete, truncate on public.sale_category_rules from authenticated;
grant select on public.sale_categories to authenticated;
grant select on public.sale_category_rules to authenticated;
-- Uygulama sunucusu (service_role) yazar. Supabase'in şemaya tanımlı varsayılan
-- hibelerine güvenilmez: açıkça verilir (kuralların kimlik dizisi dahil).
grant select, insert, update, delete on public.sale_categories to service_role;
grant select, insert, update, delete on public.sale_category_rules to service_role;
do $$
begin
  execute format('grant usage, select on sequence %s to service_role',
                 pg_get_serial_sequence('public.sale_category_rules', 'id'));
end $$;

-- ---------------------------------------------------------------------------
-- 5) Etkin irsaliye görünümü: taraf ve tahsis kapsamı kategoriden.
--    Kolonlar 0005 ile AYNI (sıra, ad, tür) — yalnız iki ifade değişir.
-- ---------------------------------------------------------------------------
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
    k.taraf as side,
    (
      i.cancelled_at is null
      and not i.is_31_12
      and k.taraf is not null
      and coalesce(
        not i.excluded_override,
        not exists (select 1 from public.excluded_firm_codes e where public.fold_tr(e.code_norm) = public.fold_tr(f.code_norm))
      )
      and (i.sale_type_override is not null or public.fold_tr(i.turu_raw) not like '%IADE%')
    ) as is_allocatable,
    i.plan_override_note,
    coalesce(i.plan_override_note, i.odeme_plani_raw) as odeme_plani_etkin,
    (public.fold_tr(i.turu_raw) like '%IADE%') as is_iade
  from public.invoices i
  join public.firms f on f.id = i.firm_id
  left join public.sale_categories k on k.kod = coalesce(i.sale_type_override, i.sale_type_auto);

-- Kapsam içi taksitler: sona etkin kategori eklenir (Excel "Kategori" kolonu)
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
    t.source,
    v.sale_type as kategori
  from public.installments t
  join public.v_invoices_effective v on v.id = t.invoice_id
  where t.remaining_eur_cents is not null;

-- ---------------------------------------------------------------------------
-- 6) Parmak izi: kategorinin davranışı değişirse firma sürümü de değişir
-- ---------------------------------------------------------------------------
create or replace function public.tahsis_surumu(p_firm_ids uuid[])
returns text
language sql stable
set search_path = public, pg_temp
as $$
  select md5(coalesce(string_agg(x.s, '|' order by x.s), ''))
  from (
    select 'I' || i.id || ':' || i.firm_id || ':' || i.fis_no || ':' || i.invoice_date || ':'
           || coalesce(i.sale_type_override, i.sale_type_auto) || ':'
           || coalesce(i.amount_eur_cents_override, i.amount_eur_cents, -1) || ':'
           || (i.cancelled_at is not null) || ':' || i.is_31_12 || ':'
           || coalesce(i.excluded_override::text, 'n') || ':' || i.turu_raw || ':'
           || coalesce(k.taraf, '-') as s
    from public.invoices i
    left join public.sale_categories k on k.kod = coalesce(i.sale_type_override, i.sale_type_auto)
    where i.firm_id = any (p_firm_ids)
    union all
    select 'T' || t.id || ':' || t.invoice_id || ':' || t.seq || ':' || t.due_date || ':'
           || t.amount_eur_cents || ':' || t.side
    from public.installments t where t.firm_id = any (p_firm_ids)
    union all
    select 'P' || p.id || ':' || p.firm_id || ':' || coalesce(p.doviz_eur_cents, -1) || ':'
           || coalesce(p.islem_tarihi::text, '') || ':' || p.allocatable || ':' || p.is_kdv || ':'
           || coalesce(p.kdv_fatura_referansi, '') || ':' || coalesce(p.aciklama, '')
    from public.payments p where p.firm_id = any (p_firm_ids)
    union all
    select 'E' || e.code_norm from public.excluded_firm_codes e
  ) x
$$;

-- ---------------------------------------------------------------------------
-- 7) Kategori listesi (etiket, renk, davranış, görünüm) — tüm sayfalar için
-- ---------------------------------------------------------------------------
create or replace function public.kategori_meta()
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kod', k.kod, 'ad', k.ad, 'kisa_ad', k.kisa_ad, 'renk', k.renk, 'taraf', k.taraf, 'sira', k.sira,
    'aktif', k.aktif, 'sistem', k.sistem, 'sayfada_suzgec', k.sayfada_suzgec, 'panoda_kart', k.panoda_kart,
    'aciklama', k.aciklama) order by k.sira, k.kod), '[]'::jsonb)
  from public.sale_categories k
$$;

-- ---------------------------------------------------------------------------
-- 8) Sayfa fonksiyonları: aynı imza, yalnız YENİ anahtarlar
-- ---------------------------------------------------------------------------
create or replace function public.rpc_pano_ozeti(p_bugun date)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  with r as (select (select v.run_id from public.v_current_run v) as run_id)
  select jsonb_build_object(
    'run_id', r.run_id,
    'kosu', (select jsonb_build_object(
               'started_at', k.started_at, 'finished_at', k.finished_at,
               'triggered_by', k.triggered_by, 'trigger_kind', k.trigger_kind, 'stats', k.stats)
             from public.recon_runs k where k.id = r.run_id),
    'bakiye', (select jsonb_build_object(
                 'pesin_acik', coalesce(sum(b.pesin_open_eur_cents), 0),
                 'vadeli_acik', coalesce(sum(b.vadeli_open_eur_cents), 0),
                 'alacak', coalesce(sum(b.credit_eur_cents), 0),
                 'toplam_borc', coalesce(sum(b.total_debt_eur_cents), 0),
                 'toplam_odenen', coalesce(sum(b.total_paid_eur_cents), 0),
                 'borclu_firma', count(*) filter (where b.pesin_open_eur_cents + b.vadeli_open_eur_cents > 0))
               from public.firm_balances b where b.run_id = r.run_id),
    'vade', (select jsonb_build_object(
               'gecikmis', coalesce(sum(t.remaining_eur_cents) filter (where t.due_date < p_bugun), 0),
               'gun7', coalesce(sum(t.remaining_eur_cents) filter (where t.due_date between p_bugun and p_bugun + 7), 0),
               'gun30', coalesce(sum(t.remaining_eur_cents) filter (where t.due_date between p_bugun and p_bugun + 30), 0))
             from public.installments t
             where t.side = 'VADELI' and t.remaining_eur_cents > 0),
    'inceleme', (select jsonb_build_object('adet', count(*), 'tutar', coalesce(sum(v.amount_eur_cents), 0))
                 from public.v_invoices_effective v
                 where v.needs_review and not v.is_31_12 and not v.is_cancelled
                   and not coalesce(v.excluded_override, v.is_excluded_firm)),
    -- 0007: kategori başına açık borç ve gecikmiş (bugüne göre)
    'kategoriler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kod', k.kod, 'ad', k.ad, 'kisa_ad', k.kisa_ad, 'renk', k.renk, 'taraf', k.taraf,
        'sira', k.sira, 'aktif', k.aktif, 'panoda_kart', k.panoda_kart,
        'acik', coalesce(a.acik, 0), 'gecikmis', coalesce(a.gecikmis, 0), 'firma', coalesce(a.firma, 0))
        order by k.sira, k.kod)
      from public.sale_categories k
      left join (
        select coalesce(i.sale_type_override, i.sale_type_auto) as kod,
               sum(t.remaining_eur_cents) as acik,
               coalesce(sum(t.remaining_eur_cents) filter (where t.due_date < p_bugun), 0) as gecikmis,
               count(distinct t.firm_id) as firma
        from public.installments t
        join public.invoices i on i.id = t.invoice_id
        where t.remaining_eur_cents > 0
        group by 1) a on a.kod = k.kod
      where k.taraf is not null), '[]'::jsonb))
  from r
$$;

create or replace function public.rpc_firma_detay(p_firm_id uuid)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  with r as (select (select v.run_id from public.v_current_run v) as run_id)
  select case when f.id is null then null else jsonb_build_object(
    'firma', jsonb_build_object(
      'id', f.id, 'code_norm', f.code_norm, 'code_raw', f.code_raw, 'name', f.name,
      'segment', f.segment, 'city', f.city, 'phone', f.phone,
      'pazarlamaci_email', f.pazarlamaci_email, 'is_auto_created', f.is_auto_created),
    'run_id', r.run_id,
    'bakiye', (select jsonb_build_object(
                 'pesin_open_eur_cents', b.pesin_open_eur_cents,
                 'vadeli_open_eur_cents', b.vadeli_open_eur_cents,
                 'vadeli_overdue_eur_cents', b.vadeli_overdue_eur_cents,
                 'credit_eur_cents', b.credit_eur_cents,
                 'next_due_date', b.next_due_date,
                 'total_debt_eur_cents', b.total_debt_eur_cents,
                 'total_paid_eur_cents', b.total_paid_eur_cents)
               from public.firm_balances b where b.run_id = r.run_id and b.firm_id = f.id),
    'irsaliyeler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'fis_no', v.fis_no, 'invoice_date', v.invoice_date,
        'belge_no_raw', v.belge_no_raw, 'odeme_plani_raw', v.odeme_plani_raw,
        'plan_override_note', v.plan_override_note,
        'sale_type', v.sale_type, 'sale_type_auto', v.sale_type_auto,
        'sale_type_override', v.sale_type_override, 'suggested_sale_type', v.suggested_sale_type,
        'amount_eur_cents', v.amount_eur_cents, 'amount_eur_cents_override', v.amount_eur_cents_override,
        'amount_tl', v.amount_tl, 'plan_parse_status', v.plan_parse_status, 'plan_parse_note', v.plan_parse_note,
        'is_31_12', v.is_31_12, 'is_cancelled', v.is_cancelled, 'cancel_reason', v.cancel_reason,
        'excluded_override', v.excluded_override, 'is_excluded_firm', v.is_excluded_firm,
        'is_allocatable', v.is_allocatable, 'needs_review', v.needs_review,
        'raw_changed_after_override', v.raw_changed_after_override,
        'is_iade', v.is_iade, 'turu_raw', v.turu_raw)
        order by v.invoice_date desc, v.fis_no desc)
      from public.v_invoices_effective v where v.firm_id = f.id), '[]'::jsonb),
    'taksitler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'invoice_id', t.invoice_id, 'seq', t.seq, 'side', t.side, 'due_date', t.due_date,
        'amount_eur_cents', t.amount_eur_cents, 'remaining_eur_cents', t.remaining_eur_cents,
        'source', t.source, 'no_date_flag', t.no_date_flag)
        order by t.due_date, t.seq)
      from public.installments t where t.firm_id = f.id), '[]'::jsonb),
    'odemeler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'islem_kodu', p.islem_kodu, 'sheet_side', p.sheet_side, 'islem_tarihi', p.islem_tarihi,
        'gelen_tl', p.gelen_tl, 'doviz_eur_cents', p.doviz_eur_cents, 'kur', p.kur, 'aciklama', p.aciklama,
        'kayit_durumu', p.kayit_durumu, 'is_alc', p.is_alc, 'is_kdv', p.is_kdv, 'allocatable', p.allocatable)
        order by p.islem_tarihi desc nulls last, p.islem_kodu desc)
      from public.payments p where p.firm_id = f.id), '[]'::jsonb),
    'tahsisler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_id', a.payment_id, 'installment_id', a.installment_id,
        'invoice_id', a.invoice_id, 'amount_eur_cents', a.amount_eur_cents))
      from public.allocations a where a.run_id = r.run_id and a.firm_id = f.id), '[]'::jsonb),
    -- 0007: etiket, renk ve davranış
    'kategoriler', public.kategori_meta()
  ) end
  from r
  left join public.firms f on f.id = p_firm_id
$$;

create or replace function public.rpc_inceleme()
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'irsaliyeler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'fis_no', v.fis_no, 'firm_id', v.firm_id, 'firm_code', v.firm_code, 'firm_name', v.firm_name,
        'invoice_date', v.invoice_date, 'belge_no_raw', v.belge_no_raw, 'odeme_plani_raw', v.odeme_plani_raw,
        'plan_override_note', v.plan_override_note,
        'amount_eur_cents', v.amount_eur_cents, 'sale_type', v.sale_type, 'suggested_sale_type', v.suggested_sale_type,
        'classify_reason', v.classify_reason, 'plan_parse_status', v.plan_parse_status, 'plan_parse_note', v.plan_parse_note,
        'is_31_12', v.is_31_12, 'is_cancelled', v.is_cancelled, 'is_excluded_firm', v.is_excluded_firm,
        'excluded_override', v.excluded_override, 'fisno_nonstandard', v.fisno_nonstandard,
        'needs_review', v.needs_review, 'raw_changed_after_override', v.raw_changed_after_override,
        'is_iade', v.is_iade, 'turu_raw', v.turu_raw, 'sale_type_override', v.sale_type_override,
        'is_allocatable', v.is_allocatable)
        order by v.invoice_date desc, v.fis_no desc)
      from public.v_invoices_effective v
      where v.needs_review or v.is_31_12 or v.raw_changed_after_override or v.is_iade), '[]'::jsonb),
    'tarihsiz', coalesce((
      select jsonb_agg(jsonb_build_object(
        'installment_id', o.installment_id, 'firm_id', o.firm_id, 'firm_code', o.firm_code,
        'firm_name', o.firm_name, 'fis_no', o.fis_no, 'due_date', o.due_date,
        'remaining_eur_cents', o.remaining_eur_cents)
        order by o.firm_code, o.fis_no)
      from public.v_open_installments o
      where o.no_date_flag), '[]'::jsonb),
    -- 0007: seçenekler ve etiketler
    'kategoriler', public.kategori_meta())
$$;

-- Takvim: 0006 ile aynı imza ve gövde; sona kategori listesi eklenir (süzgeç etiketleri)
create or replace function public.rpc_takvim(
  p_side text,
  p_ay_bas date,
  p_ay_son date,
  p_bugun date,
  p_kategoriler text[] default null)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  sonuc jsonb;
begin
  if p_side is null or p_side not in ('PESIN', 'VADELI') then
    raise exception 'rpc_takvim: geçersiz taraf %', coalesce(p_side, 'NULL') using errcode = '22023';
  end if;

  with t0 as (
    select t.firm_id, t.due_date,
           t.amount_eur_cents as borc,
           t.remaining_eur_cents as kalan,
           t.amount_eur_cents - t.remaining_eur_cents as odeme,
           t.no_date_flag as tarihsiz,
           coalesce(i.sale_type_override, i.sale_type_auto) as kategori
    from public.installments t
    join public.invoices i on i.id = t.invoice_id
    where t.side = p_side and t.remaining_eur_cents is not null),
  s as (
    select * from t0
    where p_kategoriler is null or cardinality(p_kategoriler) = 0 or t0.kategori = any (p_kategoriler)),
  fa as (
    select s.firm_id,
      sum(s.borc) as toplam_borc, sum(s.odeme) as toplam_odeme, sum(s.kalan) as toplam_kalan,
      coalesce(sum(s.kalan) filter (where s.due_date < p_ay_bas), 0) as once_kalan,
      coalesce(sum(s.kalan) filter (where s.due_date > p_ay_son), 0) as sonra_kalan,
      coalesce(sum(s.kalan) filter (where s.due_date < p_bugun), 0) as gecikmis,
      coalesce(bool_or(s.tarihsiz and s.kalan > 0), false) as tarihsiz
    from s group by s.firm_id),
  ga as (
    select s.firm_id, s.due_date, sum(s.borc) as borc, sum(s.odeme) as odeme, sum(s.kalan) as kalan
    from s where s.due_date between p_ay_bas and p_ay_son
    group by s.firm_id, s.due_date),
  gj as (
    select ga.firm_id, jsonb_object_agg(ga.due_date::text, jsonb_build_array(ga.borc, ga.odeme, ga.kalan)) as gunler
    from ga group by ga.firm_id)
  select jsonb_build_object(
    'run_id', (select v.run_id from public.v_current_run v),
    'ozet', (select jsonb_build_object(
        'toplam_borc', coalesce(sum(s.borc), 0),
        'toplam_odenen', coalesce(sum(s.odeme), 0),
        'toplam_kalan', coalesce(sum(s.kalan), 0),
        'gecikmis', coalesce(sum(s.kalan) filter (where s.due_date < p_bugun), 0),
        'yakin_7', coalesce(sum(s.kalan) filter (where s.due_date between p_bugun and p_bugun + 6), 0),
        'tarihsiz_adet', count(*) filter (where s.tarihsiz and s.kalan > 0),
        'yas_0_30', coalesce(sum(s.kalan) filter (where s.kalan > 0 and p_bugun - s.due_date <= 30), 0),
        'yas_31_60', coalesce(sum(s.kalan) filter (where s.kalan > 0 and p_bugun - s.due_date between 31 and 60), 0),
        'yas_61_90', coalesce(sum(s.kalan) filter (where s.kalan > 0 and p_bugun - s.due_date between 61 and 90), 0),
        'yas_90p', coalesce(sum(s.kalan) filter (where s.kalan > 0 and p_bugun - s.due_date > 90), 0))
      from s),
    'ay_ozet', (select jsonb_build_object(
        'borc', coalesce(sum(s.borc), 0),
        'odeme', coalesce(sum(s.odeme), 0),
        'kalan', coalesce(sum(s.kalan), 0),
        'gecikmis', coalesce(sum(s.kalan) filter (where s.due_date < p_bugun), 0))
      from s where s.due_date between p_ay_bas and p_ay_son),
    'aylar', coalesce((
      select jsonb_agg(jsonb_build_object('ay', m.ay, 'borc', m.borc, 'kalan', m.kalan) order by m.ay)
      from (select to_char(s.due_date, 'YYYY-MM') as ay, sum(s.borc) as borc, sum(s.kalan) as kalan
            from s group by 1) m), '[]'::jsonb),
    'kategoriler', coalesce((
      select jsonb_agg(jsonb_build_object('kod', k.kategori, 'borc', k.borc, 'kalan', k.kalan,
                                          'gecikmis', k.gecikmis, 'firma', k.firma) order by k.kategori)
      from (select t0.kategori, sum(t0.borc) as borc, sum(t0.kalan) as kalan,
                   coalesce(sum(t0.kalan) filter (where t0.due_date < p_bugun), 0) as gecikmis,
                   count(distinct t0.firm_id) as firma
            from t0 group by t0.kategori) k), '[]'::jsonb),
    'firmalar', coalesce((
      select jsonb_agg(jsonb_build_object(
        'firm_id', fa.firm_id, 'kod', f.code_norm, 'ad', f.name,
        'sorumlu', nullif(upper(split_part(coalesce(f.pazarlamaci_email, ''), '@', 1)), ''),
        'toplam_borc', fa.toplam_borc, 'toplam_odeme', fa.toplam_odeme, 'toplam_kalan', fa.toplam_kalan,
        'once_kalan', fa.once_kalan, 'sonra_kalan', fa.sonra_kalan, 'gecikmis', fa.gecikmis,
        'tarihsiz', fa.tarihsiz, 'gunler', coalesce(gj.gunler, '{}'::jsonb))
        order by f.code_norm)
      from fa
      join public.firms f on f.id = fa.firm_id
      left join gj on gj.firm_id = fa.firm_id
      where fa.toplam_kalan > 0 or gj.firm_id is not null), '[]'::jsonb),
    -- 0007: kategori etiketleri ve görünüm ayarları
    'kategori_meta', public.kategori_meta())
  into sonuc;

  return sonuc;
end $$;

-- Kategori yönetimi ekranı: kategoriler + kullanım sayıları + kurallar (tek tur)
create or replace function public.rpc_kategori_yonetimi()
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'kategoriler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kod', k.kod, 'ad', k.ad, 'kisa_ad', k.kisa_ad, 'renk', k.renk, 'taraf', k.taraf, 'sira', k.sira,
        'aktif', k.aktif, 'sistem', k.sistem, 'sayfada_suzgec', k.sayfada_suzgec, 'panoda_kart', k.panoda_kart,
        'aciklama', k.aciklama, 'updated_at', k.updated_at, 'updated_by', k.updated_by,
        'irsaliye', coalesce(u.irsaliye, 0), 'tahsisteki', coalesce(u.tahsisteki, 0),
        'elle', coalesce(u.elle, 0), 'firma', coalesce(u.firma, 0), 'tutar', coalesce(u.tutar, 0),
        'elle_taksitli', coalesce(u.elle_taksitli, 0), 'acik', coalesce(a.acik, 0),
        'kural', (select count(*) from public.sale_category_rules r where r.kategori_kod = k.kod))
        order by k.sira, k.kod)
      from public.sale_categories k
      left join (
        select v.sale_type as kod, count(*) as irsaliye,
               count(*) filter (where v.is_allocatable) as tahsisteki,
               count(*) filter (where v.sale_type_override is not null) as elle,
               count(distinct v.firm_id) as firma,
               coalesce(sum(v.amount_eur_cents) filter (where not v.is_31_12 and not v.is_cancelled), 0) as tutar,
               count(*) filter (where exists (
                 select 1 from public.installments t where t.invoice_id = v.id and t.source = 'manual')) as elle_taksitli
        from public.v_invoices_effective v
        group by v.sale_type) u on u.kod = k.kod
      left join (
        select coalesce(i.sale_type_override, i.sale_type_auto) as kod, sum(t.remaining_eur_cents) as acik
        from public.installments t
        join public.invoices i on i.id = t.invoice_id
        where t.remaining_eur_cents > 0
        group by 1) a on a.kod = k.kod), '[]'::jsonb),
    'kurallar', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kategori_kod', r.kategori_kod, 'alan', r.alan, 'islec', r.islec, 'deger', r.deger,
        'sonuc', r.sonuc, 'sira', r.sira, 'aktif', r.aktif, 'aciklama', r.aciklama)
        order by r.sonuc, r.sira, r.id)
      from public.sale_category_rules r), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 9) Yönetim paneli "Genel Bakış": yalnız SAYILAR (kişisel veri yok), tek tur.
--    SECURITY DEFINER: tahsilat yöneticisi profilleri tek tek göremez ama kaç
--    aktif kullanıcı olduğunu görebilmeli. Yalnız yönetim rollerine döner.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_yonetim_ozeti(p_bugun date)
returns jsonb
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_staff() then
    return null;
  end if;
  return jsonb_build_object(
    'kullanicilar', (select jsonb_build_object(
        'toplam', count(*),
        'aktif', count(*) filter (where p.is_active),
        'yonetici', count(*) filter (where p.is_active and p.role = 'yonetici'),
        'tahsilat_yoneticisi', count(*) filter (where p.is_active and p.role = 'tahsilat_yoneticisi'),
        'pazarlamaci', count(*) filter (where p.is_active and p.role = 'pazarlamaci'))
      from public.profiles p),
    'firmalar', (select jsonb_build_object(
        'toplam', count(*),
        'takip_disi', count(*) filter (where exists (
            select 1 from public.excluded_firm_codes e where public.fold_tr(e.code_norm) = public.fold_tr(f.code_norm))),
        'sorumlusuz', count(*) filter (where coalesce(btrim(f.pazarlamaci_email), '') = ''),
        'sorumlu_eslesmeyen', count(*) filter (where coalesce(btrim(f.pazarlamaci_email), '') <> '' and not exists (
            select 1 from public.profiles p where lower(p.email) = lower(btrim(f.pazarlamaci_email)) and p.is_active)))
      from public.firms f),
    'eslesmeyen_sorumlular', coalesce((
      select jsonb_agg(x.e order by x.e) from (
        select distinct lower(btrim(f.pazarlamaci_email)) as e
        from public.firms f
        where coalesce(btrim(f.pazarlamaci_email), '') <> ''
          and not exists (select 1 from public.profiles p
                          where lower(p.email) = lower(btrim(f.pazarlamaci_email)) and p.is_active)) x), '[]'::jsonb),
    'son_kosu', (select jsonb_build_object(
        'started_at', k.started_at, 'finished_at', k.finished_at, 'triggered_by', k.triggered_by,
        'trigger_kind', k.trigger_kind, 'kdv_eslesmeyen', k.stats -> 'kdv_eslesmeyen', 'kdv_eslesen', k.stats -> 'kdv_eslesen')
      from public.recon_runs k where k.id = (select v.run_id from public.v_current_run v)),
    'saglik', (select jsonb_build_object(
        'siniflandirilmamis', count(*) filter (where v.sale_type = 'OTHER' and not v.is_iade),
        'siniflandirilmamis_tutar', coalesce(sum(v.amount_eur_cents) filter (where v.sale_type = 'OTHER' and not v.is_iade), 0),
        'inceleme', count(*) filter (where v.needs_review),
        'cakisma', count(*) filter (where v.raw_changed_after_override),
        'plan_okunamadi', count(*) filter (where v.plan_parse_status = 'unparsed' and v.side is not null))
      from public.v_invoices_effective v
      where not v.is_31_12 and not v.is_cancelled and not coalesce(v.excluded_override, v.is_excluded_firm)),
    'tarihsiz_taksit', (select count(*) from public.v_open_installments o where o.no_date_flag),
    'son_aktarimlar', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'filename', b.filename, 'uploaded_by', b.uploaded_by, 'status', b.status,
        'created_at', b.created_at, 'committed_at', b.committed_at, 'stats', b.stats) order by b.created_at desc)
      from (select * from public.import_batches order by created_at desc limit 5) b), '[]'::jsonb),
    'son_degisiklikler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'actor_email', a.actor_email, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
        'action', a.action, 'field', a.field, 'created_at', a.created_at) order by a.id desc)
      from (select * from public.audit_log order by id desc limit 8) a), '[]'::jsonb),
    'kategoriler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kod', k.kod, 'ad', k.ad, 'renk', k.renk, 'taraf', k.taraf, 'aktif', k.aktif,
        'acik', coalesce(a.acik, 0), 'gecikmis', coalesce(a.gecikmis, 0)) order by k.sira, k.kod)
      from public.sale_categories k
      left join (
        select coalesce(i.sale_type_override, i.sale_type_auto) as kod,
               sum(t.remaining_eur_cents) as acik,
               coalesce(sum(t.remaining_eur_cents) filter (where t.due_date < p_bugun), 0) as gecikmis
        from public.installments t
        join public.invoices i on i.id = t.invoice_id
        where t.remaining_eur_cents > 0
        group by 1) a on a.kod = k.kod
      where k.taraf is not null), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 10) YAZMA fonksiyonları — yalnız service_role (uygulama sunucusu), kilitli
-- ---------------------------------------------------------------------------

-- Taksitlerin tarafını (ve "tarih girilmedi" işaretini) etkin kategoriye eşitler.
-- p_invoice_ids NULL → tüm irsaliyeler (hesap başında ucuz kendini onarma).
create or replace function public.taksit_taraf_esitle(p_invoice_ids uuid[] default null)
returns int
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  with h as (
    select i.id, k.taraf,
           case when i.plan_override_note is not null then btrim(i.plan_override_note) = ''
                else i.plan_parse_status = 'empty_default' end as bos_plan
    from public.invoices i
    join public.sale_categories k on k.kod = coalesce(i.sale_type_override, i.sale_type_auto)
    where k.taraf is not null and (p_invoice_ids is null or i.id = any (p_invoice_ids)))
  update public.installments t
     set side = h.taraf,
         no_date_flag = (t.source <> 'manual' and h.taraf = 'VADELI' and h.bos_plan)
  from h
  where t.invoice_id = h.id and t.side is distinct from h.taraf;
  get diagnostics n = row_count;
  return n;
end $$;

-- Toplu yeniden sınıflandırma (kural uygulaması): yalnız OTOMATİK alanlar yazılır;
-- sale_type_override ve plan alanlarına asla dokunulmaz.
-- p_degisiklikler: [{"id": uuid, "auto": kod, "oneri": kod|null, "neden": text, "inceleme": bool}]
create or replace function public.rpc_siniflandirma_yaz(p_degisiklikler jsonb)
returns jsonb
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  ids uuid[];
  n_irs int;
  n_sil int;
  n_taraf int;
begin
  perform pg_advisory_xact_lock(hashtext('avrupa_kategori'));
  select coalesce(array_agg(x.id), '{}') into ids from jsonb_to_recordset(p_degisiklikler) as x(id uuid);

  update public.invoices i
     set sale_type_auto = d.auto,
         suggested_sale_type = d.oneri,
         classify_reason = d.neden,
         needs_review = coalesce(d.inceleme, i.needs_review),
         updated_at = now()
  from jsonb_to_recordset(p_degisiklikler) as d(id uuid, auto text, oneri text, neden text, inceleme boolean)
  where i.id = d.id;
  get diagnostics n_irs = row_count;

  -- Davranışı olmayan (sınıflandırılmadı / hesaba katılmaz) etkin tipe geçenlerin
  -- OTOMATİK taksitleri silinir; elle girilenler kalır (kapsam dışı olur).
  delete from public.installments t
  using public.invoices i
  left join public.sale_categories k on k.kod = coalesce(i.sale_type_override, i.sale_type_auto)
  where t.invoice_id = i.id and i.id = any (ids) and k.taraf is null and t.source <> 'manual';
  get diagnostics n_sil = row_count;

  n_taraf := public.taksit_taraf_esitle(ids);
  return jsonb_build_object('irsaliye', n_irs, 'silinen_taksit', n_sil, 'taraf_esitlenen', n_taraf);
end $$;

-- Kural setini değiştirir (tamamı tek işlemde)
create or replace function public.rpc_kurallari_kaydet(p_kurallar jsonb, p_kim text)
returns int
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('avrupa_kategori'));
  if exists (
    select 1
    from jsonb_to_recordset(p_kurallar) as x(kategori_kod text)
    left join public.sale_categories k on k.kod = x.kategori_kod
    where k.kod is null or not k.aktif or k.kod = 'OTHER') then
    raise exception 'Kural hedefi geçersiz, pasif ya da "Sınıflandırılmadı"' using errcode = '22023';
  end if;
  delete from public.sale_category_rules;
  insert into public.sale_category_rules (kategori_kod, alan, islec, deger, sonuc, sira, aktif, aciklama, updated_by)
  select x.kategori_kod, x.alan, x.islec, x.deger, x.sonuc, x.sira, coalesce(x.aktif, true), nullif(btrim(x.aciklama), ''), p_kim
  from jsonb_to_recordset(p_kurallar) as x(kategori_kod text, alan text, islec text, deger text, sonuc text,
                                          sira int, aktif boolean, aciklama text);
  get diagnostics n = row_count;
  return n;
end $$;

-- Sistem dışı bir kategorinin davranışını değiştirir; taksitleri tek işlemde uyarlar.
-- Dönüş "taksitsiz": taksit kurulması gereken irsaliyeler (uygulama plana göre kurar).
create or replace function public.rpc_kategori_taraf_degistir(p_kod text, p_taraf text, p_kim text)
returns jsonb
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  eski text;
  ids uuid[];
  n_taraf int := 0;
  n_sil int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('avrupa_kategori'));
  if p_taraf is not null and p_taraf not in ('PESIN', 'VADELI') then
    raise exception 'Geçersiz davranış: %', p_taraf using errcode = '22023';
  end if;
  select k.taraf into eski from public.sale_categories k where k.kod = p_kod for update;
  if not found then
    raise exception 'Kategori bulunamadı: %', p_kod using errcode = '22023';
  end if;
  -- sistem kategorileri tetikleyicide reddedilir
  update public.sale_categories set taraf = p_taraf, updated_by = p_kim where kod = p_kod;

  select coalesce(array_agg(i.id), '{}') into ids
  from public.invoices i where coalesce(i.sale_type_override, i.sale_type_auto) = p_kod;

  if p_taraf is null then
    delete from public.installments t where t.invoice_id = any (ids) and t.source <> 'manual';
    get diagnostics n_sil = row_count;
  else
    n_taraf := public.taksit_taraf_esitle(ids);
  end if;

  return jsonb_build_object(
    'eski', eski, 'yeni', p_taraf, 'irsaliye', cardinality(ids),
    'taraf_esitlenen', n_taraf, 'silinen_taksit', n_sil,
    'taksitsiz', case when p_taraf is null then '[]'::jsonb else coalesce((
      select jsonb_agg(i.id) from public.invoices i
      where i.id = any (ids)
        and not exists (select 1 from public.installments t where t.invoice_id = i.id)), '[]'::jsonb) end);
end $$;

-- ---------------------------------------------------------------------------
-- 11) Hibeler
-- ---------------------------------------------------------------------------
revoke all on function public.kategori_meta() from public, anon;
revoke all on function public.rpc_pano_ozeti(date) from public, anon;
revoke all on function public.rpc_firma_detay(uuid) from public, anon;
revoke all on function public.rpc_inceleme() from public, anon;
revoke all on function public.rpc_takvim(text, date, date, date, text[]) from public, anon;
revoke all on function public.rpc_kategori_yonetimi() from public, anon;
revoke all on function public.rpc_yonetim_ozeti(date) from public, anon;
grant execute on function public.kategori_meta() to authenticated, service_role;
grant execute on function public.rpc_pano_ozeti(date) to authenticated, service_role;
grant execute on function public.rpc_firma_detay(uuid) to authenticated, service_role;
grant execute on function public.rpc_inceleme() to authenticated, service_role;
grant execute on function public.rpc_takvim(text, date, date, date, text[]) to authenticated, service_role;
grant execute on function public.rpc_kategori_yonetimi() to authenticated, service_role;
grant execute on function public.rpc_yonetim_ozeti(date) to authenticated, service_role;

revoke all on function public.sale_categories_koru() from public, anon, authenticated;
revoke all on function public.taksit_taraf_esitle(uuid[]) from public, anon, authenticated;
revoke all on function public.rpc_siniflandirma_yaz(jsonb) from public, anon, authenticated;
revoke all on function public.rpc_kurallari_kaydet(jsonb, text) from public, anon, authenticated;
revoke all on function public.rpc_kategori_taraf_degistir(text, text, text) from public, anon, authenticated;
grant execute on function public.taksit_taraf_esitle(uuid[]) to service_role;
grant execute on function public.rpc_siniflandirma_yaz(jsonb) to service_role;
grant execute on function public.rpc_kurallari_kaydet(jsonb, text) to service_role;
grant execute on function public.rpc_kategori_taraf_degistir(text, text, text) to service_role;

notify pgrst, 'reload schema';
