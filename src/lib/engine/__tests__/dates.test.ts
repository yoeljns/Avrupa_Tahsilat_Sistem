import { describe, expect, it } from 'vitest'
import {
  addDaysISO,
  daysInMonth,
  excelSerialToISO,
  excelSerialToTimestamp,
  isDec31,
  isoFromYMDClamped,
} from '../dates'

// Bu testler TZ'den bağımsız geçmelidir (CI'da TZ=UTC ve TZ=Europe/Istanbul ile koşulur).

describe('excelSerialToISO — gerçek dosyadan doğrulanmış seriler', () => {
  it('46027 → 2026-01-05 (dosyanın ilk irsaliyesi)', () => {
    expect(excelSerialToISO(46027)).toBe('2026-01-05')
  })
  it('46028 → 2026-01-06, 46031 → 2026-01-09', () => {
    expect(excelSerialToISO(46028)).toBe('2026-01-06')
    expect(excelSerialToISO(46031)).toBe('2026-01-09')
  })
  it('46387 → 2026-12-31 (31/12 kuyruk bloğu)', () => {
    expect(excelSerialToISO(46387)).toBe('2026-12-31')
    expect(isDec31(excelSerialToISO(46387))).toBe(true)
  })
  it('geçersiz girişlerde null', () => {
    expect(excelSerialToISO(null)).toBe(null)
    expect(excelSerialToISO(undefined)).toBe(null)
    expect(excelSerialToISO(NaN)).toBe(null)
    expect(excelSerialToISO(10)).toBe(null) // 1900 hatalı-artık-yıl bölgesi reddedilir
  })
})

describe('excelSerialToTimestamp', () => {
  it('kesirli seri saat bilgisi taşır', () => {
    expect(excelSerialToTimestamp(46027.5)).toBe('2026-01-05T12:00:00.000Z')
  })
})

describe('takvim yardımcıları', () => {
  it('daysInMonth artık yılı bilir', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 12)).toBe(31)
  })
  it('isoFromYMDClamped 31 Şubatı ayın sonuna kıskaçlar', () => {
    expect(isoFromYMDClamped(2026, 2, 31)).toBe('2026-02-28')
    expect(isoFromYMDClamped(2026, 4, 31)).toBe('2026-04-30')
    expect(isoFromYMDClamped(2026, 3, 5)).toBe('2026-03-05')
  })
  it('addDaysISO ay/yıl sınırlarını aşar', () => {
    expect(addDaysISO('2026-01-05', 30)).toBe('2026-02-04')
    expect(addDaysISO('2026-12-15', 30)).toBe('2027-01-14')
  })
})
