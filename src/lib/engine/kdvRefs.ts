// KDV 1/5 ödemelerinin irsaliye referansları.
//
// KDV ödemesinin yanında eşleşen irsaliyenin SON 4 HANESİ yazar:
//   * 'KDV FATURA REFERANSI' kolonu: '0042' veya '0007,0083,0143,0144'
//   * yoksa açıklamadan: '0042-5TE1' → '0042'
// Eşleşen irsaliyeden KDV ödemesinin tamamı düşülür, kalan taksitlendirilir.

/** Referans listesini çözer; her ref rakamlara indirgenip 4 haneye sol-sıfır dolgulanır. */
export function parseKdvRefs(fatRef: string | null | undefined, aciklama: string | null | undefined): string[] {
  let raw: string[] = []
  const ref = (fatRef ?? '').trim()
  if (ref) {
    raw = ref.split(/[,;]/)
  } else {
    // Açıklamadan: '5TE1' işaretini çıkar, kalan sayı gruplarını al ('0042-5TE1' → ['0042'])
    const a = (aciklama ?? '').toUpperCase().replace(/5\s*TE\s*1/g, ' ')
    raw = a.match(/\d+/g) ?? []
  }
  const out: string[] = []
  for (const r of raw) {
    const digits = r.replace(/\D/g, '')
    if (!digits) continue
    const suffix = digits.padStart(4, '0').slice(-4)
    if (!out.includes(suffix)) out.push(suffix)
  }
  return out
}

/** Fiş numarasının rakamlarının son 4 hanesi ('AVI2026000000042' → '0042'). */
export function fisNoSuffix4(fisNo: string | null | undefined): string | null {
  const digits = (fisNo ?? '').replace(/\D/g, '')
  if (digits.length < 4) return null
  return digits.slice(-4)
}

/** Fiş numarasının rakam uzunluğu — çakışmada standart (en uzun) fiş tercih edilir. */
export function fisNoDigitCount(fisNo: string | null | undefined): number {
  return (fisNo ?? '').replace(/\D/g, '').length
}
