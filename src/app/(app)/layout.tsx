import Nav from '@/components/Nav'
import { OturumSaglayici } from '@/components/Oturum'
import { ToastSaglayici } from '@/components/ui/Toast'
import { requireUser } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser()
  return (
    <OturumSaglayici rol={session.role} email={session.email}>
      <ToastSaglayici>
        <div className="min-h-screen">
          <Nav role={session.role} email={session.email} />
          <main className="mx-auto max-w-screen-2xl px-4 py-6">{children}</main>
        </div>
      </ToastSaglayici>
    </OturumSaglayici>
  )
}
