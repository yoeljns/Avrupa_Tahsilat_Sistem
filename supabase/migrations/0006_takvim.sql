-- ============================================================================
-- 0006_takvim.sql — OKUNAKLI TAKVİM
--
-- rpc_takvim: takvim sayfalarının (Konsinye / Peşin) yeni veri fonksiyonu.
-- rpc_matris_ay ile aynı firma × gün yapısı, ek olarak:
--   * Etkin satış tipine (kategoriye) göre süzülebilir (p_kategoriler).
--   * Firma satırında "gecikmis": BUGÜNE göre vadesi geçmiş kalan (tüm aylar).
--     Böylece "önceki aylar" sütununda yalnız gerçekten gecikmiş kısım
--     kırmızı gösterilebilir (eskiden gösterilen aya göre boyanıyordu).
--   * "kategoriler": tipe göre toplamlar (süzgeç düğmeleri; süzgeçten bağımsız).
--   * "ay_ozet": seçili ayın borç/ödenen/kalan/gecikmiş toplamı.
--   * "aylar": verisi olan aylar + tutarları (ay seçici).
--   * "ozet.yakin_7": önümüzdeki 7 günde vadesi gelen kalan.
--
-- rpc_matris_ay DOKUNULMADAN kalır: canlıdaki önceki sürüm ve /api/tani kullanır.
-- İmza nihaidir (varsayılanlı parametre en sonda); sonraki göçler aynı imzayla
-- yeniden yaratır — aşırı yükleme (overload) oluşmaz.
--
-- 0005_hiz_rls.sql'den SONRA çalıştırın. İdempotenttir.
-- ============================================================================

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
    -- kapsamdaki taksitler (remaining NULL = tahsis kapsamı dışı) + etkin tip
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
      where fa.toplam_kalan > 0 or gj.firm_id is not null), '[]'::jsonb))
  into sonuc;

  return sonuc;
end $$;

revoke all on function public.rpc_takvim(text, date, date, date, text[]) from public, anon;
grant execute on function public.rpc_takvim(text, date, date, date, text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
