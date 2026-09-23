import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcile } from '@/lib/engine/reconcile'
import type { EngineOutput } from '@/lib/engine/types'
import { fetchAll } from '@/lib/db'
import { todayISO } from '@/lib/format'
import {
  haricFirmaKumesi,
  motorGirdisiKur,
  type GirdiIrsaliye,
  type GirdiOdeme,
  type GirdiTaksit,
} from '@/lib/tahsisGirdisi'

// Mutabakat (tahsis) hesabı — iki yol, TEK kural:
//
//  * runRecompute (TAM): içe aktarma, "Yeniden Hesapla" ve takip dışı liste
//    değişikliğinde. Tüm firmalar yeni bir koşu (recon_run) altına yazılır,
//    sonra işaretçi kilit altında çevrilir — okuyucular asla yarım koşu görmez.
//
//  * recomputeFirms (FİRMA BAZLI): irsaliye/taksit düzenlemesinden sonra.
//    Tahsis kuralı firma başına işlediği için (bir firmanın ödemesi başka
//    firmanın borcunu kapatmaz) yalnız düzenlenen firma hesaplanıp güncel
//    koşuya yazılır. Sonuç tam hesapla BİREBİR aynıdır, ama saniyeler yerine
//    milisaniyeler sürer.
//
// Tahsis kuralı (tek havuz): ödemenin geldiği sayfa (PEŞİN/VADELİ) önemsizdir;
// firma başına tüm ödemeler önce peşin borçları, sonra en yakın vadeli
// taksitleri kapatır. KDV 1/5 ödemeleri havuza girmez: referansındaki
// (son 4 hane) irsaliyeden tamamı düşülür; referansı çözülemeyenler tahsise
// girmez. ALC ve TAMAMLANMAMIŞ kayıtlar her zaman dışarıdadır.

export type TriggerKind = 'import' | 'edit' | 'manual' | 'setup'

export interface RecomputeStats {
  runId: string
  installmentCount: number
  paymentCount: number
  allocationCount: number
  totalOpenCents: number
  totalCreditCents: number
}

/** Paralel ama sınırlı eşzamanlı parça yazımı (veritabanını boğmadan hızlı). */
async function parcaParcaYaz<T>(
  rows: T[],
  size: number,
  concurrency: number,
  write: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size))
  let next = 0
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++]
      const { error } = await write(chunk)
      if (error) throw new Error(error.message)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker))
}

function tahsisSatirlari(result: EngineOutput) {
  return result.allocations.map((a) => ({
    payment_id: a.paymentId,
    installment_id: a.installmentId,
    invoice_id: a.invoiceId,
    firm_id: a.firmId,
    side: a.side,
    amount_eur_cents: a.amountCents,
  }))
}

function bakiyeSatirlari(result: EngineOutput) {
  return result.balances.map((b) => ({
    firm_id: b.firmId,
    pesin_open_eur_cents: b.pesinOpenCents,
    vadeli_open_eur_cents: b.vadeliOpenCents,
    vadeli_overdue_eur_cents: b.vadeliOverdueCents,
    credit_eur_cents: b.creditCents,
    next_due_date: b.nextDueDate,
    total_debt_eur_cents: b.totalDebtCents,
    total_paid_eur_cents: b.totalPaidCents,
  }))
}

/** Yanıttan SONRA çalıştırılabilecek temizlik işi (Next `after`); istek dışında hemen koşar. */
async function sonra(is: () => Promise<unknown>): Promise<void> {
  try {
    const { after } = await import('next/server')
    after(async () => {
      try {
        await is()
      } catch {
        // temizlik hatası kullanıcı işini bozmaz
      }
    })
  } catch {
    try {
      await is()
    } catch {
      // yok say
    }
  }
}

