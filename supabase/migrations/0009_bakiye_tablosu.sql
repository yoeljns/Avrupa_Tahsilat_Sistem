-- ============================================================================
-- 0009_bakiye_tablosu.sql — BAKİYE TABLOSU (Excel düzeni), VERİ TAZELİĞİ, SORUMLU ATAMA
--
--   * veri_tazeligi(): son yüklemeler, son irsaliye / ödeme tarihi, son hesap.
--     Yalnız TARİH döner; bu yüzden her rol görebilir (pazarlamacı dahil).
--   * rpc_bakiye_verisi(p_side, p_dokum): "Vadeli Bakiyeler" tablosunun verisi —
--     firma × kategori × vade günü toplamları TEK turda. Ekran, Excel ve PDF
--     aynı veriden beslenir. p_dokum = true ise tek tek taksitler de gelir
--     (Excel'in "Taksit Dökümü" sayfası).
--   * rpc_sorumlu_secenekleri(): sorumlu atama ekranının seçenekleri (yönetim).
--   * rpc_sorumlu_ata(...): firmalara sorumlu atar; atama ve denetim kaydı TEK işlemde.
--
-- GERİ UYUM: yalnız YENİ fonksiyonlar; mevcut hiçbir tanım değişmez. Önceki
-- sürüm bu göçten sonra aynen çalışır.
--
-- 0008_duzeltmeler.sql'den SONRA çalıştırın. İdempotenttir.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Veri tazeliği — yalnız tarihler
--    SECURITY DEFINER: import_batches ve recon_runs yönetime özeldir (RLS);
--    pazarlamacı da "veriler en son ne zaman yüklendi" bilgisini görebilmeli.
--    Tarih dışında hiçbir şey döndürmez.
-- ---------------------------------------------------------------------------
create or replace function public.veri_tazeligi()
returns jsonb
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'son_irsaliye_yukleme', (select max(b.committed_at) from public.import_batches b
                             where b.kind = 'irsaliye' and b.status = 'committed'),
    'son_odeme_yukleme', (select max(b.committed_at) from public.import_batches b
                          where b.kind = 'odemeler' and b.status = 'committed'),
    -- 31/12 kayıtları yıl sonu devirleridir; "son irsaliye" sayılmaz
    'son_irsaliye_tarihi', (select max(i.invoice_date) from public.invoices i where not i.is_31_12),
    'son_odeme_tarihi', (select max((p.islem_tarihi at time zone 'Europe/Istanbul')::date) from public.payments p),
    'son_hesap', (select coalesce(k.finished_at, k.started_at) from public.recon_runs k
                  where k.id = (select v.run_id from public.v_current_run v)))
$$;

comment on function public.veri_tazeligi() is
  'Son yüklemeler, son irsaliye/ödeme tarihi ve son hesap — yalnız tarihler (her role açık).';

-- ---------------------------------------------------------------------------
-- 2) Bakiye tablosu verisi
--    SECURITY INVOKER (varsayılan): installments / invoices / firms / firm_balances
--    üzerindeki RLS çağıranın kimliğiyle uygulanır — pazarlamacı yalnız kendi
--    firmalarını alır.
--    hucreler: [firma_sırası, taraf, kategori, vade, borç, kalan, adet, tarihsiz]
--    dokum   : [firma_sırası, taraf, kategori, vade, borç, kalan, fiş_no, irsaliye_tarihi, tarihsiz]
--    (firma_sırası = firmalar dizisindeki sıra; sıkı diziler taşınan veriyi küçültür)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_bakiye_verisi(p_side text default null, p_dokum boolean default false)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  sonuc jsonb;
begin
  if p_side is not null and p_side not in ('PESIN', 'VADELI') then
    raise exception 'rpc_bakiye_verisi: geçersiz taraf %', p_side using errcode = '22023';
  end if;

  with s as (
    select t.id, t.firm_id, t.side, t.seq, t.due_date,
           t.amount_eur_cents as borc,
           t.remaining_eur_cents as kalan,
           t.no_date_flag as tarihsiz,
           coalesce(i.sale_type_override, i.sale_type_auto) as kategori,
           i.fis_no, i.invoice_date
    from public.installments t
    join public.invoices i on i.id = t.invoice_id
    where t.remaining_eur_cents is not null
      and (p_side is null or t.side = p_side)),
  f as (
    select fr.id, fr.code_norm, fr.name,
           nullif(upper(split_part(coalesce(fr.pazarlamaci_email, ''), '@', 1)), '') as sorumlu,
           (row_number() over (order by fr.code_norm, fr.id) - 1)::int as sira
    from public.firms fr
    where fr.id in (select s.firm_id from s)),
  h as (
    select f.sira, s.side, s.kategori, s.due_date,
           sum(s.borc) as borc, sum(s.kalan) as kalan, count(*)::int as adet,
           coalesce(bool_or(s.tarihsiz), false) as tarihsiz
    from s join f on f.id = s.firm_id
    group by f.sira, s.side, s.kategori, s.due_date)
  select jsonb_build_object(
    'run_id', (select v.run_id from public.v_current_run v),
    'tazelik', public.veri_tazeligi(),
    'firmalar', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'kod', f.code_norm, 'ad', f.name, 'sorumlu', f.sorumlu) order by f.sira)
      from f), '[]'::jsonb),
    'hucreler', coalesce((
      select jsonb_agg(jsonb_build_array(h.sira, h.side, h.kategori, h.due_date, h.borc, h.kalan, h.adet, h.tarihsiz)
                       order by h.sira, h.due_date, h.kategori)
      from h), '[]'::jsonb),
    'dokum', case when p_dokum then coalesce((
      select jsonb_agg(jsonb_build_array(f.sira, s.side, s.kategori, s.due_date, s.borc, s.kalan, s.fis_no, s.invoice_date, s.tarihsiz)
                       order by f.sira, s.due_date, s.fis_no, s.seq)
      from s join f on f.id = s.firm_id), '[]'::jsonb) end,
    -- Alacak, firmanın bu tarafta taksiti olmasa da listelenir (Excel "ALACAKLILAR" sayfası)
    'alacaklar', coalesce((
      select jsonb_agg(jsonb_build_object('firm_id', b.firm_id, 'kod', fr.code_norm, 'ad', fr.name,
                                          'sorumlu', nullif(upper(split_part(coalesce(fr.pazarlamaci_email, ''), '@', 1)), ''),
                                          'alacak', b.credit_eur_cents) order by fr.code_norm)
      from public.firm_balances b
      join public.firms fr on fr.id = b.firm_id
      where b.run_id = (select v.run_id from public.v_current_run v) and b.credit_eur_cents > 0), '[]'::jsonb),
    'kategoriler', public.kategori_meta())
  into sonuc;

  return sonuc;
