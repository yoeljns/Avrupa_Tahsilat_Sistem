import UserAdmin, { type UserRow } from '@/components/UserAdmin'
import { requireRole } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function KullanicilarPage() {
  const session = await requireRole(['yonetici'])
  const supabase = await createServerSupabase()

  const users = await fetchAll<{ id: string; email: string; full_name: string | null; role: string; is_active: boolean }>(
    (from, to) => supabase.from('profiles').select('id, email, full_name, role, is_active').order('email').range(from, to),
  )

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    isActive: u.is_active,
  }))

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">Kullanıcılar</h1>
      <p className="mt-1 text-sm text-slate-500">
        Tahsilat Yöneticisi rolünü buradan istediğiniz kullanıcıya verebilirsiniz.
      </p>
      <div className="mt-4">
        <UserAdmin users={rows} selfId={session.userId} />
      </div>
    </div>
  )
}
