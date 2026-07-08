import { describe, expect, it } from 'vitest'
import { classifySaleType } from '../classify'

// Belge No değerleri gerçek dosyadan alınmıştır.

describe('classifySaleType', () => {
  it('KONSİNYE PEŞİN → KONSINYE_PESIN', () => {
    expect(classifySaleType('KONSİNYE PEŞİN').type).toBe('KONSINYE_PESIN')
    expect(classifySaleType('+KONSİNYE PEŞİN').type).toBe('KONSINYE_PESIN')
  })

  it('KONSİNYE ve varyantları → KONSINYE', () => {
    for (const v of ['KONSİNYE', 'KONSİNYE BİRLEŞECEK', 'KONSİNYE REVİZE', 'KONSİNYE  REVİZE', 'KONSİNYE BURSA', '+KONSİNYE', 'KONSİNYE 24 LÜK KLAS']) {
      expect(classifySaleType(v).type, v).toBe('KONSINYE')
    }
  })

  it('+ ile başlayanlar → PESIN', () => {
    expect(classifySaleType('+').type).toBe('PESIN')
    expect(classifySaleType('+REVİZE').type).toBe('PESIN')
  })

  it('müşteri sipariş numarası → OTHER, öneri PESIN', () => {
    const r = classifySaleType('4800039916')
    expect(r.type).toBe('OTHER')
    expect(r.suggested).toBe('PESIN')
    expect(r.needsReview).toBe(true)
  })

  it('başka irsaliyeye atıf → OTHER, öneri KONSINYE', () => {
    const r = classifySaleType('AVI2026000000119')
    expect(r.type).toBe('OTHER')
    expect(r.suggested).toBe('KONSINYE')
    const r2 = classifySaleType('412 NOLU İRS.KALAN')
    expect(r2.type).toBe('OTHER')
    expect(r2.suggested).toBe('KONSINYE')
  })

  it('boş → OTHER, önerisiz', () => {
    const r = classifySaleType('')
    expect(r.type).toBe('OTHER')
    expect(r.suggested).toBeUndefined()
  })

  it('iade irsaliyesi her tipte incelemeye düşer', () => {
    const r = classifySaleType('KONSİNYE', '(03) Toptan Satış İade İrsaliyesi')
    expect(r.type).toBe('KONSINYE')
    expect(r.needsReview).toBe(true)
  })
})
