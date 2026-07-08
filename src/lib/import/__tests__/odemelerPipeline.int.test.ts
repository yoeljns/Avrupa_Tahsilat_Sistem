import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Pool, types } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chunkedWrite } from '@/lib/db'
import { commitIrsaliyeBatch } from '../commitIrsaliye'
import { commitOdemelerBatch } from '../commitOdemeler'
import { diffIrsaliye } from '../diff'
import { parseIrsaliyeXls } from '../irsaliyeParser'
import { parseOdemelerXlsx } from '../odemelerParser'
import { createPgShim } from './pgShim'

// UÇTAN UCA: irsaliyeler + gerçek ödemeler dosyası → FIFO mutabakat doğrulaması.
//   PG_TEST_SOCKET=/tmp/pgs IRSALIYE_FILE=... ODEMELER_FILE=... npx vitest run

const SOCKET = process.env.PG_TEST_SOCKET
const IRS = process.env.IRSALIYE_FILE
const ODM = process.env.ODEMELER_FILE

const AUTH_STUB = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text unique);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as
$$ select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','anon') $$;
do $do$ begin
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
end $do$;
`

types.setTypeParser(20, (v) => parseInt(v, 10))
types.setTypeParser(1700, (v) => parseFloat(v))
types.setTypeParser(1082, (v) => v)
types.setTypeParser(1184, (v) => new Date(v).toISOString())

describe.skipIf(!SOCKET || !IRS || !ODM)('ödeme içe aktarma + FIFO mutabakat (yerel Postgres)', () => {
  let pool: Pool
  const admin = () => createPgShim(pool)

  beforeAll(async () => {
    pool = new Pool({ host: SOCKET, port: parseInt(process.env.PG_TEST_PORT ?? '55432', 10), user: 'postgres', database: 'postgres', max: 4 })
    await pool.query('drop database if exists tahsilat_pay')
    await pool.query('create database tahsilat_pay')
    await pool.end()
    pool = new Pool({ host: SOCKET, port: parseInt(process.env.PG_TEST_PORT ?? '55432', 10), user: 'postgres', database: 'tahsilat_pay', max: 4 })
    await pool.query(AUTH_STUB)
    await pool.query(readFileSync(path.join(process.cwd(), 'supabase/migrations/0001_init.sql'), 'utf8'))
    await pool.query(readFileSync(path.join(process.cwd(), 'supabase/migrations/0002_havuz_tahsis.sql'), 'utf8'))
    await pool.query(readFileSync(path.join(process.cwd(), 'supabase/migrations/0003_kdv_eslestirme.sql'), 'utf8'))

    // Önce irsaliyeler
    const parsedIrs = parseIrsaliyeXls(readFileSync(IRS!))
    const a = admin()
    const { rows } = await diffIrsaliye(a, parsedIrs.records)
    const { data: batch } = await a
      .from('import_batches')
      .insert({ kind: 'irsaliye', filename: 'irs.xls', uploaded_by: 't@t', status: 'preview' })
      .select('id')
      .single()
    const batchId = (batch as { id: string }).id
    await chunkedWrite(rows, (chunk) =>
      a.from('import_rows').insert(
        chunk.map((r) => ({
          batch_id: batchId,
          row_index: r.rowIndex,
          natural_key: r.naturalKey,
          payload: r.payload,
          diff_status: r.status,
          changed_fields: r.changedFields,
        })),
      ),
    )
    await commitIrsaliyeBatch(a, batchId, 't@t')
  }, 120000)

  afterAll(async () => {
    await pool?.end()
  })

  async function stageOdemeler(): Promise<string> {
    const parsed = parseOdemelerXlsx(readFileSync(ODM!))
    expect(parsed.records.length).toBeGreaterThan(1500)
    const a = admin()
    const { data: batch } = await a
      .from('import_batches')
      .insert({ kind: 'odemeler', filename: 'pay.xlsx', uploaded_by: 't@t', status: 'preview' })
      .select('id')
      .single()
    const batchId = (batch as { id: string }).id
    await chunkedWrite(parsed.records, (chunk) =>
      a.from('import_rows').insert(
        chunk.map((r) => ({
          batch_id: batchId,
          row_index: r.rowIndex,
          natural_key: r.islemKodu,
          payload: r,
          diff_status: 'new',
          changed_fields: [],
        })),
      ),
    )
    return batchId
  }

  it('gerçek ödemeler dosyası: 1601 kayıt, tek havuz FIFO (önce peşin, sonra en yakın vade)', async () => {
    const batchId = await stageOdemeler()
    const stats = await commitOdemelerBatch(admin(), batchId, 't@t')

    expect(stats.inserted).toBe(1601) // 1252 PEŞİN + 349 VADELİ
    expect(stats.recompute.allocationCount).toBeGreaterThan(0)

    // ALC kayıtları tahsise girmedi
    const { rows: alc } = await pool.query(`
      select count(*)::int as n
      from allocations a join payments p on p.id = a.payment_id
      where p.is_alc`)
    expect(alc[0].n).toBe(0)

    // TAMAMLANMAMIŞ kayıtlar tahsise girmedi
    const { rows: inc } = await pool.query(`
      select count(*)::int as n
      from allocations a join payments p on p.id = a.payment_id
      where not p.is_complete`)
    expect(inc[0].n).toBe(0)

    // KDV 1/5 ödemeleri (36 adet): 32'si referansındaki irsaliyeyle eşleşip
    // TAM TUTARIYLA tahsis edilir; 4'ü (referanssız/geçersiz) tahsise girmez.
    const { rows: kdvCount } = await pool.query(`select count(*)::int as n from payments where is_kdv`)
    expect(kdvCount[0].n).toBe(36)
    const { rows: kdvMatched } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run')
      select count(*)::int as n from (
        select p.id
        from payments p
        join allocations a on a.payment_id = p.id and a.run_id = (select run_id from cur)
        where p.is_kdv
        group by p.id, p.doviz_eur_cents
        having sum(a.amount_eur_cents) = p.doviz_eur_cents
      ) x`)
    expect(kdvMatched[0].n).toBe(32)
    const { rows: kdvNoAlloc } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run')
      select count(*)::int as n
      from payments p
      where p.is_kdv and not exists (
        select 1 from allocations a where a.payment_id = p.id and a.run_id = (select run_id from cur)
      )`)
    expect(kdvNoAlloc[0].n).toBe(4)

    // HTK örneği: ISL-20260116-6E27 (971,96 €, ref '0042') → yalnız son-4'ü 0042 olan irsaliye
    const { rows: htk } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run')
      select distinct i.fis_no, sum(a.amount_eur_cents)::bigint as s
      from allocations a
      join payments p on p.id = a.payment_id
      join invoices i on i.id = a.invoice_id
      where a.run_id = (select run_id from cur) and p.islem_kodu = 'ISL-20260116-6E27'
      group by i.fis_no`)
    expect(htk).toHaveLength(1)
    expect(htk[0].fis_no.endsWith('0042')).toBe(true)
    expect(Number(htk[0].s)).toBe(97196)

    // KARSEL çok referanslı KDV: 4 irsaliyeye bölünür, toplam 9.791,87 €
    const { rows: karsel } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run')
      select count(distinct a.invoice_id)::int as inv_n, sum(a.amount_eur_cents)::bigint as s
      from allocations a
      join payments p on p.id = a.payment_id
      where a.run_id = (select run_id from cur) and p.islem_kodu = 'ISL-20260129-E1D6'`)
    expect(karsel[0].inv_n).toBe(4)
    expect(Number(karsel[0].s)).toBe(979187)

    // Peşin önceliği (KDV hedefli tahsisler hariç): bir firmada KDV-olmayan
    // ödemeden VADELİ taksite tahsis varsa, o firmanın TÜM peşin taksitleri kapalı olmalı
    const { rows: priorityBreak } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run'),
      vadeli_firms as (
        select distinct a.firm_id
        from allocations a
        join payments p on p.id = a.payment_id
        where a.run_id = (select run_id from cur) and a.side = 'VADELI' and not p.is_kdv
      )
      select count(*)::int as n
      from installments t
      join vadeli_firms v on v.firm_id = t.firm_id
      where t.side = 'PESIN' and t.remaining_eur_cents is not null and t.remaining_eur_cents > 0`)
    expect(priorityBreak[0].n).toBe(0)

    // Muhasebe değişmezi (firma bazlı, tek havuz):
    //   peşin_açık + vadeli_açık = toplam borç - tahsis ; alacak = toplam ödeme - tahsis
    const { rows: broken } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run'),
      alloc as (
        select firm_id, coalesce(sum(amount_eur_cents),0) as allocated
        from allocations where run_id = (select run_id from cur)
        group by firm_id
      )
      select count(*)::int as n
      from firm_balances b
      left join alloc a on a.firm_id = b.firm_id
      where b.run_id = (select run_id from cur)
        and (b.pesin_open_eur_cents + b.vadeli_open_eur_cents <> b.total_debt_eur_cents - coalesce(a.allocated,0)
          or b.credit_eur_cents <> b.total_paid_eur_cents - coalesce(a.allocated,0))`)
    expect(broken[0].n).toBe(0)

    // KULLANICININ ŞİKAYET ETTİĞİ ÖRNEK — 01 A03 ATAMAN:
    // PEŞİN sayfasından gelen iki ödeme (9.600 € + 14.933,33 €) iki konsinye
    // irsaliyesini kuruşuna kapatmalı; açık borç ve alacak 0 olmalı.
    const { rows: ataman } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run')
      select b.pesin_open_eur_cents, b.vadeli_open_eur_cents, b.credit_eur_cents
      from firm_balances b
      join firms f on f.id = b.firm_id
      where b.run_id = (select run_id from cur) and f.code_norm = '01 A03'`)
    expect(ataman).toHaveLength(1)
    expect(ataman[0].pesin_open_eur_cents).toBe(0)
    expect(ataman[0].vadeli_open_eur_cents).toBe(0)
    expect(ataman[0].credit_eur_cents).toBe(0)

    const { rows: atamanAlloc } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run')
      select p.islem_kodu, i.fis_no, a.amount_eur_cents
      from allocations a
      join payments p on p.id = a.payment_id
      join invoices i on i.id = a.invoice_id
      join firms f on f.id = a.firm_id
      where a.run_id = (select run_id from cur) and f.code_norm = '01 A03'
      order by p.islem_kodu`)
    expect(atamanAlloc).toEqual([
      { islem_kodu: 'ISL-20260417-08EB', fis_no: 'AVI2026000000844', amount_eur_cents: 960000 },
      { islem_kodu: 'ISL-20260608-495D', fis_no: 'AVI2026000001380', amount_eur_cents: 1493333 },
    ])

    // Hariç firmaların ödemeleri tahsise girmedi (katlanmış eşleşme)
    const { rows: exclPay } = await pool.query(`
      select count(*)::int as n
      from allocations a
      join firms f on f.id = a.firm_id
      join excluded_firm_codes e on fold_tr(e.code_norm) = fold_tr(f.code_norm)`)
    expect(exclPay[0].n).toBe(0)

    // Gerçek örnek: 06 K07 KUZEY'in ilk peşin ödemesi (5416,82 €) ilk peşin
    // irsaliyesiyle (5416,82 €) kuruşu kuruşuna eşleşmeli
    const { rows: kuzey } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run')
      select a.amount_eur_cents, i.fis_no
      from allocations a
      join payments p on p.id = a.payment_id
      join invoices i on i.id = a.invoice_id
      where a.run_id = (select run_id from cur) and p.islem_kodu = 'ISL-20260105-EE53'`)
    expect(kuzey).toHaveLength(1)
    expect(kuzey[0].amount_eur_cents).toBe(541682)
    expect(kuzey[0].fis_no).toBe('AVI2026000000006')

    // Özet çıktı (elle kontrol için)
    const { rows: summary } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run')
      select
        sum(pesin_open_eur_cents)::bigint as pesin_acik,
        sum(vadeli_open_eur_cents)::bigint as vadeli_acik,
        sum(vadeli_overdue_eur_cents)::bigint as geciken,
        sum(credit_eur_cents)::bigint as alacak
      from firm_balances where run_id = (select run_id from cur)`)
    console.log('Mutabakat özeti (cent):', JSON.stringify(summary))
  }, 180000)

  it('aynı ödemeler yeniden yüklenince idempotent: değişen yok', async () => {
    const batchId = await stageOdemeler()
    const stats = await commitOdemelerBatch(admin(), batchId, 't@t')
    expect(stats.inserted).toBe(0)
    expect(stats.updated).toBe(0)
    expect(stats.unchanged).toBe(1601)

    // İki koşu birebir aynı tahsisi üretti mi? (determinizm)
    const { rows: runs } = await pool.query(`select id from recon_runs order by started_at desc limit 2`)
    const [r1, r2] = runs.map((r) => r.id)
    const { rows: diffRows } = await pool.query(
      `
      with a1 as (select payment_id, installment_id, amount_eur_cents from allocations where run_id = $1),
           a2 as (select payment_id, installment_id, amount_eur_cents from allocations where run_id = $2)
      select count(*)::int as n from ((table a1 except table a2) union all (table a2 except table a1)) x`,
      [r1, r2],
    )
    expect(diffRows[0].n).toBe(0)
  }, 180000)
})
