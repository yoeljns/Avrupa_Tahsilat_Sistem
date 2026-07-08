import Link from 'next/link'
import { eur, trDate } from '@/lib/format'
import { allFirms, balancesAtRun, currentRunId, excludedCodeSet } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function FirmalarPage() {
  const supabase = await createServerSupabase()
  const [firms, runId, excluded] = await Promise.all([allFirms(supabase), currentRunId(supabase), excludedCodeSet(supabase)])
  const balances = runId ? await balancesAtRun(supabase, runId) : []

  const byFirm = new Map<string, { pesin: number; vadeli: number; credit: number; nextDue: string | null }>()
  for (const b of balances) {
    byFirm.set(b.firm_id, {
      pesin: b.pesin_open_eur_cents,
      vadeli: b.vadeli_open_eur_cents,
      credit: b.credit_eur_cents,
      nextDue: b.next_due_date,
    })
  }

  const visibleFirms = firms.filter((f) => !excluded.has(f.code_norm))

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">Firmalar</h1>
      <p className="mt-1 text-sm text-slate-500">{visibleFirms.length} firma (takip dışı bırakılanlar gösterilmez)</p>

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
              <th className="px-3 py-2 text-right">Alacak</th>
              <th className="px-3 py-2 text-right">İlk Vade</th>
            </tr>
          </thead>
          <tbody>
            {visibleFirms.map((f) => {
              const b = byFirm.get(f.id)
              return (
                <tr key={f.id} className="border-b border-slate-100 hover:bg-blue-50/40">
                  <td className="px-3 py-2">
                    <Link href={`/firmalar/${f.id}`} className="font-medium text-blue-700 hover:underline">
                      {f.code_norm}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {f.name}
                    {f.is_auto_created && (
                      <span className="ml-1 rounded bg-slate-100 px-1 text-xs text-slate-500" title="Bayi listesinde olmayan, içe aktarmada otomatik oluşturulan firma">
                        oto
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{f.city ?? ''}</td>
                  <td className="px-3 py-2 text-slate-500">{f.pazarlamaci_email?.split('@')[0] ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b?.pesin ? eur(b.pesin) : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b?.vadeli ? eur(b.vadeli) : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{b?.credit ? eur(b.credit) : ''}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{b?.nextDue ? trDate(b.nextDue) : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
