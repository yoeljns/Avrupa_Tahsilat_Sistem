// Türkçe metin normalizasyonu.
//
// NEDEN ÖZEL HARİTA: JS 'İ'.toLowerCase() → 'i̇' (i + birleşen nokta) üretir ve
// locale'e göre davranış değişir; 'KONSİNYE'.toUpperCase().includes('KONSINYE')
// sessizce false döner. Bu yüzden karşılaştırma yapılan HER metin önce bu
// katlamadan geçer — kodda başka hiçbir yerde toUpperCase/toLowerCase ile
// karşılaştırma yapılmaz.

const TR_FOLD: Record<string, string> = {
  İ: 'I', ı: 'I', i: 'I',
  Ş: 'S', ş: 'S',
  Ç: 'C', ç: 'C',
  Ğ: 'G', ğ: 'G',
  Ü: 'U', ü: 'U',
  Ö: 'O', ö: 'O',
}

/** Türkçe harfleri ASCII'ye katlar ve büyük harfe çevirir. */
export function foldTurkish(s: string): string {
  let out = ''
  for (const ch of s) {
    const mapped = TR_FOLD[ch]
    out += mapped !== undefined ? mapped : ch.toUpperCase()
  }
  return out
}

/** Genel metin normalizasyonu: katla + kenar boşluklarını at + iç boşlukları tekle. */
export function normText(s: string | null | undefined): string {
  if (!s) return ''
  return foldTurkish(String(s)).trim().replace(/\s+/g, ' ')
}

/**
 * Firma kodu normalizasyonu: '54 Ç03' ↔ '54 C03' aynı koda iner.
 * Hariç tutulan firma listesi eşleşmesi ve tüm firma birleştirmeleri bu form üzerinden yapılır.
 */
export function normalizeFirmCode(raw: string | null | undefined): string {
  return normText(raw)
}
