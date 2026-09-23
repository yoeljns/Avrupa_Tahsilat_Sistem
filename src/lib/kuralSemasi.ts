import { z } from 'zod'
import type { Kural } from '@/lib/engine/kurallar'

// Yönetim uçlarının ortak doğrulama şemaları (kategori ve tanıma kuralları).

export const KategoriKodu = z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Kod büyük harf, rakam ve _ içerebilir (2–30 karakter).')

export const KuralGirdisi = z.object({
  kategori_kod: KategoriKodu,
  alan: z.enum(['BELGE_NO', 'TURU']),
  islec: z.enum(['ICERIR', 'BASLAR', 'BITER', 'ESIT', 'REGEX']),
  deger: z.string().max(200),
  sonuc: z.enum(['ATA', 'ONER']),
  sira: z.number().int().min(0).max(100000),
  aktif: z.boolean(),
  aciklama: z.string().max(200).nullable().optional(),
})

export const KuralListesi = z.array(KuralGirdisi).max(200)

export function kuralaCevir(k: z.infer<typeof KuralGirdisi>): Kural {
  return { ...k, aciklama: k.aciklama?.trim() ? k.aciklama.trim() : null }
}
