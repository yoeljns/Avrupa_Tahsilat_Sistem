'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'

// Kısa bildirimler (kendiliğinden kaybolur). Geniş ekranda sağ üstte — alttaki yapışkan
// eylem çubuklarını (ör. Tanıma Kuralları "Etkiyi önizle") örtmesin; dar ekranda altta.
// (app)/layout içinde sağlanır.

type Ton = 'basari' | 'hata' | 'bilgi'
interface Bildirim {
  id: number
  mesaj: string
  ton: Ton
}
type Goster = (mesaj: string, ton?: Ton) => void

const Baglam = createContext<Goster>(() => undefined)

const IKON: Record<Ton, ReactNode> = {
  basari: <CircleCheck className="h-5 w-5 text-emerald-500" />,
  hata: <CircleAlert className="h-5 w-5 text-red-500" />,
  bilgi: <Info className="h-5 w-5 text-blue-500" />,
}

let sayac = 0

export function ToastSaglayici({ children }: { children: ReactNode }) {
  const [liste, setListe] = useState<Bildirim[]>([])
  const kaldir = useCallback((id: number) => setListe((l) => l.filter((b) => b.id !== id)), [])
  const goster = useCallback<Goster>(
    (mesaj, ton = 'basari') => {
      const id = ++sayac
      setListe((l) => [...l.slice(-3), { id, mesaj, ton }])
      setTimeout(() => kaldir(id), ton === 'hata' ? 8000 : 4500)
    },
    [kaldir],
  )
  return (
    <Baglam.Provider value={goster}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 sm:top-[4.5rem] sm:bottom-auto print:hidden">
        {liste.map((b) => (
          <div key={b.id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-xl bg-white p-3 text-sm text-slate-700 shadow-lg ring-1 ring-slate-200">
            <span className="mt-0.5 shrink-0">{IKON[b.ton]}</span>
            <p className="min-w-0 flex-1 break-words">{b.mesaj}</p>
            <button type="button" onClick={() => kaldir(b.id)} className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Kapat">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Baglam.Provider>
  )
}

export function useToast(): Goster {
  return useContext(Baglam)
}
