import { redirect } from 'next/navigation'
import ResetDataPanel from '@/components/ResetDataPanel'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Veri sıfırlama — YALNIZ yy@avrupagroup.com erişebilir.

export default async function SifirlamaPage() {
  const session = await requireRole(['yonetici'])
  if (session.email.toLowerCase() !== 'yy@avrupagroup.com') redirect('/yonetim')

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">Veri Sıfırlama</h1>
      <p className="mt-1 text-sm text-slate-500">
        Sistemi temiz bir başlangıca döndürür. Bu sayfayı yalnız siz (yy@avrupagroup.com) görebilir ve
        çalıştırabilirsiniz.
      </p>
      <div className="mt-4">
        <ResetDataPanel />
      </div>
    </div>
  )
}
