import type { PlanParseResult } from './types'

// Bir irsaliyenin neden incelemeye düştüğü — içe aktarma ve kural uygulaması
// aynı kuralı kullanır (irsaliyeParser'dan çıkarıldı).

export interface IncelemeGirdisi {
  siniflandirma: { needsReview: boolean; reason: string }
  plan: Pick<PlanParseResult, 'status' | 'note' | 'supheli'>
  amountEurCents: number | null
  is3112: boolean
}

export function incelemeNedenleri(g: IncelemeGirdisi): string[] {
  const nedenler: string[] = []
  if (g.siniflandirma.needsReview) nedenler.push(g.siniflandirma.reason)
  if (g.plan.status === 'unparsed') nedenler.push(g.plan.note ?? 'Ödeme planı çözülemedi')
  if (g.plan.supheli && !g.is3112) nedenler.push(g.plan.note ?? 'Vade irsaliye tarihinden çok önce')
  if (g.amountEurCents === null && !g.is3112) nedenler.push('EURO tutarı okunamadı')
  return nedenler
}
