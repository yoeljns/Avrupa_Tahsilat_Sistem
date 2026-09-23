'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { eur, trDate } from '@/lib/format'
import type { Sutun, SutunHucresi, TakvimFirmaSatiri } from '@/lib/takvim'
import { DURUM_ETIKET, DURUM_NOKTA } from './durum'

export interface SeciliHucre {
  firma: TakvimFirmaSatiri
  sutun: Sutun
  hucre: SutunHucresi
  /** tıklanan hücrenin ekran konumu */
  x: number
  y: number
}

const GENISLIK = 288

/** Hücreye tıklayınca açılan küçük ayrıntı kutusu: Borç · Ödeme · Kalan. */
export default function HucreDetayi({ secim, onKapat }: { secim: SeciliHucre; onKapat: () => void }) {
  useEffect(() => {
    const tus = (e: KeyboardEvent) => e.key === 'Escape' && onKapat()
    window.addEventListener('keydown', tus)
    return () => window.removeEventListener('keydown', tus)
  }, [onKapat])

  const { firma, sutun, hucre } = secim
  const sol = Math.max(8, Math.min(secim.x, (typeof window !== 'undefined' ? window.innerWidth : 1024) - GENISLIK - 8))
  const altaSigar = typeof window === 'undefined' || secim.y + 230 < window.innerHeight
  const tarihMetni =
    hucre.tarihler.length === 1 ? trDate(hucre.tarihler[0]) : `${sutun.baslik} · ${hucre.tarihler.map((d) => d.slice(8, 10)).join(', ')}. günler`

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onKapat} aria-hidden="true" />
      <div
        role="dialog"
        aria-label={`${firma.kod} vade ayrıntısı`}
        className="fixed z-50 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-xl"
        style={{ left: sol, width: GENISLIK, ...(altaSigar ? { top: secim.y + 8 } : { bottom: window.innerHeight - secim.y + 44 }) }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">{firma.kod}</p>
            <p className="truncate text-xs text-slate-500" title={firma.ad}>
              {firma.ad}
            </p>
          </div>
          <button onClick={onKapat} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Kapat">
            ✕
          </button>
        </div>
        <p className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <span className={'inline-block h-2 w-2 rounded-full ' + DURUM_NOKTA[hucre.durum]} />
          {tarihMetni} — {DURUM_ETIKET[hucre.durum]}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-y-1 tabular-nums">
          <dt className="text-slate-500">Borç</dt>
          <dd className="text-right">{eur(hucre.borc)}</dd>
          <dt className="text-slate-500">Ödeme</dt>
          <dd className="text-right text-emerald-700">{eur(hucre.odeme)}</dd>
          <dt className="font-medium text-slate-700">Kalan</dt>
          <dd className="text-right font-semibold">{eur(hucre.kalan)}</dd>
          {hucre.gecikmis > 0 && hucre.gecikmis !== hucre.kalan && (
            <>
              <dt className="text-red-600">Gecikmiş kısım</dt>
              <dd className="text-right text-red-600">{eur(hucre.gecikmis)}</dd>
            </>
          )}
        </dl>
        <Link
          href={`/firmalar/${firma.firm_id}#taksitler`}
          className="mt-3 block rounded-lg bg-slate-100 px-3 py-1.5 text-center text-xs font-medium text-slate-700 hover:bg-slate-200"
        >
          Firma kartında taksitleri gör →
        </Link>
      </div>
    </>
  )
}
