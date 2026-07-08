import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/db'

// Okuma sayfalarının ortak sorguları. Kullanıcı oturumlu istemciyle çağrılır —
// RLS sayesinde pazarlamacı yalnız kendi firmalarının verisini görür.

export async function currentRunId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from('v_current_run').select('run_id').maybeSingle()
  return (data?.run_id as string | undefined) ?? null
}

export interface BalanceRow {
  firm_id: string
  side: 'PESIN' | 'VADELI'
  open_debt_eur_cents: number
  overdue_eur_cents: number
  credit_eur_cents: number
  next_due_date: string | null
  total_debt_eur_cents: number
  total_paid_eur_cents: number
}

export async function balancesAtRun(supabase: SupabaseClient, runId: string): Promise<BalanceRow[]> {
  return fetchAll<BalanceRow>((from, to) =>
    supabase
      .from('firm_side_balances')
      .select('firm_id, side, open_debt_eur_cents, overdue_eur_cents, credit_eur_cents, next_due_date, total_debt_eur_cents, total_paid_eur_cents')
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

export interface OpenInstallmentRow {
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
  no_date_flag: boolean
  source: string
}

export async function openInstallments(supabase: SupabaseClient, side?: 'PESIN' | 'VADELI'): Promise<OpenInstallmentRow[]> {
  return fetchAll<OpenInstallmentRow>((from, to) => {
    let q = supabase
      .from('v_open_installments')
      .select('installment_id, invoice_id, firm_id, firm_code, firm_name, side, seq, due_date, invoice_date, fis_no, amount_eur_cents, remaining_eur_cents, no_date_flag, source')
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
