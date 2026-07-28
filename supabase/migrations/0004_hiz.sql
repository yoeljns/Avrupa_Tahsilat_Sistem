-- ============================================================================
-- 0004_hiz.sql — Sayfa geçişlerini yavaşlatan AĞ TURLARINI azaltır.
--
-- Ölçüm/inceleme (konsinye → peşin geçişi):
--   1 middleware auth.getUser()          → Auth sunucusuna tur
--   2 layout requireUser()               → getUser + profiles  (2 tur)
--   3 sayfa getSessionProfile()          → getUser + profiles  (2 tur, MÜKERRER)
--   4 currentRunId()                     → 1 tur
--   5 scopeInstallments()                → 1000'lik sayfalama: N ARDIŞIK tur
--   6 pazarlamaciByFirm() → allFirms()   → M tur
-- Toplam ~10 tur; uygulama iad1'de, veritabanı uzaktaysa her tur 100 ms+.
--
-- Bu dosya 3, 4, 5 ve 6'yı TEK tura indiren iki fonksiyon ekler.
-- Veri kapsamı DEĞİŞMEZ: fonksiyonlar SECURITY INVOKER'dır; RLS aynen işler
-- (pazarlamacı yalnız kendi firmalarını görmeye devam eder).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Oturum profili: auth.getUser() (Auth sunucusu) + profiles select yerine TEK tur.
-- SECURITY DEFINER: yalnız çağıranın kendi satırını döndürür (auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.rpc_oturum_profilim()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when p.id is null or not p.is_active then null else jsonb_build_object(
    'userId', p.id,
    'email', p.email,
    'fullName', p.full_name,
    'role', p.role) end
  from public.profiles p
  where p.id = auth.uid()
$$;

comment on function public.rpc_oturum_profilim() is
  'Oturumdaki kullanıcının kendi profili — tek ağ turu (auth.getUser + profiles yerine).';

revoke all on function public.rpc_oturum_profilim() from public, anon;
grant execute on function public.rpc_oturum_profilim() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Matris sayfası verisi (konsinye / peşin): run_id + taksitler + sorumlu eşlemesi
-- TEK çağrıda. Eskiden 1 + N(sayfalama) + M(firmalar) tur atılıyordu.
--
-- SECURITY INVOKER (varsayılan): v_installments_scope ve firms üzerindeki RLS
-- çağıranın kimliğiyle uygulanır — pazarlamacı kapsamı aynen korunur.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_matris_verisi(p_side text)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_run uuid;
begin
  if p_side is not null and p_side not in ('PESIN', 'VADELI') then
    raise exception 'Geçersiz taraf: % (PESIN | VADELI)', p_side;
  end if;

  select r.run_id into v_run from public.v_current_run r;

  return jsonb_build_object(
    'run_id', v_run,
    'rows', case when v_run is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'installment_id', s.installment_id,
        'invoice_id', s.invoice_id,
        'firm_id', s.firm_id,
        'firm_code', s.firm_code,
        'firm_name', s.firm_name,
        'side', s.side,
        'seq', s.seq,
        'due_date', s.due_date,
        'invoice_date', s.invoice_date,
        'fis_no', s.fis_no,
        'amount_eur_cents', s.amount_eur_cents,
        'remaining_eur_cents', s.remaining_eur_cents,
        'paid_eur_cents', s.paid_eur_cents,
        'no_date_flag', s.no_date_flag,
        'source', s.source)
        order by s.due_date, s.firm_code, s.installment_id)
      from public.v_installments_scope s
      where p_side is null or s.side = p_side), '[]'::jsonb) end,
    'sorumlu', coalesce((
      select jsonb_object_agg(f.id::text, upper(split_part(f.pazarlamaci_email, '@', 1)))
      from public.firms f
      where f.pazarlamaci_email is not null and f.pazarlamaci_email <> ''), '{}'::jsonb));
end $$;

comment on function public.rpc_matris_verisi(text) is
  'Konsinye/Peşin matris sayfasının TÜM verisi tek turda (run + taksitler + sorumlu).';

revoke all on function public.rpc_matris_verisi(text) from public, anon;
grant execute on function public.rpc_matris_verisi(text) to authenticated, service_role;
