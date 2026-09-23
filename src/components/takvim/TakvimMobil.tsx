'use client'

import type { MouseEvent } from 'react'
import Link from 'next/link'
import { eurTam, sutunHucresi, type Sutun, type SutunHucresi, type TakvimFirmaSatiri } from '@/lib/takvim'
import { DURUM_HUCRE } from './durum'
import type { SeciliHucre } from './HucreDetayi'

interface Props {
  satirlar: TakvimFirmaSatiri[]
  sutunlar: Sutun[]
  bugun: string
  onSec: (s: SeciliHucre) => void
}

/** Dar ekran: her firma bir kart; ayın vadeleri renkli çipler. */
export default function TakvimMobil({ satirlar, sutunlar, bugun, onSec }: Props) {
  const sec = (e: MouseEvent<HTMLButtonElement>, f: TakvimFirmaSatiri, s: Sutun, h: SutunHucresi) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSec({ firma: f, sutun: s, hucre: h, x: r.left, y: r.bottom })
  }
  return (
    <ul className="space-y-3">
      {satirlar.map((f) => {
        const hucreler = sutunlar.flatMap((s) => {
          const h = sutunHucresi(f.gunler, s, bugun)
          return h ? [{ s, h }] : []
        })
        return (
          <li key={f.firm_id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/firmalar/${f.firm_id}`} className="font-semibold text-blue-700">
                  {f.kod}
                </Link>
                {f.tarihsiz && <span className="ml-1 text-amber-500">†</span>}
                <p className="truncate text-sm text-slate-600">{f.ad}</p>
                {f.sorumlu && <p className="text-[11px] font-medium text-slate-400">{f.sorumlu}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-slate-900">{eurTam(f.toplam_kalan)}</p>
                {f.gecikmis > 0 && <p className="text-xs font-medium tabular-nums text-red-600">{eurTam(f.gecikmis)} gecikmiş</p>}
              </div>
            </div>
            {hucreler.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hucreler.map(({ s, h }) => (
                  <button
                    key={s.anahtar}
                    type="button"
                    onClick={(e) => sec(e, f, s, h)}
                    className={'rounded-lg px-2 py-1 text-xs tabular-nums ' + DURUM_HUCRE[h.durum]}
                  >
                    <span className="font-medium">{s.baslik}</span> · {h.durum === 'odendi' ? '✓' : eurTam(h.kalan)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">Bu ay vade yok</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
