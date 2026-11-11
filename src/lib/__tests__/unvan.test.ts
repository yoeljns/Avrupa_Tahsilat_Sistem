import { describe, expect, it } from 'vitest'
import { metinGenisligi, sigdir } from '@/lib/pdf/olcu'
import { ICERIK_GENISLIGI, yildizGenisligi } from '@/lib/pdf/parcalar'
import { kisaUnvan, unvanDuzelt, unvanGovdesi, unvanKisalt } from '@/lib/rapor/unvan'

// PDF tablolarında tek satır: metin ölçüsü, "…" ile kesme ve firma unvanı kısaltma.

describe('metinGenisligi (Roboto Regular)', () => {
  it('harf genişlikleri: dar ve geniş harfler ayrışır; boy ile doğru orantılı', () => {
    expect(metinGenisligi('', 8)).toBe(0)
    expect(metinGenisligi('İ', 10)).toBeCloseTo(2.72, 2)
    expect(metinGenisligi('M', 10)).toBeCloseTo(8.73, 2)
    expect(metinGenisligi('İİİİ', 7.5)).toBeLessThan(metinGenisligi('MMMM', 7.5) / 3)
    expect(metinGenisligi('ŞİRKET', 15)).toBeCloseTo(2 * metinGenisligi('ŞİRKET', 7.5), 6)
    // bilinmeyen karakter güvenli tarafta (geniş) sayılır
    expect(metinGenisligi('→', 10)).toBe(6)
  })

  it('gerçek genişliğe yakın: pdfmake ölçüsüyle karşılaştırma (harf aralığı daraltması hariç)', () => {
    // fontkit ölçüsü (1000 birim/em): 27468 — düz toplam biraz büyük kalır (güvenli taraf)
    const g = metinGenisligi('VEGA DOĞU HIRDAVAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ', 1000)
    expect(g).toBeGreaterThanOrEqual(27468)
    expect(g).toBeLessThan(27468 * 1.02)
  })
})

describe('sigdir', () => {
  it('sığan metne dokunmaz', () => {
    expect(sigdir('KARSEL BOYA', 200, 7.5)).toBe('KARSEL BOYA')
  })

  it('sözcük sınırından keser; sonuç genişliği aşmaz; sonda bağlaç ve noktalama bırakmaz', () => {
    const uzun = 'ŞAHİKA BOYA VE KİMYA SANAYİ İNŞAAT MALZEMELERİ VE TAAHHÜT DOĞALGAZ'
    for (const g of [40, 60, 75, 90, 120, 160, 200]) {
      const s = sigdir(uzun, g, 7.5)
      expect(metinGenisligi(s, 7.5), `${g}: ${s}`).toBeLessThanOrEqual(g)
      expect(s.endsWith('…')).toBe(true)
      expect(s).not.toMatch(/(\sVE|[\s,\-])…$/)
    }
    expect(sigdir('ŞAHİKA BOYA VE KİMYA', metinGenisligi('ŞAHİKA BOYA VE K…', 7.5), 7.5)).toBe('ŞAHİKA BOYA…')
    expect(sigdir('ÖZ-TÜR CIVATA, HIRDAVAT', metinGenisligi('ÖZ-TÜR CIVATA, H…', 7.5), 7.5)).toBe('ÖZ-TÜR CIVATA…')
  })

  it('tek sözcük sığmıyorsa harf harf keser; yer hiç yoksa yalnız "…" kalır', () => {
    const s = sigdir('İNŞ.MALZ.TAAH.NAKLİ.HAF.PAZ.TİC.VE', 60, 7.5)
    expect(s.endsWith('…')).toBe(true)
    expect(s.length).toBeGreaterThan(5)
    expect(metinGenisligi(s, 7.5)).toBeLessThanOrEqual(60)
    expect(sigdir('KARSEL', 2, 7.5)).toBe('…')
    expect(sigdir('KARSEL', -10, 7.5)).toBe('…')
  })

  it('isaretli: sığsa bile "…" ile biter (devamı çağıran tarafından atılmış metin)', () => {
    expect(sigdir('KARSEL BOYA', 200, 7.5, true)).toBe('KARSEL BOYA…')
    expect(sigdir('KARSEL BOYA', metinGenisligi('KARSEL BOYA…', 7.5), 7.5, true)).toBe('KARSEL BOYA…')
    expect(sigdir('KARSEL BOYA', metinGenisligi('KARSEL BOYA…', 7.5) - 0.5, 7.5, true)).toBe('KARSEL…')
  })
})

