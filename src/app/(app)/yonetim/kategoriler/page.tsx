import { Tags } from 'lucide-react'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import KategoriPaneli from '@/components/yonetim/KategoriPaneli'
import PageHeader from '@/components/ui/PageHeader'
import { isAdminRole, requireRole } from '@/lib/auth'
import { kategoriYonetimi, type KategoriYonetimi } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function KategorilerPage() {
  const session = await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()

  let veri: KategoriYonetimi
  try {
    veri = await kategoriYonetimi(supabase)
  } catch (e) {
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Tags className="h-5 w-5" />}
        title="Satış Kategorileri"
        description="Her irsaliye bir satış kategorisine girer. Kategorinin davranışı borcun nasıl sayılacağını ve hangi sayfada görüneceğini belirler; ad, renk ve görünüm ayarları buradan yönetilir."
      />
      <KategoriPaneli kategoriler={veri.kategoriler} duzenleyebilir={isAdminRole(session.role)} />
    </div>
  )
}
