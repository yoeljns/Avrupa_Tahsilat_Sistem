import { Fragment } from 'react'
import Link from 'next/link'
import { eur, trDate } from '@/lib/format'
import type { ScopeInstallmentRow } from '@/lib/queries'

// Takvim matrisi — kullanıcının referans Excel tablosuyla aynı düzen:
// satır = firma; her vade günü için ÜÇ alt sütun: BORÇ | ÖDEME | KALAN.
// Solda SORUMLU (pazarlamacı) ve firma; sağda Devreden/Gecikmiş (ay öncesi kalan),
// Sonraki Aylar (ay sonrası kalan) ve firma TOPLAM borç/ödenen/kalan sütunları.

interface MonthMatrixProps {
  rows: ScopeInstallmentRow[]
  month: string // 'YYYY-MM'
  sorumluByFirm?: Map<string, string>
}

interface DateAgg {
  borc: number
  odeme: number
  kalan: number
}

interface FirmAgg {
  firmId: string
  firmCode: string
  firmName: string
  beforeKalan: number
  afterKalan: number
  byDate: Map<string, DateAgg>
  hasNoDate: boolean
  totalBorc: number
  totalOdeme: number
  totalKalan: number
}

function addTo(agg: DateAgg, r: ScopeInstallmentRow) {
  agg.borc += r.amount_eur_cents
  agg.odeme += r.paid_eur_cents
  agg.kalan += r.remaining_eur_cents
}

