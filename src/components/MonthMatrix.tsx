import { Fragment } from 'react'
import Link from 'next/link'
import { eur, trDate } from '@/lib/format'
import type { MatrisFirma } from '@/lib/queries'

// Takvim matrisi — kullanıcının referans Excel tablosuyla aynı düzen:
// satır = firma; her vade günü için ÜÇ alt sütun: BORÇ | ÖDEME | KALAN.
// Solda SORUMLU (pazarlamacı) ve firma; sağda Devreden/Gecikmiş (ay öncesi kalan),
// Sonraki Aylar (ay sonrası kalan) ve firma TOPLAM borç/ödenen/kalan sütunları.
//
// Veri veritabanında önceden toplanır (rpc_matris_ay): bileşene binlerce
// taksit değil, yalnız seçili ayın günleri ve firma toplamları gelir.

interface MonthMatrixProps {
  firmalar: MatrisFirma[]
}

interface DateAgg {
  borc: number
  odeme: number
  kalan: number
}

export default function MonthMatrix({ firmalar }: MonthMatrixProps) {
  const dates = Array.from(new Set(firmalar.flatMap((f) => Object.keys(f.gunler)))).sort()

  const colTotals = new Map<string, DateAgg>()
  let beforeTotal = 0
  let afterTotal = 0
  let grandBorc = 0
  let grandOdeme = 0
  let grandKalan = 0
  for (const f of firmalar) {
    beforeTotal += f.once_kalan
    afterTotal += f.sonra_kalan
    grandBorc += f.toplam_borc
    grandOdeme += f.toplam_odeme
    grandKalan += f.toplam_kalan
    for (const [d, [borc, odeme, kalan]] of Object.entries(f.gunler)) {
      let t = colTotals.get(d)
      if (!t) colTotals.set(d, (t = { borc: 0, odeme: 0, kalan: 0 }))
      t.borc += borc
      t.odeme += odeme
      t.kalan += kalan
    }
  }

  if (firmalar.length === 0) {
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
          {firmalar.map((f) => (
            <tr key={f.firm_id} className="border-b border-slate-100 hover:bg-blue-50/40">
              <td className="sticky left-0 z-10 bg-white px-2 py-1.5 text-slate-500">{f.sorumlu ?? ''}</td>
              <td className="sticky left-[70px] z-10 bg-white px-2 py-1.5 whitespace-nowrap">
                <Link href={`/firmalar/${f.firm_id}`} className="font-medium text-blue-700 hover:underline">
                  {f.kod}
                </Link>
                <span className="ml-1 text-slate-500">{f.ad.slice(0, 20)}</span>
                {f.tarihsiz && (
                  <span title="Bazı taksitlerde vade tarihi girilmedi (irsaliye tarihi kullanıldı)" className="ml-1 text-amber-500">
                    †
                  </span>
                )}
              </td>
              <td className="border-l border-slate-200 px-2 py-1.5 text-right">{num(f.once_kalan, 'text-red-600 font-medium')}</td>
              {dates.map((d) => {
                const v = f.gunler[d]
                return (
                  <Fragment key={d}>
                    <td className="border-l border-slate-200 px-2 py-1.5 text-right">{v ? num(v[0]) : ''}</td>
                    <td className="px-2 py-1.5 text-right">{v ? num(v[1], 'text-emerald-600') : ''}</td>
                    <td className="px-2 py-1.5 text-right">{v ? num(v[2], v[2] > 0 ? 'font-medium' : '') : ''}</td>
                  </Fragment>
                )
              })}
              <td className="border-l border-slate-200 px-2 py-1.5 text-right">{num(f.sonra_kalan, 'text-slate-400')}</td>
              <td className="border-l border-slate-200 px-2 py-1.5 text-right">{num(f.toplam_borc)}</td>
              <td className="px-2 py-1.5 text-right">{num(f.toplam_odeme, 'text-emerald-600')}</td>
              <td className="px-2 py-1.5 text-right font-semibold">{num(f.toplam_kalan)}</td>
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
