import { describe, expect, it } from 'vitest'
import { pdfSinamasi } from '@/lib/export/belgeSinamasi'
import { VARSAYILAN_KATEGORILER } from '@/lib/kategoriMeta'
import { metinGenisligi } from '@/lib/pdf/olcu'
import { ICERIK_GENISLIGI } from '@/lib/pdf/parcalar'
import { PDF_KARAKTERLERI, pdfUret } from '@/lib/pdf/pdf'
import type { PanoOzeti, RaporVerisi, YonetimOzeti } from '@/lib/queries'
import { aylariDerle, gunFarki, raporSecenegiOku, tahsilatDurumuKur, type RaporTuru } from '@/lib/rapor/tahsilatDurumu'
import { tahsilatDurumuBelgesi, tahsilatDurumuDosyaAdi } from '@/lib/rapor/tahsilatDurumuPdf'

// Tahsilat Durum Raporu: veri kurucu (saf) ve PDF belgesi.
// Örnek: 3 firma (ERCAN × 2, sorumlusuz × 1), iki taraf, bugün = 11.11.2026.

const BUGUN = '2026-11-11'

const PANO: PanoOzeti = { run_id: 'r1', kosu: null, bakiye: null, vade: null, inceleme: null }

const VERI: RaporVerisi = {
  bakiye: {
    run_id: 'r1',
    tazelik: { son_irsaliye_yukleme: null, son_odeme_yukleme: null, son_irsaliye_tarihi: '2026-10-28', son_odeme_tarihi: '2026-09-18', son_hesap: '2026-11-11T00:00:04Z' },
    firmalar: [
      { id: 'f1', kod: '34 K02', ad: 'KARSEL BOYA', sorumlu: 'ERCAN' },
      { id: 'f2', kod: '34 B01', ad: 'BAKSAN', sorumlu: 'ERCAN' },
      { id: 'f3', kod: '06 Ç01', ad: 'ÇAĞPAŞ BOYA', sorumlu: null },
    ],
    hucreler: [
      [0, 'VADELI', 'KONSINYE', '2026-06-05', 100000, 0, 1, false], // ödendi
      [0, 'VADELI', 'KONSINYE', '2026-08-05', 200000, 60000, 1, false], // 98 gün gecikmiş
      [0, 'VADELI', 'KONSINYE', '2026-11-17', 300000, 300000, 1, false], // bugün + 6 → 7 güne girer
      [0, 'VADELI', 'KONSINYE', '2026-11-18', 50000, 50000, 1, false], // bugün + 7 → 7 güne girmez
      [0, 'VADELI', 'KONSINYE', '2026-12-10', 70000, 70000, 1, false], // bugün + 29 → 30 güne girer
      [0, 'VADELI', 'KONSINYE', '2026-12-11', 80000, 80000, 1, false], // bugün + 30 → 30 güne girmez
      [1, 'PESIN', 'PESIN', '2026-10-20', 40000, 15000, 1, false], // peşin, 22 gün gecikmiş
      [1, 'VADELI', 'KONSINYE_PESIN', '2026-09-20', 90000, 90000, 1, false], // 52 gün gecikmiş
      [2, 'VADELI', 'KONSINYE', '2026-08-25', 120000, 20000, 1, false], // 78 gün gecikmiş
      [2, 'PESIN', 'PESIN', '2026-11-11', 30000, 30000, 1, false], // vadesi bugün → gecikmiş değil
    ],
    dokum: null,
    alacaklar: [
      { firm_id: 'f2', kod: '34 B01', ad: 'BAKSAN', sorumlu: 'ERCAN', alacak: 5000 },
      { firm_id: 'x9', kod: '35 Z09', ad: 'ZAFER', sorumlu: null, alacak: 12000 }, // taksiti olmayan alacaklı
    ],
    kategoriler: [...VARSAYILAN_KATEGORILER],
  },
  tahsilat: [
    ['f1', '2026-06', 100000, '2026-06-10'],
    ['f1', '2026-09', 140000, '2026-09-12'],
    ['f2', '2026-09', 25000, '2026-09-18'],
    ['f3', '2026-08', 60000, '2026-08-30'],
    ['f3', null, 40000, null], // ödeme tarihi yok
  ],
  pano: PANO,
  yonetim: null,
}

