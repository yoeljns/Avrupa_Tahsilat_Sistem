import type { Side } from '@/lib/engine/types'
import { SALE_TYPE_LABELS } from '@/lib/format'

// Satış kategorileri — etiket, renk, DAVRANIŞ ve görünüm ayarları. Saf modül
// (sunucu + tarayıcı). Veri kaynağı: sale_categories (0007); tablo henüz
// yoksa aşağıdaki varsayılanlar kullanılır (bugünkü sabit davranış).

export type Taraf = Side | null

export interface KategoriMeta {
  kod: string
  ad: string
  kisa_ad: string | null
  renk: string
  /** PESIN = "Peşin gibi", VADELI = "Vadeli gibi", null = hesaba katılmaz (OTHER: sınıflandırılmadı) */
  taraf: Taraf
  sira: number
  aktif: boolean
  sistem: boolean
  sayfada_suzgec: boolean
  panoda_kart: boolean
  aciklama?: string | null
}

export const SINIFSIZ_KOD = 'OTHER'

export const VARSAYILAN_KATEGORILER: readonly KategoriMeta[] = [
  { kod: 'PESIN', ad: 'Peşin', kisa_ad: 'Peşin', renk: 'lacivert', taraf: 'PESIN', sira: 10, aktif: true, sistem: true, sayfada_suzgec: true, panoda_kart: false },
  { kod: 'KONSINYE', ad: 'Konsinye', kisa_ad: 'Konsinye', renk: 'mavi', taraf: 'VADELI', sira: 20, aktif: true, sistem: true, sayfada_suzgec: true, panoda_kart: false },
  { kod: 'KONSINYE_PESIN', ad: 'Konsinye Peşin', kisa_ad: 'K. Peşin', renk: 'camgobegi', taraf: 'VADELI', sira: 30, aktif: true, sistem: true, sayfada_suzgec: true, panoda_kart: false },
  { kod: 'OTHER', ad: 'Sınıflandırılmadı', kisa_ad: 'Sınıfsız', renk: 'gri', taraf: null, sira: 999, aktif: true, sistem: true, sayfada_suzgec: false, panoda_kart: false },
]

export type DavranisAnahtari = 'PESIN' | 'VADELI' | 'YOK'

export const DAVRANISLAR: Record<DavranisAnahtari, { ad: string; kisa: string; aciklama: string; sayfa: string | null }> = {
  PESIN: {
    ad: 'Peşin gibi',
    kisa: 'Peşin',
    aciklama: 'Ödemeler önce bunları kapatır (en eskiden). Vade = irsaliye tarihi ya da plan.',
    sayfa: 'Peşin sayfası',
  },
  VADELI: {
    ad: 'Vadeli gibi',
    kisa: 'Vadeli',
    aciklama: 'Ödeme planına göre taksitlenir; ödemeler peşinlerden sonra en yakın vadeden kapatır.',
    sayfa: 'Konsinye sayfası',
  },
  YOK: {
    ad: 'Hesaba katılmaz',
    kisa: 'Hesap dışı',
    aciklama: 'Borç sayılmaz, tahsise girmez; firma kartında bilgi olarak listelenir (ör. stok çıkışı, numune).',
    sayfa: null,
  },
}

export function davranisOf(taraf: Taraf): DavranisAnahtari {
  return taraf === 'PESIN' ? 'PESIN' : taraf === 'VADELI' ? 'VADELI' : 'YOK'
}

export function kategoriBul(meta: readonly KategoriMeta[] | undefined, kod: string | null | undefined): KategoriMeta | undefined {
  if (!kod) return undefined
  return (meta ?? VARSAYILAN_KATEGORILER).find((k) => k.kod === kod)
}

/** Kod → görünen ad (bilinmeyen kod: SALE_TYPE_LABELS, yoksa kodun kendisi) */
export function kategoriEtiketi(meta: readonly KategoriMeta[] | undefined, kod: string | null | undefined): string {
  if (!kod) return '—'
  return kategoriBul(meta, kod)?.ad ?? SALE_TYPE_LABELS[kod] ?? kod
}

/**
 * Atama seçenekleri (İnceleme, irsaliye düzenleme): aktif ve "sınıflandırılmadı"
 * olmayanlar, sıra ile. `mevcut` pasif olsa da listede kalır (görüntülenebilsin).
 */
export function atanabilirKategoriler(meta: readonly KategoriMeta[] | undefined, mevcut?: string | null): KategoriMeta[] {
  const liste = (meta ?? VARSAYILAN_KATEGORILER).filter((k) => k.kod !== SINIFSIZ_KOD && (k.aktif || k.kod === mevcut))
  return liste.slice().sort((a, b) => a.sira - b.sira || a.kod.localeCompare(b.kod))
}

/** Kod → davranış (taraf). Bilinmeyen kod: null (hesaba katılmaz). */
export function tarafHaritasi(meta: readonly KategoriMeta[] | undefined): Map<string, Taraf> {
  return new Map((meta ?? VARSAYILAN_KATEGORILER).map((k) => [k.kod, k.taraf]))
}

/** Başlıktan kategori kodu önerisi: 'Proje Satışı' → 'PROJE_SATISI' */
export function kodOnerisi(ad: string): string {
  const harita: Record<string, string> = { Ç: 'C', Ğ: 'G', İ: 'I', I: 'I', Ö: 'O', Ş: 'S', Ü: 'U', ç: 'C', ğ: 'G', ı: 'I', i: 'I', ö: 'O', ş: 'S', ü: 'U' }
  const donusmus = Array.from(ad)
    .map((c) => harita[c] ?? c.toUpperCase())
    .join('')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const temiz = /^[A-Z]/.test(donusmus) ? donusmus : 'K_' + donusmus
  return temiz.slice(0, 30).replace(/_+$/g, '')
}

/** Bir davranıştaki (aktif) kategorilerin adları: 'Konsinye + Konsinye Peşin' */
export function tarafAdlari(meta: readonly KategoriMeta[] | undefined, taraf: 'PESIN' | 'VADELI'): string {
  return (meta ?? VARSAYILAN_KATEGORILER)
    .filter((k) => k.taraf === taraf && k.aktif)
    .slice()
    .sort((a, b) => a.sira - b.sira)
    .map((k) => k.ad)
    .join(' + ')
}
