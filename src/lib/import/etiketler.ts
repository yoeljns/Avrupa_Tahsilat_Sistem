// İÇE AKTARMA İSTATİSTİKLERİ — okunur Türkçe özet (saf).
// import_batches.stats içinde hem önizleme sayıları (new, needs_review, …) hem
// aktarım sonuçları (inserted, firmsCreated, …) hem de iç anahtarlar (kural_imzasi)
// durur. Ekranda yalnız kullanıcıya anlam ifade edenler, Türkçe adlarıyla gösterilir.

/** Gösterim sırası ve adları. Listede olmayan anahtar (iç kullanım) gösterilmez. */
const ETIKETLER: ReadonlyArray<readonly [anahtar: string, ad: string]> = [
  ['inserted', 'yeni'],
  ['new', 'yeni'],
  ['updated', 'güncellenen'],
  ['unchanged', 'değişmeyen'],
  ['needs_review', 'inceleme bekleyen'],
  ['conflicts', 'çakışma'],
  ['tip_degisecek', 'kategorisi değişen'],
  ['excluded_31_12', '31/12 hariç'],
  ['invalid', 'geçersiz satır'],
  ['firmsCreated', 'yeni firma'],
  ['installments', 'taksit'],
]

const sayi = new Intl.NumberFormat('tr-TR')

/**
 * "780 yeni · 40 güncellenen · 1.977 değişmeyen" — sıfırlar ve iç anahtarlar atlanır.
 * Aktarım sonucu ("inserted") varsa önizlemedeki "new" yinelenmez. Gösterilecek bir şey
 * yoksa boş metin döner.
 */
export function aktarimOzeti(stats: Record<string, unknown> | null | undefined): string {
  if (!stats) return ''
  const parcalar: string[] = []
  for (const [anahtar, ad] of ETIKETLER) {
    if (anahtar === 'new' && typeof stats.inserted === 'number') continue
    const v = stats[anahtar]
    if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue
    parcalar.push(`${sayi.format(v)} ${ad}`)
  }
  return parcalar.join(' · ')
}
