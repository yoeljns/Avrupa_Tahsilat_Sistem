import type { VeriTazeligi } from '@/lib/queries'

// VERİ TAZELİĞİ — "veriler ne kadar eski?" (saf). Pano uyarısı ve PDF raporun
// ilk sayfasındaki uyarı aynı eşiği kullanır.

/** Son ödeme kaydı bu kadar günden eskiyse veriler "eski" sayılır */
export const ESKI_VERI_GUNU = 7

const GUN = 86_400_000
const gunSayisi = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / GUN

export interface TazelikDurumu {
  /** son ödeme kaydından bugüne gün; ödeme kaydı yoksa null */
  odemeYasi: number | null
  /** son irsaliyeden bugüne gün; irsaliye yoksa null */
  irsaliyeYasi: number | null
  /** uyarı gösterilmeli mi: ödeme kaydı yok ya da eşikten eski */
  eski: boolean
}

/** Tazelik bilgisi hiç yoksa (fonksiyon kurulmamış) null: uyarı gösterilmez. */
export function tazelikDurumu(t: VeriTazeligi | null | undefined, bugun: string, esik = ESKI_VERI_GUNU): TazelikDurumu | null {
  if (!t) return null
  const yas = (iso: string | null): number | null => (iso ? Math.round(gunSayisi(bugun) - gunSayisi(iso)) : null)
  const odemeYasi = yas(t.son_odeme_tarihi)
  return { odemeYasi, irsaliyeYasi: yas(t.son_irsaliye_tarihi), eski: odemeYasi === null || odemeYasi > esik }
}
