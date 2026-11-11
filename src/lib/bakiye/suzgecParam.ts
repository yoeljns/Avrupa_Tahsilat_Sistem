import { BOS_BAKIYE_SUZGEC, SORUMLUSUZ, type BakiyeSuzgec } from '@/lib/bakiye/model'
import { sade } from '@/lib/takvim'

// Bakiye tablosu süzgeci ↔ adres parametreleri.
// Ekrandaki "Excel'e aktar" düğmesi ile indirme ucu aynı adları kullanır:
//   sorumlu=ERCAN | sorumlu=-   q=karsel   acik=1 (borcu bitenler hariç)   gecikmis=1

type Parametreler = URLSearchParams | Record<string, string | string[] | undefined>

function oku(p: Parametreler, ad: string): string {
  const v = p instanceof URLSearchParams ? p.get(ad) : p[ad]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

export function suzgecOku(p: Parametreler): BakiyeSuzgec {
  return {
    arama: oku(p, 'q').trim().slice(0, 100),
    sorumlu: oku(p, 'sorumlu').trim().slice(0, 100),
    yalnizGecikmis: oku(p, 'gecikmis') === '1',
    bitenleriGizle: oku(p, 'acik') === '1',
  }
}

/** Süzgecin sorgu metni ('' ya da '?sorumlu=…&q=…') */
export function suzgecSorgusu(s: BakiyeSuzgec = BOS_BAKIYE_SUZGEC): string {
  const p = new URLSearchParams()
  if (s.sorumlu) p.set('sorumlu', s.sorumlu)
  if (s.arama.trim()) p.set('q', s.arama.trim())
  if (s.bitenleriGizle) p.set('acik', '1')
  if (s.yalnizGecikmis) p.set('gecikmis', '1')
  const q = p.toString()
  return q ? `?${q}` : ''
}

/** İndirilen dosyanın adı: vadeli_bakiyeler[_SORUMLU]_YYYY-AA-GG.xlsx (yalnız ASCII) */
export function vadeliBakiyelerDosyaAdi(bugun: string, s: BakiyeSuzgec = BOS_BAKIYE_SUZGEC): string {
  const kim = s.sorumlu === SORUMLUSUZ ? 'SORUMLUSUZ' : sade(s.sorumlu).replace(/[^A-Z0-9]/g, '').slice(0, 30)
  return `vadeli_bakiyeler_${kim ? kim + '_' : ''}${bugun}.xlsx`
}
