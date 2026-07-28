import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/db'
import type { MatrisSatiri } from '@/components/MonthMatrix'

// Okuma sayfalarının ortak sorguları. Kullanıcı oturumlu istemciyle çağrılır —
// RLS sayesinde pazarlamacı yalnız kendi firmalarının verisini görür.

export async function currentRunId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from('v_current_run').select('run_id').maybeSingle()
  return (data?.run_id as string | undefined) ?? null
}

/** Firma bazlı bakiye (tek havuz modeli). */
export interface BalanceRow {
  firm_id: string
  pesin_open_eur_cents: number
  vadeli_open_eur_cents: number
  vadeli_overdue_eur_cents: number
  credit_eur_cents: number
  next_due_date: string | null
  total_debt_eur_cents: number
  total_paid_eur_cents: number
}

export async function balancesAtRun(supabase: SupabaseClient, runId: string): Promise<BalanceRow[]> {
  return fetchAll<BalanceRow>((from, to) =>
    supabase
      .from('firm_balances')
      .select(
        'firm_id, pesin_open_eur_cents, vadeli_open_eur_cents, vadeli_overdue_eur_cents, credit_eur_cents, next_due_date, total_debt_eur_cents, total_paid_eur_cents',
      )
      .eq('run_id', runId)
      .order('firm_id')
      .range(from, to),
  )
}

export interface FirmRow {
  id: string
  code_norm: string
  code_raw: string
  name: string
  segment: string | null
  city: string | null
  pazarlamaci_email: string | null
  is_auto_created: boolean
}

export async function allFirms(supabase: SupabaseClient): Promise<FirmRow[]> {
  return fetchAll<FirmRow>((from, to) =>
    supabase
      .from('firms')
      .select('id, code_norm, code_raw, name, segment, city, pazarlamaci_email, is_auto_created')
      .order('code_norm')
      .range(from, to),
  )
}

/** Kapsam içi taksit — tam ödenmişler DAHİL (BORÇ/ÖDEME/KALAN görünümü için). */
export interface ScopeInstallmentRow {
  installment_id: string
  invoice_id: string
  firm_id: string
  firm_code: string
  firm_name: string
  side: 'PESIN' | 'VADELI'
  seq: number
  due_date: string
  invoice_date: string
  fis_no: string
  amount_eur_cents: number
  remaining_eur_cents: number
  paid_eur_cents: number
  no_date_flag: boolean
  source: string
}

export async function scopeInstallments(
  supabase: SupabaseClient,
  side?: 'PESIN' | 'VADELI',
): Promise<ScopeInstallmentRow[]> {
  return fetchAll<ScopeInstallmentRow>((from, to) => {
    let q = supabase
      .from('v_installments_scope')
      .select(
        'installment_id, invoice_id, firm_id, firm_code, firm_name, side, seq, due_date, invoice_date, fis_no, amount_eur_cents, remaining_eur_cents, paid_eur_cents, no_date_flag, source',
      )
    if (side) q = q.eq('side', side)
    return q.order('due_date').order('firm_code').order('installment_id').range(from, to)
  })
}

/** Hariç tutulan firma kodları kümesi (görünümlerden gizlemek için). */
export async function excludedCodeSet(supabase: SupabaseClient): Promise<Set<string>> {
  const rows = await fetchAll<{ code_norm: string }>((from, to) =>
    supabase.from('excluded_firm_codes').select('code_norm').order('code_norm').range(from, to),
  )
  return new Set(rows.map((r) => r.code_norm))
}

/** Firma id → pazarlamacı e-postasının kullanıcı adı kısmı (SORUMLU sütunu). */
export async function pazarlamaciByFirm(supabase: SupabaseClient): Promise<Map<string, string>> {
  const firms = await allFirms(supabase)
  const map = new Map<string, string>()
  for (const f of firms) {
    if (f.pazarlamaci_email) map.set(f.id, f.pazarlamaci_email.split('@')[0].toUpperCase())
  }
  return map
}

/**
 * Matris sayfalarının (konsinye / peşin) TÜM verisi TEK ağ turunda.
 *
 * Eskiden: currentRunId (1 tur) + scopeInstallments (1000'lik sayfalama ile
 * N ARDIŞIK tur) + pazarlamaciByFirm → allFirms (M tur). Uygulama ile
 * veritabanı arası her tur gecikme ekliyordu; sayfa geçişi saniyelere çıkıyordu.
 * Artık rpc_matris_verisi hepsini tek yanıtta döndürür (RLS aynen işler).
 * RPC yoksa eski çok turlu yola düşülür — migration sırası kimseyi kilitlemez.
 */
export async function matrisVerisi(
  supabase: SupabaseClient,
  side: 'PESIN' | 'VADELI',
): Promise<{ runId: string | null; rows: MatrisSatiri[]; sorumlu: Map<string, string> }> {
  const { data, error } = await supabase.rpc('rpc_matris_verisi', { p_side: side })
  if (!error && data) {
    const d = data as { run_id: string | null; rows: MatrisSatiri[]; sorumlu: Record<string, string> }
    return {
      runId: d.run_id ?? null,
      rows: d.rows ?? [],
      sorumlu: new Map(Object.entries(d.sorumlu ?? {})),
    }
  }

  // geri düşüş (RPC kurulmadan önce): eski çok turlu yol
  const runId = await currentRunId(supabase)
  if (!runId) return { runId: null, rows: [], sorumlu: new Map() }
  const [rows, sorumlu] = await Promise.all([scopeInstallments(supabase, side), pazarlamaciByFirm(supabase)])
  return { runId, rows, sorumlu }
}
