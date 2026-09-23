import { describe, expect, it } from 'vitest'
import { degerYazisi, degisiklikSatirlari, islemEtiketi, kayitYazisi } from '@/lib/denetimEtiketleri'
import { VARSAYILAN_KURALLAR, type Kural } from '@/lib/engine/kurallar'
import { otomatikTaksitSatirlari } from '@/lib/invoiceOps'
import {
  VARSAYILAN_KATEGORILER,
  atanabilirKategoriler,
  kategoriEtiketi,
  kodOnerisi,
  tarafAdlari,
  tarafHaritasi,
  type KategoriMeta,
} from '@/lib/kategoriMeta'
import { belgeKalibi, belgeKaliplari, kurallarAyni, kurallariNumarala, turuDagilimi } from '@/lib/kuralYardimcilari'
import { RENK_ANAHTARLARI, RENK_PALETI, renkOf } from '@/lib/renkler'
import { siniflandirmaPlani, type SiniflandirmaIrsaliyesi } from '@/lib/siniflandirma'

// Satış kategorileri ve tanıma kurallarının saf yardımcıları.

const NUMUNE: KategoriMeta = {
  kod: 'NUMUNE',
  ad: 'Numune',
  kisa_ad: null,
  renk: 'pembe',
  taraf: null,
  sira: 40,
  aktif: true,
  sistem: false,
  sayfada_suzgec: false,
  panoda_kart: false,
}
const PROJE: KategoriMeta = { ...NUMUNE, kod: 'PROJE', ad: 'Proje', renk: 'turkuaz', taraf: 'VADELI', sira: 35 }
const KATEGORILER: KategoriMeta[] = [...VARSAYILAN_KATEGORILER, NUMUNE, PROJE]

let sayac = 0
function irsaliye(p: Partial<SiniflandirmaIrsaliyesi>): SiniflandirmaIrsaliyesi {
  sayac++
  return {
    id: `00000000-0000-0000-0000-${String(sayac).padStart(12, '0')}`,
    fis_no: `AVI${sayac}`,
    firm_id: 'f1',
    firm_code: '34 A01',
    invoice_date: '2026-03-10',
    belge_no_raw: '',
    turu_raw: '(08) Toptan Satış İrsaliyesi',
    sale_type_auto: 'OTHER',
    suggested_sale_type: null,
    sale_type_override: null,
    classify_reason: null,
    needs_review: true,
    is_31_12: false,
    is_cancelled: false,
    is_allocatable: false,
    amount_eur_cents: 10000,
    odeme_plani_raw: '',
    plan_override_note: null,
    ...p,
  }
}

const numuneKurali: Kural = { kategori_kod: 'NUMUNE', alan: 'BELGE_NO', islec: 'ICERIR', deger: 'numune', sonuc: 'ATA', sira: 5, aktif: true, aciklama: null }
const projeKurali: Kural = { kategori_kod: 'PROJE', alan: 'TURU', islec: 'BASLAR', deger: '(35)', sonuc: 'ATA', sira: 6, aktif: true, aciklama: 'Proje çıkışı' }

