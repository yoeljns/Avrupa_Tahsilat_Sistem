import type { BayiRecord } from '@/lib/import/bayilerParser'

// Bayi listesi → firms satırları (upsert). Saf işlevler: route ve testler aynı kodu kullanır.

/**
 * Bir bayi kaydının firms satırı.
 *  - Yalnız dosyada BULUNAN kolonlar yazılır; olmayanlar mevcut firmada korunur.
 *    (Eski önizlemelerde kolon bilgisi yoksa tüm kolonlar var sayılır.)
 *  - Dosyadaki BOŞ sorumlu hücresi mevcut atamayı silmez (atamalar panelden de yapılır);
 *    sorumluyu kaldırmak için Bayiler ve Sorumlular → "Sorumluyu kaldır" kullanılır.
 */
export function bayiFirmaSatiri(r: BayiRecord, simdi: string): Record<string, unknown> {
  const k = r.kolonlar ?? { segment: true, borcDurumu: true, city: true, phone: true, pazarlamaciEmail: true }
  const row: Record<string, unknown> = {
    code_norm: r.codeNorm,
    code_raw: r.codeRaw,
    name: r.name,
    is_auto_created: false,
    updated_at: simdi,
  }
  if (k.segment) row.segment = r.segment || null
  if (k.borcDurumu) row.borc_durumu = r.borcDurumu || null
  if (k.city) row.city = r.city || null
  if (k.phone) row.phone = r.phone || null
  if (k.pazarlamaciEmail && r.pazarlamaciEmail) row.pazarlamaci_email = r.pazarlamaciEmail
  return row
}

/** PostgREST tek istekte aynı kolon kümesini bekler → satırlar kolon şekline göre gruplanır. */
export function sekleGoreGrupla(satirlar: Record<string, unknown>[]): Record<string, unknown>[][] {
  const sekiller = new Map<string, Record<string, unknown>[]>()
  for (const row of satirlar) {
    const key = Object.keys(row).sort().join(',')
    const arr = sekiller.get(key)
    if (arr) arr.push(row)
    else sekiller.set(key, [row])
  }
  return Array.from(sekiller.values())
}
