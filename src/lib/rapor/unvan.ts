import { metinGenisligi, sigdir } from '@/lib/pdf/olcu'

// FİRMA UNVANI — PDF tablolarında tek satıra sığdırma (saf yardımcılar).
//
// Sistemdeki firma adları tam ticaret unvanlarıdır (ortanca ~43, en uzunu 140+ karakter):
//   "… HIRDAVAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ", "… ÜR.GIY.GID.SAN.TIC.LTD.STI."
// Tabloda alt alta 3–4 satıra inmemesi için sırayla:
//   1) yazım düzeltilir (fazla boşluk; "SAN.LTD.ŞTİ." → "SAN. LTD. ŞTİ."),
//   2) sığmıyorsa şirket türü kısaltılır ("LİMİTED ŞİRKETİ" → "LTD. ŞTİ."),
//   3) yine sığmıyorsa sondaki şirket türü ekleri atılır ve sözcük sınırından "…" ile kesilir.
// Firmayı tabloda KODU tanımlar; kesilen unvan yalnız okumayı kolaylaştırır. Tam unvan uygulamadadır.

/** Yazım: fazla boşluklar tek boşluk; kısaltma noktasından / virgülden sonra boşluk ("A.Ş." gibi tek harflilere dokunmaz). */
export function unvanDuzelt(ad: string): string {
  return ad
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\p{L}{2,})([.,])(?=\p{L})/gu, '$1$2 ')
}

const I = '[İIiı]'
const SINIR_ONCE = '(?<![\\p{L}\\p{N}])'
const SINIR_SONRA = '(?![\\p{L}\\p{N}])'
const kalip = (govde: string): RegExp => new RegExp(`${SINIR_ONCE}${govde}${SINIR_SONRA}\\.?`, 'giu')

// Unvanlar çoğunlukla büyük harfle, kimi zaman Türkçe harfsiz yazılmıştır ("LIMITED SIRKETI").
const KISALTMALAR: ReadonlyArray<readonly [RegExp, string]> = [
  [kalip(`L${I}M${I}TED\\s+[ŞS]${I}RKET${I}`), 'LTD. ŞTİ.'],
  [kalip(`ANON${I}M\\s+[ŞS]${I}RKET${I}`), 'A.Ş.'],
  [kalip(`SANAY${I}\\s+VE\\s+T${I}CARET`), 'SAN. VE TİC.'],
  [kalip(`T${I}CARET\\s+VE\\s+SANAY${I}`), 'TİC. VE SAN.'],
]

/** Şirket türü ve "sanayi ve ticaret" kalıplarını yaygın kısaltmalarıyla değiştirir. */
export function unvanKisalt(ad: string): string {
  let s = ad
  for (const [k, yeni] of KISALTMALAR) s = s.replace(k, yeni)
  return s
}

/** Karşılaştırma için: noktasız, büyük harf, Türkçe harfler sade ("Şti." → "STI") */
const sade = (s: string): string =>
  s
    .replace(/[.,]/g, '')
    .replace(/[İIıi]/g, 'I')
    .replace(/[Şş]/g, 'S')
    .replace(/[Çç]/g, 'C')
    .replace(/[Ğğ]/g, 'G')
    .replace(/[Üü]/g, 'U')
    .replace(/[Öö]/g, 'O')
    .toUpperCase()

/** Unvanın sonunda tek başına anlam taşımayan ekler: şirket türü, "sanayi / ticaret", bağlaç */
const KUYRUK = new Set(['SAN', 'SANAYI', 'TIC', 'TICARET', 'LTD', 'LIMITED', 'STI', 'ST', 'SIRKETI', 'AS', 'ANONIM', 'VE', 'ILE', 'ITH', 'IHR', 'PAZ', 'TAAH', 'INS', '&', '-', '–'])

/** Sondaki şirket türü eklerini ve bağlaçları atar ("X BOYA SAN. VE TİC. LTD. ŞTİ." → "X BOYA"). Hepsi ekse aynen döner. */
export function unvanGovdesi(ad: string): string {
  const sozcukler = ad.split(' ')
  let son = sozcukler.length
  while (son > 0 && KUYRUK.has(sade(sozcukler[son - 1]))) son--
  if (son === 0) return ad
  return sozcukler.slice(0, son).join(' ').replace(/[\s,;:\-–·/(&]+$/u, '') || ad
}

const KESME = '…'

/**
 * Unvanı `genislik` pt'lik tek satıra sığdırır (Roboto Regular, `boy` punto).
 * Sığıyorsa (düzeltilmiş) tam unvan; sığmıyorsa kısaltılmış; o da sığmıyorsa gövdesi + "…".
 */
export function kisaUnvan(ad: string, genislik: number, boy: number): string {
  const sigar = (s: string): boolean => metinGenisligi(s, boy) <= genislik
  const duz = unvanDuzelt(ad)
  if (sigar(duz)) return duz
  const kisa = unvanKisalt(duz)
  if (sigar(kisa)) return kisa
  // Buradan sonra unvan eksik gösterilir: sonuç her durumda "…" ile biter.
  const kesik = sigdir(unvanGovdesi(kisa), genislik, boy, true)
  return unvanGovdesi(kesik.slice(0, -KESME.length)) + KESME
}
