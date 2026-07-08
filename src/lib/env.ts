// Ortam değişkeni çözümü.
// Vercel'in Supabase entegrasyonu sürüme göre farklı adlar enjekte edebildiği
// için her değer için yedekli adlar denenir. Tüm Supabase erişimi sunucu
// tarafında olduğundan NEXT_PUBLIC_ öneki zorunlu değildir.

function firstEnv(names: string[]): string | null {
  for (const n of names) {
    const v = process.env[n]
    if (v && v.trim()) return v.trim()
  }
  return null
}

function requireEnv(names: string[], hint: string): string {
  const v = firstEnv(names)
  if (!v) {
    throw new Error(
      `Eksik ortam değişkeni: ${names.join(' veya ')}. ${hint} ` +
        `(Vercel > Project > Settings > Environment Variables bölümünü kontrol edin, sonra Redeploy yapın.)`,
    )
  }
  return v
}

export function supabaseUrl(): string {
  return requireEnv(
    ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'],
    'Supabase proje URL’i gerekli.',
  )
}

export function supabaseAnonKey(): string {
  return requireEnv(
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
    'Supabase anon (public) anahtarı gerekli.',
  )
}

export function supabaseServiceRoleKey(): string {
  return requireEnv(
    ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'],
    'Supabase service role anahtarı gerekli (Dashboard > Project Settings > API).',
  )
}

export function setupSecret(): string | null {
  return firstEnv(['SETUP_SECRET'])
}
