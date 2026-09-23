import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Pool, types } from 'pg'

// TEST ARACI: gerçek Postgres'te (yerel, PG_TEST_SOCKET) Supabase benzeri bir
// veritabanı kurar — auth taslağı + roller, TÜM göçler sırayla, Supabase'in
// varsayılan hibeleri, dört kullanıcı ve gerçekçi hacimde sentetik veri.
// Üretimde KULLANILMAZ.

export const SOCKET = process.env.PG_TEST_SOCKET
export const PORT = parseInt(process.env.PG_TEST_PORT ?? '55432', 10)

types.setTypeParser(20, (v) => parseInt(v, 10)) // bigint → number (kuruşlar güvenli aralıkta)
types.setTypeParser(1082, (v) => v) // date → 'YYYY-MM-DD'

export const AUTH_STUB = `
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

export const KULLANICI = {
  YONETICI: '00000000-0000-0000-0000-00000000aa01',
  TAHSILAT: '00000000-0000-0000-0000-00000000aa02',
  PAZ: '00000000-0000-0000-0000-00000000aa03',
  PASIF: '00000000-0000-0000-0000-00000000aa04',
} as const

export const firmUuid = (k: number) => `00000000-0000-0000-0000-${k.toString(16).padStart(12, '0')}`

/** supabase/migrations altındaki göçler, numara sırasıyla. `sonuncu` verilirse ona kadar (dahil). */
export function gocler(sonuncu?: string): string[] {
  const hepsi = readdirSync(path.join(process.cwd(), 'supabase/migrations'))
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
  return sonuncu ? hepsi.filter((f) => f <= sonuncu) : hepsi
}

export function gocSql(dosya: string): string {
  return readFileSync(path.join(process.cwd(), 'supabase/migrations', dosya), 'utf8')
}

/** Boş veritabanı + auth taslağı + göçler + hibeler + dört kullanıcı. */
export async function testVeritabaniKur(ad: string, opts: { gocler?: string[] } = {}): Promise<Pool> {
  const p = new Pool({ host: SOCKET, port: PORT, user: 'postgres', database: 'postgres', max: 2 })
  await p.query(`drop database if exists ${ad}`)
  await p.query(`create database ${ad}`)
  await p.end()
  const pool = new Pool({ host: SOCKET, port: PORT, user: 'postgres', database: ad, max: 6 })
  await pool.query(AUTH_STUB)
  for (const f of opts.gocler ?? gocler()) await pool.query(gocSql(f))
  // Supabase'in varsayılan hibeleri (yerel Postgres'te elle verilir)
  await pool.query(`
    grant usage on schema public to authenticated, anon, service_role;
    grant select on all tables in schema public to authenticated;
    grant all on all tables in schema public to service_role;
  `)
  const { YONETICI, TAHSILAT, PAZ, PASIF } = KULLANICI
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
  return pool
}

/**
 * Sentetik veri: 60 firma (1-10 pazarlamacının, 60 = takip dışı '54 Ç03'),
 * 1500 irsaliye (tüm tipler, iptal, iade, 31/12), ~2700 taksit, 1200 ödeme
 * (KDV referanslı, ALC, tamamlanmamış dahil).
 */
export const SENTETIK_VERI = `
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

/**
 * SQL'i verilen kullanıcı olarak çalıştırır (RLS geçerli). uid = null → anonim.
 * Her çağrı kendi işleminde yürür ve geri alınır.
 */
export async function kullaniciOlarak<T = Record<string, unknown>>(
  pool: Pool,
  uid: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    if (uid) {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
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
