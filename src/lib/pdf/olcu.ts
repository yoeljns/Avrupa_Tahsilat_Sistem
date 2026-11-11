// PDF METİN ÖLÇÜSÜ — Roboto Regular karakter genişlikleri (1000 birim / em).
//
// pdfmake'te "taşan metni kes" seçeneği yoktur: sığmayan metin alt satıra iner.
// Tek satırda kalması gereken hücreler (firma unvanı) için metnin genişliği burada
// hesaplanır ve gerekiyorsa "…" ile kesilir. Değerler paketle gelen yazı tipinden
// (pdfmake/build/vfs_fonts → Roboto-Regular.ttf) bir kez okunmuştur; harf aralığı
// daraltması (kerning) sayılmadığı için sonuç gerçek genişlikten biraz BÜYÜKTÜR
// (güvenli taraf). Listede olmayan karakter 600 sayılır.

const GRUPLAR: ReadonlyArray<readonly [number, string]> = [
  [175, "'"], [197, ','], [200, '’'], [211, ';'], [239, 'j'], [242, ':'], [243, 'il'], [244, '|'], [248, ' ıî'], [258, '!'],
  [261, '·'], [264, '.'], [265, '[]'], [272, 'IİÎ'], [276, '-'], [300, '‹›'], [309, '`'], [320, '"'], [327, 't'], [337, '•'],
  [338, '{}'], [339, 'r'], [342, '('], [348, ')f'], [354, '“'], [357, '”'], [411, '\\'], [413, '/'], [418, '^'], [431, '*'],
  [451, '_'], [469, '«»'], [473, '?y'], [484, 'v'], [496, 'xz'], [507, 'k'], [508, '<'], [516, 'sş'], [523, '>cç'], [530, 'e'],
  [534, '×'], [535, '±'], [539, 'L'], [544, 'aâ'], [549, '='], [551, 'huüû'], [552, 'Jn†'], [553, 'F'], [562, '$0123456789bgpğ€'],
  [563, '≈'], [564, 'd'], [567, '+'], [568, 'Eq'], [570, 'oö'], [571, '÷'], [594, 'SŞ'], [597, 'T'], [599, 'Z'], [601, 'Y'],
  [616, '#R'], [622, '&'], [623, 'B'], [627, 'KX'], [631, 'P'], [637, 'V'], [648, 'UÜÛ'], [651, 'CÇ'], [652, 'AÂ'], [656, 'D–'],
  [669, '…'], [680, '~'], [681, 'GĞ'], [688, 'OQÖ'], [713, 'HN'], [732, '%'], [751, 'w'], [776, '½'], [781, '—'], [873, 'M'],
  [877, 'm'], [887, 'W'], [898, '@'],
]

const BILINMEYEN = 600
const GENISLIK = new Map<string, number>()
for (const [g, karakterler] of GRUPLAR) for (const k of karakterler) GENISLIK.set(k, g)

/** Metnin `boy` punto Roboto Regular ile genişliği (pt). Kalın yazı için sonucu ~%4 büyütün. */
export function metinGenisligi(metin: string, boy: number): number {
  let toplam = 0
  for (const k of metin) toplam += GENISLIK.get(k) ?? BILINMEYEN
  return (toplam * boy) / 1000
}

const KESME = '…'
/** Kesilen metnin sonunda kalmaması gereken ekler: bağlaç ve noktalama */
const ASKIDA = /(?:\s+(?:VE|ve|İLE|ile|&)|[\s,;:\-–—·/(&])+$/u

/**
 * Metni `genislik` pt'ye sığdırır: sığıyorsa aynen döner; sığmıyorsa sözcük sınırından
 * kesip "…" ekler (sonda bağlaç ya da noktalama bırakmaz). İlk sözcük bile sığmıyorsa
 * harf harf keser. `isaretli` verilirse sonuç HER DURUMDA "…" ile biter (metnin devamı
 * çağıran tarafından zaten atılmışsa).
 */
export function sigdir(metin: string, genislik: number, boy: number, isaretli = false): string {
  if (!isaretli && metinGenisligi(metin, boy) <= genislik) return metin
  // küsurat payı: "a + … sığar" ile "a, (genişlik − …) içine sığar" aynı sonucu versin
  const hedef = genislik - metinGenisligi(KESME, boy) + 1e-6
  if (isaretli && metinGenisligi(metin, boy) <= hedef) return metin + KESME
  const sozcukler = metin.split(' ')
  let sonuc = ''
  for (const s of sozcukler) {
    const aday = sonuc ? `${sonuc} ${s}` : s
    if (metinGenisligi(aday, boy) > hedef) break
    sonuc = aday
  }
  if (!sonuc) {
    // tek sözcük sığmıyor: harf harf
    for (const k of sozcukler[0] ?? '') {
      if (metinGenisligi(sonuc + k, boy) > hedef) break
      sonuc += k
    }
    return sonuc + KESME
  }
  let temiz = sonuc
  for (let i = 0; i < 4; i++) {
    const kisa = temiz.replace(ASKIDA, '')
    if (kisa === temiz || !kisa) break
    temiz = kisa
  }
  return (temiz || sonuc) + KESME
}
