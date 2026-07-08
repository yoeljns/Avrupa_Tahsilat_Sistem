import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { setupSecret } from '@/lib/env'

export const runtime = 'nodejs'
export const maxDuration = 60

// Tek seferlik kurulum: başlangıç kullanıcılarını oluşturur.
// SETUP_SECRET ile korunur; kurulum tamamlandıysa ikinci kez çalışmaz.

const SEED_USERS: Array<{ email: string; role: 'yonetici' | 'pazarlamaci'; fullName: string }> = [
  { email: 'yy@avrupagroup.com', role: 'yonetici', fullName: 'Yönetici' },
  { email: 'vedat@avrupagroup.com', role: 'pazarlamaci', fullName: 'Vedat' },
  { email: 'ercan@avrupagroup.com', role: 'pazarlamaci', fullName: 'Ercan' },
  { email: 'enis@avrupagroup.com', role: 'pazarlamaci', fullName: 'Enis' },
  { email: 'mehmethan@avrupagroup.com', role: 'pazarlamaci', fullName: 'Mehmethan' },
  { email: 'levent@avrupagroup.com', role: 'pazarlamaci', fullName: 'Levent' },
]

function tempPassword(): string {
  // Okunaklı geçici şifre: Tahsilat-XXXX-XXXX (karışan karakterler yok)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const pick = (n: number) =>
    Array.from(randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join('')
  return `Tahsilat-${pick(4)}-${pick(4)}`
}

const Body = z.object({ secret: z.string().min(1) })

export async function POST(request: Request) {
  const expected = setupSecret()
  if (!expected) {
    return NextResponse.json(
      { error: "SETUP_SECRET ortam değişkeni tanımlı değil. Vercel > Settings > Environment Variables'a ekleyip yeniden deploy edin." },
      { status: 500 },
    )
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success || parsed.data.secret !== expected) {
    return NextResponse.json({ error: 'Kurulum anahtarı hatalı.' }, { status: 403 })
  }

  let admin
  try {
    admin = createAdminSupabase()
  } catch (e) {
    // Supabase env değişkenleri eksik — kullanıcıya hangi adımın atlandığını söyle
    return NextResponse.json(
      {
        error:
          (e instanceof Error ? e.message : 'Supabase yapılandırması eksik.') +
          ' Önce Vercel > Storage üzerinden Supabase bağlantısını kurun (README adım 2), sonra Redeploy yapın.',
      },
      { status: 500 },
    )
  }

  const { data: settings, error: settingsError } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'setup_completed')
    .maybeSingle()

  if (settingsError) {
    return NextResponse.json(
      { error: 'Veritabanına ulaşılamadı. Önce migration SQL dosyasını Supabase SQL Editor’de çalıştırdığınızdan emin olun. Detay: ' + settingsError.message },
      { status: 500 },
    )
  }
  if (settings?.value === true) {
    return NextResponse.json(
      { error: 'Kurulum daha önce tamamlanmış. Yeni kullanıcıları Yönetim > Kullanıcılar sayfasından ekleyebilirsiniz.' },
      { status: 409 },
    )
  }

  const results: Array<{ email: string; role: string; tempPassword: string }> = []

  for (const seed of SEED_USERS) {
    const password = tempPassword()
    const created = await admin.auth.admin.createUser({
      email: seed.email,
      password,
      email_confirm: true,
    })

    let userId = created.data.user?.id
    if (created.error) {
      // Kullanıcı zaten varsa (yarım kalan kurulum) şifresini yenile
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const existing = list?.users.find((u) => u.email?.toLowerCase() === seed.email)
      if (!existing) {
        return NextResponse.json(
          { error: `${seed.email} oluşturulamadı: ${created.error.message}` },
          { status: 500 },
        )
      }
      userId = existing.id
      const upd = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true })
      if (upd.error) {
        return NextResponse.json(
          { error: `${seed.email} şifresi güncellenemedi: ${upd.error.message}` },
          { status: 500 },
        )
      }
    }

    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id: userId!,
        email: seed.email,
        full_name: seed.fullName,
        role: seed.role,
        is_active: true,
      },
      { onConflict: 'id' },
    )
    if (profileError) {
      return NextResponse.json(
        { error: `${seed.email} profili yazılamadı: ${profileError.message}` },
        { status: 500 },
      )
    }

    results.push({ email: seed.email, role: seed.role, tempPassword: password })
  }

  await admin
    .from('app_settings')
    .upsert({ key: 'setup_completed', value: true, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  await admin.from('audit_log').insert({
    actor_email: 'kurulum',
    entity_type: 'sistem',
    entity_id: 'setup',
    action: 'KURULUM_TAMAMLANDI',
    new_value: { users: results.map((r) => r.email) },
  })

  return NextResponse.json({ ok: true, users: results })
}
