import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { commitOdemelerBatch } from '@/lib/import/commitOdemeler'
import type { OdemeRecord } from '@/lib/import/odemelerParser'
import { createPgShim } from '@/lib/import/__tests__/pgShim'
import { recomputeFirms, runRecompute } from '@/lib/recompute'
import { KULLANICI, SENTETIK_VERI, SOCKET, firmUuid, gocSql, kullaniciOlarak, testVeritabaniKur } from './testVeritabani'

// 0008_duzeltmeler.sql + düzeltme paketi (yerel Postgres):
//   PG_TEST_SOCKET=/tmp/pgs npx vitest run src/lib/__tests__/duzeltmeler.int.test.ts
//
//  1) Göç iki kez çalışır; rpc_takvim tek imza; hesap türü 'cron' kabul edilir.
//  2) Pano "7 gün" / "30 gün" bugün dahil (takvimle aynı): T+6 / T+29 girer, T+7 / T+30 girmez.
//  3) Yaşlandırma: vadesi gelmemiş + 1–30 = eski 0–30; beş dilim toplamı = toplam kalan.
//  4) EUR'suz ödeme: İnceleme'de listelenir (öneri kuruyla), Genel Bakış sayar; elle EUR
//     girilince hesaba girer, parmak izi değişir, firma bazlı hesap = tam hesap.
//  5) Pazarlamacı ödemeye yazamaz; yeniden içe aktarma elle girilen EUR'yu korur.

const DB = 'tahsilat_duzeltmeler'
const F2 = firmUuid(2) // '34 T02'
const F3 = firmUuid(3)
const F60 = firmUuid(60) // '54 Ç03' — takip dışı

function odemeKaydi(islemKodu: string, firmaKodu: string, dovizEurCents: number | null, rowIndex = 2): OdemeRecord {
  return {
    rowIndex,
    sheet: 'PEŞİN',
    sheetSide: 'PESIN',
    islemKodu,
    islemTarihiISO: '2026-07-07T00:00:00.000Z',
    firmaRaw: 'FİRMA 2',
    firmCodeRaw: firmaKodu,
    firmCodeNorm: firmaKodu,
    gelenTl: 930000,
    dovizEurCents,
    kur: null,
    toplamTl: null,
    fark: null,
    odemeSekli: '',
    aciklama: '',
    alacakliDurumu: '',
    alacakliTl: null,
    alacakliEurCents: null,
    alacakliIslemi: '',
    kdv15Durumu: '',
    kdvFaturaReferansi: '',
    kdvFaturaToplamiEurCents: null,
    kdv15OnOdemeEurCents: null,
    kdvKalanBorcEurCents: null,
    kdvTaksitSayisi: '',
    kdvTaksitBasiEurCents: null,
    kayitDurumu: '',
    eksikAlanlar: '',
    isleyen: '',
    islemZamaniRaw: '',
    hedefFisNo: '',
    hedefAcikEurRaw: '',
    isAlc: false,
    isComplete: true,
    isKdv: false,
    hasKodu: true,
    hasDetails: true,
  }
}

