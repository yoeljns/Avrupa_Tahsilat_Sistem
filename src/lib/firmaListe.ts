import type { FirmaListeSatiri } from '@/lib/queries'
import { sade } from '@/lib/takvim'

// FİRMALAR LİSTESİ — arama, süzme, sıralama ve toplamlar (saf yardımcılar).
// Liste tek ağ turunda gelir (rpc_firma_listesi); gerisi tarayıcıda yapılır.

export type FirmaSiralamaAlani = 'kod' | 'ad' | 'sehir' | 'sorumlu' | 'pesin' | 'vadeli' | 'toplam' | 'gecikmis' | 'alacak' | 'ilk_vade'
export type SiralamaYonu = 'artan' | 'azalan'

export interface FirmaSiralama {
  alan: FirmaSiralamaAlani
  yon: SiralamaYonu
}

export const VARSAYILAN_FIRMA_SIRALAMASI: FirmaSiralama = { alan: 'kod', yon: 'artan' }

/** hepsi · açık borcu olan · vadesi geçmiş borcu olan · alacağı olan · borcu ve alacağı olmayan */
export type FirmaDurumu = 'hepsi' | 'borclu' | 'gecikmis' | 'alacakli' | 'temiz'

export const FIRMA_DURUM_ETIKETLERI: Record<FirmaDurumu, string> = {
  hepsi: 'Tüm firmalar',
  borclu: 'Borcu olanlar',
  gecikmis: 'Vadesi geçmiş borcu olanlar',
  alacakli: 'Alacağı olanlar',
  temiz: 'Borcu ve alacağı olmayanlar',
}

export interface FirmaSuzgeci {
  arama: string
  durum: FirmaDurumu
  /** '' = hepsi · 'ERCAN' = o sorumlu · '-' = sorumlusu olmayanlar */
  sorumlu: string
}

export const BOS_FIRMA_SUZGECI: FirmaSuzgeci = { arama: '', durum: 'hepsi', sorumlu: '' }
export const SORUMLUSUZ_FIRMA = '-'

const TR = new Intl.Collator('tr')

/** Tablolardaki sorumlu adı: e-postanın @ öncesi, büyük harf ('ercan' → 'ERCAN'); yoksa null */
export function firmaSorumlusu(f: Pick<FirmaListeSatiri, 'sorumlu'>): string | null {
  const s = (f.sorumlu ?? '').trim()
  return s ? s.toUpperCase() : null
}

export const firmaToplamBorcu = (f: Pick<FirmaListeSatiri, 'pesin' | 'vadeli'>): number => f.pesin + f.vadeli

export function firmalariSuz(liste: FirmaListeSatiri[], s: FirmaSuzgeci): FirmaListeSatiri[] {
  const aranan = sade(s.arama)
  return liste.filter((f) => {
    if (aranan && !sade(`${f.kod} ${f.ad} ${f.sehir ?? ''}`).includes(aranan)) return false
    if (s.sorumlu) {
      const kim = firmaSorumlusu(f)
      if (s.sorumlu === SORUMLUSUZ_FIRMA ? kim !== null : kim !== s.sorumlu) return false
    }
    switch (s.durum) {
      case 'borclu':
        return firmaToplamBorcu(f) > 0
      case 'gecikmis':
        return f.gecikmis > 0
      case 'alacakli':
        return f.alacak > 0
      case 'temiz':
        return firmaToplamBorcu(f) === 0 && f.alacak === 0
      default:
        return true
    }
  })
}

/** Metin sütunları artan, tutar sütunları azalan (en büyük üstte), ilk vade artan (en yakın üstte) başlar. */
export function varsayilanYon(alan: FirmaSiralamaAlani): SiralamaYonu {
  return alan === 'kod' || alan === 'ad' || alan === 'sehir' || alan === 'sorumlu' || alan === 'ilk_vade' ? 'artan' : 'azalan'
}

/** Başlığa tıklama: aynı sütunsa yön çevrilir, başka sütunsa o sütunun varsayılan yönüyle başlar. */
export function siralamaDegistir(mevcut: FirmaSiralama, alan: FirmaSiralamaAlani): FirmaSiralama {
  if (mevcut.alan === alan) return { alan, yon: mevcut.yon === 'artan' ? 'azalan' : 'artan' }
  return { alan, yon: varsayilanYon(alan) }
}

/** Sıralar (yeni dizi). Boş değerler (şehir, sorumlu, ilk vade) yön ne olursa olsun sonda kalır; eşitlikte kod sırası. */
export function firmalariSirala(liste: FirmaListeSatiri[], s: FirmaSiralama): FirmaListeSatiri[] {
  const carpan = s.yon === 'artan' ? 1 : -1
  const metin = (a: string | null, b: string | null): number => {
    if (!a || !b) return a ? -1 : b ? 1 : 0 // boşlar sonda (yönden bağımsız)
    return carpan * TR.compare(a, b)
  }
  const sayi = (a: number, b: number): number => carpan * (a - b)
  const karsilastir = (a: FirmaListeSatiri, b: FirmaListeSatiri): number => {
    switch (s.alan) {
      case 'kod':
        return carpan * TR.compare(a.kod, b.kod)
      case 'ad':
        return carpan * TR.compare(a.ad, b.ad)
      case 'sehir':
        return metin(a.sehir, b.sehir)
      case 'sorumlu':
        return metin(firmaSorumlusu(a), firmaSorumlusu(b))
      case 'ilk_vade':
        return metin(a.ilk_vade, b.ilk_vade)
      case 'toplam':
        return sayi(firmaToplamBorcu(a), firmaToplamBorcu(b))
      default:
        return sayi(a[s.alan], b[s.alan])
    }
  }
  return liste.slice().sort((a, b) => karsilastir(a, b) || TR.compare(a.kod, b.kod))
}

export interface FirmaToplami {
  firma: number
  pesin: number
  vadeli: number
  toplam: number
  gecikmis: number
  alacak: number
  borclu: number
  geciken: number
  alacakli: number
}

export function firmaToplami(liste: FirmaListeSatiri[]): FirmaToplami {
  const t: FirmaToplami = { firma: liste.length, pesin: 0, vadeli: 0, toplam: 0, gecikmis: 0, alacak: 0, borclu: 0, geciken: 0, alacakli: 0 }
  for (const f of liste) {
    t.pesin += f.pesin
    t.vadeli += f.vadeli
    t.gecikmis += f.gecikmis
    t.alacak += f.alacak
    if (firmaToplamBorcu(f) > 0) t.borclu++
    if (f.gecikmis > 0) t.geciken++
    if (f.alacak > 0) t.alacakli++
  }
  t.toplam = t.pesin + t.vadeli
  return t
}

/** Listedeki sorumlular (süzgeç için), Türkçe sırada; `sorumlusuzVar`: sorumlusu olmayan firma var mı */
export function firmaSorumlulari(liste: FirmaListeSatiri[]): { sorumlular: string[]; sorumlusuzVar: boolean } {
  const ad = new Set<string>()
  let sorumlusuzVar = false
  for (const f of liste) {
    const s = firmaSorumlusu(f)
    if (s) ad.add(s)
    else sorumlusuzVar = true
  }
  return { sorumlular: Array.from(ad).sort(TR.compare), sorumlusuzVar }
}