const kur = (sorumlu = '', ay: string | null = null, veri: RaporVerisi = VERI) => tahsilatDurumuKur(veri, BUGUN, { tur: 'ozet', sorumlu, ay })

describe('tahsilatDurumuKur: ana rakamlar', () => {
  const d = kur()

  it('toplamlar: borç, ödeme (borca işlenen), kalan; toplam tahsilat = ödeme + alacak', () => {
    expect(d.ozet).toMatchObject({ firma: 3, borc: 1080000, odeme: 365000, kalan: 715000, alacak: 17000, toplamTahsilat: 382000, pesinKalan: 45000, vadeliKalan: 670000 })
    expect(d.ozet.borcluFirma).toBe(3)
    expect(d.kapsam).toBe('Tüm firmalar')
    expect(d.suzuldu).toBe(false)
  })

  it('vadesi geçmiş: vade < bugün (peşin dahil); vadesi bugün olan gecikmiş sayılmaz', () => {
    expect(d.ozet).toMatchObject({ gecikmis: 185000, gecikmisPesin: 15000, gecikmisVadeli: 170000, gecikenFirma: 3 })
  })

  it('7 / 30 gün: konsinye, bugün dahil (bugün+6 girer, +7 girmez; +29 girer, +30 girmez)', () => {
    expect(d.ozet.gun7).toBe(300000)
    expect(d.ozet.gun30).toBe(420000)
  })

  it('yaşlandırma beş dilim; toplamı kalan borca eşit', () => {
    expect(d.yaslandirma.map((y) => y.tutar)).toEqual([530000, 15000, 90000, 20000, 60000])
    expect(d.yaslandirma.reduce((t, y) => t + y.tutar, 0)).toBe(d.ozet.kalan)
  })

  it('veri yaşı: son ödeme kaydından bugüne gün', () => {
    expect(d.veriYasi).toBe(54)
    expect(gunFarki('2026-12-31', '2027-01-01')).toBe(1)
    expect(gunFarki('2026-11-11', '2026-11-11')).toBe(0)
  })
})

