import { VARSAYILAN_KURALLAR, classifyWithRules } from './kurallar'
import type { ClassifyResult } from './types'

// Satış tipi Belge No sütunundan çıkarılır — varsayılan (tohum) kurallarla.
// Kurallar artık panelden yönetilir (sale_category_rules); içe aktarma
// veritabanındaki kuralları kullanır. Bu işlev testler ve kural tablosu henüz
// kurulmamış ortamlar için bugünkü davranışı birebir korur:
// 'KONSİNYE PEŞİN' → 'KONSİNYE' → '+' sırası; İade her durumda incelemeye düşer.

export function classifySaleType(belgeNoRaw: string | null | undefined, turuRaw?: string | null): ClassifyResult {
  const { type, suggested, needsReview, reason } = classifyWithRules(belgeNoRaw, turuRaw, VARSAYILAN_KURALLAR)
  return suggested === undefined ? { type, needsReview, reason } : { type, suggested, needsReview, reason }
}
