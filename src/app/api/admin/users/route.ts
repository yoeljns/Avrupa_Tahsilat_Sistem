import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { apiSession } from '@/lib/auth'
import { writeAudit } from '@/lib/db'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

// Kullanıcı yönetimi — yalnız YÖNETİCİ.
// Tahsilat Yöneticisi rolü de buradan atanır (yy@ panelden istediği kişiye verir).

function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const pick = (n: number) =>
    Array.from(randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join('')
  return `Tahsilat-${pick(4)}-${pick(4)}`
}

const CreateBody = z.object({
  action: z.literal('create'),
  email: z.string().email('Geçerli bir e-posta girin.'),
  fullName: z.string().max(120).optional(),
  role: z.enum(['yonetici', 'tahsilat_yoneticisi', 'pazarlamaci']),
})

const UpdateBody = z.object({
  action: z.literal('update'),
  userId: z.string().uuid(),
  role: z.enum(['yonetici', 'tahsilat_yoneticisi', 'pazarlamaci']).optional(),
  isActive: z.boolean().optional(),
  resetPassword: z.boolean().optional(),
})

const Body = z.discriminatedUnion('action', [CreateBody, UpdateBody])

export async function POST(request: Request) {
  const session = await apiSession(['yonetici'])
  if (!session) return NextResponse.json({ error: 'Bu işlem yalnız yönetici tarafından yapılabilir.' }, { status: 403 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Geçersiz istek.' }, { status: 400 })
  }
  const body = parsed.data
  const admin = createAdminSupabase()

  if (body.action === 'create') {
    const email = body.email.trim().toLowerCase()
    const password = tempPassword()
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error || !created.data.user) {
      return NextResponse.json({ error: 'Kullanıcı oluşturulamadı: ' + created.error?.message }, { status: 400 })
    }
    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id: created.data.user.id,
        email,
        full_name: body.fullName ?? null,
        role: body.role,
        is_active: true,
      },
      { onConflict: 'id' },
    )
    if (profileError) {
      return NextResponse.json({ error: 'Profil yazılamadı: ' + profileError.message }, { status: 500 })
    }
    await writeAudit(admin, [
      {
        actorEmail: session.email,
        entityType: 'kullanici',
        entityId: email,
        action: 'KULLANICI_OLUSTURMA',
        newValue: { role: body.role },
      },
    ])
    return NextResponse.json({ ok: true, tempPassword: password })
  }

  // update
  const { data: target } = await admin.from('profiles').select('id, email, role, is_active').eq('id', body.userId).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Kullanıcı bulunamadı.' }, { status: 404 })
  if (target.id === session.userId && (body.isActive === false || (body.role && body.role !== 'yonetici'))) {
    return NextResponse.json({ error: 'Kendi yönetici hesabınızı pasifleştiremez veya rolünüzü düşüremezsiniz.' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  const audits: Array<{ action: string; field?: string; oldValue?: unknown; newValue?: unknown }> = []
  if (body.role && body.role !== target.role) {
    updates.role = body.role
    audits.push({ action: 'ROL_DEGISIKLIGI', field: 'rol', oldValue: target.role, newValue: body.role })
  }
  if (body.isActive !== undefined && body.isActive !== target.is_active) {
    updates.is_active = body.isActive
    audits.push({ action: body.isActive ? 'AKTIFLESTIRME' : 'PASIFLESTIRME', field: 'aktif', oldValue: target.is_active, newValue: body.isActive })
  }

  let newPassword: string | undefined
  if (body.resetPassword) {
    newPassword = tempPassword()
    const upd = await admin.auth.admin.updateUserById(body.userId, { password: newPassword })
    if (upd.error) return NextResponse.json({ error: 'Şifre sıfırlanamadı: ' + upd.error.message }, { status: 500 })
    audits.push({ action: 'SIFRE_SIFIRLAMA' })
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from('profiles').update(updates).eq('id', body.userId)
    if (error) return NextResponse.json({ error: 'Güncellenemedi: ' + error.message }, { status: 500 })
  }
  if (audits.length === 0) return NextResponse.json({ error: 'Değişiklik yok.' }, { status: 400 })

  await writeAudit(
    admin,
    audits.map((a) => ({ ...a, actorEmail: session.email, entityType: 'kullanici', entityId: target.email })),
  )
  return NextResponse.json({ ok: true, tempPassword: newPassword })
}
