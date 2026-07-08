import Link from 'next/link'
import { eur, trDate } from '@/lib/format'
import type { OpenInstallmentRow } from '@/lib/queries'

// Takvim matrisi: satır = firma, sütun = ay içindeki vade günleri.
// En solda 'Devreden/Gecikmiş' (ay öncesinden kalan), en sağda 'Sonraki aylar'
// ve satır toplamı — böylece satır toplamı firmanın TÜM açık borcunu verir.

interface MonthMatrixProps {
  rows: OpenInstallmentRow[]
  month: string // 'YYYY-MM'
}

interface FirmAgg {
  firmId: string
  firmCode: string
  firmName: string
  before: number
  after: number
  byDate: Map<string, number>
  hasNoDate: boolean
  total: number
}

export default function MonthMatrix({ rows, month }: MonthMatrixProps) {
  const monthStart = month + '-01'
  const monthEndExclusive = month + '-99' // sözlük sırası karşılaştırması için yeterli

  const dates = Array.from(
    new Set(rows.filter((r) => r.due_date >= monthStart && r.due_date < monthEndExclusive).map((r) => r.due_date)),
  ).sort()

  const firms = new Map<string, FirmAgg>()
  for (const r of rows) {
    let f = firms.get(r.firm_id)
    if (!f) {
      f = {
        firmId: r.firm_id,
        firmCode: r.firm_code,
        firmName: r.firm_name,
        before: 0,
        after: 0,
        byDate: new Map(),
        hasNoDate: false,
        total: 0,
      }
      firms.set(r.firm_id, f)
    }
    f.total += r.remaining_eur_cents
    if (r.no_date_flag) f.hasNoDate = true
    if (r.due_date < monthStart) f.before += r.remaining_eur_cents
    else if (r.due_date >= monthEndExclusive) f.after += r.remaining_eur_cents
    else f.byDate.set(r.due_date, (f.byDate.get(r.due_date) ?? 0) + r.remaining_eur_cents)
  }

  const firmList = Array.from(firms.values()).sort((a, b) => (a.firmCode < b.firmCode ? -1 : 1))

  const colTotals = new Map<string, number>()
  let beforeTotal = 0
  let afterTotal = 0
  let grandTotal = 0
  for (const f of firmList) {
    beforeTotal += f.before
    afterTotal += f.after
    grandTotal += f.total
    for (const [d, v] of f.byDate) colTotals.set(d, (colTotals.get(d) ?? 0) + v)
  }

  if (firmList.length === 0) {
    return <p className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">Bu görünümde açık borç yok.</p>
  }

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Firma</th>
            <th className="px-3 py-2 text-right">Devreden / Gecikmiş</th>
            {dates.map((d) => (
              <th key={d} className="px-3 py-2 text-right whitespace-nowrap">
                {trDate(d).slice(0, 5)}
              </th>
            ))}
            <th className="px-3 py-2 text-right">Sonraki Aylar</th>
            <th className="px-3 py-2 text-right">Toplam</th>
          </tr>
        </thead>
        <tbody>
          {firmList.map((f) => (
            <tr key={f.firmId} className="border-b border-slate-100 hover:bg-blue-50/40">
              <td className="sticky left-0 z-10 bg-white px-3 py-2">
                <Link href={`/firmalar/${f.firmId}`} className="font-medium text-blue-700 hover:underline">
                  {f.firmCode}
                </Link>
                <span className="ml-2 text-slate-500">{f.firmName.slice(0, 28)}</span>
                {f.hasNoDate && (
                  <span title="Bazı taksitlerde vade tarihi girilmedi (irsaliye tarihi kullanıldı)" className="ml-1 text-amber-500">
                    †
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-red-600">{f.before > 0 ? eur(f.before) : ''}</td>
              {dates.map((d) => {
                const v = f.byDate.get(d)
                return (
                  <td key={d} className="px-3 py-2 text-right tabular-nums">
                    {v ? eur(v) : ''}
                  </td>
                )
              })}
              <td className="px-3 py-2 text-right tabular-nums text-slate-400">{f.after > 0 ? eur(f.after) : ''}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{eur(f.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Toplam</td>
            <td className="px-3 py-2 text-right tabular-nums text-red-600">{beforeTotal > 0 ? eur(beforeTotal) : ''}</td>
            {dates.map((d) => (
              <td key={d} className="px-3 py-2 text-right tabular-nums">
                {eur(colTotals.get(d) ?? 0)}
              </td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums text-slate-500">{afterTotal > 0 ? eur(afterTotal) : ''}</td>
            <td className="px-3 py-2 text-right tabular-nums">{eur(grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