describe('tahsilatDurumuKur: kırılımlar', () => {
  const d = kur()

  it('kategori kırılımı panel sırasıyla; toplamı genel toplam', () => {
    expect(d.kategoriler).toEqual([
      { kod: 'PESIN', ad: 'Peşin', borc: 70000, odeme: 25000, kalan: 45000, gecikmis: 15000, firma: 2 },
      { kod: 'KONSINYE', ad: 'Konsinye', borc: 920000, odeme: 340000, kalan: 580000, gecikmis: 80000, firma: 2 },
      { kod: 'KONSINYE_PESIN', ad: 'Konsinye Peşin', borc: 90000, odeme: 0, kalan: 90000, gecikmis: 90000, firma: 1 },
    ])
    expect(d.kategoriler.reduce((t, k) => t + k.kalan, 0)).toBe(d.ozet.kalan)
    expect(d.kategoriler.reduce((t, k) => t + k.gecikmis, 0)).toBe(d.ozet.gecikmis)
  })

  it('sorumlu kırılımı: sorumlusuzlar sonda; taksiti olmayan alacaklı da sayılır; toplamı genel toplam', () => {
    expect(d.sorumlular).toEqual([
      { ad: 'ERCAN', anahtar: 'ERCAN', firma: 2, borc: 930000, odeme: 265000, kalan: 665000, gecikmis: 165000, alacak: 5000 },
      { ad: 'Sorumlusu yok', anahtar: '-', firma: 1, borc: 150000, odeme: 100000, kalan: 50000, gecikmis: 20000, alacak: 12000 },
    ])
    for (const alan of ['borc', 'odeme', 'kalan', 'gecikmis', 'alacak'] as const) {
      expect(d.sorumlular.reduce((t, s) => t + s[alan], 0), alan).toBe(d.ozet[alan])
    }
  })

  it('aylar kesintisiz: vade ayına göre borç / kalan, ödeme ayına göre tahsilat; tarihsiz ödeme ayrı', () => {
    expect(d.aylar.map((a) => [a.ay, a.vadeBorc, a.vadeKalan, a.tahsilat])).toEqual([
      ['2026-06', 100000, 0, 100000],
      ['2026-07', 0, 0, 0],
      ['2026-08', 320000, 80000, 60000],
      ['2026-09', 90000, 90000, 165000],
      ['2026-10', 40000, 15000, 0],
      ['2026-11', 380000, 380000, 0],
      ['2026-12', 150000, 150000, 0],
    ])
    expect(d.aylar[0].ad).toBe('Haziran 2026')
    expect(d.tarihsizTahsilat).toBe(40000)
    // aylık tahsilat + tarihsiz = borca işlenen ödeme
    expect(d.aylar.reduce((t, a) => t + a.tahsilat, 0) + d.tarihsizTahsilat).toBe(d.ozet.odeme)
    expect(d.aylar.reduce((t, a) => t + a.vadeBorc, 0)).toBe(d.ozet.borc)
  })

  it('aylariDerle: son 12 ay ve sonrası tek tek; daha eskiler tek satırda; toplamlar korunur', () => {
    const ay = (a: string, vadeBorc: number, vadeKalan: number, tahsilat: number) => ({ ay: a, ad: a, vadeBorc, vadeKalan, tahsilat })
    const aylar = [ay('2025-01', 0, 0, 10), ay('2025-02', 0, 0, 20), ay('2025-11', 100, 5, 30), ay('2025-12', 200, 0, 40), ay('2026-11', 300, 300, 0), ay('2027-01', 50, 50, 0)]
    const derli = aylariDerle(aylar, '2026-11')
    // ilk gösterilen ay: Aralık 2025 (bu ay dahil 12 ay); öncesi tek satır
    expect(derli.map((a) => a.ay)).toEqual([null, '2025-12', '2026-11', '2027-01'])
    expect(derli[0]).toEqual({ ay: null, ad: 'Aralık 2025 öncesi', vadeBorc: 100, vadeKalan: 5, tahsilat: 60 })
    for (const alan of ['vadeBorc', 'vadeKalan', 'tahsilat'] as const) {
      expect(derli.reduce((t, a) => t + a[alan], 0), alan).toBe(aylar.reduce((t, a) => t + a[alan], 0))
    }
    // toplanacak tek ay varsa ya da hiç yoksa liste aynen kalır
    expect(aylariDerle(aylar.slice(2), '2026-11')).toEqual(aylar.slice(2))
    expect(aylariDerle(aylar.slice(3), '2026-11')).toEqual(aylar.slice(3))
    expect(aylariDerle([], '2026-11')).toEqual([])
    // geçmiş penceresi ayarlanabilir
    expect(aylariDerle(aylar, '2026-11', 24).map((a) => a.ay)).toEqual(['2025-01', '2025-02', '2025-11', '2025-12', '2026-11', '2027-01'])
    expect(aylariDerle(aylar, '2026-11', 1).map((a) => a.ay)).toEqual([null, '2026-11', '2027-01'])
  })

  it('dönem: ay verilmezse tahsilat kaydı olan son ay; firmalar çoktan aza', () => {
    expect(d.donem).toEqual({
      ay: '2026-09',
      ad: 'Eylül 2026',
      otomatik: true,
      toplam: 165000,
      firmalar: [
        { kod: '34 K02', ad: 'KARSEL BOYA', sorumlu: 'ERCAN', tutar: 140000 },
        { kod: '34 B01', ad: 'BAKSAN', sorumlu: 'ERCAN', tutar: 25000 },
      ],
    })
    const agustos = kur('', '2026-08').donem
    expect(agustos).toMatchObject({ ay: '2026-08', otomatik: false, toplam: 60000 })
    expect(agustos.firmalar.map((f) => f.kod)).toEqual(['06 Ç01'])
    // tahsilatı olmayan ay da seçilebilir
    expect(kur('', '2026-11').donem).toMatchObject({ ay: '2026-11', toplam: 0, firmalar: [] })
  })

  it('en çok geciken: tutara göre; en eski vade, gün ve son tahsilat firma başına', () => {
    expect(d.enCokGeciken.map((f) => [f.kod, f.gecikmis, f.enEskiVade, f.gecikmeGunu, f.sonTahsilat])).toEqual([
      ['34 B01', 105000, '2026-09-20', 52, '2026-09-18'],
      ['34 K02', 60000, '2026-08-05', 98, '2026-09-12'],
      ['06 Ç01', 20000, '2026-08-25', 78, '2026-08-30'],
    ])
    expect(d.firmalar.map((f) => f.kod)).toEqual(['34 B01', '34 K02', '06 Ç01']) // ERCAN (ad sırası), sonra sorumlusuz
    expect(d.firmalar.find((f) => f.kod === '34 K02')).toMatchObject({ enYakinVade: '2026-11-17', alacak: 0, borc: 800000, kalan: 560000 })
    expect(d.firmalar.find((f) => f.kod === '34 B01')!.alacak).toBe(5000)
    expect(d.alacaklilar.map((a) => [a.kod, a.alacak])).toEqual([
      ['35 Z09', 12000],
      ['34 B01', 5000],
    ])
  })
})

