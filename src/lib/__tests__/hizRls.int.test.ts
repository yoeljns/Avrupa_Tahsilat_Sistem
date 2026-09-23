import { Pool, types } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gocler, gocSql } from './testVeritabani'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createPgShim } from '@/lib/import/__tests__/pgShim'
import { loadInvoiceForOps, regenerateInstallments } from '@/lib/invoiceOps'
import { recomputeFirms, runRecompute } from '@/lib/recompute'

// 0005_hiz_rls.sql doğrulaması (yerel Postgres, gerçekçi hacimde sentetik veri):
//   PG_TEST_SOCKET=/tmp/pgs npx vitest run src/lib/__tests__/hizRls.int.test.ts
//
//  1) RLS yeniden yazımı KAPSAMI DEĞİŞTİRMEZ: pazarlamacı yalnız kendi
//     firmalarını, pasif kullanıcı hiçbir şeyi, anonim hiçbir fonksiyonu görmez.
//  2) Sayfa RPC'leri eski görünüm tabanlı hesapla AYNI toplamları verir.
//  3) Firma bazlı yeniden hesap sonrası durum, sıfırdan tam hesapla BİREBİR aynı.
//  4) Eşzamanlılık korumaları (SURUM_DEGISTI / ESKI_KOSU / koşu çevirirken yakalama).
//  5) Elle taksit kaydı atomik: geçersiz tarih eski taksitleri silmez.

