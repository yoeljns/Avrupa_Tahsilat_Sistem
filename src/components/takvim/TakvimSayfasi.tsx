import Link from 'next/link'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import StatCard from '@/components/StatCard'
import { getSessionProfile, isStaffRole } from '@/lib/auth'
import { SALE_TYPE_LABELS, eur, monthOf, todayISO, trMonth } from '@/lib/format'
import { takvim, type TakvimVerisi } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'
import AySecici from './AySecici'
import KategoriSuzgeci from './KategoriSuzgeci'
import OzetSeridi, { type OzetOgesi } from './OzetSeridi'
import VadeTakvimi from './VadeTakvimi'

interface Props {
  taraf: 'PESIN' | 'VADELI'
  /** sayfa adresi: '/konsinye' ya da '/pesin' */
  yol: string
  baslik: string
  aciklama: string
  arama: { ay?: string; kategori?: string }
}

// Konsinye ve Peşin takvim sayfalarının ortak iskeleti. Veri TEK ağ turunda
// gelir (rpc_takvim); görünüm, sütun, arama ve sıralama tarayıcıda değişir.
export default async function TakvimSayfasi({ taraf, yol, baslik, aciklama, arama }: Props) {
  const session = (await getSessionProfile())!
  const staff = isStaffRole(session.role)
  const supabase = await createServerSupabase()
  const bugun = todayISO()
  const buAy = monthOf(bugun)
  const ay = /^\d{4}-(0[1-9]|1[0-2])$/.test(arama.ay ?? '') ? arama.ay! : buAy
  const kategori = /^[A-Z][A-Z0-9_]{1,29}$/.test(arama.kategori ?? '') ? arama.kategori! : null

  let veri: TakvimVerisi
  try {
    veri = await takvim(supabase, taraf, ay, kategori, bugun)
  } catch (e) {
    // 0006 henüz uygulanmamışsa (fonksiyon yok) kurulum uyarısı gösterilir
    if (isMissingRelationError(e) || (/rpc_takvim/.test(String(e)) && /Could not find|does not exist|PGRST202/.test(String(e)))) {
      return <MigrationNeeded />
    }
    throw e
  }
  const o = veri.ozet
  const ao = veri.ay_ozet
  const etiket = (kod: string) => SALE_TYPE_LABELS[kod] ?? kod
  const ayAdi = trMonth(ay)

  const ogeler: OzetOgesi[] =
    taraf === 'VADELI'
      ? [
          { baslik: `${ayAdi} vadesi gelen`, deger: eur(ao?.borc ?? 0), alt: `${eur(ao?.odeme ?? 0)} ödendi` },
          {
            baslik: `${ayAdi} kalan`,
            deger: eur(ao?.kalan ?? 0),
            ton: (ao?.gecikmis ?? 0) > 0 ? 'kirmizi' : 'normal',
            alt: (ao?.gecikmis ?? 0) > 0 ? `${eur(ao!.gecikmis)} vadesi geçti` : 'vadesi geçen yok',
          },
          { baslik: 'Gecikmiş (bugün itibarıyla)', deger: eur(o?.gecikmis ?? 0), ton: (o?.gecikmis ?? 0) > 0 ? 'kirmizi' : 'normal', alt: 'tüm aylar' },
          { baslik: '7 gün içinde vadesi gelen', deger: eur(o?.yakin_7 ?? 0), ton: (o?.yakin_7 ?? 0) > 0 ? 'amber' : 'normal', alt: 'bugün dahil' },
          { baslik: 'Toplam kalan', deger: eur(o?.toplam_kalan ?? 0), alt: `${eur(o?.toplam_odenen ?? 0)} ödendi` },
        ]
      : [
          { baslik: `${ayAdi} irsaliyeleri`, deger: eur(ao?.borc ?? 0), alt: `${eur(ao?.odeme ?? 0)} ödendi` },
          { baslik: `${ayAdi} kalan`, deger: eur(ao?.kalan ?? 0), ton: (ao?.kalan ?? 0) > 0 ? 'amber' : 'normal' },
          { baslik: 'Toplam kalan', deger: eur(o?.toplam_kalan ?? 0), ton: (o?.toplam_kalan ?? 0) > 0 ? 'kirmizi' : 'normal', alt: 'tüm aylar' },
          { baslik: 'Toplam ödenen', deger: eur(o?.toplam_odenen ?? 0), ton: 'yesil' },
        ]

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold text-slate-900">
            {baslik}
            {kategori && (
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">yalnız {etiket(kategori)}</span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{aciklama}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {staff && (
            <a
              href="/api/export/borclar"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 print:hidden"
              title="Konsinye ve Peşin takvimleri, borç listeleri ve bakiyeler — Excel düzeninde"
            >
              Excel İndir
            </a>
          )}
          <AySecici yol={yol} ay={ay} buAy={buAy} aylar={veri.aylar} kategori={kategori} />
        </div>
      </div>

      <OzetSeridi ogeler={ogeler} />

      {taraf === 'PESIN' && (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard title="0-30 Gün" value={eur(o?.yas_0_30 ?? 0)} />
          <StatCard title="31-60 Gün" value={eur(o?.yas_31_60 ?? 0)} tone={(o?.yas_31_60 ?? 0) > 0 ? 'amber' : 'default'} />
          <StatCard title="61-90 Gün" value={eur(o?.yas_61_90 ?? 0)} tone={(o?.yas_61_90 ?? 0) > 0 ? 'amber' : 'default'} />
          <StatCard title="90+ Gün" value={eur(o?.yas_90p ?? 0)} tone={(o?.yas_90p ?? 0) > 0 ? 'red' : 'default'} />
        </div>
      )}

      {(o?.tarihsiz_adet ?? 0) > 0 && (
        <p className="mt-3 text-sm text-amber-700">
          <span className="text-amber-500">†</span> {o!.tarihsiz_adet} taksitte vade tarihi girilmedi; irsaliye tarihi kullanıldı.{' '}
          {staff && (
            <Link href="/inceleme?sekme=tarihsiz" className="font-medium underline hover:text-amber-900">
              Tamamla →
            </Link>
          )}
        </p>
      )}

      <KategoriSuzgeci yol={yol} ay={ay} kategoriler={veri.kategoriler} secili={kategori} etiket={etiket} />

      <div className="mt-4">
        <VadeTakvimi
          firmalar={veri.firmalar}
          ay={ay}
          bugun={bugun}
          taraf={taraf}
          varsayilanSutun={taraf === 'PESIN' ? 'hafta' : 'gun'}
          sorumluSuzgeci={staff}
        />
      </div>
    </div>
  )
}
