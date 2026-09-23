import { normText } from '@/lib/engine/normalize'
import type { Kural } from '@/lib/engine/kurallar'

// Tanıma kuralları ekranının saf yardımcıları (sunucu + tarayıcı).

export interface TaninmayanSatir {
  belge_no_raw: string | null
  turu_raw: string | null
  amount_eur_cents: number | null
}

export interface BelgeKalibi {
  /** Rakam dizileri '#' ile değiştirilmiş, Türkçe harfleri katlanmış Belge No */
  kalip: string
  adet: number
  tutar: number
  /** Deneme kutusuna konabilecek gerçek bir örnek */
  ornek: string
  ornekTuru: string
}

/** "AVI0001234" → "AVI#", "12345" → "#", "Konsinye Peşin" → "KONSINYE PESIN", boş → "(boş)" */
export function belgeKalibi(belgeNo: string | null | undefined): string {
  const n = normText(belgeNo)
  if (!n) return '(boş)'
  return n.replace(/\d+/g, '#')
}

/** Tanınmayan irsaliyelerin Belge No kalıpları — en kalabalıktan başlayarak. */
export function belgeKaliplari(satirlar: readonly TaninmayanSatir[], limit = 12): BelgeKalibi[] {
  const g = new Map<string, BelgeKalibi>()
  for (const s of satirlar) {
    const kalip = belgeKalibi(s.belge_no_raw)
    let k = g.get(kalip)
    if (!k) g.set(kalip, (k = { kalip, adet: 0, tutar: 0, ornek: s.belge_no_raw ?? '', ornekTuru: s.turu_raw ?? '' }))
    k.adet++
    k.tutar += s.amount_eur_cents ?? 0
  }
  return Array.from(g.values())
    .sort((a, b) => b.adet - a.adet || b.tutar - a.tutar || a.kalip.localeCompare(b.kalip))
    .slice(0, limit)
}

/** Tanınmayan irsaliyelerin Türü dağılımı */
export function turuDagilimi(satirlar: readonly TaninmayanSatir[], limit = 8): Array<{ turu: string; adet: number; tutar: number }> {
  const g = new Map<string, { turu: string; adet: number; tutar: number }>()
  for (const s of satirlar) {
    const turu = (s.turu_raw ?? '').trim() || '(boş)'
    let k = g.get(turu)
    if (!k) g.set(turu, (k = { turu, adet: 0, tutar: 0 }))
    k.adet++
    k.tutar += s.amount_eur_cents ?? 0
  }
  return Array.from(g.values())
    .sort((a, b) => b.adet - a.adet || b.tutar - a.tutar)
    .slice(0, limit)
}

/**
 * Düzenleyicideki sıra → kayıt sırası. Atama kuralları 10, 20, 30…; öneri
 * kuralları 110, 120… (iki grup ayrı turda denenir; sıra yalnız grup içinde önemlidir).
 */
export function kurallariNumarala(ata: readonly Kural[], oner: readonly Kural[]): Kural[] {
  const sade = (k: Kural, sonuc: Kural['sonuc'], sira: number): Kural => ({
    kategori_kod: k.kategori_kod,
    alan: k.alan,
    islec: k.islec,
    deger: k.deger,
    sonuc,
    sira,
    aktif: k.aktif,
    aciklama: k.aciklama?.trim() ? k.aciklama.trim() : null,
  })
  return [...ata.map((k, i) => sade(k, 'ATA', (i + 1) * 10)), ...oner.map((k, i) => sade(k, 'ONER', 100 + (i + 1) * 10))]
}

/** İki kural listesi (numaralanmış) aynı mı? */
export function kurallarAyni(a: readonly Kural[], b: readonly Kural[]): boolean {
  if (a.length !== b.length) return false
  return a.every((k, i) => {
    const m = b[i]
    return (
      k.kategori_kod === m.kategori_kod &&
      k.alan === m.alan &&
      k.islec === m.islec &&
      k.deger === m.deger &&
      k.sonuc === m.sonuc &&
      k.sira === m.sira &&
      k.aktif === m.aktif &&
      (k.aciklama ?? null) === (m.aciklama ?? null)
    )
  })
}