// ---------------------------------------------------------------------------
// TAM YENİDEN HESAP
// ---------------------------------------------------------------------------
export async function runRecompute(
  admin: SupabaseClient,
  triggerKind: TriggerKind,
  actorEmail: string,
): Promise<RecomputeStats> {
  const asOf = todayISO()

  // 0) Koşuyu ÖNCE aç: başlangıç anı, hesap sürerken gelen düzenlemeleri
  //    yakalamak için referanstır (işaretçi çevrilene kadar kimse görmez).
  const { data: run, error: runError } = await admin
    .from('recon_runs')
    .insert({ triggered_by: actorEmail, trigger_kind: triggerKind, stats: { as_of: asOf } })
    .select('id')
    .single()
  if (runError || !run) throw new Error('Mutabakat koşusu açılamadı: ' + runError?.message)
  const runId = run.id as string

  // 1) Girdiler — birbirinden bağımsız, PARALEL okunur
  const [irsaliyeler, firmalar, haricKodlar, taksitler, odemeler] = await Promise.all([
    fetchAll<GirdiIrsaliye>((from, to) =>
      admin
        .from('v_invoices_effective')
        .select('id, firm_id, fis_no, invoice_date, side, is_allocatable')
        .order('id')
        .range(from, to),
    ),
    fetchAll<{ id: string; code_norm: string }>((from, to) =>
      admin.from('firms').select('id, code_norm').order('id').range(from, to),
    ),
    fetchAll<{ code_norm: string }>((from, to) =>
      admin.from('excluded_firm_codes').select('code_norm').order('code_norm').range(from, to),
    ),
    fetchAll<GirdiTaksit>((from, to) =>
      admin
        .from('installments')
        .select('id, invoice_id, firm_id, seq, due_date, amount_eur_cents')
        .order('id')
        .range(from, to),
    ),
    fetchAll<GirdiOdeme>((from, to) =>
      admin
        .from('payments')
        .select('id, islem_kodu, firm_id, islem_tarihi, doviz_eur_cents, is_kdv, kdv_fatura_referansi, aciklama')
        .eq('allocatable', true)
        .order('id')
        .range(from, to),
    ),
  ])

  // 2) Saf motor
  const haric = haricFirmaKumesi(
    firmalar,
    haricKodlar.map((k) => k.code_norm),
  )
  const girdi = motorGirdisiKur(irsaliyeler, taksitler, odemeler, haric)
  const result = reconcile({ installments: girdi.installments, payments: girdi.payments, asOf })

  // 3) Sonuçları yeni koşuya yaz — parçalar paralel
  const kalanlar: Array<{ id: string; remaining: number | null }> = []
  for (const t of girdi.installments) {
    kalanlar.push({ id: t.id, remaining: result.remainingByInstallment.get(t.id) ?? t.amountCents })
  }
  for (const id of girdi.kapsamDisiTaksitIds) kalanlar.push({ id, remaining: null })

  await Promise.all([
    parcaParcaYaz(
      tahsisSatirlari(result).map((a) => ({ ...a, run_id: runId })),
      500,
      4,
      (chunk) => admin.from('allocations').insert(chunk),
    ),
    parcaParcaYaz(
      bakiyeSatirlari(result).map((b) => ({ ...b, run_id: runId })),
      500,
      2,
      (chunk) => admin.from('firm_balances').insert(chunk),
    ),
    parcaParcaYaz(kalanlar, 1000, 4, async (chunk) => {
      const { error } = await admin.rpc('bulk_set_installment_remaining', { updates: chunk })
      return { error }
    }),
    admin
      .from('recon_runs')
      .update({
        stats: {
          as_of: asOf,
          ...result.stats,
          kdv_eslesen: girdi.kdvEslesen,
          kdv_eslesmeyen: girdi.kdvEslesmeyen,
        },
      })
      .eq('id', runId)
      .then(({ error }) => {
        if (error) throw new Error(error.message)
      }),
  ])

  // 4) İşaretçiyi kilit altında çevir; hesap sürerken düzenlenen firmaları al
  const { data: yakalanan, error: flipError } = await admin.rpc('rpc_kosu_cevir', { p_run_id: runId })
  if (flipError) throw new Error('Koşu işaretçisi güncellenemedi: ' + flipError.message)

  // 5) Bu arada düzenlenen firmalar varsa onları hemen yeni koşuda tazele
  const yakalananFirmalar = Array.isArray(yakalanan) ? (yakalanan as string[]) : []
  if (yakalananFirmalar.length > 0) {
    await recomputeFirms(admin, yakalananFirmalar, actorEmail)
  }

  // 6) Eski koşuları yanıttan sonra temizle (son 5 kalır)
  await sonra(async () => {
    await admin.rpc('rpc_eski_kosulari_buda', { p_tut: 5 })
  })

  return {
    runId,
    installmentCount: girdi.installments.length,
    paymentCount: girdi.payments.length,
    allocationCount: result.allocations.length,
    totalOpenCents: result.stats.totalOpenCents,
    totalCreditCents: result.stats.totalCreditCents,
  }
}

