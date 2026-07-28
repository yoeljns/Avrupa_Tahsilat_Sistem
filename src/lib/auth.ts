import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'

export type Role = 'yonetici' | 'tahsilat_yoneticisi' | 'pazarlamaci'

export interface SessionProfile {
  userId: string
  email: string
  fullName: string | null
  role: Role
}

/** Staff = irsaliye düzenleme, içe aktarma ve dışa aktarma yetkisi olan roller. */
export function isStaffRole(role: Role): boolean {
  return role === 'yonetici' || role === 'tahsilat_yoneticisi'
}

/**
 * Oturum + aktif profil; yoksa null.
 *
 * HIZ (iki katman):
 *  1. cache(): aynı istek içinde tek kez çalışır — layout (requireUser) ve
 *     sayfanın kendisi ayrı ayrı çağırıyordu, maliyet ikiye katlanıyordu.
 *  2. rpc_oturum_profilim(): TEK ağ turu. Eskiden auth.getUser() (Supabase
 *     Auth SUNUCUSUNA ayrı tur) + profiles select (ikinci tur) yapılıyordu.
 * RPC kurulu değilse (migration uygulanmadıysa) eski yola düşer.
 */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const supabase = await createServerSupabase()

  const { data: rpc, error } = await supabase.rpc('rpc_oturum_profilim')
  if (!error) {
    const p = rpc as SessionProfile | null
    return p && p.userId ? p : null
  }

  // geri düşüş: klasik iki turlu yol
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !profile.is_active) return null
  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role as Role,
  }
})

/** Sayfalar için: oturum yoksa /login'e yollar. */
export async function requireUser(): Promise<SessionProfile> {
  const session = await getSessionProfile()
  if (!session) redirect('/login')
  return session
}

/** Sayfalar için: rol tutmuyorsa panoya yollar. */
export async function requireRole(roles: Role[]): Promise<SessionProfile> {
  const session = await requireUser()
  if (!roles.includes(session.role)) redirect('/')
  return session
}

/** API route handler'ları için: oturum/rol kontrolü; hata durumunda null (çağıran 401/403 döner). */
export async function apiSession(roles?: Role[]): Promise<SessionProfile | null> {
  const session = await getSessionProfile()
  if (!session) return null
  if (roles && !roles.includes(session.role)) return null
  return session
}
