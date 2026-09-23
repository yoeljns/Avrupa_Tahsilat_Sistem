import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { incelemeNedenleri } from '@/lib/engine/inceleme'
import { SINIFSIZ, classifyWithRules, type Kural } from '@/lib/engine/kurallar'
import { parseOdemePlani } from '@/lib/engine/planParser'
import { chunkedWrite, fetchAll, writeAudit, type AuditEntry } from '@/lib/db'
import { otomatikTaksitSatirlari } from '@/lib/invoiceOps'
import { tarafHaritasi, type KategoriMeta, type Taraf } from '@/lib/kategoriMeta'

// TOPLU YENİDEN SINIFLANDIRMA (tanıma kuralları kaydedilince).
//
// Neden gerekli: her içe aktarma dosyadaki TÜM satırların otomatik tipini
// yeniden yazar — kural değişikliği "yalnız ileriye" uygulanamaz; bir sonraki
// yükleme sessizce yeniden sınıflandırırdı. Bu yüzden kural kaydı her zaman
// önizleme + mevcut irsaliyelere uygulama demektir.
//
// Kurallar: yalnız OTOMATİK alanlar (sale_type_auto, öneri, gerekçe, inceleme)
// yazılır; yöneticinin elle seçtiği tip (sale_type_override) ve plan alanlarına
// ASLA dokunulmaz.

export interface SiniflandirmaIrsaliyesi {
  id: string
  fis_no: string
  firm_id: string
  firm_code: string
  invoice_date: string
  belge_no_raw: string
  turu_raw: string
  sale_type_auto: string
  suggested_sale_type: string | null
  sale_type_override: string | null
  classify_reason: string | null
  needs_review: boolean
  is_31_12: boolean
  is_cancelled: boolean
  is_allocatable: boolean
  /** etkin tutar (override ?? ham) */
  amount_eur_cents: number | null
  odeme_plani_raw: string
  plan_override_note: string | null
}

export interface SiniflandirmaDegisikligi {
  id: string
  fis_no: string
  firm_id: string
  firm_code: string
  belge_no_raw: string
  eskiAuto: string
  yeniAuto: string
  eskiOneri: string | null
  yeniOneri: string | null
  neden: string
  /** null = inceleme bayrağına dokunulmaz */
  inceleme: boolean | null
  etkinEski: string
  etkinYeni: string
  tutar: number
  tahsisteki: boolean
  elleVar: boolean
}

export type GecisTonu = 'kayip' | 'kazanc' | 'taraf' | 'notr'

export interface SiniflandirmaGecisi {
  eski: string
  yeni: string
  adet: number
  tutar: number
  tahsisteki: number
  ton: GecisTonu
}

export interface SiniflandirmaPlani {
  degisiklikler: SiniflandirmaDegisikligi[]
  /** Etkin tipi değişenler, eski→yeni gruplu (yöneticinin elle seçtikleri etkilenmez) */
  gecisler: SiniflandirmaGecisi[]
  ozet: {
    incelenen: number
    degisen: number
    etkinDegisen: number
    /** yalnız otomatik tipi değişen ama elle seçimi olduğu için etkisiz kalanlar */
    elleKorunan: number
    /** yalnız öneri/gerekçe değişenler */
    yalnizOneri: number
  }
  /** Uygulama anında aynı plan mı? (arada veri/kural değiştiyse farklı olur) */
  imza: string
}

/**
 * Geçişin borca etkisi: davranışsız (sınıflandırılmadı / hesaba katılmaz) → davranışlı
 * "kazanç", tersi "kayıp", Peşin ↔ Vadeli "taraf", davranış aynıysa "nötr"
 * (ör. sınıflandırılmadı → hesaba katılmaz borcu değiştirmez).
 */
function gecisTonu(eski: string, yeni: string, harita: ReadonlyMap<string, Taraf>): GecisTonu {
  const te = eski === SINIFSIZ ? null : (harita.get(eski) ?? null)
  const ty = yeni === SINIFSIZ ? null : (harita.get(yeni) ?? null)
  if (te === ty) return 'notr'
  if (ty === null) return 'kayip'
  if (te === null) return 'kazanc'
  return 'taraf'
}

