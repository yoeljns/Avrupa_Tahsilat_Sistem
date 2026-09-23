-- ============================================================================
-- 0005_hiz_rls.sql — VERİTABANI TARAFI HIZ DÜZELTMESİ
--
-- ÖLÇÜM (canlı veritabanı, 23.09.2026):
--   Konsinye sayfasının taksit sorgusu (v_installments_scope) ortalama 724 ms
--   sürüyordu (657 çağrı, toplam 476 sn). Aynı sorgu RLS'siz 6 ms.
--   Sebep: RLS politikalarındaki public.is_staff() HER SATIR için ayrı ayrı
--   çalışıyordu (4.000+ taksit × profil sorgusu).
--
-- ÇÖZÜM:
--   1) Politikalar (select public.is_staff()) biçimine çevrildi: sorgu başına
--      TEK kez çalışır. Kim neyi görür — AYNEN korunur (testle kanıtlı).
--   2) Eksik yabancı anahtar indeksleri (silmelerde tam tarama olmasın).
--   3) Her sayfanın verisini TEK ağ turunda veren özet fonksiyonları.
--   4) Düzenleme sonrası yalnız ilgili FİRMAYI yeniden hesaplamak için
--      girdi/yazma fonksiyonları (tüm sistemi baştan hesaplamak yerine).
--
-- 0004_hiz.sql'den SONRA çalıştırın. İdempotenttir.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) RLS — rol yardımcıları sorgu başına BİR KEZ
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists firms_select on public.firms;
create policy firms_select on public.firms for select
  using ((select public.is_staff()) or id in (select public.my_firm_ids()));

drop policy if exists excluded_codes_select on public.excluded_firm_codes;
create policy excluded_codes_select on public.excluded_firm_codes for select
  using ((select auth.role()) = 'authenticated');

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using ((select public.is_staff()) or firm_id in (select public.my_firm_ids()));

drop policy if exists installments_select on public.installments;
create policy installments_select on public.installments for select
  using ((select public.is_staff()) or firm_id in (select public.my_firm_ids()));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using ((select public.is_staff()) or firm_id in (select public.my_firm_ids()));

-- Koşu istatistikleri şirket geneli toplamları içerir → yalnız yönetim görür
-- (pazarlamacı yalnız kendi firmalarının rakamlarını görmeye devam eder).
drop policy if exists recon_runs_select on public.recon_runs;
create policy recon_runs_select on public.recon_runs for select
  using ((select public.is_staff()));

drop policy if exists allocations_select on public.allocations;
create policy allocations_select on public.allocations for select
  using ((select public.is_staff()) or firm_id in (select public.my_firm_ids()));

drop policy if exists firm_side_balances_select on public.firm_side_balances;
create policy firm_side_balances_select on public.firm_side_balances for select
  using ((select public.is_staff()) or firm_id in (select public.my_firm_ids()));

drop policy if exists firm_balances_select on public.firm_balances;
create policy firm_balances_select on public.firm_balances for select
  using ((select public.is_staff()) or firm_id in (select public.my_firm_ids()));

drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_select on public.import_batches for select
  using ((select public.is_staff()));

drop policy if exists import_rows_select on public.import_rows;
create policy import_rows_select on public.import_rows for select
  using ((select public.is_staff()));

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select
  using ((select public.is_staff()));

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select
  using ((select auth.role()) = 'authenticated');

-- ---------------------------------------------------------------------------
-- 2) Yabancı anahtar indeksleri — taksit/ödeme silindiğinde tahsis tablosu
--    baştan sona taranmasın
-- ---------------------------------------------------------------------------
create index if not exists allocations_installment_idx on public.allocations (installment_id);
create index if not exists allocations_payment_idx on public.allocations (payment_id);
create index if not exists allocations_invoice_idx on public.allocations (invoice_id);
create index if not exists allocations_firm_idx on public.allocations (firm_id);
create index if not exists firm_balances_firm_idx on public.firm_balances (firm_id);
create index if not exists firm_side_balances_firm_idx on public.firm_side_balances (firm_id);