end $$;

comment on function public.rpc_bakiye_verisi(text, boolean) is
  'Bakiye tablosu (Excel düzeni): firma × kategori × vade günü toplamları tek turda; p_dokum ile taksit dökümü.';

-- ---------------------------------------------------------------------------
-- 3) Sorumlu atama seçenekleri (yalnız yönetim)
--    SECURITY DEFINER: profiles tablosunu yalnız yönetici okuyabilir (0005);
--    tahsilat yöneticisi de atama yaparken kullanıcı listesini görebilmeli.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_sorumlu_secenekleri()
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
    'kullanicilar', coalesce((
      select jsonb_agg(jsonb_build_object('email', lower(p.email), 'ad', p.full_name, 'rol', p.role, 'aktif', p.is_active)
                       order by p.is_active desc, lower(p.email))
      from public.profiles p), '[]'::jsonb),
    'kullanilan', coalesce((
      select jsonb_agg(jsonb_build_object('email', x.e, 'firma', x.n) order by x.e)
      from (select lower(btrim(f.pazarlamaci_email)) as e, count(*)::int as n
            from public.firms f
            where coalesce(btrim(f.pazarlamaci_email), '') <> ''
            group by 1) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 4) Sorumlu atama — atama + denetim kaydı TEK işlemde (yalnız servis rolü)
--    p_email boş/NULL → sorumlu kaldırılır. Değeri zaten aynı olan firmalar
--    atlanır (denetim kaydı da yazılmaz). Dönen değer: değişen firma sayısı.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_sorumlu_ata(
  p_firm_ids uuid[],
  p_email text,
  p_actor_id uuid,
  p_actor_email text
)
returns int
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  n int;
begin
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Geçersiz e-posta: %', p_email using errcode = '22023';
  end if;
  if coalesce(cardinality(p_firm_ids), 0) = 0 then
    return 0;
  end if;

  with eski as (
    select f.id, f.code_norm, f.pazarlamaci_email as onceki
    from public.firms f
    where f.id = any (p_firm_ids)
      and coalesce(lower(btrim(f.pazarlamaci_email)), '') <> coalesce(v_email, '')
    for update),
  guncel as (
    update public.firms f
    set pazarlamaci_email = v_email, updated_at = now()
    from eski e
    where f.id = e.id
    returning f.id),
  kayit as (
    insert into public.audit_log (actor_id, actor_email, entity_type, entity_id, action, field, old_value, new_value)
    select p_actor_id, p_actor_email, 'firma', e.code_norm, 'SORUMLU_ATAMA', 'sorumlu',
           to_jsonb(nullif(btrim(coalesce(e.onceki, '')), '')), to_jsonb(v_email)
    from eski e
    returning 1)
  select (select count(*) from guncel)::int into n from (select count(*) from kayit) k;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Hibeler
-- ---------------------------------------------------------------------------
revoke all on function public.veri_tazeligi() from public, anon;
revoke all on function public.rpc_bakiye_verisi(text, boolean) from public, anon;
revoke all on function public.rpc_sorumlu_secenekleri() from public, anon;
grant execute on function public.veri_tazeligi() to authenticated, service_role;
grant execute on function public.rpc_bakiye_verisi(text, boolean) to authenticated, service_role;
grant execute on function public.rpc_sorumlu_secenekleri() to authenticated, service_role;

revoke all on function public.rpc_sorumlu_ata(uuid[], text, uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_sorumlu_ata(uuid[], text, uuid, text) to service_role;

notify pgrst, 'reload schema';
