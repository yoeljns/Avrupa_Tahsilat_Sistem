-- ============================================================================
-- 0010_rapor.sql — TAHSİLAT DURUM RAPORU VERİSİ
--
--   * rpc_rapor_verisi(p_bugun): PDF raporun bütün verisi TEK turda —
--       bakiye   : rpc_bakiye_verisi(null, false)  (iki taraf; firma × kategori × vade)
--       tahsilat : güncel hesabın tahsisleri, firma × ödeme AYI toplamı
--                  [firma_id, 'YYYY-AA' | null, tutar, ayın son ödeme günü]
--       pano     : rpc_pano_ozeti(p_bugun)
--       yonetim  : rpc_yonetim_ozeti(p_bugun)  (yönetim dışındaki rollere null)
--
--   TAHSİLAT TANIMI: ödemenin BORCA İŞLENEN kısmı, ödeme tarihine göre
--   (Türkiye günü). Fazla ödeme (alacak) tahsis değildir; bu yüzden
--     Σ tahsilat + Σ alacak = Pano'daki "Toplam Tahsilat"
--   eşitliği geçerlidir. Tahsise girmeyen kayıtlar (ALC, tamamlanmamış,
--   eşleşmeyen KDV, EUR'suz ödemeler, takip dışı firmalar) burada da yoktur.
--
--   SECURITY INVOKER: tahsisler, ödemeler ve taksitler üzerindeki RLS çağıranın
--   kimliğiyle uygulanır — pazarlamacının raporu yalnız kendi firmalarını içerir.
--
-- GERİ UYUM: yalnız YENİ fonksiyon; mevcut hiçbir tanım değişmez.
-- 0009_bakiye_tablosu.sql'den SONRA çalıştırın. İdempotenttir.
-- ============================================================================

create or replace function public.rpc_rapor_verisi(p_bugun date)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'bakiye', public.rpc_bakiye_verisi(null, false),
    'tahsilat', coalesce((
      select jsonb_agg(jsonb_build_array(x.firm_id, x.ay, x.tutar, x.son_gun) order by x.firm_id, x.ay)
      from (
        select a.firm_id,
               to_char((p.islem_tarihi at time zone 'Europe/Istanbul')::date, 'YYYY-MM') as ay,
               sum(a.amount_eur_cents)::bigint as tutar,
               max((p.islem_tarihi at time zone 'Europe/Istanbul')::date) as son_gun
        from public.allocations a
        join public.payments p on p.id = a.payment_id
        where a.run_id = (select v.run_id from public.v_current_run v)
        group by 1, 2) x), '[]'::jsonb),
    'pano', public.rpc_pano_ozeti(p_bugun),
    'yonetim', public.rpc_yonetim_ozeti(p_bugun))
$$;

comment on function public.rpc_rapor_verisi(date) is
  'Tahsilat Durum Raporu verisi: bakiye hücreleri, firma × ay tahsilat, pano ve (yönetime) veri sağlığı — tek turda.';

revoke all on function public.rpc_rapor_verisi(date) from public, anon;
grant execute on function public.rpc_rapor_verisi(date) to authenticated, service_role;

notify pgrst, 'reload schema';