const SOCKET = process.env.PG_TEST_SOCKET
const PORT = parseInt(process.env.PG_TEST_PORT ?? '55432', 10)
const DB = 'tahsilat_0005'

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
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $do$;
`

const YONETICI = '00000000-0000-0000-0000-00000000aa01'
const TAHSILAT = '00000000-0000-0000-0000-00000000aa02'
const PAZ = '00000000-0000-0000-0000-00000000aa03'
const PASIF = '00000000-0000-0000-0000-00000000aa04'
const BUGUN = '2026-06-15'

const firmUuid = (k: number) => `00000000-0000-0000-0000-${k.toString(16).padStart(12, '0')}`

// Sentetik veri: 60 firma (1-10 pazarlamacının, 60 = takip dışı '54 Ç03'),
// 1500 irsaliye (tüm tipler, iptal, iade, 31/12), ~2700 taksit, 1200 ödeme
// (KDV referanslı, ALC, tamamlanmamış dahil).
const SEED = `
insert into public.firms (id, code_norm, code_raw, name, pazarlamaci_email)
select ('00000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid,
       case when g = 60 then '54 Ç03' else '34 T' || lpad(g::text, 2, '0') end,
       case when g = 60 then '54 Ç03' else '34 T' || lpad(g::text, 2, '0') end,
       'FİRMA ' || g,
       case when g <= 10 then 'paz@t.local' else 'diger@t.local' end
from generate_series(1, 60) g;

insert into public.invoices (fis_no, firm_id, invoice_date, turu_raw, belge_no_raw, odeme_plani_raw,
                             amount_eur_cents, sale_type_auto, plan_parse_status, is_31_12, cancelled_at)
select 'AVI2026' || lpad(g::text, 9, '0'),
       ('00000000-0000-0000-0000-' || lpad(to_hex((g % 60) + 1), 12, '0'))::uuid,
       case when g % 89 = 0 then date '2026-12-31' else date '2026-01-02' + (g % 300) end,
       case when g % 97 = 0 then '(03) Toptan Satış İade İrsaliyesi' else '(08) Toptan Satış İrsaliyesi' end,
       '', '',
       10000 + (abs(hashtext('a' || g)) % 3000000),
       (array['PESIN','KONSINYE','KONSINYE_PESIN','KONSINYE','OTHER'])[1 + (g % 5)],
       'ok',
       g % 89 = 0,
       case when g % 53 = 0 then now() end
from generate_series(1, 1500) g;

insert into public.installments (invoice_id, firm_id, side, seq, due_date, amount_eur_cents, source, no_date_flag)
select i.id, i.firm_id,
       case when i.sale_type_auto = 'PESIN' then 'PESIN' else 'VADELI' end,
       s,
       case when i.sale_type_auto = 'PESIN' then i.invoice_date
            else (date_trunc('month', i.invoice_date) + (s || ' month')::interval + interval '4 day')::date end,
       case when s < k.n then i.amount_eur_cents / k.n
            else i.amount_eur_cents - (i.amount_eur_cents / k.n) * (k.n - 1) end,
       'auto_plan', s = 1 and i.sale_type_auto <> 'PESIN' and (abs(hashtext(i.fis_no)) % 17 = 0)
from public.invoices i
cross join lateral (select case when i.sale_type_auto = 'PESIN' then 1 else 1 + (abs(hashtext(i.fis_no)) % 4) end as n) k
cross join lateral generate_series(1, k.n) s
where i.sale_type_auto <> 'OTHER';

insert into public.payments (islem_kodu, sheet_side, firm_id, islem_tarihi, doviz_eur_cents,
                             is_alc, is_complete, is_kdv, kdv_fatura_referansi)
select 'ISL-' || g,
       case when g % 2 = 0 then 'PESIN' else 'VADELI' end,
       ('00000000-0000-0000-0000-' || lpad(to_hex(((g * 7) % 60) + 1), 12, '0'))::uuid,
       timestamptz '2026-01-10 00:00:00+00' + ((g % 250) || ' day')::interval,
       5000 + (abs(hashtext('p' || g)) % 2000000),
       g % 71 = 0,
       g % 67 <> 0,
       g % 23 = 0,
       case when g % 23 = 0 then right(lpad((((g * 7) % 60) + 60)::text, 9, '0'), 4) end
from generate_series(1, 1200) g;
`

types.setTypeParser(20, (v) => parseInt(v, 10))
types.setTypeParser(1082, (v) => v)

describe.skipIf(!SOCKET)('0005: RLS + sayfa RPC + firma bazlı hesap', () => {
  let pool: Pool
  let admin: SupabaseClient

  async function asUser<T = Record<string, unknown>>(
    uid: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const c = await pool.connect()
    try {
      await c.query('begin')
      if (uid) {
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: uid, role: 'authenticated' }),
        ])
        await c.query('set local role authenticated')
      } else {
        await c.query('set local role anon')
      }
      const r = await c.query(sql, params)
      return r.rows as T[]
    } finally {
      await c.query('rollback').catch(() => undefined)
      c.release()
    }
  }

  /** Güncel koşunun tam durumu: tahsisler + bakiyeler + taksit kalanları (id'lerden bağımsız). */
  async function durum(runId: string) {
    const a = await pool.query(
      `select payment_id || '|' || installment_id || '|' || invoice_id || '|' || firm_id || '|' || side || '|' || amount_eur_cents as k
       from public.allocations where run_id = $1 order by 1`,
      [runId],
    )
    const b = await pool.query(
      `select firm_id || '|' || pesin_open_eur_cents || '|' || vadeli_open_eur_cents || '|' || vadeli_overdue_eur_cents
              || '|' || credit_eur_cents || '|' || coalesce(next_due_date::text, '-') || '|' || total_debt_eur_cents
              || '|' || total_paid_eur_cents as k
       from public.firm_balances where run_id = $1 order by 1`,
      [runId],
    )
    const t = await pool.query(
      `select id || '|' || coalesce(remaining_eur_cents::text, 'NULL') as k from public.installments order by 1`,
    )
    return { tahsis: a.rows.map((r) => r.k), bakiye: b.rows.map((r) => r.k), kalan: t.rows.map((r) => r.k) }
  }

  async function guncelKosu(): Promise<string> {
    const r = await pool.query(`select run_id from public.v_current_run`)
    return r.rows[0].run_id
  }

  beforeAll(async () => {
    const p = new Pool({ host: SOCKET, port: PORT, user: 'postgres', database: 'postgres', max: 2 })
    await p.query(`drop database if exists ${DB}`)
    await p.query(`create database ${DB}`)
    await p.end()
    pool = new Pool({ host: SOCKET, port: PORT, user: 'postgres', database: DB, max: 6 })
    await pool.query(AUTH_STUB)
    // TÜM göçler: sonraki göçlerin (0006, 0007 …) bu davranışı bozmadığı da doğrulanır
    for (const f of gocler()) await pool.query(gocSql(f))
    // Supabase'in varsayılan hibeleri (yerel Postgres'te elle verilir)
    await pool.query(`
      grant usage on schema public to authenticated, anon;
      grant select on all tables in schema public to authenticated;
    `)
    await pool.query(
      `insert into auth.users (id, email) values ($1,'y@t.local'), ($2,'t@t.local'), ($3,'paz@t.local'), ($4,'pasif@t.local')`,
      [YONETICI, TAHSILAT, PAZ, PASIF],
    )
    await pool.query(
      `insert into public.profiles (id, email, full_name, role, is_active) values
        ($1,'y@t.local','Yönetici','yonetici',true),
        ($2,'t@t.local','Tahsilat','tahsilat_yoneticisi',true),
        ($3,'paz@t.local','Pazarlamacı','pazarlamaci',true),
        ($4,'pasif@t.local','Pasif','yonetici',false)`,
      [YONETICI, TAHSILAT, PAZ, PASIF],
    )
    await pool.query(SEED)
    admin = createPgShim(pool)
    await runRecompute(admin, 'setup', 'test@t.local')
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
  })

  it('veri hacmi gerçekçi ve tam hesap tutarlı', async () => {
    const c = await pool.query(`
      select (select count(*) from public.invoices)::int as irs,
             (select count(*) from public.installments)::int as tak,
             (select count(*) from public.payments)::int as ode,
             (select count(*) from public.allocations a join public.v_current_run r on r.run_id = a.run_id)::int as tah`)
    expect(c.rows[0].irs).toBe(1500)
    expect(c.rows[0].tak).toBeGreaterThan(2000)
    expect(c.rows[0].ode).toBe(1200)
    expect(c.rows[0].tah).toBeGreaterThan(500)
  })

  it('iade irsaliyeleri borca yazılmaz; takip dışı firma kapsam dışı', async () => {
    const r = await pool.query(`
      select count(*) filter (where is_iade)::int as iade,
             count(*) filter (where is_iade and is_allocatable)::int as iade_borcta,
             count(*) filter (where firm_code = '54 Ç03' and is_allocatable)::int as haric_borcta
      from public.v_invoices_effective`)
    expect(r.rows[0].iade).toBeGreaterThan(5)
    expect(r.rows[0].iade_borcta).toBe(0)
    expect(r.rows[0].haric_borcta).toBe(0)
    const t = await pool.query(`
      select count(*)::int as n from public.installments t join public.v_invoices_effective v on v.id = t.invoice_id
      where v.is_iade and t.remaining_eur_cents is not null`)
    expect(t.rows[0].n).toBe(0)
  })

  // ---------------------------------------------------------------- RLS
  it('RLS: pazarlamacı yalnız kendi firmalarını görür (tablolar + tüm sayfa fonksiyonları)', async () => {
    const kendi = new Set(Array.from({ length: 10 }, (_, i) => firmUuid(i + 1)))

    const firms = await asUser<{ id: string }>(PAZ, `select id from public.firms`)
    expect(new Set(firms.map((f) => f.id))).toEqual(kendi)
    const inst = await asUser<{ firm_id: string }>(PAZ, `select distinct firm_id from public.installments`)
    expect(inst.every((r) => kendi.has(r.firm_id))).toBe(true)

    const [liste] = await asUser<{ r: Array<{ id: string }> }>(PAZ, `select public.rpc_firma_listesi($1) as r`, [BUGUN])
    expect(liste.r.length).toBe(10)
    expect(liste.r.every((f) => kendi.has(f.id))).toBe(true)

    const [baska] = await asUser<{ r: unknown }>(PAZ, `select public.rpc_firma_detay($1) as r`, [firmUuid(20)])
    expect(baska.r).toBeNull()
    const [benim] = await asUser<{ r: { irsaliyeler: unknown[] } }>(PAZ, `select public.rpc_firma_detay($1) as r`, [firmUuid(3)])
    expect(benim.r.irsaliyeler.length).toBeGreaterThan(0)

    const [matris] = await asUser<{ r: { firmalar: Array<{ firm_id: string }> } }>(
      PAZ,
      `select public.rpc_matris_ay('VADELI', '2026-06-01', '2026-06-30', $1) as r`,
      [BUGUN],
    )
    expect(matris.r.firmalar.length).toBeGreaterThan(0)
    expect(matris.r.firmalar.every((f) => kendi.has(f.firm_id))).toBe(true)

    // Koşu istatistikleri (şirket geneli toplamlar) pazarlamacıya kapalı
    expect(await asUser(PAZ, `select id from public.recon_runs`)).toHaveLength(0)
    const [pano] = await asUser<{ r: { kosu: unknown; bakiye: { vadeli_acik: number } } }>(
      PAZ,
      `select public.rpc_pano_ozeti($1) as r`,
      [BUGUN],
    )
    expect(pano.r.kosu).toBeNull()
    const beklenen = await pool.query(
      `select coalesce(sum(b.vadeli_open_eur_cents), 0)::bigint as s from public.firm_balances b
       join public.v_current_run r on r.run_id = b.run_id where b.firm_id = any($1)`,
      [Array.from(kendi)],
    )
    expect(pano.r.bakiye.vadeli_acik).toBe(beklenen.rows[0].s)
  })

  it('RLS: yönetim her şeyi görür; pasif kullanıcı hiçbir şey; anonim fonksiyon çağıramaz', async () => {
    const [staff] = await asUser<{ r: unknown[] }>(TAHSILAT, `select public.rpc_firma_listesi($1) as r`, [BUGUN])
    // takip dışı listede olan '54 Ç03' (Türkçe katlamayla '54 C03') ve '34 T32' görünmez
    expect(staff.r.length).toBe(58)
    expect((await asUser(YONETICI, `select id from public.recon_runs`)).length).toBeGreaterThan(0)

    const [pasif] = await asUser<{ r: unknown[] }>(PASIF, `select public.rpc_firma_listesi($1) as r`, [BUGUN])
    expect(pasif.r).toEqual([])
    expect(await asUser(PASIF, `select id from public.installments`)).toHaveLength(0)

    await expect(asUser(null, `select public.rpc_pano_ozeti('2026-06-15')`)).rejects.toThrow(/permission denied/)
    await expect(asUser(TAHSILAT, `select public.rpc_tahsis_girdisi(array[$1]::uuid[])`, [firmUuid(1)])).rejects.toThrow(
      /permission denied/,
    )
  })

  // ------------------------------------------------------ RPC doğruluğu
  it('matris RPC toplamları eski görünüm tabanlı hesapla aynı', async () => {
    for (const side of ['VADELI', 'PESIN'] as const) {
      const [m] = await asUser<{
        r: {
          ozet: { toplam_kalan: number; toplam_odenen: number; gecikmis: number }
          firmalar: Array<{ firm_id: string; toplam_kalan: number; once_kalan: number; gunler: Record<string, number[]> }>
        }
      }>(TAHSILAT, `select public.rpc_matris_ay($1, '2026-06-01', '2026-06-30', $2) as r`, [side, BUGUN])
      const eski = await asUser<{ firm_id: string; due_date: string; remaining_eur_cents: number; paid_eur_cents: number }>(
        TAHSILAT,
        `select firm_id, due_date, remaining_eur_cents, paid_eur_cents from public.v_installments_scope where side = $1`,
        [side],
      )
      const kalan = eski.reduce((s, r) => s + r.remaining_eur_cents, 0)
      const odenen = eski.reduce((s, r) => s + r.paid_eur_cents, 0)
      const gecikmis = eski.filter((r) => r.due_date < BUGUN).reduce((s, r) => s + r.remaining_eur_cents, 0)
      expect(m.r.ozet.toplam_kalan).toBe(kalan)
      expect(m.r.ozet.toplam_odenen).toBe(odenen)
      expect(m.r.ozet.gecikmis).toBe(gecikmis)
      // gün hücreleri: Haziran'daki kalanlar
      const hucreKalan = m.r.firmalar.reduce((s, f) => s + Object.values(f.gunler).reduce((a, g) => a + g[2], 0), 0)
      const haziran = eski
        .filter((r) => r.due_date >= '2026-06-01' && r.due_date <= '2026-06-30')
        .reduce((s, r) => s + r.remaining_eur_cents, 0)
      expect(hucreKalan).toBe(haziran)
    }
  })

  // ---------------------------------------------- firma bazlı hesap
  it('düzenleme sonrası FİRMA BAZLI hesap = sıfırdan TAM hesap (birebir)', async () => {
    // Firma 7'nin vadeli bir irsaliyesinin tutarını değiştir ve taksitlerini tazele
    const { rows } = await pool.query(
      `select id from public.v_invoices_effective where firm_id = $1 and side = 'VADELI' and is_allocatable order by fis_no limit 1`,
      [firmUuid(7)],
    )
    const inv = (await loadInvoiceForOps(admin, rows[0].id))!
    const yeni = (inv.amount_eur_cents ?? 0) + 123456
    await pool.query(`update public.invoices set amount_eur_cents_override = $2, updated_at = now() where id = $1`, [inv.id, yeni])
    inv.amount_eur_cents_override = yeni
    await regenerateInstallments(admin, inv)

    const r = await recomputeFirms(admin, [inv.firm_id], 'test@t.local')
    expect(r.mode).toBe('firma')
    const yamali = await durum(await guncelKosu())

    const tam = await runRecompute(admin, 'manual', 'test@t.local')
    const sifirdan = await durum(tam.runId)

    expect(yamali.tahsis).toEqual(sifirdan.tahsis)
    expect(yamali.bakiye).toEqual(sifirdan.bakiye)
    expect(yamali.kalan).toEqual(sifirdan.kalan)
  })

  it('çok firmalı düzenleme (toplu sınıflandırma gibi) de tam hesapla aynı', async () => {
    const { rows } = await pool.query(
      `select id, firm_id from public.invoices where sale_type_auto = 'OTHER' and cancelled_at is null
       and not is_31_12 and firm_id <> $1 order by fis_no limit 3`,
      [firmUuid(60)],
    )
    for (const row of rows) {
      await pool.query(`update public.invoices set sale_type_override = 'KONSINYE', updated_at = now() where id = $1`, [row.id])
      const inv = (await loadInvoiceForOps(admin, row.id))!
      await regenerateInstallments(admin, inv)
    }
    const r = await recomputeFirms(admin, rows.map((x) => x.firm_id), 'test@t.local')
    expect(r.mode).toBe('firma')
    const yamali = await durum(await guncelKosu())
    const tam = await runRecompute(admin, 'manual', 'test@t.local')
    const sifirdan = await durum(tam.runId)
    expect(yamali).toEqual(sifirdan)
  })

  it('eşzamanlılık: girdi okunduktan sonra veri değişirse yazma reddedilir (SURUM_DEGISTI)', async () => {
    const firma = firmUuid(8)
    const { data: g } = await admin.rpc('rpc_tahsis_girdisi', { p_firm_ids: [firma] })
    const girdi = g as { run_id: string; surum: string }
    await pool.query(
      `update public.installments set amount_eur_cents = amount_eur_cents + 1
       where id = (select id from public.installments where firm_id = $1 order by id limit 1)`,
      [firma],
    )
    const { data: sonuc } = await admin.rpc('rpc_tahsis_yaz', {
      p_run_id: girdi.run_id,
      p_firm_ids: [firma],
      p_surum: girdi.surum,
      p_tahsisler: [],
      p_bakiyeler: [],
      p_kalanlar: [],
    })
    expect(sonuc).toBe('SURUM_DEGISTI')
    // Güncel olmayan koşuya yazma da reddedilir
    const { data: eski } = await admin.rpc('rpc_tahsis_yaz', {
      p_run_id: '00000000-0000-0000-0000-000000000000',
      p_firm_ids: [firma],
      p_surum: girdi.surum,
      p_tahsisler: [],
      p_bakiyeler: [],
      p_kalanlar: [],
    })
    expect(eski).toBe('ESKI_KOSU')
    // recomputeFirms yeniden dener ve doğru sonuca ulaşır
    const r = await recomputeFirms(admin, [firma], 'test@t.local')
    expect(r.mode).toBe('firma')
    const yamali = await durum(await guncelKosu())
    const tam = await runRecompute(admin, 'manual', 'test@t.local')
    expect(yamali).toEqual(await durum(tam.runId))
  })

  it('tam hesap sürerken düzenlenen firma, koşu çevrilirken yakalanır', async () => {
    const { data: run } = await admin
      .from('recon_runs')
      .insert({ triggered_by: 'test', trigger_kind: 'manual', stats: {} })
      .select('id')
      .single()
    // koşu başladıktan SONRA bir firma düzenlenmiş gibi girdisi okunur (iz bırakır)
    await admin.rpc('rpc_tahsis_girdisi', { p_firm_ids: [firmUuid(9)] })
    const { data: yakalanan } = await admin.rpc('rpc_kosu_cevir', { p_run_id: (run as { id: string }).id })
    expect(yakalanan).toContain(firmUuid(9))
    expect(yakalanan).not.toContain(firmUuid(2))
    // boş koşu güncel olmasın: tam hesapla düzelt
    await runRecompute(admin, 'manual', 'test@t.local')
  })

  it('eski koşular budanır, güncel koşu asla silinmez', async () => {
    const guncel = await guncelKosu()
    const { data: silinen } = await admin.rpc('rpc_eski_kosulari_buda', { p_tut: 1 })
    expect(Number(silinen)).toBeGreaterThanOrEqual(0)
    const kalan = await pool.query(`select id from public.recon_runs`)
    expect(kalan.rows.map((r) => r.id)).toContain(guncel)
  })

  it('elle taksit kaydı atomik: geçersiz tarih eski taksitleri silmez', async () => {
    const { rows } = await pool.query(
      `select t.invoice_id, t.firm_id from public.installments t where t.side = 'VADELI' order by t.id limit 1`,
    )
    const once = await pool.query(`select id from public.installments where invoice_id = $1 order by id`, [rows[0].invoice_id])
    const { error } = await admin.rpc('rpc_elle_taksit_yaz', {
      p_invoice_id: rows[0].invoice_id,
      p_firm_id: rows[0].firm_id,
      p_side: 'VADELI',
      p_taksitler: [{ seq: 1, due_date: '2026-02-30', amount_eur_cents: 100 }],
    })
    expect(error).not.toBeNull()
    const sonra = await pool.query(`select id from public.installments where invoice_id = $1 order by id`, [rows[0].invoice_id])
    expect(sonra.rows).toEqual(once.rows)
  })

  it('HIZ: yeni RLS ile taksit sorgusu eski politikadan belirgin hızlı', async () => {
    const sorgu = `select installment_id, firm_code, due_date, remaining_eur_cents
                   from public.v_installments_scope where side = 'VADELI' order by due_date, firm_code, installment_id`
    async function sure(): Promise<number> {
      const c = await pool.connect()
      try {
        await c.query('begin')
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: TAHSILAT, role: 'authenticated' }),
        ])
        await c.query('set local role authenticated')
        await c.query(sorgu) // ısınma
        const t0 = performance.now()
        for (let i = 0; i < 3; i++) await c.query(sorgu)
        return (performance.now() - t0) / 3
      } finally {
        await c.query('rollback').catch(() => undefined)
        c.release()
      }
    }
    const yeni = await sure()
    // Eski (0001) politikaları geçici olarak geri koy, ölç, geri al
    const c = await pool.connect()
    let eski = 0
    try {
      await c.query('begin')
      for (const t of ['invoices', 'installments', 'firms']) {
        const pol = t === 'firms' ? 'firms_select' : `${t}_select`
        const kosul = t === 'firms' ? 'id' : 'firm_id'
        await c.query(`drop policy ${pol} on public.${t}`)
        await c.query(
          `create policy ${pol} on public.${t} for select using (public.is_staff() or ${kosul} in (select public.my_firm_ids()))`,
        )
      }
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: TAHSILAT, role: 'authenticated' })])
      await c.query('set local role authenticated')
      await c.query(sorgu)
      const t0 = performance.now()
      for (let i = 0; i < 3; i++) await c.query(sorgu)
      eski = (performance.now() - t0) / 3
    } finally {
      await c.query('rollback').catch(() => undefined)
      c.release()
    }
    console.log(`[HIZ] v_installments_scope (yerel, ~${'2.7k'} taksit): eski politika ${eski.toFixed(1)} ms → yeni ${yeni.toFixed(1)} ms`)
    expect(yeni).toBeLessThan(eski)
  })
})
