import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { VARSAYILAN_KURALLAR, type Kural } from '@/lib/engine/kurallar'
import { commitIrsaliyeBatch } from '@/lib/import/commitIrsaliye'
import { createPgShim } from '@/lib/import/__tests__/pgShim'
import { KuralDegistiHatasi, kategorileriYukle, kuralImzasi, kurallariYukle } from '@/lib/kategoriler'
import { loadInvoiceForOps, otomatikTaksitSatirlari, regenerateInstallments } from '@/lib/invoiceOps'
import { VARSAYILAN_KATEGORILER, tarafHaritasi, type KategoriMeta } from '@/lib/kategoriMeta'
import { runRecompute } from '@/lib/recompute'
import { siniflandirmaIrsaliyeleriniYukle, siniflandirmaPlani, siniflandirmayiUygula, taksitsizlereTaksitKur } from '@/lib/siniflandirma'
import { KULLANICI, SENTETIK_VERI, SOCKET, gocSql, gocler, kullaniciOlarak, testVeritabaniKur } from './testVeritabani'

// 0007_kategoriler.sql + kategori/kural akışlarının doğrulaması (yerel Postgres):
//   PG_TEST_SOCKET=/tmp/pgs npx vitest run src/lib/__tests__/kategoriler.int.test.ts
//
//  1) Göç ÖNCESİ ve SONRASI: her irsaliyenin tarafı ve tahsise girip girmediği,
//     görünüm kolonları ve tam hesap sonucu birebir aynı. Göç iki kez çalışabilir.
//  2) Yabancı anahtar / CHECK / koruma tetikleyicisi hatalı yazmayı durdurur.
//  3) RLS: pazarlamacı kategorileri okur (görünüm doğru taraf verir) ama kuralları
//     okuyamaz; yazma fonksiyonları girişli kullanıcıya kapalı; yönetim özeti yalnız staff.
//  4) Pano kategori toplamları firma bakiyeleriyle tutar.
//  5) Kural akışı: yeni kategori + kural → önizleme → uygula (elle seçim korunur,
//     taksit kurulur) → tekrar aynı plan boş → kural kaldırılınca geri döner.
//  6) Davranış akışı: Peşin gibi ↔ Vadeli gibi ↔ hesaba katılmaz; taksitler uyarlanır,
//     elle taksit korunur, tahsis sürümü değişir.
//  7) İçe aktarma: önizlemeden sonra kurallar değiştiyse KuralDegistiHatasi (409).

const DB = 'tahsilat_kategori'
const BUGUN = '2026-06-15'
const ONCEKI = '0006_takvim.sql'

interface TarafSatiri {
  id: string
  side: string | null
  is_allocatable: boolean
}

async function taraflar(pool: Pool): Promise<TarafSatiri[]> {
  const r = await pool.query<TarafSatiri>(`select id, side, is_allocatable from public.v_invoices_effective order by id`)
  return r.rows
}

async function gorunumKolonlari(pool: Pool, gorunum: string): Promise<string[]> {
  const r = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [gorunum],
  )
  return r.rows.map((x) => x.column_name)
}

async function bakiyeler(pool: Pool): Promise<unknown[]> {
  const r = await pool.query(
    `select b.firm_id, b.pesin_open_eur_cents, b.vadeli_open_eur_cents, b.vadeli_overdue_eur_cents, b.credit_eur_cents,
            b.total_debt_eur_cents, b.total_paid_eur_cents
     from public.firm_balances b join public.v_current_run r on r.run_id = b.run_id
     order by b.firm_id`,
  )
  return r.rows
}

