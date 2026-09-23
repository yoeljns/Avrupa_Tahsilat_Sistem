import { Pool, types } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gocler, gocSql } from '@/lib/__tests__/testVeritabani'
import type { SupabaseClient } from '@supabase/supabase-js'
import { classifySaleType } from '@/lib/engine/classify'
import { isDec31 } from '@/lib/engine/dates'
import { normalizeFirmCode } from '@/lib/engine/normalize'
import { parseOdemePlani } from '@/lib/engine/planParser'
import { commitIrsaliyeBatch } from '@/lib/import/commitIrsaliye'
import type { IrsaliyeRecord } from '@/lib/import/irsaliyeParser'
import { loadInvoiceForOps, regenerateInstallments } from '@/lib/invoiceOps'
import { createPgShim } from './pgShim'

// Yeniden içe aktarmada yönetici düzenlemeleri ve taksit tazeleme kuralları
// (sentetik kayıtlarla, gerçek commit koduyla, yerel Postgres'te):
//   PG_TEST_SOCKET=/tmp/pgs npx vitest run src/lib/import/__tests__/irsaliyeDuzeltmeler.int.test.ts

const SOCKET = process.env.PG_TEST_SOCKET
const PORT = parseInt(process.env.PG_TEST_PORT ?? '55432', 10)
const DB = 'tahsilat_duzeltme'

types.setTypeParser(20, (v) => parseInt(v, 10))
types.setTypeParser(1082, (v) => v)

/** Ayrıştırıcının ürettiği kaydın aynısını kurar (dosya yerine). */
function kayit(
  rowIndex: number,
  fisNo: string,
  firma: string,
  tarih: string,
  belgeNo: string,
  plan: string,
  tutarEur: number,
  turu = '(08) Toptan Satış İrsaliyesi',
): IrsaliyeRecord {
  const c = classifySaleType(belgeNo, turu)
  const p = parseOdemePlani(plan, tarih)
  const reasons: string[] = []
  if (c.needsReview) reasons.push(c.reason)
  if (p.status === 'unparsed') reasons.push(p.note ?? '')
  if (p.supheli) reasons.push(p.note ?? '')
  return {
    rowIndex,
    fisNo,
    firmCodeNorm: normalizeFirmCode(firma),
    firmCodeRaw: firma,
    firmName: 'FİRMA ' + firma,
    invoiceDateISO: tarih,
    belgeNoRaw: belgeNo,
    turuRaw: turu,
    odemePlaniRaw: plan,
    fFlagRaw: '',
    amountTl: tutarEur * 40,
    amountEurCents: Math.round(tutarEur * 100),
    dovizliRaw: String(tutarEur),
    saleTypeAuto: c.type,
    suggestedSaleType: c.suggested ?? null,
    planParseStatus: p.status,
    planParseNote: p.note ?? null,
    classifyReason: c.reason,
    dueDates: p.dueDates,
    is3112: isDec31(tarih),
    fisnoNonstandard: false,
    needsReview: reasons.length > 0,
    reviewReasons: reasons,
  }
}

