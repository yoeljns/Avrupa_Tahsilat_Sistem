import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { RENK, SAYI_BICIMI } from '@/lib/bakiye/bicim'
import { BOS_BAKIYE_SUZGEC, bakiyeModeliKur, type BakiyeDokumSatiri, type BakiyeHucreSatiri } from '@/lib/bakiye/model'
import {
  alacaklilarPlani,
  excelTarihi,
  sutunHarfi,
  sutunYerlesimi,
  tablodakiSutun,
  taksitDokumuPlani,
  vadeliBakiyelerPlani,
  type PlanHucresi,
  type SayfaPlani,
} from '@/lib/bakiye/sayfaPlani'
import { excelSinamasi } from '@/lib/export/belgeSinamasi'
import { kitapYaz } from '@/lib/export/exceljsYaz'
import { kapsamYazisi, vadeliBakiyelerPlanlari } from '@/lib/export/vadeliBakiyeler'
import { VARSAYILAN_KATEGORILER } from '@/lib/kategoriMeta'
import type { BakiyeVerisi } from '@/lib/queries'

// Excel sayfa planı — kullanıcının "Vadeli Bakiyeler" dosyasının biçim sözleşmesi:
// 6 sabit sütun + ay başına (VADELİ · PEŞİN · PEŞİN · ÖDEME · KALAN), üç başlık satırı,
// TOPLAM satırı, ay başına birleşik "kalan" satırı; renkler, formüller, gizli aylar, notlar.

const BUGUN = '2026-11-11'
const FIRMALAR = [
  { id: 'f1', kod: '34 K02', ad: 'KARSEL BOYA', sorumlu: 'ERCAN' },
  { id: 'f2', kod: '34 B01', ad: 'BAKSAN', sorumlu: 'ERCAN' },
  { id: 'f3', kod: '06 Ç01', ad: 'ÇAĞPAŞ BOYA', sorumlu: 'LEVENT' },
]
const h = (fi: number, kategori: string, vade: string, borc: number, kalan: number, adet = 1, tarihsiz = false): BakiyeHucreSatiri => [fi, 'VADELI', kategori, vade, borc, kalan, adet, tarihsiz]

const HUCRELER: BakiyeHucreSatiri[] = [
  // Eylül: kapandı → gizli
  h(0, 'KONSINYE', '2026-09-05', 100000, 0),
  // Ekim: açık
  h(0, 'KONSINYE', '2026-10-05', 200000, 60000),
  h(1, 'KONSINYE_PESIN', '2026-10-20', 50000, 0),
  // Kasım
  h(0, 'KONSINYE', '2026-11-05', 14783000, 14783000, 9),
  h(0, 'KONSINYE', '2026-11-15', 3403700, 3403700, 1),
  h(1, 'KONSINYE_PESIN', '2026-11-05', 1794392, 1794392),
  h(2, 'KONSINYE_PESIN', '2026-11-20', 1631215, 0),
  // Aralık
  h(2, 'KONSINYE', '2026-12-05', 1621510, 1621510),
]
const model = bakiyeModeliKur({ firmalar: FIRMALAR, hucreler: HUCRELER, kategoriler: VARSAYILAN_KATEGORILER }, BUGUN)
const plan = vadeliBakiyelerPlani(model, 'SON İRSALİYE: 23.09.2026 · SON ÖDEME: 18.09.2026 · RAPOR: 11.11.2026')

/** 'G4' → plan hücresi */
function hucre(p: SayfaPlani, adres: string): PlanHucresi | null {
  const m = /^([A-Z]+)(\d+)$/.exec(adres)!
  let c = 0
  for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64
  return p.hucreler[parseInt(m[2], 10) - 1]?.[c - 1] ?? null
}
const formul = (p: SayfaPlani, a: string) => (hucre(p, a)!.deger as { formul: string; sonuc: number }).formul
const sonuc = (p: SayfaPlani, a: string) => (hucre(p, a)!.deger as { formul: string; sonuc: number }).sonuc

