import type { SupabaseClient } from '@supabase/supabase-js'
import { buildInstallments, scaleInstallmentAmounts } from '@/lib/engine/installments'
import { parseOdemePlani } from '@/lib/engine/planParser'
import type { PlanParseStatus, SaleType } from '@/lib/engine/types'
import { chunkedWrite, fetchAll, writeAudit, type AuditEntry } from '@/lib/db'
import { runRecompute } from '@/lib/recompute'
import type { IrsaliyeRecord } from './irsaliyeParser'

// Staged irsaliye batch'ini uygular.
// TEMEL KURAL: yalnız HAM sütunlar yazılır; Tahsilat Yöneticisi'nin override
// sütunlarına dokunulmaz. Override'lı bir kaydın ham verisi değiştiyse
// raw_changed_after_override bayrağı kalkar ve kayıt inceleme kuyruğuna düşer.
// Elle girilmiş taksitler de bir düzenlemedir: tarihleri asla ezilmez.

interface ExistingInvoiceFull {
  id: string
  fis_no: string
  firm_id: string
  invoice_date: string
  belge_no_raw: string
  turu_raw: string
  odeme_plani_raw: string
  f_flag_raw: string
  amount_tl: number | null
  amount_eur_cents: number | null
  sale_type_auto: SaleType
  sale_type_override: SaleType | null
  amount_eur_cents_override: number | null
  cancelled_at: string | null
  excluded_override: boolean | null
  plan_override_note: string | null
  raw_changed_after_override: boolean
  needs_review: boolean
}

export interface CommitStats {
  inserted: number
  updated: number
  unchanged: number
  firmsCreated: number
  installmentsRebuilt: number
  conflicts: number
  recompute: { runId: string; allocationCount: number }
}

function effectiveSaleType(auto: SaleType, override: SaleType | null): SaleType {
  return override ?? auto
}

function sideOf(t: SaleType): 'PESIN' | 'VADELI' | null {
  if (t === 'PESIN') return 'PESIN'
  if (t === 'KONSINYE' || t === 'KONSINYE_PESIN') return 'VADELI'
  return null
}

interface ExistingInstallment {
  id: string
  invoice_id: string
  seq: number
  due_date: string
  amount_eur_cents: number
  source: string
  side: string
}

/** Taksit kaynağı ve 'tarih girilmedi' bayrağı plan çözüm durumundan türetilir. */
function planKaynagi(status: PlanParseStatus, side: 'PESIN' | 'VADELI') {
  return {
    source: status === 'empty_default' || status === 'unparsed' ? 'default_invoice_date' : 'auto_plan',
    no_date_flag: status === 'empty_default' && side === 'VADELI',
  }
}

