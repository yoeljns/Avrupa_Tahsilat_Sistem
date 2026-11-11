// PDF yazı tipi (Roboto) ile ilgili saf yardımcılar — pdfmake içe aktarmaz.

/**
 * Roboto'da bulunmayan işaretleri bulunan karşılıklarıyla değiştirir (ör. ok işareti).
 * Ekranda kullanılan metinler PDF'e bu işlevden geçirilerek yazılır; aksi halde
 * eksik işaretin yerinde boş bir kutu basılır.
 */
export function pdfMetni(s: string): string {
  return s.replace(/→/g, '›').replace(/←/g, '‹').replace(/✓/g, '+')
}

/**
 * Yazı tipinde bulunduğu doğrulanmış karakterler (Latin harfleri, Türkçe harfler,
 * rakamlar, noktalama ve kullanılan simgeler). Belge metinleri testte bu kümeyle
 * sınanır: yeni bir simge eklenirse önce yazı tipinde olup olmadığına bakılmalıdır.
 */
export const PDF_KARAKTERLERI = /^[\n\x20-\x7EçğıöşüÇĞİÖŞÜâîûÂÎÛ·–—€÷…’“”«»‹›•†≈×±½]*$/
