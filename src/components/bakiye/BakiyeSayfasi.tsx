import Link from 'next/link'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import OzetSeridi, { type OzetOgesi } from '@/components/takvim/OzetSeridi'
import { getSessionProfile, isStaffRole } from '@/lib/auth'
import { bakiyeModeliKur } from '@/lib/bakiye/model'
import { eur, todayISO, trDate, trDateTime } from '@/lib/format'
import { kategoriEtiketi } from '@/lib/kategoriMeta'
import { bakiyeVerisi, type BakiyeVerisi } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'
import BakiyeTablosu from './BakiyeTablosu'

// Konsinye → "Bakiye tablosu": bütün ayların vadeli/peşin borç, ödeme ve kalan tablosu.
// Veri TEK ağ turunda gelir (rpc_bakiye_verisi, RLS: pazarlamacı yalnız kendi
// firmaları); süzme, sıralama ve ay açma tarayıcıda yapılır. Excel çıktısı aynı
// modelden üretilir (/api/export/vadeli-bakiyeler).
export default async function BakiyeSayfasi() {
  const session = (await getSessionProfile())!
  const staff = isStaffRole(session.role)
  const supabase = await createServerSupabase()
  const bugun = todayISO()

  let veri: BakiyeVerisi
  try {
    veri = await bakiyeVerisi(supabase, 'VADELI')
  } catch (e) {
    // 0009 henüz uygulanmamışsa (fonksiyon yok) kurulum uyarısı gösterilir
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }

  const model = bakiyeModeliKur(veri, bugun)
  const t = model.toplam
  const tz = veri.tazelik
  const kategoriAdlari: Record<string, string> = {}
  for (const ay of model.aylar) for (const s of ay.borcSutunlari) kategoriAdlari[s.kategori] = kategoriEtiketi(veri.kategoriler, s.kategori)
  const alacakToplami = veri.alacaklar.reduce((a, x) => a + x.alacak, 0)

  const ogeler: OzetOgesi[] = [
    { baslik: 'Toplam satış', deger: eur(t.borc), alt: `${model.satirlar.length} firma` },
    { baslik: 'Ödemeler', deger: eur(t.odeme), ton: 'yesil', alt: t.borc > 0 ? `satışın %${Math.round((t.odeme / t.borc) * 100)}'i` : undefined },
    { baslik: 'Kalan borç', deger: eur(t.kalan), alt: 'tüm aylar' },
    { baslik: 'Gecikmiş (bugün itibarıyla)', deger: eur(t.gecikmis), ton: t.gecikmis > 0 ? 'kirmizi' : 'normal' },
    { baslik: 'Bu aya kadar kalan', deger: eur(t.birikimli), ton: t.birikimli > 0 ? 'amber' : 'normal', alt: 'bu ay dahil' },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Konsinye / Konsinye Peşin — Bakiye tablosu</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Her vade ayı için vadeli ve peşin borç, ödeme ve kalan. Borcu tamamen kapanmış geçmiş aylar kapalı gelir. &quot;Excel&apos;e aktar&quot; aynı
            tabloyu renkleri, formülleri ve gizli aylarıyla dosyaya indirir.
          </p>
        </div>
        {tz && (
          <p className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200/70 print:shadow-none print:ring-0">
            Son irsaliye <strong className="font-semibold text-slate-800">{trDate(tz.son_irsaliye_tarihi)}</strong> · Son ödeme{' '}
            <strong className="font-semibold text-slate-800">{trDate(tz.son_odeme_tarihi)}</strong>
            <span className="block text-slate-400">Son hesap {trDateTime(tz.son_hesap)}</span>
          </p>
        )}
      </div>

      <div className="print:hidden">
        <OzetSeridi ogeler={ogeler} />
      </div>

      <div className="mt-4">
        <BakiyeTablosu model={model} kategoriAdlari={kategoriAdlari} sorumluSuzgeci={staff} />
      </div>

      {veri.alacaklar.length > 0 && (
        <details className="mt-4 rounded-xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200/70 print:hidden">
          <summary className="cursor-pointer font-semibold text-slate-800">
            Alacaklı firmalar ({veri.alacaklar.length}) <span className="font-normal text-slate-500">· toplam {eur(alacakToplami)} fazla ödeme</span>
          </summary>
          <p className="mt-1 text-xs text-slate-500">Ödemesi borcundan fazla olan firmalar. Excel dosyasında &quot;ALACAKLILAR&quot; sayfasındadır.</p>
          <ul className="mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {veri.alacaklar.map((a) => (
              <li key={a.firm_id} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1">
                <span className="min-w-0 truncate">
                  <Link href={`/firmalar/${a.firm_id}`} className="font-semibold text-blue-700 hover:underline">
                    {a.kod}
                  </Link>{' '}
                  <span className="text-slate-700" title={a.ad}>
                    {a.ad}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-red-600">{eur(a.alacak)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
