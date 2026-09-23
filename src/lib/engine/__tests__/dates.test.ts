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

import { isValidISODate } from '../dates'
import { todayISO, trDateTime } from '@/lib/format'
import { cellTimestamp } from '@/lib/import/odemelerParser'

describe('gerçek takvim günü kontrolü', () => {
  it("'2026-02-30' geçersiz, '2028-02-29' (artık yıl) geçerli", () => {
    expect(isValidISODate('2026-02-30')).toBe(false)
    expect(isValidISODate('2026-13-01')).toBe(false)
    expect(isValidISODate('2028-02-29')).toBe(true)
    expect(isValidISODate('2026-02-28')).toBe(true)
  })
})

describe('Türkiye saati', () => {
  it('UTC 22:30 = İstanbul ertesi gün 01:30 → bugün ertesi gün', () => {
    expect(todayISO(new Date('2026-09-22T22:30:00Z'))).toBe('2026-09-23')
    expect(todayISO(new Date('2026-09-22T20:59:00Z'))).toBe('2026-09-22')
  })
  it('saatler İstanbul saatiyle gösterilir', () => {
    expect(trDateTime('2026-09-23T09:05:08Z')).toBe('23.09.2026 12:05')
  })
})

describe('ödeme dosyasındaki metin tarihler', () => {
  it("'05.01.2026' 5 Ocak'tır (ay-önce okunup 1 Mayıs olmaz)", () => {
    expect(cellTimestamp('05.01.2026')).toBe('2026-01-05T00:00:00.000Z')
    expect(cellTimestamp('13.01.2026')).toBe('2026-01-13T00:00:00.000Z')
    expect(cellTimestamp('2026-01-05 00:00:00')).toBe('2026-01-05T00:00:00.000Z')
    expect(cellTimestamp('32.01.2026')).toBeNull()
  })
})
