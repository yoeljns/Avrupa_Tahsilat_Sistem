import type { BadgeTone } from '@/components/ui/Badge'
import { eur } from '@/lib/format'
import { DAVRANISLAR, davranisOf, kategoriBul, kategoriEtiketi, type KategoriMeta } from '@/lib/kategoriMeta'

// Denetim kaydındaki ham kodların okunur karşılıkları (saf modül; sunucu + tarayıcı).

export const KAYIT_TURU_ETIKETLERI: Record<string, string> = {
  irsaliye: 'İrsaliye',
  odeme: 'Ödeme',
  kullanici: 'Kullanıcı',
  haric_firma: 'Takip Dışı Firma',
  ice_aktarim: 'İçe Aktarım',
  kategori: 'Satış Kategorisi',
  kategori_kurali: 'Tanıma Kuralı',
  sistem: 'Sistem',
}

export const ISLEM_ETIKETLERI: Record<string, { ad: string; ton: BadgeTone }> = {
  TIP_DEGISIKLIGI: { ad: 'Kategori değişti', ton: 'blue' },
  SINIFLANDIRMA: { ad: 'Sınıflandırıldı', ton: 'blue' },
  KURAL_SINIFLANDIRMA: { ad: 'Kuralla sınıflandırıldı', ton: 'indigo' },
  TUTAR_DEGISIKLIGI: { ad: 'Tutar değişti', ton: 'amber' },
  VADE_DEGISIKLIGI: { ad: 'Vade / plan değişti', ton: 'amber' },
  TAKSIT_DUZENLEME: { ad: 'Taksitler düzenlendi', ton: 'amber' },
  TAKSIT_OLCEKLEME: { ad: 'Taksitler oranlandı', ton: 'amber' },
  IPTAL: { ad: 'İptal edildi', ton: 'red' },
  IPTAL_GERI_ALMA: { ad: 'İptal geri alındı', ton: 'green' },
  TAKIP_DISI_DEGISIKLIGI: { ad: 'Takip dışı ayarı', ton: 'gray' },
  INCELEME_KAPATILDI: { ad: 'İnceleme kapatıldı', ton: 'green' },
  ICE_AKTARIM_GUNCELLEME: { ad: 'Aktarımla güncellendi', ton: 'gray' },
  IRSALIYE_AKTARIMI: { ad: 'İrsaliye aktarımı', ton: 'violet' },
  ODEME_AKTARIMI: { ad: 'Ödeme aktarımı', ton: 'violet' },
  BAYI_AKTARIMI: { ad: 'Bayi listesi aktarımı', ton: 'violet' },
  HARIC_EKLEME: { ad: 'Takip dışına alındı', ton: 'gray' },
  HARIC_CIKARMA: { ad: 'Takibe geri alındı', ton: 'green' },
  KULLANICI_OLUSTURMA: { ad: 'Kullanıcı oluşturuldu', ton: 'green' },
  ROL_DEGISIKLIGI: { ad: 'Rol değişti', ton: 'amber' },
  AKTIFLESTIRME: { ad: 'Aktifleştirildi', ton: 'green' },
  PASIFLESTIRME: { ad: 'Pasifleştirildi', ton: 'red' },
  SIFRE_SIFIRLAMA: { ad: 'Şifre sıfırlandı', ton: 'gray' },
  KATEGORI_OLUSTURMA: { ad: 'Kategori oluşturuldu', ton: 'green' },
  KATEGORI_GUNCELLEME: { ad: 'Kategori güncellendi', ton: 'blue' },
  KATEGORI_PASIFLESTIRME: { ad: 'Kategori pasifleşti', ton: 'red' },
  KATEGORI_AKTIFLESTIRME: { ad: 'Kategori aktifleşti', ton: 'green' },
  KATEGORI_SIRALAMA: { ad: 'Kategori sırası', ton: 'gray' },
  KATEGORI_SILME: { ad: 'Kategori silindi', ton: 'red' },
  KATEGORI_DAVRANIS: { ad: 'Kategori davranışı değişti', ton: 'amber' },
  KURAL_GUNCELLEME: { ad: 'Tanıma kuralları kaydedildi', ton: 'indigo' },
  VERI_SIFIRLAMA: { ad: 'Veri sıfırlandı', ton: 'red' },
  KURULUM_TAMAMLANDI: { ad: 'Kurulum', ton: 'gray' },
}

export const ALAN_ETIKETLERI: Record<string, string> = {
  satis_tipi: 'kategori',
  tutar_eur: 'tutar',
  odeme_plani: 'plan',
  iptal: 'iptal',
  takip_disi: 'takip dışı',
  inceleme: 'inceleme',
  taksitler: 'taksitler',
  rol: 'rol',
  aktif: 'durum',
  taraf: 'davranış',
}

const ROL_ETIKETLERI: Record<string, string> = {
  yonetici: 'Yönetici',
  tahsilat_yoneticisi: 'Tahsilat Yöneticisi',
  pazarlamaci: 'Pazarlamacı',
}

export function islemEtiketi(kod: string): { ad: string; ton: BadgeTone } {
  // Kodlar ASCII'dir (İ→I katlanmış): tr-TR küçültme I'yı ı yapardı
  return ISLEM_ETIKETLERI[kod] ?? { ad: kod.replaceAll('_', ' ').toLowerCase(), ton: 'gray' }
}

export function kayitTuruEtiketi(kod: string): string {
  return KAYIT_TURU_ETIKETLERI[kod] ?? kod
}