async function hataMesaji(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

describe.skipIf(!SOCKET)('0007: satış kategorileri ve tanıma kuralları', () => {
  let pool: Pool
  let admin: SupabaseClient
  let onceTaraf: TarafSatiri[]
  let onceKolon: string[]
  let onceKapsamKolon: string[]
  let onceBakiye: unknown[]
  /** Numune kuralıyla sınıflandırılan irsaliyeler */
  let numuneIds: string[] = []
  /** Elle PESIN seçilmiş, Belge No'su numune olan irsaliye */
  let elleId = ''

  beforeAll(async () => {
    // 0006'ya kadar kur, veriyi yükle, tam hesap yap → "göç öncesi" durumu kaydet
    pool = await testVeritabaniKur(DB, { gocler: gocler(ONCEKI) })
    await pool.query(SENTETIK_VERI)
    // Belge No'lar kurallarla tutarlı olsun (sentetik veri boş Belge No ile gelir)
    await pool.query(`
      update public.invoices set belge_no_raw = case sale_type_auto
        when 'PESIN' then '+' || right(fis_no, 5)
        when 'KONSINYE' then 'KONSİNYE ' || right(fis_no, 3)
        when 'KONSINYE_PESIN' then 'Konsinye Peşin'
        else case when right(fis_no, 1) in ('1', '3') then right(fis_no, 6) else '' end end`)
    admin = createPgShim(pool)
    await runRecompute(admin, 'setup', 'test@t.local')
    onceTaraf = await taraflar(pool)
    onceKolon = await gorunumKolonlari(pool, 'v_invoices_effective')
    onceKapsamKolon = await gorunumKolonlari(pool, 'v_installments_scope')
    onceBakiye = await bakiyeler(pool)
    // 0007'yi uygula
    await pool.query(gocSql('0007_kategoriler.sql'))
  }, 180_000)

  afterAll(async () => {
    await pool?.end()
  })

  it('göç sonrası taraf / tahsis kapsamı / görünüm kolonları birebir aynı', async () => {
    expect(onceTaraf.length).toBe(1500)
    expect(await taraflar(pool)).toEqual(onceTaraf)
    expect(await gorunumKolonlari(pool, 'v_invoices_effective')).toEqual(onceKolon)
    // kapsam görünümüne yalnız sona "kategori" eklenir
    expect(await gorunumKolonlari(pool, 'v_installments_scope')).toEqual([...onceKapsamKolon, 'kategori'])
  })

  it('göç sonrası tam hesap aynı bakiyeleri verir', async () => {
    await runRecompute(admin, 'manual', 'test@t.local')
    expect(await bakiyeler(pool)).toEqual(onceBakiye)
  }, 60_000)

  it('göç iki kez çalışabilir; yönetici düzenlemesi ve kurallar korunur', async () => {
    await pool.query(`update public.sale_categories set ad = 'Peşin Satış' where kod = 'PESIN'`)
    await pool.query(gocSql(ONCEKI))
    await pool.query(gocSql('0007_kategoriler.sql'))
    const k = await pool.query(`select kod, ad from public.sale_categories order by sira`)
    expect(k.rows.map((r) => r.kod)).toEqual(['PESIN', 'KONSINYE', 'KONSINYE_PESIN', 'OTHER'])
    expect(k.rows[0].ad).toBe('Peşin Satış')
    const kr = await pool.query(`select count(*)::int as n from public.sale_category_rules`)
    expect(kr.rows[0].n).toBe(5)
    expect(await taraflar(pool)).toEqual(onceTaraf)
    await pool.query(`update public.sale_categories set ad = 'Peşin' where kod = 'PESIN'`)
  })

  it('tohum kuralları uygulamadaki varsayılanlarla birebir aynı', async () => {
    const db = await kurallariYukle(admin)
    const sade = (k: Kural) => [k.kategori_kod, k.alan, k.islec, k.deger, k.sonuc, k.sira, k.aktif, k.aciklama].join('|')
    expect(db.map(sade)).toEqual(VARSAYILAN_KURALLAR.map(sade))
  })

  it('tohum kategorileri uygulamadaki varsayılanlarla aynı', async () => {
    const sade = (k: KategoriMeta) => [k.kod, k.ad, k.kisa_ad, k.renk, k.taraf, k.sira, k.aktif, k.sistem, k.sayfada_suzgec, k.panoda_kart].join('|')
    expect((await kategorileriYukle(admin)).map(sade)).toEqual(VARSAYILAN_KATEGORILER.map(sade))
  })

  it('yabancı anahtar, CHECK ve koruma tetikleyicisi hatalı yazmayı durdurur', async () => {
    const id = onceTaraf[0].id
    expect(await hataMesaji(pool.query(`update public.invoices set sale_type_auto = 'YOK_BOYLE' where id = $1`, [id]))).toMatch(/foreign key/)
    expect(await hataMesaji(pool.query(`update public.invoices set suggested_sale_type = 'OTHER' where id = $1`, [id]))).toMatch(/invoices_suggested_not_other/)
    expect(await hataMesaji(pool.query(`update public.sale_categories set kod = 'PESIN2' where kod = 'PESIN'`))).toMatch(/değiştirilemez/)
    expect(await hataMesaji(pool.query(`update public.sale_categories set taraf = 'VADELI' where kod = 'PESIN'`))).toMatch(/Sistem kategorisinin/)
    expect(await hataMesaji(pool.query(`update public.sale_categories set aktif = false where kod = 'KONSINYE'`))).toMatch(/Sistem kategorisinin/)
    expect(await hataMesaji(pool.query(`delete from public.sale_categories where kod = 'OTHER'`))).toMatch(/silinemez/)
    expect(await hataMesaji(pool.query(`insert into public.sale_categories (kod, ad) values ('numune', 'x')`))).toMatch(/check/)
    expect(
      await hataMesaji(pool.query(`insert into public.sale_category_rules (kategori_kod, alan, islec, deger) values ('OTHER', 'BELGE_NO', 'ICERIR', 'X')`)),
    ).toMatch(/check/)
    // izin verilenler: sistem kategorisinin adı/rengi/sırası
    await pool.query(`update public.sale_categories set renk = 'gok', sira = 11 where kod = 'PESIN'`)
    await pool.query(`update public.sale_categories set renk = 'lacivert', sira = 10 where kod = 'PESIN'`)
  })

  it('RLS: pazarlamacı kategorileri okur, kuralları okuyamaz; görünüm doğru tarafı verir', async () => {
    const { PAZ, TAHSILAT } = KULLANICI
    const [k] = await kullaniciOlarak<{ n: number }>(pool, PAZ, `select count(*)::int as n from public.sale_categories`)
    expect(k.n).toBe(4)
    const [kr] = await kullaniciOlarak<{ n: number }>(pool, PAZ, `select count(*)::int as n from public.sale_category_rules`)
    expect(kr.n).toBe(0)
    const [kt] = await kullaniciOlarak<{ n: number }>(pool, TAHSILAT, `select count(*)::int as n from public.sale_category_rules`)
    expect(kt.n).toBe(5)
    // pazarlamacının gördüğü irsaliyelerde taraf, tam yetkiyle görülenle aynı
    const pazTaraf = await kullaniciOlarak<TarafSatiri>(pool, PAZ, `select id, side, is_allocatable from public.v_invoices_effective order by id`)
    expect(pazTaraf.length).toBeGreaterThan(0)
    const tam = new Map(onceTaraf.map((t) => [t.id, t]))
    for (const t of pazTaraf) expect(t).toEqual(tam.get(t.id))
  })

  it('uygulama sunucusu (service_role) kategori ve kural yazabilir; anonim hiçbirini okuyamaz', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query('set local role service_role')
      await c.query(`insert into public.sale_categories (kod, ad, taraf) values ('DENEME', 'Deneme', 'VADELI')`)
      await c.query(`update public.sale_categories set ad = 'Deneme 2' where kod = 'DENEME'`)
      await c.query(`insert into public.sale_category_rules (kategori_kod, alan, islec, deger) values ('DENEME', 'BELGE_NO', 'ICERIR', 'X')`)
      await c.query(`select public.rpc_kurallari_kaydet($1::jsonb, 'test')`, [JSON.stringify(VARSAYILAN_KURALLAR)])
      await c.query(`delete from public.sale_categories where kod = 'DENEME'`)
    } finally {
      await c.query('rollback')
      c.release()
    }
    expect(await hataMesaji(kullaniciOlarak(pool, null, `select count(*) from public.sale_categories`))).toMatch(/permission denied/)
    expect(await hataMesaji(kullaniciOlarak(pool, null, `select count(*) from public.sale_category_rules`))).toMatch(/permission denied/)
  })

  it('RLS: yazma fonksiyonları girişli kullanıcıya kapalı; yönetim özeti yalnız staff', async () => {
    const { PAZ, TAHSILAT, YONETICI } = KULLANICI
    for (const sql of [
      `select public.rpc_siniflandirma_yaz('[]'::jsonb)`,
      `select public.rpc_kurallari_kaydet('[]'::jsonb, 'x')`,
      `select public.rpc_kategori_taraf_degistir('PESIN', null, 'x')`,
      `select public.taksit_taraf_esitle(null)`,
    ]) {
      expect(await hataMesaji(kullaniciOlarak(pool, YONETICI, sql))).toMatch(/permission denied/)
    }
    expect(await hataMesaji(kullaniciOlarak(pool, PAZ, `insert into public.sale_categories (kod, ad) values ('XX', 'x')`))).toMatch(
      /permission denied|row-level security/,
    )
    expect(await hataMesaji(kullaniciOlarak(pool, null, `select public.rpc_kategori_yonetimi()`))).toMatch(/permission denied/)

    const [paz] = await kullaniciOlarak<{ r: unknown }>(pool, PAZ, `select public.rpc_yonetim_ozeti($1) as r`, [BUGUN])
    expect(paz.r).toBeNull()
    const [t] = await kullaniciOlarak<{ r: { kullanicilar: { aktif: number }; saglik: { siniflandirilmamis: number } } }>(
      pool,
      TAHSILAT,
      `select public.rpc_yonetim_ozeti($1) as r`,
      [BUGUN],
    )
    expect(t.r.kullanicilar.aktif).toBe(3)
    const [s] = await pool.query(
      `select count(*)::int as n from public.v_invoices_effective v
       where v.sale_type = 'OTHER' and not v.is_iade and not v.is_31_12 and not v.is_cancelled
         and not coalesce(v.excluded_override, v.is_excluded_firm)`,
    ).then((r) => r.rows)
    expect(t.r.saglik.siniflandirilmamis).toBe(s.n)
  })

  it('pano kategori toplamları firma bakiyeleriyle tutar', async () => {
    const [r] = await kullaniciOlarak<{
      r: { bakiye: { pesin_acik: number; vadeli_acik: number }; kategoriler: Array<{ kod: string; taraf: string | null; acik: number }> }
    }>(pool, KULLANICI.TAHSILAT, `select public.rpc_pano_ozeti($1) as r`, [BUGUN])
    const topla = (taraf: string) => r.r.kategoriler.filter((k) => k.taraf === taraf).reduce((t, k) => t + k.acik, 0)
    expect(r.r.kategoriler.map((k) => k.kod)).toEqual(['PESIN', 'KONSINYE', 'KONSINYE_PESIN'])
    expect(topla('PESIN')).toBe(r.r.bakiye.pesin_acik)
    expect(topla('VADELI')).toBe(r.r.bakiye.vadeli_acik)
  })

  it('varsayılan kurallarla plan: hiçbir irsaliyenin kategorisi değişmez', async () => {
    const kategoriler = await kategorileriYukle(admin)
    const plan = siniflandirmaPlani(await siniflandirmaIrsaliyeleriniYukle(admin), await kurallariYukle(admin), kategoriler)
    expect(plan.ozet.etkinDegisen).toBe(0)
    expect(plan.gecisler).toEqual([])
    // gerekçe/öneri eşitlemesini uygula (sentetik veride gerekçe boş) → ardından plan boş
    await siniflandirmayiUygula(admin, plan, kategoriler, 'test@t.local', 'eşitleme')
    const tekrar = siniflandirmaPlani(await siniflandirmaIrsaliyeleriniYukle(admin), await kurallariYukle(admin), kategoriler)
    expect(tekrar.degisiklikler).toEqual([])
    expect(await taraflar(pool)).toEqual(onceTaraf)
  }, 60_000)

  it('kural akışı: yeni kategori + kural → önizleme → uygula; elle seçim korunur', async () => {
    await pool.query(
      `insert into public.sale_categories (kod, ad, renk, taraf, sira, sistem) values ('NUMUNE', 'Numune', 'pembe', 'VADELI', 40, false)`,
    )
    const adaylar = await pool.query<{ id: string }>(
      `select v.id from public.v_invoices_effective v
       where v.sale_type = 'OTHER' and v.sale_type_override is null and not v.is_31_12 and not v.is_cancelled
         and not v.is_iade and not coalesce(v.excluded_override, v.is_excluded_firm)
       order by v.id limit 6`,
    )
    expect(adaylar.rows.length).toBe(6)
    numuneIds = adaylar.rows.slice(0, 5).map((r) => r.id)
    elleId = adaylar.rows[5].id
    await pool.query(`update public.invoices set belge_no_raw = 'numune ' || left(id::text, 4) where id = any($1::uuid[])`, [[...numuneIds, elleId]])
    // elle PESIN seçimi (uygulamadaki düzenleme ekranı gibi: seçim + taksit kurulumu)
    await pool.query(`update public.invoices set sale_type_override = 'PESIN' where id = $1`, [elleId])
    const kategoriler = await kategorileriYukle(admin)
    expect(await taksitsizlereTaksitKur(admin, [elleId], tarafHaritasi(kategoriler))).toBe(1)

    const kurallar: Kural[] = [
      { kategori_kod: 'NUMUNE', alan: 'BELGE_NO', islec: 'ICERIR', deger: 'NUMUNE', sonuc: 'ATA', sira: 5, aktif: true, aciklama: 'Numune' },
      ...VARSAYILAN_KURALLAR,
    ]
    const plan = siniflandirmaPlani(await siniflandirmaIrsaliyeleriniYukle(admin), kurallar, kategoriler)
    expect(plan.gecisler).toEqual([expect.objectContaining({ eski: 'OTHER', yeni: 'NUMUNE', adet: 5, ton: 'kazanc' })])
    expect(plan.ozet.etkinDegisen).toBe(5)
    expect(plan.ozet.elleKorunan).toBe(1)

    // imza: aynı veri + aynı kurallar → aynı plan
    const plan2 = siniflandirmaPlani(await siniflandirmaIrsaliyeleriniYukle(admin), kurallar, kategoriler)
    expect(plan2.imza).toBe(plan.imza)

    await pool.query(`select public.rpc_kurallari_kaydet($1::jsonb, 'test@t.local')`, [JSON.stringify(kurallar)])
    const sonuc = await siniflandirmayiUygula(admin, plan, kategoriler, 'test@t.local', 'test')
    expect(sonuc.kurulanTaksit).toBeGreaterThanOrEqual(5)

    const inv = await pool.query(`select id, sale_type_auto, sale_type_override from public.invoices where id = any($1::uuid[]) order by id`, [
      [...numuneIds, elleId],
    ])
    for (const r of inv.rows) {
      expect(r.sale_type_auto).toBe('NUMUNE')
      expect(r.sale_type_override).toBe(r.id === elleId ? 'PESIN' : null)
    }
    const tak = await pool.query(`select distinct side from public.installments where invoice_id = any($1::uuid[])`, [numuneIds])
    expect(tak.rows.map((r) => r.side)).toEqual(['VADELI'])
    const elleTaksit = await pool.query(`select distinct side from public.installments where invoice_id = $1`, [elleId])
    expect(elleTaksit.rows.map((r) => r.side)).toEqual(['PESIN'])

    // aynı kurallarla yeni plan boş; hesap sonrası numune borcu panoda kendi satırında
    const tekrar = siniflandirmaPlani(await siniflandirmaIrsaliyeleriniYukle(admin), await kurallariYukle(admin), await kategorileriYukle(admin))
    expect(tekrar.degisiklikler).toEqual([])
    await runRecompute(admin, 'edit', 'test@t.local')
    const [p] = await kullaniciOlarak<{ r: { bakiye: { vadeli_acik: number }; kategoriler: Array<{ kod: string; taraf: string; acik: number }> } }>(
      pool,
      KULLANICI.TAHSILAT,
      `select public.rpc_pano_ozeti($1) as r`,
      [BUGUN],
    )
    expect(p.r.kategoriler.map((k) => k.kod)).toContain('NUMUNE')
    expect(p.r.kategoriler.filter((k) => k.taraf === 'VADELI').reduce((t, k) => t + k.acik, 0)).toBe(p.r.bakiye.vadeli_acik)
  }, 90_000)

  it('davranış: Vadeli → Peşin → hesaba katılmaz → Vadeli; elle taksit korunur', async () => {
    const firmalar = await pool.query<{ firm_id: string }>(`select distinct firm_id from public.invoices where id = any($1::uuid[])`, [numuneIds])
    const firmIds = firmalar.rows.map((r) => r.firm_id)
    const surum = async () => (await pool.query(`select public.tahsis_surumu($1::uuid[]) as s`, [firmIds])).rows[0].s as string
    const s0 = await surum()

    // → Peşin gibi
    const r1 = (await pool.query(`select public.rpc_kategori_taraf_degistir('NUMUNE', 'PESIN', 'test') as r`)).rows[0].r
    expect(r1.irsaliye).toBe(5)
    const t1 = await pool.query(`select distinct side, no_date_flag from public.installments where invoice_id = any($1::uuid[])`, [numuneIds])
    expect(t1.rows).toEqual([{ side: 'PESIN', no_date_flag: false }])
    expect(await surum()).not.toBe(s0)

    // bir irsaliyeye elle taksit
    const [ilk] = numuneIds
    await pool.query(
      `insert into public.installments (invoice_id, firm_id, side, seq, due_date, amount_eur_cents, source, no_date_flag)
       select id, firm_id, 'PESIN', 99, date '2026-09-01', 100, 'manual', false from public.invoices where id = $1`,
      [ilk],
    )

    // → hesaba katılmaz: otomatik taksitler silinir, elle olan kalır; tahsise girmez
    const r2 = (await pool.query(`select public.rpc_kategori_taraf_degistir('NUMUNE', null, 'test') as r`)).rows[0].r
    expect(r2.taksitsiz).toEqual([])
    const t2 = await pool.query(`select source from public.installments where invoice_id = any($1::uuid[])`, [numuneIds])
    expect(t2.rows.map((r) => r.source)).toEqual(['manual'])
    const kapsam = await pool.query(`select bool_or(is_allocatable) as b from public.v_invoices_effective where id = any($1::uuid[])`, [numuneIds])
    expect(kapsam.rows[0].b).toBe(false)
    await runRecompute(admin, 'edit', 'test@t.local')
    const kalan = await pool.query(`select remaining_eur_cents from public.installments where invoice_id = $1`, [ilk])
    expect(kalan.rows[0].remaining_eur_cents).toBeNull()

    // → Vadeli gibi: taksitsizler döner, plandan kurulur; elle taksitin tarafı eşitlenir
    const r3 = (await pool.query(`select public.rpc_kategori_taraf_degistir('NUMUNE', 'VADELI', 'test') as r`)).rows[0].r
    expect([...r3.taksitsiz].sort()).toEqual(numuneIds.slice(1).sort())
    const kurulan = await taksitsizlereTaksitKur(admin, r3.taksitsiz, tarafHaritasi(await kategorileriYukle(admin)))
    expect(kurulan).toBeGreaterThanOrEqual(4)
    const t3 = await pool.query(`select distinct side from public.installments where invoice_id = any($1::uuid[])`, [numuneIds])
    expect(t3.rows.map((r) => r.side)).toEqual(['VADELI'])
    await runRecompute(admin, 'edit', 'test@t.local')
    const k3 = await pool.query(`select bool_and(is_allocatable) as b from public.v_invoices_effective where id = any($1::uuid[])`, [numuneIds])
    expect(k3.rows[0].b).toBe(true)
  }, 90_000)

  it('kural kaldırılınca numuneler sınıfsıza döner, otomatik taksitleri silinir', async () => {
    const kategoriler = await kategorileriYukle(admin)
    const plan = siniflandirmaPlani(await siniflandirmaIrsaliyeleriniYukle(admin), [...VARSAYILAN_KURALLAR], kategoriler)
    expect(plan.gecisler).toEqual([expect.objectContaining({ eski: 'NUMUNE', yeni: 'OTHER', adet: 5, ton: 'kayip' })])
    await pool.query(`select public.rpc_kurallari_kaydet($1::jsonb, 'test@t.local')`, [JSON.stringify(VARSAYILAN_KURALLAR)])
    await siniflandirmayiUygula(admin, plan, kategoriler, 'test@t.local', 'test')
    const t = await pool.query(`select source from public.installments where invoice_id = any($1::uuid[])`, [numuneIds])
    expect(t.rows.map((r) => r.source)).toEqual(['manual'])
    const r = await pool.query(`select bool_and(needs_review) as b, bool_and(sale_type_auto = 'OTHER') as o from public.invoices where id = any($1::uuid[])`, [
      numuneIds,
    ])
    expect(r.rows[0]).toEqual({ b: true, o: true })
    // elle seçilen dokunulmadan kalır
    const e = await pool.query(`select sale_type_override from public.invoices where id = $1`, [elleId])
    expect(e.rows[0].sale_type_override).toBe('PESIN')
  }, 60_000)

  it('kategori kullanım sayıları doğrudan sayımla tutar', async () => {
    const [r] = await kullaniciOlarak<{ r: { kategoriler: Array<{ kod: string; irsaliye: number; elle: number; kural: number }> } }>(
      pool,
      KULLANICI.TAHSILAT,
      `select public.rpc_kategori_yonetimi() as r`,
    )
    const say = await pool.query<{ kod: string; n: number; elle: number }>(
      `select sale_type as kod, count(*)::int as n, count(*) filter (where sale_type_override is not null)::int as elle
       from public.v_invoices_effective group by 1`,
    )
    const beklenen = new Map(say.rows.map((x) => [x.kod, x]))
    for (const k of r.r.kategoriler) {
      expect(k.irsaliye).toBe(beklenen.get(k.kod)?.n ?? 0)
      expect(k.elle).toBe(beklenen.get(k.kod)?.elle ?? 0)
    }
    expect(r.r.kategoriler.find((k) => k.kod === 'NUMUNE')?.kural).toBe(0)
    expect(r.r.kategoriler.find((k) => k.kod === 'KONSINYE')?.kural).toBe(2)
  })

  it('otomatik taksit satırları, irsaliye düzenlemedeki yeniden kurulumla aynı', async () => {
    const r = await pool.query<{ id: string }>(
      `select i.id from public.invoices i
       where i.sale_type_auto = 'KONSINYE' and i.sale_type_override is null and i.amount_eur_cents is not null
         and not exists (select 1 from public.installments t where t.invoice_id = i.id and t.source = 'manual')
       order by i.id limit 3`,
    )
    const planlar = ['05/4-5-6', '', '15.09.2026']
    const harita = tarafHaritasi(await kategorileriYukle(admin))
    for (let n = 0; n < r.rows.length; n++) {
      const id = r.rows[n].id
      await pool.query(`update public.invoices set odeme_plani_raw = $2 where id = $1`, [id, planlar[n]])
      const inv = (await loadInvoiceForOps(admin, id))!
      await regenerateInstallments(admin, inv, { tarafHaritasi: harita })
      const db = await pool.query(
        `select side, seq, due_date, amount_eur_cents, source, no_date_flag from public.installments where invoice_id = $1 order by seq`,
        [id],
      )
      const saf = otomatikTaksitSatirlari(
        { id, firm_id: inv.firm_id, invoice_date: inv.invoice_date, odeme_plani_raw: inv.odeme_plani_raw, plan_override_note: inv.plan_override_note, amount: inv.amount_eur_cents! },
        'VADELI',
      ).map((x) => ({ side: x.side, seq: x.seq, due_date: x.due_date, amount_eur_cents: x.amount_eur_cents, source: x.source, no_date_flag: x.no_date_flag }))
      expect(db.rows).toEqual(saf)
    }
  })

  it('içe aktarma: önizlemeden sonra kurallar değiştiyse KuralDegistiHatasi', async () => {
    const imza = kuralImzasi(await kurallariYukle(admin), await kategorileriYukle(admin))
    const b = await pool.query(
      `insert into public.import_batches (kind, filename, uploaded_by, status, stats) values ('irsaliye', 'x.xls', 'test', 'preview', $1::jsonb) returning id`,
      [JSON.stringify({ kural_imzasi: imza })],
    )
    // kural değişir (numune kuralı eklenir) → imza tutmaz
    await pool.query(`insert into public.sale_category_rules (kategori_kod, alan, islec, deger, sonuc, sira) values ('NUMUNE', 'BELGE_NO', 'ICERIR', 'NUMUNE', 'ATA', 5)`)
    await expect(commitIrsaliyeBatch(admin, b.rows[0].id, 'test')).rejects.toBeInstanceOf(KuralDegistiHatasi)
    // aynı imzayla (kural geri alınınca) bu kontrol geçer; boş önizleme başka nedenle reddedilir
    await pool.query(`delete from public.sale_category_rules where kategori_kod = 'NUMUNE'`)
    await expect(commitIrsaliyeBatch(admin, b.rows[0].id, 'test')).rejects.toThrow(/geçerli satır yok/)
  })
})
