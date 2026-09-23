import { describe, expect, it } from 'vitest'
import { normText } from '../normalize'
import {
  IADE_NEDENI,
  SINIFSIZ,
  VARSAYILAN_KURALLAR,
  classifyWithRules,
  kuralDogrula,
  kuralNedeni,
  type Kural,
} from '../kurallar'

// KÂHİN: 0007'den önceki sabit sınıflandırıcının birebir kopyası. Varsayılan
// kurallar bununla her girdide AYNI sonucu vermeli (tip, öneri, inceleme, gerekçe).
function eskiSiniflandirici(belgeNoRaw: string | null | undefined, turuRaw?: string | null) {
  const t = normText(belgeNoRaw)
  const turu = normText(turuRaw)
  const isIade = turu.includes('IADE')
  if (t.includes('KONSINYE PESIN')) return { type: 'KONSINYE_PESIN', needsReview: isIade, reason: isIade ? 'İade irsaliyesi — kontrol edin' : 'Belge No: KONSİNYE PEŞİN' }
  if (t.includes('KONSINYE')) return { type: 'KONSINYE', needsReview: isIade, reason: isIade ? 'İade irsaliyesi — kontrol edin' : 'Belge No: KONSİNYE' }
  if (t.startsWith('+')) return { type: 'PESIN', needsReview: isIade, reason: isIade ? 'İade irsaliyesi — kontrol edin' : 'Belge No: + (peşin)' }
  let suggested: string | undefined
  let reason = 'Belge No boş — tip belirlenemedi'
  if (/^\d+$/.test(t)) {
    suggested = 'PESIN'
    reason = 'Belge No müşteri sipariş numarası görünüyor'
  } else if (/AVI\d+/.test(t) || t.includes('REVIZE') || t.includes('IRS')) {
    suggested = 'KONSINYE'
    reason = 'Belge No başka bir irsaliyeye/revizyona atıf yapıyor'
  } else if (t) {
    reason = `Belge No tanınmadı: ${t.slice(0, 40)}`
  }
  return { type: 'OTHER', suggested, needsReview: true, reason }
}

function yeni(b: string | null | undefined, t?: string | null) {
  const r = classifyWithRules(b, t, VARSAYILAN_KURALLAR)
  return { type: r.type, suggested: r.suggested, needsReview: r.needsReview, reason: r.reason }
}

const GERCEK_ORNEKLER = [
  'KONSİNYE PEŞİN', '+KONSİNYE PEŞİN', 'KONSİNYE', 'KONSİNYE BİRLEŞECEK', 'KONSİNYE REVİZE', 'KONSİNYE  REVİZE', 'KONSİNYE BURSA',
  '+KONSİNYE', 'KONSİNYE 24 LÜK KLAS', '+', '+REVİZE', '4800039916', 'AVI2026000000119', '412 NOLU İRS.KALAN', '', '   ',
  'KOSİNYE PEŞİN', 'KONİNYE PEŞİN', 'FT. DOLAR', 'MER TEKNİĞİN ÜSTÜNE', 'BEYAZ GİDECEK', 'FT EDİLMEYECEK', 'konsinye peşin',
  'Konsinye', 'avi2026000000001', 'irsaliye', ' + ', '+ KONSİNYE', 'KONSİNYEPEŞİN', 'PEŞİN', '12345 ', '١٢٣', 'ı', 'İ',
]
const TURLER = ['(08) TOPTAN SATIŞ İRSALIYESI', '(03) TOPTAN SATIŞ İADE İRSALIYESI', '(35) STOK ÇIKIŞ İRSALIYESI', '', null]

