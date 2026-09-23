import Link from 'next/link'
import { kategoriBul, type KategoriMeta } from '@/lib/kategoriMeta'
import { renkOf } from '@/lib/renkler'
import { eurKisa } from '@/lib/takvim'

interface Props {
  yol: string
  ay: string
  kategoriler: Array<{ kod: string; kalan: number; gecikmis: number }>
  secili: string | null
  etiket: (kod: string) => string
  /** Yönetim panelindeki kategori ayarları (renk, sıra, "sayfada süzgeç") */
  meta?: readonly KategoriMeta[]
}

/**
 * Sayfadaki satış kategorileri: "Tümü · Konsinye · Konsinye Peşin …". Yalnız
 * panelde "süzgeç düğmesi" açık olanlar gösterilir; 2+ düğme yoksa hiç çıkmaz.
 */
export default function KategoriSuzgeci({ yol, ay, kategoriler, secili, etiket, meta }: Props) {
  const gorunen = kategoriler
    .filter((k) => k.kod === secili || (kategoriBul(meta, k.kod)?.sayfada_suzgec ?? true))
    .slice()
    .sort((a, b) => (kategoriBul(meta, a.kod)?.sira ?? 999) - (kategoriBul(meta, b.kod)?.sira ?? 999) || a.kod.localeCompare(b.kod))
  if (gorunen.length < 2 && !secili) return null
  const cip = (aktif: boolean) =>
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ' +
    (aktif ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50')
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden" aria-label="Satış kategorisi süzgeci">
      <Link href={`${yol}?ay=${ay}`} className={cip(!secili)}>
        Tümü
      </Link>
      {gorunen.map((k) => {
        const aktif = secili === k.kod
        return (
          <Link key={k.kod} href={`${yol}?ay=${ay}&kategori=${encodeURIComponent(k.kod)}`} className={cip(aktif)}>
            <span className={'h-2 w-2 rounded-full ' + (aktif ? 'bg-white' : renkOf(kategoriBul(meta, k.kod)?.renk).nokta)} aria-hidden="true" />
            {etiket(k.kod)}
            <span className={'text-xs tabular-nums ' + (aktif ? 'text-blue-100' : 'text-slate-400')}>{eurKisa(k.kalan)}</span>
            {k.gecikmis > 0 && (
              <span className={'text-xs tabular-nums ' + (aktif ? 'text-red-100' : 'text-red-500')} title="Bugün itibarıyla vadesi geçmiş">
                ({eurKisa(k.gecikmis)} gecikmiş)
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}