export default function MonthMatrix({ rows, month, sorumluByFirm }: MonthMatrixProps) {
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
        beforeKalan: 0,
        afterKalan: 0,
        byDate: new Map(),
        hasNoDate: false,
        totalBorc: 0,
        totalOdeme: 0,
        totalKalan: 0,
      }
      firms.set(r.firm_id, f)
    }
    f.totalBorc += r.amount_eur_cents
    f.totalOdeme += r.paid_eur_cents
    f.totalKalan += r.remaining_eur_cents
    if (r.no_date_flag && r.remaining_eur_cents > 0) f.hasNoDate = true
    if (r.due_date < monthStart) f.beforeKalan += r.remaining_eur_cents
    else if (r.due_date >= monthEndExclusive) f.afterKalan += r.remaining_eur_cents
    else {
      let agg = f.byDate.get(r.due_date)
      if (!agg) f.byDate.set(r.due_date, (agg = { borc: 0, odeme: 0, kalan: 0 }))
      addTo(agg, r)
    }
  }

  // Bu ay hiç hareketi olmayan ve kalanı da olmayan firmaları gizle
  const firmList = Array.from(firms.values())
    .filter((f) => f.totalKalan > 0 || f.byDate.size > 0)
    .sort((a, b) => (a.firmCode < b.firmCode ? -1 : 1))

  const colTotals = new Map<string, DateAgg>()
  let beforeTotal = 0
  let afterTotal = 0
  let grandBorc = 0
  let grandOdeme = 0
  let grandKalan = 0
  for (const f of firmList) {
    beforeTotal += f.beforeKalan
    afterTotal += f.afterKalan
    grandBorc += f.totalBorc
    grandOdeme += f.totalOdeme
    grandKalan += f.totalKalan
    for (const [d, v] of f.byDate) {
      let t = colTotals.get(d)
      if (!t) colTotals.set(d, (t = { borc: 0, odeme: 0, kalan: 0 }))
      t.borc += v.borc
      t.odeme += v.odeme
      t.kalan += v.kalan
    }
  }

  if (firmList.length === 0) {
    return <p className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">Bu görünümde borç hareketi yok.</p>
  }

  const num = (v: number, cls = '') =>
    v !== 0 ? <span className={'tabular-nums ' + cls}>{eur(v)}</span> : <span className="text-slate-300">–</span>

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
      <table className="w-full min-w-max border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-300 bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600">
            <th className="sticky left-0 z-10 bg-slate-100 px-2 py-2" rowSpan={2}>
              Sorumlu
            </th>
            <th className="sticky left-[70px] z-10 bg-slate-100 px-2 py-2" rowSpan={2}>
              Firma
            </th>
            <th className="border-l border-slate-200 px-2 py-1 text-right" rowSpan={2}>
              Devreden /<br />Gecikmiş
            </th>
            {dates.map((d) => (
              <th key={d} colSpan={3} className="border-l border-slate-300 px-2 py-1 text-center whitespace-nowrap">
                {trDate(d)}
              </th>
            ))}
            <th className="border-l border-slate-300 px-2 py-1 text-right" rowSpan={2}>
              Sonraki<br />Aylar
            </th>
            <th className="border-l border-slate-300 px-2 py-1 text-right" rowSpan={2}>
              Toplam<br />Borç
            </th>
            <th className="px-2 py-1 text-right" rowSpan={2}>
              Toplam<br />Ödenen
            </th>
            <th className="px-2 py-1 text-right" rowSpan={2}>
              Kalan<br />Borç
            </th>
          </tr>
          <tr className="border-b border-slate-300 bg-slate-50 text-[10px] uppercase text-slate-500">
            {dates.map((d) => (
              <Fragment key={d}>
                <th className="border-l border-slate-300 px-2 py-1 text-right">Borç</th>
                <th className="px-2 py-1 text-right">Ödeme</th>
                <th className="px-2 py-1 text-right">Kalan</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {firmList.map((f) => (
            <tr key={f.firmId} className="border-b border-slate-100 hover:bg-blue-50/40">
              <td className="sticky left-0 z-10 bg-white px-2 py-1.5 text-slate-500">
                {sorumluByFirm?.get(f.firmId) ?? ''}
              </td>
              <td className="sticky left-[70px] z-10 bg-white px-2 py-1.5 whitespace-nowrap">
                <Link href={`/firmalar/${f.firmId}`} className="font-medium text-blue-700 hover:underline">
                  {f.firmCode}
                </Link>
                <span className="ml-1 text-slate-500">{f.firmName.slice(0, 20)}</span>
                {f.hasNoDate && (
                  <span title="Bazı taksitlerde vade tarihi girilmedi (irsaliye tarihi kullanıldı)" className="ml-1 text-amber-500">
                    †
                  </span>
                )}
              </td>
              <td className="border-l border-slate-200 px-2 py-1.5 text-right">{num(f.beforeKalan, 'text-red-600 font-medium')}</td>
              {dates.map((d) => {
                const v = f.byDate.get(d)
                return (
                  <Fragment key={d}>
                    <td className="border-l border-slate-200 px-2 py-1.5 text-right">{v ? num(v.borc) : ''}</td>
                    <td className="px-2 py-1.5 text-right">{v ? num(v.odeme, 'text-emerald-600') : ''}</td>
                    <td className="px-2 py-1.5 text-right">{v ? num(v.kalan, v.kalan > 0 ? 'font-medium' : '') : ''}</td>
                  </Fragment>
                )
              })}
              <td className="border-l border-slate-200 px-2 py-1.5 text-right">{num(f.afterKalan, 'text-slate-400')}</td>
              <td className="border-l border-slate-200 px-2 py-1.5 text-right">{num(f.totalBorc)}</td>
              <td className="px-2 py-1.5 text-right">{num(f.totalOdeme, 'text-emerald-600')}</td>
              <td className="px-2 py-1.5 text-right font-semibold">{num(f.totalKalan)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <td className="sticky left-0 z-10 bg-slate-50 px-2 py-2" colSpan={2}>
              TOPLAM
            </td>
            <td className="border-l border-slate-200 px-2 py-2 text-right">{num(beforeTotal, 'text-red-600')}</td>
            {dates.map((d) => {
              const t = colTotals.get(d)
              return (
                <Fragment key={d}>
                  <td className="border-l border-slate-200 px-2 py-2 text-right">{num(t?.borc ?? 0)}</td>
                  <td className="px-2 py-2 text-right">{num(t?.odeme ?? 0, 'text-emerald-600')}</td>
                  <td className="px-2 py-2 text-right">{num(t?.kalan ?? 0)}</td>
                </Fragment>
              )
            })}
            <td className="border-l border-slate-200 px-2 py-2 text-right">{num(afterTotal, 'text-slate-500')}</td>
            <td className="border-l border-slate-200 px-2 py-2 text-right">{num(grandBorc)}</td>
            <td className="px-2 py-2 text-right">{num(grandOdeme, 'text-emerald-600')}</td>
            <td className="px-2 py-2 text-right">{num(grandKalan)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