// Tekrarlanabilir sözde rastgele dizgeler (Türkçe harf, rakam, işaret karışık)
function* rastgeleDizgeler(n: number): Generator<string> {
  const harfler = ['A', 'V', 'I', 'İ', 'ı', 'K', 'O', 'N', 'S', 'Ş', 'Y', 'E', 'P', 'Ğ', 'R', 'Z', '+', ' ', '0', '1', '9', '.', '-', 'ü', 'ç', 'KONSİNYE', 'PEŞİN', 'AVI', 'IRS', 'REVİZE']
  let s = 20260923
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < n; i++) {
    const uzunluk = Math.floor(rnd() * 6)
    let out = ''
    for (let j = 0; j < uzunluk; j++) out += harfler[Math.floor(rnd() * harfler.length)]
    yield out
  }
}

describe('varsayılan kurallar = eski sabit sınıflandırıcı (kâhin)', () => {
  it('gerçek Belge No örnekleri × Türü değerleri', () => {
    for (const b of GERCEK_ORNEKLER) for (const t of TURLER) expect(yeni(b, t), `${b} / ${t}`).toEqual(eskiSiniflandirici(b, t))
  })
  it('3000 rastgele dizge', () => {
    for (const b of rastgeleDizgeler(3000)) expect(yeni(b, null), b).toEqual(eskiSiniflandirici(b, null))
  })
})

const k = (p: Partial<Kural> & Pick<Kural, 'kategori_kod' | 'deger'>): Kural => ({
  alan: 'BELGE_NO',
  islec: 'ICERIR',
  sonuc: 'ATA',
  sira: 100,
  aktif: true,
  aciklama: null,
  ...p,
})

describe('işleçler ve sıra', () => {
  it('Türkçe harf ve büyük/küçük harf duyarsız eşleşme', () => {
    const kurallar = [k({ kategori_kod: 'PROJE', deger: 'proje' })]
    expect(classifyWithRules('PROJE SATIŞI 12', null, kurallar).type).toBe('PROJE')
    expect(classifyWithRules('Proje', null, kurallar).type).toBe('PROJE')
    const numune = [k({ kategori_kod: 'NUMUNE', deger: 'NÜMUNE' })]
    expect(classifyWithRules('numune', null, numune).type).toBe('NUMUNE')
  })
  it('başlar / biter / tam olarak', () => {
    const kurallar = [
      k({ kategori_kod: 'A', islec: 'BASLAR', deger: 'PRJ-', sira: 1 }),
      k({ kategori_kod: 'B', islec: 'BITER', deger: '-KMP', sira: 2 }),
      k({ kategori_kod: 'C', islec: 'ESIT', deger: 'Numune', sira: 3 }),
    ]
    expect(classifyWithRules('prj-001', null, kurallar).type).toBe('A')
    expect(classifyWithRules('X PRJ-001', null, kurallar).type).toBe(SINIFSIZ)
    expect(classifyWithRules('2026-kmp', null, kurallar).type).toBe('B')
    expect(classifyWithRules('NUMUNE', null, kurallar).type).toBe('C')
    expect(classifyWithRules('NUMUNE 2', null, kurallar).type).toBe(SINIFSIZ)
  })
  it('düzenli ifade katlanmaz; büyük/küçük harf duyarsız', () => {
    const kurallar = [k({ kategori_kod: 'R', islec: 'REGEX', deger: '^\\d{3}-[a-z]+$' })]
    expect(classifyWithRules('123-abc', null, kurallar).type).toBe('R')
    expect(classifyWithRules('12-abc', null, kurallar).type).toBe(SINIFSIZ)
    // geçersiz ifade hiçbir şeye uymaz (çökme yok)
    expect(classifyWithRules('x', null, [k({ kategori_kod: 'R', islec: 'REGEX', deger: '([' })]).type).toBe(SINIFSIZ)
  })
  it('Türü alanı', () => {
    const kurallar = [k({ kategori_kod: 'STOK', alan: 'TURU', deger: 'STOK ÇIKIŞ' })]
    expect(classifyWithRules('', '(35) STOK ÇIKIŞ İRSALIYESI', kurallar).type).toBe('STOK')
    expect(classifyWithRules('STOK ÇIKIŞ', '(08) TOPTAN SATIŞ İRSALIYESI', kurallar).type).toBe(SINIFSIZ)
  })
  it('ilk eşleşen (sıraya göre) kazanır; eşit sırada kimlik', () => {
    const kurallar = [
      k({ kategori_kod: 'GENEL', deger: 'KONSİNYE', sira: 20 }),
      k({ kategori_kod: 'OZEL', deger: 'KONSİNYE ÖZEL', sira: 10 }),
    ]
    expect(classifyWithRules('KONSİNYE ÖZEL 5', null, kurallar).type).toBe('OZEL')
    const esit = [k({ id: 2, kategori_kod: 'IKI', deger: 'X', sira: 5 }), k({ id: 1, kategori_kod: 'BIR', deger: 'X', sira: 5 })]
    expect(classifyWithRules('X', null, esit).type).toBe('BIR')
  })
  it('ÖNER yalnız hiçbir ATA uymazsa; sonuç sınıfsız + öneri', () => {
    const kurallar = [k({ kategori_kod: 'A', deger: 'AVI', sonuc: 'ONER', sira: 1 }), k({ kategori_kod: 'B', deger: 'AVI2', sira: 50 })]
    expect(classifyWithRules('AVI2026', null, kurallar).type).toBe('B')
    const r = classifyWithRules('AVI1', null, kurallar)
    expect(r.type).toBe(SINIFSIZ)
    expect(r.suggested).toBe('A')
    expect(r.needsReview).toBe(true)
  })
  it('pasif kural ve geçerli olmayan kategori atlanır', () => {
    const kurallar = [k({ kategori_kod: 'A', deger: 'X', aktif: false }), k({ kategori_kod: 'B', deger: 'X', sira: 200 })]
    expect(classifyWithRules('X', null, kurallar).type).toBe('B')
    expect(classifyWithRules('X', null, kurallar, new Set(['A'])).type).toBe(SINIFSIZ)
  })
  it('İade her durumda incelemeye düşer; kategori yine atanır', () => {
    const r = classifyWithRules('PROJE', '(03) TOPTAN SATIŞ İADE İRSALIYESI', [k({ kategori_kod: 'PROJE', deger: 'PROJE' })])
    expect(r.type).toBe('PROJE')
    expect(r.needsReview).toBe(true)
    expect(r.reason).toBe(IADE_NEDENI)
  })
  it('gerekçe: açıklama yoksa kuraldan üretilir', () => {
    expect(kuralNedeni(k({ kategori_kod: 'A', deger: 'PRJ', islec: 'BASLAR' }))).toBe('Belge No ile başlar: PRJ')
    expect(kuralNedeni(k({ kategori_kod: 'A', deger: 'X', aciklama: '  Özel  ' }))).toBe('Özel')
  })
})

