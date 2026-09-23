'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

// Erişilebilir pencere: Escape ile kapanır, odak pencerede kalır (Tab döngüsü),
// açılınca ilk alan odaklanır, kapanınca odak geri döner, arka plan kaymaz.

const GENISLIK = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const

interface Props {
  acik: boolean
  onKapat: () => void
  baslik: ReactNode
  aciklama?: ReactNode
  children: ReactNode
  altBilgi?: ReactNode
  genislik?: keyof typeof GENISLIK
  /** işlem sürerken kapatmayı engelle */
  kapatilamaz?: boolean
}

const ODAKLANABILIR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ acik, onKapat, baslik, aciklama, children, altBilgi, genislik = 'md', kapatilamaz = false }: Props) {
  const baslikId = useId()
  const panel = useRef<HTMLDivElement>(null)
  // Üst bileşen her çizimde yeni işlev verse de etki yeniden çalışmasın (odak sıçramasın)
  const kapat = useRef(onKapat)
  const kilit = useRef(kapatilamaz)
  kapat.current = onKapat
  kilit.current = kapatilamaz

  useEffect(() => {
    if (!acik) return
    const onceki = document.activeElement as HTMLElement | null
    const ilk = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>('input, select, textarea')
    ;(ilk ?? panel.current)?.focus()

    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !kilit.current) {
        e.stopPropagation()
        kapat.current()
        return
      }
      if (e.key === 'Tab' && panel.current) {
        const ogeler = Array.from(panel.current.querySelectorAll<HTMLElement>(ODAKLANABILIR))
        if (ogeler.length === 0) return
        const ilkOge = ogeler[0]
        const sonOge = ogeler[ogeler.length - 1]
        if (e.shiftKey && document.activeElement === ilkOge) {
          e.preventDefault()
          sonOge.focus()
        } else if (!e.shiftKey && document.activeElement === sonOge) {
          e.preventDefault()
          ilkOge.focus()
        }
      }
    }
    document.addEventListener('keydown', tus)
    const eskiTasma = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', tus)
      document.body.style.overflow = eskiTasma
      onceki?.focus?.()
    }
  }, [acik])

  if (!acik) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={() => !kapatilamaz && onKapat()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={baslikId}
        tabIndex={-1}
        className={'relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white text-left shadow-xl ring-1 ring-slate-200 focus:outline-none ' + GENISLIK[genislik]}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h2 id={baslikId} className="text-base font-semibold text-slate-900">
              {baslik}
            </h2>
            {aciklama && <p className="mt-0.5 text-sm text-slate-500">{aciklama}</p>}
          </div>
          {!kapatilamaz && (
            <button type="button" onClick={onKapat} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Kapat">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {altBilgi && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-3">{altBilgi}</div>}
      </div>
    </div>
  )
}
