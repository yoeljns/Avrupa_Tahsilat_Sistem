import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseIrsaliyeXls } from '../irsaliyeParser'

// GERÇEK DOSYA entegrasyon testi — yalnız IRSALIYE_FILE ortam değişkeni
// gerçek .xls dosyasını gösterdiğinde koşar (iş verisi repoya konmaz).
//   IRSALIYE_FILE=/path/to/sat_s__irsaliye.xls npx vitest run

const file = process.env.IRSALIYE_FILE

describe.skipIf(!file)('parseIrsaliyeXls — gerçek dosya', () => {
  it('beklenen sayıları üretir', () => {
    const parsed = parseIrsaliyeXls(readFileSync(file!))
    const byType = new Map<string, number>()
    let n3112 = 0
    let noDate = 0
    let review = 0
    for (const r of parsed.records) {
      byType.set(r.saleTypeAuto, (byType.get(r.saleTypeAuto) ?? 0) + 1)
      if (r.is3112) n3112++
      if (r.planParseStatus === 'empty_default' && (r.saleTypeAuto === 'KONSINYE' || r.saleTypeAuto === 'KONSINYE_PESIN'))
        noDate++
      if (r.needsReview) review++
    }
    // Analizden bilinen değerler (2026-07-08 tarihli dosya):
    expect(parsed.records.length + parsed.invalids.length).toBe(2064)
    expect(parsed.invalids.length).toBe(0)
    expect(n3112).toBe(66)
    expect(byType.get('KONSINYE')).toBe(767)
    expect(byType.get('KONSINYE_PESIN')).toBe(520)
    expect(byType.get('PESIN')).toBe(522)
    expect(byType.get('OTHER')).toBe(255)
    expect(noDate).toBe(596)

    // Örnek satır doğrulaması: ilk irsaliye
    const first = parsed.records.find((r) => r.fisNo === 'AVI2026000000001')!
    expect(first.invoiceDateISO).toBe('2026-01-05')
    expect(first.saleTypeAuto).toBe('KONSINYE')
    expect(first.firmCodeNorm).toBe('06 K08')
    expect(first.amountEurCents).toBe(5141486)

    // Türkçe karakterli firma kodu: '54 Ç03' → '54 C03'
    const cagpas = parsed.records.find((r) => r.firmCodeRaw === '54 Ç03')
    if (cagpas) expect(cagpas.firmCodeNorm).toBe('54 C03')

    // Kuyruk bloğu: serbest metin fiş no, 31/12
    const koluk = parsed.records.find((r) => r.fisNo === 'KÖLÜK İST.3')
    expect(koluk).toBeDefined()
    expect(koluk!.is3112).toBe(true)
    expect(koluk!.fisnoNonstandard).toBe(true)

    // Çok taksitli plan örneği: '05/3-4-5-6-7-8-9' → 7 vade
    const multi = parsed.records.find((r) => r.odemePlaniRaw === '05/3-4-5-6-7-8-9')!
    expect(multi.dueDates).toHaveLength(7)

    // Bilgi amaçlı özet (test çıktısında görünür)
    console.log('İnceleme bekleyen:', review, '— uyarılar:', parsed.warnings)
  })
})