describe('yardımcılar', () => {
  it('sütun harfi ve Excel tarihi (dosyadaki 5-Kas hücresi 46331)', () => {
    expect([sutunHarfi(1), sutunHarfi(26), sutunHarfi(27), sutunHarfi(52), sutunHarfi(58)]).toEqual(['A', 'Z', 'AA', 'AZ', 'BF'])
    expect(excelTarihi('2026-11-05')).toBe(46331)
    expect(excelTarihi('2026-12-15')).toBe(46371)
  })
})

describe('vadeliBakiyelerPlani: yerleşim', () => {
  // Aylar: Eyl (G–K), Eki (L–P), Kas (Q–U), birikimli (V), Ara (W–AA)
  it('sütun yerleşimi: ay başına 5 sütun, birikimli sütun bu aydan sonra', () => {
    const y = sutunYerlesimi(model)
    expect(y.aylar.map((a) => [sutunHarfi(a.ilk + 1), sutunHarfi(a.odeme + 1), sutunHarfi(a.kalan + 1)])).toEqual([
      ['G', 'J', 'K'],
      ['L', 'O', 'P'],
      ['Q', 'T', 'U'],
      ['W', 'Z', 'AA'],
    ])
    expect(sutunHarfi(y.birikimli! + 1)).toBe('V')
    expect(y.genislik).toBe(27)
  })

  it('dondurma 6 sütun 3 satır; satır yükseklikleri; A–F genişlikleri dosyadaki gibi (FİRMA ADI geniş)', () => {
    expect(plan.dondur).toEqual({ sutun: 6, satir: 3 })
    expect(plan.satirYukseklikleri).toEqual([15.75, 15.75, 26.25, 15, 15, 15, 15, 15.75])
    expect(plan.sutunlar.slice(0, 6).map((s) => s.genislik)).toEqual([8.5703125, 8.7109375, 34, 12.28515625, 12.28515625, 11.7109375])
    expect(plan.suzgec).toBeUndefined() // dosyada da süzgeç yok
    expect(plan.yazdirma).toEqual({ yatay: true, baslikSatirlari: '1:3', baslikSutunlari: 'A:F' })
  })

  it('gizleme: kapanmış geçmiş ayın 5 sütunu gizli, diğerleri açık (genişlikleri de yazılır)', () => {
    const gizli = plan.sutunlar.map((s, i) => (s.gizli ? sutunHarfi(i + 1) : null)).filter(Boolean)
    expect(gizli).toEqual(['G', 'H', 'I', 'J', 'K'])
    expect(plan.sutunlar.slice(6).every((s) => s.genislik === 11.28515625)).toBe(true)
  })

  it('birleştirmeler: A1:F1, son satırda E:F ve ay başına 5 sütun', () => {
    expect(plan.birlesimler).toEqual(['A1:F1', 'E8:F8', 'G8:K8', 'L8:P8', 'Q8:U8', 'W8:AA8'])
  })
})

