// Bakiye tablosunun renkleri — kullanıcının "VADELİ VE PEŞİN BORÇ TABLOSU"
// dosyasından (xl/styles.xml) alındı. Excel yazıcısı ve ekrandaki tablo AYNI
// sabitleri kullanır; ikisi ayrışamaz. Değerler RRGGBB (başında # yok).

export const RENK = {
  /** ay grubu rengi — tek aylar (dosyada Kasım) */
  turuncu: 'F4B183',
  /** ay grubu rengi — çift aylar (dosyada Ekim, Aralık) */
  sari: 'FFFF00',
  /** TOPLAM SATIŞ sütunu */
  mavi: 'BDD7EE',
  /** KALAN BORÇ sütunu */
  kalanBorc: 'FFE699',
  /** birikimli ("EKİM KASIM TOPLAMI") sütunu ve ALACAKLILAR toplamı */
  birikimli: '00FFFF',
  /** ALACAKLILAR başlığı */
  alacakBaslik: 'FFC000',
  beyaz: 'FFFFFF',
  kirmizi: 'FF0000',
  siyah: '000000',
  /** başlık yazısı (dosyada tema siyahının açılmış tonu) */
  baslikYazi: '0D0D0D',
  /** KALAN ve toplam yazısı */
  koyuYazi: '181717',
  /** seçili satır vurgusu (dosyadaki makro + koşullu biçim) */
  seciliSatir: 'FFFF00',
} as const

export type AyRengi = 'turuncu' | 'sari'

/** Ay numarasına göre grup rengi: tek aylar turuncu, çift aylar sarı (dosyada Eki sarı · Kas turuncu · Ara sarı). */
export function ayRengi(ay: string): AyRengi {
  return parseInt(ay.slice(5, 7), 10) % 2 === 1 ? 'turuncu' : 'sari'
}

export const SAYI_BICIMI = {
  tutar: '#,##0.00',
  /** eksi değerler kırmızı (dosyadaki KALAN sütunları) */
  kalan: '#,##0.00_ ;[Red]\\-#,##0.00\\ ',
  tam: '#,##0',
  /** başlık tarihleri: 5-Kas */
  gunAy: 'd-mmm',
  tarih: 'dd.mm.yyyy',
} as const

const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/** '2026-11-05' → '5-Kas' — Excel'in d-mmm biçiminin Türkçe görünümü (ekran başlıkları ve döküm etiketleri) */
export function gunAyEtiketi(iso: string): string {
  return `${parseInt(iso.slice(8, 10), 10)}-${AY_KISA[parseInt(iso.slice(5, 7), 10) - 1] ?? '?'}`
}
