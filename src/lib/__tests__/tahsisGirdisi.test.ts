import { describe, expect, it } from 'vitest'
import { reconcile } from '@/lib/engine/reconcile'
import {
  haricFirmaKumesi,
  motorGirdisiKur,
  odemeEtkinTutar,
  type GirdiIrsaliye,
  type GirdiOdeme,
  type GirdiTaksit,
} from '@/lib/tahsisGirdisi'

// FİRMA BAZLI YENİDEN HESAP'ın doğruluk garantisi: bir firmayı tek başına
// hesaplamak, tüm sistemi hesaplayıp o firmanın sonucuna bakmakla BİREBİR aynı
// olmalı (tahsis kuralı firma sınırını hiç aşmaz). Rastgele ama tekrarlanabilir
// bir veri kümesiyle kanıtlanır.

function rastgele(tohum: number) {
  let s = tohum
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function veriUret(tohum: number) {
  const r = rastgele(tohum)
  const firmalar = Array.from({ length: 12 }, (_, i) => ({
    id: `f${String(i).padStart(2, '0')}`,
    code_norm: i === 11 ? '54 Ç03' : `34 A${String(i).padStart(2, '0')}`,
  }))
  const irsaliyeler: GirdiIrsaliye[] = []
  const taksitler: GirdiTaksit[] = []
  const odemeler: GirdiOdeme[] = []
  let n = 0
  for (const f of firmalar) {
    const adet = 3 + Math.floor(r() * 6)
    for (let k = 0; k < adet; k++) {
      const id = `i${n++}`
      const pesin = r() < 0.35
      const ay = 1 + Math.floor(r() * 9)
      const fis = `AVI2026${String(1000 + n).padStart(9, '0')}`
      irsaliyeler.push({
        id,
        firm_id: f.id,
        fis_no: fis,
        invoice_date: `2026-${String(ay).padStart(2, '0')}-1${Math.floor(r() * 9)}`,
        side: pesin ? 'PESIN' : 'VADELI',
        is_allocatable: r() > 0.1,
      })
      const parca = pesin ? 1 : 1 + Math.floor(r() * 4)
      for (let s = 1; s <= parca; s++) {
        taksitler.push({
          id: `${id}-t${s}`,
          invoice_id: id,
          firm_id: f.id,
          seq: s,
          due_date: `2026-${String(Math.min(12, ay + s)).padStart(2, '0')}-05`,
          amount_eur_cents: 10000 + Math.floor(r() * 500000),
        })
      }
    }
    const odemeAdet = Math.floor(r() * 7)
    for (let k = 0; k < odemeAdet; k++) {
      const kdv = r() < 0.2
      const hedef = irsaliyeler.filter((i) => i.firm_id === f.id)[0]
      const tutar = 5000 + Math.floor(r() * 900000)
      // 0008: bazı ödemelerde DÖVİZ EURO boş (elle girilmiş ya da hiç girilmemiş), bazılarında elle düzeltilmiş
      const tur = r()
      odemeler.push({
        id: `p${n++}`,
        islem_kodu: `ISL-${n}`,
        firm_id: f.id,
        islem_tarihi: `2026-0${1 + Math.floor(r() * 9)}-0${1 + Math.floor(r() * 8)}T00:00:00+00:00`,
        doviz_eur_cents: tur < 0.2 ? null : tutar,
        doviz_eur_cents_override: tur < 0.12 ? tutar : tur > 0.9 ? tutar + 1234 : null,
        is_kdv: kdv,
        kdv_fatura_referansi: kdv ? hedef.fis_no.slice(-4) : null,
        aciklama: null,
      })
    }
  }
  return { firmalar, irsaliyeler, taksitler, odemeler }
}

describe('firma bazlı hesap = tam hesabın o firmaya düşen kısmı', () => {
  for (const tohum of [1, 7, 42, 2026]) {
    it(`tohum ${tohum}: her firma için tahsis, kalan ve bakiye birebir aynı`, () => {
      const v = veriUret(tohum)
      const haric = haricFirmaKumesi(v.firmalar, ['54 C03'])
      expect(haric.has('f11')).toBe(true) // Türkçe katlama: '54 C03' = '54 Ç03'

      const tam = motorGirdisiKur(v.irsaliyeler, v.taksitler, v.odemeler, haric)
      const tamSonuc = reconcile({ installments: tam.installments, payments: tam.payments, asOf: '2026-06-15' })

      for (const f of v.firmalar) {
        const sadece = <T extends { firm_id: string }>(xs: T[]) => xs.filter((x) => x.firm_id === f.id)
        const tek = motorGirdisiKur(sadece(v.irsaliyeler), sadece(v.taksitler), sadece(v.odemeler), haric)
        const tekSonuc = reconcile({ installments: tek.installments, payments: tek.payments, asOf: '2026-06-15' })

        expect(tekSonuc.allocations).toEqual(tamSonuc.allocations.filter((a) => a.firmId === f.id))
        expect(tekSonuc.balances).toEqual(tamSonuc.balances.filter((b) => b.firmId === f.id))
        for (const t of tek.installments) {
          expect(tekSonuc.remainingByInstallment.get(t.id)).toBe(tamSonuc.remainingByInstallment.get(t.id))
        }
        expect(new Set(tek.kapsamDisiTaksitIds)).toEqual(
          new Set(tam.kapsamDisiTaksitIds.filter((id) => v.taksitler.find((t) => t.id === id)!.firm_id === f.id)),
        )
      }
    })
  }
})

describe('ödemenin EUR tutarı: elle girilen EUR, yoksa DÖVİZ EURO (0008)', () => {
  const firma = [{ id: 'f1', code_norm: '34 A01' }]
  const irs: GirdiIrsaliye[] = [
    { id: 'i1', firm_id: 'f1', fis_no: 'AVI2026000000101', invoice_date: '2026-06-10', side: 'PESIN', is_allocatable: true },
  ]
  const tak: GirdiTaksit[] = [{ id: 'i1-1', invoice_id: 'i1', firm_id: 'f1', seq: 1, due_date: '2026-06-10', amount_eur_cents: 150000 }]
  const odeme = (id: string, eur: number | null, elle?: number | null, ek: Partial<GirdiOdeme> = {}): GirdiOdeme => ({
    id,
    islem_kodu: id,
    firm_id: 'f1',
    islem_tarihi: '2026-06-12T00:00:00+00:00',
    doviz_eur_cents: eur,
    doviz_eur_cents_override: elle,
    is_kdv: false,
    kdv_fatura_referansi: null,
    aciklama: null,
    ...ek,
  })
  const kur = (odemeler: GirdiOdeme[]) => motorGirdisiKur(irs, tak, odemeler, haricFirmaKumesi(firma, []))

  it('etkin tutar: elle girilen önce, yoksa dosyadaki', () => {
    expect(odemeEtkinTutar({ doviz_eur_cents: 100, doviz_eur_cents_override: 250 })).toBe(250)
    expect(odemeEtkinTutar({ doviz_eur_cents: 100, doviz_eur_cents_override: null })).toBe(100)
    expect(odemeEtkinTutar({ doviz_eur_cents: 100 })).toBe(100)
    expect(odemeEtkinTutar({ doviz_eur_cents: null, doviz_eur_cents_override: null })).toBeNull()
  })

  it("EUR'suz ödeme hesaba girmez; elle EUR girilince girer ve borcu kapatır", () => {
    expect(kur([odeme('p1', null)]).payments).toHaveLength(0)
    expect(kur([odeme('p1', 0)]).payments).toHaveLength(0)
    const g = kur([odeme('p1', null, 150000)])
    expect(g.payments.map((p) => p.amountCents)).toEqual([150000])
    const r = reconcile({ installments: g.installments, payments: g.payments, asOf: '2026-09-30' })
    expect(r.remainingByInstallment.get('i1-1')).toBe(0)
    expect(r.balances[0].totalPaidCents).toBe(150000)
  })

  it('elle girilen EUR dosyadaki tutarın önüne geçer', () => {
    expect(kur([odeme('p1', 100000, 120000)]).payments[0].amountCents).toBe(120000)
  })

  it('KDV ödemesi de elle girilen EUR ile hedef irsaliyeden düşer; EUR yoksa eşleşmeyen sayılmaz', () => {
    const kdv = { is_kdv: true, kdv_fatura_referansi: '0101' }
    const g = kur([odeme('k1', null, 30000, kdv)])
    expect(g.payments).toEqual([expect.objectContaining({ id: 'k1', isKdv: true, amountCents: 30000, targetInvoiceIds: ['i1'] })])
    expect(g.kdvEslesen).toBe(1)
    const bos = kur([odeme('k2', null, null, kdv)])
    expect(bos.payments).toHaveLength(0)
    expect(bos.kdvEslesen + bos.kdvEslesmeyen).toBe(0)
  })
})
