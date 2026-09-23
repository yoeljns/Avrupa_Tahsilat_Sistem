import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPgShim } from '@/lib/import/__tests__/pgShim'
import { runRecompute } from '@/lib/recompute'
import { KULLANICI, SENTETIK_VERI, SOCKET, firmUuid, gocSql, kullaniciOlarak, testVeritabaniKur } from './testVeritabani'

// 0006_takvim.sql doğrulaması (yerel Postgres):
//   PG_TEST_SOCKET=/tmp/pgs npx vitest run src/lib/__tests__/takvim.int.test.ts
//
//  1) Süzgeçsiz rpc_takvim, eski rpc_matris_ay ile BİREBİR aynı firma/gün/toplam verir.
//  2) Kategori süzgeci yalnız o tipi getirir; tip toplamları genel toplamla tutar.
//  3) Firma "gecikmis" ve ay özeti kaynak taksitlerle tutar.
//  4) RLS korunur: pazarlamacı yalnız kendi firmalarını görür; anonim çağıramaz.

const DB = 'tahsilat_takvim'
const BUGUN = '2026-06-15'

interface Firma {
  firm_id: string
  toplam_borc: number
  toplam_odeme: number
  toplam_kalan: number
  once_kalan: number
  sonra_kalan: number
  gecikmis: number
  tarihsiz: boolean
  gunler: Record<string, [number, number, number]>
}
interface Takvim {
  ozet: { toplam_borc: number; toplam_odenen: number; toplam_kalan: number; gecikmis: number; yakin_7: number; tarihsiz_adet: number }
  ay_ozet: { borc: number; odeme: number; kalan: number; gecikmis: number }
  aylar: Array<{ ay: string; borc: number; kalan: number }>
  kategoriler: Array<{ kod: string; borc: number; kalan: number; gecikmis: number; firma: number }>
  firmalar: Firma[]
}