/** SAF: taslak kurallarla tüm irsaliyeleri yeniden sınıflandırır, farkları çıkarır. */
export function siniflandirmaPlani(
  irsaliyeler: readonly SiniflandirmaIrsaliyesi[],
  kurallar: readonly Kural[],
  kategoriler: readonly KategoriMeta[],
): SiniflandirmaPlani {
  const harita = tarafHaritasi(kategoriler)
  const gecerli = new Set(kategoriler.filter((k) => k.aktif).map((k) => k.kod))
  const degisiklikler: SiniflandirmaDegisikligi[] = []

  for (const inv of irsaliyeler) {
    const yeni = classifyWithRules(inv.belge_no_raw, inv.turu_raw, kurallar, gecerli)
    const yeniOneri = yeni.suggested ?? null
    if (yeni.type === inv.sale_type_auto && yeniOneri === inv.suggested_sale_type && yeni.reason === (inv.classify_reason ?? '')) continue

    const etkinEski = inv.sale_type_override ?? inv.sale_type_auto
    const etkinYeni = inv.sale_type_override ?? yeni.type

    // İnceleme bayrağı: elle seçim varsa aynen; sınıfsıza düşen incelemeye girer;
    // sınıfsızdan çıkan için diğer nedenler (plan, tutar, iade) yeniden değerlendirilir;
    // gerçek tipten gerçek tipe geçişte kullanıcının inceleme durumu korunur.
    let inceleme: boolean | null = null
    if (inv.sale_type_override === null) {
      if (yeni.type === SINIFSIZ && inv.sale_type_auto !== SINIFSIZ) {
        inceleme = true
      } else if (inv.sale_type_auto === SINIFSIZ && yeni.type !== SINIFSIZ) {
        const taraf = harita.get(yeni.type) ?? null
        if (taraf === null && !yeni.needsReview) {
          inceleme = false // "hesaba katılmaz": borç doğmaz, incelenecek bir şey yok
        } else {
          const plan = parseOdemePlani(inv.plan_override_note ?? inv.odeme_plani_raw, inv.invoice_date)
          inceleme = incelemeNedenleri({ siniflandirma: yeni, plan, amountEurCents: inv.amount_eur_cents, is3112: inv.is_31_12 }).length > 0
        }
      }
    }

    degisiklikler.push({
      id: inv.id,
      fis_no: inv.fis_no,
      firm_id: inv.firm_id,
      firm_code: inv.firm_code,
      belge_no_raw: inv.belge_no_raw,
      eskiAuto: inv.sale_type_auto,
      yeniAuto: yeni.type,
      eskiOneri: inv.suggested_sale_type,
      yeniOneri,
      neden: yeni.reason,
      inceleme,
      etkinEski,
      etkinYeni,
      tutar: inv.is_31_12 || inv.is_cancelled ? 0 : (inv.amount_eur_cents ?? 0),
      tahsisteki: inv.is_allocatable,
      elleVar: inv.sale_type_override !== null,
    })
  }

  const gruplar = new Map<string, SiniflandirmaGecisi>()
  for (const d of degisiklikler) {
    if (d.etkinEski === d.etkinYeni) continue
    const anahtar = `${d.etkinEski}→${d.etkinYeni}`
    let g = gruplar.get(anahtar)
    if (!g) gruplar.set(anahtar, (g = { eski: d.etkinEski, yeni: d.etkinYeni, adet: 0, tutar: 0, tahsisteki: 0, ton: gecisTonu(d.etkinEski, d.etkinYeni, harita) }))
    g.adet++
    g.tutar += d.tutar
    if (d.tahsisteki) g.tahsisteki++
  }
  const TON_SIRASI: Record<GecisTonu, number> = { kayip: 0, taraf: 1, kazanc: 2, notr: 3 }
  const gecisler = Array.from(gruplar.values()).sort((a, b) => TON_SIRASI[a.ton] - TON_SIRASI[b.ton] || b.tutar - a.tutar)

  const imza = createHash('md5')
    .update(
      degisiklikler
        .map((d) => `${d.id}:${d.yeniAuto}:${d.yeniOneri ?? ''}:${d.neden}:${d.inceleme ?? ''}`)
        .sort()
        .join('|'),
    )
    .digest('hex')

  const etkinDegisen = degisiklikler.filter((d) => d.etkinEski !== d.etkinYeni).length
  return {
    degisiklikler,
    gecisler,
    ozet: {
      incelenen: irsaliyeler.length,
      degisen: degisiklikler.length,
      etkinDegisen,
      elleKorunan: degisiklikler.filter((d) => d.elleVar && d.eskiAuto !== d.yeniAuto).length,
      yalnizOneri: degisiklikler.filter((d) => d.eskiAuto === d.yeniAuto).length,
    },
    imza,
  }
}

/** Yeniden sınıflandırma için tüm irsaliyeler (servis istemcisiyle) */
export async function siniflandirmaIrsaliyeleriniYukle(admin: SupabaseClient): Promise<SiniflandirmaIrsaliyesi[]> {
  return fetchAll<SiniflandirmaIrsaliyesi>((from, to) =>
    admin
      .from('v_invoices_effective')
      .select(
        'id, fis_no, firm_id, firm_code, invoice_date, belge_no_raw, turu_raw, sale_type_auto, suggested_sale_type, sale_type_override, classify_reason, needs_review, is_31_12, is_cancelled, is_allocatable, amount_eur_cents, odeme_plani_raw, plan_override_note',
      )
      .order('id')
      .range(from, to),
  )
}

/**
 * Davranışı (tarafı) olan ama hiç taksiti olmayan irsaliyelere plandan otomatik
 * taksit kurar (sınıfsızdan/hesap dışından çıkanlar). Kurulan satır sayısı.
 */
