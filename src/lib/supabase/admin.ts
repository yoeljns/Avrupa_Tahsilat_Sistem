import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseServiceRoleKey, supabaseUrl } from '@/lib/env'

/**
 * Service-role istemcisi — RLS'i atlar. YALNIZ sunucu tarafında (route handler)
 * ve rol kontrolünden SONRA kullanılır. Tarayıcıya asla sızmaz.
 */
export function createAdminSupabase(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
