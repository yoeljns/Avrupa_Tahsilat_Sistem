// Taksit üretimi: toplam tutar vade tarihlerine eşit bölünür, küsurat SON taksite eklenir.

export interface BuiltInstallment {
  seq: number
  dueDate: string
  amountCents: number
}

export function buildInstallments(totalCents: number, dueDates: string[]): BuiltInstallment[] {
  if (dueDates.length === 0) return []
  const n = dueDates.length
  const sorted = [...dueDates].sort()
  const base = Math.trunc(totalCents / n)
  const out: BuiltInstallment[] = []
  let allocated = 0
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? totalCents - allocated : base
    allocated += amount
    out.push({ seq: i + 1, dueDate: sorted[i], amountCents: amount })
  }
  return out
}

/**
 * Elle girilmiş taksitlerin tutarlarını YENİ toplama oransal ölçekler;
 * tarihler ve sıralama korunur, küsurat SON taksite eklenir.
 * Kullanım: irsaliye tutarı değiştiğinde elle taksitler eski toplamda
 * kalmasın (aksi halde borç, yeni tutarı hiç yansıtmaz).
 * Eski toplam 0 ise tutar taksitlere eşit bölünür.
 */
export function scaleInstallmentAmounts(amounts: number[], newTotal: number): number[] {
  const n = amounts.length
  if (n === 0) return []
  const oldTotal = amounts.reduce((s, a) => s + a, 0)
  if (oldTotal === newTotal) return [...amounts]
  const out = new Array<number>(n).fill(0)
  let assigned = 0
  for (let i = 0; i < n - 1; i++) {
    const share =
      oldTotal === 0
        ? Math.trunc(newTotal / n)
        : // BigInt: büyük tutarlarda çarpım 2^53'ü aşmasın
          Number((BigInt(amounts[i]) * BigInt(newTotal)) / BigInt(oldTotal))
    out[i] = share
    assigned += share
  }
  out[n - 1] = newTotal - assigned
  return out
}
