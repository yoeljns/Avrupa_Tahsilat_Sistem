import Link from 'next/link'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import { eur, trDate } from '@/lib/format'
import { firmaListesi, type FirmaListeSatiri } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function FirmalarPage() {
  const supabase = await createServerSupabase()

  // TEK ağ turu: firmalar + bakiyeler + canlı gecikme (takip dışılar veritabanında elenir)
  let firmalar: FirmaListeSatiri[]
  try {
    firmalar = await firmaListesi(supabase)
  } catch (e) {
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">Firmalar</h1>
      <p className="mt-1 text-sm text-slate-500">{firmalar.length} firma (takip dışı bırakılanlar gösterilmez)</p>

      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Kod</th>
              <th className="px-3 py-2">Firma</th>
              <th className="px-3 py-2">Şehir</th>
              <th className="px-3 py-2">Pazarlamacı</th>
              <th className="px-3 py-2 text-right">Peşin Borç</th>
              <th className="px-3 py-2 text-right">Konsinye Borç</th>
              <th className="px-3 py-2 text-right">Vadesi Geçmiş</th>
              <th className="px-3 py-2 text-right">Alacak</th>
              <th className="px-3 py-2 text-right">İlk Vade</th>
            </tr>
          </thead>
          <tbody>
            {firmalar.map((f) => (
              <tr key={f.id} className="border-b border-slate-100 hover:bg-blue-50/40">
                <td className="px-3 py-2">
                  <Link href={`/firmalar/${f.id}`} className="font-medium text-blue-700 hover:underline">
                    {f.kod}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {f.ad}
                  {f.oto && (
                    <span className="ml-1 rounded bg-slate-100 px-1 text-xs text-slate-500" title="Bayi listesinde olmayan, içe aktarmada otomatik oluşturulan firma">
                      oto
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{f.sehir ?? ''}</td>
                <td className="px-3 py-2 text-slate-500">{f.sorumlu ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.pesin ? eur(f.pesin) : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.vadeli ? eur(f.vadeli) : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-600">{f.gecikmis ? eur(f.gecikmis) : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{f.alacak ? eur(f.alacak) : ''}</td>
                <td className="px-3 py-2 text-right text-slate-500">{f.ilk_vade ? trDate(f.ilk_vade) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