describe('unvan yardımcıları', () => {
  it('unvanDuzelt: fazla boşluk; kısaltma noktasından sonra boşluk; tek harfli kısaltmalar aynen', () => {
    expect(unvanDuzelt('HTK ENDS.ÜRÜN.YAPI.KİM.İÇ VE DIŞ TİC.LTD.ŞTİ')).toBe('HTK ENDS. ÜRÜN. YAPI. KİM. İÇ VE DIŞ TİC. LTD. ŞTİ')
    expect(unvanDuzelt('  OLGUN   CİVATA  A.Ş. ')).toBe('OLGUN CİVATA A.Ş.')
    expect(unvanDuzelt('T.C.ZİRAAT')).toBe('T.C.ZİRAAT')
    expect(unvanDuzelt('BOYA,HIRDAVAT LTD.ŞTİ.')).toBe('BOYA, HIRDAVAT LTD. ŞTİ.')
    expect(unvanDuzelt('KARSEL BOYA')).toBe('KARSEL BOYA')
  })

  it('unvanKisalt: şirket türü ve "sanayi ve ticaret"; küçük harf ve Türkçe harfsiz yazım da', () => {
    expect(unvanKisalt('VEGA DOĞU HIRDAVAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ')).toBe('VEGA DOĞU HIRDAVAT SAN. VE TİC. LTD. ŞTİ.')
    expect(unvanKisalt('BÜYÜKYILDIZ GIDA ANONİM ŞİRKETİ')).toBe('BÜYÜKYILDIZ GIDA A.Ş.')
    expect(unvanKisalt('KORKMAZLAR INSAAT TICARET VE SANAYI LIMITED SIRKETI')).toBe('KORKMAZLAR INSAAT TİC. VE SAN. LTD. ŞTİ.')
    expect(unvanKisalt('Vega Boya Limited Şirketi.')).toBe('Vega Boya LTD. ŞTİ.')
    // sözcük içinde eşleşmez; kalıp yoksa aynen
    expect(unvanKisalt('SANAYİ BOYALARI TİCARETHANESİ')).toBe('SANAYİ BOYALARI TİCARETHANESİ')
    expect(unvanKisalt('DOST TİCARET-ARSLAN KOZ')).toBe('DOST TİCARET-ARSLAN KOZ')
  })

  it('unvanGovdesi: sondaki şirket türü ekleri ve bağlaçlar atılır; hepsi ekse aynen kalır', () => {
    expect(unvanGovdesi('KORKMAZLAR INSAAT ORMAN ÜR. GIY. GID. SAN. TIC. LTD. STI.')).toBe('KORKMAZLAR INSAAT ORMAN ÜR. GIY. GID.')
    expect(unvanGovdesi('SERALP OTO BOYA KAPORTA GIDA TİC VE SAN LTD ŞTİ')).toBe('SERALP OTO BOYA KAPORTA GIDA')
    expect(unvanGovdesi('OLGUN CİVATA VE BAĞLANTI ELEM. İMAL. VE SATIŞ A.Ş.')).toBe('OLGUN CİVATA VE BAĞLANTI ELEM. İMAL. VE SATIŞ')
    expect(unvanGovdesi('SAN. VE TİC. LTD. ŞTİ.')).toBe('SAN. VE TİC. LTD. ŞTİ.')
    expect(unvanGovdesi('DOST TİCARET-ARSLAN KOZ')).toBe('DOST TİCARET-ARSLAN KOZ')
  })
})