describe('siniflandirmaPlani', () => {
  it('sınıfsızdan kategoriye: kazanç; inceleme diğer nedenlere göre yeniden hesaplanır', () => {
    const a = irsaliye({ belge_no_raw: 'NUMUNE 12', classify_reason: 'Belge No tanınmadı: NUMUNE 12' })
    const b = irsaliye({ turu_raw: '(35) Stok Çıkış', odeme_plani_raw: '05/4-5' })
    const c = irsaliye({ turu_raw: '(35) Stok Çıkış', odeme_plani_raw: 'anlamsız plan ???' })
    const plan = siniflandirmaPlani([a, b, c], [numuneKurali, projeKurali, ...VARSAYILAN_KURALLAR], KATEGORILER)
    const d = new Map(plan.degisiklikler.map((x) => [x.id, x]))
    // "hesaba katılmaz" hedefe geçen: inceleme kapanır
    expect(d.get(a.id)).toMatchObject({ yeniAuto: 'NUMUNE', etkinYeni: 'NUMUNE', inceleme: false })
    // plan çözülen vadeli hedef: inceleme kapanır; çözülemeyen: açık kalır
    expect(d.get(b.id)).toMatchObject({ yeniAuto: 'PROJE', inceleme: false, neden: 'Proje çıkışı' })
    expect(d.get(c.id)).toMatchObject({ yeniAuto: 'PROJE', inceleme: true })
    expect(plan.gecisler).toEqual([
      { eski: 'OTHER', yeni: 'PROJE', adet: 2, tutar: 20000, tahsisteki: 0, ton: 'kazanc' },
      { eski: 'OTHER', yeni: 'NUMUNE', adet: 1, tutar: 10000, tahsisteki: 0, ton: 'notr' },
    ])
  })

  it('kategoriden sınıfsıza: kayıp ve incelemeye düşer; elle seçim korunur', () => {
    const a = irsaliye({ belge_no_raw: 'KONSİNYE', sale_type_auto: 'KONSINYE', classify_reason: 'Belge No: KONSİNYE', needs_review: false, is_allocatable: true })
    const b = irsaliye({
      belge_no_raw: 'KONSİNYE',
      sale_type_auto: 'KONSINYE',
      sale_type_override: 'PESIN',
      classify_reason: 'Belge No: KONSİNYE',
      needs_review: false,
      is_allocatable: true,
    })
    // "KONSİNYE" kuralı kaldırılmış liste
    const kurallar = VARSAYILAN_KURALLAR.filter((k) => k.deger !== 'KONSİNYE')
    const plan = siniflandirmaPlani([a, b], kurallar, KATEGORILER)
    const d = new Map(plan.degisiklikler.map((x) => [x.id, x]))
    expect(d.get(a.id)).toMatchObject({ yeniAuto: 'OTHER', etkinYeni: 'OTHER', inceleme: true })
    // elle seçim: etkin tip aynı, inceleme bayrağına dokunulmaz
    expect(d.get(b.id)).toMatchObject({ yeniAuto: 'OTHER', etkinEski: 'PESIN', etkinYeni: 'PESIN', inceleme: null })
    expect(plan.ozet).toMatchObject({ incelenen: 2, degisen: 2, etkinDegisen: 1, elleKorunan: 1 })
    expect(plan.gecisler).toEqual([{ eski: 'KONSINYE', yeni: 'OTHER', adet: 1, tutar: 10000, tahsisteki: 1, ton: 'kayip' }])
  })

  it('geçiş tonu: davranış değişimi "taraf", aynı davranış "nötr"; 31/12 ve iptal tutarı sayılmaz', () => {
    const a = irsaliye({ belge_no_raw: '+12', sale_type_auto: 'KONSINYE', classify_reason: 'x' })
    const b = irsaliye({ belge_no_raw: 'KONSİNYE PEŞİN', sale_type_auto: 'KONSINYE', classify_reason: 'x', is_31_12: true })
    const c = irsaliye({ belge_no_raw: 'KONSİNYE PEŞİN', sale_type_auto: 'KONSINYE', classify_reason: 'x', is_cancelled: true })
    const plan = siniflandirmaPlani([a, b, c], VARSAYILAN_KURALLAR, KATEGORILER)
    expect(plan.gecisler).toEqual([
      { eski: 'KONSINYE', yeni: 'PESIN', adet: 1, tutar: 10000, tahsisteki: 0, ton: 'taraf' },
      { eski: 'KONSINYE', yeni: 'KONSINYE_PESIN', adet: 2, tutar: 0, tahsisteki: 0, ton: 'notr' },
    ])
  })

  it('iade irsaliyesi kategori alsa da incelemeye düşer', () => {
    const a = irsaliye({ belge_no_raw: 'NUMUNE', turu_raw: '(03) Toptan Satış İade İrsaliyesi' })
    const plan = siniflandirmaPlani([a], [numuneKurali], KATEGORILER)
    expect(plan.degisiklikler[0]).toMatchObject({ yeniAuto: 'NUMUNE', inceleme: true })
  })

  it('pasif kategoriyi hedefleyen kural atlanır', () => {
    const a = irsaliye({ belge_no_raw: 'NUMUNE', classify_reason: 'Belge No tanınmadı: NUMUNE' })
    const pasif = KATEGORILER.map((k) => (k.kod === 'NUMUNE' ? { ...k, aktif: false } : k))
    const plan = siniflandirmaPlani([a], [numuneKurali], pasif)
    expect(plan.degisiklikler).toEqual([])
  })

  it('değişiklik yoksa plan boş; imza girdi sırasından bağımsız', () => {
    const a = irsaliye({ belge_no_raw: '+1', sale_type_auto: 'PESIN', classify_reason: 'Belge No: + (peşin)', needs_review: false })
    expect(siniflandirmaPlani([a], VARSAYILAN_KURALLAR, KATEGORILER).degisiklikler).toEqual([])
    const x = irsaliye({ belge_no_raw: 'NUMUNE 1' })
    const y = irsaliye({ belge_no_raw: 'NUMUNE 2' })
    const p1 = siniflandirmaPlani([x, y], [numuneKurali], KATEGORILER)
    const p2 = siniflandirmaPlani([y, x], [numuneKurali], KATEGORILER)
    expect(p1.imza).toBe(p2.imza)
    expect(p1.imza).toMatch(/^[0-9a-f]{32}$/)
    expect(siniflandirmaPlani([x, y], [{ ...numuneKurali, aciklama: 'başka gerekçe' }], KATEGORILER).imza).not.toBe(p1.imza)
  })
})

