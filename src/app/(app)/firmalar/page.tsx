import FirmaTablosu from '@/components/firmalar/FirmaTablosu'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import { requireUser } from '@/lib/auth'
import { firmaListesi, type FirmaListeSatiri } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function FirmalarPage() {
  const [session, supabase] = await Promise.all([requireUser(), createServerSupabase()])

  // TEK ağ turu: firmalar + bakiyeler + canlı gecikme (takip dışılar veritabanında elenir)
  let firmalar: FirmaListeSatiri[]
  try {
    firmalar = await firmaListesi(supabase)
  } catch (e) {
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">Firmalar</h1>
      <p className="mt-1 text-sm text-slate-500">Firmaların açık borcu, vadesi geçmiş borcu ve alacağı. Firma kartını açmak için koda ya da ada tıklayın.</p>
      {/* Arama, süzme ve sıralama tarayıcıda; pazarlamacı zaten yalnız kendi firmalarını görür */}
      <FirmaTablosu firmalar={firmalar} sorumluSuzgeci={session.role !== 'pazarlamaci'} />
    </div>
  )
}
