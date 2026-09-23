import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { VARSAYILAN_KURALLAR, type Kural } from '@/lib/engine/kurallar'
import { VARSAYILAN_KATEGORILER, type KategoriMeta } from '@/lib/kategoriMeta'

// Sunucu: kategori ve tanıma kurallarını veritabanından okur (sale_categories /
// sale_category_rules, 0007). Tablo yoksa (göç henüz uygulanmadıysa) bugünkü
// sabit davranışa düşer — uygulama göçten önce de çalışmaya devam eder.

function tabloYok(e: { message?: string; code?: string } | null): boolean {
  if (!e) return false
  const m = e.message ?? ''
  return e.code === '42P01' || e.code === 'PGRST205' || /does not exist|Could not find the table/i.test(m)
}

export async function kategorileriYukle(db: SupabaseClient): Promise<KategoriMeta[]> {
  const { data, error } = await db
    .from('sale_categories')
    .select('kod, ad, kisa_ad, renk, taraf, sira, aktif, sistem, sayfada_suzgec, panoda_kart, aciklama')
    .order('sira')
    .order('kod')
  if (error) {
    if (tabloYok(error)) return [...VARSAYILAN_KATEGORILER]
    throw new Error('Kategoriler okunamadı: ' + error.message)
  }
  return (data ?? []) as KategoriMeta[]
}

export async function kurallariYukle(db: SupabaseClient): Promise<Kural[]> {
  const { data, error } = await db
    .from('sale_category_rules')
    .select('id, kategori_kod, alan, islec, deger, sonuc, sira, aktif, aciklama')
    .order('sonuc')
    .order('sira')
    .order('id')
  if (error) {
    if (tabloYok(error)) return [...VARSAYILAN_KURALLAR]
    throw new Error('Tanıma kuralları okunamadı: ' + error.message)
  }
  return (data ?? []) as Kural[]
}

/** Aktif kategori kodları (pasif kategoriyi hedefleyen kurallar atlanır) */
export function gecerliKodlar(kategoriler: readonly KategoriMeta[]): Set<string> {
  return new Set(kategoriler.filter((k) => k.aktif).map((k) => k.kod))
}

/**
 * Sınıflandırmayı etkileyen her şeyin parmak izi (aktif kurallar + aktif
 * kategoriler + davranışları). İçe aktarma önizlemesinde saklanır; uygulama
 * anında farklıysa önizleme bayatlamıştır (kural değişti) → yeniden önizleme.
 */
export function kuralImzasi(kurallar: readonly Kural[], kategoriler: readonly KategoriMeta[]): string {
  const k = kurallar
    .filter((r) => r.aktif)
    .map((r) => [r.sonuc, r.sira, r.kategori_kod, r.alan, r.islec, r.deger, r.aciklama ?? ''].join('\u0001'))
    .sort()
  const kat = kategoriler
    .filter((c) => c.aktif)
    .map((c) => `${c.kod}:${c.taraf ?? '-'}`)
    .sort()
  return createHash('md5').update(JSON.stringify({ k, kat })).digest('hex')
}

/** İçe aktarma uygulanırken kurallar önizlemeden sonra değiştiyse */
export class KuralDegistiHatasi extends Error {
  constructor() {
    super('Tanıma kuralları ya da kategoriler bu önizlemeden sonra değişti. Dosyayı yeniden yükleyip önizleyin.')
    this.name = 'KuralDegistiHatasi'
  }
}