describe('otomatikTaksitSatirlari', () => {
  const g = { id: 'i1', firm_id: 'f1', invoice_date: '2026-03-10', odeme_plani_raw: '05/4-5-6', plan_override_note: null, amount: 10001 }

  it('plandan taksit: tutar eşit bölünür, küsurat son taksite', () => {
    const s = otomatikTaksitSatirlari(g, 'VADELI')
    expect(s.map((r) => r.due_date)).toEqual(['2026-04-05', '2026-05-05', '2026-06-05'])
    expect(s.map((r) => r.amount_eur_cents)).toEqual([3333, 3333, 3335])
    expect(s.every((r) => r.source === 'auto_plan' && r.no_date_flag === false && r.side === 'VADELI')).toBe(true)
  })

  it('boş plan: vade irsaliye tarihi; "tarih girilmedi" yalnız vadelide', () => {
    const v = otomatikTaksitSatirlari({ ...g, odeme_plani_raw: '' }, 'VADELI')
    expect(v).toMatchObject([{ due_date: '2026-03-10', amount_eur_cents: 10001, source: 'default_invoice_date', no_date_flag: true }])
    const p = otomatikTaksitSatirlari({ ...g, odeme_plani_raw: '' }, 'PESIN')
    expect(p).toMatchObject([{ source: 'default_invoice_date', no_date_flag: false, side: 'PESIN' }])
  })

  it('yöneticinin planı dosyadaki plandan önceliklidir', () => {
    const s = otomatikTaksitSatirlari({ ...g, plan_override_note: '15.07.2026' }, 'VADELI')
    expect(s.map((r) => r.due_date)).toEqual(['2026-07-15'])
  })
})