describe('kural doğrulama', () => {
  const kategoriler = [
    { kod: 'A', aktif: true },
    { kod: 'P', aktif: false },
    { kod: 'OTHER', aktif: true },
  ]
  it('geçerli kural', () => expect(kuralDogrula(k({ kategori_kod: 'A', deger: 'X' }), kategoriler)).toBeNull())
  it('hedef yok / pasif / sınıfsız', () => {
    expect(kuralDogrula(k({ kategori_kod: 'Z', deger: 'X' }), kategoriler)).toMatch(/bulunamadı/)
    expect(kuralDogrula(k({ kategori_kod: 'P', deger: 'X' }), kategoriler)).toMatch(/pasif/)
    expect(kuralDogrula(k({ kategori_kod: 'OTHER', deger: 'X' }), kategoriler)).toMatch(/Sınıflandırılmadı/)
  })
  it('boş değer, uzun değer, geçersiz ifade', () => {
    expect(kuralDogrula(k({ kategori_kod: 'A', deger: '  ' }), kategoriler)).toMatch(/boş/)
    expect(kuralDogrula(k({ kategori_kod: 'A', deger: 'x'.repeat(201) }), kategoriler)).toMatch(/200/)
    expect(kuralDogrula(k({ kategori_kod: 'A', islec: 'REGEX', deger: '([' }), kategoriler)).toMatch(/geçersiz/)
  })
})
