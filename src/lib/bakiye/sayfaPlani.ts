import { trDate } from '@/lib/format'
import { RENK, SAYI_BICIMI, gunAyEtiketi } from './bicim'
import { ILK_YARI_SON_GUN, type BakiyeDokumSatiri, type BakiyeFirma, type BakiyeModeli } from './model'

// EXCEL SAYFA PLANI — "Vadeli Bakiyeler" çalışma kitabının sayfaları DÜZ VERİ
// olarak (hücre değeri + biçim + birleştirme + genişlik). Bu modül exceljs'i içe
// aktarmaz: birim testleri hızlıdır ve biçim sözleşmesi kütüphaneden bağımsızdır.
// Dosyaya yazan ince uyarlayıcı: src/lib/export/exceljsYaz.ts
//
// Biçimler kullanıcının dosyasından (xl/styles.xml, sheet1.xml) hücre hücre alındı:
// Calibri 10, başlıklar kalın/ortalı, ay grupları turuncu/sarı, KALAN sütunu ay
// renginde, TOPLAM SATIŞ mavi, KALAN BORÇ açık sarı, birikimli sütun camgöbeği,
// her yerde ince kenarlık; başlıkta ve grup sınırlarında orta kalınlık.

export type Kenar = 'thin' | 'medium'

export interface HucreBicimi {
  /** dolgu rengi RRGGBB */
  dolgu?: string
  kalin?: boolean
  yaziRengi?: string
  /** punto (varsayılan: sayfanın yazı boyu) */
  yaziBoyu?: number
  sayiBicimi?: string
  yatay?: 'left' | 'center' | 'right'
  dikey?: 'middle'
  sar?: boolean
  kenar?: { sol?: Kenar; sag?: Kenar; ust?: Kenar; alt?: Kenar }
}

export type PlanDegeri = string | number | null | { formul: string; sonuc: number }

export interface PlanHucresi {
  deger: PlanDegeri
  bicim: HucreBicimi
  /** hücre notu (Excel'de köşesi kırmızı işaretli açıklama) */
  not?: string
}

export interface SayfaPlani {
  ad: string
  /** varsayılan yazı boyu */
  yaziBoyu: number
  /** [satır][sütun], 0 tabanlı; null = hücre yok */
  hucreler: (PlanHucresi | null)[][]
  satirYukseklikleri: (number | null)[]
  sutunlar: Array<{ genislik: number; gizli?: boolean }>
  /** 'A1:F1' biçiminde */
  birlesimler: string[]
  dondur?: { sutun: number; satir: number }
  /** otomatik süzgeç aralığı ('A1:L1') */
  suzgec?: string
  yazdirma?: { yatay: boolean; baslikSatirlari?: string; baslikSutunlari?: string }
}

