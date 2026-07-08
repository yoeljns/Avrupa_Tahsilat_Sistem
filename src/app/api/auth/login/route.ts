import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const Body = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
})

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'E-posta ve şifre gerekli.' }, { status: 400 })
  }

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.trim().toLowerCase(),
    password: parsed.data.password,
  })

  if (error) {
    return NextResponse.json({ error: 'E-posta veya şifre hatalı.' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
