-- ============================================================================
-- 0008_duzeltmeler.sql — DÜZELTME PAKETİ (EUR'suz ödeme, 7/30 gün, yaşlandırma, gece hesabı)
--
--   * payments.doviz_eur_cents_override: DÖVİZ EURO'su boş (ya da yanlış) ödemeye
--     yönetimin elle girdiği EUR. Etkin tutar = coalesce(override, doviz_eur_cents).
--     İçe aktarma bu kolona hiç yazmaz; elle girilen tutar yeniden yüklemede korunur.
--   * recon_runs.trigger_kind: 'cron' (her gece otomatik tam hesap) eklenir.
--   * tahsis_surumu / rpc_tahsis_girdisi / rpc_firma_detay: elle girilen EUR.
--   * rpc_inceleme: yeni 'odemeler' (EUR'suz ve dosyayla çelişen ödemeler).
--   * rpc_yonetim_ozeti: yeni 'odeme_eur_eksik' (veri sağlığı).
--   * rpc_pano_ozeti: "7 gün" ve "30 gün" bugün dahil (takvimle aynı tanım).
--   * rpc_takvim: yaşlandırmada 'yas_gelmemis' ve 'yas_1_30'.
--
-- GERİ UYUM: aynı imzalar, yalnız yeni kolon ve yeni JSON anahtarları; önceki
-- sürüm bu göçten sonra aynen çalışır.
--
-- 0007_kategoriler.sql'den SONRA çalıştırın. İdempotenttir.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Ödemeye elle EUR
-- ---------------------------------------------------------------------------
alter table public.payments add column if not exists doviz_eur_cents_override bigint;
alter table public.payments drop constraint if exists payments_doviz_eur_cents_override_check;
alter table public.payments add constraint payments_doviz_eur_cents_override_check
  check (doviz_eur_cents_override is null or doviz_eur_cents_override > 0);
comment on column public.payments.doviz_eur_cents_override is
  'Yönetimin elle girdiği EUR (kuruş). Etkin tutar = coalesce(override, doviz_eur_cents). İçe aktarma yazmaz.';

-- ---------------------------------------------------------------------------
-- 2) Hesap türü: gece otomatik tam hesap
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.recon_runs'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%trigger_kind%'
  loop
    execute format('alter table public.recon_runs drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.recon_runs add constraint recon_runs_trigger_kind_check
  check (trigger_kind in ('import', 'edit', 'manual', 'setup', 'cron'));

-- ---------------------------------------------------------------------------
-- 3) Parmak izi: elle girilen EUR da girdidir
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
           || coalesce(p.doviz_eur_cents_override, -1) || ':'
           || coalesce(p.islem_tarihi::text, '') || ':' || p.allocatable || ':' || p.is_kdv || ':'
           || coalesce(p.kdv_fatura_referansi, '') || ':' || coalesce(p.aciklama, '')
    from public.payments p where p.firm_id = any (p_firm_ids)
    union all
    select 'E' || e.code_norm from public.excluded_firm_codes e
  ) x
$$;

-- ---------------------------------------------------------------------------
-- 4) Firma bazlı hesap girdisi: elle girilen EUR
-- ---------------------------------------------------------------------------
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
        'doviz_eur_cents', p.doviz_eur_cents, 'doviz_eur_cents_override', p.doviz_eur_cents_override,
        'is_kdv', p.is_kdv,
        'kdv_fatura_referansi', p.kdv_fatura_referansi, 'aciklama', p.aciklama))
      from public.payments p where p.firm_id = any (p_firm_ids) and p.allocatable), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 5) Firma kartı: ödemelerde elle girilen EUR
-- ---------------------------------------------------------------------------
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
        'gelen_tl', p.gelen_tl, 'doviz_eur_cents', p.doviz_eur_cents,
        'doviz_eur_cents_override', p.doviz_eur_cents_override, 'kur', p.kur, 'aciklama', p.aciklama,
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

