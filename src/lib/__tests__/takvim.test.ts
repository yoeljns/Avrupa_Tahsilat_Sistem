import { describe, expect, it } from 'vitest'
import {
  BOS_SUZGEC,
  ayAraligi,
  ayKalani,
  eurKisa,
  eurTam,
  firmalariSirala,
  firmalariSuz,
  gecikmeDagilimi,
  gunAdi,
  gunEkle,
  gunFarki,
  gunSutunlari,
  haftaSutunlari,
  odemeYuzdesi,
  sorumluListesi,
  sutunHucresi,
  type TakvimFirmaSatiri,
} from '@/lib/takvim'

function firma(p: Partial<TakvimFirmaSatiri> & { kod: string }): TakvimFirmaSatiri {
  return {
    firm_id: p.kod,
    ad: 'FİRMA',
    sorumlu: null,
    toplam_borc: 0,
    toplam_odeme: 0,
    toplam_kalan: 0,
    once_kalan: 0,
    sonra_kalan: 0,
    gecikmis: 0,
    tarihsiz: false,
    gunler: {},
    ...p,
  }
}

describe('tarih yardımcıları', () => {
  it('gün adları (1 Haziran 2026 Pazartesi)', () => {
    expect(gunAdi('2026-06-01')).toBe('Pzt')
    expect(gunAdi('2026-06-05')).toBe('Cum')
    expect(gunAdi('2026-06-07')).toBe('Paz')
  })
  it('gün ekleme ay/yıl sınırında', () => {
    expect(gunEkle('2026-06-30', 1)).toBe('2026-07-01')
    expect(gunEkle('2026-12-31', 1)).toBe('2027-01-01')
    expect(gunEkle('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('gün farkı', () => {
    expect(gunFarki('2026-06-15', '2026-06-20')).toBe(5)
    expect(gunFarki('2026-06-15', '2026-05-31')).toBe(-15)
  })
  it('ay aralığı (artık yıl dahil)', () => {
    expect(ayAraligi('2026-06')).toEqual({ bas: '2026-06-01', son: '2026-06-30' })
    expect(ayAraligi('2028-02')).toEqual({ bas: '2028-02-01', son: '2028-02-29' })
  })
})

describe('sütunlar', () => {
  it('gün sütunları: tekil, sıralı, gün adlı başlık, bugüne göre konum', () => {
    const s = gunSutunlari(['2026-06-15', '2026-06-05', '2026-06-15', '2026-06-25'], '2026-06-15')
    expect(s.map((x) => x.baslik)).toEqual(['Cum 05.06', 'Pzt 15.06', 'Per 25.06'])
    expect(s.map((x) => x.konum)).toEqual(['gecmis', 'bugun', 'gelecek'])
  })
  it('hafta sütunları: Pazartesi–Pazar, ay sınırında kırpılır', () => {
    const h = haftaSutunlari('2026-06-01', '2026-06-30', '2026-06-15')
    expect(h.map((x) => x.baslik)).toEqual(['1–7 Haz', '8–14 Haz', '15–21 Haz', '22–28 Haz', '29–30 Haz'])
    expect(h.map((x) => x.konum)).toEqual(['gecmis', 'gecmis', 'bugun', 'gelecek', 'gelecek'])
    // Eylül 2026 Salı başlar
    const e = haftaSutunlari('2026-09-01', '2026-09-30', '2026-01-01')
    expect(e.map((x) => x.baslik)).toEqual(['1–6 Eyl', '7–13 Eyl', '14–20 Eyl', '21–27 Eyl', '28–30 Eyl'])
    // Pazar gününe düşen tek günlük hafta
    const m = haftaSutunlari('2026-03-01', '2026-03-31', '2026-01-01')
    expect(m[0].baslik).toBe('1 Mar')
    expect(m[0].bas).toBe('2026-03-01')
  })
})

describe('hücre durumu (bugüne göre)', () => {
  const gunler = {
    '2026-06-05': [1000, 1000, 0] as [number, number, number],
    '2026-06-10': [1000, 400, 600] as [number, number, number],
    '2026-06-18': [500, 0, 500] as [number, number, number],
    '2026-06-25': [700, 0, 700] as [number, number, number],
  }
  const bugun = '2026-06-15'
  const tek = (d: string) => sutunHucresi(gunler, { anahtar: d, bas: d, son: d, baslik: '', konum: 'gecmis' }, bugun)
  it('tamamı ödenmiş → odendi', () => expect(tek('2026-06-05')?.durum).toBe('odendi'))
  it('vadesi geçmiş kalan → gecikti', () => {
    const h = tek('2026-06-10')!
    expect(h.durum).toBe('gecikti')
    expect(h.gecikmis).toBe(600)
  })
  it('7 gün içinde → yakin; daha ileri → ileri', () => {
    expect(tek('2026-06-18')?.durum).toBe('yakin')
    expect(tek('2026-06-25')?.durum).toBe('ileri')
  })
  it('vade yoksa null', () => expect(tek('2026-06-01')).toBeNull())
  it('hafta sütunu toplar; en kötü durum kazanır', () => {
    const h = sutunHucresi(gunler, { anahtar: 'h', bas: '2026-06-08', son: '2026-06-21', baslik: '', konum: 'bugun' }, bugun)!
    expect([h.borc, h.odeme, h.kalan]).toEqual([1500, 400, 1100])
    expect(h.durum).toBe('gecikti')
    expect(h.tarihler).toEqual(['2026-06-10', '2026-06-18'])
  })
})

describe('gecikme dağılımı', () => {
  it('içinde bulunulan ay: önceki ayların tamamı + ay içindeki geçmiş günler', () => {
    const f = firma({ kod: 'A', once_kalan: 900, gecikmis: 1500, gunler: { '2026-06-10': [1000, 400, 600], '2026-06-20': [300, 0, 300] } })
    expect(gecikmeDagilimi(f, '2026-06-01', '2026-06-15')).toEqual({ once: 900, ayIci: 600, sonra: 0 })
  })
  it('ileri bir ay: gecikmişin hepsi "önceki aylar"da; önceki ayların geri kalanı henüz vadesiz', () => {
    const f = firma({ kod: 'A', once_kalan: 5000, gecikmis: 1200, gunler: { '2026-09-05': [800, 0, 800] } })
    expect(gecikmeDagilimi(f, '2026-09-01', '2026-06-15')).toEqual({ once: 1200, ayIci: 0, sonra: 0 })
  })
  it('geçmiş bir ay: aydan sonraki ama bugünden önceki vadeler "sonra" gecikmişi', () => {
    const f = firma({ kod: 'A', once_kalan: 100, sonra_kalan: 2000, gecikmis: 900, gunler: { '2026-04-05': [500, 200, 300] } })
    expect(gecikmeDagilimi(f, '2026-04-01', '2026-06-15')).toEqual({ once: 100, ayIci: 300, sonra: 500 })
  })
})

describe('süzme ve sıralama', () => {
  const liste = [
    firma({ kod: '34 T04', ad: 'İÇ ANADOLU YAPI', sorumlu: 'VEDAT', gecikmis: 0, toplam_kalan: 500, gunler: { '2026-06-05': [100, 0, 100] } }),
    firma({ kod: '34 T02', ad: 'TRAKYA BOYA', sorumlu: 'ERCAN', gecikmis: 300, toplam_kalan: 900, gunler: {} }),
    firma({ kod: '34 T01', ad: 'MARMARA NALBUR', sorumlu: null, gecikmis: 0, toplam_kalan: 0, gunler: { '2026-06-05': [50, 50, 0] } }),
  ]
  it('arama: Türkçe harf ve boşluk duyarsız', () => {
    expect(firmalariSuz(liste, { ...BOS_SUZGEC, arama: 'iç anadolu' }).map((f) => f.kod)).toEqual(['34 T04'])
    expect(firmalariSuz(liste, { ...BOS_SUZGEC, arama: '34t02' }).map((f) => f.kod)).toEqual(['34 T02'])
    expect(firmalariSuz(liste, { ...BOS_SUZGEC, arama: 'ic anadolu' }).map((f) => f.kod)).toEqual(['34 T04'])
  })
  it('sorumlu, yalnız gecikmiş, bitenleri gizle', () => {
    expect(firmalariSuz(liste, { ...BOS_SUZGEC, sorumlu: 'VEDAT' }).map((f) => f.kod)).toEqual(['34 T04'])
    expect(firmalariSuz(liste, { ...BOS_SUZGEC, yalnizGecikmis: true }).map((f) => f.kod)).toEqual(['34 T02'])
    expect(firmalariSuz(liste, { ...BOS_SUZGEC, bitenleriGizle: true }).map((f) => f.kod)).toEqual(['34 T04', '34 T02'])
  })
  it('sıralama: koda göre ve tutara göre (eşitlikte kod)', () => {
    expect(firmalariSirala(liste, 'kod').map((f) => f.kod)).toEqual(['34 T01', '34 T02', '34 T04'])
    expect(firmalariSirala(liste, 'kalan').map((f) => f.kod)).toEqual(['34 T02', '34 T04', '34 T01'])
    expect(firmalariSirala(liste, 'gecikmis').map((f) => f.kod)).toEqual(['34 T02', '34 T01', '34 T04'])
    expect(firmalariSirala(liste, 'ay').map((f) => f.kod)).toEqual(['34 T04', '34 T01', '34 T02'])
    expect(ayKalani(liste[0])).toBe(100)
  })
  it('sorumlu listesi: tekil, sıralı, boşlar hariç', () => {
    expect(sorumluListesi(liste)).toEqual(['ERCAN', 'VEDAT'])
  })
})

describe('biçim', () => {
  it('tam avro yuvarlama', () => {
    expect(eurTam(3166885)).toBe('31.669 €')
    expect(eurTam(0)).toBe('0 €')
    expect(eurTam(49)).toBe('0 €')
  })
  it('kısa tutar (Türkçe: Mn / B)', () => {
    // Intl sayı ile kısaltma arasına bölünmez boşluk koyar
    const bosluk = (s: string) => s.replace(/\u00a0/g, ' ')
    expect(bosluk(eurKisa(565305872))).toBe('5,7 Mn €')
    expect(bosluk(eurKisa(94459200))).toBe('944,6 B €')
  })
  it('ödeme yüzdesi sınırlı', () => {
    expect(odemeYuzdesi(1000, 250)).toBe(25)
    expect(odemeYuzdesi(0, 0)).toBe(0)
    expect(odemeYuzdesi(100, 150)).toBe(100)
  })
})