-- ---------------------------------------------------------------------------
-- 3) Etkin irsaliye görünümü
--    * Yöneticinin girdiği plan eklenir (firma sayfası ham planı değil,
--      DÜZENLENMİŞ planı göstersin).
--    * İADE irsaliyeleri borca YAZILMAZ: iade, müşterinin borcunu artırmaz.
--      Yönetici satış tipini açıkça seçerse (override) karar onundur.
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
      and (i.sale_type_override is not null or public.fold_tr(i.turu_raw) not like '%IADE%')
    ) as is_allocatable,
    -- 0005: yöneticinin girdiği plan (varsa), etkin plan metni ve iade bayrağı
    i.plan_override_note,
    coalesce(i.plan_override_note, i.odeme_plani_raw) as odeme_plani_etkin,
    (public.fold_tr(i.turu_raw) like '%IADE%') as is_iade
  from public.invoices i
  join public.firms f on f.id = i.firm_id;

-- ---------------------------------------------------------------------------
-- 4) SAYFA VERİSİ — her sayfa TEK ağ turu.
--    Hepsi SECURITY INVOKER: RLS çağıranın kimliğiyle işler (pazarlamacı
--    yalnız kendi firmalarını görmeye devam eder).
-- ---------------------------------------------------------------------------

-- Pano özeti: bakiyeler + vade pencereleri (CANLI: bugüne göre) + inceleme sayısı
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
                   and not coalesce(v.excluded_override, v.is_excluded_firm)))
  from r
$$;

-- Firma listesi: firma + bakiye + canlı gecikme/ilk vade (takip dışılar hariç)
create or replace function public.rpc_firma_listesi(p_bugun date)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  with r as (select (select v.run_id from public.v_current_run v) as run_id),
  vd as (
    select t.firm_id,
      sum(t.remaining_eur_cents) filter (where t.due_date < p_bugun) as gecikmis,
      min(t.due_date) as ilk_vade
    from public.installments t
    where t.side = 'VADELI' and t.remaining_eur_cents > 0
    group by t.firm_id)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'kod', f.code_norm,
      'ad', f.name,
      'sehir', f.city,
      'sorumlu', nullif(split_part(coalesce(f.pazarlamaci_email, ''), '@', 1), ''),
      'oto', f.is_auto_created,
      'pesin', coalesce(b.pesin_open_eur_cents, 0),
      'vadeli', coalesce(b.vadeli_open_eur_cents, 0),
      'alacak', coalesce(b.credit_eur_cents, 0),
      'gecikmis', coalesce(vd.gecikmis, 0),
      'ilk_vade', vd.ilk_vade)
    order by f.code_norm), '[]'::jsonb)
  from public.firms f
  cross join r
  left join public.firm_balances b on b.run_id = r.run_id and b.firm_id = f.id
  left join vd on vd.firm_id = f.id
  where not exists (
    select 1 from public.excluded_firm_codes e
    where public.fold_tr(e.code_norm) = public.fold_tr(f.code_norm))
$$;

-- Firma detayı: firma + irsaliyeler + taksitler + ödemeler + tahsisler + bakiye
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
      from public.allocations a where a.run_id = r.run_id and a.firm_id = f.id), '[]'::jsonb)
  ) end
  from r
  left join public.firms f on f.id = p_firm_id
$$;

