import { Users } from 'lucide-react'
import UserAdmin, { type UserRow } from '@/components/UserAdmin'
import PageHeader from '@/components/ui/PageHeader'
import { isSahip, requireRole } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function KullanicilarPage() {
  const session = await requireRole(['yonetici'])
  const supabase = await createServerSupabase()

  const [users, firmalar] = await Promise.all([
    fetchAll<{ id: string; email: string; full_name: string | null; role: string; is_active: boolean }>((from, to) =>
      supabase.from('profiles').select('id, email, full_name, role, is_active').order('email').range(from, to),
    ),
    fetchAll<{ pazarlamaci_email: string | null }>((from, to) => supabase.from('firms').select('pazarlamaci_email').order('id').range(from, to)),
  ])

  const firmaSayisi = new Map<string, number>()
  for (const f of firmalar) {
    const e = f.pazarlamaci_email?.trim().toLowerCase()
    if (e) firmaSayisi.set(e, (firmaSayisi.get(e) ?? 0) + 1)
  }

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    isActive: u.is_active,
    firmaSayisi: firmaSayisi.get(u.email.trim().toLowerCase()) ?? 0,
    sahip: isSahip(u.email),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Users className="h-5 w-5" />}
        title="Kullanıcılar"
        description="Hesap açın, rol verin, şifre sıfırlayın. Pazarlamacılar yalnız bayi listesinde kendi e-postalarına atanmış firmaları görür."
      />
      <UserAdmin users={rows} selfId={session.userId} sahipMi={isSahip(session.email)} />
    </div>
  )
}