describe('vadeliBakiyelerPlani: başlıklar ve renkler', () => {
  it('1. satır: durum notu, BORÇ sütunlarında tarih (d-mmm), KALAN üstünde ay adı', () => {
    expect(hucre(plan, 'A1')!.deger).toContain('SON ÖDEME: 18.09.2026')
    expect([hucre(plan, 'Q1')!.deger, hucre(plan, 'R1')!.deger, hucre(plan, 'S1')!.deger]).toEqual([46331, 46331, 46346]) // 5-Kas, 5-Kas, 20-Kas
    expect(hucre(plan, 'Q1')!.bicim.sayiBicimi).toBe(SAYI_BICIMI.gunAy)
    expect(hucre(plan, 'T1')!.deger).toBeNull()
    expect(hucre(plan, 'U1')!.deger).toBe('KASIM')
    expect(hucre(plan, 'AA1')!.deger).toBe('ARALIK')
  })

  it('2. ve 3. satır: VADELİ · PEŞİN · PEŞİN / BORÇ · BORÇ · BORÇ · ÖDEME · KALAN', () => {
    expect(['Q2', 'R2', 'S2', 'T2', 'U2'].map((a) => hucre(plan, a)!.deger)).toEqual(['VADELİ', 'PEŞİN', 'PEŞİN', null, 'TOPLAM'])
    expect(['Q3', 'R3', 'S3', 'T3', 'U3'].map((a) => hucre(plan, a)!.deger)).toEqual(['BORÇ', 'BORÇ', 'BORÇ', 'ÖDEME', 'KALAN'])
    expect(['A3', 'B3', 'C3', 'D3', 'E3', 'F3'].map((a) => hucre(plan, a)!.deger)).toEqual(['SORUMLU', 'SENET ÇEK', 'FİRMA ADI', 'TOPLAM SATIŞ', 'ÖDEMELER', 'KALAN BORÇ'])
  })

  it('ay renkleri: Ekim sarı, Kasım turuncu, Aralık sarı — 1.–2. satır, KALAN sütunu, TOPLAM ve son satır; 3. satır dolgusuz', () => {
    const dolgu = (a: string) => hucre(plan, a)!.bicim.dolgu
    for (const a of ['Q1', 'T1', 'U1', 'Q2', 'U2', 'U4', 'Q7', 'T7', 'U7', 'Q8', 'U8']) expect(dolgu(a), a).toBe(RENK.turuncu)
    for (const a of ['L1', 'P2', 'P4', 'L7', 'L8', 'W1', 'AA4', 'W7', 'AA8']) expect(dolgu(a), a).toBe(RENK.sari)
    for (const a of ['Q3', 'T3', 'U3', 'A3', 'V3']) expect(dolgu(a), a).toBeUndefined()
    // BORÇ ve ÖDEME veri hücreleri beyaz
    for (const a of ['Q4', 'R4', 'S4', 'T4']) expect(dolgu(a), a).toBe(RENK.beyaz)
  })

  it('sabit sütun renkleri ve birikimli sütun (camgöbeği, başlık EKİM / KASIM / TOPLAMI)', () => {
    expect(hucre(plan, 'D4')!.bicim).toMatchObject({ dolgu: RENK.mavi, kalin: true, sayiBicimi: SAYI_BICIMI.tutar, yatay: 'right' })
    expect(hucre(plan, 'E4')!.bicim).toMatchObject({ dolgu: RENK.beyaz, kalin: true })
    expect(hucre(plan, 'F4')!.bicim).toMatchObject({ dolgu: RENK.kalanBorc, kalin: true, sayiBicimi: SAYI_BICIMI.kalan })
    expect(['V1', 'V2', 'V3'].map((a) => hucre(plan, a)!.deger)).toEqual(['EKİM', 'KASIM', 'TOPLAMI'])
    for (const a of ['V1', 'V2', 'V4', 'V7', 'V8']) expect(hucre(plan, a)!.bicim.dolgu, a).toBe(RENK.birikimli)
    expect(hucre(plan, 'U4')!.bicim).toMatchObject({ kalin: true, sayiBicimi: SAYI_BICIMI.kalan, yatay: 'center' })
  })

  it('SORUMLU yazısı sorumlu bloğuna göre kırmızı / siyah; hepsi kalın', () => {
    // sıra: ERCAN (BAKSAN, KARSEL), LEVENT (ÇAĞPAŞ)
    expect(['A4', 'A5', 'A6'].map((a) => hucre(plan, a)!.deger)).toEqual(['ERCAN', 'ERCAN', 'LEVENT'])
    expect(['A4', 'A5', 'A6'].map((a) => hucre(plan, a)!.bicim.yaziRengi)).toEqual([RENK.kirmizi, RENK.kirmizi, RENK.siyah])
    expect(hucre(plan, 'A4')!.bicim.kalin).toBe(true)
    expect(['C4', 'C5', 'C6'].map((a) => hucre(plan, a)!.deger)).toEqual(['BAKSAN', 'KARSEL BOYA', 'ÇAĞPAŞ BOYA'])
  })

  it('kenarlıklar: ince ızgara; grup sol kenarı ve KALAN sağ kenarı orta; başlık altı orta', () => {
    expect(hucre(plan, 'Q4')!.bicim.kenar).toEqual({ sol: 'medium', sag: 'thin', ust: 'thin', alt: 'thin' })
    expect(hucre(plan, 'R4')!.bicim.kenar).toEqual({ sol: 'thin', sag: 'thin', ust: 'thin', alt: 'thin' })
    expect(hucre(plan, 'U4')!.bicim.kenar).toEqual({ sol: 'thin', sag: 'medium', ust: 'thin', alt: 'thin' })
    expect(hucre(plan, 'Q3')!.bicim.kenar!.alt).toBe('medium')
    expect(hucre(plan, 'B3')!.bicim.kenar).toEqual({ sol: 'medium', sag: 'medium', ust: 'medium', alt: 'medium' })
  })
})

