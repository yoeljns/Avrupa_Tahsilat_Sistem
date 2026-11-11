// Tarayıcıda dosya indirme: doğrudan bağlantı yerine fetch → blob.
// Sunucu hata dönerse (yetki, eksik göç, zaman aşımı) kullanıcı ham JSON
// sayfası yerine Türkçe bir bildirim görür.

export type IndirmeSonucu = { ok: true; dosyaAdi: string } | { ok: false; error: string; status: number }

/** Content-Disposition başlığından dosya adı (filename*=UTF-8''… ya da filename="…") */
export function dosyaAdiCoz(baslik: string | null, yedek: string): string {
  if (!baslik) return yedek
  const yildizli = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(baslik)
  if (yildizli) {
    try {
      return decodeURIComponent(yildizli[1].trim())
    } catch {
      /* düz ada düş */
    }
  }
  const duz = /filename\s*=\s*"([^"]+)"/.exec(baslik) ?? /filename\s*=\s*([^;]+)/.exec(baslik)
  return duz ? duz[1].trim() : yedek
}

export async function dosyaIndir(url: string, yedekAd: string): Promise<IndirmeSonucu> {
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch {
    return { ok: false, error: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.', status: 0 }
  }
  if (!res.ok) {
    const veri = (await res.json().catch(() => null)) as { error?: string } | null
    return { ok: false, error: veri?.error ?? `Dosya indirilemedi (${res.status}).`, status: res.status }
  }
  const dosyaAdi = dosyaAdiCoz(res.headers.get('Content-Disposition'), yedekAd)
  const blob = await res.blob()
  const adres = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = adres
  a.download = dosyaAdi
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Bazı tarayıcılar indirme başlamadan adresi geri alınca dosyayı keser
  setTimeout(() => URL.revokeObjectURL(adres), 10_000)
  return { ok: true, dosyaAdi }
}
