import { EyeOff } from 'lucide-react'
import ExcludedAdmin, { type ExcludedRow } from '@/components/ExcludedAdmin'
import PageHeader from '@/components/ui/PageHeader'
import { requireRole } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { foldTurkish } from '@/lib/engine/normalize'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function HaricFirmalarPage() {
  await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()

  const [rows, firmalar] = await Promise.all([
    fetchAll<{ code_norm: string; note: string | null; added_by: string | null }>((from, to) =>
      supabase.from('excluded_firm_codes').select('code_norm, note, added_by').order('code_norm').range(from, to),
    ),
    fetchAll<{ id: string; code_norm: string; name: string }>((from, to) => supabase.from('firms').select('id, code_norm, name').order('id').range(from, to)),
  ])

  // Eşleşme veritabanındakiyle aynı: iki taraf da Türkçe harf katlanarak (fold_tr)
  const katlanmis = new Map<string, Array<{ id: string; kod: string; ad: string }>>()
  for (const f of firmalar) {
    const k = foldTurkish(f.code_norm)
    const l = katlanmis.get(k) ?? []
    l.push({ id: f.id, kod: f.code_norm, ad: f.name })
    katlanmis.set(k, l)
  }

  const mapped: ExcludedRow[] = rows.map((r) => ({
    code: r.code_norm,
    note: r.note,
    addedBy: r.added_by,
    firmalar: katlanmis.get(foldTurkish(r.code_norm)) ?? [],
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<EyeOff className="h-5 w-5" />}
        title="Takip Dışı Firmalar"
        description={
          <>
            Bu listedeki kodların irsaliye ve ödemeleri içe aktarılır ama borç takibine, tahsise ve ekranlara <strong>hiç dahil edilmez</strong>.
            Eşleşme Türkçe harf duyarsızdır (listedeki “54 C03”, verideki “54 Ç03” ile eşleşir). Her değişiklikten sonra hesap kendiliğinden yenilenir.
          </>
        }
      />
      <ExcludedAdmin rows={mapped} />
    </div>
  )
}