describe('vadeliBakiyelerPlani: değerler, formüller, notlar', () => {
  it('BORÇ ve ÖDEME avro olarak; boş olanlar hücre değeri olmadan', () => {
    // KARSEL (5. satır): Kasım vadeli 147.830 + 34.037 = 181.867,00
    expect(hucre(plan, 'Q5')!.deger).toBe(181867)
    expect(hucre(plan, 'R5')!.deger).toBeNull()
    expect(hucre(plan, 'T5')!.deger).toBeNull() // Kasım'da ödeme yok
    expect(hucre(plan, 'O5')!.deger).toBe(1400) // Ekim ödemesi 2.000 − 600
    // ÇAĞPAŞ (6. satır): 20-Kas peşin tamamen ödendi
    expect([hucre(plan, 'S6')!.deger, hucre(plan, 'T6')!.deger]).toEqual([16312.15, 16312.15])
  })

  it('satır formülleri: TOPLAM SATIŞ = BORÇ hücreleri, ÖDEMELER = ÖDEME hücreleri, KALAN BORÇ = fark, ay KALAN = BORÇ\'lar − ÖDEME', () => {
    expect(formul(plan, 'D5')).toBe('G5+H5+I5+L5+M5+N5+Q5+R5+S5+W5+X5+Y5')
    expect(formul(plan, 'E5')).toBe('J5+O5+T5+Z5')
    expect(formul(plan, 'F5')).toBe('D5-E5')
    expect(formul(plan, 'U5')).toBe('Q5+R5+S5-T5')
    expect([sonuc(plan, 'D5'), sonuc(plan, 'E5'), sonuc(plan, 'F5'), sonuc(plan, 'U5'), sonuc(plan, 'P5')]).toEqual([184867, 2400, 182467, 181867, 600])
  })

  it('birikimli sütun: bu aya kadar AÇIK ayların KALAN hücreleri (gizli Eylül girmez)', () => {
    expect(formul(plan, 'V5')).toBe('P5+U5')
    expect(sonuc(plan, 'V5')).toBe(182467)
    expect(sonuc(plan, 'V6')).toBe(0) // ÇAĞPAŞ'ın açık borcu yalnız Aralık'ta
  })

  it('TOPLAM satırı SUM; KALAN BORÇ farktır; son satırda ay başına birleşik kalan formülü', () => {
    expect(hucre(plan, 'C7')!.deger).toBe('TOPLAM')
    expect(formul(plan, 'B7')).toBe('SUM(B4:B6)')
    expect(formul(plan, 'D7')).toBe('SUM(D4:D6)')
    expect(formul(plan, 'F7')).toBe('D7-E7')
    expect(formul(plan, 'Q7')).toBe('SUM(Q4:Q6)')
    expect(formul(plan, 'U7')).toBe('SUM(U4:U6)')
    expect(formul(plan, 'V7')).toBe('SUM(V4:V6)')
    expect(formul(plan, 'Q8')).toBe('Q7+R7+S7-T7')
    expect(sonuc(plan, 'Q8')).toBe(sonuc(plan, 'U7'))
    expect(hucre(plan, 'R8')!.deger).toBeNull() // birleşik aralığın yan hücreleri
    // önbellek sonuçları model toplamları
    expect([sonuc(plan, 'D7'), sonuc(plan, 'E7'), sonuc(plan, 'F7')]).toEqual([model.toplam.borc / 100, model.toplam.odeme / 100, model.toplam.kalan / 100])
  })

  it('not: başlık tarihinden farklı vade hücre notu olur', () => {
    expect(hucre(plan, 'Q5')!.not).toBe('15.11: 34.037,00 €')
    expect(hucre(plan, 'R4')!.not).toBeUndefined()
  })

  it('satır yokken SUM formülü yazılmaz (geçersiz aralık olmasın)', () => {
    const bos = vadeliBakiyelerPlani(bakiyeModeliKur({ firmalar: [], hucreler: [], kategoriler: VARSAYILAN_KATEGORILER }, BUGUN), 'RAPOR: 11.11.2026')
    expect(bos.hucreler).toHaveLength(5)
    expect(hucre(bos, 'D4')!.deger).toBe(0)
    expect(hucre(bos, 'C4')!.deger).toBe('TOPLAM')
    expect(bos.birlesimler).toEqual(['A1:F1', 'E5:F5'])
  })
})

