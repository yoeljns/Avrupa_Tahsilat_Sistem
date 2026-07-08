import ExcludedAdmin, { type ExcludedRow } from '@/components/ExcludedAdmin'
import { requireRole } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function HaricFirmalarPage() {
  await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()

  const rows = await fetchAll<{ code_norm: string; note: string | null; added_by: string | null }>((from, to) =>
    supabase.from('excluded_firm_codes').select('code_norm, note, added_by').order('code_norm').range(from, to),
  )

  const mapped: ExcludedRow[] = rows.map((r) => ({ code: r.code_norm, note: r.note, addedBy: r.added_by }))

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">Takip Dışı Firmalar</h1>
      <p className="mt-1 text-sm text-slate-500">
        Bu listedeki firma kodlarının irsaliye ve ödemeleri içe aktarılır ama borç takibine, tahsise ve ekranlara{' '}
        <strong>hiç dahil edilmez</strong>. Eşleşme Türkçe karakter duyarsızdır (örn. listedeki &quot;54 C03&quot;,
        verideki &quot;54 Ç03&quot; ile eşleşir). Değişiklik sonrası mutabakat otomatik yeniden hesaplanır.
      </p>
      <div className="mt-4">
        <ExcludedAdmin rows={mapped} />
      </div>
    </div>
  )
}
