import { normText } from './normalize'
import type { ClassifyResult } from './types'

// Satış tipi Belge No sütunundan çıkarılır. Kural sırası önemlidir:
// 'KONSİNYE PEŞİN' araması 'KONSİNYE'den, 'KONSİNYE' araması '+' kontrolünden
// önce gelir ('+KONSİNYE' konsinye tarafına aittir).

export function classifySaleType(belgeNoRaw: string | null | undefined, turuRaw?: string | null): ClassifyResult {
  const t = normText(belgeNoRaw)
  const turu = normText(turuRaw)

  // İade irsaliyesi: tutarı borç olarak yazmak yanlış olur — daima incelemeye düşer.
  const isIade = turu.includes('IADE')

  if (t.includes('KONSINYE PESIN')) {
    return { type: 'KONSINYE_PESIN', needsReview: isIade, reason: isIade ? 'İade irsaliyesi — kontrol edin' : 'Belge No: KONSİNYE PEŞİN' }
  }
  if (t.includes('KONSINYE')) {
    return { type: 'KONSINYE', needsReview: isIade, reason: isIade ? 'İade irsaliyesi — kontrol edin' : 'Belge No: KONSİNYE' }
  }
  if (t.startsWith('+')) {
    return { type: 'PESIN', needsReview: isIade, reason: isIade ? 'İade irsaliyesi — kontrol edin' : 'Belge No: + (peşin)' }
  }

  // OTHER: sınıflandırılamadı — tahsise girmez, inceleme kuyruğunda öneriyle onay bekler.
  let suggested: ClassifyResult['suggested']
  let reason = 'Belge No boş — tip belirlenemedi'
  if (/^\d+$/.test(t)) {
    suggested = 'PESIN'
    reason = 'Belge No müşteri sipariş numarası görünüyor'
  } else if (/AVI\d+/.test(t) || t.includes('REVIZE') || t.includes('IRS')) {
    suggested = 'KONSINYE'
    reason = 'Belge No başka bir irsaliyeye/revizyona atıf yapıyor'
  } else if (t) {
    reason = `Belge No tanınmadı: ${t.slice(0, 40)}`
  }
  return { type: 'OTHER', suggested, needsReview: true, reason }
}
