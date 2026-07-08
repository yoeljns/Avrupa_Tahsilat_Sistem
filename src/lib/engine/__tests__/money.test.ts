import { describe, expect, it } from 'vitest'
import { formatCents, numberToCents, parseEurToCents } from '../money'

describe('parseEurToCents', () => {
  it('gerçek dosya biçimi: virgül ondalık + € işareti', () => {
    expect(parseEurToCents('51414,86 €')).toBe(5141486)
    expect(parseEurToCents('2708,41 €')).toBe(270841)
    expect(parseEurToCents('757,01 €')).toBe(75701)
  })
  it('binlik noktalı Türkçe biçim', () => {
    expect(parseEurToCents('51.414,86 €')).toBe(5141486)
    expect(parseEurToCents('2.583.832,87')).toBe(258383287)
  })
  it('İngilizce ondalık nokta (sayısal hücre metne dönmüşse)', () => {
    expect(parseEurToCents('5416.82')).toBe(541682)
  })
  it('yalnız nokta ve 3 haneli son grup → binlik kabul edilir', () => {
    expect(parseEurToCents('2.583')).toBe(258300)
  })
  it('sayı hücresi doğrudan cent olur (float kayması yuvarlanır)', () => {
    expect(numberToCents(5416.82)).toBe(541682)
    expect(numberToCents(0.1 + 0.2)).toBe(30)
  })
  it('negatif ve parantezli değerler', () => {
    expect(parseEurToCents('-120,50')).toBe(-12050)
    expect(parseEurToCents('(120,50)')).toBe(-12050)
  })
  it('çöp değerlerde null', () => {
    expect(parseEurToCents('')).toBe(null)
    expect(parseEurToCents('KONSİNYE')).toBe(null)
    expect(parseEurToCents(null)).toBe(null)
    expect(parseEurToCents(undefined)).toBe(null)
  })
})

describe('formatCents', () => {
  it('tr-TR biçiminde yazar', () => {
    expect(formatCents(5141486)).toBe('51.414,86')
    expect(formatCents(30)).toBe('0,30')
    expect(formatCents(-12050)).toBe('-120,50')
    expect(formatCents(0)).toBe('0,00')
  })
})
