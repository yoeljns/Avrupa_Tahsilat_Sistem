import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bakiyeGorunumu, bakiyeModeliKur, BOS_BAKIYE_SUZGEC } from '@/lib/bakiye/model'
import { kitapYaz } from '@/lib/export/exceljsYaz'
import { vadeliBakiyelerPlanlari } from '@/lib/export/vadeliBakiyeler'
import type { BayiRecord } from '@/lib/import/bayilerParser'
import { bayiFirmaSatiri, sekleGoreGrupla } from '@/lib/import/bayiYaz'
import { createPgShim } from '@/lib/import/__tests__/pgShim'
import { bakiyeVerisi, sorumluSecenekleri, veriTazeligi, type BakiyeVerisi } from '@/lib/queries'
import { runRecompute } from '@/lib/recompute'
import { KULLANICI, SENTETIK_VERI, SOCKET, firmUuid, gocSql, kullaniciOlarak, testVeritabaniKur } from './testVeritabani'

// 0009_bakiye_tablosu.sql (yerel Postgres):
//   PG_TEST_SOCKET=/tmp/pgs npx vitest run src/lib/__tests__/bakiye.int.test.ts
//
//  1) Göç iki kez çalışır; fonksiyonlar tek imza; anonim çağıramaz.
//  2) rpc_bakiye_verisi toplamları v_installments_scope ile birebir (hücre, döküm, taraf).
//  3) Model ve Excel: toplam = taksit toplamı; ayın 20'si ikinci PEŞİN sütunu; notlar.
//  4) RLS: pazarlamacı yalnız kendi firmalarını alır (hücre, döküm, alacak).
//  5) veri_tazeligi: 31/12 kaydı son irsaliye sayılmaz; ödeme günü Türkiye saatine göre.
//  6) Sorumlu atama: yalnız servis rolü; denetim kaydı; kapsam değişir; kaldırma.
//  7) Bayi listesi yeniden yüklenince boş sorumlu hücresi atamayı silmez.

const DB = 'tahsilat_bakiye'
const BUGUN = '2026-11-11'
const { YONETICI, TAHSILAT, PAZ } = KULLANICI

function bayi(kod: string, ad: string, email: string): BayiRecord {
  return {
    rowIndex: 2,
    codeNorm: kod,
    codeRaw: kod,
    name: ad,
    segment: '',
    borcDurumu: '',
    city: 'İSTANBUL',
    phone: '',
    pazarlamaciEmail: email,
    kolonlar: { segment: false, borcDurumu: false, city: true, phone: false, pazarlamaciEmail: true },
  }
}

