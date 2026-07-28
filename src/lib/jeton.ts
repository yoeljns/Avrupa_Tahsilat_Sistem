/**
 * jeton.ts — Oturum çerezinden erişim jetonunun bitiş anını YERELDE okur.
 * Saf fonksiyon: ağ yok, Next bağımlılığı yok (bu yüzden test edilebilir).
 *
 * Neden: middleware HER istekte (sayfa, RSC, statik olmayan her şey)
 * supabase.auth.getUser() çağırıyordu; bu, Supabase Auth SUNUCUSUNA sabit bir
 * ağ turu demek ve tüm gezinmeyi yavaşlatıyordu. Jeton hâlâ tazeyse o tura
 * gerek yok. Emin olunamayan HER durumda false döner — yani şüphede kalınca
 * normal (ağa çıkan, oturumu tazeleyen) yol koşar.
 */

export interface Cerez {
  name: string
  value: string
}

const CEREZ_DESENI = /^sb-.*-auth-token(\.\d+)?$/

export function oturumCerezleri(cerezler: Cerez[]): Cerez[] {
  return cerezler
    .filter((c) => CEREZ_DESENI.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/** Erişim jetonunun bitiş anı (ms); çözülemezse null. */
export function jetonBitisi(cerezler: Cerez[]): number | null {
  try {
    const parcalar = oturumCerezleri(cerezler)
    if (parcalar.length === 0) return null

    let ham = parcalar.map((c) => c.value).join('')
    if (ham.startsWith('base64-')) {
      ham = Buffer.from(ham.slice('base64-'.length), 'base64').toString('utf8')
    }
    const oturum = JSON.parse(ham) as { access_token?: string }
    const jwt = oturum.access_token
    if (!jwt) return null

    const govde = jwt.split('.')[1]
    if (!govde) return null
    const iddia = JSON.parse(Buffer.from(govde, 'base64').toString('utf8')) as { exp?: number }
    return typeof iddia.exp === 'number' ? iddia.exp * 1000 : null
  } catch {
    return null
  }
}

/** Jeton en az `payMs` süre daha geçerli mi? (varsayılan 120 sn pay) */
export function jetonTazeMi(cerezler: Cerez[], simdiMs: number, payMs = 120_000): boolean {
  const bitis = jetonBitisi(cerezler)
  return bitis !== null && bitis - simdiMs > payMs
}