-- Takvim matrisi: taksitler SUNUCUDA toplanır — yalnız seçili ayın günleri +
-- firma toplamları taşınır (binlerce satır yerine birkaç yüz hücre).
create or replace function public.rpc_matris_ay(p_side text, p_ay_bas date, p_ay_son date, p_bugun date)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  with s as (
    select t.firm_id, t.due_date,
           t.amount_eur_cents as borc,
           t.remaining_eur_cents as kalan,
           t.amount_eur_cents - t.remaining_eur_cents as odeme,
           t.no_date_flag as tarihsiz
    from public.installments t
    where t.side = p_side and t.remaining_eur_cents is not null),
  fa as (
    select s.firm_id,
      sum(s.borc) as toplam_borc, sum(s.odeme) as toplam_odeme, sum(s.kalan) as toplam_kalan,
      coalesce(sum(s.kalan) filter (where s.due_date < p_ay_bas), 0) as once_kalan,
      coalesce(sum(s.kalan) filter (where s.due_date > p_ay_son), 0) as sonra_kalan,
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
        'tarihsiz_adet', count(*) filter (where s.tarihsiz and s.kalan > 0),
        'yas_0_30', coalesce(sum(s.kalan) filter (where s.kalan > 0 and p_bugun - s.due_date <= 30), 0),
        'yas_31_60', coalesce(sum(s.kalan) filter (where s.kalan > 0 and p_bugun - s.due_date between 31 and 60), 0),
        'yas_61_90', coalesce(sum(s.kalan) filter (where s.kalan > 0 and p_bugun - s.due_date between 61 and 90), 0),
        'yas_90p', coalesce(sum(s.kalan) filter (where s.kalan > 0 and p_bugun - s.due_date > 90), 0))
      from s),
    'aylar', coalesce((select jsonb_agg(m.ay order by m.ay)
                       from (select distinct to_char(s.due_date, 'YYYY-MM') as ay from s) m), '[]'::jsonb),
    'firmalar', coalesce((
      select jsonb_agg(jsonb_build_object(
        'firm_id', fa.firm_id, 'kod', f.code_norm, 'ad', f.name,
        'sorumlu', nullif(upper(split_part(coalesce(f.pazarlamaci_email, ''), '@', 1)), ''),
        'toplam_borc', fa.toplam_borc, 'toplam_odeme', fa.toplam_odeme, 'toplam_kalan', fa.toplam_kalan,
        'once_kalan', fa.once_kalan, 'sonra_kalan', fa.sonra_kalan, 'tarihsiz', fa.tarihsiz,
        'gunler', coalesce(gj.gunler, '{}'::jsonb))
        order by f.code_norm)
      from fa
      join public.firms f on f.id = fa.firm_id
      left join gj on gj.firm_id = fa.firm_id
      where fa.toplam_kalan > 0 or gj.firm_id is not null), '[]'::jsonb))
$$;

-- İnceleme kuyruğu: bekleyen irsaliyeler + tarihsiz açık taksitler tek turda
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
      where o.no_date_flag), '[]'::jsonb))
$$;

revoke all on function public.rpc_pano_ozeti(date) from public, anon;
revoke all on function public.rpc_firma_listesi(date) from public, anon;
revoke all on function public.rpc_firma_detay(uuid) from public, anon;
revoke all on function public.rpc_matris_ay(text, date, date, date) from public, anon;
revoke all on function public.rpc_inceleme() from public, anon;
grant execute on function public.rpc_pano_ozeti(date) to authenticated, service_role;
grant execute on function public.rpc_firma_listesi(date) to authenticated, service_role;
grant execute on function public.rpc_firma_detay(uuid) to authenticated, service_role;
grant execute on function public.rpc_matris_ay(text, date, date, date) to authenticated, service_role;
grant execute on function public.rpc_inceleme() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) FİRMA BAZLI YENİDEN HESAP (yalnız sunucu / service_role)
--
-- Düzenleme tek bir firmayı etkiler; tahsis kuralı da firma başınadır
-- (bir firmanın ödemesi başka firmanın borcunu asla kapatmaz). Bu yüzden
-- düzenlemeden sonra TÜM sistemi baştan hesaplamak yerine yalnız o firma
-- hesaplanıp güncel koşuya yazılır. Sonuç, tam hesapla BİREBİR aynıdır.
--
-- Eşzamanlılık: girdiler okunduktan sonra başka biri aynı firmayı
-- değiştirirse yazma "SURUM_DEGISTI" döner ve uygulama baştan dener; tam
-- yeniden hesap sırasında gelen düzenlemeler de koşu çevrilirken yakalanır.
-- ---------------------------------------------------------------------------

-- Düzenlenen firmaların izi (tam hesap sırasında gelen düzenlemeyi yakalamak için)
create table if not exists public.firm_recalc_marks (
  firm_id uuid primary key references public.firms (id) on delete cascade,
  marked_at timestamptz not null default now()
);
alter table public.firm_recalc_marks enable row level security;
-- (politika yok: yalnız service_role erişir)

-- Firmaların tahsis girdisinin parmak izi: herhangi bir alan değişirse değişir
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
           || coalesce(i.excluded_override::text, 'n') || ':' || i.turu_raw as s
    from public.invoices i where i.firm_id = any (p_firm_ids)
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

