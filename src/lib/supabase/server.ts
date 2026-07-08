import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAnonKey, supabaseUrl } from '@/lib/env'

/**
 * Oturum çerezlerine bağlı Supabase istemcisi (server component / route handler).
 * Server component bağlamında çerez YAZILAMAZ; oturum yenileme middleware'de yapılır.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server component içinden çağrıldıysa yazma yok sayılır (middleware halleder).
        }
      },
    },
  })
}