/** Kaydın okunur adı: tür + kimlik; toplu kayıtlarda (kural seti, kategori sırası) yalnız ad. */
export function kayitYazisi(tur: string, kimlik: string): { tur: string; kimlik: string | null } {
  if (tur === 'kategori_kurali') return { tur: 'Tanıma kuralları', kimlik: null }
  if (tur === 'kategori' && kimlik === 'sira') return { tur: 'Kategori sırası', kimlik: null }
  return { tur: kayitTuruEtiketi(tur), kimlik }
}

export function alanEtiketi(field: string | null): string | null {
  if (!field) return null
  return field
    .split(',')
    .map((f) => ALAN_ETIKETLERI[f.trim()] ?? f.trim())
    .join(', ')
}

function kisalt(s: string, n = 90): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/** Eski/yeni değeri alanına göre okunur yazar: kategori kodu → ad, kuruş → €, rol → ad, … */
export function degerYazisi(field: string | null, deger: unknown, kategoriler?: readonly KategoriMeta[]): string {
  if (deger === undefined) return ''
  if (deger === null || deger === '') return field === 'taraf' ? DAVRANISLAR.YOK.ad : ''
  switch (field) {
    case 'satis_tipi':
      return typeof deger === 'string' ? kategoriEtiketi(kategoriler, deger) : kisalt(JSON.stringify(deger))
    case 'tutar_eur':
      return typeof deger === 'number' ? eur(deger) : String(deger)
    case 'rol':
      return typeof deger === 'string' ? (ROL_ETIKETLERI[deger] ?? deger) : String(deger)
    case 'taraf':
      return typeof deger === 'string' ? DAVRANISLAR[davranisOf(deger as 'PESIN' | 'VADELI')].ad : String(deger)
    case 'aktif':
      return deger === true ? 'aktif' : deger === false ? 'pasif' : String(deger)
  }
  if (typeof deger === 'boolean') return deger ? 'evet' : 'hayır'
  if (typeof deger === 'string' || typeof deger === 'number') return kisalt(String(deger))
  return kisalt(JSON.stringify(deger))
}

export interface DegisiklikSatiri {
  alan: string | null
  eski: string
  yeni: string
}

function nesneMi(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const NESNE_ALANLARI: Record<string, string> = {
  ad: 'ad',
  kisa_ad: 'kısa ad',
  renk: 'renk',
  aciklama: 'açıklama',
  sayfada_suzgec: 'süzgeç düğmesi',
  panoda_kart: 'panoda kart',
  aktif: 'durum',
  taraf: 'davranış',
  role: 'rol',
  note: 'not',
  adet: 'adet',
  otomatik: 'otomatik',
  oneri: 'öneri',
  etkin: 'etkin',
}

/** Değeri kategori kodu olan nesne anahtarları (kural sınıflandırması denetimi) */
const KATEGORI_ANAHTARLARI = new Set(['otomatik', 'oneri', 'etkin'])

/** Denetimde gösterilmeyen teknik anahtarlar */
const GIZLI_ANAHTARLAR = new Set(['updated_by', 'sistem', 'kod', 'sira'])

/**
 * Bir denetim kaydının "ne değişti" satırları. Alan bazlı eski → yeni; nesne
 * değerlerde (kategori güncellemesi, içe aktarma) anahtar anahtar; listelerde özet.
 */
export function degisiklikSatirlari(field: string | null, eski: unknown, yeni: unknown, kategoriler?: readonly KategoriMeta[]): DegisiklikSatiri[] {
  if (Array.isArray(eski) || Array.isArray(yeni)) {
    // Kod listesi (ör. kategori sırası) → adlarıyla; nesne listesi (ör. kural seti) → sayı
    const yaz = (v: unknown): string => {
      if (!Array.isArray(v)) return ''
      if (v.every((x) => typeof x === 'string')) {
        return kisalt(v.map((x) => (kategoriBul(kategoriler, x as string) ? kategoriEtiketi(kategoriler, x as string) : String(x))).join(', '))
      }
      const kural = v.length > 0 && v.every((x) => typeof x === 'object' && x !== null && 'alan' in x)
      return `${v.length} ${kural ? 'kural' : 'kayıt'}`
    }
    return [{ alan: alanEtiketi(field), eski: yaz(eski), yeni: yaz(yeni) }]
  }
  if (nesneMi(eski) || nesneMi(yeni)) {
    const e = nesneMi(eski) ? eski : {}
    const y = nesneMi(yeni) ? yeni : {}
    const anahtarlar = Array.from(new Set([...Object.keys(e), ...Object.keys(y)])).filter((k) => !GIZLI_ANAHTARLAR.has(k))
    const satirlar = anahtarlar
      .map((k) => {
        const alanAdi = KATEGORI_ANAHTARLARI.has(k) ? 'satis_tipi' : k === 'taraf' ? 'taraf' : k === 'role' ? 'rol' : k === 'aktif' ? 'aktif' : null
        return { anahtar: k, alan: NESNE_ALANLARI[k] ?? k, eski: degerYazisi(alanAdi, e[k], kategoriler), yeni: degerYazisi(alanAdi, y[k], kategoriler) }
      })
      // değişmeyen alanlar gösterilmez (iki taraf da boş dahil)
      .filter((s) => s.eski !== s.yeni)
    // kural sınıflandırmasında "otomatik" çoğu zaman "etkin" ile aynıdır: tekrar yazılmaz
    const etkin = satirlar.find((s) => s.anahtar === 'etkin')
    return satirlar
      .filter((s) => !(s.anahtar === 'otomatik' && etkin && etkin.eski === s.eski && etkin.yeni === s.yeni))
      .slice(0, 8)
      .map(({ alan, eski: es, yeni: ye }) => ({ alan, eski: es, yeni: ye }))
  }
  if (eski === null && yeni === null) return []
  return [{ alan: alanEtiketi(field), eski: degerYazisi(field, eski, kategoriler), yeni: degerYazisi(field, yeni, kategoriler) }]
}
