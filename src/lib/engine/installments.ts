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