describe('ALACAKLILAR ve Taksit Dökümü', () => {
  it('ALACAKLILAR: dosyadaki biçim (birleşik başlık, kırmızı kalın satırlar, camgöbeği toplam)', () => {
    const p = alacaklilarPlani([
      { ad: 'GÜVEN', alacak: 8794 },
      { ad: 'OLGUN CİVATA', alacak: 40343 },
    ])
    expect(p.birlesimler).toEqual(['A1:A2', 'B1:B2'])
    expect(p.dondur).toEqual({ sutun: 1, satir: 2 })
    expect(hucre(p, 'A1')!.bicim.dolgu).toBe(RENK.alacakBaslik)
    expect(hucre(p, 'A3')!.bicim).toMatchObject({ kalin: true, yaziRengi: RENK.kirmizi })
    expect(hucre(p, 'B4')!.deger).toBe(403.43)
    expect(formul(p, 'B5')).toBe('SUM(B3:B4)')
    expect(sonuc(p, 'B5')).toBe(491.37)
    expect(hucre(p, 'B5')!.bicim.dolgu).toBe(RENK.birikimli)
    // alacak yokken
    expect(hucre(alacaklilarPlani([]), 'B3')!.deger).toBe(0)
  })

  it('Taksit Dökümü: tablodaki sütun etiketi, süzgeç aralığı, süzülen satırları toplayan SUBTOTAL', () => {
    const dokum: BakiyeDokumSatiri[] = [
      [0, 'VADELI', 'KONSINYE', '2026-11-15', 3403700, 3403700, 'AVI2026000002761', '2026-08-12', false],
      [1, 'VADELI', 'KONSINYE_PESIN', '2026-11-05', 1794392, 1794392, 'AVI2026000002305', '2026-10-21', false],
      [2, 'VADELI', 'KONSINYE_PESIN', '2026-11-20', 1631215, 0, 'AVI2026000002100', '2026-10-30', true],
      [0, 'PESIN', 'PESIN', '2026-11-03', 999, 999, 'AVI2026000000001', '2026-11-03', false], // tabloya girmez
    ]
    const p = taksitDokumuPlani(model, FIRMALAR, dokum, (k) => (k === 'KONSINYE' ? 'Konsinye' : 'Konsinye Peşin'))
    expect(p.hucreler).toHaveLength(1 + 3 + 1)
    expect(p.suzgec).toBe('A1:L4')
    expect(p.dondur).toEqual({ sutun: 0, satir: 1 })
    // sıra tablodaki firma sırası: BAKSAN, KARSEL, ÇAĞPAŞ
    expect(['C2', 'C3', 'C4'].map((a) => hucre(p, a)!.deger)).toEqual(['BAKSAN', 'KARSEL BOYA', 'ÇAĞPAŞ BOYA'])
    expect(hucre(p, 'H2')!.deger).toBe('KASIM · PEŞİN (5-Kas)')
    expect(hucre(p, 'H3')!.deger).toBe('KASIM · VADELİ (5-Kas)')
    expect(hucre(p, 'H4')!.deger).toBe('KASIM · PEŞİN (20-Kas)')
    expect([hucre(p, 'I4')!.deger, hucre(p, 'J4')!.deger, hucre(p, 'K4')!.deger, hucre(p, 'L4')!.deger]).toEqual([16312.15, 16312.15, 0, 'vade girilmedi'])
    expect(hucre(p, 'G3')!.deger).toBe(excelTarihi('2026-11-15'))
    expect(formul(p, 'I5')).toBe('SUBTOTAL(109,I2:I4)')
    expect(tablodakiSutun(model, 'KONSINYE_PESIN', '2026-12-13')).toBe('ARALIK · PEŞİN (20-Ara)')
  })
})

