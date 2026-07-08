import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Pool, types } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { foldFirmCodeForExclusion } from '@/lib/engine/normalize'
import { chunkedWrite, fetchAll } from '@/lib/db'
import { commitIrsaliyeBatch } from '../commitIrsaliye'
import { diffIrsaliye } from '../diff'
import { parseIrsaliyeXls, type IrsaliyeRecord } from '../irsaliyeParser'
import { createPgShim } from './pgShim'

// UÇTAN UCA ENTEGRASYON TESTİ — üretim commit/recompute kodunu yerel
// PostgreSQL üzerinde gerçek dosyayla koşturur. Koşullu: PG_TEST_SOCKET ve
// IRSALIYE_FILE ortam değişkenleri verilmelidir.
//   PG_TEST_SOCKET=/tmp/pgs PG_TEST_PORT=55432 IRSALIYE_FILE=... npx vitest run

const SOCKET = process.env.PG_TEST_SOCKET
const FILE = process.env.IRSALIYE_FILE

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

// PostgREST davranışına uyum: int8 → number, numeric → number, date → 'YYYY-MM-DD'
types.setTypeParser(20, (v) => parseInt(v, 10))
types.setTypeParser(1700, (v) => parseFloat(v))
types.setTypeParser(1082, (v) => v)