/** 1 → 'A', 27 → 'AA' */
export function sutunHarfi(n: number): string {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 0 tabanlı (sütun, satır) → 'G4' */
function ref(sutun: number, satir: number): string {
  return sutunHarfi(sutun + 1) + (satir + 1)
}

/** ISO gün → Excel seri numarası (1900 tarih sistemi) */
export function excelTarihi(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000 + 25_569
}

const avro = (kurus: number): number => kurus / 100

const INCE: NonNullable<HucreBicimi['kenar']> = { sol: 'thin', sag: 'thin', ust: 'thin', alt: 'thin' }

function bosSatir(genislik: number): (PlanHucresi | null)[] {
  return Array.from({ length: genislik }, () => null)
}

// ---------------------------------------------------------------------------
// 1) Vadeli Bakiyeler
// ---------------------------------------------------------------------------
export const SABIT_SUTUN = 6 // A–F
export const BASLIK_SATIRI = 3

/** FİRMA ADI genişliği: dosyada 13,43 (kısa adlar); sistemdeki tam unvanlar için daha geniş */
const FIRMA_ADI_GENISLIGI = 34
const DONEM_GENISLIGI = 11.28515625

export interface AySutunlari {
  /** ilk BORÇ sütunu (0 tabanlı) */
  ilk: number
  borcAdedi: number
  odeme: number
  kalan: number
}

/** Ay gruplarının ve birikimli sütunun sayfadaki yerleri */
export function sutunYerlesimi(model: BakiyeModeli): { aylar: AySutunlari[]; birikimli: number | null; genislik: number } {
  const aylar: AySutunlari[] = []
  let c = SABIT_SUTUN
  let birikimli: number | null = null
  model.aylar.forEach((a, i) => {
    const n = a.borcSutunlari.length
    aylar.push({ ilk: c, borcAdedi: n, odeme: c + n, kalan: c + n + 1 })
    c += n + 2
    if (model.birikimliSonrasi === i) {
      birikimli = c
      c += 1
    }
  })
  return { aylar, birikimli, genislik: c }
}

export function vadeliBakiyelerPlani(model: BakiyeModeli, durumNotu: string): SayfaPlani {
  const yer = sutunYerlesimi(model)
  const G = yer.genislik
  const N = model.satirlar.length
  const ilkVeri = BASLIK_SATIRI
  const toplamSatiri = ilkVeri + N
  const kalanSatiri = toplamSatiri + 1
  const hucreler: (PlanHucresi | null)[][] = Array.from({ length: kalanSatiri + 1 }, () => bosSatir(G))
  const birlesimler: string[] = []
  const baslik = { kalin: true, yaziRengi: RENK.baslikYazi, yatay: 'center', dikey: 'middle', sar: true } as const

  // --- A–F başlıkları ---
  hucreler[0][0] = { deger: durumNotu, bicim: { ...baslik, kenar: { sol: 'medium', ust: 'medium', alt: 'medium' } } }
  for (let c = 1; c <= 4; c++) hucreler[0][c] = { deger: null, bicim: { ...baslik, kenar: { ust: 'medium', alt: 'medium' } } }
  hucreler[0][5] = { deger: null, bicim: { ...baslik, kenar: { sag: 'medium', ust: 'medium', alt: 'medium' } } }
  birlesimler.push('A1:F1')
  // 2. ve 3. satır kenarlıkları ve hizaları dosyadaki gibi: SENET ÇEK başlığı kalın çerçeveli,
  // TOPLAM SATIŞ ve KALAN BORÇ ortalı, diğerleri sola yaslı
  const ikinciSatirKenari: Array<HucreBicimi['kenar']> = [
    { sol: 'medium', alt: 'medium' },
    { ust: 'medium', alt: 'medium' },
    { alt: 'medium' },
    { alt: 'medium' },
    { alt: 'medium' },
    { alt: 'medium' },
  ]
  for (let c = 0; c < SABIT_SUTUN; c++) hucreler[1][c] = { deger: null, bicim: { ...baslik, kenar: ikinciSatirKenari[c] } }
  const sabitBasliklar: Array<{ ad: string; ortali: boolean; kenar: HucreBicimi['kenar'] }> = [
    { ad: 'SORUMLU', ortali: false, kenar: { sol: 'medium', alt: 'medium' } },
    { ad: 'SENET ÇEK', ortali: false, kenar: { sol: 'medium', sag: 'medium', ust: 'medium', alt: 'medium' } },
    { ad: 'FİRMA ADI', ortali: false, kenar: { sag: 'thin', alt: 'medium' } },
    { ad: 'TOPLAM SATIŞ', ortali: true, kenar: { sol: 'thin', sag: 'thin', alt: 'medium' } },
    { ad: 'ÖDEMELER', ortali: false, kenar: { sol: 'thin', sag: 'thin', alt: 'medium' } },
    { ad: 'KALAN BORÇ', ortali: true, kenar: { sol: 'thin', alt: 'medium' } },
  ]
  sabitBasliklar.forEach((b, c) => {
    hucreler[2][c] = {
      deger: b.ad,
      bicim: { kalin: true, yaziRengi: RENK.baslikYazi, dikey: 'middle', sar: true, ...(b.ortali ? { yatay: 'center' as const } : {}), kenar: b.kenar },
    }
  })

  // --- Ay grupları: üç başlık satırı ---
  model.aylar.forEach((ay, i) => {
    const y = yer.aylar[i]
    const dolgu = RENK[ay.renk]
    const kenar = (c: number, ust: Kenar, alt: Kenar): HucreBicimi['kenar'] => ({
      sol: c === y.ilk ? 'medium' : 'thin',
      sag: c === y.kalan ? 'medium' : 'thin',
      ust,
      alt,
    })
    ay.borcSutunlari.forEach((s, j) => {
      const c = y.ilk + j
      hucreler[0][c] = { deger: excelTarihi(s.tarih), bicim: { ...baslik, dolgu, sayiBicimi: SAYI_BICIMI.gunAy, kenar: kenar(c, 'medium', 'thin') } }
      hucreler[1][c] = { deger: s.etiket, bicim: { ...baslik, dolgu, kenar: kenar(c, 'thin', 'thin') } }
      hucreler[2][c] = { deger: 'BORÇ', bicim: { ...baslik, kenar: kenar(c, 'thin', 'medium') } }
    })
    hucreler[0][y.odeme] = { deger: null, bicim: { ...baslik, dolgu, kenar: kenar(y.odeme, 'medium', 'thin') } }
    hucreler[1][y.odeme] = { deger: null, bicim: { ...baslik, dolgu, kenar: kenar(y.odeme, 'thin', 'thin') } }
    hucreler[2][y.odeme] = { deger: 'ÖDEME', bicim: { ...baslik, kenar: kenar(y.odeme, 'thin', 'medium') } }
    hucreler[0][y.kalan] = { deger: ay.ad, bicim: { ...baslik, dolgu, kenar: kenar(y.kalan, 'medium', 'thin') } }
    hucreler[1][y.kalan] = { deger: 'TOPLAM', bicim: { ...baslik, dolgu, kenar: kenar(y.kalan, 'thin', 'thin') } }
    hucreler[2][y.kalan] = { deger: 'KALAN', bicim: { ...baslik, kenar: kenar(y.kalan, 'thin', 'medium') } }
  })
  if (yer.birikimli !== null) {
    const c = yer.birikimli
    hucreler[0][c] = { deger: model.birikimliBaslik[0] || null, bicim: { ...baslik, dolgu: RENK.birikimli, kenar: { ...INCE, ust: 'medium' } } }
    hucreler[1][c] = { deger: model.birikimliBaslik[1] || null, bicim: { ...baslik, dolgu: RENK.birikimli, kenar: INCE } }
    hucreler[2][c] = { deger: model.birikimliBaslik[2], bicim: { ...baslik, kenar: { sol: 'thin', sag: 'thin', alt: 'medium' } } }
  }

  // --- Formül parçaları ---
  const borcRefleri = (r: number) => yer.aylar.flatMap((y) => Array.from({ length: y.borcAdedi }, (_, j) => ref(y.ilk + j, r)))
  const odemeRefleri = (r: number) => yer.aylar.map((y) => ref(y.odeme, r))
  const ayKalanFormulu = (y: AySutunlari, r: number) =>
    Array.from({ length: y.borcAdedi }, (_, j) => ref(y.ilk + j, r)).join('+') + '-' + ref(y.odeme, r)
  // Birikimli: içinde bulunulan aya kadar (dahil) AÇIK ayların KALAN hücreleri
  const birikimliAylar = model.aylar.map((a, i) => (!a.gizli && model.birikimliSonrasi !== null && i <= model.birikimliSonrasi ? i : -1)).filter((i) => i >= 0)
  const topla = (refler: string[], sonuc: number): PlanDegeri => (refler.length > 0 ? { formul: refler.join('+'), sonuc } : sonuc)
  const sutunToplami = (c: number, sonuc: number): PlanDegeri =>
    N > 0 ? { formul: `SUM(${ref(c, ilkVeri)}:${ref(c, toplamSatiri - 1)})`, sonuc } : sonuc

  const tutarKenari = (c: number, y: AySutunlari): HucreBicimi['kenar'] => ({ ...INCE, ...(c === y.ilk ? { sol: 'medium' } : {}), ...(c === y.kalan ? { sag: 'medium' } : {}) })

  // --- Firma satırları ---
  model.satirlar.forEach((s, si) => {
    const r = ilkVeri + si
    const satir = hucreler[r]
    satir[0] = { deger: s.sorumlu ?? '', bicim: { kalin: true, yaziRengi: s.sorumluBlok % 2 === 0 ? RENK.kirmizi : RENK.siyah, kenar: INCE } }
    satir[1] = { deger: null, bicim: { sayiBicimi: SAYI_BICIMI.tam, kenar: INCE } }
    satir[2] = { deger: s.ad, bicim: { dolgu: RENK.beyaz, yaziRengi: RENK.baslikYazi, kenar: INCE } }
    satir[3] = { deger: topla(borcRefleri(r), avro(s.toplamBorc)), bicim: { dolgu: RENK.mavi, kalin: true, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'right', kenar: INCE } }
    satir[4] = { deger: topla(odemeRefleri(r), avro(s.toplamOdeme)), bicim: { dolgu: RENK.beyaz, kalin: true, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'right', kenar: INCE } }
    satir[5] = {
      deger: { formul: `${ref(3, r)}-${ref(4, r)}`, sonuc: avro(s.toplamKalan) },
      bicim: { dolgu: RENK.kalanBorc, kalin: true, sayiBicimi: SAYI_BICIMI.kalan, yatay: 'right', kenar: INCE },
    }
    model.aylar.forEach((ay, i) => {
      const y = yer.aylar[i]
      const h = s.aylar[i]
      for (let j = 0; j < y.borcAdedi; j++) {
        const c = y.ilk + j
        const notlar = h?.notlar[j]
        satir[c] = {
          deger: h && h.borc[j] !== 0 ? avro(h.borc[j]) : null,
          bicim: { dolgu: RENK.beyaz, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'center', kenar: tutarKenari(c, y) },
          ...(notlar ? { not: notlar.join('\n') } : {}),
        }
      }
      satir[y.odeme] = {
        deger: h && h.odeme !== 0 ? avro(h.odeme) : null,
        bicim: { dolgu: RENK.beyaz, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'center', kenar: tutarKenari(y.odeme, y) },
      }
      satir[y.kalan] = {
        deger: { formul: ayKalanFormulu(y, r), sonuc: avro(h?.kalan ?? 0) },
        bicim: { dolgu: RENK[ay.renk], kalin: true, yaziRengi: RENK.koyuYazi, sayiBicimi: SAYI_BICIMI.kalan, yatay: 'center', kenar: tutarKenari(y.kalan, y) },
      }
    })
    if (yer.birikimli !== null) {
      satir[yer.birikimli] = {
        deger: topla(
          birikimliAylar.map((i) => ref(yer.aylar[i].kalan, r)),
          avro(s.birikimli),
        ),
        bicim: { dolgu: RENK.birikimli, kalin: true, yaziRengi: RENK.koyuYazi, sayiBicimi: SAYI_BICIMI.kalan, yatay: 'center', kenar: INCE },
      }
    }
  })

  // --- TOPLAM satırı ---
  {
    const r = toplamSatiri
    const satir = hucreler[r]
    satir[1] = { deger: sutunToplami(1, 0), bicim: { kalin: true, sayiBicimi: SAYI_BICIMI.tam, kenar: INCE } }
    satir[2] = { deger: 'TOPLAM', bicim: { kalin: true, yaziRengi: RENK.baslikYazi, kenar: INCE } }
    satir[3] = { deger: sutunToplami(3, avro(model.toplam.borc)), bicim: { dolgu: RENK.mavi, kalin: true, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'right', kenar: INCE } }
    satir[4] = { deger: sutunToplami(4, avro(model.toplam.odeme)), bicim: { dolgu: RENK.beyaz, kalin: true, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'right', kenar: INCE } }
    satir[5] = {
      deger: { formul: `${ref(3, r)}-${ref(4, r)}`, sonuc: avro(model.toplam.kalan) },
      bicim: { dolgu: RENK.kalanBorc, kalin: true, sayiBicimi: SAYI_BICIMI.kalan, yatay: 'right', kenar: INCE },
    }
    model.aylar.forEach((ay, i) => {
      const y = yer.aylar[i]
      const b = (c: number): HucreBicimi => ({ dolgu: RENK[ay.renk], kalin: true, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'center', kenar: tutarKenari(c, y) })
      ay.toplam.borc.forEach((t, j) => (satir[y.ilk + j] = { deger: sutunToplami(y.ilk + j, avro(t)), bicim: b(y.ilk + j) }))
      satir[y.odeme] = { deger: sutunToplami(y.odeme, avro(ay.toplam.odeme)), bicim: b(y.odeme) }
      satir[y.kalan] = { deger: sutunToplami(y.kalan, avro(ay.toplam.kalan)), bicim: { ...b(y.kalan), yaziRengi: RENK.koyuYazi } }
    })
    if (yer.birikimli !== null) {
      satir[yer.birikimli] = {
        deger: sutunToplami(yer.birikimli, avro(model.toplam.birikimli)),
        bicim: { dolgu: RENK.birikimli, kalin: true, yaziRengi: RENK.koyuYazi, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'center', kenar: INCE },
      }
    }
  }

  // --- Son satır: ay başına birleşik "kalan" (dosyadaki 71. satır) ---
  {
    const r = kalanSatiri
    const satir = hucreler[r]
    satir[4] = { deger: null, bicim: { kalin: true, yatay: 'center', kenar: { sol: 'thin', ust: 'thin', alt: 'thin' } } }
    satir[5] = { deger: null, bicim: { kalin: true, yatay: 'center', kenar: { ust: 'thin', alt: 'thin' } } }
    birlesimler.push(`${ref(4, r)}:${ref(5, r)}`)
    model.aylar.forEach((ay, i) => {
      const y = yer.aylar[i]
      for (let c = y.ilk; c <= y.kalan; c++) {
        satir[c] = {
          deger: c === y.ilk ? { formul: ayKalanFormulu(y, toplamSatiri), sonuc: avro(ay.toplam.kalan) } : null,
          bicim: {
            dolgu: RENK[ay.renk],
            kalin: true,
            sayiBicimi: SAYI_BICIMI.tutar,
            yatay: 'center',
            kenar: { alt: 'medium', ...(c === y.ilk ? { sol: 'medium' } : {}), ...(c === y.kalan ? { sag: 'medium' } : {}) },
          },
        }
      }
      birlesimler.push(`${ref(y.ilk, r)}:${ref(y.kalan, r)}`)
    })
    if (yer.birikimli !== null) {
      satir[yer.birikimli] = { deger: null, bicim: { dolgu: RENK.birikimli, kalin: true, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'center', kenar: { alt: 'medium' } } }
    }
  }

  // --- Sütunlar: genişlik ve gizleme ---
  const sutunlar: SayfaPlani['sutunlar'] = [
    { genislik: 8.5703125 },
    { genislik: 8.7109375 },
    { genislik: FIRMA_ADI_GENISLIGI },
    { genislik: 12.28515625 },
    { genislik: 12.28515625 },
    { genislik: 11.7109375 },
  ]
  model.aylar.forEach((ay, i) => {
    const y = yer.aylar[i]
    for (let c = y.ilk; c <= y.kalan; c++) sutunlar[c] = { genislik: DONEM_GENISLIGI, ...(ay.gizli ? { gizli: true } : {}) }
  })
  if (yer.birikimli !== null) sutunlar[yer.birikimli] = { genislik: DONEM_GENISLIGI }

  return {
    ad: 'Vadeli Bakiyeler',
    yaziBoyu: 10,
    hucreler,
    satirYukseklikleri: [15.75, 15.75, 26.25, ...Array.from({ length: N + 1 }, () => 15), 15.75],
    sutunlar,
    birlesimler,
    dondur: { sutun: SABIT_SUTUN, satir: BASLIK_SATIRI },
    yazdirma: { yatay: true, baslikSatirlari: '1:3', baslikSutunlari: 'A:F' },
  }
}

// ---------------------------------------------------------------------------
// 2) ALACAKLILAR — dosyadaki sayfanın biçimi (Calibri 11, FFC000 başlık,
//    kalın kırmızı satırlar, camgöbeği toplam)
// ---------------------------------------------------------------------------
export function alacaklilarPlani(alacaklar: Array<{ ad: string; alacak: number }>): SayfaPlani {
  const hucreler: (PlanHucresi | null)[][] = []
  const baslikA: HucreBicimi = { dolgu: RENK.alacakBaslik, kalin: true, yaziRengi: '262626', dikey: 'middle', sar: true, kenar: INCE }
  const baslikB: HucreBicimi = { dolgu: RENK.beyaz, kalin: true, yaziRengi: RENK.kirmizi, yatay: 'center', dikey: 'middle', sar: true, kenar: INCE }
  hucreler.push([{ deger: 'FİRMA ADI', bicim: baslikA }, { deger: 'ALACAK', bicim: baslikB }])
  hucreler.push([{ deger: null, bicim: baslikA }, { deger: null, bicim: baslikB }])
  for (const a of alacaklar) {
    hucreler.push([
      { deger: a.ad, bicim: { kalin: true, yaziRengi: RENK.kirmizi, kenar: INCE } },
      { deger: avro(a.alacak), bicim: { kalin: true, yaziRengi: RENK.kirmizi, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'center', kenar: INCE } },
    ])
  }
  const toplam = alacaklar.reduce((t, a) => t + a.alacak, 0)
  const sonVeri = 2 + alacaklar.length
  hucreler.push([
    { deger: 'TOPLAM', bicim: { kalin: true, yaziRengi: '262626', kenar: INCE } },
    {
      deger: alacaklar.length > 0 ? { formul: `SUM(B3:B${sonVeri})`, sonuc: avro(toplam) } : 0,
      bicim: { dolgu: RENK.birikimli, kalin: true, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'center', kenar: INCE },
    },
  ])
  return {
    ad: 'ALACAKLILAR',
    yaziBoyu: 11,
    hucreler,
    satirYukseklikleri: [15, ...hucreler.slice(1).map(() => null)],
    sutunlar: [{ genislik: 44 }, { genislik: 14 }],
    birlesimler: ['A1:A2', 'B1:B2'],
    dondur: { sutun: 1, satir: 2 },
  }
}

// ---------------------------------------------------------------------------
// 3) Taksit Dökümü — tablodaki her sayının dayanağı (süzgeçli düz liste)
// ---------------------------------------------------------------------------

/** Bir taksidin tablodaki sütunu: 'KASIM · PEŞİN (20-Kas)' */
export function tablodakiSutun(model: BakiyeModeli, kategori: string, vade: string): string {
  const ay = model.aylar.find((a) => a.ay === vade.slice(0, 7))
  if (!ay) return ''
  const adaylar = ay.borcSutunlari.filter((s) => s.kategori === kategori)
  if (adaylar.length === 0) return ay.ad
  const gun = parseInt(vade.slice(8, 10), 10)
  const s = adaylar.length === 1 ? adaylar[0] : gun <= ILK_YARI_SON_GUN ? adaylar[0] : adaylar[1]
  return `${ay.ad} · ${s.etiket} (${gunAyEtiketi(s.tarih)})`
}

export function taksitDokumuPlani(
  model: BakiyeModeli,
  firmalar: BakiyeFirma[],
  dokum: BakiyeDokumSatiri[],
  kategoriAdi: (kod: string) => string,
): SayfaPlani {
  const tabloda = new Set(model.satirlar.map((s) => s.firm_id))
  const sirasi = new Map(model.satirlar.map((s, i) => [s.firm_id, i]))
  const basliklar = ['SORUMLU', 'FİRMA KODU', 'FİRMA ADI', 'KATEGORİ', 'FİŞ NO', 'İRSALİYE TARİHİ', 'VADE', 'TABLODAKİ SÜTUN', 'BORÇ', 'ÖDENEN', 'KALAN', 'NOT']
  const baslikBicimi: HucreBicimi = { dolgu: 'E7E6E6', kalin: true, yatay: 'center', dikey: 'middle', sar: true, kenar: INCE }
  const hucreler: (PlanHucresi | null)[][] = [basliklar.map((b) => ({ deger: b, bicim: baslikBicimi }))]

  const satirlar = dokum
    .filter((d) => d[1] === 'VADELI' && firmalar[d[0]] && tabloda.has(firmalar[d[0]].id))
    .map((d) => ({ d, f: firmalar[d[0]] }))
    .sort(
      (a, b) =>
        sirasi.get(a.f.id)! - sirasi.get(b.f.id)! || (a.d[3] < b.d[3] ? -1 : a.d[3] > b.d[3] ? 1 : 0) || (a.d[6] < b.d[6] ? -1 : a.d[6] > b.d[6] ? 1 : 0),
    )
  const tutar: HucreBicimi = { sayiBicimi: SAYI_BICIMI.tutar, kenar: INCE }
  const tarih: HucreBicimi = { sayiBicimi: SAYI_BICIMI.tarih, yatay: 'center', kenar: INCE }
  const metin: HucreBicimi = { kenar: INCE }
  for (const { d, f } of satirlar) {
    const [, , kategori, vade, borc, kalan, fisNo, irsaliyeTarihi, tarihsiz] = d
    hucreler.push([
      { deger: f.sorumlu ?? '', bicim: metin },
      { deger: f.kod, bicim: metin },
      { deger: f.ad, bicim: metin },
      { deger: kategoriAdi(kategori), bicim: metin },
      { deger: fisNo, bicim: metin },
      { deger: excelTarihi(irsaliyeTarihi), bicim: tarih },
      { deger: excelTarihi(vade), bicim: tarih },
      { deger: tablodakiSutun(model, kategori, vade), bicim: metin },
      { deger: avro(borc), bicim: tutar },
      { deger: avro(borc - kalan), bicim: tutar },
      { deger: avro(kalan), bicim: { ...tutar, kalin: kalan > 0 } },
      { deger: tarihsiz ? 'vade girilmedi' : '', bicim: metin },
    ])
  }
  const n = satirlar.length
  const toplam = (c: number, sonuc: number): PlanDegeri => (n > 0 ? { formul: `SUBTOTAL(109,${ref(c, 1)}:${ref(c, n)})`, sonuc } : 0)
  const tb: HucreBicimi = { dolgu: 'E7E6E6', kalin: true, sayiBicimi: SAYI_BICIMI.tutar, kenar: INCE }
  const son = bosSatir(basliklar.length)
  son[7] = { deger: 'TOPLAM (süzülen satırlar)', bicim: { dolgu: 'E7E6E6', kalin: true, yatay: 'right', kenar: INCE } }
  son[8] = { deger: toplam(8, avro(satirlar.reduce((t, x) => t + x.d[4], 0))), bicim: tb }
  son[9] = { deger: toplam(9, avro(satirlar.reduce((t, x) => t + x.d[4] - x.d[5], 0))), bicim: tb }
  son[10] = { deger: toplam(10, avro(satirlar.reduce((t, x) => t + x.d[5], 0))), bicim: tb }
  hucreler.push(son)
  return {
    ad: 'Taksit Dökümü',
    yaziBoyu: 10,
    hucreler,
    satirYukseklikleri: [26.25, ...hucreler.slice(1).map(() => null)],
    sutunlar: [10, 11, 38, 16, 20, 13, 12, 28, 13, 13, 13, 16].map((genislik) => ({ genislik })),
    birlesimler: [],
    dondur: { sutun: 0, satir: 1 },
    suzgec: `A1:${ref(basliklar.length - 1, Math.max(n, 1))}`,
  }
}

// ---------------------------------------------------------------------------
// 4) Bilgi — veri tarihleri, kapsam ve sütun açıklamaları
// ---------------------------------------------------------------------------
export interface BilgiGirdisi {
  bugun: string
  uretimZamani: string
  sonHesap: string | null
  sonIrsaliyeYukleme: string | null
  sonOdemeYukleme: string | null
  sonIrsaliyeTarihi: string | null
  sonOdemeTarihi: string | null
  kapsam: string
  firmaSayisi: number
}

export function bilgiPlani(model: BakiyeModeli, b: BilgiGirdisi): SayfaPlani {
  const gizliAylar = model.aylar.filter((a) => a.gizli).map((a) => a.ad)
  const satirlar: Array<[string, string] | null> = [
    ['Rapor', 'Vadeli Bakiyeler — Avrupa Tahsilat Sistemi'],
    ['Üretim zamanı', b.uretimZamani],
    ['Bugün (vade hesabı)', trDate(b.bugun)],
    ['Kapsam', `${b.kapsam} · ${b.firmaSayisi} firma`],
    null,
    ['Son hesap', b.sonHesap ?? '—'],
    ['Son irsaliye yüklemesi', b.sonIrsaliyeYukleme ?? '—'],
    ['Son ödeme yüklemesi', b.sonOdemeYukleme ?? '—'],
    ['En son irsaliye tarihi', b.sonIrsaliyeTarihi ? trDate(b.sonIrsaliyeTarihi) : '—'],
    ['En son ödeme tarihi', b.sonOdemeTarihi ? trDate(b.sonOdemeTarihi) : '—'],
    null,
    ['VADELİ', 'Konsinye irsaliyelerinin o aya düşen taksitleri. Başlıktaki tarih ayın olağan vade günüdür.'],
    ['PEŞİN', `Konsinye Peşin irsaliyeleri. Vadesi ayın 1–${ILK_YARI_SON_GUN}'si arasında olanlar ilk, sonrakiler ikinci PEŞİN sütunundadır.`],
    ['ÖDEME', 'O ayın taksitlerine dağıtılmış tahsilat (borç − kalan). Ödemeler önce peşinleri, sonra en yakın vadeyi kapatır.'],
    ['KALAN', 'O ayın kalan borcu: BORÇ sütunları − ÖDEME. Eksi değerler kırmızı görünür.'],
    ['Camgöbeği sütun', 'İçinde bulunulan aya kadar (dahil) açık kalan ayların toplam kalanı.'],
    ['TOPLAM SATIŞ / ÖDEMELER', 'Bütün ayların (gizli olanlar dahil) BORÇ ve ÖDEME toplamları. KALAN BORÇ ikisinin farkıdır.'],
    ['Gizli sütunlar', gizliAylar.length > 0 ? `Borcu kapanmış geçmiş aylar gizlidir: ${gizliAylar.join(', ')}. Görmek için komşu sütunları seçip sağ tık → Göster.` : 'Gizli ay yok.'],
    ['Hücre notları', 'Köşesi kırmızı işaretli hücrelerde, başlıktaki tarihten farklı vadeler yazılıdır (ör. "15.11: 34.037,00 €").'],
    ['SENET ÇEK', 'Bu bilgi sistemde tutulmuyor; sütun elle doldurulmak üzere boş bırakılır.'],
    ['Taksit Dökümü', 'Tablodaki her tutarın dayanağı olan taksitler. Süzgeçle firma ya da ay seçilebilir; alttaki toplam süzülen satırları toplar.'],
    ['Birim', 'Bütün tutarlar avro (€).'],
  ]
  const hucreler: (PlanHucresi | null)[][] = satirlar.map((s) =>
    s === null
      ? [null, null]
      : [
          { deger: s[0], bicim: { kalin: true, dikey: 'middle', sar: true } },
          { deger: s[1], bicim: { dikey: 'middle', sar: true } },
        ],
  )
  return {
    ad: 'Bilgi',
    yaziBoyu: 10,
    hucreler,
    satirYukseklikleri: satirlar.map((s) => (s && s[1].length > 110 ? 27 : null)),
    sutunlar: [{ genislik: 26 }, { genislik: 110 }],
    birlesimler: [],
  }
}

/** A1:F1'deki durum notu (dosyadaki "İRS:3114 (…)" notunun karşılığı) */
export function durumNotu(b: Pick<BilgiGirdisi, 'bugun' | 'sonIrsaliyeTarihi' | 'sonOdemeTarihi'>): string {
  const parca = [
    b.sonIrsaliyeTarihi ? `SON İRSALİYE: ${trDate(b.sonIrsaliyeTarihi)}` : null,
    b.sonOdemeTarihi ? `SON ÖDEME: ${trDate(b.sonOdemeTarihi)}` : null,
    `RAPOR: ${trDate(b.bugun)}`,
  ].filter(Boolean)
  return parca.join(' · ')
}
