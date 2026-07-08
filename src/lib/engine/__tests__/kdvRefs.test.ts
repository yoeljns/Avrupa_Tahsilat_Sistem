import { describe, expect, it } from 'vitest'
import { fisNoDigitCount, fisNoSuffix4, parseKdvRefs } from '../kdvRefs'

// Referans biçimleri gerçek ödemeler dosyasından alınmıştır.

describe('parseKdvRefs', () => {
  it('KDV FATURA REFERANSI kolonundan tek referans', () => {
    expect(parseKdvRefs('0042', null)).toEqual(['0042'])
    expect(parseKdvRefs('1008', 'herhangi')).toEqual(['1008'])
  })

  it('virgüllü çoklu referans (KARSEL örneği)', () => {
    expect(parseKdvRefs('0007,0083,0143,0144', null)).toEqual(['0007', '0083', '0143', '0144'])
  })

  it('kolon boşsa açıklamadan çözer: 0042-5TE1', () => {
    expect(parseKdvRefs('', '0042-5TE1')).toEqual(['0042'])
    expect(parseKdvRefs(null, '0267-0354-5TE1')).toEqual(['0267', '0354'])
  })

  it("yalnız '5TE1' yazan açıklamada referans yoktur", () => {
    expect(parseKdvRefs('', '5TE1')).toEqual([])
    expect(parseKdvRefs(null, null)).toEqual([])
  })

  it('kısa referanslar 4 haneye dolgulanır, tekrarlar teklenir', () => {
    expect(parseKdvRefs('42', null)).toEqual(['0042'])
    expect(parseKdvRefs('0042,42', null)).toEqual(['0042'])
  })
})

describe('fisNoSuffix4 / fisNoDigitCount', () => {
  it('standart fiş numarasının son 4 hanesi', () => {
    expect(fisNoSuffix4('AVI2026000000042')).toBe('0042')
    expect(fisNoSuffix4('AVI2026000001380')).toBe('1380')
  })
  it('kısaltılmış mükerrer fişte de son 4 hane (çakışma tercih kuralı digit sayısıyla çözülür)', () => {
    expect(fisNoSuffix4('AVI202600000072')).toBe('0072')
    expect(fisNoDigitCount('AVI2026000000072')).toBe(13)
    expect(fisNoDigitCount('AVI202600000072')).toBe(12)
  })
  it('serbest metin fişlerde null olabilir', () => {
    expect(fisNoSuffix4('AVRUPA')).toBe(null)
    expect(fisNoSuffix4('KÖLÜK İST.3')).toBe(null)
  })
})