describe.skipIf(!SOCKET)('irsaliye yeniden içe aktarma: düzenlemeler korunur, taksitler doğru tazelenir', () => {
  let pool: Pool
  let admin: SupabaseClient

  async function yukle(records: IrsaliyeRecord[]) {
    const { rows } = await pool.query(
      `insert into public.import_batches (kind, filename, uploaded_by, status) values ('irsaliye','test.xls','t@t','preview') returning id`,
    )
    const batchId = rows[0].id as string
    for (const r of records) {
      await pool.query(
        `insert into public.import_rows (batch_id, row_index, natural_key, payload, diff_status) values ($1,$2,$3,$4,'new')`,
        [batchId, r.rowIndex, r.fisNo, JSON.stringify(r)],
      )
    }
    return commitIrsaliyeBatch(admin, batchId, 'test@t.local')
  }

  async function taksitler(fisNo: string) {
    const { rows } = await pool.query(
      `select t.due_date, t.amount_eur_cents, t.side, t.source, t.no_date_flag, f.code_norm as firma
       from public.installments t join public.invoices i on i.id = t.invoice_id join public.firms f on f.id = t.firm_id
       where i.fis_no = $1 order by t.seq`,
      [fisNo],
    )
    return rows as Array<{ due_date: string; amount_eur_cents: number; side: string; source: string; no_date_flag: boolean; firma: string }>
  }

  async function irsaliye(fisNo: string) {
    const { rows } = await pool.query(`select * from public.v_invoices_effective where fis_no = $1`, [fisNo])
    return rows[0]
  }

  beforeAll(async () => {
    const p = new Pool({ host: SOCKET, port: PORT, user: 'postgres', database: 'postgres', max: 2 })
    await p.query(`drop database if exists ${DB}`)
    await p.query(`create database ${DB}`)
    await p.end()
    pool = new Pool({ host: SOCKET, port: PORT, user: 'postgres', database: DB, max: 4 })
    await pool.query(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key, email text unique);
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
      do $do$ begin
        if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      end $do$;`)
    // TÜM göçler: sonraki göçlerin (0006, 0007 …) bu davranışı bozmadığı da doğrulanır
    for (const f of gocler()) await pool.query(gocSql(f))
    admin = createPgShim(pool)

    // İLK YÜKLEME
    await yukle([
      kayit(1, 'AVI2026000000001', '34 A01', '2026-03-10', 'KONSİNYE', '05/4-5-6', 300),
      kayit(2, 'AVI2026000000002', '34 A01', '2026-03-12', '+123', 'NAKİT', 100),
      kayit(3, 'AVI2026000000003', '34 A02', '2026-10-20', 'KONSİNYE', '05/ 11-12-1-2', 400),
      kayit(4, 'AVI2026000000004', '34 A02', '2026-04-01', 'KONSİNYE', '', 50),
      kayit(5, 'AVI2026000000005', '34 A01', '2026-05-05', 'KONSİNYE', '05/6', 70, '(03) Toptan Satış İade İrsaliyesi'),
    ])
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
  })

  it('ilk yükleme: planlar çözülür, yıl geçişi doğru, iade borca girmez', async () => {
    expect((await taksitler('AVI2026000000001')).map((t) => t.due_date)).toEqual(['2026-04-05', '2026-05-05', '2026-06-05'])
    expect(await taksitler('AVI2026000000002')).toMatchObject([{ due_date: '2026-03-12', side: 'PESIN' }])
    expect((await taksitler('AVI2026000000003')).map((t) => t.due_date)).toEqual([
      '2026-11-05',
      '2026-12-05',
      '2027-01-05',
      '2027-02-05',
    ])
    expect(await taksitler('AVI2026000000004')).toMatchObject([{ due_date: '2026-04-01', no_date_flag: true }])
    const iade = await irsaliye('AVI2026000000005')
    expect(iade.is_iade).toBe(true)
    expect(iade.is_allocatable).toBe(false)
    expect(iade.needs_review).toBe(true)
  })

  it('yönetici düzenlemeleri + ikinci yükleme: hiçbiri ezilmez, taksitler doğru tazelenir', async () => {
    // Yönetici: F1'e elle taksit (tarihleri kendisi belirledi)
    const f1 = await irsaliye('AVI2026000000001')
    await admin.rpc('rpc_elle_taksit_yaz', {
      p_invoice_id: f1.id,
      p_firm_id: f1.firm_id,
      p_side: 'VADELI',
      p_taksitler: [
        { seq: 1, due_date: '2026-04-20', amount_eur_cents: 10000 },
        { seq: 2, due_date: '2026-05-20', amount_eur_cents: 20000 },
      ],
    })
    // Yönetici: F4'e plan girdi (05.06.2026)
    const f4 = await irsaliye('AVI2026000000004')
    await pool.query(`update public.invoices set plan_override_note = '05.06.2026', needs_review = false where id = $1`, [f4.id])
    const inv4 = (await loadInvoiceForOps(admin, f4.id))!
    await regenerateInstallments(admin, inv4, { force: true })
    expect((await taksitler('AVI2026000000004')).map((t) => t.due_date)).toEqual(['2026-06-05'])

    // İKİNCİ YÜKLEME: ERP'de değişiklikler
    await yukle([
      kayit(1, 'AVI2026000000001', '34 A01', '2026-03-10', 'KONSİNYE', '05/4-5-6', 600), // tutar 300 → 600
      kayit(2, 'AVI2026000000002', '34 A01', '2026-03-12', 'KONSİNYE', '05/4', 100), // tip PEŞİN → KONSİNYE
      kayit(3, 'AVI2026000000003', '34 A03', '2026-10-20', 'KONSİNYE', '05/ 11-12-1-2', 400), // firma değişti
      kayit(4, 'AVI2026000000004', '34 A02', '2026-04-02', 'KONSİNYE', '', 80), // tarih + tutar değişti
      kayit(6, 'AVI2026000000006', '34 A01', '2026-08-13', 'KONSİNYE', '05 / 5-6-7-8-9', 90), // şüpheli plan
    ])

    // F1: elle taksitlerin TARİHLERİ korunur, tutarlar yeni toplama oranlanır; çakışma işaretlenir
    expect(await taksitler('AVI2026000000001')).toMatchObject([
      { due_date: '2026-04-20', amount_eur_cents: 20000, source: 'manual' },
      { due_date: '2026-05-20', amount_eur_cents: 40000, source: 'manual' },
    ])
    expect((await irsaliye('AVI2026000000001')).raw_changed_after_override).toBe(true)

    // F2: tip değişti → taraf ve vade yeni plana göre
    expect(await taksitler('AVI2026000000002')).toMatchObject([{ due_date: '2026-04-05', side: 'VADELI' }])

    // F3: taksitler yeni firmaya taşındı
    const t3 = await taksitler('AVI2026000000003')
    expect(t3).toHaveLength(4)
    expect(t3.every((t) => t.firma === '34 A03')).toBe(true)

    // F4: yöneticinin planı (05.06.2026) KORUNUR, yeni tutar (80 €) o plana göre
    expect(await taksitler('AVI2026000000004')).toMatchObject([
      { due_date: '2026-06-05', amount_eur_cents: 8000, source: 'auto_plan' },
    ])
    expect((await irsaliye('AVI2026000000004')).plan_override_note).toBe('05.06.2026')

    // F6: irsaliyeden aylarca önceye düşen vade → incelemeye düştü
    const f6 = await irsaliye('AVI2026000000006')
    expect(f6.needs_review).toBe(true)
    expect(f6.plan_parse_note).toContain('30 günden fazla önce')

    // Tahsis tutarlı: kapsam içi her taksitin kalanı hesaplandı
    const { rows } = await pool.query(`
      select count(*)::int as n from public.installments t
      join public.v_invoices_effective v on v.id = t.invoice_id
      where v.is_allocatable and t.remaining_eur_cents is null`)
    expect(rows[0].n).toBe(0)
  })

  it('aynı dosya tekrar yüklenirse hiçbir şey değişmez (idempotent)', async () => {
    const once = await pool.query(`select invoice_id, seq, due_date, amount_eur_cents, source from public.installments order by 1, 2`)
    const stats = await yukle([
      kayit(1, 'AVI2026000000001', '34 A01', '2026-03-10', 'KONSİNYE', '05/4-5-6', 600),
      kayit(2, 'AVI2026000000002', '34 A01', '2026-03-12', 'KONSİNYE', '05/4', 100),
      kayit(3, 'AVI2026000000003', '34 A03', '2026-10-20', 'KONSİNYE', '05/ 11-12-1-2', 400),
      kayit(4, 'AVI2026000000004', '34 A02', '2026-04-02', 'KONSİNYE', '', 80),
      kayit(6, 'AVI2026000000006', '34 A01', '2026-08-13', 'KONSİNYE', '05 / 5-6-7-8-9', 90),
    ])
    expect(stats.updated).toBe(0)
    const sonra = await pool.query(`select invoice_id, seq, due_date, amount_eur_cents, source from public.installments order by 1, 2`)
    expect(sonra.rows).toEqual(once.rows)
  })
})
