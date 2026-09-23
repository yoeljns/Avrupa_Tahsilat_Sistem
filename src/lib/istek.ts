// Tarayıcıdan JSON POST: sunucunun Türkçe hata iletisini aynen döndürür.

export type IstekSonucu<T> = { ok: true; data: T } | { ok: false; error: string; status: number }

export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<IstekSonucu<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: (data as { error?: string } | null)?.error ?? 'İşlem başarısız.', status: res.status }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, error: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.', status: 0 }
  }
}
