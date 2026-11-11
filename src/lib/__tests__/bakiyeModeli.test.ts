import { describe, expect, it } from 'vitest'
import {
  BOS_BAKIYE_SUZGEC,
  SORUMLUSUZ,
  bakiyeGorunumu,
  bakiyeModeliKur,
  bakiyeSorumlulari,
  type BakiyeGirdisi,
  type BakiyeHucreSatiri,
} from '@/lib/bakiye/model'
import { ayRengi } from '@/lib/bakiye/bicim'
import { VARSAYILAN_KATEGORILER } from '@/lib/kategoriMeta'

// Bakiye tablosu modeli — kullanıcının "Vadeli Bakiyeler" Excel düzeni.
// Kurallar: ay başına VADELİ · PEŞİN · PEŞİN · ÖDEME · KALAN; 12/13 sınırı;
// başlık tarihi 5 / 20 (çoğunluk başka tek gündeyse o gün); kapanan geçmiş ay gizli.

const BUGUN = '2026-11-11'

const FIRMALAR = [
  { id: 'f1', kod: '34 K02', ad: 'KARSEL BOYA', sorumlu: 'ERCAN' },
  { id: 'f2', kod: '34 B01', ad: 'BAKSAN', sorumlu: 'ERCAN' },
  { id: 'f3', kod: '06 Ç01', ad: 'ÇAĞPAŞ BOYA', sorumlu: 'LEVENT' },
  { id: 'f4', kod: '41 A01', ad: 'AKIN İNŞAAT', sorumlu: null },
]

function h(fi: number, kategori: string, vade: string, borc: number, kalan: number, adet = 1, tarihsiz = false): BakiyeHucreSatiri {
  return [fi, 'VADELI', kategori, vade, borc, kalan, adet, tarihsiz]
}

function girdi(hucreler: BakiyeHucreSatiri[]): BakiyeGirdisi {
  return { firmalar: FIRMALAR, hucreler, kategoriler: VARSAYILAN_KATEGORILER }
}