describe('kisaUnvan', () => {
  const BOY = 7.5
  const g = (s: string) => metinGenisligi(s, BOY)

  it('sırayla: tam unvan → kısaltılmış → gövde + "…" → kesilmiş', () => {
    const ad = 'VEGA DOĞU HIRDAVAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ'
    expect(kisaUnvan(ad, g(ad), BOY)).toBe(ad)
    expect(kisaUnvan(ad, g(ad) - 1, BOY)).toBe('VEGA DOĞU HIRDAVAT SAN. VE TİC. LTD. ŞTİ.')
    expect(kisaUnvan(ad, g('VEGA DOĞU HIRDAVAT SAN. VE TİC. LTD. ŞTİ.') - 1, BOY)).toBe('VEGA DOĞU HIRDAVAT…')
    expect(kisaUnvan(ad, g('VEGA DOĞU HIRDAVAT…'), BOY)).toBe('VEGA DOĞU HIRDAVAT…')
    // şirket eki atıldıysa "…" hiç düşmez: bir punto eksikte bile bir sözcük daha kısalır
    expect(kisaUnvan(ad, g('VEGA DOĞU HIRDAVAT…') - 1, BOY)).toBe('VEGA DOĞU…')
    expect(kisaUnvan(ad, 12, BOY)).toMatch(/^V?…$/)
  })

  it('noktayla bitişik yazılmış unvan satıra bölünebilir hale gelir ve kuyruğu atılır', () => {
    const ad = 'KORKMAZLAR INSAAT ORMAN ÜR.GIY.GID.SAN.TIC.LTD.STI.'
    expect(kisaUnvan(ad, 400, BOY)).toBe('KORKMAZLAR INSAAT ORMAN ÜR. GIY. GID. SAN. TIC. LTD. STI.')
    expect(kisaUnvan(ad, g('KORKMAZLAR INSAAT ORMAN ÜR. GIY. GID.…'), BOY)).toBe('KORKMAZLAR INSAAT ORMAN ÜR. GIY. GID.…')
    expect(kisaUnvan(ad, g('KORKMAZLAR INSAAT ORMAN ÜR. GIY. GID.…') - 1, BOY)).toBe('KORKMAZLAR INSAAT ORMAN ÜR. GIY.…')
    expect(kisaUnvan(ad, g('KORKMAZLAR INSAAT ORMAN…'), BOY)).toBe('KORKMAZLAR INSAAT ORMAN…')
    expect(kisaUnvan(ad, g('KORKMAZLAR INSAAT ORMAN…') - 1, BOY)).toBe('KORKMAZLAR INSAAT…')
  })

  it('her genişlikte sonuç sığar; kesilen unvan şirket türü ekiyle ya da bağlaçla bitmez', () => {
    const adlar = [
      'ŞAHİKA BOYA VE KİMYA SANAYİ İNŞAAT MALZEMELERİ VE TAAHHÜT DOĞALGAZ VE MÜHENDİSLİK HİZMETLERİ NAKLİYAT GIDA İTHALAT İHRACAT TİCARET SANAYİ A.Ş.',
      'TOKMAK OTOMOTİV PETROL İNŞAAT YAPI MALZEMELERİ TAŞIMACILIK GIDA TARIM HAYVANCILIK İTHALAT VE SAN.LTD.ŞTİ.',
      'SAĞLAM KARO MERMER İMALATI VE MALZEME SATIŞI İNŞAAT VE İNŞ.MALZ.TAAH.NAKLİ.HAF.PAZ.TİC.VE SAN.LTD ŞT',
      'AR-GE TEKNİK HIRDAVAT METAL İNŞAAT TAŞIMACILIK İTHALAT İHRACAT SAN. VE TİC. LTD. ŞTİ.',
      'YİĞİT OTOM. VE SANAYİ BOYALARI TOP.TİC-BAYRAM YİĞİT',
      'GORGİA LLC.',
      'CENGİZ AKŞEHİRLİOĞLU',
    ]
    for (const ad of adlar) {
      for (let genislik = 30; genislik <= 420; genislik += 13) {
        const s = kisaUnvan(ad, genislik, BOY)
        expect(g(s), `${genislik}: ${s}`).toBeLessThanOrEqual(genislik)
        if (s.endsWith('…') && s.length > 1) expect(s, `${genislik}`).not.toMatch(/(?:\s(?:VE|SAN\.?|TİC\.?|LTD\.?|ŞTİ\.?|A\.Ş\.)|[\s,\-])…$/)
      }
    }
    expect(kisaUnvan('GORGİA LLC.', 100, BOY)).toBe('GORGİA LLC.')
  })
})

describe('yildizGenisligi', () => {
  it('içerik genişliği − sabit sütunlar − hücre boşlukları; birden çok yıldız eşit paylaşır', () => {
    expect(yildizGenisligi([{ baslik: 'a', genislik: '*' }])).toBeCloseTo(ICERIK_GENISLIGI - 8, 6)
    expect(yildizGenisligi([{ baslik: 'a', genislik: '*' }, { baslik: 'b', genislik: 60 }, { baslik: 'c', genislik: 40 }])).toBeCloseTo(ICERIK_GENISLIGI - 100 - 24, 6)
    expect(yildizGenisligi([{ baslik: 'a', genislik: '*' }, { baslik: 'b', genislik: '*' }], 216)).toBeCloseTo(100, 6)
  })
})