-- Girdi: güncel koşu + firmaların irsaliye/taksit/ödemeleri + sürüm — TEK tur
create or replace function public.rpc_tahsis_girdisi(p_firm_ids uuid[])
returns jsonb
language plpgsql volatile
set search_path = public, pg_temp
as $$
begin
  insert into public.firm_recalc_marks (firm_id, marked_at)
  select f.id, now() from public.firms f where f.id = any (p_firm_ids)
  on conflict (firm_id) do update set marked_at = excluded.marked_at;

  return jsonb_build_object(
    'run_id', (select v.run_id from public.v_current_run v),
    'surum', public.tahsis_surumu(p_firm_ids),
    'firmalar', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'code_norm', f.code_norm))
      from public.firms f where f.id = any (p_firm_ids)), '[]'::jsonb),
    'haric_kodlar', coalesce((select jsonb_agg(e.code_norm) from public.excluded_firm_codes e), '[]'::jsonb),
    'irsaliyeler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'firm_id', v.firm_id, 'fis_no', v.fis_no, 'invoice_date', v.invoice_date,
        'side', v.side, 'is_allocatable', v.is_allocatable, 'is_excluded_firm', v.is_excluded_firm))
      from public.v_invoices_effective v where v.firm_id = any (p_firm_ids)), '[]'::jsonb),
    'taksitler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'invoice_id', t.invoice_id, 'firm_id', t.firm_id, 'seq', t.seq,
        'due_date', t.due_date, 'amount_eur_cents', t.amount_eur_cents))
      from public.installments t where t.firm_id = any (p_firm_ids)), '[]'::jsonb),
    'odemeler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'islem_kodu', p.islem_kodu, 'firm_id', p.firm_id, 'islem_tarihi', p.islem_tarihi,
        'doviz_eur_cents', p.doviz_eur_cents, 'is_kdv', p.is_kdv,
        'kdv_fatura_referansi', p.kdv_fatura_referansi, 'aciklama', p.aciklama))
      from public.payments p where p.firm_id = any (p_firm_ids) and p.allocatable), '[]'::jsonb));
end $$;

-- Yazma: yalnız verilen firmaların güncel koşudaki sonuçları değiştirilir.
-- Dönüş: 'OK' | 'ESKI_KOSU' (bu arada yeni koşu açıldı) | 'SURUM_DEGISTI' (girdi değişti)
create or replace function public.rpc_tahsis_yaz(
  p_run_id uuid,
  p_firm_ids uuid[],
  p_surum text,
  p_tahsisler jsonb,
  p_bakiyeler jsonb,
  p_kalanlar jsonb
)
returns text
language plpgsql volatile
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtext('avrupa_tahsis'));

  if (select v.run_id from public.v_current_run v) is distinct from p_run_id then
    return 'ESKI_KOSU';
  end if;
  if public.tahsis_surumu(p_firm_ids) is distinct from p_surum then
    return 'SURUM_DEGISTI';
  end if;

  delete from public.allocations a where a.run_id = p_run_id and a.firm_id = any (p_firm_ids);
  insert into public.allocations (run_id, payment_id, installment_id, invoice_id, firm_id, side, amount_eur_cents)
  select p_run_id, (x ->> 'payment_id')::uuid, (x ->> 'installment_id')::uuid, (x ->> 'invoice_id')::uuid,
         (x ->> 'firm_id')::uuid, x ->> 'side', (x ->> 'amount_eur_cents')::bigint
  from jsonb_array_elements(coalesce(p_tahsisler, '[]'::jsonb)) x;

  delete from public.firm_balances b where b.run_id = p_run_id and b.firm_id = any (p_firm_ids);
  insert into public.firm_balances (run_id, firm_id, pesin_open_eur_cents, vadeli_open_eur_cents,
    vadeli_overdue_eur_cents, credit_eur_cents, next_due_date, total_debt_eur_cents, total_paid_eur_cents)
  select p_run_id, (x ->> 'firm_id')::uuid, (x ->> 'pesin_open_eur_cents')::bigint,
         (x ->> 'vadeli_open_eur_cents')::bigint, (x ->> 'vadeli_overdue_eur_cents')::bigint,
         (x ->> 'credit_eur_cents')::bigint, nullif(x ->> 'next_due_date', '')::date,
         (x ->> 'total_debt_eur_cents')::bigint, (x ->> 'total_paid_eur_cents')::bigint
  from jsonb_array_elements(coalesce(p_bakiyeler, '[]'::jsonb)) x;

  -- kapsam dışı taksitler NULL, kapsam içindekiler hesaplanan kalan
  update public.installments t set remaining_eur_cents = null
  where t.firm_id = any (p_firm_ids) and t.remaining_eur_cents is not null;
  update public.installments t set remaining_eur_cents = (x ->> 'remaining')::bigint
  from jsonb_array_elements(coalesce(p_kalanlar, '[]'::jsonb)) x
  where t.id = (x ->> 'id')::uuid and t.firm_id = any (p_firm_ids);

  update public.recon_runs k
  set stats = k.stats || jsonb_build_object(
        'firma_guncelleme', coalesce((k.stats ->> 'firma_guncelleme')::int, 0) + 1,
        'son_firma_guncelleme', now())
  where k.id = p_run_id;

  return 'OK';
