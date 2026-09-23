import { normText } from './normalize'
import type { ClassifyResult } from './types'

// Satış kategorisi TANIMA KURALLARI — saf (tarayıcıda da çalışır: panelde
// "Belge No yaz → hangi kategori?" deneme kutusu aynı işlevi kullanır).
//
// Kurallar sıralıdır. Önce ATA (ata) kuralları denenir; ilk eşleşen kategoriyi
// belirler. Hiçbiri eşleşmezse irsaliye "Sınıflandırılmadı" (OTHER) olur ve
// ilk eşleşen ONER (öner) kuralı İnceleme ekranında öneri olarak görünür.
// İade irsaliyesi (Türü'nde "İADE") her durumda incelemeye düşer — sabit kural.
//
// Eşleştirme Türkçe harf katlamalı BÜYÜK harfli metin üzerinde yapılır
// (İ→I, Ş→S, Ğ→G, Ü→U, Ö→O, Ç→C; boşluklar teklenir). REGEX değeri
// KATLANMAZ (katlamak \d'yi \D'ye çevirirdi); büyük/küçük harf duyarsız derlenir.

export type KuralAlani = 'BELGE_NO' | 'TURU'
export type KuralIsleci = 'ICERIR' | 'BASLAR' | 'BITER' | 'ESIT' | 'REGEX'
export type KuralSonucu = 'ATA' | 'ONER'

export interface Kural {
  id?: number
  kategori_kod: string
  alan: KuralAlani
  islec: KuralIsleci
  deger: string
  sonuc: KuralSonucu
  sira: number
  aktif: boolean
  aciklama: string | null
}

/** "Sınıflandırılmadı" kategorisinin kodu */
export const SINIFSIZ = 'OTHER'
export const IADE_NEDENI = 'İade irsaliyesi — kontrol edin'

export const ALAN_ETIKETLERI: Record<KuralAlani, string> = { BELGE_NO: 'Belge No', TURU: 'Türü' }
export const ISLEC_ETIKETLERI: Record<KuralIsleci, string> = {
  ICERIR: 'içerir',
  BASLAR: 'ile başlar',
  BITER: 'ile biter',
  ESIT: 'tam olarak',
  REGEX: 'düzenli ifade',
}
export const SONUC_ETIKETLERI: Record<KuralSonucu, string> = { ATA: 'Kategoriye ata', ONER: 'Yalnız öner (incelemede)' }

/** Bugünkü sabit kurallar — veritabanı tohumu (0007) ile birebir aynı. */
export const VARSAYILAN_KURALLAR: readonly Kural[] = [
  { kategori_kod: 'KONSINYE_PESIN', alan: 'BELGE_NO', islec: 'ICERIR', deger: 'KONSİNYE PEŞİN', sonuc: 'ATA', sira: 10, aktif: true, aciklama: 'Belge No: KONSİNYE PEŞİN' },
  { kategori_kod: 'KONSINYE', alan: 'BELGE_NO', islec: 'ICERIR', deger: 'KONSİNYE', sonuc: 'ATA', sira: 20, aktif: true, aciklama: 'Belge No: KONSİNYE' },
  { kategori_kod: 'PESIN', alan: 'BELGE_NO', islec: 'BASLAR', deger: '+', sonuc: 'ATA', sira: 30, aktif: true, aciklama: 'Belge No: + (peşin)' },
  { kategori_kod: 'PESIN', alan: 'BELGE_NO', islec: 'REGEX', deger: '^\\d+$', sonuc: 'ONER', sira: 110, aktif: true, aciklama: 'Belge No müşteri sipariş numarası görünüyor' },
  {
    kategori_kod: 'KONSINYE',
    alan: 'BELGE_NO',
    islec: 'REGEX',
    deger: 'AVI\\d+|REVIZE|IRS',
    sonuc: 'ONER',
    sira: 120,
    aktif: true,
    aciklama: 'Belge No başka bir irsaliyeye/revizyona atıf yapıyor',
  },
]

const REGEX_ONBELLEK = new Map<string, RegExp | null>()

/** Düzenli ifadeyi derler (önbellekli); geçersizse null. */
export function regexDerle(deger: string): RegExp | null {
  if (!REGEX_ONBELLEK.has(deger)) {
    let r: RegExp | null = null
    try {
      r = new RegExp(deger, 'i')
    } catch {
      r = null
    }
    if (REGEX_ONBELLEK.size > 500) REGEX_ONBELLEK.clear()
    REGEX_ONBELLEK.set(deger, r)
  }
  return REGEX_ONBELLEK.get(deger) ?? null
}

