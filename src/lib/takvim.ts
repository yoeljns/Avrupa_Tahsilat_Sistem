import { normText } from '@/lib/engine/normalize'

// Takvim (Konsinye / Peşin sayfaları) için SAF yardımcılar — sunucuda ve
// tarayıcıda aynı çalışır. Tarihler ISO 'YYYY-MM-DD'; gün aritmetiği UTC ile
// yapılır (saat dilimi kayması olmasın). "Bugün" dışarıdan verilir
// (Türkiye saatine göre, format.todayISO).

/** [borç, ödeme, kalan] — kuruş */
export type Hucre = [number, number, number]

export interface TakvimFirmaSatiri {
  firm_id: string
  kod: string
  ad: string
  sorumlu: string | null
  toplam_borc: number
  toplam_odeme: number
  toplam_kalan: number
  /** seçili aydan ÖNCE vadeli kalan */
  once_kalan: number
  /** seçili aydan SONRA vadeli kalan */
  sonra_kalan: number
  /** bugüne göre vadesi geçmiş kalan (tüm aylar) */
  gecikmis: number
  tarihsiz: boolean
  /** vade günü → [borç, ödeme, kalan] — yalnız seçili ay */
  gunler: Record<string, Hucre>
}

const GUN_ADLARI = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'] // getUTCDay: 0 = Pazar
const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const GUN_MS = 86_400_000

function gunNo(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / GUN_MS
}

function isoGun(no: number): string {
  return new Date(no * GUN_MS).toISOString().slice(0, 10)
}

export function gunEkle(iso: string, n: number): string {
  return isoGun(gunNo(iso) + n)
}

/** İki ISO gün arasındaki fark (b − a), gün olarak */
export function gunFarki(a: string, b: string): number {
  return gunNo(b) - gunNo(a)
}

/** '2026-06-05' → 'Cum' */
export function gunAdi(iso: string): string {
  return GUN_ADLARI[new Date(gunNo(iso) * GUN_MS).getUTCDay()]
}

/** '2026-06-05' → '05.06' */
export function kisaTarih(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
}

/** 'YYYY-MM' → ayın ilk ve son günü */
export function ayAraligi(ay: string): { bas: string; son: string } {
  const [y, m] = ay.split('-').map(Number)
  const sonGun = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { bas: `${ay}-01`, son: `${ay}-${String(sonGun).padStart(2, '0')}` }
}

// ---------------------------------------------------------------------------
// Sütunlar
// ---------------------------------------------------------------------------
export type SutunKonum = 'gecmis' | 'bugun' | 'gelecek'

export interface Sutun {
  anahtar: string
  bas: string
  son: string
  /** 'Cum 05.06' ya da '1–7 Haz' */
  baslik: string
  konum: SutunKonum
}

function konumOf(bas: string, son: string, bugun: string): SutunKonum {
  if (son < bugun) return 'gecmis'
  if (bas > bugun) return 'gelecek'
  return 'bugun'
}

/** Veri olan her vade günü için bir sütun (sıralı). */
export function gunSutunlari(tarihler: Iterable<string>, bugun: string): Sutun[] {
  return Array.from(new Set(tarihler))
    .sort()
    .map((d) => ({ anahtar: d, bas: d, son: d, baslik: `${gunAdi(d)} ${kisaTarih(d)}`, konum: konumOf(d, d, bugun) }))
}

/** Ayın Pazartesi–Pazar haftaları; ay sınırında kırpılır (ör. '1–7 Haz', '29–30 Haz'). */
export function haftaSutunlari(ayBas: string, aySon: string, bugun: string): Sutun[] {
  const out: Sutun[] = []
  const ayAdi = AY_KISA[Number(ayBas.slice(5, 7)) - 1]
  let bas = gunNo(ayBas)
  const son = gunNo(aySon)
  while (bas <= son) {
    const haftaGunu = (new Date(bas * GUN_MS).getUTCDay() + 6) % 7 // Pzt = 0
    const bitis = Math.min(bas + (6 - haftaGunu), son)
    const b = isoGun(bas)
    const s = isoGun(bitis)
    const gb = Number(b.slice(8, 10))
    const gs = Number(s.slice(8, 10))
    out.push({ anahtar: `${b}_${s}`, bas: b, son: s, baslik: gb === gs ? `${gb} ${ayAdi}` : `${gb}–${gs} ${ayAdi}`, konum: konumOf(b, s, bugun) })
    bas = bitis + 1
  }
  return out
}

// ---------------------------------------------------------------------------
// Hücreler
// ---------------------------------------------------------------------------
export type HucreDurumu = 'odendi' | 'gecikti' | 'yakin' | 'ileri'

export interface SutunHucresi {
  borc: number
  odeme: number
  kalan: number
  /** vadesi bugünden önce olan kalan */
  gecikmis: number
  /** bugün dahil 7 gün içinde vadesi gelen kalan */
  yakin: number
  durum: HucreDurumu
  tarihler: string[]
}

