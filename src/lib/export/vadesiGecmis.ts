// Firma başına BUGÜNE göre vadesi geçmiş konsinye kalanı — ekranlarla aynı tanım
// (Pano "Vadesi Geçmiş", firma listesi, firma kartı): VADELİ ∧ kalan > 0 ∧ vade < bugün.
// Excel'deki bakiye tablosu eskiden son tam hesabın tarihine göre yazılıyordu.

export interface VadeSatiri {
  firm_id: string
  side: string
  due_date: string
  remaining_eur_cents: number
}

export function vadesiGecmisHaritasi(satirlar: readonly VadeSatiri[], bugun: string): Map<string, number> {
  const harita = new Map<string, number>()
  for (const r of satirlar) {
    if (r.side !== 'VADELI' || r.remaining_eur_cents <= 0 || r.due_date >= bugun) continue
    harita.set(r.firm_id, (harita.get(r.firm_id) ?? 0) + r.remaining_eur_cents)
  }
  return harita
}