/** Kural, katlanmış Belge No / Türü metnine uyar mı? */
export function kuralEslesir(k: Kural, belgeNorm: string, turuNorm: string): boolean {
  const metin = k.alan === 'TURU' ? turuNorm : belgeNorm
  if (k.islec === 'REGEX') {
    const r = regexDerle(k.deger)
    return r ? r.test(metin) : false
  }
  const d = normText(k.deger)
  if (!d) return false
  switch (k.islec) {
    case 'ICERIR':
      return metin.includes(d)
    case 'BASLAR':
      return metin.startsWith(d)
    case 'BITER':
      return metin.endsWith(d)
    case 'ESIT':
      return metin === d
  }
}

/** İrsaliyenin "sınıflandırma gerekçesi" olarak yazılan metin. */
export function kuralNedeni(k: Kural): string {
  const a = k.aciklama?.trim()
  if (a) return a
  return `${ALAN_ETIKETLERI[k.alan]} ${ISLEC_ETIKETLERI[k.islec]}: ${k.deger}`
}

export interface SiniflandirmaSonucu extends ClassifyResult {
  /** Eşleşen kural (atayan ya da öneren); yoksa undefined */
  kural?: Kural
}

function siraliAktif(kurallar: readonly Kural[], gecerliKodlar?: ReadonlySet<string>): Kural[] {
  return kurallar
    .filter((k) => k.aktif && k.kategori_kod !== SINIFSIZ && (!gecerliKodlar || gecerliKodlar.has(k.kategori_kod)))
    .slice()
    .sort((a, b) => a.sira - b.sira || (a.id ?? 0) - (b.id ?? 0))
}

/**
 * Belge No + Türü → kategori. `gecerliKodlar` verilirse yalnız o kategorileri
 * hedefleyen kurallar dikkate alınır (pasif kategoriler atlanır).
 */
export function classifyWithRules(
  belgeNoRaw: string | null | undefined,
  turuRaw: string | null | undefined,
  kurallar: readonly Kural[],
  gecerliKodlar?: ReadonlySet<string>,
): SiniflandirmaSonucu {
  const belge = normText(belgeNoRaw)
  const turu = normText(turuRaw)
  const isIade = turu.includes('IADE')
  const sirali = siraliAktif(kurallar, gecerliKodlar)

  for (const k of sirali) {
    if (k.sonuc === 'ATA' && kuralEslesir(k, belge, turu)) {
      return { type: k.kategori_kod, needsReview: isIade, reason: isIade ? IADE_NEDENI : kuralNedeni(k), kural: k }
    }
  }

  // Sınıflandırılamadı: tahsise girmez, inceleme kuyruğunda öneriyle onay bekler
  for (const k of sirali) {
    if (k.sonuc === 'ONER' && kuralEslesir(k, belge, turu)) {
      return { type: SINIFSIZ, suggested: k.kategori_kod, needsReview: true, reason: kuralNedeni(k), kural: k }
    }
  }
  return {
    type: SINIFSIZ,
    needsReview: true,
    reason: belge ? `Belge No tanınmadı: ${belge.slice(0, 40)}` : 'Belge No boş — tip belirlenemedi',
  }
}

export interface KuralKategorisi {
  kod: string
  aktif: boolean
}

/** Tek kuralın doğrulaması; sorun yoksa null, varsa Türkçe hata. */
export function kuralDogrula(k: Kural, kategoriler: readonly KuralKategorisi[]): string | null {
  const kat = kategoriler.find((x) => x.kod === k.kategori_kod)
  if (!kat) return 'Hedef kategori bulunamadı.'
  if (k.kategori_kod === SINIFSIZ) return '"Sınıflandırılmadı" kurala hedef olamaz.'
  if (!kat.aktif) return 'Hedef kategori pasif.'
  if (!(k.alan in ALAN_ETIKETLERI)) return 'Geçersiz alan.'
  if (!(k.islec in ISLEC_ETIKETLERI)) return 'Geçersiz işleç.'
  if (!(k.sonuc in SONUC_ETIKETLERI)) return 'Geçersiz sonuç.'
  const deger = k.deger ?? ''
  if (deger.trim().length === 0) return 'Değer boş olamaz.'
  if (deger.length > 200) return 'Değer en fazla 200 karakter olabilir.'
  if (k.islec === 'REGEX') {
    if (!regexDerle(deger)) return 'Düzenli ifade geçersiz.'
  } else if (!normText(deger)) {
    return 'Değer boş olamaz.'
  }
  if ((k.aciklama ?? '').length > 200) return 'Açıklama en fazla 200 karakter olabilir.'
  return null
}
