import { describe, expect, it } from 'vitest'
import { iadeAcikSecimi, iadeMi, overrideDegeri } from '@/lib/invoiceOps'

// İade irsaliyesi kendiliğinden borca girmez; yönetim kategorisini AÇIKÇA seçerse girer.
// "Açık seçim" kategori değişmese de yazılabilmelidir (firma kartı → "Bu iadeyi borca ekle").

const satis = { sale_type_auto: 'KONSINYE', sale_type_override: null, turu_raw: '(08) Toptan Satış İrsaliyesi' }
const iade = { sale_type_auto: 'KONSINYE', sale_type_override: null, turu_raw: '(03) Toptan Satış İade İrsaliyesi' }

describe('iade irsaliyesinde açık kategori seçimi', () => {
  it('iade, Türü metninden tanınır (Türkçe harf ve büyük/küçük duyarsız)', () => {
    expect(iadeMi(iade)).toBe(true)
    expect(iadeMi({ turu_raw: 'toptan satış iade irsaliyesi' })).toBe(true)
    expect(iadeMi(satis)).toBe(false)
    expect(iadeMi({ turu_raw: '' })).toBe(false)
  })

  it('normal irsaliyede otomatikle aynı kategori seçilirse seçim yazılmaz; iadede her zaman yazılır', () => {
    expect(overrideDegeri(satis, 'KONSINYE')).toBeNull()
    expect(overrideDegeri(satis, 'PESIN')).toBe('PESIN')
    expect(overrideDegeri(iade, 'KONSINYE')).toBe('KONSINYE')
    expect(overrideDegeri(iade, 'PESIN')).toBe('PESIN')
  })

  it('aynı kategoriyle onay yalnız henüz açık seçimi olmayan iadede geçerlidir', () => {
    expect(iadeAcikSecimi(iade, 'KONSINYE')).toBe(true)
    // farklı kategori zaten "değişiklik"tir; ayrıca onay sayılmaz
    expect(iadeAcikSecimi(iade, 'PESIN')).toBe(false)
    // daha önce açıkça seçilmiş iade: yinelenen kayıt yazılmaz
    expect(iadeAcikSecimi({ ...iade, sale_type_override: 'KONSINYE' }, 'KONSINYE')).toBe(false)
    // iade olmayan irsaliyede aynı kategori "değişiklik yok" demektir
    expect(iadeAcikSecimi(satis, 'KONSINYE')).toBe(false)
  })
})
