import { redirect } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import ResetDataPanel from '@/components/ResetDataPanel'
import PageHeader from '@/components/ui/PageHeader'
import { SAHIP_EPOSTA, isSahip, requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Veri sıfırlama — YALNIZ sistemin sahibi (SAHIP_EPOSTA) erişebilir.

export default async function SifirlamaPage() {
  const session = await requireRole(['yonetici'])
  if (!isSahip(session.email)) redirect('/yonetim')

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<TriangleAlert className="h-5 w-5" />}
        title="Veri Sıfırlama"
        description={`Sistemi temiz bir başlangıca döndürür. Bu sayfayı yalnız siz (${SAHIP_EPOSTA}) görebilir ve çalıştırabilirsiniz.`}
      />
      <ResetDataPanel />
    </div>
  )
}
