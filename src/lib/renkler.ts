// Kategori renk paleti — Tailwind sınıfları TAM yazılır (derleyici dinamik
// birleştirmeyi göremez). Kırmızı / yeşil / sarı / mor bilinçli olarak YOK:
// bunlar sistemde "gecikmiş / ödendi / uyarı / KDV-iade" anlamı taşır.

export interface Renk {
  ad: string
  rozet: string
  nokta: string
  kenar: string
}

export const RENK_PALETI = {
  mavi: { ad: 'Mavi', rozet: 'bg-blue-50 text-blue-700 ring-blue-200', nokta: 'bg-blue-500', kenar: 'border-l-blue-500' },
  lacivert: { ad: 'Lacivert', rozet: 'bg-indigo-50 text-indigo-700 ring-indigo-200', nokta: 'bg-indigo-500', kenar: 'border-l-indigo-500' },
  gok: { ad: 'Gök', rozet: 'bg-sky-50 text-sky-700 ring-sky-200', nokta: 'bg-sky-500', kenar: 'border-l-sky-500' },
  camgobegi: { ad: 'Camgöbeği', rozet: 'bg-cyan-50 text-cyan-700 ring-cyan-200', nokta: 'bg-cyan-500', kenar: 'border-l-cyan-500' },
  turkuaz: { ad: 'Turkuaz', rozet: 'bg-teal-50 text-teal-700 ring-teal-200', nokta: 'bg-teal-500', kenar: 'border-l-teal-500' },
  pembe: { ad: 'Pembe', rozet: 'bg-pink-50 text-pink-700 ring-pink-200', nokta: 'bg-pink-500', kenar: 'border-l-pink-500' },
  fusya: { ad: 'Fuşya', rozet: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200', nokta: 'bg-fuchsia-500', kenar: 'border-l-fuchsia-500' },
  kahve: { ad: 'Kahve', rozet: 'bg-stone-100 text-stone-700 ring-stone-300', nokta: 'bg-stone-500', kenar: 'border-l-stone-500' },
  gri: { ad: 'Gri', rozet: 'bg-slate-100 text-slate-700 ring-slate-200', nokta: 'bg-slate-400', kenar: 'border-l-slate-400' },
} as const satisfies Record<string, Renk>

export type RenkAnahtari = keyof typeof RENK_PALETI

export const RENK_ANAHTARLARI = Object.keys(RENK_PALETI) as RenkAnahtari[]

export function renkOf(anahtar: string | null | undefined): Renk {
  return (anahtar && anahtar in RENK_PALETI ? RENK_PALETI[anahtar as RenkAnahtari] : RENK_PALETI.gri) as Renk
}
