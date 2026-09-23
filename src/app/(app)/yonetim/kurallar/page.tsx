import { ListChecks } from 'lucide-react'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import KuralEditoru from '@/components/yonetim/KuralEditoru'
import PageHeader from '@/components/ui/PageHeader'
import { isAdminRole, requireRole } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { belgeKaliplari, turuDagilimi, type TaninmayanSatir } from '@/lib/kuralYardimcilari'
import { kategoriYonetimi, type KategoriYonetimi } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface TaninmayanHam extends TaninmayanSatir {
  is_excluded_firm: boolean
  excluded_override: boolean | null
}

export default async function KurallarPage({ searchParams }: { searchParams: Promise<{ yeni?: string }> }) {
  const session = await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()
  const { yeni } = await searchParams

  let veri: KategoriYonetimi
  let taninmayan: TaninmayanHam[]
  try {
    ;[veri, taninmayan] = await Promise.all([
      kategoriYonetimi(supabase),
      // Borç hesabına girmeyen (sınıflandırılmamış) irsaliyeler — kural yazmaya yardımcı olsun diye
      fetchAll<TaninmayanHam>((from, to) =>
        supabase
          .from('v_invoices_effective')
          .select('belge_no_raw, turu_raw, amount_eur_cents, is_excluded_firm, excluded_override')
          .eq('sale_type', 'OTHER')
          .eq('is_31_12', false)
          .eq('is_cancelled', false)
          .eq('is_iade', false)
          .order('id')
          .range(from, to),
      ),
    ])
  } catch (e) {
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }
  const takipteki = taninmayan.filter((t) => !(t.excluded_override ?? t.is_excluded_firm))

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ListChecks className="h-5 w-5" />}
        title="Tanıma Kuralları"
        description="İçe aktarılan her irsaliyenin kategorisi Belge No ve Türü kolonlarına bakan bu kurallarla belirlenir. Değişiklik kaydedilince mevcut irsaliyeler de yeni kurallarla yeniden sınıflandırılır — önce etkisini görürsünüz. Elle seçilmiş kategoriler asla değişmez."
      />
      <KuralEditoru
        key={veri.kurallar.map((k) => k.id).join(',')}
        kurallar={veri.kurallar}
        kategoriler={veri.kategoriler}
        duzenleyebilir={isAdminRole(session.role)}
        yeniKategori={yeni}
        kaliplar={belgeKaliplari(takipteki)}
        turuler={turuDagilimi(takipteki)}
        taninmayanAdet={takipteki.length}
        taninmayanTutar={takipteki.reduce((t, s) => t + (s.amount_eur_cents ?? 0), 0)}
      />
    </div>
  )
}