/** Bir firmanın bir sütundaki toplamı ve bugüne göre durumu; o aralıkta vade yoksa null. */
export function sutunHucresi(gunler: Record<string, Hucre>, sutun: Sutun, bugun: string): SutunHucresi | null {
  const yediGun = gunEkle(bugun, 6)
  let borc = 0
  let odeme = 0
  let kalan = 0
  let gecikmis = 0
  let yakin = 0
  const tarihler: string[] = []
  for (const [d, [b, o, k]] of Object.entries(gunler)) {
    if (d < sutun.bas || d > sutun.son) continue
    tarihler.push(d)
    borc += b
    odeme += o
    kalan += k
    if (k > 0 && d < bugun) gecikmis += k
    else if (k > 0 && d <= yediGun) yakin += k
  }
  if (tarihler.length === 0) return null
  tarihler.sort()
  const durum: HucreDurumu = kalan <= 0 ? 'odendi' : gecikmis > 0 ? 'gecikti' : yakin > 0 ? 'yakin' : 'ileri'
  return { borc, odeme, kalan, gecikmis, yakin, durum, tarihler }
}

/**
 * Firmanın BUGÜNE göre gecikmiş kalanını üç parçaya ayırır:
 * seçili aydan önce / ay içinde / aydan sonra (geçmiş bir ay görüntülenirken).
 */
export function gecikmeDagilimi(f: TakvimFirmaSatiri, ayBas: string, bugun: string): { once: number; ayIci: number; sonra: number } {
  // Ay bugünden önce/bugün başlıyorsa önceki ayların TAMAMI gecikmiştir; ileri bir
  // ay görüntüleniyorsa gecikmişlerin hepsi bugünden, dolayısıyla aydan öncedir.
  const once = ayBas <= bugun ? f.once_kalan : Math.min(f.once_kalan, f.gecikmis)
  let ayIci = 0
  for (const [d, [, , k]] of Object.entries(f.gunler)) if (d < bugun && k > 0) ayIci += k
  const sonra = Math.max(0, f.gecikmis - once - ayIci)
  return { once, ayIci, sonra }
}

// ---------------------------------------------------------------------------
// Süzme ve sıralama
// ---------------------------------------------------------------------------
export interface Suzgec {
  arama: string
  /** '' = tümü */
  sorumlu: string
  yalnizGecikmis: boolean
  bitenleriGizle: boolean
}

export const BOS_SUZGEC: Suzgec = { arama: '', sorumlu: '', yalnizGecikmis: false, bitenleriGizle: false }

function sade(s: string): string {
  return normText(s).replace(/\s+/g, '')
}

export function firmalariSuz<T extends Pick<TakvimFirmaSatiri, 'kod' | 'ad' | 'sorumlu' | 'gecikmis' | 'toplam_kalan'>>(
  firmalar: T[],
  s: Suzgec,
): T[] {
  const aranan = sade(s.arama)
  return firmalar.filter((f) => {
    if (aranan && !sade(`${f.kod} ${f.ad}`).includes(aranan)) return false
    if (s.sorumlu && (f.sorumlu ?? '') !== s.sorumlu) return false
    if (s.yalnizGecikmis && f.gecikmis <= 0) return false
    if (s.bitenleriGizle && f.toplam_kalan <= 0) return false
    return true
  })
}

export type Siralama = 'kod' | 'kalan' | 'gecikmis' | 'ay'

export const SIRALAMA_ETIKETLERI: Record<Siralama, string> = {
  kod: 'Firma kodu',
  kalan: 'Toplam kalan (çoktan aza)',
  gecikmis: 'Gecikmiş (çoktan aza)',
  ay: 'Bu ay kalan (çoktan aza)',
}

/** Bu aydaki kalan (sıralama ve mobil görünüm için) */
export function ayKalani(f: Pick<TakvimFirmaSatiri, 'gunler'>): number {
  let k = 0
  for (const [, , kalan] of Object.values(f.gunler)) k += kalan
  return k
}

export function firmalariSirala<T extends Pick<TakvimFirmaSatiri, 'kod' | 'toplam_kalan' | 'gecikmis' | 'gunler'>>(
  firmalar: T[],
  siralama: Siralama,
): T[] {
  const deger = (f: T): number =>
    siralama === 'kalan' ? f.toplam_kalan : siralama === 'gecikmis' ? f.gecikmis : siralama === 'ay' ? ayKalani(f) : 0
  return firmalar
    .map((f, i) => ({ f, i, v: deger(f) }))
    .sort((a, b) => b.v - a.v || (a.f.kod < b.f.kod ? -1 : a.f.kod > b.f.kod ? 1 : a.i - b.i))
    .map((x) => x.f)
}

export function sorumluListesi(firmalar: Array<Pick<TakvimFirmaSatiri, 'sorumlu'>>): string[] {
  return Array.from(new Set(firmalar.map((f) => f.sorumlu).filter((s): s is string => !!s))).sort()
}

// ---------------------------------------------------------------------------
// Biçim
// ---------------------------------------------------------------------------
const TAM = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 })

/** 3166885 → '31.669 €' (tam avro; kuruşlu tutar ipucunda gösterilir) */
export function eurTam(cents: number): string {
  return TAM.format(Math.round(cents / 100)) + ' €'
}

const KISA = new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 })

/** 565305872 → '5,7 Mn €' (ay listesi, süzgeç düğmeleri gibi dar yerler için) */
export function eurKisa(cents: number): string {
  return KISA.format(cents / 100) + ' €'
}

/** Ödenen oranı (0–100) — ilerleme çubuğu için */
export function odemeYuzdesi(borc: number, odeme: number): number {
  if (borc <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((odeme / borc) * 100)))
}
