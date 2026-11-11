import { sade } from '@/lib/takvim'

// FİRMA ARAMA — üst çubuktaki arama kutusunun eşleştirme ve sıralama kuralı (saf).
// Liste bir kez yüklenir (GET /api/firmalar/kisa); arama tarayıcıda yapılır.

export interface KisaFirma {
  id: string
  kod: string
  ad: string
  sehir: string | null
}

/** Aramaya hazırlanmış firma: arama anahtarlarıyla (bkz. `anahtar`) */
export interface AranabilirFirma extends KisaFirma {
  _kod: string
  _ad: string
  _sozcukler: string[]
  _hepsi: string
}

const TR = new Intl.Collator('tr')

/** Arama anahtarı: Türkçe harf, büyük/küçük, boşluk VE noktalama duyarsız ('Öz-Güven' → 'OZGUVEN') */
const anahtar = (s: string): string => sade(s).replace(/[^A-Z0-9]/g, '')

export function aramayaHazirla(liste: KisaFirma[]): AranabilirFirma[] {
  return liste.map((f) => ({
    ...f,
    _kod: anahtar(f.kod),
    _ad: anahtar(f.ad),
    _sozcukler: f.ad.split(/[\s.\-/&,]+/).map(anahtar).filter(Boolean),
    _hepsi: anahtar(`${f.kod} ${f.ad} ${f.sehir ?? ''}`),
  }))
}

/**
 * Sorguya uyan firmalar, en ilgiliden başlayarak (en çok `sinir` tane).
 *  - Eşleşme: sorgunun HER sözcüğü kod + ad + şehir içinde geçmeli ("34 boya", "cagpas", "34k02").
 *  - Sıra: kodu sorguyla başlayan → adı sorguyla başlayan → adındaki bir sözcük sorguyla
 *    başlayan → diğerleri; eşitlikte ada göre.
 */
export function firmaAra(liste: AranabilirFirma[], sorgu: string, sinir = 8): AranabilirFirma[] {
  const butun = anahtar(sorgu)
  if (!butun) return []
  const parcalar = sorgu.split(/\s+/).map(anahtar).filter(Boolean)
  const puan = (f: AranabilirFirma): number => {
    if (f._kod.startsWith(butun)) return 0
    if (f._ad.startsWith(butun)) return 1
    if (f._sozcukler.some((s) => s.startsWith(parcalar[0]))) return 2
    return 3
  }
  return liste
    .filter((f) => f._hepsi.includes(butun) || parcalar.every((p) => f._hepsi.includes(p)))
    .map((f) => ({ f, p: puan(f) }))
    .sort((a, b) => a.p - b.p || TR.compare(a.f.ad, b.f.ad) || TR.compare(a.f.kod, b.f.kod))
    .slice(0, sinir)
    .map((x) => x.f)
}
