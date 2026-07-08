import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBayilerXlsx } from '../bayilerParser'

// GERÇEK DOSYA testi — BAYILER_FILE ortam değişkeni verilince koşar.

const file = process.env.BAYILER_FILE

describe.skipIf(!file)('parseBayilerXlsx — gerçek dosya', () => {
  it('156 bayi ve 5 pazarlamacı okur', () => {
    const parsed = parseBayilerXlsx(readFileSync(file!))
    expect(parsed.records).toHaveLength(156)
    expect(parsed.invalids).toHaveLength(0)

    // '34 O02' ve '34 Ö02' ayrı bayiler olarak korunur
    const codes = new Set(parsed.records.map((r) => r.codeNorm))
    expect(codes.has('34 O02')).toBe(true)
    expect(codes.has('34 Ö02')).toBe(true)

    const emails = new Set(parsed.records.map((r) => r.pazarlamaciEmail).filter(Boolean))
    expect(emails).toEqual(
      new Set([
        'vedat@avrupagroup.com',
        'ercan@avrupagroup.com',
        'enis@avrupagroup.com',
        'mehmethan@avrupagroup.com',
        'levent@avrupagroup.com',
      ]),
    )

    const ayba = parsed.records.find((r) => r.codeNorm === '06 A02')!
    expect(ayba.pazarlamaciEmail).toBe('vedat@avrupagroup.com')
    expect(ayba.city).toBe('Ankara')

    // E-postasız 10 firma
    expect(parsed.records.filter((r) => !r.pazarlamaciEmail)).toHaveLength(10)
  })
})