describe('tahsilatDurumuKur: süzgeç ve uyarılar', () => {
  it('sorumlu süzgeci bütün rakamlara uygulanır', () => {
    const e = kur('ERCAN')
    expect(e.kapsam).toBe('Sorumlu: ERCAN')
    expect(e.suzuldu).toBe(true)
    expect(e.ozet).toMatchObject({ firma: 2, borc: 930000, odeme: 265000, kalan: 665000, gecikmis: 165000, alacak: 5000, toplamTahsilat: 270000, gun7: 300000 })
    expect(e.sorumlular.map((s) => s.ad)).toEqual(['ERCAN'])
    expect(e.aylar.reduce((t, a) => t + a.tahsilat, 0)).toBe(265000)
    expect(e.tarihsizTahsilat).toBe(0)
    expect(e.donem.toplam).toBe(165000)
    expect(e.yaslandirma.reduce((t, y) => t + y.tutar, 0)).toBe(665000)

    const s = kur('-')
    expect(s.kapsam).toBe('Sorumlusu olmayan firmalar')
    expect(s.ozet).toMatchObject({ firma: 1, borc: 150000, kalan: 50000, alacak: 12000 })
    expect(s.donem).toMatchObject({ ay: '2026-08', toplam: 60000 })

    // olmayan sorumlu → boş rapor (hata vermez)
    const yok = kur('YOK')
    expect(yok.ozet).toMatchObject({ firma: 0, borc: 0, kalan: 0, toplamTahsilat: 0 })
    expect(yok.aylar).toEqual([])
    expect(yok.donem).toMatchObject({ ay: '2026-11', toplam: 0 })
  })

  it('veri uyarıları yalnız yönetim verisi varken üretilir', () => {
    expect(kur().uyarilar).toEqual([])
    const yonetim = {
      kullanicilar: { toplam: 4, aktif: 3, yonetici: 1, tahsilat_yoneticisi: 1, pazarlamaci: 1 },
      firmalar: { toplam: 173, takip_disi: 42, sorumlusuz: 173, sorumlu_eslesmeyen: 0 },
      eslesmeyen_sorumlular: [],
      son_kosu: { started_at: '', finished_at: '', triggered_by: null, trigger_kind: 'cron', kdv_eslesmeyen: 3, kdv_eslesen: 10 },
      saglik: { siniflandirilmamis: 5, siniflandirilmamis_tutar: 100, inceleme: 2, cakisma: 0, plan_okunamadi: 0 },
      tarihsiz_taksit: 14,
      odeme_eur_eksik: { adet: 1, gelen_tl: 930000 },
      son_aktarimlar: [],
      son_degisiklikler: [],
      kategoriler: [],
    } satisfies YonetimOzeti
    const u = kur('', null, { ...VERI, yonetim }).uyarilar
    expect(u).toHaveLength(6)
    expect(u[0]).toContain('5 irsaliye sınıflandırılmadı')
    expect(u.join(' ')).toContain('1 ödemenin EUR tutarı yok')
    expect(u.join(' ')).toContain('3 KDV ödemesi')
    expect(u.join(' ')).toContain('173 firmada sorumlu atanmamış')
  })

  it('seçenekler adresten okunur; geçersiz değerler varsayılana döner', () => {
    expect(raporSecenegiOku(new URLSearchParams('tur=kisa&sorumlu=ERCAN&ay=2026-09'))).toEqual({ tur: 'kisa', sorumlu: 'ERCAN', ay: '2026-09' })
    expect(raporSecenegiOku(new URLSearchParams('tur=baska&ay=2026-13'))).toEqual({ tur: 'ozet', sorumlu: '', ay: null })
    expect(raporSecenegiOku(new URLSearchParams(''))).toEqual({ tur: 'ozet', sorumlu: '', ay: null })
    expect(tahsilatDurumuDosyaAdi('2026-11-11', 'ayrintili', 'ERCAN')).toBe('tahsilat_durumu_ayrintili_ERCAN_2026-11-11.pdf')
    expect(tahsilatDurumuDosyaAdi('2026-11-11', 'kisa', '')).toBe('tahsilat_durumu_kisa_2026-11-11.pdf')
  })
})