-- ---------------------------------------------------------------------------
-- 6) İnceleme: EUR'suz ve çelişen ödemeler
-- ---------------------------------------------------------------------------
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
    -- 0008: EUR tutarı olmayan (hesaba giremeyen) ve elle girilen tutarı dosyayla çelişen ödemeler
    'odemeler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'islem_kodu', p.islem_kodu, 'firm_id', p.firm_id, 'firm_code', f.code_norm, 'firm_name', f.name,
        'islem_tarihi', p.islem_tarihi, 'sheet_side', p.sheet_side, 'gelen_tl', p.gelen_tl, 'kur', p.kur,
        'toplam_tl', p.toplam_tl, 'aciklama', p.aciklama, 'is_kdv', p.is_kdv,
        'doviz_eur_cents', p.doviz_eur_cents, 'doviz_eur_cents_override', p.doviz_eur_cents_override,
        'durum', case when coalesce(p.doviz_eur_cents_override, p.doviz_eur_cents, 0) <= 0 then 'eksik' else 'cakisma' end,
        -- öneri kuru: ödemenin kendi kuru; yoksa ±7 gündeki ödemelerin ortalama kuru
        'oneri_kur', coalesce(nullif(p.kur, 0), (
            select round(avg(q.kur), 4) from public.payments q
            where q.kur > 0 and p.islem_tarihi is not null and q.islem_tarihi is not null
              and q.islem_tarihi between p.islem_tarihi - interval '7 days' and p.islem_tarihi + interval '7 days')))
        order by p.islem_tarihi desc nulls last, p.islem_kodu)
      from public.payments p
      join public.firms f on f.id = p.firm_id
      where p.allocatable
        and not exists (select 1 from public.excluded_firm_codes e
                        where public.fold_tr(e.code_norm) = public.fold_tr(f.code_norm))
        and (coalesce(p.doviz_eur_cents_override, p.doviz_eur_cents, 0) <= 0
             or (p.doviz_eur_cents_override is not null and coalesce(p.doviz_eur_cents, 0) > 0
                 and p.doviz_eur_cents <> p.doviz_eur_cents_override))), '[]'::jsonb),
    -- 0007: seçenekler ve etiketler
    'kategoriler', public.kategori_meta())
$$;

-- ---------------------------------------------------------------------------
-- 7) Genel Bakış: EUR'suz ödeme sayısı
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
    -- 0008: EUR tutarı olmadığı için hesaba giremeyen ödemeler
    'odeme_eur_eksik', (select jsonb_build_object('adet', count(*), 'gelen_tl', coalesce(sum(p.gelen_tl), 0))
      from public.payments p
      join public.firms f on f.id = p.firm_id
      where p.allocatable
        and not exists (select 1 from public.excluded_firm_codes e
                        where public.fold_tr(e.code_norm) = public.fold_tr(f.code_norm))
        and coalesce(p.doviz_eur_cents_override, p.doviz_eur_cents, 0) <= 0),
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
-- 8) Pano: bugün dahil 7 / 30 gün
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
               -- 0008: bugün dahil 7 / 30 gün (takvimle aynı tanım; eskiden 8 / 31 gündü)
               'gun7', coalesce(sum(t.remaining_eur_cents) filter (where t.due_date between p_bugun and p_bugun + 6), 0),
               'gun30', coalesce(sum(t.remaining_eur_cents) filter (where t.due_date between p_bugun and p_bugun + 29), 0))
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

-- ---------------------------------------------------------------------------
-- 9) Takvim: vadesi gelmemiş yaşlandırma dilimi
-- ---------------------------------------------------------------------------
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
        'yas_90p', coalesce(sum(s.kalan) filter (where s.kalan > 0 and p_bugun - s.due_date > 90), 0),
        -- 0008: vadesi gelmemiş ayrı dilim; eski yas_0_30 (vadesi gelmemiş dahil) önceki sürüm için kalır
        'yas_gelmemis', coalesce(sum(s.kalan) filter (where s.kalan > 0 and s.due_date >= p_bugun), 0),
        'yas_1_30', coalesce(sum(s.kalan) filter (where s.kalan > 0 and p_bugun - s.due_date between 1 and 30), 0))
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

-- ---------------------------------------------------------------------------
-- 10) Hibeler (0005 / 0007 ile aynı)
-- ---------------------------------------------------------------------------
revoke all on function public.rpc_pano_ozeti(date) from public, anon;
revoke all on function public.rpc_firma_detay(uuid) from public, anon;
revoke all on function public.rpc_inceleme() from public, anon;
revoke all on function public.rpc_takvim(text, date, date, date, text[]) from public, anon;
revoke all on function public.rpc_yonetim_ozeti(date) from public, anon;
grant execute on function public.rpc_pano_ozeti(date) to authenticated, service_role;
grant execute on function public.rpc_firma_detay(uuid) to authenticated, service_role;
grant execute on function public.rpc_inceleme() to authenticated, service_role;
grant execute on function public.rpc_takvim(text, date, date, date, text[]) to authenticated, service_role;
grant execute on function public.rpc_yonetim_ozeti(date) to authenticated, service_role;

revoke all on function public.tahsis_surumu(uuid[]) from public, anon, authenticated;
revoke all on function public.rpc_tahsis_girdisi(uuid[]) from public, anon, authenticated;
grant execute on function public.tahsis_surumu(uuid[]) to service_role;
grant execute on function public.rpc_tahsis_girdisi(uuid[]) to service_role;

notify pgrst, 'reload schema';
