import { describe, expect, it } from 'vitest'
import { parseOdemePlani } from '../planParser'

const INV = '2026-02-10' // temsili irsaliye tarihi (2026 yılı)

// İrsaliye dosyasındaki 49 FARKLI Ödeme Planı değerinin TAMAMI:
// [ham değer, beklenen durum, beklenen vade sayısı]
const ALL_49: Array<[string, string, number]> = [
  ['.30', 'net_days', 1],
  ['05 / 3-4-5', 'ok', 3],
  ['05 / 3-4-5-6-7', 'ok', 5],
  ['05 / 4-5-6', 'ok', 3],
  ['05 / 4-5-6-7', 'ok', 4],
  ['05 / 4-5-6-7-8', 'ok', 5],
  ['05 / 4-5-6-7-8-9', 'ok', 6],
  ['05 / 5-6', 'ok', 2],
  ['05 / 5-6-7', 'ok', 3],
  ['05 / 5-6-7-8-9', 'ok', 5],
  ['05 / 6-7-8', 'ok', 3],
  ['05 / 6-7-8-9', 'ok', 4],
  ['05 / 7-8', 'ok', 2],
  ['05 / 7-8-9', 'ok', 3],
  ['05.03.2026', 'ok', 1],
  ['05.04.2026', 'ok', 1],
  ['05.05.2026', 'ok', 1],
  ['05.06.2026', 'ok', 1],
  ['05.07.2026', 'ok', 1],
  ['05.08.2026', 'ok', 1],
  ['05.09.2026', 'ok', 1],
  ['05.10.2026', 'ok', 1],
  ['05.11.2026', 'ok', 1],
  ['05.12.2026', 'ok', 1],
  ['05/ 10-11', 'ok', 2],
  ['05/ 11-12', 'ok', 2],
  ['05/ 3--6--9--12', 'ok', 10], // 3..12 aralık doldurma
  ['05/ 4--8--12', 'ok', 9], // 4..12
  ['05/ 5--7--10--12', 'ok', 8], // 5..12
  ['05/ 5--8--11', 'ok', 7], // 5..11
  ['05/ 6--9--12', 'ok', 7], // 6..12
  ['05/ 6-7', 'ok', 2],
  ['05/ 7--10--12', 'ok', 6], // 7..12
  ['05/ 8--10--12', 'ok', 5], // 8..12
  ['05/ 8-9-10', 'ok', 3],
  ['05/ 9-10-11', 'ok', 3],
  ['05/3-4-5-6-7-8-9', 'ok', 7],
  ['15 / 3-4-5', 'ok', 3],
  ['15.03.2026', 'ok', 1],
  ['15.04.2026', 'ok', 1],
  ['15.05.2026', 'ok', 1],
  ['15.06.2026', 'ok', 1],
  ['15.07.2026', 'ok', 1],
  ['15.08.2026', 'ok', 1],
  ['15.10.2026', 'ok', 1],
  ['30.01.2026', 'ok', 1],
  ['30.03.2026', 'ok', 1],
  ['30.04.2026', 'ok', 1],
  ['NAKİT', 'cash', 1],
]

describe('parseOdemePlani — dosyadaki 49 değerin tamamı', () => {
  for (const [raw, status, count] of ALL_49) {
    it(`'${raw}' → ${status}, ${count} vade`, () => {
      const r = parseOdemePlani(raw, INV)
      expect(r.status).toBe(status)
      expect(r.dueDates).toHaveLength(count)
    })
  }
})

describe('parseOdemePlani — tarih anlık görüntüleri', () => {
  it("'05 / 3-4-5' → 05.03, 05.04, 05.05 2026", () => {
    expect(parseOdemePlani('05 / 3-4-5', INV).dueDates).toEqual(['2026-03-05', '2026-04-05', '2026-05-05'])
  })

  it("ÇİFT çizgi aralık doldurur: '05/ 4--8--12' → 4'ten 12'ye 9 ay", () => {
    expect(parseOdemePlani('05/ 4--8--12', INV).dueDates).toEqual([
      '2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05',
      '2026-09-05', '2026-10-05', '2026-11-05', '2026-12-05',
    ])
  })

  it("kullanıcının örneği: '05/3--5--7' = '05/3-4-5-6-7'", () => {
    const double = parseOdemePlani('05/3--5--7', INV).dueDates
    const list = parseOdemePlani('05/3-4-5-6-7', INV).dueDates
    expect(double).toEqual(list)
    expect(double).toEqual(['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05'])
  })

  it('em/en dash unicode tireler de çift çizgi sayılır (05/3—5–7)', () => {
    expect(parseOdemePlani('05/3—5–7', INV).dueDates).toEqual(
      parseOdemePlani('05/3-4-5-6-7', INV).dueDates,
    )
  })

  it("doğrudan tarih: '05.03.2026' (kuyruk boşlukları toleranslı)", () => {
    expect(parseOdemePlani('05.03.2026      ', INV).dueDates).toEqual(['2026-03-05'])
  })

  it("'.30' → irsaliye tarihi + 30 gün", () => {
    expect(parseOdemePlani('.30', '2026-01-05').dueDates).toEqual(['2026-02-04'])
  })

  it("'15 / 3-4-5' → ayın 15'i", () => {
    expect(parseOdemePlani('15 / 3-4-5', INV).dueDates).toEqual(['2026-03-15', '2026-04-15', '2026-05-15'])
  })

  it("gün 31 kısa aya kıskaçlanır: '31/ 2-4'", () => {
    expect(parseOdemePlani('31/ 2-4', INV).dueDates).toEqual(['2026-02-28', '2026-04-30'])
  })

  it("'NAKİT' → cash, vade=irsaliye tarihi", () => {
    const r = parseOdemePlani('NAKİT', '2026-01-05')
    expect(r.status).toBe('cash')
    expect(r.dueDates).toEqual(['2026-01-05'])
  })

  it('boş plan → empty_default, vade=irsaliye tarihi', () => {
    for (const empty of ['', '   ', null, undefined]) {
      const r = parseOdemePlani(empty, '2026-01-05')
      expect(r.status).toBe('empty_default')
      expect(r.dueDates).toEqual(['2026-01-05'])
    }
  })

  it('çözülemeyen plan → unparsed, vade=irsaliye tarihi, not içerir', () => {
    const r = parseOdemePlani('ÖZEL ANLAŞMA', '2026-01-05')
    expect(r.status).toBe('unparsed')
    expect(r.dueDates).toEqual(['2026-01-05'])
    expect(r.note).toContain('çözülemedi')
  })

  it('bozuk ay ifadeleri unparsed olur', () => {
    for (const bad of ['05/ 13-14', '05/ 5--3', '05/ -4-5', '05/ 4-5-', '05/', '05 / abc']) {
      expect(parseOdemePlani(bad, INV).status, bad).toBe('unparsed')
    }
  })

  it('ayları tekrarlı listede tekilleştirir', () => {
    expect(parseOdemePlani('05/ 4-4-5', INV).dueDates).toEqual(['2026-04-05', '2026-05-05'])
  })
})