end $$;

-- Tam hesabın son adımı: işaretçiyi kilit altında çevirir ve koşu sürerken
-- düzenlenen firmaları döndürür (uygulama onları hemen yeniden hesaplar).
create or replace function public.rpc_kosu_cevir(p_run_id uuid)
returns jsonb
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  v_bas timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('avrupa_tahsis'));
  select k.started_at into v_bas from public.recon_runs k where k.id = p_run_id;
  if v_bas is null then
    raise exception 'Koşu bulunamadı: %', p_run_id;
  end if;

  insert into public.app_settings (key, value, updated_at)
  values ('current_recon_run', jsonb_build_object('run_id', p_run_id), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  update public.recon_runs set finished_at = now() where id = p_run_id;

  return coalesce((select jsonb_agg(m.firm_id) from public.firm_recalc_marks m where m.marked_at >= v_bas), '[]'::jsonb);
end $$;

-- Eski koşuları temizler (güncel koşu asla silinmez)
create or replace function public.rpc_eski_kosulari_buda(p_tut int default 5)
returns int
language sql volatile
set search_path = public, pg_temp
as $$
  with silinecek as (
    select k.id from public.recon_runs k
    order by k.started_at desc
    offset greatest(p_tut, 1)),
  d as (
    delete from public.recon_runs k
    using silinecek s
    where k.id = s.id
      and k.id is distinct from (select v.run_id from public.v_current_run v)
    returning 1)
  select count(*)::int from d
$$;

-- Elle taksit kaydı: silme + ekleme TEK işlemde. Ekleme hata verirse (ör.
-- geçersiz tarih) silme de geri alınır — irsaliye asla taksitsiz kalmaz.
create or replace function public.rpc_elle_taksit_yaz(
  p_invoice_id uuid,
  p_firm_id uuid,
  p_side text,
  p_taksitler jsonb
)
returns int
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  if p_side not in ('PESIN', 'VADELI') then
    raise exception 'Geçersiz taraf: %', p_side;
  end if;
  if jsonb_array_length(coalesce(p_taksitler, '[]'::jsonb)) = 0 then
    raise exception 'En az bir taksit gerekli';
  end if;
  delete from public.installments t where t.invoice_id = p_invoice_id;
  insert into public.installments
    (invoice_id, firm_id, side, seq, due_date, amount_eur_cents, source, no_date_flag, remaining_eur_cents)
  select p_invoice_id, p_firm_id, p_side, (x ->> 'seq')::int, (x ->> 'due_date')::date,
         (x ->> 'amount_eur_cents')::bigint, 'manual', false, null
  from jsonb_array_elements(p_taksitler) x;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.rpc_elle_taksit_yaz(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_elle_taksit_yaz(uuid, uuid, text, jsonb) to service_role;

revoke all on function public.tahsis_surumu(uuid[]) from public, anon, authenticated;
revoke all on function public.rpc_tahsis_girdisi(uuid[]) from public, anon, authenticated;
revoke all on function public.rpc_tahsis_yaz(uuid, uuid[], text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_kosu_cevir(uuid) from public, anon, authenticated;
revoke all on function public.rpc_eski_kosulari_buda(int) from public, anon, authenticated;
grant execute on function public.tahsis_surumu(uuid[]) to service_role;
grant execute on function public.rpc_tahsis_girdisi(uuid[]) to service_role;
grant execute on function public.rpc_tahsis_yaz(uuid, uuid[], text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.rpc_kosu_cevir(uuid) to service_role;
grant execute on function public.rpc_eski_kosulari_buda(int) to service_role;