describe('tanıma kuralı yardımcıları', () => {
  it('Belge No kalıbı', () => {
    expect(belgeKalibi('AVI0001234')).toBe('AVI#')
    expect(belgeKalibi('  ')).toBe('(boş)')
    expect(belgeKalibi(null)).toBe('(boş)')
    expect(belgeKalibi('Kosinye Peşin 12/3')).toBe('KOSINYE PESIN #/#')
    expect(belgeKalibi('123456')).toBe('#')
  })

  it('kalıplar en kalabalıktan; tutar ve örnek tutulur', () => {
    const k = belgeKaliplari([
      { belge_no_raw: 'AVI001', turu_raw: 'a', amount_eur_cents: 100 },
      { belge_no_raw: 'AVI002', turu_raw: 'a', amount_eur_cents: 200 },
      { belge_no_raw: '', turu_raw: 'b', amount_eur_cents: null },
      { belge_no_raw: '555', turu_raw: 'c', amount_eur_cents: 1000 },
    ])
    expect(k.map((x) => [x.kalip, x.adet, x.tutar])).toEqual([
      ['AVI#', 2, 300],
      ['#', 1, 1000],
      ['(boş)', 1, 0],
    ])
    expect(k[0].ornek).toBe('AVI001')
    expect(turuDagilimi([{ belge_no_raw: '', turu_raw: ' (08) X ', amount_eur_cents: 5 }])).toEqual([{ turu: '(08) X', adet: 1, tutar: 5 }])
  })

  it('numaralama: atama 10,20…; öneri 110,120…; gerekçe kırpılır', () => {
    const n = kurallariNumarala([VARSAYILAN_KURALLAR[2], { ...numuneKurali, aciklama: '  ' }], [VARSAYILAN_KURALLAR[3]])
    expect(n.map((k) => [k.kategori_kod, k.sonuc, k.sira, k.aciklama])).toEqual([
      ['PESIN', 'ATA', 10, 'Belge No: + (peşin)'],
      ['NUMUNE', 'ATA', 20, null],
      ['PESIN', 'ONER', 110, 'Belge No müşteri sipariş numarası görünüyor'],
    ])
    // varsayılanlar zaten bu numaralamada
    const v = kurallariNumarala(
      VARSAYILAN_KURALLAR.filter((k) => k.sonuc === 'ATA'),
      VARSAYILAN_KURALLAR.filter((k) => k.sonuc === 'ONER'),
    )
    expect(kurallarAyni(v, VARSAYILAN_KURALLAR)).toBe(true)
    expect(kurallarAyni(v, [...VARSAYILAN_KURALLAR].reverse())).toBe(false)
  })
})

describe('kategori meta', () => {
  it('addan kod önerisi', () => {
    expect(kodOnerisi('Proje Satışı')).toBe('PROJE_SATISI')
    expect(kodOnerisi('Çıkış / İade')).toBe('CIKIS_IADE')
    expect(kodOnerisi('3 Numune')).toBe('K_3_NUMUNE')
    expect(kodOnerisi('Ş'.repeat(40))).toHaveLength(30)
  })

  it('atama seçenekleri: sınıfsız ve pasifler çıkar, mevcut pasif kalır, sıralı', () => {
    const pasif = KATEGORILER.map((k) => (k.kod === 'PROJE' ? { ...k, aktif: false } : k))
    expect(atanabilirKategoriler(pasif).map((k) => k.kod)).toEqual(['PESIN', 'KONSINYE', 'KONSINYE_PESIN', 'NUMUNE'])
    expect(atanabilirKategoriler(pasif, 'PROJE').map((k) => k.kod)).toEqual(['PESIN', 'KONSINYE', 'KONSINYE_PESIN', 'PROJE', 'NUMUNE'])
  })

  it('davranış haritası, adlar ve etiketler', () => {
    const h = tarafHaritasi(KATEGORILER)
    expect([h.get('PESIN'), h.get('KONSINYE_PESIN'), h.get('OTHER'), h.get('NUMUNE'), h.get('PROJE')]).toEqual(['PESIN', 'VADELI', null, null, 'VADELI'])
    expect(tarafAdlari(KATEGORILER, 'VADELI')).toBe('Konsinye + Konsinye Peşin + Proje')
    expect(tarafAdlari(undefined, 'VADELI')).toBe('Konsinye + Konsinye Peşin')
    expect(kategoriEtiketi(KATEGORILER, 'NUMUNE')).toBe('Numune')
    expect(kategoriEtiketi(undefined, 'KONSINYE_PESIN')).toBe('Konsinye Peşin')
    expect(kategoriEtiketi(undefined, 'BILINMEYEN')).toBe('BILINMEYEN')
  })

  it('renk paleti tam; durum renkleri (kırmızı/yeşil/sarı/mor) yok; kodlar veritabanı kuralına uyar', () => {
    for (const a of RENK_ANAHTARLARI) {
      expect(a).toMatch(/^[a-z]{2,20}$/)
      const r = RENK_PALETI[a]
      for (const s of [r.ad, r.rozet, r.nokta, r.kenar]) expect(s.length).toBeGreaterThan(0)
      expect(`${r.rozet} ${r.nokta} ${r.kenar}`).not.toMatch(/red|green|emerald|lime|yellow|amber|orange|purple|violet/)
    }
    for (const k of VARSAYILAN_KATEGORILER) expect(RENK_ANAHTARLARI).toContain(k.renk)
    expect(renkOf('yok')).toBe(RENK_PALETI.gri)
  })
})

