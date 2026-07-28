import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Pool, types } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// 0004_hiz.sql doğrulaması (yerel Postgres):
//   PG_TEST_SOCKET=/tmp/pgs npx vitest run src/lib/__tests__/hizRpc.int.test.ts
// Kritik nokta: tek tura indirme KAPSAMI DEĞİŞTİRMEMELİ — pazarlamacı hâlâ
// yalnız kendi firmalarını görmeli (RLS).

const SOCKET = process.env.PG_TEST_SOCKET
const PORT = parseInt(process.env.PG_TEST_PORT ?? '55432', 10)

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

const YONETICI = '00000000-0000-0000-0000-0000000000a1'
const PAZ = '00000000-0000-0000-0000-0000000000a2'
const PASIF = '00000000-0000-0000-0000-0000000000a3'

types.setTypeParser(20, (v) => parseInt(v, 10))
types.setTypeParser(1082, (v) => v)

describe.skipIf(!SOCKET)('0004_hiz: tek turda profil + matris verisi', () => {
  let pool: Pool

  beforeAll(async () => {
    const p = new Pool({ host: SOCKET, port: PORT, user: 'postgres', database: 'postgres', max: 2 })
    await p.query('drop database if exists tahsilat_hiz')
    await p.query('create database tahsilat_hiz')
    await p.end()
    pool = new Pool({ host: SOCKET, port: PORT, user: 'postgres', database: 'tahsilat_hiz', max: 4 })
    await pool.query(AUTH_STUB)
    for (const f of ['0001_init.sql', '0002_havuz_tahsis.sql', '0003_kdv_eslestirme.sql', '0004_hiz.sql']) {
      await pool.query(readFileSync(path.join(process.cwd(), 'supabase/migrations', f), 'utf8'))
    }
    // Supabase'in varsayılan hibeleri (yerel Postgres'te elle verilir)
    await pool.query(`
      grant usage on schema public to authenticated, anon;
      grant select on all tables in schema public to authenticated;
    `)

    // kullanıcılar + profiller
    await pool.query(
      `insert into auth.users (id, email) values ($1,'y@t.local'), ($2,'paz@t.local'), ($3,'pasif@t.local')`,
      [YONETICI, PAZ, PASIF],
    )
    await pool.query(
      `insert into public.profiles (id, email, full_name, role, is_active) values
        ($1,'y@t.local','Yönetici','yonetici',true),
        ($2,'paz@t.local','Pazarlamacı','pazarlamaci',true),
        ($3,'pasif@t.local','Pasif','yonetici',false)`,
      [YONETICI, PAZ, PASIF],
    )

    // iki firma: biri pazarlamacıya ait, biri değil
    await pool.query(
      `insert into public.firms (id, code_norm, code_raw, name, pazarlamaci_email) values
        ('00000000-0000-0000-0000-0000000000f1','34 A01','34 A01','BENİM FİRMA','paz@t.local'),
        ('00000000-0000-0000-0000-0000000000f2','34 B02','34 B02','DİĞER FİRMA','baska@t.local')`,
    )

    // her firmaya 1 fatura + 1 vadeli taksit
    for (const [fno, fid, tutar] of [
      ['F-1', '00000000-0000-0000-0000-0000000000f1', 10000],
      ['F-2', '00000000-0000-0000-0000-0000000000f2', 20000],
    ] as const) {
      const { rows } = await pool.query(
        `insert into public.invoices (fis_no, firm_id, invoice_date, sale_type_auto, plan_parse_status, amount_eur_cents)
         values ($1,$2,'2026-01-10','KONSINYE','ok',$3) returning id`,
        [fno, fid, tutar],
      )
      await pool.query(
        `insert into public.installments (invoice_id, firm_id, side, seq, due_date, amount_eur_cents, source, remaining_eur_cents)
         values ($1,$2,'VADELI',1,'2026-03-05',$3,'auto_plan',$3)`,
        [rows[0].id, fid, tutar],
      )
    }

    // geçerli koşu işareti
    await pool.query(
      `insert into public.app_settings (key, value) values ('current_recon_run', jsonb_build_object('run_id','00000000-0000-0000-0000-00000000c001'::text))
       on conflict (key) do update set value = excluded.value`,
    )
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
  })

  async function farkli(sub: string | null, sql: string, params: unknown[] = []) {
    const c = await pool.connect()
    try {
      await c.query("set role authenticated")
      await c.query(`select set_config('request.jwt.claims', $1, false)`, [
        sub ? JSON.stringify({ sub, role: 'authenticated' }) : '{}',
      ])
      const r = await c.query(sql, params)
      return r.rows[0]
    } finally {
      await c.query('reset role').catch(() => {})
      c.release()
    }
  }

  it('rpc_oturum_profilim: kendi profilini döndürür', async () => {
    const r = await farkli(YONETICI, 'select public.rpc_oturum_profilim() as p')
    expect(r.p).not.toBeNull()
    expect(r.p.role).toBe('yonetici')
    expect(r.p.email).toBe('y@t.local')
    expect(r.p.userId).toBe(YONETICI)
  })

  it('rpc_oturum_profilim: pasif kullanıcı ve oturumsuz için null', async () => {
    expect((await farkli(PASIF, 'select public.rpc_oturum_profilim() as p')).p).toBeNull()
    expect((await farkli(null, 'select public.rpc_oturum_profilim() as p')).p).toBeNull()
  })

  it('rpc_matris_verisi: yönetici TÜM taksitleri tek çağrıda alır', async () => {
    const r = await farkli(YONETICI, `select public.rpc_matris_verisi('VADELI') as v`)
    expect(r.v.run_id).toBeTruthy()
    expect(r.v.rows).toHaveLength(2)
    expect(r.v.rows[0].due_date).toBe('2026-03-05')
    expect(r.v.rows.map((x: { amount_eur_cents: number }) => x.amount_eur_cents).sort()).toEqual([10000, 20000])
    // sorumlu eşlemesi aynı yanıtta
    expect(r.v.sorumlu['00000000-0000-0000-0000-0000000000f1']).toBe('PAZ')
  })

  it('RLS korunur: pazarlamacı YALNIZ kendi firmasının taksitini görür', async () => {
    const r = await farkli(PAZ, `select public.rpc_matris_verisi('VADELI') as v`)
    expect(r.v.rows).toHaveLength(1)
    expect(r.v.rows[0].firm_code).toBe('34 A01')
    expect(r.v.rows[0].amount_eur_cents).toBe(10000)
  })

  it('taraf süzgeci ve geçersiz taraf denetimi', async () => {
    const pesin = await farkli(YONETICI, `select public.rpc_matris_verisi('PESIN') as v`)
    expect(pesin.v.rows).toHaveLength(0)
    await expect(farkli(YONETICI, `select public.rpc_matris_verisi('SACMA') as v`)).rejects.toThrow(/Geçersiz taraf/)
  })
})
