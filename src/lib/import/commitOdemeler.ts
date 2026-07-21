import type { SupabaseClient } from '@supabase/supabase-js'
import { normText, normalizeFirmCode } from '@/lib/engine/normalize'
import { chunkedWrite, fetchAll, writeAudit, type AuditEntry } from '@/lib/db'
import { runRecompute } from '@/lib/recompute'
import { stripCodeSuffix, type OdemeRecord } from './odemelerParser'

// Staged ödeme batch'ini uygular. Ödemelerde override yoktur; tüm sütunlar
// ham veridir ve islem_kodu ile idempotent upsert edilir.

export interface OdemeCommitStats {
  inserted: number
  updated: number
  unchanged: number
  firmsCreated: number
  recompute: { runId: string; allocationCount: number }
}

interface ExistingPayment {
  id: string
  islem_kodu: string
  sheet_side: string
  islem_tarihi: string | null
  firma_kodu_raw: string
  gelen_tl: number | null
  doviz_eur_cents: number | null
  kur: number | null
  aciklama: string | null
  kayit_durumu: string | null
  hedef_fis_no: string | null
}

function tsEpoch(v: string | null): number | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

export function odemeChangedFields(rec: OdemeRecord, ex: ExistingPayment): string[] {
  const changed: string[] = []
  if (ex.sheet_side !== rec.sheetSide) changed.push('sayfa')
  if (tsEpoch(ex.islem_tarihi) !== tsEpoch(rec.islemTarihiISO)) changed.push('tarih')
  // Dosyada olmayan kolonlar kıyaslanmaz (ince biçim yedekler)
  if (rec.hasKodu && (ex.firma_kodu_raw ?? '') !== rec.firmCodeRaw) changed.push('firma_kodu')
  const exTl = ex.gelen_tl === null ? null : Math.round(Number(ex.gelen_tl) * 100)
  const recTl = rec.gelenTl === null ? null : Math.round(rec.gelenTl * 100)
  if (exTl !== recTl) changed.push('gelen_tl')
  if ((ex.doviz_eur_cents ?? null) !== (rec.dovizEurCents ?? null)) changed.push('doviz_euro')
  const exKur = ex.kur === null ? null : Math.round(Number(ex.kur) * 1e6)
  const recKur = rec.kur === null ? null : Math.round(rec.kur * 1e6)
  if (exKur !== recKur) changed.push('kur')
  if (rec.hasDetails) {
    if ((ex.aciklama ?? '') !== rec.aciklama) changed.push('aciklama')
    if ((ex.kayit_durumu ?? '') !== rec.kayitDurumu) changed.push('kayit_durumu')
    if ((ex.hedef_fis_no ?? '') !== rec.hedefFisNo) changed.push('hedef_fis_no')
  }
  return changed
}

export interface UnresolvedFirm {
  islemKodu: string
  firmaRaw: string
  reason: string
  rowIndex: number
  sheet: string
}

/**
 * FİRMA KODU kolonu olmayan (ince biçim) kayıtlarda firmayı ADDAN çözer:
 *   1) İşlem kodu zaten kayıtlıysa → mevcut ödemenin firması (en güvenilir)
 *   2) Daha önceki ödemelerin FİRMA adı → firma eşleşmesi
 *   3) Firma tablosundaki ad eşleşmesi
 * Çözülen kayıtların firmCodeRaw/firmCodeNorm alanları doldurulur.
 */
export async function resolveFirmsByName(
  admin: SupabaseClient,
  records: OdemeRecord[],
): Promise<{ resolvedByName: number; unresolved: UnresolvedFirm[] }> {
  const needs = records.filter((r) => !r.hasKodu)
  if (needs.length === 0) return { resolvedByName: 0, unresolved: [] }

  const firms = await fetchAll<{ id: string; code_norm: string; name: string }>((from, to) =>
    admin.from('firms').select('id, code_norm, name').order('id').range(from, to),
  )
  const codeByFirmId = new Map(firms.map((f) => [f.id, f.code_norm]))

  const existingPays = await fetchAll<{ islem_kodu: string; firm_id: string; firma_raw: string | null }>((from, to) =>
    admin.from('payments').select('islem_kodu, firm_id, firma_raw').order('id').range(from, to),
  )
  const firmByKodu = new Map(existingPays.map((p) => [p.islem_kodu, p.firm_id]))

  const addCandidate = (map: Map<string, Set<string>>, name: string | null, code: string | undefined) => {
    const n = normText(name)
    if (!n || !code) return
    let set = map.get(n)
    if (!set) map.set(n, (set = new Set()))
    set.add(code)
  }
  const nameMap = new Map<string, Set<string>>()
  for (const p of existingPays) addCandidate(nameMap, p.firma_raw, codeByFirmId.get(p.firm_id))
  for (const f of firms) addCandidate(nameMap, f.name, f.code_norm)

  let resolvedByName = 0
  const unresolved: UnresolvedFirm[] = []
  for (const rec of needs) {
    const viaKodu = firmByKodu.get(rec.islemKodu)
    let code = viaKodu ? codeByFirmId.get(viaKodu) : undefined
    if (!code) {
      const candidates = nameMap.get(normText(rec.firmaRaw))
      if (candidates && candidates.size === 1) {
        code = Array.from(candidates)[0]
        resolvedByName++
      } else {
        unresolved.push({
          islemKodu: rec.islemKodu,
          firmaRaw: rec.firmaRaw,
          reason: candidates && candidates.size > 1 ? 'Ad birden çok firmayla eşleşti' : 'Ad hiçbir firmayla eşleşmedi',
          rowIndex: rec.rowIndex,
          sheet: rec.sheet,
        })
        continue
      }
    }
    rec.firmCodeRaw = code
    rec.firmCodeNorm = normalizeFirmCode(code)
  }
  return { resolvedByName, unresolved }
}