export async function commitIrsaliyeBatch(
  admin: SupabaseClient,
  batchId: string,
  actorEmail: string,
): Promise<CommitStats> {
  // 1) Batch + staged satırlar
  const { data: batch, error: batchError } = await admin
    .from('import_batches')
    .select('id, kind, status')
    .eq('id', batchId)
    .maybeSingle()
  if (batchError || !batch) throw new Error('İçe aktarma kaydı bulunamadı.')
  if (batch.kind !== 'irsaliye') throw new Error('Bu kayıt bir irsaliye içe aktarımı değil.')
  if (batch.status !== 'preview') throw new Error('Bu içe aktarma zaten uygulanmış veya iptal edilmiş.')

  const stagedRows = await fetchAll<{ payload: IrsaliyeRecord; diff_status: string }>((from, to) =>
    admin
      .from('import_rows')
      .select('payload, diff_status')
      .eq('batch_id', batchId)
      .order('row_index')
      .range(from, to),
  )
  const records = stagedRows.filter((r) => r.diff_status !== 'invalid').map((r) => r.payload)
  if (records.length === 0) throw new Error('Uygulanacak geçerli satır yok.')

  // 2) Firmaları hazırla (eksikleri oluştur)
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
    const newFirms = missingCodes.map((code) => {
      const rec = byCode.get(code)!
      return {
        code_norm: code,
        code_raw: rec.firmCodeRaw,
        name: rec.firmName || rec.firmCodeRaw,
        is_auto_created: true,
      }
    })
    await chunkedWrite(newFirms, (chunk) => admin.from('firms').insert(chunk))
    firmsCreated = newFirms.length
    for (let i = 0; i < missingCodes.length; i += 200) {
      const chunk = missingCodes.slice(i, i + 200)
      const rows = await fetchAll<{ id: string; code_norm: string }>((from, to) =>
        admin.from('firms').select('id, code_norm').in('code_norm', chunk).order('id').range(from, to),
      )
      for (const f of rows) firmIdByCode.set(f.code_norm, f.id)
    }
  }

  // 3) Mevcut irsaliyeleri çek (override koruması ve değişim tespiti için)
  const existingByFisNo = new Map<string, ExistingInvoiceFull>()
  const fisNos = records.map((r) => r.fisNo)
  for (let i = 0; i < fisNos.length; i += 200) {
    const chunk = fisNos.slice(i, i + 200)
    const rows = await fetchAll<ExistingInvoiceFull>((from, to) =>
      admin
        .from('invoices')
        .select(
          'id, fis_no, firm_id, invoice_date, belge_no_raw, turu_raw, odeme_plani_raw, f_flag_raw, amount_tl, amount_eur_cents, sale_type_auto, sale_type_override, amount_eur_cents_override, cancelled_at, excluded_override, plan_override_note, raw_changed_after_override, needs_review',
        )
        .in('fis_no', chunk)
        .order('id')
        .range(from, to),
    )
    for (const row of rows) existingByFisNo.set(row.fis_no, row)
  }

  // 3b) Mevcut irsaliyelerin taksitleri (elle taksit = düzenleme; çakışma tespiti ve tazeleme için)
  const instByInvoice = new Map<string, ExistingInstallment[]>()
  const existingIds = Array.from(existingByFisNo.values()).map((e) => e.id)
  for (let i = 0; i < existingIds.length; i += 200) {
    const chunk = existingIds.slice(i, i + 200)
    const rows = await fetchAll<ExistingInstallment>((from, to) =>
      admin
        .from('installments')
        .select('id, invoice_id, seq, due_date, amount_eur_cents, source, side')
        .in('invoice_id', chunk)
        .order('id')
        .range(from, to),
    )
    for (const row of rows) {
      const arr = instByInvoice.get(row.invoice_id)
      if (arr) arr.push(row)
      else instByInvoice.set(row.invoice_id, [row])
    }
  }
  for (const arr of instByInvoice.values()) arr.sort((a, b) => a.seq - b.seq)

  // 4) Upsert satırlarını kur
  const now = new Date().toISOString()
  const upsertRows: Record<string, unknown>[] = []
  const audits: AuditEntry[] = []
  let inserted = 0
  let updated = 0
  let unchanged = 0
  let conflicts = 0

  for (const rec of records) {
    const ex = existingByFisNo.get(rec.fisNo)
    const firmId = firmIdByCode.get(rec.firmCodeNorm)
    if (!firmId) continue

    const hasManualInstallments = !!ex && (instByInvoice.get(ex.id) ?? []).some((t) => t.source === 'manual')
    const hasOverride =
      !!ex &&
      (ex.sale_type_override !== null ||
        ex.amount_eur_cents_override !== null ||
        ex.cancelled_at !== null ||
        ex.excluded_override !== null ||
        ex.plan_override_note !== null ||
        hasManualInstallments)

    const changedFields: string[] = []
    if (ex) {
      // ERP müşteriyi değiştirdiyse (yeniden kodlama/düzeltme) irsaliye firmaya taşınır
      if (ex.firm_id !== firmId) changedFields.push('firma')
      if (ex.invoice_date !== rec.invoiceDateISO) changedFields.push('tarih')
      if ((ex.belge_no_raw ?? '') !== rec.belgeNoRaw) changedFields.push('belge_no')
      if ((ex.odeme_plani_raw ?? '') !== rec.odemePlaniRaw) changedFields.push('odeme_plani')
      if ((ex.amount_eur_cents ?? null) !== (rec.amountEurCents ?? null)) changedFields.push('tutar_eur')
      const exTl = ex.amount_tl === null ? null : Math.round(Number(ex.amount_tl) * 100)
      const recTl = rec.amountTl === null ? null : Math.round(rec.amountTl * 100)
      if (exTl !== recTl) changedFields.push('tutar_tl')
      if ((ex.turu_raw ?? '') !== rec.turuRaw) changedFields.push('turu')
      if ((ex.f_flag_raw ?? '') !== rec.fFlagRaw) changedFields.push('f_bayragi')
    }

    const rawChangedAfterOverride = (ex?.raw_changed_after_override ?? false) || (hasOverride && changedFields.length > 0)
    if (hasOverride && changedFields.length > 0) conflicts++

    if (!ex) inserted++
    else if (changedFields.length > 0) updated++
    else unchanged++

    upsertRows.push({
      fis_no: rec.fisNo,
      firm_id: firmId,
      invoice_date: rec.invoiceDateISO,
      belge_no_raw: rec.belgeNoRaw,
      turu_raw: rec.turuRaw,
      odeme_plani_raw: rec.odemePlaniRaw,
      f_flag_raw: rec.fFlagRaw,
      amount_tl: rec.amountTl,
      amount_eur_cents: rec.amountEurCents,
      dovizli_raw: rec.dovizliRaw,
      sale_type_auto: rec.saleTypeAuto,
      suggested_sale_type: rec.suggestedSaleType,
      plan_parse_status: rec.planParseStatus,
      plan_parse_note: rec.planParseNote,
      classify_reason: rec.classifyReason,
      is_31_12: rec.is3112,
      fisno_nonstandard: rec.fisnoNonstandard,
      // Ham veri değişmediyse mevcut inceleme durumu korunur — kullanıcının
      // kapattığı inceleme, aynı dosya yeniden yüklendi diye geri açılmaz.
      needs_review:
        ex && changedFields.length === 0 ? ex.needs_review || rawChangedAfterOverride : rec.needsReview || rawChangedAfterOverride,
      raw_changed_after_override: rawChangedAfterOverride,
      last_import_batch_id: batchId,
      updated_at: now,
    })

    if (ex && changedFields.length > 0) {
      audits.push({
        actorEmail,
        entityType: 'irsaliye',
        entityId: rec.fisNo,
        action: 'ICE_AKTARIM_GUNCELLEME',
        field: changedFields.join(','),
        oldValue: {
          firma: ex.firm_id,
          tarih: ex.invoice_date,
          belge_no: ex.belge_no_raw,
          odeme_plani: ex.odeme_plani_raw,
          tutar_eur: ex.amount_eur_cents,
        },
        newValue: {
          firma: firmId,
          tarih: rec.invoiceDateISO,
          belge_no: rec.belgeNoRaw,
          odeme_plani: rec.odemePlaniRaw,
          tutar_eur: rec.amountEurCents,
        },
      })
    }
  }

  await chunkedWrite(upsertRows, (chunk) => admin.from('invoices').upsert(chunk, { onConflict: 'fis_no' }))

  // 5) Upsert sonrası id'leri ve etkin değerleri çek
  interface InvoiceAfter {
    id: string
    fis_no: string
    firm_id: string
    amount_eur_cents: number | null
    amount_eur_cents_override: number | null
    sale_type_auto: SaleType
    sale_type_override: SaleType | null
  }
  const afterByFisNo = new Map<string, InvoiceAfter>()
  for (let i = 0; i < fisNos.length; i += 200) {
    const chunk = fisNos.slice(i, i + 200)
    const rows = await fetchAll<InvoiceAfter>((from, to) =>
      admin
        .from('invoices')
        .select('id, fis_no, firm_id, amount_eur_cents, amount_eur_cents_override, sale_type_auto, sale_type_override')
        .in('fis_no', chunk)
        .order('id')
        .range(from, to),
    )
    for (const row of rows) afterByFisNo.set(row.fis_no, row)
  }

  // 6) Taksit üretimi/yenilenmesi
  //
  //  * Taksiti olmayan → etkin plandan (yönetici planı ?? dosya planı) üret
  //  * Elle taksit → TARİHLER korunur; etkin tutar değiştiyse tutarlar yeni
  //    toplama oransal ölçeklenir, tip değiştiyse taraf güncellenir
  //  * Yönetici planı → dosyadaki plan değişse de o plan esas kalır; tutar,
  //    tarih (yıl) veya tip değişirse O PLANDAN yeniden üretilir
  //  * Düzenlemesiz → plan/tutar/tarih/tip değiştiyse dosyadan yeniden üret
  //  * OTHER'a döndü → otomatik taksitler kaldırılır
  const otomatikSilinecek: string[] = [] // elle taksitlere dokunmadan
  const tumuSilinecek: string[] = [] // elle taksitler yeniden yazılacak
  const firmaTasinacak: Array<{ invoiceId: string; firmId: string }> = []
  const newInstallmentRows: Record<string, unknown>[] = []

  for (const rec of records) {
    const after = afterByFisNo.get(rec.fisNo)
    if (!after) continue
    const ex = existingByFisNo.get(rec.fisNo)
    const effType = effectiveSaleType(after.sale_type_auto, after.sale_type_override)
    const side = sideOf(effType)
    const existingInsts = ex ? (instByInvoice.get(ex.id) ?? []) : []
    const manual = existingInsts.filter((t) => t.source === 'manual')
    const effAmount = after.amount_eur_cents_override ?? after.amount_eur_cents

    // Firma değiştiyse taksitler de yeni firmaya taşınır (borç doğru firmada eşleşsin)
    if (ex && ex.firm_id !== after.firm_id && existingInsts.length > 0) {
      firmaTasinacak.push({ invoiceId: after.id, firmId: after.firm_id })
    }

    if (side === null || effAmount === null) {
      // OTHER veya tutarı okunamayan: taksit üretilmez; kalmış otomatik taksit varsa kaldır
      if (existingInsts.some((t) => t.source !== 'manual')) otomatikSilinecek.push(after.id)
      continue
    }

    const hasPlanOverride = !!ex && ex.plan_override_note !== null
    const plan = hasPlanOverride
      ? parseOdemePlani(ex!.plan_override_note, rec.invoiceDateISO)
      : { status: rec.planParseStatus, dueDates: rec.dueDates }

    const pushBuilt = (dueDates: string[], status: PlanParseStatus) => {
      const kaynak = planKaynagi(status, side)
      for (const b of buildInstallments(effAmount, dueDates)) {
        newInstallmentRows.push({
          invoice_id: after.id,
          firm_id: after.firm_id,
          side,
          seq: b.seq,
          due_date: b.dueDate,
          amount_eur_cents: b.amountCents,
          source: kaynak.source,
          no_date_flag: kaynak.no_date_flag,
          remaining_eur_cents: null,
        })
      }
    }

    if (existingInsts.length === 0) {
      pushBuilt(plan.dueDates, plan.status)
      continue
    }

    const mevcutToplam = existingInsts.reduce((s, t) => s + Number(t.amount_eur_cents), 0)
    const tarafDegisti = existingInsts.some((t) => t.side !== side)

    if (manual.length > 0) {
      const manuelToplam = manual.reduce((s, t) => s + Number(t.amount_eur_cents), 0)
      if (manuelToplam === effAmount && !tarafDegisti && manual.length === existingInsts.length) continue
      const yeni = scaleInstallmentAmounts(
        manual.map((t) => Number(t.amount_eur_cents)),
        effAmount,
      )
      tumuSilinecek.push(after.id)
      manual.forEach((t, i) => {
        newInstallmentRows.push({
          invoice_id: after.id,
          firm_id: after.firm_id,
          side,
          seq: i + 1,
          due_date: t.due_date,
          amount_eur_cents: yeni[i],
          source: 'manual',
          no_date_flag: false,
          remaining_eur_cents: null,
        })
      })
      continue
    }

    const planChanged = !!ex && (ex.odeme_plani_raw ?? '') !== rec.odemePlaniRaw
    const dateChanged = !!ex && ex.invoice_date !== rec.invoiceDateISO
    const tutarDegisti = mevcutToplam !== effAmount
    const yenile = tutarDegisti || tarafDegisti || dateChanged || (planChanged && !hasPlanOverride)
    if (!yenile) continue

    otomatikSilinecek.push(after.id)
    pushBuilt(plan.dueDates, plan.status)
  }

  await chunkedWrite(
    otomatikSilinecek,
    (chunk) => admin.from('installments').delete().in('invoice_id', chunk).neq('source', 'manual'),
    100,
  )
  await chunkedWrite(tumuSilinecek, (chunk) => admin.from('installments').delete().in('invoice_id', chunk), 100)
  for (const t of firmaTasinacak) {
    const { error } = await admin.from('installments').update({ firm_id: t.firmId }).eq('invoice_id', t.invoiceId)
    if (error) throw new Error('Taksitler yeni firmaya taşınamadı: ' + error.message)
  }
  await chunkedWrite(newInstallmentRows, (chunk) => admin.from('installments').insert(chunk))

  // 7) Denetim + batch durumu
  audits.unshift({
    actorEmail,
    entityType: 'ice_aktarim',
    entityId: batchId,
    action: 'IRSALIYE_AKTARIMI',
    newValue: { yeni: inserted, guncellenen: updated, degismeyen: unchanged, firma_olusturulan: firmsCreated, cakisma: conflicts },
  })
  await writeAudit(admin, audits)

  await admin
    .from('import_batches')
    .update({
      status: 'committed',
      committed_at: now,
      stats: { inserted, updated, unchanged, firmsCreated, conflicts, installments: newInstallmentRows.length },
    })
    .eq('id', batchId)

  // 8) Mutabakatı yeniden hesapla
  const recompute = await runRecompute(admin, 'import', actorEmail)

  return {
    inserted,
    updated,
    unchanged,
    firmsCreated,
    installmentsRebuilt: newInstallmentRows.length,
    conflicts,
    recompute: { runId: recompute.runId, allocationCount: recompute.allocationCount },
  }
}