describe.skipIf(!SOCKET)('0009: bakiye tablosu verisi, veri tazeliği, sorumlu atama', () => {
  let pool: Pool
  let admin: SupabaseClient

  const tek = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T
  const veriAl = async (uid: string, taraf: string | null, dokum: boolean) =>
    (await kullaniciOlarak<{ v: BakiyeVerisi }>(pool, uid, 'select public.rpc_bakiye_verisi($1, $2) as v', [taraf, dokum]))[0].v
  const kapsam = (kosul = 'true') =>
    tek<{ borc: number; kalan: number; adet: number; firma: number }>(
      `select coalesce(sum(s.amount_eur_cents), 0)::bigint as borc, coalesce(sum(s.remaining_eur_cents), 0)::bigint as kalan,
              count(*)::int as adet, count(distinct s.firm_id)::int as firma
       from public.v_installments_scope s join public.firms f on f.id = s.firm_id where ${kosul}`,
    )

  beforeAll(async () => {
    pool = await testVeritabaniKur(DB)
    await pool.query(SENTETIK_VERI)
    // Sentetik veride bütün vadeler ayın 5'indedir; tabloyu sınayan vadeler eklenir
    await pool.query(`
      -- Konsinye Peşin taksitlerinin yarısı ayın 20'sinde (ikinci PEŞİN sütunu)
      update public.installments t set due_date = (date_trunc('month', t.due_date) + interval '19 day')::date
        from public.invoices i
       where i.id = t.invoice_id and i.sale_type_auto = 'KONSINYE_PESIN' and (abs(hashtext(i.fis_no)) % 2 = 0);
      -- Konsinye'de birkaç taksit ayın 15'inde (hücre notu)
      update public.installments t set due_date = (date_trunc('month', t.due_date) + interval '14 day')::date
        from public.invoices i
       where i.id = t.invoice_id and i.sale_type_auto = 'KONSINYE' and (abs(hashtext(i.fis_no)) % 11 = 0);
    `)
    admin = createPgShim(pool)
    await runRecompute(admin, 'setup', 'test@t.local')
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
  })

  it('göç iki kez çalışır; dört fonksiyon tek imzayla durur', async () => {
    await pool.query(gocSql('0009_bakiye_tablosu.sql'))
    const { rows } = await pool.query(
      `select p.proname, count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('veri_tazeligi', 'rpc_bakiye_verisi', 'rpc_sorumlu_secenekleri', 'rpc_sorumlu_ata')
       group by 1 order by 1`,
    )
    expect(rows).toEqual([
      { proname: 'rpc_bakiye_verisi', n: 1 },
      { proname: 'rpc_sorumlu_ata', n: 1 },
      { proname: 'rpc_sorumlu_secenekleri', n: 1 },
      { proname: 'veri_tazeligi', n: 1 },
    ])
  })

  it('yetkiler: anonim hiçbirini çağıramaz; atama fonksiyonu oturumlu kullanıcıya da kapalı', async () => {
    for (const sql of [
      'select public.veri_tazeligi()',
      "select public.rpc_bakiye_verisi('VADELI', false)",
      'select public.rpc_sorumlu_secenekleri()',
      "select public.rpc_sorumlu_ata(array[]::uuid[], null, null, 'x')",
    ]) {
      await expect(kullaniciOlarak(pool, null, sql), sql).rejects.toThrow(/permission denied/)
    }
    for (const uid of [YONETICI, TAHSILAT, PAZ]) {
      await expect(
        kullaniciOlarak(pool, uid, 'select public.rpc_sorumlu_ata($1::uuid[], $2, $3, $4)', [[firmUuid(11)], 'paz@t.local', uid, 'x@t.local']),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it('toplamlar v_installments_scope ile birebir: hücreler, döküm, taraf süzgeci', async () => {
    for (const taraf of ['VADELI', 'PESIN', null] as const) {
      const v = await veriAl(YONETICI, taraf, true)
      const b = await kapsam(taraf ? `s.side = '${taraf}'` : 'true')
      const topla = (i: number) => v.hucreler.reduce((a, h) => a + (h[i] as number), 0)
      expect({ borc: topla(4), kalan: topla(5), adet: topla(6), firma: v.firmalar.length }, String(taraf)).toEqual(b)
      // döküm: her taksit bir satır; toplamı hücrelerle aynı
      expect(v.dokum).toHaveLength(b.adet)
      expect(v.dokum!.reduce((a, d) => a + d[4], 0)).toBe(b.borc)
      expect(v.dokum!.reduce((a, d) => a + d[5], 0)).toBe(b.kalan)
      if (taraf) expect(new Set(v.hucreler.map((h) => h[1]))).toEqual(new Set([taraf]))
      // firma sırası dizinin sırasıdır; her hücre geçerli bir firmayı gösterir
      expect(v.hucreler.every((h) => h[0] >= 0 && h[0] < v.firmalar.length)).toBe(true)
      expect(v.firmalar.map((f) => f.kod)).toEqual([...v.firmalar.map((f) => f.kod)].sort())
    }
    // döküm istenmeyince gelmez; geçersiz taraf reddedilir
    expect((await veriAl(YONETICI, 'VADELI', false)).dokum).toBeNull()
    await expect(veriAl(YONETICI, 'KONSINYE', false)).rejects.toThrow(/geçersiz taraf/)
  })

  it('alacaklar güncel koşunun firm_balances kayıtlarıdır; kategoriler ve tazelik birlikte gelir', async () => {
    const v = await veriAl(YONETICI, 'VADELI', false)
    const b = await tek<{ n: number; s: number }>(
      `select count(*)::int as n, coalesce(sum(b.credit_eur_cents), 0)::bigint as s from public.firm_balances b
       join public.v_current_run r on r.run_id = b.run_id where b.credit_eur_cents > 0`,
    )
    expect(v.alacaklar).toHaveLength(b.n)
    expect(v.alacaklar.reduce((a, x) => a + x.alacak, 0)).toBe(b.s)
    expect(v.kategoriler.map((k) => k.kod)).toEqual(expect.arrayContaining(['PESIN', 'KONSINYE', 'KONSINYE_PESIN']))
    expect(v.run_id).toBeTruthy()
    expect(v.tazelik?.son_hesap).toBeTruthy()
  })

  it('model: toplam = taksit toplamı; ayın 20\'si ikinci PEŞİN sütununda; farklı vadeler not olur; süzgeç toplamı yeniden kurar', async () => {
    const veri = await bakiyeVerisi(admin, 'VADELI', true)
    const model = bakiyeModeliKur(veri, BUGUN)
    const b = await kapsam("s.side = 'VADELI'")
    expect(model.toplam).toMatchObject({ borc: b.borc, kalan: b.kalan, odeme: b.borc - b.kalan })
    expect(model.satirlar).toHaveLength(b.firma)
    // satır ve ay toplamları tutarlı
    expect(model.satirlar.reduce((a, s) => a + s.toplamKalan, 0)).toBe(b.kalan)
    expect(model.aylar.reduce((a, ay) => a + ay.toplam.kalan, 0)).toBe(b.kalan)
    // gecikmiş = vadesi bugünden önce olan kalan
    const g = await kapsam(`s.side = 'VADELI' and s.due_date < date '${BUGUN}'`)
    expect(model.toplam.gecikmis).toBe(g.kalan)
    // birikimli = bu ay sonuna kadar kalan
    const bk = await kapsam(`s.side = 'VADELI' and s.due_date < date '2026-12-01'`)
    expect(model.toplam.birikimli).toBe(bk.kalan)

    // Kasım: sütunlar VADELİ(5) · PEŞİN(5) · PEŞİN(20)
    const kasim = model.aylar.find((a) => a.ay === '2026-11')!
    expect(kasim.borcSutunlari.map((s) => [s.etiket, s.tarih])).toEqual([
      ['VADELİ', '2026-11-05'],
      ['PEŞİN', '2026-11-05'],
      ['PEŞİN', '2026-11-20'],
    ])
    const pesin20 = await kapsam(`s.side = 'VADELI' and s.kategori = 'KONSINYE_PESIN' and s.due_date = date '2026-11-20'`)
    expect(pesin20.borc).toBeGreaterThan(0)
    expect(kasim.toplam.borc[2]).toBe(pesin20.borc)
    // Konsinye'nin 15'indeki taksitleri VADELİ sütununda ve nottadır
    const notlu = model.satirlar.flatMap((s) => s.aylar.flatMap((h) => (h ? h.notlar.filter((n): n is string[] => n !== null) : [])))
    expect(notlu.length).toBeGreaterThan(0)
    expect(notlu.flat().some((n) => /^15\.\d\d: /.test(n))).toBe(true)
    // yıl geçişi: 2027 ayları adında yıl taşır
    expect(model.aylar.filter((a) => a.ay.startsWith('2027')).every((a) => / 2027$/.test(a.ad))).toBe(true)

    // süzgeç: yalnız PAZ → toplam yalnız onun firmaları
    const paz = bakiyeGorunumu(model, { ...BOS_BAKIYE_SUZGEC, sorumlu: 'PAZ' })
    const pb = await kapsam(`s.side = 'VADELI' and f.pazarlamaci_email = 'paz@t.local'`)
    expect(paz.toplam).toMatchObject({ borc: pb.borc, kalan: pb.kalan })
    expect(paz.satirlar).toHaveLength(pb.firma)
  })

  it('Excel dosyası gerçek veriyle üretilir (dört sayfa, PK imzası)', async () => {
    const veri = await bakiyeVerisi(admin, 'VADELI', true)
    const { planlar, model } = vadeliBakiyelerPlanlari(veri, BUGUN)
    expect(planlar.map((p) => p.ad)).toEqual(['Vadeli Bakiyeler', 'ALACAKLILAR', 'Taksit Dökümü', 'Bilgi'])
    expect(planlar[0].hucreler).toHaveLength(3 + model.satirlar.length + 2)
    expect(planlar[2].hucreler).toHaveLength(1 + veri.dokum!.length + 1)
    const baytlar = await kitapYaz(planlar)
    expect(baytlar.subarray(0, 2).toString()).toBe('PK')
    expect(baytlar.length).toBeGreaterThan(20_000)
  })

  it('RLS: pazarlamacı yalnız kendi firmalarının hücre, döküm ve alacaklarını alır', async () => {
    const v = await veriAl(PAZ, null, true)
    const b = await kapsam(`f.pazarlamaci_email = 'paz@t.local'`)
    expect(v.firmalar).toHaveLength(b.firma)
    expect(new Set(v.firmalar.map((f) => f.sorumlu))).toEqual(new Set(['PAZ']))
    expect(v.hucreler.reduce((a, h) => a + h[4], 0)).toBe(b.borc)
    expect(v.dokum).toHaveLength(b.adet)
    const kendi = new Set((await pool.query(`select id from public.firms where pazarlamaci_email = 'paz@t.local'`)).rows.map((r) => r.id as string))
    expect(v.alacaklar.every((a) => kendi.has(a.firm_id))).toBe(true)
    // yönetici ve tahsilat yöneticisi hepsini görür
    const hepsi = await kapsam()
    for (const uid of [YONETICI, TAHSILAT]) expect((await veriAl(uid, null, false)).firmalar).toHaveLength(hepsi.firma)
  })

  it('veri_tazeligi: 31/12 kaydı son irsaliye sayılmaz; son ödeme günü Türkiye saatine göre; pazarlamacı da okur', async () => {
    const t = await veriTazeligi(admin)
    const enSon = await tek<{ d: string; hepsi: string }>(
      `select max(invoice_date) filter (where not is_31_12)::text as d, max(invoice_date)::text as hepsi from public.invoices`,
    )
    expect(enSon.hepsi).toBe('2026-12-31') // sentetik veride 31/12 kayıtları var
    expect(t.son_irsaliye_tarihi).toBe(enSon.d)
    expect(t.son_irsaliye_tarihi! < '2026-12-31').toBe(true)
    expect(t.son_hesap).toBeTruthy()

    // 10.11 22:30 UTC = 11.11 01:30 İstanbul → son ödeme günü 11.11
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query(
        `insert into public.payments (islem_kodu, sheet_side, firm_id, islem_tarihi, doviz_eur_cents, is_alc, is_complete, is_kdv)
         values ('TZ-GECE', 'PESIN', $1, timestamptz '2026-11-10 22:30:00+00', 1000, false, true, false)`,
        [firmUuid(2)],
      )
      const { rows } = await c.query(`select public.veri_tazeligi()->>'son_odeme_tarihi' as d`)
      expect(rows[0].d).toBe('2026-11-11')
    } finally {
      await c.query('rollback')
      c.release()
    }
    // içe aktarma kayıtları yönetime özeldir; pazarlamacı yine de TARİHLERİ görür
    const [paz] = await kullaniciOlarak<{ v: Record<string, unknown> }>(pool, PAZ, 'select public.veri_tazeligi() as v')
    expect(Object.keys(paz.v).sort()).toEqual(['son_hesap', 'son_irsaliye_tarihi', 'son_irsaliye_yukleme', 'son_odeme_tarihi', 'son_odeme_yukleme'])
    expect(paz.v.son_irsaliye_tarihi).toBe(enSon.d)
  })

  it('sorumlu seçenekleri: yönetim kullanıcıları ve kullanımdaki e-postaları görür; pazarlamacıya null', async () => {
    for (const uid of [YONETICI, TAHSILAT]) {
      const [r] = await kullaniciOlarak<{ v: NonNullable<Awaited<ReturnType<typeof sorumluSecenekleri>>> }>(pool, uid, 'select public.rpc_sorumlu_secenekleri() as v')
      expect(r.v.kullanicilar.map((k) => k.email).sort()).toEqual(['pasif@t.local', 'paz@t.local', 't@t.local', 'y@t.local'])
      expect(r.v.kullanicilar.find((k) => k.email === 'pasif@t.local')!.aktif).toBe(false)
      expect(r.v.kullanilan).toEqual([
        { email: 'diger@t.local', firma: 50 },
        { email: 'paz@t.local', firma: 10 },
      ])
    }
    const [paz] = await kullaniciOlarak<{ v: unknown }>(pool, PAZ, 'select public.rpc_sorumlu_secenekleri() as v')
    expect(paz.v).toBeNull()
  })

  it('sorumlu atama: yalnız değişenler sayılır ve denetime yazılır; pazarlamacının kapsamı değişir; kaldırma', async () => {
    const F11 = firmUuid(11) // diger@t.local
    const F12 = firmUuid(12) // diger@t.local
    const F1 = firmUuid(1) // zaten paz@t.local
    const pazFirmalari = async () => (await veriAl(PAZ, null, false)).firmalar.map((f) => f.kod)
    const once = await pazFirmalari()
    expect(once).not.toContain('34 T11')

    // F1 zaten paz'da → 2 değişir (büyük harf ve boşluk temizlenir)
    const ata = await admin.rpc('rpc_sorumlu_ata', { p_firm_ids: [F11, F12, F1], p_email: '  PAZ@T.local ', p_actor_id: YONETICI, p_actor_email: 'y@t.local' })
    expect(ata.error).toBeNull()
    expect(ata.data).toBe(2)
    const firmalar = await pool.query(`select code_norm, pazarlamaci_email from public.firms where id = any($1::uuid[]) order by code_norm`, [[F11, F12, F1]])
    expect(firmalar.rows.map((r) => r.pazarlamaci_email)).toEqual(['paz@t.local', 'paz@t.local', 'paz@t.local'])
    const kayit = await pool.query(
      `select entity_type, entity_id, action, field, old_value, new_value, actor_email, actor_id from public.audit_log
       where action = 'SORUMLU_ATAMA' order by entity_id`,
    )
    expect(kayit.rows).toEqual([
      { entity_type: 'firma', entity_id: '34 T11', action: 'SORUMLU_ATAMA', field: 'sorumlu', old_value: 'diger@t.local', new_value: 'paz@t.local', actor_email: 'y@t.local', actor_id: YONETICI },
      { entity_type: 'firma', entity_id: '34 T12', action: 'SORUMLU_ATAMA', field: 'sorumlu', old_value: 'diger@t.local', new_value: 'paz@t.local', actor_email: 'y@t.local', actor_id: YONETICI },
    ])
    // pazarlamacı artık bu firmaları görür (yeniden hesap gerekmeden)
    const sonra = await pazFirmalari()
    expect(sonra).toEqual(expect.arrayContaining(['34 T11', '34 T12']))
    expect(sonra.length).toBeGreaterThan(once.length)

    // aynı atama yinelenince hiçbir şey değişmez, denetim kaydı da yazılmaz
    const yine = await admin.rpc('rpc_sorumlu_ata', { p_firm_ids: [F11, F12, F1], p_email: 'paz@t.local', p_actor_id: YONETICI, p_actor_email: 'y@t.local' })
    expect(yine.data).toBe(0)
    expect((await tek<{ n: number }>(`select count(*)::int as n from public.audit_log where action = 'SORUMLU_ATAMA'`)).n).toBe(2)

    // kaldırma: boş e-posta → null; pazarlamacı artık görmez
    const kaldir = await admin.rpc('rpc_sorumlu_ata', { p_firm_ids: [F11], p_email: '', p_actor_id: TAHSILAT, p_actor_email: 't@t.local' })
    expect(kaldir.data).toBe(1)
    expect((await tek<{ e: string | null }>(`select pazarlamaci_email as e from public.firms where id = $1`, [F11])).e).toBeNull()
    expect(await pazFirmalari()).not.toContain('34 T11')
    const son = await tek<{ old_value: unknown; new_value: unknown }>(
      `select old_value, new_value from public.audit_log where action = 'SORUMLU_ATAMA' and actor_email = 't@t.local'`,
    )
    expect(son).toEqual({ old_value: 'paz@t.local', new_value: null })

    // geçersiz e-posta reddedilir, hiçbir şey değişmez; boş liste 0 döner
    const hata = await admin.rpc('rpc_sorumlu_ata', { p_firm_ids: [F12], p_email: 'eposta-degil', p_actor_id: YONETICI, p_actor_email: 'y@t.local' })
    expect(hata.error?.message).toMatch(/Geçersiz e-posta/)
    expect((await tek<{ e: string }>(`select pazarlamaci_email as e from public.firms where id = $1`, [F12])).e).toBe('paz@t.local')
    const bos = await admin.rpc('rpc_sorumlu_ata', { p_firm_ids: [], p_email: 'paz@t.local', p_actor_id: YONETICI, p_actor_email: 'y@t.local' })
    expect(bos.data).toBe(0)
  })

  it('bayi listesi yeniden yüklenince boş sorumlu hücresi mevcut atamayı silmez; dolu hücre günceller', async () => {
    const simdi = new Date().toISOString()
    // 34 T20: dosyada sorumlu boş → korunur; 34 T21: dosyada yeni sorumlu → güncellenir
    const satirlar = [bayi('34 T20', 'FİRMA 20 YENİ AD', ''), bayi('34 T21', 'FİRMA 21', 'yeni@t.local')].map((r) => bayiFirmaSatiri(r, simdi))
    expect('pazarlamaci_email' in satirlar[0]).toBe(false)
    expect(satirlar[1].pazarlamaci_email).toBe('yeni@t.local')
    // kolon kümesi farklı iki satır ayrı gruplarda yazılır (PostgREST aynı kolon kümesini bekler)
    const gruplar = sekleGoreGrupla(satirlar)
    expect(gruplar).toHaveLength(2)
    for (const grup of gruplar) {
      const { error } = await admin.from('firms').upsert(grup, { onConflict: 'code_norm' })
      expect(error).toBeNull()
    }
    const { rows } = await pool.query(`select code_norm, name, city, pazarlamaci_email from public.firms where code_norm in ('34 T20', '34 T21') order by code_norm`)
    expect(rows).toEqual([
      { code_norm: '34 T20', name: 'FİRMA 20 YENİ AD', city: 'İSTANBUL', pazarlamaci_email: 'diger@t.local' },
      { code_norm: '34 T21', name: 'FİRMA 21', city: 'İSTANBUL', pazarlamaci_email: 'yeni@t.local' },
    ])
    // sorumlu kolonu hiç olmayan dosya da atamaya dokunmaz
    const kolonsuz = bayiFirmaSatiri({ ...bayi('34 T21', 'FİRMA 21', ''), kolonlar: { segment: false, borcDurumu: false, city: false, phone: false, pazarlamaciEmail: false } }, simdi)
    expect(Object.keys(kolonsuz).sort()).toEqual(['code_norm', 'code_raw', 'is_auto_created', 'name', 'updated_at'])
  })
})