export async function fetchExistingPayments(
  admin: SupabaseClient,
  islemKodlari: string[],
): Promise<Map<string, ExistingPayment>> {
  const out = new Map<string, ExistingPayment>()
  for (let i = 0; i < islemKodlari.length; i += 200) {
    const chunk = islemKodlari.slice(i, i + 200)
    const rows = await fetchAll<ExistingPayment>((from, to) =>
      admin
        .from('payments')
        .select('id, islem_kodu, sheet_side, islem_tarihi, firma_kodu_raw, gelen_tl, doviz_eur_cents, kur, aciklama, kayit_durumu, hedef_fis_no')
        .in('islem_kodu', chunk)
        .order('id')
        .range(from, to),
    )
    for (const row of rows) out.set(row.islem_kodu, row)
  }
  return out
}

export async function commitOdemelerBatch(
  admin: SupabaseClient,
  batchId: string,
  actorEmail: string,
): Promise<OdemeCommitStats> {
  const { data: batch, error: batchError } = await admin
    .from('import_batches')
    .select('id, kind, status')
    .eq('id', batchId)
    .maybeSingle()
  if (batchError || !batch) throw new Error('İçe aktarma kaydı bulunamadı.')
  if (batch.kind !== 'odemeler') throw new Error('Bu kayıt bir ödeme içe aktarımı değil.')
  if (batch.status !== 'preview') throw new Error('Bu içe aktarma zaten uygulanmış veya iptal edilmiş.')

  const stagedRows = await fetchAll<{ payload: OdemeRecord; diff_status: string }>((from, to) =>
    admin
      .from('import_rows')
      .select('payload, diff_status')
      .eq('batch_id', batchId)
      .order('row_index')
      .range(from, to),
  )
  const records = stagedRows.filter((r) => r.diff_status !== 'invalid').map((r) => r.payload)
  if (records.length === 0) throw new Error('Uygulanacak geçerli satır yok.')

  // Firmalar (bilinmeyenler oluşturulur)
  const firmIdByCode = new Map<string, string>()
  const codes = Array.from(new Set(records.map((r) => r.firmCodeNorm)))
  for (let i = 0; i < codes.length; i += 200) {
    const chunk = codes.slice(i, i + 200)
    const rows = await fetchAll<{ id: string; code_norm: string }>((from, to) =>
      admin.from('firms').select('id, code_norm').in('code_norm', chunk).order('id').range(from, to),
    )
    for (const f of rows) firmIdByCode.set(f.code_norm, f.id)
  }
  const missingCodes = codes.filter((c) => !firmIdByCode.has(c))
  let firmsCreated = 0
  if (missingCodes.length > 0) {
    const byCode = new Map(records.map((r) => [r.firmCodeNorm, r]))
    await chunkedWrite(
      missingCodes.map((code) => {
        const rec = byCode.get(code)!
        return {
          code_norm: code,
          code_raw: rec.firmCodeRaw,
          name: stripCodeSuffix(rec.firmaRaw) || rec.firmCodeRaw,
          is_auto_created: true,
        }
      }),
      (chunk) => admin.from('firms').insert(chunk),
    )
    firmsCreated = missingCodes.length
    for (let i = 0; i < missingCodes.length; i += 200) {
      const chunk = missingCodes.slice(i, i + 200)
      const rows = await fetchAll<{ id: string; code_norm: string }>((from, to) =>
        admin.from('firms').select('id, code_norm').in('code_norm', chunk).order('id').range(from, to),
      )
      for (const f of rows) firmIdByCode.set(f.code_norm, f.id)
    }
  }

  const existing = await fetchExistingPayments(
    admin,
    records.map((r) => r.islemKodu),
  )

  const now = new Date().toISOString()
  const upsertRows: Record<string, unknown>[] = []
  const audits: AuditEntry[] = []
  let inserted = 0
  let updated = 0
  let unchanged = 0

  for (const rec of records) {
    const firmId = firmIdByCode.get(rec.firmCodeNorm)
    if (!firmId) continue
    const ex = existing.get(rec.islemKodu)
    const changed = ex ? odemeChangedFields(rec, ex) : []
    if (!ex) inserted++
    else if (changed.length > 0) updated++
    else unchanged++

    const row: Record<string, unknown> = {
      islem_kodu: rec.islemKodu,
      sheet_side: rec.sheetSide,
      firm_id: firmId,
      islem_tarihi: rec.islemTarihiISO,
      firma_raw: rec.firmaRaw,
      firma_kodu_raw: rec.firmCodeRaw,
      gelen_tl: rec.gelenTl,
      doviz_eur_cents: rec.dovizEurCents,
      kur: rec.kur,
      toplam_tl: rec.toplamTl,
      is_alc: rec.isAlc,
      last_import_batch_id: batchId,
      updated_at: now,
    }
    // İnce biçim yedeklerde OLMAYAN kolonlar yazılmaz → mevcut kayıtların
    // AÇIKLAMA/ALACAKLI/KDV/DURUM alanları (is_kdv dahil) aynen korunur.
    if (rec.hasDetails) {
      Object.assign(row, {
        fark: rec.fark,
        odeme_sekli: rec.odemeSekli,
        aciklama: rec.aciklama,
        alacakli_durumu: rec.alacakliDurumu,
        alacakli_tl: rec.alacakliTl,
        alacakli_eur_cents: rec.alacakliEurCents,
        alacakli_islemi: rec.alacakliIslemi,
        kdv15_durumu: rec.kdv15Durumu,
        kdv_fatura_referansi: rec.kdvFaturaReferansi,
        kdv_fatura_toplami_eur_cents: rec.kdvFaturaToplamiEurCents,
        kdv15_on_odeme_eur_cents: rec.kdv15OnOdemeEurCents,
        kdv_kalan_borc_eur_cents: rec.kdvKalanBorcEurCents,
        kdv_taksit_sayisi: rec.kdvTaksitSayisi,
        kdv_taksit_basi_eur_cents: rec.kdvTaksitBasiEurCents,
        kayit_durumu: rec.kayitDurumu,
        eksik_alanlar: rec.eksikAlanlar,
        isleyen: rec.isleyen,
        islem_zamani_raw: rec.islemZamaniRaw,
        hedef_fis_no: rec.hedefFisNo,
        hedef_acik_eur_raw: rec.hedefAcikEurRaw,
        is_complete: rec.isComplete,
        is_kdv: rec.isKdv ?? false,
      })
    }
    upsertRows.push(row)

    if (ex && changed.length > 0) {
      audits.push({
        actorEmail,
        entityType: 'odeme',
        entityId: rec.islemKodu,
        action: 'ICE_AKTARIM_GUNCELLEME',
        field: changed.join(','),
        oldValue: { tarih: ex.islem_tarihi, doviz_euro: ex.doviz_eur_cents, firma_kodu: ex.firma_kodu_raw },
        newValue: { tarih: rec.islemTarihiISO, doviz_euro: rec.dovizEurCents, firma_kodu: rec.firmCodeRaw },
      })
    }
  }

  // PostgREST tek istekteki tüm satırlarda aynı kolon kümesini bekler;
  // tam/ince biçim karışıklığına karşı satırlar şekillerine göre gruplanır.
  const byShape = new Map<string, Record<string, unknown>[]>()
  for (const row of upsertRows) {
    const key = Object.keys(row).sort().join(',')
    const arr = byShape.get(key)
    if (arr) arr.push(row)
    else byShape.set(key, [row])
  }
  for (const rows of byShape.values()) {
    await chunkedWrite(rows, (chunk) => admin.from('payments').upsert(chunk, { onConflict: 'islem_kodu' }))
  }

  audits.unshift({
    actorEmail,
    entityType: 'ice_aktarim',
    entityId: batchId,
    action: 'ODEME_AKTARIMI',
    newValue: { yeni: inserted, guncellenen: updated, degismeyen: unchanged, firma_olusturulan: firmsCreated },
  })
  await writeAudit(admin, audits)

  await admin
    .from('import_batches')
    .update({ status: 'committed', committed_at: now, stats: { inserted, updated, unchanged, firmsCreated } })
    .eq('id', batchId)

  const recompute = await runRecompute(admin, 'import', actorEmail)

  return { inserted, updated, unchanged, firmsCreated, recompute: { runId: recompute.runId, allocationCount: recompute.allocationCount } }
}
