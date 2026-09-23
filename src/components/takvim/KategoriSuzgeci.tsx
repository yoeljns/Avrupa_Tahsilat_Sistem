import Link from 'next/link'
import { eurKisa } from '@/lib/takvim'

interface Props {
  yol: string
  ay: string
  kategoriler: Array<{ kod: string; kalan: number; gecikmis: number }>
  secili: string | null
  etiket: (kod: string) => string
}

/** Sayfadaki satış tipleri: "Tümü · Konsinye · Konsinye Peşin …" (2+ tip varsa). */
export default function KategoriSuzgeci({ yol, ay, kategoriler, secili, etiket }: Props) {
  if (kategoriler.length < 2 && !secili) return null
  const cip = (aktif: boolean) =>
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ' +
    (aktif ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50')
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden" aria-label="Satış tipi süzgeci">
      <Link href={`${yol}?ay=${ay}`} className={cip(!secili)}>
        Tümü
      </Link>
      {kategoriler.map((k) => (
        <Link key={k.kod} href={`${yol}?ay=${ay}&kategori=${encodeURIComponent(k.kod)}`} className={cip(secili === k.kod)}>
          {etiket(k.kod)}
          <span className={'text-xs tabular-nums ' + (secili === k.kod ? 'text-blue-100' : 'text-slate-400')}>{eurKisa(k.kalan)}</span>
        </Link>
      ))}
    </div>
  )
}