describe.skipIf(!SOCKET || !FILE)('irsaliye içe aktarma boru hattı (yerel Postgres)', () => {
  let pool: Pool
  const admin = () => createPgShim(pool)
  let parsed: ReturnType<typeof parseIrsaliyeXls>

  const EXCLUDED = new Set(
    `01 K01|10 K01|14 Y01|33 K02|33 Y01|34 K56|34 S01|34 T32|37 K01|37 K02|41 Y01|41 Y02|45 Y01|52 C02|54 C03|55 K05|81 D02|99 A16|99 A19|99 A20|99 C02|99 D01|99 D02|99 E01|99 G03|99 H01|99 I03|99 K06|99 K07|99 K08|99 N01|99 P02|99 P04|99 R01|99 R02|99 S01|99 T02|99 T03|99 T07|99 T11|99 V03|99 Y02`
      .split('|')
      .map(foldFirmCodeForExclusion),
  )

  async function stagePreview(records: IrsaliyeRecord[]): Promise<string> {
    const a = admin()
    const { rows } = await diffIrsaliye(a, records)
    const { data: batch, error } = await a
      .from('import_batches')
      .insert({ kind: 'irsaliye', filename: 'test.xls', uploaded_by: 'test@test', status: 'preview' })
      .select('id')
      .single()
    if (error || !batch) throw new Error(error?.message)
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
    return batchId
  }

  beforeAll(async () => {
    pool = new Pool({
      host: SOCKET,
      port: parseInt(process.env.PG_TEST_PORT ?? '55432', 10),
      user: 'postgres',
      database: 'postgres',
      max: 4,
    })
    await pool.query('drop database if exists tahsilat_it')
    await pool.query('create database tahsilat_it')
    await pool.end()
    pool = new Pool({
      host: SOCKET,
      port: parseInt(process.env.PG_TEST_PORT ?? '55432', 10),
      user: 'postgres',
      database: 'tahsilat_it',
      max: 4,
    })
    await pool.query(AUTH_STUB)
    await pool.query(readFileSync(path.join(process.cwd(), 'supabase/migrations/0001_init.sql'), 'utf8'))
    await pool.query(readFileSync(path.join(process.cwd(), 'supabase/migrations/0002_havuz_tahsis.sql'), 'utf8'))
    await pool.query(readFileSync(path.join(process.cwd(), 'supabase/migrations/0003_kdv_eslestirme.sql'), 'utf8'))
    parsed = parseIrsaliyeXls(readFileSync(FILE!))
  }, 60000)

  afterAll(async () => {
    await pool?.end()
  })

  it('ilk içe aktarma: 2064 irsaliye, taksitler, mutabakat', async () => {
    const batchId = await stagePreview(parsed.records)
    const stats = await commitIrsaliyeBatch(admin(), batchId, 'test@test')

    expect(stats.inserted).toBe(2064)
    expect(stats.updated).toBe(0)
    expect(stats.unchanged).toBe(0)

    const { rows: invCount } = await pool.query('select count(*)::int as n from invoices')
    expect(invCount[0].n).toBe(2064)

    // Beklenen taksit sayısı: OTHER olmayan ve EUR tutarı okunmuş kayıtların vade toplamı
    const expectedInstallments = parsed.records
      .filter((r) => r.saleTypeAuto !== 'OTHER' && r.amountEurCents !== null)
      .reduce((s, r) => s + r.dueDates.length, 0)
    const { rows: instCount } = await pool.query('select count(*)::int as n from installments')
    expect(instCount[0].n).toBe(expectedInstallments)
    expect(stats.installmentsRebuilt).toBe(expectedInstallments)

    // Taksit tutarları irsaliye tutarını kuruşuna tamamlar
    const { rows: sumCheck } = await pool.query(`
      select count(*)::int as n from (
        select t.invoice_id, sum(t.amount_eur_cents) as s, min(i.amount_eur_cents) as a
        from installments t join invoices i on i.id = t.invoice_id
        group by t.invoice_id having sum(t.amount_eur_cents) <> min(i.amount_eur_cents)
      ) x`)
    expect(sumCheck[0].n).toBe(0)

    // Mutabakat koşusu yazıldı, işaretçi çevrildi
    const { rows: runRows } = await pool.query('select count(*)::int as n from recon_runs')
    expect(runRows[0].n).toBe(1)
    const { rows: ptr } = await pool.query(`select value->>'run_id' as run_id from app_settings where key='current_recon_run'`)
    expect(ptr[0].run_id).toBeTruthy()

    // Ödeme yokken: açık borç = tahsis edilebilir borç toplamı.
    // Tahsis edilebilir = 31/12 değil + OTHER değil + hariç firma değil + EUR okunmuş.
    const expectedOpen = parsed.records
      .filter(
        (r) =>
          !r.is3112 &&
          r.saleTypeAuto !== 'OTHER' &&
          r.amountEurCents !== null &&
          !EXCLUDED.has(foldFirmCodeForExclusion(r.firmCodeNorm)),
      )
      .reduce((s, r) => s + (r.amountEurCents ?? 0), 0)
    const { rows: open } = await pool.query(
      'select coalesce(sum(pesin_open_eur_cents + vadeli_open_eur_cents),0)::bigint as s from firm_balances',
    )
    expect(Number(open[0].s)).toBe(expectedOpen)

    // 31/12 kuralı: hiçbir 31/12 irsaliyesinin taksiti mutabakata girmedi
    const { rows: dec31 } = await pool.query(`
      select count(*)::int as n from installments t
      join invoices i on i.id = t.invoice_id
      where i.is_31_12 and t.remaining_eur_cents is not null`)
    expect(dec31[0].n).toBe(0)

    // Hariç firma ('10 K01' Kastamonu): taksitleri kapsam dışı (remaining null)
    const { rows: excl } = await pool.query(`
      select count(*)::int as n from installments t
      join firms f on f.id = t.firm_id
      where f.code_norm = '10 K01' and t.remaining_eur_cents is not null`)
    expect(excl[0].n).toBe(0)

    // Firma kimliği Türkçe harfi KORUR: '54 Ç03' kendi koduyla saklanır
    const { rows: cagpas } = await pool.query(`select count(*)::int as n from firms where code_norm = '54 Ç03'`)
    expect(cagpas[0].n).toBe(1)

    // '54 Ç03' hariç listesindeki ASCII '54 C03' ile katlanarak eşleşir → kapsam dışı
    const { rows: cagpasScope } = await pool.query(`
      select count(*)::int as n from installments t
      join firms f on f.id = t.firm_id
      where f.code_norm = '54 Ç03' and t.remaining_eur_cents is not null`)
    expect(cagpasScope[0].n).toBe(0)

    // '34 O02' (ORMAK) ve '34 Ö02' (ÖZ KARADENİZ) AYRI firmalar olarak var
    const { rows: distinctFirms } = await pool.query(
      `select count(*)::int as n from firms where code_norm in ('34 O02', '34 Ö02')`,
    )
    expect(distinctFirms[0].n).toBe(2)
  }, 120000)

  it('aynı dosya yeniden yüklenince: hepsi değişmedi, taksitler yeniden üretilmedi', async () => {
    const { rows: diffRows } = await (async () => {
      const { rows } = await diffIrsaliye(admin(), parsed.records)
      return { rows }
    })()
    const statuses = new Set(diffRows.map((r) => r.status))
    expect(statuses).toEqual(new Set(['unchanged']))

    const batchId = await stagePreview(parsed.records)
    const stats = await commitIrsaliyeBatch(admin(), batchId, 'test@test')
    expect(stats.inserted).toBe(0)
    expect(stats.updated).toBe(0)
    expect(stats.unchanged).toBe(2064)
    expect(stats.installmentsRebuilt).toBe(0)
    expect(stats.firmsCreated).toBe(0)
  }, 120000)

  it('override yeniden içe aktarmada korunur; manuel taksitlere dokunulmaz', async () => {
    // Tahsilat Yöneticisi düzenlemesi simülasyonu
    await pool.query(`
      update invoices set amount_eur_cents_override = 7777777, sale_type_override = 'KONSINYE'
      where fis_no = 'AVI2026000000001'`)
    const { rows: inv } = await pool.query(`select id, firm_id from invoices where fis_no = 'AVI2026000000001'`)
    await pool.query(`delete from installments where invoice_id = $1`, [inv[0].id])
    await pool.query(
      `insert into installments (invoice_id, firm_id, side, seq, due_date, amount_eur_cents, source)
       values ($1, $2, 'VADELI', 1, '2026-05-01', 7777777, 'manual')`,
      [inv[0].id, inv[0].firm_id],
    )

    const batchId = await stagePreview(parsed.records)
    const stats = await commitIrsaliyeBatch(admin(), batchId, 'test@test')
    expect(stats.unchanged).toBe(2064)

    const { rows: after } = await pool.query(
      `select amount_eur_cents_override, sale_type_override, raw_changed_after_override from invoices where fis_no = 'AVI2026000000001'`,
    )
    expect(after[0].amount_eur_cents_override).toBe(7777777)
    expect(after[0].sale_type_override).toBe('KONSINYE')
    expect(after[0].raw_changed_after_override).toBe(false)

    const { rows: manualInst } = await pool.query(`select source, amount_eur_cents from installments where invoice_id = $1`, [
      inv[0].id,
    ])
    expect(manualInst).toHaveLength(1)
    expect(manualInst[0].source).toBe('manual')
    expect(manualInst[0].amount_eur_cents).toBe(7777777)

    // fetchAll sayfalaması 1000 üstünü de getiriyor (2064 irsaliye)
    const all = await fetchAll<{ id: string }>((from, to) =>
      admin().from('invoices').select('id').order('id').range(from, to),
    )
    expect(all).toHaveLength(2064)
  }, 120000)
})
