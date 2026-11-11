import RaporMerkezi from '@/components/raporlar/RaporMerkezi'
import { isStaffRole, requireUser } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { addMonths, todayISO, trMonth } from '@/lib/format'
import { veriTazeligi } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// RAPORLAR — bütün indirmeler tek yerde: PDF tahsilat durum raporu (üç tür),
// Vadeli Bakiyeler Excel'i, yönetimin Excel raporları ve iş akış prosedürü.
// Sayfa yalnız seçenekleri hazırlar; dosyalar düğmeye basılınca üretilir.
export default async function RaporlarPage() {
  const session = await requireUser()
  const staff = isStaffRole(session.role)
  const supabase = await createServerSupabase()
  const bugun = todayISO()

  const [firmalar, tazelik] = await Promise.all([
    // Sorumlu süzgeci yalnız tüm firmaları gören rollerde anlamlı
    staff
      ? fetchAll<{ pazarlamaci_email: string | null }>((from, to) => supabase.from('firms').select('pazarlamaci_email').order('id').range(from, to))
      : Promise.resolve([]),
    // 0009 yoksa tazelik satırı gösterilmez
    veriTazeligi(supabase).catch(() => null),
  ])

  // Tablolardaki SORUMLU adı: e-postanın @ öncesi, büyük harf (veritabanındaki kuralla aynı)
  const sorumlular = new Set<string>()
  let sorumlusuzVar = false
  for (const f of firmalar) {
    const ad = (f.pazarlamaci_email ?? '').split('@')[0].trim().toUpperCase()
    if (ad) sorumlular.add(ad)
    else sorumlusuzVar = true
  }

  const buAy = bugun.slice(0, 7)
  const aylar = Array.from({ length: 12 }, (_, i) => addMonths(buAy, -i)).map((ay) => ({ ay, ad: trMonth(ay) }))

  return (
    <RaporMerkezi
      staff={staff}
      sorumlular={Array.from(sorumlular).sort((a, b) => a.localeCompare(b, 'tr'))}
      sorumlusuzVar={sorumlusuzVar && sorumlular.size > 0}
      bugun={bugun}
      aylar={aylar}
      tazelik={tazelik}
    />
  )
}
