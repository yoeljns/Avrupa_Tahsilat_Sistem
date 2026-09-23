'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { addMonths, trMonth } from '@/lib/format'
import { eurKisa } from '@/lib/takvim'

interface Props {
  /** '/konsinye' ya da '/pesin' */
  yol: string
  ay: string
  buAy: string
  aylar: Array<{ ay: string; kalan: number }>
  kategori: string | null
}

/** ←/→, verisi olan aylar listesi (kalanlarıyla) ve "Bu ay". Kategori süzgeci korunur. */
export default function AySecici({ yol, ay, buAy, aylar, kategori }: Props) {
  const router = useRouter()
  const href = (a: string) => `${yol}?ay=${a}${kategori ? `&kategori=${encodeURIComponent(kategori)}` : ''}`
  const kalanOf = new Map(aylar.map((a) => [a.ay, a.kalan]))
  const secenekler = Array.from(new Set([...aylar.map((a) => a.ay), ay, buAy])).sort()

  return (
    <nav className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 text-sm print:hidden" aria-label="Ay seçimi">
      <Link href={href(addMonths(ay, -1))} prefetch className="rounded px-2 py-1 hover:bg-slate-100" aria-label="Önceki ay">
        ←
      </Link>
      <select
        value={ay}
        onChange={(e) => router.push(href(e.target.value))}
        className="max-w-[15rem] cursor-pointer rounded bg-transparent px-1 py-1 font-medium text-slate-900 focus:outline-none"
        aria-label="Ay"
      >
        {secenekler.map((a) => {
          const k = kalanOf.get(a) ?? 0
          return (
            <option key={a} value={a}>
              {trMonth(a)}
              {k > 0 ? ` — ${eurKisa(k)} kalan` : ''}
            </option>
          )
        })}
      </select>
      <Link href={href(addMonths(ay, 1))} prefetch className="rounded px-2 py-1 hover:bg-slate-100" aria-label="Sonraki ay">
        →
      </Link>
      {ay !== buAy && (
        <Link href={href(buAy)} className="ml-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">
          Bu ay
        </Link>
      )}
    </nav>
  )
}