export async function taksitsizlereTaksitKur(
  admin: SupabaseClient,
  invoiceIds: readonly string[],
  harita: ReadonlyMap<string, Taraf>,
): Promise<number> {
  if (invoiceIds.length === 0) return 0
  interface Satir {
    id: string
    firm_id: string
    invoice_date: string
    odeme_plani_raw: string
    plan_override_note: string | null
    amount_eur_cents: number | null
    amount_eur_cents_override: number | null
    sale_type_auto: string
    sale_type_override: string | null
  }
  const irsaliyeler: Satir[] = []
  const taksitli = new Set<string>()
  for (let i = 0; i < invoiceIds.length; i += 200) {
    const parca = invoiceIds.slice(i, i + 200)
    const [inv, tak] = await Promise.all([
      fetchAll<Satir>((from, to) =>
        admin
          .from('invoices')
          .select('id, firm_id, invoice_date, odeme_plani_raw, plan_override_note, amount_eur_cents, amount_eur_cents_override, sale_type_auto, sale_type_override')
          .in('id', parca)
          .order('id')
          .range(from, to),
      ),
      fetchAll<{ invoice_id: string }>((from, to) =>
        admin.from('installments').select('invoice_id').in('invoice_id', parca).order('invoice_id').range(from, to),
      ),
    ])
    irsaliyeler.push(...inv)
    for (const t of tak) taksitli.add(t.invoice_id)
  }
  const yeniSatirlar: Record<string, unknown>[] = []
  for (const inv of irsaliyeler) {
    if (taksitli.has(inv.id)) continue
    const side = harita.get(inv.sale_type_override ?? inv.sale_type_auto) ?? null
    const tutar = inv.amount_eur_cents_override ?? inv.amount_eur_cents
    if (side === null || tutar === null) continue
    yeniSatirlar.push(
      ...otomatikTaksitSatirlari(
        { id: inv.id, firm_id: inv.firm_id, invoice_date: inv.invoice_date, odeme_plani_raw: inv.odeme_plani_raw, plan_override_note: inv.plan_override_note, amount: tutar },
        side,
      ),
    )
  }
  await chunkedWrite(yeniSatirlar, (chunk) => admin.from('installments').insert(chunk))
  return yeniSatirlar.length
}

export interface UygulamaSonucu {
  irsaliye: number
  silinenTaksit: number
  taraflananTaksit: number
  kurulanTaksit: number
}

/** Planı uygular: otomatik alanlar + taksit uyarlaması + irsaliye başına denetim. Hesap çağıranda. */
export async function siniflandirmayiUygula(
  admin: SupabaseClient,
  plan: SiniflandirmaPlani,
  kategoriler: readonly KategoriMeta[],
  actorEmail: string,
  sebep: string,
): Promise<UygulamaSonucu> {
  const sonuc: UygulamaSonucu = { irsaliye: 0, silinenTaksit: 0, taraflananTaksit: 0, kurulanTaksit: 0 }
  const d = plan.degisiklikler
  for (let i = 0; i < d.length; i += 500) {
    const parca = d.slice(i, i + 500)
    const { data, error } = await admin.rpc('rpc_siniflandirma_yaz', {
      p_degisiklikler: parca.map((x) => ({ id: x.id, auto: x.yeniAuto, oneri: x.yeniOneri, neden: x.neden, inceleme: x.inceleme })),
    })
    if (error) throw new Error('Sınıflandırma yazılamadı: ' + error.message)
    const r = (data ?? {}) as { irsaliye?: number; silinen_taksit?: number; taraf_esitlenen?: number }
    sonuc.irsaliye += r.irsaliye ?? 0
    sonuc.silinenTaksit += r.silinen_taksit ?? 0
    sonuc.taraflananTaksit += r.taraf_esitlenen ?? 0
  }

  // Etkin tipi değişip taksiti olmayanlara plandan taksit kur (sınıfsızdan çıkanlar)
  const harita = tarafHaritasi(kategoriler)
  sonuc.kurulanTaksit = await taksitsizlereTaksitKur(
    admin,
    d.filter((x) => x.etkinEski !== x.etkinYeni && (harita.get(x.etkinYeni) ?? null) !== null).map((x) => x.id),
    harita,
  )

  const denetim: AuditEntry[] = d
    .filter((x) => x.eskiAuto !== x.yeniAuto || x.eskiOneri !== x.yeniOneri)
    .map((x) => ({
      actorEmail,
      entityType: 'irsaliye',
      entityId: x.fis_no,
      action: 'KURAL_SINIFLANDIRMA',
      field: 'satis_tipi',
      oldValue: { otomatik: x.eskiAuto, oneri: x.eskiOneri, etkin: x.etkinEski },
      newValue: { otomatik: x.yeniAuto, oneri: x.yeniOneri, etkin: x.etkinYeni },
      reason: sebep,
    }))
  await writeAudit(admin, denetim)
  return sonuc
}
