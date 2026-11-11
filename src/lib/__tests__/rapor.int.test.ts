import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createPgShim } from '@/lib/import/__tests__/pgShim'
import { pdfUret } from '@/lib/pdf/pdf'
import { raporVerisi, type RaporVerisi } from '@/lib/queries'
import { tahsilatDurumuKur, type RaporTuru } from '@/lib/rapor/tahsilatDurumu'
import { tahsilatDurumuBelgesi } from '@/lib/rapor/tahsilatDurumuPdf'
import { runRecompute } from '@/lib/recompute'
import { KULLANICI, SENTETIK_VERI, SOCKET, firmUuid, gocSql, kullaniciOlarak, testVeritabaniKur } from './testVeritabani'

// 0010_rapor.sql (yerel Postgres):
//   PG_TEST_SOCKET=/tmp/pgs npx vitest run src/lib/__tests__/rapor.int.test.ts
//
//  1) Göç iki kez çalışır; tek imza; anonim çağıramaz.
//  2) Σ tahsilat + Σ alacak = Pano'daki toplam tahsilat; hücre toplamları = Pano.
//  3) Rapor kurucusunun ana rakamları Pano ile aynı (açık borç, gecikmiş, 7 / 30 gün, alacak).
//  4) RLS: pazarlamacı yalnız kendi firmalarını alır; yönetim özeti ona null gelir.
//  5) Tahsilat ayı Türkiye gününe göredir.
//  6) Gerçek veriden üç PDF türü üretilir.

const DB = 'tahsilat_rapor'
const BUGUN = '2026-11-11'
const { YONETICI, TAHSILAT, PAZ } = KULLANICI

