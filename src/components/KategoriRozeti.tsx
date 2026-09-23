import { DAVRANISLAR, SINIFSIZ_KOD, davranisOf, kategoriBul, kategoriEtiketi, type KategoriMeta } from '@/lib/kategoriMeta'
import { renkOf } from '@/lib/renkler'

// Satış kategorisi rozeti: panelde seçilen renk ve adla. Hesaba katılmayan
// kategoriler soluk, "Sınıflandırılmadı" kesik kenarlı görünür.

export default function KategoriRozeti({
  kod,
  meta,
  kisa = false,
  className = '',
}: {
  kod: string | null | undefined
  meta?: readonly KategoriMeta[]
  kisa?: boolean
  className?: string
}) {
  if (!kod) return <span className="text-slate-400">—</span>
  const k = kategoriBul(meta, kod)
  const renk = renkOf(k?.renk ?? 'gri')
  const ad = k ? (kisa && k.kisa_ad ? k.kisa_ad : k.ad) : kategoriEtiketi(meta, kod)
  const sinifsiz = kod === SINIFSIZ_KOD
  const hesapDisi = !!k && k.taraf === null && !sinifsiz
  const baslik = k ? `${k.ad} — ${sinifsiz ? 'kategorisi belirlenmedi, borç hesabına girmez' : DAVRANISLAR[davranisOf(k.taraf)].ad}` : kod
  return (
    <span
      title={baslik}
      className={
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ' +
        renk.rozet +
        (sinifsiz ? ' border border-dashed border-slate-400' : '') +
        (hesapDisi ? ' opacity-75' : '') +
        (className ? ' ' + className : '')
      }
    >
      {ad}
    </span>
  )
}