// ---------------------------------------------------------------------------
// FİRMA BAZLI YENİDEN HESAP
// ---------------------------------------------------------------------------
interface TahsisGirdisiRpc {
  run_id: string | null
  surum: string
  firmalar: Array<{ id: string; code_norm: string }>
  haric_kodlar: string[]
  irsaliyeler: GirdiIrsaliye[]
  taksitler: GirdiTaksit[]
  odemeler: GirdiOdeme[]
}

export interface FirmRecomputeResult {
  runId: string
  /** 'firma': yalnız verilen firmalar hesaplandı; 'tam': güncel koşu yoktu, tam hesap yapıldı */
  mode: 'firma' | 'tam'
  firmCount: number
}

const DENEME_SAYISI = 4

export async function recomputeFirms(
  admin: SupabaseClient,
  firmIds: string[],
  actorEmail: string,
): Promise<FirmRecomputeResult> {
  const ids = Array.from(new Set(firmIds.filter(Boolean)))
  if (ids.length === 0) {
    const { data } = await admin.from('v_current_run').select('run_id').maybeSingle()
    return { runId: (data?.run_id as string | undefined) ?? '', mode: 'firma', firmCount: 0 }
  }

  for (let deneme = 1; deneme <= DENEME_SAYISI; deneme++) {
    const { data, error } = await admin.rpc('rpc_tahsis_girdisi', { p_firm_ids: ids })
    if (error) throw new Error('Tahsis girdisi okunamadı: ' + error.message)
    const g = data as TahsisGirdisiRpc

    // Henüz hiç koşu yoksa (ilk kurulum) tam hesap yap
    if (!g.run_id) {
      const tam = await runRecompute(admin, 'edit', actorEmail)
      return { runId: tam.runId, mode: 'tam', firmCount: ids.length }
    }

    const haric = haricFirmaKumesi(g.firmalar ?? [], g.haric_kodlar ?? [])
    const girdi = motorGirdisiKur(g.irsaliyeler ?? [], g.taksitler ?? [], g.odemeler ?? [], haric)
    const result = reconcile({ installments: girdi.installments, payments: girdi.payments, asOf: todayISO() })

    const kalanlar: Array<{ id: string; remaining: number }> = girdi.installments.map((t) => ({
      id: t.id,
      remaining: result.remainingByInstallment.get(t.id) ?? t.amountCents,
    }))

    const { data: sonuc, error: yazError } = await admin.rpc('rpc_tahsis_yaz', {
      p_run_id: g.run_id,
      p_firm_ids: ids,
      p_surum: g.surum,
      p_tahsisler: tahsisSatirlari(result),
      p_bakiyeler: bakiyeSatirlari(result),
      p_kalanlar: kalanlar,
    })
    if (yazError) throw new Error('Tahsis yazılamadı: ' + yazError.message)
    if (sonuc === 'OK') return { runId: g.run_id, mode: 'firma', firmCount: ids.length }
    // 'SURUM_DEGISTI' / 'ESKI_KOSU': bu arada biri veriyi değiştirdi → taze girdiyle tekrar
  }

  // Sürekli çakışma (çok nadir): güvenli yol — tam hesap
  const tam = await runRecompute(admin, 'edit', actorEmail)
  return { runId: tam.runId, mode: 'tam', firmCount: ids.length }
}