describe.skipIf(!SOCKET)('0008: EUR\'suz ödeme, 7/30 gün, yaşlandırma, gece hesabı', () => {
  let pool: Pool
  let admin: SupabaseClient

  const tek = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T

  async function firmaDurumu(firmId: string) {
    const b = await tek(
      `select b.pesin_open_eur_cents, b.vadeli_open_eur_cents, b.vadeli_overdue_eur_cents, b.credit_eur_cents,
              b.total_debt_eur_cents, b.total_paid_eur_cents
       from public.firm_balances b join public.v_current_run r on r.run_id = b.run_id where b.firm_id = $1`,
      [firmId],
    )
    const t = await pool.query(`select id, remaining_eur_cents from public.installments where firm_id = $1 order by id`, [firmId])
    const a = await pool.query(
      `select a.payment_id, a.installment_id, a.amount_eur_cents from public.allocations a
       join public.v_current_run r on r.run_id = a.run_id where a.firm_id = $1 order by 1, 2`,
      [firmId],
    )
    return { bakiye: b, kalanlar: t.rows, tahsisler: a.rows }
  }

  async function yukle(records: OdemeRecord[]) {
    const { rows } = await pool.query(
      `insert into public.import_batches (kind, filename, uploaded_by, status) values ('odemeler','test.xlsx','t@t','preview') returning id`,
    )
    const batchId = rows[0].id as string
    for (const r of records) {
      await pool.query(
        `insert into public.import_rows (batch_id, row_index, natural_key, payload, diff_status) values ($1,$2,$3,$4,'updated')`,
        [batchId, r.rowIndex, r.islemKodu, JSON.stringify(r)],
      )
    }
    return commitOdemelerBatch(admin, batchId, 'test@t.local')
  }

  beforeAll(async () => {
    pool = await testVeritabaniKur(DB)
    await pool.query(SENTETIK_VERI)
    // Senaryo ödemeleri: EUR'suz (kursuz ve kurlu), çelişen, ve listelenmemesi gerekenler
    await pool.query(
      `insert into public.payments (islem_kodu, sheet_side, firm_id, islem_tarihi, gelen_tl, kur, doviz_eur_cents,
                                    doviz_eur_cents_override, is_alc, is_complete, is_kdv) values
        ('EUR-EKSIK-1',   'PESIN',  $1, '2026-07-07', 930000, null, null,   null,   false, true,  false),
        ('EUR-EKSIK-KUR', 'VADELI', $1, '2026-07-08', 100000, 50,   null,   null,   false, true,  false),
        ('EUR-CAKISMA',   'PESIN',  $1, '2026-07-09', 5000,   null, 100000, 120000, false, true,  false),
        ('KUR-A',         'PESIN',  $2, '2026-07-04', 5300,   53,   10000,  null,   false, true,  false),
        ('KUR-B',         'PESIN',  $2, '2026-07-10', 5400,   54,   10000,  null,   false, true,  false),
        ('ALC-EKSIK',     'PESIN',  $1, '2026-07-07', 1000,   null, null,   null,   true,  true,  false),
        ('YARIM-EKSIK',   'PESIN',  $1, '2026-07-07', 1000,   null, null,   null,   false, false, false),
        ('HARIC-EKSIK',   'PESIN',  $3, '2026-07-07', 1000,   null, null,   null,   false, true,  false)`,
      [F2, F3, F60],
    )
    admin = createPgShim(pool)
    await runRecompute(admin, 'setup', 'test@t.local')
  }, 180_000)

  afterAll(async () => {
    await pool?.end()
  })

  it('göç iki kez çalışır; rpc_takvim tek imza; hesap türü cron kabul, bilinmeyen reddedilir', async () => {
    await pool.query(gocSql('0008_duzeltmeler.sql'))
    expect((await tek<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'rpc_takvim'`)).n).toBe(1)
    await pool.query(`insert into public.recon_runs (triggered_by, trigger_kind, stats) values ('t', 'cron', '{}')`)
    await expect(pool.query(`insert into public.recon_runs (triggered_by, trigger_kind, stats) values ('t', 'xyz', '{}')`)).rejects.toThrow(
      /recon_runs_trigger_kind_check/,
    )
    await pool.query(`delete from public.recon_runs where trigger_kind = 'cron' and triggered_by = 't'`)
    // Elle EUR sıfır ya da negatif olamaz
    await expect(pool.query(`update public.payments set doviz_eur_cents_override = 0 where islem_kodu = 'EUR-EKSIK-1'`)).rejects.toThrow(
      /payments_doviz_eur_cents_override_check/,
    )
  })

  it('Pano 7 / 30 gün bugün dahil: T+6 ve T+29 girer, T+7 ve T+30 girmez', async () => {
    const dogrudan = async (bas: string, son: string) =>
      (
        await tek<{ s: number }>(
          `select coalesce(sum(remaining_eur_cents), 0)::bigint as s from public.installments
           where side = 'VADELI' and remaining_eur_cents > 0 and due_date between $1 and $2`,
          [bas, son],
        )
      ).s
    const pano = async (bugun: string) => (await tek<{ v: { gun7: number; gun30: number } }>(`select public.rpc_pano_ozeti($1) -> 'vade' as v`, [bugun])).v
    // Konsinye vadeleri ayın 5'inde: 29.06 için 05.07 = T+6 (girer); 28.06 için 05.07 = T+7 (girmez)
    expect(await dogrudan('2026-07-05', '2026-07-05')).toBeGreaterThan(0)
    expect((await pano('2026-06-29')).gun7).toBe(await dogrudan('2026-06-29', '2026-07-05'))
    expect((await pano('2026-06-28')).gun7).toBe(await dogrudan('2026-06-28', '2026-07-04'))
    expect((await pano('2026-06-28')).gun7).toBeLessThan(await dogrudan('2026-06-28', '2026-07-05'))
    // 06.06 için 05.07 = T+29 (girer); 05.06 için 05.07 = T+30 (girmez)
    expect((await pano('2026-06-06')).gun30).toBe(await dogrudan('2026-06-06', '2026-07-05'))
    expect((await pano('2026-06-05')).gun30).toBe(await dogrudan('2026-06-05', '2026-07-04'))
  })

  it('yaşlandırma: vadesi gelmemiş + 1–30 = eski 0–30; beş dilim = toplam kalan', async () => {
    for (const [taraf, bugun] of [
      ['PESIN', '2026-06-15'],
      ['PESIN', '2026-03-01'],
      ['VADELI', '2026-06-15'],
    ] as const) {
      const o = (
        await tek<{ o: Record<string, number> }>(`select public.rpc_takvim($1, '2026-06-01', '2026-06-30', $2) -> 'ozet' as o`, [taraf, bugun])
      ).o
      expect(o.yas_gelmemis + o.yas_1_30).toBe(o.yas_0_30)
      expect(o.yas_gelmemis + o.yas_1_30 + o.yas_31_60 + o.yas_61_90 + o.yas_90p).toBe(o.toplam_kalan)
      const gelmemis = (
        await tek<{ s: number }>(
          `select coalesce(sum(remaining_eur_cents), 0)::bigint as s from public.installments
           where side = $1 and remaining_eur_cents > 0 and due_date >= $2`,
          [taraf, bugun],
        )
      ).s
      expect(o.yas_gelmemis).toBe(gelmemis)
    }
  })

  it("İnceleme: EUR'suz ve çelişen ödemeler listelenir; ALC, tamamlanmamış ve takip dışı listelenmez", async () => {
    const [r] = await kullaniciOlarak<{ o: Array<Record<string, unknown>> }>(
      pool,
      KULLANICI.TAHSILAT,
      `select public.rpc_inceleme() -> 'odemeler' as o`,
    )
    const kodlar = r.o.map((x) => x.islem_kodu).sort()
    expect(kodlar).toEqual(['EUR-CAKISMA', 'EUR-EKSIK-1', 'EUR-EKSIK-KUR'])
    const bul = (k: string) => r.o.find((x) => x.islem_kodu === k)!
    // ±7 gündeki kurlu ödemelerin ortalaması: KUR-A 53 (04.07), KUR-B 54 (10.07), EUR-EKSIK-KUR 50 (08.07)
    expect(bul('EUR-EKSIK-1')).toMatchObject({ durum: 'eksik', firm_code: '34 T02', oneri_kur: 52.3333 })
    expect(bul('EUR-EKSIK-KUR')).toMatchObject({ durum: 'eksik', oneri_kur: 50 }) // kendi kuru
    expect(bul('EUR-CAKISMA')).toMatchObject({ durum: 'cakisma', doviz_eur_cents: 100000, doviz_eur_cents_override: 120000 })

    const [y] = await kullaniciOlarak<{ o: { adet: number; gelen_tl: number } }>(
      pool,
      KULLANICI.YONETICI,
      `select public.rpc_yonetim_ozeti('2026-06-15') -> 'odeme_eur_eksik' as o`,
    )
    expect(y.o.adet).toBe(2)
    expect(Number(y.o.gelen_tl)).toBe(1030000)
    const [p] = await kullaniciOlarak<{ o: unknown }>(pool, KULLANICI.PAZ, `select public.rpc_yonetim_ozeti('2026-06-15') as o`)
    expect(p.o).toBeNull()
  })

  it('elle EUR: parmak izi değişir, hesaba girer, firma bazlı hesap = tam hesap, kimlik tutar', async () => {
    const surum = async () => (await tek<{ s: string }>(`select public.tahsis_surumu(array[$1]::uuid[]) as s`, [F2])).s
    const once = await firmaDurumu(F2)
    const surumOnce = await surum()

    await pool.query(`update public.payments set doviz_eur_cents_override = 1738263 where islem_kodu = 'EUR-EKSIK-1'`)
    expect(await surum()).not.toBe(surumOnce)

    const r = await recomputeFirms(admin, [F2], 'test@t.local')
    expect(r.mode).toBe('firma')
    const firmaBazli = await firmaDurumu(F2)
    const once_ = once.bakiye as { total_paid_eur_cents: number }
    expect((firmaBazli.bakiye as { total_paid_eur_cents: number }).total_paid_eur_cents).toBe(once_.total_paid_eur_cents + 1738263)
    const odenen = await tek<{ n: number }>(
      `select count(*)::int as n from public.allocations a join public.v_current_run v on v.run_id = a.run_id
       join public.payments p on p.id = a.payment_id where p.islem_kodu = 'EUR-EKSIK-1'`,
    )
    expect(odenen.n).toBeGreaterThan(0)

    await runRecompute(admin, 'manual', 'test@t.local')
    expect(await firmaDurumu(F2)).toEqual(firmaBazli)

    const bozuk = await tek<{ n: number }>(
      `select count(*)::int as n from public.firm_balances b join public.v_current_run v on v.run_id = b.run_id
       where b.total_debt_eur_cents - b.total_paid_eur_cents <> b.pesin_open_eur_cents + b.vadeli_open_eur_cents - b.credit_eur_cents`,
    )
    expect(bozuk.n).toBe(0)

    const [y] = await kullaniciOlarak<{ o: { adet: number } }>(
      pool,
      KULLANICI.YONETICI,
      `select public.rpc_yonetim_ozeti('2026-06-15') -> 'odeme_eur_eksik' as o`,
    )
    expect(y.o.adet).toBe(1)
  })

  it('pazarlamacı ödemeye EUR yazamaz', async () => {
    await kullaniciOlarak(pool, KULLANICI.PAZ, `update public.payments set doviz_eur_cents_override = 999 where islem_kodu = 'EUR-EKSIK-KUR'`).catch(
      () => undefined,
    )
    const r = await tek<{ o: number | null }>(`select doviz_eur_cents_override as o from public.payments where islem_kodu = 'EUR-EKSIK-KUR'`)
    expect(r.o).toBeNull()
  })

  it('yeniden içe aktarma elle girilen EUR’yu korur; dosyada farklı EUR gelirse çelişki olarak listelenir', async () => {
    await yukle([odemeKaydi('EUR-EKSIK-1', '34 T02', null)])
    let p = await tek<{ d: number | null; o: number | null }>(
      `select doviz_eur_cents as d, doviz_eur_cents_override as o from public.payments where islem_kodu = 'EUR-EKSIK-1'`,
    )
    expect(p).toEqual({ d: null, o: 1738263 })

    await yukle([odemeKaydi('EUR-EKSIK-1', '34 T02', 1700000)])
    p = await tek(`select doviz_eur_cents as d, doviz_eur_cents_override as o from public.payments where islem_kodu = 'EUR-EKSIK-1'`)
    expect(p).toEqual({ d: 1700000, o: 1738263 })
    const [r] = await kullaniciOlarak<{ o: Array<Record<string, unknown>> }>(
      pool,
      KULLANICI.TAHSILAT,
      `select public.rpc_inceleme() -> 'odemeler' as o`,
    )
    expect(r.o.find((x) => x.islem_kodu === 'EUR-EKSIK-1')).toMatchObject({ durum: 'cakisma' })
    // Hesapta elle girilen tutar kullanılmaya devam eder
    const paid = await tek<{ s: number }>(
      `select coalesce(sum(a.amount_eur_cents), 0)::bigint as s from public.allocations a join public.v_current_run v on v.run_id = a.run_id
       join public.payments p on p.id = a.payment_id where p.islem_kodu = 'EUR-EKSIK-1'`,
    )
    expect(paid.s).toBeLessThanOrEqual(1738263)
  })
})