describe.skipIf(!SOCKET)('0010: Tahsilat Durum Raporu verisi', () => {
  let pool: Pool
  let admin: SupabaseClient

  const tek = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T
  const veriAl = async (uid: string) => (await kullaniciOlarak<{ v: RaporVerisi }>(pool, uid, 'select public.rpc_rapor_verisi($1::date) as v', [BUGUN]))[0].v

  beforeAll(async () => {
    pool = await testVeritabaniKur(DB)
    await pool.query(SENTETIK_VERI)
    admin = createPgShim(pool)
    await runRecompute(admin, 'setup', 'test@t.local')
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
  })

  it('göç iki kez çalışır; fonksiyon tek imzayla durur; anonim çağıramaz', async () => {
    await pool.query(gocSql('0010_rapor.sql'))
    const n = await tek<{ n: number }>(
      `select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'rpc_rapor_verisi'`,
    )
    expect(n.n).toBe(1)
    await expect(kullaniciOlarak(pool, null, `select public.rpc_rapor_verisi(date '${BUGUN}')`)).rejects.toThrow(/permission denied/)
  })

  it('Σ tahsilat + Σ alacak = Pano toplam tahsilat; hücre toplamları = Pano; tahsilat = güncel hesabın tahsisleri', async () => {
    const v = await veriAl(YONETICI)
    const pano = v.pano.bakiye!
    const tahsilat = v.tahsilat.reduce((t, r) => t + r[2], 0)
    const alacak = v.bakiye.alacaklar.reduce((t, a) => t + a.alacak, 0)
    expect(tahsilat).toBeGreaterThan(0)
    expect(alacak).toBeGreaterThan(0)
    expect(tahsilat + alacak).toBe(pano.toplam_odenen)
    expect(alacak).toBe(pano.alacak)
    expect(v.bakiye.hucreler.reduce((t, h) => t + h[4], 0)).toBe(pano.toplam_borc)
    expect(v.bakiye.hucreler.reduce((t, h) => t + h[5], 0)).toBe(pano.pesin_acik + pano.vadeli_acik)
    // borca işlenen = borç − kalan
    expect(tahsilat).toBe(pano.toplam_borc - pano.pesin_acik - pano.vadeli_acik)
    const db = await tek<{ s: number; n: number }>(
      `select coalesce(sum(a.amount_eur_cents), 0)::bigint as s, count(distinct (a.firm_id, to_char((p.islem_tarihi at time zone 'Europe/Istanbul')::date, 'YYYY-MM')))::int as n
       from public.allocations a join public.payments p on p.id = a.payment_id join public.v_current_run r on r.run_id = a.run_id`,
    )
    expect(tahsilat).toBe(db.s)
    expect(v.tahsilat).toHaveLength(db.n)
    // her satır: [firma_id, 'YYYY-AA', tutar > 0, ayın içindeki bir gün]
    for (const [firma, ay, tutar, gun] of v.tahsilat) {
      expect(typeof firma).toBe('string')
      expect(ay).toMatch(/^\d{4}-\d{2}$/)
      expect(tutar).toBeGreaterThan(0)
      expect(gun!.slice(0, 7)).toBe(ay)
    }
  })

  it('rapor kurucusunun ana rakamları Pano ile aynı', async () => {
    const v = await raporVerisi(admin, BUGUN)
    const d = tahsilatDurumuKur(v, BUGUN, { tur: 'ozet', sorumlu: '', ay: null })
    const b = v.pano.bakiye!
    const vade = v.pano.vade!
    expect(d.ozet.borc).toBe(b.toplam_borc)
    expect(d.ozet.toplamTahsilat).toBe(b.toplam_odenen)
    expect(d.ozet.alacak).toBe(b.alacak)
    expect(d.ozet.pesinKalan).toBe(b.pesin_acik)
    expect(d.ozet.vadeliKalan).toBe(b.vadeli_acik)
    expect(d.ozet.borcluFirma).toBe(b.borclu_firma)
    expect(d.ozet.gecikmisVadeli).toBe(vade.gecikmis)
    expect(d.ozet.gun7).toBe(vade.gun7)
    expect(d.ozet.gun30).toBe(vade.gun30)
    // kırılımlar toplamı verir
    expect(d.yaslandirma.reduce((t, y) => t + y.tutar, 0)).toBe(d.ozet.kalan)
    expect(d.kategoriler.reduce((t, k) => t + k.kalan, 0)).toBe(d.ozet.kalan)
    expect(d.sorumlular.reduce((t, s) => t + s.kalan, 0)).toBe(d.ozet.kalan)
    expect(d.sorumlular.reduce((t, s) => t + s.alacak, 0)).toBe(d.ozet.alacak)
    expect(d.aylar.reduce((t, a) => t + a.tahsilat, 0) + d.tarihsizTahsilat).toBe(d.ozet.odeme)
    // kategori kırılımı Pano'nun kategori kartlarıyla aynı
    for (const k of v.pano.kategoriler ?? []) {
      const r = d.kategoriler.find((x) => x.kod === k.kod)
      if (k.acik > 0) expect(r, k.kod).toMatchObject({ kalan: k.acik })
    }
    // süzgeçli rapor: yalnız PAZ → toplam yalnız onun firmaları
    const paz = tahsilatDurumuKur(v, BUGUN, { tur: 'ozet', sorumlu: 'PAZ', ay: null })
    const pb = await tek<{ borc: number; kalan: number; firma: number }>(
      `select coalesce(sum(s.amount_eur_cents), 0)::bigint as borc, coalesce(sum(s.remaining_eur_cents), 0)::bigint as kalan, count(distinct s.firm_id)::int as firma
       from public.v_installments_scope s join public.firms f on f.id = s.firm_id where f.pazarlamaci_email = 'paz@t.local'`,
    )
    expect(paz.ozet).toMatchObject({ borc: pb.borc, kalan: pb.kalan, firma: pb.firma })
  })

  it('RLS: pazarlamacı yalnız kendi firmalarını alır; yönetim özeti yalnız yönetime gelir', async () => {
    const paz = await veriAl(PAZ)
    const kendi = new Set((await pool.query(`select id from public.firms where pazarlamaci_email = 'paz@t.local'`)).rows.map((r) => r.id as string))
    expect(paz.bakiye.firmalar.length).toBeGreaterThan(0)
    expect(paz.bakiye.firmalar.every((f) => kendi.has(f.id))).toBe(true)
    expect(paz.tahsilat.length).toBeGreaterThan(0)
    expect(paz.tahsilat.every((r) => kendi.has(r[0]))).toBe(true)
    expect(paz.bakiye.alacaklar.every((a) => kendi.has(a.firm_id))).toBe(true)
    expect(paz.yonetim).toBeNull()
    // pazarlamacının kendi Pano'su ile aynı toplam
    expect(paz.tahsilat.reduce((t, r) => t + r[2], 0) + paz.bakiye.alacaklar.reduce((t, a) => t + a.alacak, 0)).toBe(paz.pano.bakiye!.toplam_odenen)

    for (const uid of [YONETICI, TAHSILAT]) {
      const v = await veriAl(uid)
      expect(v.yonetim).not.toBeNull()
      expect(v.yonetim!.saglik).toBeDefined()
      expect(v.bakiye.firmalar.length).toBeGreaterThan(paz.bakiye.firmalar.length)
    }
  })

  it('tahsilat ayı Türkiye gününe göredir: 30.09 22:30 UTC ödemesi Ekim sayılır', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      const kosu = (await c.query(`select run_id from public.v_current_run`)).rows[0].run_id as string
      const taksit = (
        await c.query(`select t.id, t.invoice_id, t.firm_id, t.side from public.installments t where t.firm_id = $1 and t.remaining_eur_cents is not null limit 1`, [firmUuid(2)])
      ).rows[0] as { id: string; invoice_id: string; firm_id: string; side: string }
      const odeme = (
        await c.query(
          `insert into public.payments (islem_kodu, sheet_side, firm_id, islem_tarihi, doviz_eur_cents, is_alc, is_complete, is_kdv)
           values ('TZ-AY', 'PESIN', $1, timestamptz '2026-09-30 22:30:00+00', 777, false, true, false) returning id`,
          [taksit.firm_id],
        )
      ).rows[0].id as string
      await c.query(
        `insert into public.allocations (run_id, payment_id, installment_id, invoice_id, firm_id, side, amount_eur_cents) values ($1, $2, $3, $4, $5, $6, 777)`,
        [kosu, odeme, taksit.id, taksit.invoice_id, taksit.firm_id, taksit.side],
      )
      const { rows } = await c.query(
        `select t from jsonb_array_elements(public.rpc_rapor_verisi(date '${BUGUN}')->'tahsilat') t where t->>0 = $1 and t->>1 = '2026-10'`,
        [taksit.firm_id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].t[2]).toBeGreaterThanOrEqual(777)
      expect(rows[0].t[3] >= '2026-10-01').toBe(true)
    } finally {
      await c.query('rollback')
      c.release()
    }
  })

  it('gerçek veriden üç PDF türü üretilir', async () => {
    const v = await veriAl(YONETICI)
    for (const tur of ['kisa', 'ozet', 'ayrintili'] as RaporTuru[]) {
      const d = tahsilatDurumuKur(v, BUGUN, { tur, sorumlu: '', ay: null })
      const pdf = await pdfUret(tahsilatDurumuBelgesi(d, tur, '11.11.2026 12:00'))
      expect(pdf.subarray(0, 5).toString('latin1'), tur).toBe('%PDF-')
      expect(pdf.length, tur).toBeGreaterThan(10_000)
    }
    // yönetim verisiyle uyarılar dolar (sentetik veride sınıflandırılmamış irsaliyeler var)
    const d = tahsilatDurumuKur(v, BUGUN, { tur: 'ozet', sorumlu: '', ay: null })
    expect(d.uyarilar.length).toBeGreaterThan(0)
  })
})
