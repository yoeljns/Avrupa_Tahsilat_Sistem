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

  it('gerçek ödemeler dosyası: 1601 kayıt, FIFO tahsis, taraf yalıtımı', async () => {
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

    // Taraf yalıtımı: PEŞİN sayfası ödemesi asla VADELI taksite gitmez (ve tersi)
    const { rows: cross } = await pool.query(`
      select count(*)::int as n
      from allocations a
      join payments p on p.id = a.payment_id
      join installments t on t.id = a.installment_id
      where p.sheet_side <> t.side`)
    expect(cross[0].n).toBe(0)

    // Muhasebe değişmezi: her firma+taraf için
    //   open_debt = toplam borç - tahsis ; credit = toplam ödeme - tahsis
    const { rows: broken } = await pool.query(`
      with cur as (select (value->>'run_id')::uuid as run_id from app_settings where key='current_recon_run'),
      alloc as (
        select firm_id, side, coalesce(sum(amount_eur_cents),0) as allocated
        from allocations where run_id = (select run_id from cur)
        group by firm_id, side
      )
      select count(*)::int as n
      from firm_side_balances b
      left join alloc a on a.firm_id = b.firm_id and a.side = b.side
      where b.run_id = (select run_id from cur)
        and (b.open_debt_eur_cents <> b.total_debt_eur_cents - coalesce(a.allocated,0)
          or b.credit_eur_cents <> b.total_paid_eur_cents - coalesce(a.allocated,0))`)
    expect(broken[0].n).toBe(0)

    // Hariç firmaların ödemeleri tahsise girmedi
    const { rows: exclPay } = await pool.query(`
      select count(*)::int as n
      from allocations a
      join firms f on f.id = a.firm_id
      join excluded_firm_codes e on e.code_norm = f.code_norm`)
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
      select side,
        sum(open_debt_eur_cents)::bigint as acik,
        sum(overdue_eur_cents)::bigint as geciken,
        sum(credit_eur_cents)::bigint as alacak
      from firm_side_balances where run_id = (select run_id from cur)
      group by side order by side`)
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