describe('bakiyeModeliKur: sütunlar ve aylar', () => {
  it('her ayda VADELİ · PEŞİN · PEŞİN sütunları; ay adı ve rengi; aylar kesintisiz', () => {
    const m = bakiyeModeliKur(girdi([h(0, 'KONSINYE', '2026-09-05', 1000, 0), h(0, 'KONSINYE', '2026-12-05', 2000, 2000)]), BUGUN)
    expect(m.aylar.map((a) => a.ay)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12'])
    expect(m.aylar.map((a) => a.ad)).toEqual(['EYLÜL', 'EKİM', 'KASIM', 'ARALIK'])
    expect(m.aylar.map((a) => a.renk)).toEqual(['turuncu', 'sari', 'turuncu', 'sari'])
    expect(m.aylar.map((a) => a.konum)).toEqual(['gecmis', 'gecmis', 'bu', 'gelecek'])
    for (const a of m.aylar) {
      expect(a.borcSutunlari.map((s) => s.etiket)).toEqual(['VADELİ', 'PEŞİN', 'PEŞİN'])
      expect(a.borcSutunlari.map((s) => s.anahtar)).toEqual(['KONSINYE', 'KONSINYE_PESIN:1', 'KONSINYE_PESIN:2'])
    }
    // dosyadaki renkler: Ekim sarı, Kasım turuncu, Aralık sarı
    expect([ayRengi('2026-10'), ayRengi('2026-11'), ayRengi('2026-12')]).toEqual(['sari', 'turuncu', 'sari'])
  })

  it('Konsinye Peşin: ayın 1–12\'si ilk, 13–31\'i ikinci sütun; Konsinye hep tek sütun', () => {
    const m = bakiyeModeliKur(
      girdi([
        h(0, 'KONSINYE_PESIN', '2026-11-05', 100, 100),
        h(0, 'KONSINYE_PESIN', '2026-11-12', 200, 200),
        h(0, 'KONSINYE_PESIN', '2026-11-13', 400, 400),
        h(0, 'KONSINYE_PESIN', '2026-11-30', 800, 800),
        h(0, 'KONSINYE', '2026-11-28', 1600, 1600),
      ]),
      BUGUN,
    )
    const hucre = m.satirlar[0].aylar[0]!
    expect(hucre.borc).toEqual([1600, 300, 1200])
    expect(hucre.kalan).toBe(3100)
    expect(hucre.odeme).toBe(0)
  })

  it('başlık tarihi: varsayılan 5 ve 20; kovanın en az yarısı başka tek gündeyse o gün', () => {
    const m = bakiyeModeliKur(
      girdi([
        // Kasım ikinci yarı: 3 taksit 15'inde, 1 taksit 27'sinde → 15-Kas
        h(0, 'KONSINYE_PESIN', '2026-11-15', 300, 300, 3),
        h(1, 'KONSINYE_PESIN', '2026-11-27', 100, 100, 1),
        // Ekim ikinci yarı: dağınık (hiçbiri yarıyı bulmuyor) → 20-Eki
        h(0, 'KONSINYE_PESIN', '2026-10-15', 100, 0, 1),
        h(0, 'KONSINYE_PESIN', '2026-10-25', 100, 0, 1),
        h(0, 'KONSINYE_PESIN', '2026-10-30', 100, 0, 1),
        // Aralık vadeli: hepsi 5'inde → 5-Ara
        h(0, 'KONSINYE', '2026-12-05', 500, 500, 4),
      ]),
      BUGUN,
    )
    const tarih = (ay: string, anahtar: string) => m.aylar.find((a) => a.ay === ay)!.borcSutunlari.find((s) => s.anahtar === anahtar)!.tarih
    expect(tarih('2026-11', 'KONSINYE_PESIN:2')).toBe('2026-11-15')
    expect(tarih('2026-10', 'KONSINYE_PESIN:2')).toBe('2026-10-20')
    expect(tarih('2026-12', 'KONSINYE')).toBe('2026-12-05')
    // verisi olmayan sütun: varsayılan
    expect(tarih('2026-12', 'KONSINYE_PESIN:1')).toBe('2026-12-05')
    expect(tarih('2026-12', 'KONSINYE_PESIN:2')).toBe('2026-12-20')
  })

  it('eşitlikte varsayılan tarih kazanır', () => {
    const m = bakiyeModeliKur(girdi([h(0, 'KONSINYE', '2026-11-05', 100, 100, 2), h(1, 'KONSINYE', '2026-11-15', 100, 100, 2)]), BUGUN)
    expect(m.aylar[0].borcSutunlari[0].tarih).toBe('2026-11-05')
  })

  it('yıl geçişi: bugünkü yıldan farklı aylara yıl eklenir', () => {
    const m = bakiyeModeliKur(girdi([h(0, 'KONSINYE', '2026-12-05', 100, 100), h(0, 'KONSINYE', '2027-02-05', 100, 100)]), BUGUN)
    expect(m.aylar.map((a) => a.ad)).toEqual(['ARALIK', 'OCAK 2027', 'ŞUBAT 2027'])
  })

  it('VADELI tarafına sonradan eklenen kategori kendi sütununu alır; PESIN tarafı tabloya girmez', () => {
    const kategoriler = [
      ...VARSAYILAN_KATEGORILER,
      { kod: 'PROJE', ad: 'Proje Satışı', kisa_ad: 'Proje', renk: 'mor', taraf: 'VADELI' as const, sira: 40, aktif: true, sistem: false, sayfada_suzgec: true, panoda_kart: false },
    ]
    const m = bakiyeModeliKur(
      {
        firmalar: FIRMALAR,
        kategoriler,
        hucreler: [h(0, 'PROJE', '2026-11-10', 700, 700), h(0, 'KONSINYE', '2026-11-05', 100, 100), [0, 'PESIN', 'PESIN', '2026-11-03', 999, 999, 1, false]],
      },
      BUGUN,
    )
    expect(m.aylar[0].borcSutunlari.map((s) => s.etiket)).toEqual(['VADELİ', 'PEŞİN', 'PEŞİN', 'PROJE'])
    expect(m.satirlar[0].aylar[0]!.borc).toEqual([100, 0, 0, 700])
    expect(m.toplam.borc).toBe(800)
  })
})

describe('bakiyeModeliKur: notlar', () => {
  it('başlık tarihine uymayan vadeler hücre notu olur; uyanlar ve notsuz hücreler null', () => {
    const m = bakiyeModeliKur(
      girdi([
        h(0, 'KONSINYE', '2026-11-05', 14783000, 14783000, 9),
        h(0, 'KONSINYE', '2026-11-15', 3403700, 3403700, 1),
        h(1, 'KONSINYE', '2026-11-05', 500, 500, 1),
        h(1, 'KONSINYE_PESIN', '2026-11-20', 900, 900, 1, true),
      ]),
      BUGUN,
    )
    const karsel = m.satirlar.find((s) => s.kod === '34 K02')!.aylar[0]!
    expect(karsel.borc[0]).toBe(18186700)
    expect(karsel.notlar[0]).toEqual(['15.11: 34.037,00 €'])
    expect(karsel.notlar[1]).toBeNull()
    const baksan = m.satirlar.find((s) => s.kod === '34 B01')!.aylar[0]!
    expect(baksan.notlar[0]).toBeNull()
    // vade girilmemiş taksit, başlık tarihinde olsa da not düşer
    expect(baksan.notlar[2]).toEqual(['20.11: 9,00 € (vade girilmedi)'])
  })
})

describe('bakiyeModeliKur: toplamlar, gizli aylar, birikimli sütun', () => {
  const veri = girdi([
    // Eylül: tamamen ödendi → gizli
    h(0, 'KONSINYE', '2026-09-05', 1000, 0),
    h(1, 'KONSINYE_PESIN', '2026-09-20', 500, 0),
    // Ekim: geçmiş ama açık → görünür
    h(0, 'KONSINYE', '2026-10-05', 2000, 600),
    // Kasım (bu ay)
    h(0, 'KONSINYE', '2026-11-05', 3000, 3000),
    h(2, 'KONSINYE_PESIN', '2026-11-20', 800, 800),
    // Aralık
    h(3, 'KONSINYE', '2026-12-05', 400, 400),
  ])
  const m = bakiyeModeliKur(veri, BUGUN)

  it('kapanan geçmiş ay gizli; açık geçmiş ay ve gelecek aylar görünür', () => {
    expect(m.aylar.map((a) => [a.ay, a.gizli])).toEqual([
      ['2026-09', true],
      ['2026-10', false],
      ['2026-11', false],
      ['2026-12', false],
    ])
  })

  it('ödeme = borç − kalan; satır ve genel toplamlar hücre toplamına eşit', () => {
    const karsel = m.satirlar.find((s) => s.kod === '34 K02')!
    expect([karsel.toplamBorc, karsel.toplamOdeme, karsel.toplamKalan]).toEqual([6000, 2400, 3600])
    expect(m.toplam.borc).toBe(1000 + 500 + 2000 + 3000 + 800 + 400)
    expect(m.toplam.kalan).toBe(600 + 3000 + 800 + 400)
    expect(m.toplam.odeme).toBe(m.toplam.borc - m.toplam.kalan)
    // ay toplamları
    const ekim = m.aylar[1].toplam
    expect([ekim.borc, ekim.odeme, ekim.kalan]).toEqual([[2000, 0, 0], 1400, 600])
    // her ayda: borçlar − ödeme = kalan
    for (const a of m.aylar) expect(a.toplam.borc.reduce((x, y) => x + y, 0) - a.toplam.odeme).toBe(a.toplam.kalan)
  })

  it('gecikmiş: vadesi bugünden önce olan kalan (bugünün vadesi gecikmiş değil)', () => {
    const karsel = m.satirlar.find((s) => s.kod === '34 K02')!
    expect(karsel.gecikmis).toBe(600 + 3000) // 05.10 ve 05.11 geçti
    expect(m.satirlar.find((s) => s.kod === '06 Ç01')!.gecikmis).toBe(0) // 20.11 henüz gelmedi
    const bugunVadeli = bakiyeModeliKur(girdi([h(0, 'KONSINYE', BUGUN, 100, 100)]), BUGUN)
    expect(bugunVadeli.toplam.gecikmis).toBe(0)
  })

  it('birikimli sütun: bu aydan sonra; ilk açık aydan bu aya kadar kalan; başlık EKİM / KASIM / TOPLAMI', () => {
    expect(m.birikimliSonrasi).toBe(2) // Kasım grubundan sonra
    expect(m.birikimliBaslik).toEqual(['EKİM', 'KASIM', 'TOPLAMI'])
    expect(m.toplam.birikimli).toBe(600 + 3000 + 800)
    expect(m.satirlar.find((s) => s.kod === '41 A01')!.birikimli).toBe(0) // yalnız Aralık borcu var
  })

  it('yalnız bu ay açıksa başlığın ilk satırı boş; bütün aylar gelecekteyse sütun yok', () => {
    const yalnizBuAy = bakiyeModeliKur(girdi([h(0, 'KONSINYE', '2026-10-05', 100, 0), h(0, 'KONSINYE', '2026-11-05', 100, 100)]), BUGUN)
    expect(yalnizBuAy.birikimliBaslik).toEqual(['', 'KASIM', 'TOPLAMI'])
    const gelecek = bakiyeModeliKur(girdi([h(0, 'KONSINYE', '2026-12-05', 100, 100)]), BUGUN)
    expect(gelecek.birikimliSonrasi).toBeNull()
  })

  it('veri yoksa boş model', () => {
    const bos = bakiyeModeliKur(girdi([]), BUGUN)
    expect(bos.aylar).toEqual([])
    expect(bos.satirlar).toEqual([])
    expect(bos.toplam).toEqual({ borc: 0, odeme: 0, kalan: 0, gecikmis: 0, birikimli: 0 })
  })
})

describe('sıra, sorumlu blokları, süzme', () => {
  const m = bakiyeModeliKur(
    girdi([
      h(0, 'KONSINYE', '2026-11-05', 100, 100),
      h(1, 'KONSINYE', '2026-10-05', 300, 0),
      h(2, 'KONSINYE', '2026-12-05', 500, 500),
      h(3, 'KONSINYE', '2026-10-05', 700, 700),
    ]),
    BUGUN,
  )

  it('sorumluya göre (boş sonda), sonra ada göre; bloklar sırayla numaralanır', () => {
    expect(m.satirlar.map((s) => [s.sorumlu, s.ad, s.sorumluBlok])).toEqual([
      ['ERCAN', 'BAKSAN', 0],
      ['ERCAN', 'KARSEL BOYA', 0],
      ['LEVENT', 'ÇAĞPAŞ BOYA', 1],
      [null, 'AKIN İNŞAAT', 2],
    ])
    expect(bakiyeSorumlulari(m)).toEqual(['ERCAN', 'LEVENT'])
  })

  it('süzgeçler: arama (Türkçe harf duyarsız), sorumlu, sorumlusuz, yalnız gecikmiş, borcu bitenleri gizle', () => {
    expect(bakiyeGorunumu(m, { ...BOS_BAKIYE_SUZGEC, arama: 'cagpas' }).satirlar.map((s) => s.kod)).toEqual(['06 Ç01'])
    expect(bakiyeGorunumu(m, { ...BOS_BAKIYE_SUZGEC, arama: '34k' }).satirlar.map((s) => s.kod)).toEqual(['34 K02'])
    expect(bakiyeGorunumu(m, { ...BOS_BAKIYE_SUZGEC, sorumlu: 'ERCAN' }).satirlar).toHaveLength(2)
    expect(bakiyeGorunumu(m, { ...BOS_BAKIYE_SUZGEC, sorumlu: SORUMLUSUZ }).satirlar.map((s) => s.kod)).toEqual(['41 A01'])
    expect(bakiyeGorunumu(m, { ...BOS_BAKIYE_SUZGEC, yalnizGecikmis: true }).satirlar.map((s) => s.kod)).toEqual(['34 K02', '41 A01'])
    expect(bakiyeGorunumu(m, { ...BOS_BAKIYE_SUZGEC, bitenleriGizle: true }).satirlar.map((s) => s.kod)).not.toContain('34 B01')
  })

  it('süzünce toplamlar ve gizli aylar kalan satırlara göre yeniden hesaplanır', () => {
    // Tümünde Ekim açık (Akın 700 kalan); yalnız ERCAN süzülünce Ekim kapanır → gizli
    expect(m.aylar[0].gizli).toBe(false)
    const ercan = bakiyeGorunumu(m, { ...BOS_BAKIYE_SUZGEC, sorumlu: 'ERCAN' })
    expect(ercan.aylar[0].gizli).toBe(true)
    expect(ercan.toplam).toEqual({ borc: 400, odeme: 300, kalan: 100, gecikmis: 100, birikimli: 100 })
    expect(ercan.birikimliBaslik).toEqual(['', 'KASIM', 'TOPLAMI'])
    // özgün model değişmedi
    expect(m.toplam.borc).toBe(1600)
    expect(m.satirlar).toHaveLength(4)
  })

  it('sıralama: kalan ve gecikmiş çoktan aza; firma adı', () => {
    expect(bakiyeGorunumu(m, BOS_BAKIYE_SUZGEC, 'kalan').satirlar.map((s) => s.kod)).toEqual(['41 A01', '06 Ç01', '34 K02', '34 B01'])
    expect(bakiyeGorunumu(m, BOS_BAKIYE_SUZGEC, 'gecikmis').satirlar.map((s) => s.kod)).toEqual(['41 A01', '34 K02', '06 Ç01', '34 B01'])
    expect(bakiyeGorunumu(m, BOS_BAKIYE_SUZGEC, 'ad').satirlar.map((s) => s.ad)).toEqual(['AKIN İNŞAAT', 'BAKSAN', 'ÇAĞPAŞ BOYA', 'KARSEL BOYA'])
  })
})
