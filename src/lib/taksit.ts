import { parseEurToCents } from '@/lib/engine/money'

// ELLE TAKSİT — irsaliye düzenleme penceresindeki canlı toplam ve "Eşit böl" (saf).

/**
 * Tutarı `adet` taksite eşit böler (kuruş). Bölünmeyen kuruşlar İLK taksitlere birer
 * birer eklenir; toplam her zaman tutara eşittir. Örn. 100,00 € / 3 → 33,34 · 33,33 · 33,33.
 */
export function esitBol(toplamKurus: number, adet: number): number[] {
  if (!Number.isInteger(adet) || adet <= 0 || !Number.isInteger(toplamKurus) || toplamKurus < 0) return []
  const taban = Math.floor(toplamKurus / adet)
  const artan = toplamKurus - taban * adet
  return Array.from({ length: adet }, (_, i) => taban + (i < artan ? 1 : 0))
}

export interface TaksitOzeti {
  /** okunabilen tutarların toplamı (kuruş) */
  toplam: number
  /** toplam − irsaliye tutarı; irsaliye tutarı bilinmiyorsa null. 0 = tutuyor */
  fark: number | null
  /** tutarı okunamayan (boş, harfli, eksi) taksit sayısı */
  okunamayan: number
  /** tarihi girilmemiş taksit sayısı */
  tarihsiz: number
  /** Kaydedilebilir mi: en az bir taksit, hepsi okunur ve tarihli, fark 0 */
  gecerli: boolean
}

/** Taksit taslaklarının (ekrandaki metinler) özeti; sunucudaki doğrulamanın aynısı. */
export function taksitOzeti(taslaklar: ReadonlyArray<{ dueDate: string; amountEur: string }>, irsaliyeKurus: number | null): TaksitOzeti {
  let toplam = 0
  let okunamayan = 0
  let tarihsiz = 0
  for (const t of taslaklar) {
    const k = parseEurToCents(t.amountEur)
    if (k === null || k < 0) okunamayan++
    else toplam += k
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate)) tarihsiz++
  }
  const fark = irsaliyeKurus === null ? null : toplam - irsaliyeKurus
  return { toplam, fark, okunamayan, tarihsiz, gecerli: taslaklar.length > 0 && okunamayan === 0 && tarihsiz === 0 && fark === 0 }
}
