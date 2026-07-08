import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const Body = z.object({
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı.').max(200),
})

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Geçersiz şifre.' }, { status: 400 })
  }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Oturum bulunamadı.' }, { status: 401 })

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    return NextResponse.json({ error: 'Şifre güncellenemedi: ' + error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
