import YonetimMenu from '@/components/yonetim/YonetimMenu'
import { isAdminRole, isSahip, requireRole } from '@/lib/auth'

// Yönetim paneli iskeleti: solda menü, sağda sayfa. Yetki: Yönetici + Tahsilat Yöneticisi
// (Tahsilat Yöneticisi ayarları görür ama değiştiremez; her sayfa kendi yetkisini ayrıca denetler).

export default async function YonetimLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  return (
    <div className="gap-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside>
        <YonetimMenu yonetici={isAdminRole(session.role)} sahip={isSahip(session.email)} />
      </aside>
      <div className="mt-5 min-w-0 lg:mt-0">{children}</div>
    </div>
  )
}
