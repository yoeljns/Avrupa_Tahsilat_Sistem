import type { HucreDurumu } from '@/lib/takvim'

// Takvim hücrelerinin BUGÜNE göre renkleri — tabloda, mobil kartlarda ve
// lejantta aynı sınıflar kullanılır (Tailwind tam sınıf adlarını görmeli).
export const DURUM_HUCRE: Record<HucreDurumu, string> = {
  odendi: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100 hover:bg-emerald-100',
  gecikti: 'bg-red-50 text-red-700 font-semibold ring-1 ring-inset ring-red-200 hover:bg-red-100',
  yakin: 'bg-amber-50 text-amber-800 font-medium ring-1 ring-inset ring-amber-200 hover:bg-amber-100',
  ileri: 'text-slate-700 hover:bg-slate-100',
}

/** Excel düzeninde KALAN sütununun yazı rengi */
export const DURUM_KALAN_YAZI: Record<HucreDurumu, string> = {
  odendi: 'text-emerald-700',
  gecikti: 'text-red-700 font-semibold',
  yakin: 'text-amber-700 font-medium',
  ileri: 'text-slate-800',
}

export const DURUM_ETIKET: Record<HucreDurumu, string> = {
  odendi: 'Ödendi',
  gecikti: 'Vadesi geçti',
  yakin: '7 gün içinde',
  ileri: 'İleri tarih',
}

export const DURUM_NOKTA: Record<HucreDurumu, string> = {
  odendi: 'bg-emerald-500',
  gecikti: 'bg-red-500',
  yakin: 'bg-amber-400',
  ileri: 'bg-slate-300',
}