describe('denetim etiketleri', () => {
  it('değerler alanına göre okunur yazılır', () => {
    expect(degerYazisi('satis_tipi', 'KONSINYE_PESIN')).toBe('Konsinye Peşin')
    expect(degerYazisi('tutar_eur', 5141486)).toBe('51.414,86 €')
    expect(degerYazisi('rol', 'tahsilat_yoneticisi')).toBe('Tahsilat Yöneticisi')
    expect(degerYazisi('taraf', null)).toBe('Hesaba katılmaz')
    expect(degerYazisi('taraf', 'PESIN')).toBe('Peşin gibi')
    expect(degerYazisi('aktif', false)).toBe('pasif')
    expect(degerYazisi(null, undefined)).toBe('')
  })

  it('nesne ve listelerde satır satır; teknik anahtarlar gizli', () => {
    expect(degisiklikSatirlari('ad,renk', { ad: 'Eski', renk: 'mavi' }, { ad: 'Yeni', renk: 'gok' })).toEqual([
      { alan: 'ad', eski: 'Eski', yeni: 'Yeni' },
      { alan: 'renk', eski: 'mavi', yeni: 'gok' },
    ])
    // kural sınıflandırması: değişmeyen öneri ve "etkin" ile aynı "otomatik" yazılmaz
    expect(
      degisiklikSatirlari('satis_tipi', { otomatik: 'OTHER', oneri: null, etkin: 'OTHER' }, { otomatik: 'NUMUNE', oneri: null, etkin: 'NUMUNE' }, KATEGORILER),
    ).toEqual([{ alan: 'etkin', eski: 'Sınıflandırılmadı', yeni: 'Numune' }])
    // elle seçim varken otomatik ayrıca görünür
    expect(
      degisiklikSatirlari('satis_tipi', { otomatik: 'OTHER', oneri: 'PESIN', etkin: 'PESIN' }, { otomatik: 'NUMUNE', oneri: null, etkin: 'PESIN' }, KATEGORILER),
    ).toEqual([
      { alan: 'otomatik', eski: 'Sınıflandırılmadı', yeni: 'Numune' },
      { alan: 'öneri', eski: 'Peşin', yeni: '' },
    ])
    expect(degisiklikSatirlari(null, null, { kod: 'X', ad: 'X', sistem: false, updated_by: 'a' })).toEqual([{ alan: 'ad', eski: '', yeni: 'X' }])
    expect(degisiklikSatirlari(null, [1, 2], [1, 2, 3])).toEqual([{ alan: null, eski: '2 kayıt', yeni: '3 kayıt' }])
    expect(degisiklikSatirlari(null, null, ['KONSINYE', 'PESIN'], KATEGORILER)).toEqual([{ alan: null, eski: '', yeni: 'Konsinye, Peşin' }])
    const kural = { kategori: 'PESIN', alan: 'BELGE_NO' }
    expect(degisiklikSatirlari(null, [kural], [kural, kural])).toEqual([{ alan: null, eski: '1 kural', yeni: '2 kural' }])
    expect(degisiklikSatirlari('satis_tipi', 'PESIN', 'KONSINYE')).toEqual([{ alan: 'kategori', eski: 'Peşin', yeni: 'Konsinye' }])
    expect(degisiklikSatirlari(null, null, null)).toEqual([])
  })

  it('toplu kayıtların adı', () => {
    expect(kayitYazisi('kategori_kurali', 'kurallar')).toEqual({ tur: 'Tanıma kuralları', kimlik: null })
    expect(kayitYazisi('kategori', 'sira')).toEqual({ tur: 'Kategori sırası', kimlik: null })
    expect(kayitYazisi('irsaliye', 'AVI1')).toEqual({ tur: 'İrsaliye', kimlik: 'AVI1' })
  })

  it('bilinmeyen işlem kodu okunur hale gelir', () => {
    expect(islemEtiketi('KATEGORI_OLUSTURMA').ad).toBe('Kategori oluşturuldu')
    expect(islemEtiketi('YENI_BIR_ISLEM')).toEqual({ ad: 'yeni bir islem', ton: 'gray' })
  })
})
