import ImportPanel from '@/components/ImportPanel'
import { requireRole } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function BayilerPage() {
  await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()

  const firms = await fetchAll<{ pazarlamaci_email: string | null }>((from, to) =>
    supabase.from('firms').select('pazarlamaci_email').order('id').range(from, to),
  )
  const byEmail = new Map<string, number>()
  let unassigned = 0
  for (const f of firms) {
    if (f.pazarlamaci_email) byEmail.set(f.pazarlamaci_email, (byEmail.get(f.pazarlamaci_email) ?? 0) + 1)
    else unassigned++
  }

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">Bayi Listesi</h1>
      <p className="mt-1 text-sm text-slate-500">
        Firma adları, şehirler ve <strong>pazarlamacı atamaları</strong> bu dosyadan gelir. Pazarlamacılar panelde
        yalnız kendilerine atanmış firmaları görür.
      </p>

      <div className="mt-4 max-w-2xl">
        <ImportPanel
          kind="bayiler"
          title="Bayi Listesi (.xlsx)"
          description="Sütunlar: logo_kodu, bayi_adi, segment, sehir, telefon, pazarlamaci_email. Kod eşleşen firmalar güncellenir, yeniler eklenir; hiçbir firma silinmez."
          accept=".xlsx,.xls"
        />
      </div>

      <h2 className="mt-8 font-semibold text-slate-900">Pazarlamacı Dağılımı</h2>
      <div className="mt-2 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Pazarlamacı</th>
              <th className="px-3 py-2 text-right">Firma Sayısı</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(byEmail.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([email, count]) => (
                <tr key={email} className="border-b border-slate-100">
                  <td className="px-3 py-2">{email}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{count}</td>
                </tr>
              ))}
            <tr>
              <td className="px-3 py-2 text-slate-500">Atanmamış</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-500">{unassigned}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