describe('PDF belgesi', () => {
  const sayfaSayisi = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\n/g) ?? []).length

  it('üç tür de üretilir: kısa tek sayfa; ayrıntılı en uzunu', async () => {
    const sayfalar: Record<string, number> = {}
    for (const tur of ['kisa', 'ozet', 'ayrintili'] as RaporTuru[]) {
      const d = tahsilatDurumuKur(VERI, BUGUN, { tur, sorumlu: '', ay: null })
      const pdf = await pdfUret(tahsilatDurumuBelgesi(d, tur, '11.11.2026 12:00'))
      expect(pdf.subarray(0, 5).toString('latin1'), tur).toBe('%PDF-')
      sayfalar[tur] = sayfaSayisi(pdf)
    }
    expect(sayfalar.kisa).toBe(1)
    expect(sayfalar.ozet).toBeGreaterThanOrEqual(1)
    expect(sayfalar.ayrintili).toBeGreaterThan(sayfalar.ozet)
  })

  it('boş veriyle (firma yok, ödeme yok) de belge üretilir', async () => {
    const bos: RaporVerisi = { bakiye: { ...VERI.bakiye, tazelik: null, firmalar: [], hucreler: [], alacaklar: [] }, tahsilat: [], pano: PANO, yonetim: null }
    for (const tur of ['kisa', 'ozet', 'ayrintili'] as RaporTuru[]) {
      const d = tahsilatDurumuKur(bos, BUGUN, { tur, sorumlu: '', ay: null })
      expect(d.veriYasi).toBeNull()
      const pdf = await pdfUret(tahsilatDurumuBelgesi(d, tur, '11.11.2026 12:00'))
      expect(sayfaSayisi(pdf), tur).toBe(1)
    }
  })

  it('aynı belge tanımı iki kez kurulup üretilebilir (her çağrıda yeni ağaç)', async () => {
    const d = kur()
    const a = await pdfUret(tahsilatDurumuBelgesi(d, 'ozet', 'x'))
    const b = await pdfUret(tahsilatDurumuBelgesi(d, 'ozet', 'x'))
    expect(sayfaSayisi(a)).toBe(sayfaSayisi(b))
    expect(Math.abs(a.length - b.length)).toBeLessThan(200)
  })

  it('rapordaki sabit metinlerin bütün karakterleri yazı tipinde var', () => {
    const topla = (dugum: unknown, out: string[] = []): string[] => {
      if (Array.isArray(dugum)) for (const d of dugum) topla(d, out)
      else if (dugum && typeof dugum === 'object') {
        const o = dugum as Record<string, unknown>
        if (typeof o.text === 'string') out.push(o.text)
        for (const v of Object.values(o)) if (typeof v === 'object') topla(v, out)
      }
      return out
    }
    // veri uyarıları (ok işareti içeren yönlendirmeler) da belgede olsun
    const uyarili: RaporVerisi = {
      ...VERI,
      yonetim: {
        kullanicilar: { toplam: 1, aktif: 1, yonetici: 1, tahsilat_yoneticisi: 0, pazarlamaci: 0 },
        firmalar: { toplam: 3, takip_disi: 0, sorumlusuz: 1, sorumlu_eslesmeyen: 2 },
        eslesmeyen_sorumlular: [],
        son_kosu: { started_at: '', finished_at: '', triggered_by: null, trigger_kind: 'cron', kdv_eslesmeyen: 1, kdv_eslesen: 0 },
        saglik: { siniflandirilmamis: 1, siniflandirilmamis_tutar: 1, inceleme: 1, cakisma: 0, plan_okunamadi: 1 },
        tarihsiz_taksit: 1,
        odeme_eur_eksik: { adet: 1, gelen_tl: 1 },
        son_aktarimlar: [],
        son_degisiklikler: [],
        kategoriler: [],
      },
    }
    expect(tahsilatDurumuKur(uyarili, BUGUN, { tur: 'ozet', sorumlu: '', ay: null }).uyarilar.some((u) => u.includes('→'))).toBe(true)
    for (const tur of ['kisa', 'ozet', 'ayrintili'] as RaporTuru[]) {
      const metinler = topla(tahsilatDurumuBelgesi(tahsilatDurumuKur(uyarili, BUGUN, { tur, sorumlu: '', ay: null }), tur, '11.11.2026 12:00').content)
      expect(metinler.length, tur).toBeGreaterThan(40)
      for (const m of metinler) expect(m, `${tur}: ${m.slice(0, 60)}`).toMatch(PDF_KARAKTERLERI)
    }
  })

  // --- Canlıdaki gibi veri: uzun unvanlar, sorumlu atanmamış, 2025'e uzanan tahsilat ---
  const UNVANLAR = [
    'ŞAHİKA BOYA VE KİMYA SANAYİ İNŞAAT MALZEMELERİ VE TAAHHÜT DOĞALGAZ VE MÜHENDİSLİK HİZMETLERİ NAKLİYAT GIDA İTHALAT İHRACAT TİCARET SANAYİ A.Ş.',
    'SAĞLAM KARO MERMER İMALATI VE MALZEME SATIŞI İNŞAAT VE İNŞ.MALZ.TAAH.NAKLİ.HAF.PAZ.TİC.VE SAN.LTD ŞT',
    'VEGA DOĞU HIRDAVAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ',
    'KORKMAZLAR INSAAT ORMAN ÜR.GIY.GID.SAN.TIC.LTD.STI.',
    'HTK ENDS.ÜRÜN.YAPI.KİM.İÇ VE DIŞ TİC.LTD.ŞTİ',
    'YİĞİT OTOM. VE SANAYİ BOYALARI TOP.TİC-BAYRAM YİĞİT',
    'CENGİZ AKŞEHİRLİOĞLU',
  ]
  const uzunVeri = (sorumlu: (i: number) => string | null): RaporVerisi => {
    const firmalar = Array.from({ length: 60 }, (_, i) => ({ id: `u${i}`, kod: `${String(10 + (i % 70)).padStart(2, '0')} Ş${String(i).padStart(2, '0')}`, ad: `${UNVANLAR[i % UNVANLAR.length]} ${i}`, sorumlu: sorumlu(i) }))
    return {
      bakiye: {
        ...VERI.bakiye,
        firmalar,
        hucreler: firmalar.flatMap((_, i) => [
          [i, 'VADELI', 'KONSINYE', '2026-08-05', 500000 + i * 1000, 200000 + i * 500, 1, false],
          [i, 'VADELI', 'KONSINYE', '2026-12-05', 300000, 300000, 1, false],
          [i, 'PESIN', 'PESIN', '2026-10-01', 90000, i % 3 === 0 ? 45000 : 0, 1, false],
        ] as RaporVerisi['bakiye']['hucreler']),
        alacaklar: firmalar.filter((_, i) => i % 4 === 0).map((f, i) => ({ firm_id: f.id, kod: f.kod, ad: f.ad, sorumlu: f.sorumlu, alacak: 1000 + i })),
      },
      tahsilat: firmalar.flatMap((f, i) => [
        [f.id, `2025-${String((i % 12) + 1).padStart(2, '0')}`, 100000, `2025-${String((i % 12) + 1).padStart(2, '0')}-15`],
        [f.id, '2026-09', 300000 + i, '2026-09-10'],
      ] as RaporVerisi['tahsilat']),
      pano: PANO,
      yonetim: null,
    }
  }
  interface TabloDugumu { table: { widths: Array<number | string>; body: Array<Array<{ text?: unknown; fontSize?: number; bold?: boolean }>> } }
  const tablolar = (dugum: unknown, out: TabloDugumu[] = []): TabloDugumu[] => {
    if (Array.isArray(dugum)) for (const d of dugum) tablolar(d, out)
    else if (dugum && typeof dugum === 'object') {
      const o = dugum as Record<string, unknown>
      const t = o.table as TabloDugumu['table'] | undefined
      if (t && Array.isArray(t.body) && Array.isArray(t.widths)) out.push(o as unknown as TabloDugumu)
      for (const v of Object.values(o)) if (typeof v === 'object') tablolar(v, out)
    }
    return out
  }
  const duzMetinler = (dugum: unknown, out: string[] = []): string[] => {
    if (typeof dugum === 'string') out.push(dugum)
    else if (Array.isArray(dugum)) for (const d of dugum) duzMetinler(d, out)
    else if (dugum && typeof dugum === 'object') for (const v of Object.values(dugum as Record<string, unknown>)) if (typeof v === 'object' || typeof v === 'string') duzMetinler(v, out)
    return out
  }

  it('uzun unvanlar tek satır: her firma hücresi sütununa sığar; kısa rapor yine tek sayfa', async () => {
    for (const sorumlu of [() => null, (i: number) => (i % 2 ? 'MEHMET.YILMAZOGLU' : 'ERCAN')] as Array<(i: number) => string | null>) {
      for (const tur of ['kisa', 'ozet', 'ayrintili'] as RaporTuru[]) {
        const tanim = tahsilatDurumuBelgesi(tahsilatDurumuKur(uzunVeri(sorumlu), BUGUN, { tur, sorumlu: '', ay: null }), tur, '11.11.2026 12:00')
        let firmaHucresi = 0
        for (const t of tablolar(tanim.content)) {
          const w = t.table.widths
          if (w.filter((x) => x === '*').length !== 1) continue
          const sabit = w.reduce<number>((a, x) => a + (typeof x === 'number' ? x : 0), 0)
          const yildiz = ICERIK_GENISLIGI - sabit - w.length * 8
          const si = w.indexOf('*')
          for (const satir of t.table.body) {
            w.forEach((genislik, i) => {
              const h = satir[i]
              if (typeof h?.text !== 'string') return
              const sinir = typeof genislik === 'number' ? genislik : i === si ? yildiz : Infinity
              const g = metinGenisligi(h.text, h.fontSize ?? 7.5) * (h.bold ? 1.04 : 1)
              expect(g, `${tur}: "${h.text}" (${Math.round(g)} > ${Math.round(sinir)} pt)`).toBeLessThanOrEqual(sinir + 0.01)
              if (i === si && /^\d\d Ş\d\d {2}/.test(h.text)) firmaHucresi++
            })
          }
        }
        expect(firmaHucresi, tur).toBeGreaterThanOrEqual(10)
        if (tur === 'kisa') expect(sayfaSayisi(await pdfUret(tanim))).toBe(1)
      }
    }
  })

  it('hiç sorumlu atanmamışsa: Sorumlu sütunu ve kırılım tablosu yok, yerine açıklama; ayrıntıda tek liste', async () => {
    const metin = (tur: RaporTuru, veri: RaporVerisi) => duzMetinler(tahsilatDurumuBelgesi(tahsilatDurumuKur(veri, BUGUN, { tur, sorumlu: '', ay: null }), tur, 'x').content)
    const atamasiz = uzunVeri(() => null)
    const atamali = uzunVeri((i) => (i % 2 ? 'LEVENT' : null))
    for (const tur of ['kisa', 'ozet', 'ayrintili'] as RaporTuru[]) {
      expect(metin(tur, atamasiz), tur).not.toContain('Sorumlu')
      expect(metin(tur, atamali), tur).toContain('Sorumlu')
    }
    const ozet = metin('ozet', atamasiz)
    expect(ozet).toContain('Sorumluya göre')
    expect(ozet.some((m) => m.includes('Firmalara henüz sorumlu atanmamış'))).toBe(true)
    expect(metin('ayrintili', atamasiz)).toContain('Borcu olan firmalar')
    expect(metin('ayrintili', atamali)).toContain('Sorumlusu olmayan firmalar')
    expect(metin('ayrintili', atamali)).toContain('Sorumlu: LEVENT')
    // içeriksiz bölüm boş sayfa üretmez: atamasız özet, atamalıdan uzun değildir
    const sayfa = async (veri: RaporVerisi) => sayfaSayisi(await pdfUret(tahsilatDurumuBelgesi(tahsilatDurumuKur(veri, BUGUN, { tur: 'ozet', sorumlu: '', ay: null }), 'ozet', 'x')))
    expect(await sayfa(atamasiz)).toBeLessThanOrEqual(await sayfa(atamali))
    expect(await sayfa(atamasiz)).toBeLessThanOrEqual(2)
  })

  it('aylık tablo: 12 aydan eski aylar tek satırda; alacağı olan borçlu firma † ile işaretlenir', () => {
    const tanim = tahsilatDurumuBelgesi(tahsilatDurumuKur(uzunVeri(() => null), BUGUN, { tur: 'ayrintili', sorumlu: '', ay: null }), 'ayrintili', 'x')
    const metinler = duzMetinler(tanim.content)
    expect(metinler).toContain('Aralık 2025 öncesi')
    expect(metinler).not.toContain('Ocak 2025')
    expect(metinler).toContain('Aralık 2025')
    expect(metinler.filter((m) => m.endsWith(' †')).length).toBe(15)
    expect(metinler.some((m) => m.startsWith('† Firmanın borca işlenmemiş fazla ödemesi'))).toBe(true)
    expect(metinler.some((m) => m.includes('(alacak '))).toBe(false)
  })

  it('öz-sınama (/api/saglik?belge=1): PDF üretilir, yalnız boyut ve süre döner', async () => {
    const s = await pdfSinamasi()
    expect(s.ok).toBe(true)
    expect(s.bayt).toBeGreaterThan(5000)
    expect(Object.keys(s).sort()).toEqual(['bayt', 'ms', 'ok'])
  })
})