describe('çalışma kitabı: dosya yazılır ve yeniden okunur (exceljs)', () => {
  const veri: BakiyeVerisi = {
    run_id: 'r1',
    tazelik: { son_irsaliye_yukleme: '2026-09-23T08:16:38Z', son_odeme_yukleme: '2026-09-23T08:17:00Z', son_irsaliye_tarihi: '2026-09-23', son_odeme_tarihi: '2026-09-18', son_hesap: '2026-11-11T00:00:04Z' },
    firmalar: FIRMALAR,
    hucreler: HUCRELER,
    dokum: [[0, 'VADELI', 'KONSINYE', '2026-11-15', 3403700, 3403700, 'AVI2026000002761', '2026-08-12', false]],
    alacaklar: [
      { firm_id: 'x', kod: '34 G01', ad: 'GÜVEN', sorumlu: 'ERCAN', alacak: 8794 },
      { firm_id: 'y', kod: '06 O01', ad: 'OLGUN CİVATA', sorumlu: null, alacak: 40343 },
    ],
    kategoriler: [...VARSAYILAN_KATEGORILER],
  }

  it('dört sayfa; biçimler, birleştirme, dondurma, gizli sütun, formül ve not dosyada', async () => {
    const { planlar } = vadeliBakiyelerPlanlari(veri, BUGUN, BOS_BAKIYE_SUZGEC, new Date('2026-11-11T09:00:00Z'))
    const baytlar = await kitapYaz(planlar)
    expect(baytlar.subarray(0, 2).toString()).toBe('PK')
    const wb = new ExcelJS.Workbook()
    // exceljs'in bildirdiği Buffer tipi Node'unkinden eski: çalışma zamanında aynı nesne
    await wb.xlsx.load(baytlar as unknown as Parameters<typeof wb.xlsx.load>[0])
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Vadeli Bakiyeler', 'ALACAKLILAR', 'Taksit Dökümü', 'Bilgi'])

    const ws = wb.getWorksheet('Vadeli Bakiyeler')!
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 6, ySplit: 3 })
    expect(ws.pageSetup).toMatchObject({ orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:3', printTitlesColumn: 'A:F' })
    // gizli: Eylül (G–K); açık: Ekim'in ilk sütunu
    expect([ws.getColumn('G').hidden, ws.getColumn('K').hidden, ws.getColumn('L').hidden]).toEqual([true, true, false])
    expect(ws.getColumn('G').width).toBe(11.28515625)
    expect(ws.getRow(3).height).toBe(26.25)
    // birleştirme ve ana hücre değeri korunur
    expect(ws.getCell('A1').isMerged && ws.getCell('F1').isMerged).toBe(true)
    expect(String(ws.getCell('A1').value)).toContain('SON İRSALİYE: 23.09.2026')
    expect(ws.getCell('Q8').isMerged && ws.getCell('U8').isMerged).toBe(true)
    expect(ws.getCell('Q8').value).toMatchObject({ formula: 'Q7+R7+S7-T7' })
    // renkler (ARGB), yazı, sayı biçimi
    const dolgu = (a: string) => (ws.getCell(a).fill as ExcelJS.FillPattern).fgColor?.argb
    expect([dolgu('Q1'), dolgu('U4'), dolgu('L1'), dolgu('D4'), dolgu('F4'), dolgu('V4')]).toEqual(['FFF4B183', 'FFF4B183', 'FFFFFF00', 'FFBDD7EE', 'FFFFE699', 'FF00FFFF'])
    expect(ws.getCell('Q1').numFmt).toBe('d-mmm')
    // dosyada sayı (46331) olarak durur; exceljs tarih biçimli sayıyı okurken Date'e çevirir
    expect(ws.getCell('Q1').value).toEqual(new Date('2026-11-05T00:00:00Z'))
    expect(ws.getCell('A4').font).toMatchObject({ name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFF0000' } })
    // exceljs okurken sayı biçimindeki ters eğik çizgileri atar; dosyadaki tam metin aşağıda ham XML'den denetlenir
    expect(ws.getCell('U4').numFmt).toBe(SAYI_BICIMI.kalan.replace(/\\/g, ''))
    // her hücrenin kendi biçim nesnesi var: bir grubun rengi diğerine sızmaz
    expect(dolgu('P4')).toBe('FFFFFF00')
    // formül + önbellek sonucu
    expect(ws.getCell('D5').value).toMatchObject({ formula: 'G5+H5+I5+L5+M5+N5+Q5+R5+S5+W5+X5+Y5', result: 184867 })
    // not
    const not = ws.getCell('Q5').note
    expect(typeof not === 'string' ? not : JSON.stringify(not)).toContain('15.11: 34.037,00 €')

    // Ham dosya (bağımsız ikinci okuyucu: SheetJS): sayı biçimi dosyadakiyle harfi harfine aynı, not ayrı parçada
    const ham = XLSX.read(baytlar, { type: 'buffer', bookFiles: true }) as XLSX.WorkBook & { files: Record<string, { content: Uint8Array }> }
    const parca = (ad: string) => Buffer.from(ham.files[ad].content).toString('utf8')
    expect(parca('xl/styles.xml')).toContain('formatCode="#,##0.00_ ;[Red]\\-#,##0.00\\ "')
    expect(parca('xl/comments1.xml')).toContain('15.11: 34.037,00 €')
    expect(parca('xl/worksheets/sheet1.xml')).toContain('<pane xSplit="6" ySplit="3" topLeftCell="G4"')
    expect(parca('xl/workbook.xml')).toContain('fullCalcOnLoad="1"')
    expect(ham.SheetNames).toEqual(['Vadeli Bakiyeler', 'ALACAKLILAR', 'Taksit Dökümü', 'Bilgi'])
    // SheetJS de aynı önbellek sonucunu okur (formül sonuçları dosyada)
    expect((ham.Sheets['Vadeli Bakiyeler']['F5'] as XLSX.CellObject).v).toBe(182467)

    const al = wb.getWorksheet('ALACAKLILAR')!
    expect(al.getCell('A3').value).toBe('GÜVEN')
    expect(al.getCell('B5').value).toMatchObject({ formula: 'SUM(B3:B4)', result: 491.37 })
    const dk = wb.getWorksheet('Taksit Dökümü')!
    expect(dk.autoFilter).toBeTruthy()
    expect(dk.getCell('E2').value).toBe('AVI2026000002761')
    expect(String(wb.getWorksheet('Bilgi')!.getCell('B4').value)).toBe('Tüm firmalar · 3 firma')
  })

  it('süzgeç dosyaya da uygulanır: yalnız seçilen sorumlunun firmaları ve alacakları', async () => {
    const { model: m, planlar } = vadeliBakiyelerPlanlari(veri, BUGUN, { ...BOS_BAKIYE_SUZGEC, sorumlu: 'ERCAN' })
    expect(m.satirlar.map((s) => s.kod)).toEqual(['34 B01', '34 K02'])
    expect(planlar[1].hucreler.map((r) => r[0]?.deger)).toEqual(['FİRMA ADI', null, 'GÜVEN', 'TOPLAM'])
    expect(kapsamYazisi({ arama: 'kar', sorumlu: 'ERCAN', yalnizGecikmis: true, bitenleriGizle: false })).toBe('Sorumlu: ERCAN · Arama: "kar" · Yalnız gecikmiş')
  })
})

describe('belge öz-sınaması (/api/saglik?belge=1)', () => {
  it('örnek veriden geçerli bir dosya üretir; yalnız boyut ve süre döner', async () => {
    const s = await excelSinamasi(new Date('2026-11-11T09:00:00Z'))
    expect(s.ok).toBe(true)
    expect(s.bayt).toBeGreaterThan(8000)
    expect(s.hata).toBeUndefined()
    expect(Object.keys(s).sort()).toEqual(['bayt', 'ms', 'ok'])
  })

  it('yıl sonunda (Aralık) gelecek ay yeni yıla taşar', async () => {
    expect((await excelSinamasi(new Date('2026-12-20T09:00:00Z'))).ok).toBe(true)
  })
})
