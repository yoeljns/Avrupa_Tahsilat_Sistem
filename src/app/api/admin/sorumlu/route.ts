import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 60

// Firmalara sorumlu (pazarlamacı) atama — dosya yüklemeden, panelden.
// Atama ve denetim kayıtları veritabanında TEK işlemde yazılır (0009: rpc_sorumlu_ata).
// Sorumlu yalnız görünürlüğü (pazarlamacının kapsamı) ve etiketleri etkiler;
// borç hesabına girmez → yeniden hesap gerekmez.

const Body = z.object({
  // guid(): 8-4-4-4-12 biçimi yeterli (Postgres'in kabul ettiği her uuid); sürüm/varyant denetimi yapılmaz
  firmIds: z.array(z.guid()).min(1).max(1000),
  /** null ya da boş → sorumlu kaldırılır */
  email: z.string().max(200).nullable(),
})

export async function POST(request: Request) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 })

  const email = (parsed.data.email ?? '').trim().toLowerCase()
  if (email && !z.string().email().safeParse(email).success) {
    return NextResponse.json({ error: 'E-posta adresi geçersiz. Örnek: ercan@avrupagroup.com' }, { status: 400 })
  }

  const admin = createAdminSupabase()
  const { data, error } = await admin.rpc('rpc_sorumlu_ata', {
    p_firm_ids: Array.from(new Set(parsed.data.firmIds)),
    p_email: email || null,
    p_actor_id: session.userId,
    p_actor_email: session.email,
  })
  if (error) {
    if (/rpc_sorumlu_ata/.test(error.message) && /Could not find|does not exist|PGRST202/i.test(`${error.message} ${(error as { code?: string }).code ?? ''}`)) {
      return NextResponse.json({ error: 'Veritabanı güncellemesi (0009) uygulanmamış.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Sorumlu atanamadı: ' + error.message }, { status: 500 })
  }

  // Bilgi: bu e-postayla aktif kullanıcı yoksa firmalar etiketlenir ama kimse "pazarlamacı" olarak göremez
  let kullaniciYok = false
  if (email) {
    const { data: profil } = await admin.from('profiles').select('id').ilike('email', email.replace(/[\\%_]/g, '\\$&')).eq('is_active', true).limit(1)
    kullaniciYok = !profil || profil.length === 0
  }

  return NextResponse.json({ ok: true, degisen: typeof data === 'number' ? data : 0, kullaniciYok })
}