describe.skipIf(!SOCKET)('0006: rpc_takvim', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await testVeritabaniKur(DB)
    await pool.query(SENTETIK_VERI)
    await runRecompute(createPgShim(pool), 'setup', 'test@t.local')
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
  })

  async function takvim(uid: string, side: string, bas: string, son: string, kategoriler: string[] | null = null): Promise<Takvim> {
    const [r] = await kullaniciOlarak<{ r: Takvim }>(pool, uid, `select public.rpc_takvim($1, $2, $3, $4, $5) as r`, [
      side,
      bas,
      son,
      BUGUN,
      kategoriler,
    ])
    return r.r
  }

  it('göç ikinci kez uygulanabilir (idempotent)', async () => {
    await pool.query(gocSql('0006_takvim.sql'))
    const r = await pool.query(`select count(*)::int as n from pg_proc where proname = 'rpc_takvim'`)
    expect(r.rows[0].n).toBe(1) // aşırı yükleme yok
  })

  it('süzgeçsiz: eski rpc_matris_ay ile birebir aynı (iki taraf, üç ay)', async () => {
    for (const side of ['VADELI', 'PESIN']) {
      for (const [bas, son] of [
        ['2026-03-01', '2026-03-31'],
        ['2026-06-01', '2026-06-30'],
        ['2026-11-01', '2026-11-30'],
      ]) {
        const yeni = await takvim(KULLANICI.TAHSILAT, side, bas, son)
        const [eski] = await kullaniciOlarak<{ r: { ozet: Takvim['ozet']; firmalar: Firma[] } }>(
          pool,
          KULLANICI.TAHSILAT,
          `select public.rpc_matris_ay($1, $2, $3, $4) as r`,
          [side, bas, son, BUGUN],
        )
        const ozle = (f: Firma) => [f.firm_id, f.toplam_borc, f.toplam_odeme, f.toplam_kalan, f.once_kalan, f.sonra_kalan, f.tarihsiz, JSON.stringify(f.gunler)]
        expect(yeni.firmalar.map(ozle)).toEqual(eski.r.firmalar.map(ozle))
        expect(yeni.ozet.toplam_kalan).toBe(eski.r.ozet.toplam_kalan)
        expect(yeni.ozet.toplam_odenen).toBe(eski.r.ozet.toplam_odenen)
        expect(yeni.ozet.gecikmis).toBe(eski.r.ozet.gecikmis)
        expect(yeni.ozet.tarihsiz_adet).toBe(eski.r.ozet.tarihsiz_adet)
      }
    }
  })

  it('kategori süzgeci: yalnız o tip; tip toplamları genel toplamı verir', async () => {
    const hepsi = await takvim(KULLANICI.TAHSILAT, 'VADELI', '2026-06-01', '2026-06-30')
    expect(hepsi.kategoriler.map((k) => k.kod).sort()).toEqual(['KONSINYE', 'KONSINYE_PESIN'])
    expect(hepsi.kategoriler.reduce((s, k) => s + k.kalan, 0)).toBe(hepsi.ozet.toplam_kalan)
    expect(hepsi.kategoriler.reduce((s, k) => s + k.gecikmis, 0)).toBe(hepsi.ozet.gecikmis)

    const kp = await takvim(KULLANICI.TAHSILAT, 'VADELI', '2026-06-01', '2026-06-30', ['KONSINYE_PESIN'])
    const kpTip = hepsi.kategoriler.find((k) => k.kod === 'KONSINYE_PESIN')!
    expect(kp.ozet.toplam_kalan).toBe(kpTip.kalan)
    expect(kp.ozet.gecikmis).toBe(kpTip.gecikmis)
    // tip listesi süzgeçten bağımsızdır (süzgeç düğmeleri hep görünür)
    expect(kp.kategoriler).toEqual(hepsi.kategoriler)
    // süzülmüş firmalar gerçekten o tipte taksiti olanlar
    const kpFirmalar = await pool.query(
      `select distinct t.firm_id from public.installments t join public.invoices i on i.id = t.invoice_id
       where t.side = 'VADELI' and t.remaining_eur_cents is not null
         and coalesce(i.sale_type_override, i.sale_type_auto) = 'KONSINYE_PESIN'
         and (t.remaining_eur_cents > 0 or t.due_date between '2026-06-01' and '2026-06-30')`,
    )
    expect(new Set(kp.firmalar.map((f) => f.firm_id))).toEqual(new Set(kpFirmalar.rows.map((r) => r.firm_id)))
    // boş dizi = süzgeç yok
    const bos = await takvim(KULLANICI.TAHSILAT, 'VADELI', '2026-06-01', '2026-06-30', [])
    expect(bos.ozet.toplam_kalan).toBe(hepsi.ozet.toplam_kalan)
  })

  it('firma gecikmişi, ay özeti, 7 gün ve ay listesi kaynak taksitlerle tutar', async () => {
    const t = await takvim(KULLANICI.TAHSILAT, 'VADELI', '2026-06-01', '2026-06-30')
    const kaynak = await pool.query<{ firm_id: string; due_date: string; kalan: number; borc: number }>(
      `select firm_id, due_date, remaining_eur_cents as kalan, amount_eur_cents as borc
       from public.installments where side = 'VADELI' and remaining_eur_cents is not null`,
    )
    const gecikmisOf = new Map<string, number>()
    for (const r of kaynak.rows) if (r.due_date < BUGUN) gecikmisOf.set(r.firm_id, (gecikmisOf.get(r.firm_id) ?? 0) + r.kalan)
    for (const f of t.firmalar) expect(f.gecikmis).toBe(gecikmisOf.get(f.firm_id) ?? 0)

    const ay = kaynak.rows.filter((r) => r.due_date >= '2026-06-01' && r.due_date <= '2026-06-30')
    expect(t.ay_ozet.borc).toBe(ay.reduce((s, r) => s + r.borc, 0))
    expect(t.ay_ozet.kalan).toBe(ay.reduce((s, r) => s + r.kalan, 0))
    expect(t.ay_ozet.gecikmis).toBe(ay.filter((r) => r.due_date < BUGUN).reduce((s, r) => s + r.kalan, 0))
    expect(t.ozet.yakin_7).toBe(
      kaynak.rows.filter((r) => r.due_date >= BUGUN && r.due_date <= '2026-06-21').reduce((s, r) => s + r.kalan, 0),
    )
    expect(t.aylar.reduce((s, a) => s + a.kalan, 0)).toBe(t.ozet.toplam_kalan)
    expect(t.aylar.map((a) => a.ay)).toEqual([...t.aylar.map((a) => a.ay)].sort())
  })

  it('RLS: pazarlamacı yalnız kendi firmaları; anonim çağıramaz; geçersiz taraf reddedilir', async () => {
    const kendi = new Set(Array.from({ length: 10 }, (_, i) => firmUuid(i + 1)))
    const p = await takvim(KULLANICI.PAZ, 'VADELI', '2026-06-01', '2026-06-30')
    expect(p.firmalar.length).toBeGreaterThan(0)
    expect(p.firmalar.every((f) => kendi.has(f.firm_id))).toBe(true)
    const pasif = await takvim(KULLANICI.PASIF, 'VADELI', '2026-06-01', '2026-06-30')
    expect(pasif.firmalar).toHaveLength(0)
    await expect(
      kullaniciOlarak(pool, null, `select public.rpc_takvim('VADELI', '2026-06-01', '2026-06-30', '2026-06-15')`),
    ).rejects.toThrow(/permission denied/)
    await expect(takvim(KULLANICI.TAHSILAT, 'SACMA', '2026-06-01', '2026-06-30')).rejects.toThrow(/geçersiz taraf/)
  })
})
