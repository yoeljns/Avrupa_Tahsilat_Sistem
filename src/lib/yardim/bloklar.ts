// İŞ AKIŞ PROSEDÜRÜ — içerik yapısı.
// İçerik (icerik.ts) düz veridir; Yardım sayfası ve PDF aynı veriden üretilir,
// böylece ikisi birbirinden ayrışamaz. Metinlerde yalnız **kalın** işareti kullanılır.

export type KutuTonu = 'bilgi' | 'uyari' | 'ornek'

export type Blok =
  | { tur: 'paragraf'; metin: string }
  /** bölüm içi ara başlık */
  | { tur: 'altbaslik'; metin: string }
  /** numaralı adımlar (sıra önemli) */
  | { tur: 'adimlar'; ogeler: string[] }
  /** madde imli liste */
  | { tur: 'liste'; ogeler: string[] }
  /** `genislikler`: sütunların göreli genişliği (toplamı önemli değil) */
  | { tur: 'tablo'; basliklar: string[]; satirlar: string[][]; genislikler?: number[] }
  | { tur: 'kutu'; ton: KutuTonu; baslik?: string; satirlar: string[] }

export interface Bolum {
  /** sayfa içi bağlantı adı (#roller gibi) */
  id: string
  baslik: string
  /** başlığın altındaki tek cümlelik özet */
  ozet?: string
  bloklar: Blok[]
}

export interface Prosedur {
  baslik: string
  altBaslik: string
  /** içeriğin son gözden geçirildiği gün (ISO) */
  guncelleme: string
  bolumler: Bolum[]
}

export interface MetinParcasi {
  metin: string
  kalin: boolean
}

/** '**kalın** ve düz' → parçalar. Eşleşmeyen ** işareti düz metin sayılır. */
export function kalinParcala(metin: string): MetinParcasi[] {
  const parcalar: MetinParcasi[] = []
  const desen = /\*\*(.+?)\*\*/g
  let son = 0
  for (let m = desen.exec(metin); m; m = desen.exec(metin)) {
    if (m.index > son) parcalar.push({ metin: metin.slice(son, m.index), kalin: false })
    parcalar.push({ metin: m[1], kalin: true })
    son = m.index + m[0].length
  }
  if (son < metin.length) parcalar.push({ metin: metin.slice(son), kalin: false })
  return parcalar
}

/** Kalın işaretleri atılmış düz metin (arama, sınama) */
export function duzMetin(metin: string): string {
  return kalinParcala(metin)
    .map((p) => p.metin)
    .join('')
}

/** Belgedeki bütün metinler, sırayla (iki çıktının aynı içeriği taşıdığını sınamak için) */
export function butunMetinler(p: Prosedur): string[] {
  const out: string[] = [p.baslik, p.altBaslik]
  for (const b of p.bolumler) {
    out.push(b.baslik)
    if (b.ozet) out.push(b.ozet)
    for (const k of b.bloklar) {
      if (k.tur === 'paragraf' || k.tur === 'altbaslik') out.push(k.metin)
      else if (k.tur === 'adimlar' || k.tur === 'liste') out.push(...k.ogeler)
      else if (k.tur === 'tablo') out.push(...k.basliklar, ...k.satirlar.flat())
      else out.push(...(k.baslik ? [k.baslik] : []), ...k.satirlar)
    }
  }
  return out.map(duzMetin)
}
