import { formatCents } from '@/lib/engine/money'
import { addMonths } from '@/lib/format'
import type { KategoriMeta } from '@/lib/kategoriMeta'
import { sade } from '@/lib/takvim'
import { ayRengi, type AyRengi } from './bicim'

// BAKİYE TABLOSU MODELİ — kullanıcının "Vadeli Bakiyeler" Excel düzeni.
// Saf modül (sunucu + tarayıcı). Ekrandaki tablo, Excel çıktısı ve PDF rapor
// AYNI modelden beslenir; üçü farklı sayı gösteremez.
//
// Düzen (dosyanın Kasım–Aralık ayları): her vade AYI için
//   VADELİ BORÇ · PEŞİN BORÇ (ayın başı) · PEŞİN BORÇ (ayın ortası) · ÖDEME · KALAN
//   VADELİ = Konsinye,  PEŞİN = Konsinye Peşin.
// Tutarlar kuruş (tam sayı).

/** [firma_sırası, taraf, kategori, vade, borç, kalan, adet, tarihsiz] — rpc_bakiye_verisi.hucreler */
export type BakiyeHucreSatiri = [number, 'PESIN' | 'VADELI', string, string, number, number, number, boolean]
/** [firma_sırası, taraf, kategori, vade, borç, kalan, fiş_no, irsaliye_tarihi, tarihsiz] — rpc_bakiye_verisi.dokum */
export type BakiyeDokumSatiri = [number, 'PESIN' | 'VADELI', string, string, number, number, string, string, boolean]

export interface BakiyeFirma {
  id: string
  kod: string
  ad: string
  sorumlu: string | null
}

export interface BakiyeGirdisi {
  firmalar: BakiyeFirma[]
  hucreler: BakiyeHucreSatiri[]
  kategoriler: readonly KategoriMeta[]
}

/** Bir ay grubundaki BORÇ sütunu */
export interface BorcSutunu {
  /** ay içinde benzersiz: 'KONSINYE' | 'KONSINYE_PESIN:1' | 'KONSINYE_PESIN:2' | başka kategori kodu */
  anahtar: string
  kategori: string
  /** 2. başlık satırı: 'VADELİ' | 'PEŞİN' | kategori kısa adı */
  etiket: string
  /** 1. başlık satırındaki tarih (ISO gün) */
  tarih: string
}

export type AyKonumu = 'gecmis' | 'bu' | 'gelecek'

export interface AyGrubu {
  /** 'YYYY-MM' */
  ay: string
  /** 'KASIM' — yıl bugünkü yıldan farklıysa 'OCAK 2027' */
  ad: string
  renk: AyRengi
  konum: AyKonumu
  /** geçmiş ay VE toplam kalan 0 → Excel'de sütunları gizli, ekranda kapalı */
  gizli: boolean
  borcSutunlari: BorcSutunu[]
  toplam: { borc: number[]; odeme: number; kalan: number }
}

export interface AyHucresi {
  /** borcSutunlari ile aynı sırada */
  borc: number[]
  odeme: number
  kalan: number
  /** borç sütunu başına: başlık tarihine uymayan vadeler ('15.11: 34.037,00 €'); yoksa null */
  notlar: (string[] | null)[]
}

export interface BakiyeSatiri {
  firm_id: string
  kod: string
  ad: string
  sorumlu: string | null
  toplamBorc: number
  toplamOdeme: number
  toplamKalan: number
  /** bugüne göre vadesi geçmiş kalan */
  gecikmis: number
  /** içinde bulunulan aya kadar (dahil) kalan — birikimli sütun */
  birikimli: number
  /** AyGrubu sırasıyla; null = o ayda hareket yok */
  aylar: (AyHucresi | null)[]
  /** sorumlu bloğu sırası (0, 1, 2 …) — SORUMLU yazısı blok blok kırmızı / siyah */
  sorumluBlok: number
}

export interface BakiyeModeli {
  bugun: string
  aylar: AyGrubu[]
  satirlar: BakiyeSatiri[]
  toplam: { borc: number; odeme: number; kalan: number; gecikmis: number; birikimli: number }
  /** Birikimli sütun bu sıradaki ay grubundan SONRA gelir; null → sütun yok (bütün aylar gelecekte) */
  birikimliSonrasi: number | null
  /** Üç başlık satırı: ['EKİM', 'KASIM', 'TOPLAMI'] (ilk açık ay · bu ay) */
  birikimliBaslik: [string, string, string]
}

export const AY_ADLARI = ['OCAK', 'ŞUBAT', 'MART', 'NİSAN', 'MAYIS', 'HAZİRAN', 'TEMMUZ', 'AĞUSTOS', 'EYLÜL', 'EKİM', 'KASIM', 'ARALIK']

/** Dosyadaki adlar: Konsinye → VADELİ, Konsinye Peşin → PEŞİN */
const SUTUN_ETIKETI: Record<string, string> = { KONSINYE: 'VADELİ', KONSINYE_PESIN: 'PEŞİN' }
/** Ayda İKİ borç sütunu olan kategoriler (ayın başı / ortası) */
const IKI_SUTUNLU = new Set(['KONSINYE_PESIN'])
/** Düzenin her zaman bulunan kategorileri (veri olmasa da sütunları durur) */
const SABIT_KATEGORILER = ['KONSINYE', 'KONSINYE_PESIN']
/** İki sütunlu kategoride sınır: ayın 1–12'si ilk sütun (5'ine yakın), 13–31'i ikinci (20'sine yakın) */
export const ILK_YARI_SON_GUN = 12

interface SutunTanimi {
  anahtar: string
  kategori: string
  etiket: string
  varsayilanGun: number
  /** 0 = tek sütun, 1 = ilk yarı, 2 = ikinci yarı */
  kova: 0 | 1 | 2
}

const TR = new Intl.Collator('tr')

function ikiHane(n: number): string {
  return String(n).padStart(2, '0')
}

function ayAdi(ay: string, bugun: string): string {
  const ad = AY_ADLARI[parseInt(ay.slice(5, 7), 10) - 1] ?? ay
  return ay.slice(0, 4) === bugun.slice(0, 4) ? ad : `${ad} ${ay.slice(0, 4)}`
}

function sutunTanimlari(girdi: BakiyeGirdisi, hucreler: BakiyeHucreSatiri[]): SutunTanimi[] {
  const meta = new Map(girdi.kategoriler.map((k) => [k.kod, k]))
  const kodlar = new Set<string>(SABIT_KATEGORILER)
  for (const h of hucreler) kodlar.add(h[2])
  const sirali = Array.from(kodlar).sort(
    (a, b) => (meta.get(a)?.sira ?? (a === 'KONSINYE' ? 20 : a === 'KONSINYE_PESIN' ? 30 : 500)) - (meta.get(b)?.sira ?? (b === 'KONSINYE' ? 20 : b === 'KONSINYE_PESIN' ? 30 : 500)) || a.localeCompare(b),
  )
  const tanimlar: SutunTanimi[] = []
  for (const kod of sirali) {
    const m = meta.get(kod)
    const etiket = SUTUN_ETIKETI[kod] ?? (m?.kisa_ad || m?.ad || kod).toLocaleUpperCase('tr-TR')
    if (IKI_SUTUNLU.has(kod)) {
      tanimlar.push({ anahtar: `${kod}:1`, kategori: kod, etiket, varsayilanGun: 5, kova: 1 })
      tanimlar.push({ anahtar: `${kod}:2`, kategori: kod, etiket, varsayilanGun: 20, kova: 2 })
    } else {
      tanimlar.push({ anahtar: kod, kategori: kod, etiket, varsayilanGun: 5, kova: 0 })
    }
  }
  return tanimlar
}

/** Bir kovanın başlık tarihi: varsayılan gün; kovadaki taksitlerin EN AZ YARISI başka tek bir gündeyse o gün. */
function baslikTarihi(ay: string, varsayilanGun: number, dagilim: Map<string, number> | undefined): string {
  const varsayilan = `${ay}-${ikiHane(varsayilanGun)}`
  if (!dagilim || dagilim.size === 0) return varsayilan
  let toplam = 0
  let enCok: { tarih: string; adet: number } | null = null
  for (const [tarih, adet] of dagilim) {
    toplam += adet
    if (
      !enCok ||
      adet > enCok.adet ||
      (adet === enCok.adet && (tarih === varsayilan || (enCok.tarih !== varsayilan && tarih < enCok.tarih)))
    ) {
      enCok = { tarih, adet }
    }
  }
  return enCok && enCok.adet * 2 >= toplam ? enCok.tarih : varsayilan
}

interface HamSatir extends Omit<BakiyeSatiri, 'sorumluBlok'> {
  /** ay × sütun → vade günleri (not üretimi için) */
  ayrinti: Map<string, Array<{ vade: string; borc: number; tarihsiz: boolean }>>
}

/** Satırlardan ay toplamları, gizli aylar, genel toplam ve birikimli sütun başlığı. */
function ozetle(
  bugun: string,
  aySablonu: Array<Pick<AyGrubu, 'ay' | 'ad' | 'renk' | 'konum' | 'borcSutunlari'>>,
  satirlar: BakiyeSatiri[],
): BakiyeModeli {
  const buAy = bugun.slice(0, 7)
  const aylar: AyGrubu[] = aySablonu.map((a) => ({
    ...a,
    gizli: false,
    toplam: { borc: a.borcSutunlari.map(() => 0), odeme: 0, kalan: 0 },
  }))
  const toplam = { borc: 0, odeme: 0, kalan: 0, gecikmis: 0, birikimli: 0 }
  for (const s of satirlar) {
    toplam.borc += s.toplamBorc
    toplam.odeme += s.toplamOdeme
    toplam.kalan += s.toplamKalan
    toplam.gecikmis += s.gecikmis
    toplam.birikimli += s.birikimli
    s.aylar.forEach((h, i) => {
      if (!h) return
      const t = aylar[i].toplam
      h.borc.forEach((b, j) => (t.borc[j] += b))
      t.odeme += h.odeme
      t.kalan += h.kalan
    })
  }
  let sonGecmis: number | null = null
  let ilkAcik: number | null = null
  aylar.forEach((a, i) => {
    a.gizli = a.ay < buAy && a.toplam.kalan === 0
    if (a.ay <= buAy) {
      sonGecmis = i
      if (ilkAcik === null && a.toplam.kalan > 0) ilkAcik = i
    }
  })
  const kisaAd = (i: number) => AY_ADLARI[parseInt(aylar[i].ay.slice(5, 7), 10) - 1]
  const birikimliBaslik: [string, string, string] =
    sonGecmis === null ? ['', '', 'TOPLAMI'] : [ilkAcik !== null && ilkAcik !== sonGecmis ? kisaAd(ilkAcik) : '', kisaAd(sonGecmis), 'TOPLAMI']
  return { bugun, aylar, satirlar, toplam, birikimliSonrasi: sonGecmis, birikimliBaslik }
}

function bloklariNumarala(satirlar: BakiyeSatiri[]): void {
  let blok = -1
  let onceki: string | null | undefined = undefined
  for (const s of satirlar) {
    if (s.sorumlu !== onceki) {
      blok++
      onceki = s.sorumlu
    }
    s.sorumluBlok = blok
  }
}

/** Varsayılan sıra: sorumlu (boş olanlar sonda), sonra firma adı; Türkçe sıralama. */
function sorumluSirasi(a: BakiyeSatiri, b: BakiyeSatiri): number {
  if (a.sorumlu !== b.sorumlu) {
    if (a.sorumlu === null) return 1
    if (b.sorumlu === null) return -1
    return TR.compare(a.sorumlu, b.sorumlu)
  }
  return TR.compare(a.ad, b.ad) || TR.compare(a.kod, b.kod)
}

/**
 * rpc_bakiye_verisi çıktısından bakiye tablosu modelini kurar (yalnız VADELI taraf).
 * `bugun` Türkiye saatine göre ISO gün (format.todayISO).
 */
export function bakiyeModeliKur(girdi: BakiyeGirdisi, bugun: string): BakiyeModeli {
  const buAy = bugun.slice(0, 7)
  const hucreler = girdi.hucreler.filter((h) => h[1] === 'VADELI')
  const tanimlar = sutunTanimlari(girdi, hucreler)

  // Aylar: verinin ilk ayından son ayına kesintisiz
  let ilkAy: string | null = null
  let sonAy: string | null = null
  for (const h of hucreler) {
    const ay = h[3].slice(0, 7)
    if (ilkAy === null || ay < ilkAy) ilkAy = ay
    if (sonAy === null || ay > sonAy) sonAy = ay
  }
  const ayListesi: string[] = []
  if (ilkAy !== null && sonAy !== null) {
    for (let ay = ilkAy; ay <= sonAy; ay = addMonths(ay, 1)) ayListesi.push(ay)
  }
  const aySirasi = new Map(ayListesi.map((a, i) => [a, i]))

  const sutunSirasi = (kategori: string, gun: number): number =>
    tanimlar.findIndex((t) => t.kategori === kategori && (t.kova === 0 || (t.kova === 1 ? gun <= ILK_YARI_SON_GUN : gun > ILK_YARI_SON_GUN)))

  // Toplama
  const dagilim = new Map<string, Map<string, number>>() // `${ay}|${sutun}` → vade → adet
  const ham = new Map<number, HamSatir>()
  for (const [fi, , kategori, vade, borc, kalan, adet, tarihsiz] of hucreler) {
    const firma = girdi.firmalar[fi]
    if (!firma) continue
    const ai = aySirasi.get(vade.slice(0, 7))!
    const si = sutunSirasi(kategori, parseInt(vade.slice(8, 10), 10))
    let satir = ham.get(fi)
    if (!satir) {
      satir = {
        firm_id: firma.id,
        kod: firma.kod,
        ad: firma.ad,
        sorumlu: firma.sorumlu,
        toplamBorc: 0,
        toplamOdeme: 0,
        toplamKalan: 0,
        gecikmis: 0,
        birikimli: 0,
        aylar: ayListesi.map(() => null),
        ayrinti: new Map(),
      }
      ham.set(fi, satir)
    }
    let hucre = satir.aylar[ai]
    if (!hucre) {
      hucre = { borc: tanimlar.map(() => 0), odeme: 0, kalan: 0, notlar: tanimlar.map(() => null) }
      satir.aylar[ai] = hucre
    }
    hucre.borc[si] += borc
    hucre.odeme += borc - kalan
    hucre.kalan += kalan
    satir.toplamBorc += borc
    satir.toplamOdeme += borc - kalan
    satir.toplamKalan += kalan
    if (vade < bugun) satir.gecikmis += kalan
    if (vade.slice(0, 7) <= buAy) satir.birikimli += kalan

    const dk = `${ai}|${si}`
    let d = dagilim.get(dk)
    if (!d) dagilim.set(dk, (d = new Map()))
    d.set(vade, (d.get(vade) ?? 0) + adet)
    let liste = satir.ayrinti.get(dk)
    if (!liste) satir.ayrinti.set(dk, (liste = []))
    liste.push({ vade, borc, tarihsiz })
  }

  // Ay şablonu: başlık tarihleri
  const aySablonu = ayListesi.map((ay, ai) => ({
    ay,
    ad: ayAdi(ay, bugun),
    renk: ayRengi(ay),
    konum: (ay < buAy ? 'gecmis' : ay === buAy ? 'bu' : 'gelecek') as AyKonumu,
    borcSutunlari: tanimlar.map(
      (t, si): BorcSutunu => ({
        anahtar: t.anahtar,
        kategori: t.kategori,
        etiket: t.etiket,
        tarih: baslikTarihi(ay, t.varsayilanGun, dagilim.get(`${ai}|${si}`)),
      }),
    ),
  }))

  // Notlar: başlık tarihine uymayan (ya da vadesi girilmemiş) tutarlar
  const satirlar: BakiyeSatiri[] = []
  for (const h of ham.values()) {
    for (const [dk, liste] of h.ayrinti) {
      const [ai, si] = dk.split('|').map(Number)
      const baslik = aySablonu[ai].borcSutunlari[si].tarih
      const farkli = liste.filter((x) => x.vade !== baslik || x.tarihsiz).sort((a, b) => (a.vade < b.vade ? -1 : a.vade > b.vade ? 1 : 0))
      if (farkli.length > 0) {
        h.aylar[ai]!.notlar[si] = farkli.map(
          (x) => `${x.vade.slice(8, 10)}.${x.vade.slice(5, 7)}: ${formatCents(x.borc)} €${x.tarihsiz ? ' (vade girilmedi)' : ''}`,
        )
      }
    }
    const { ayrinti: _ayrinti, ...satir } = h
    void _ayrinti
    satirlar.push({ ...satir, sorumluBlok: 0 })
  }
  satirlar.sort(sorumluSirasi)
  bloklariNumarala(satirlar)
  return ozetle(bugun, aySablonu, satirlar)
}

// ---------------------------------------------------------------------------
// Süzme ve sıralama — ekrandaki araç çubuğu ve Excel ucu aynı işlevleri kullanır
// ---------------------------------------------------------------------------
export interface BakiyeSuzgec {
  arama: string
  /** boş = tüm sorumlular; '-' = sorumlusu olmayanlar */
  sorumlu: string
  yalnizGecikmis: boolean
  bitenleriGizle: boolean
}

export const BOS_BAKIYE_SUZGEC: BakiyeSuzgec = { arama: '', sorumlu: '', yalnizGecikmis: false, bitenleriGizle: false }
export const SORUMLUSUZ = '-'

export type BakiyeSiralama = 'sorumlu' | 'ad' | 'kalan' | 'gecikmis'

export const BAKIYE_SIRALAMA_ETIKETLERI: Record<BakiyeSiralama, string> = {
  sorumlu: 'Sorumlu, sonra firma adı',
  ad: 'Firma adı',
  kalan: 'Kalan borç (çoktan aza)',
  gecikmis: 'Gecikmiş (çoktan aza)',
}

/**
 * Satırları süzer ve sıralar; ay toplamları, gizli aylar, genel toplam ve
 * birikimli başlık kalan satırlara göre YENİDEN hesaplanır (Excel'e inen de budur).
 */
export function bakiyeGorunumu(model: BakiyeModeli, suzgec: BakiyeSuzgec = BOS_BAKIYE_SUZGEC, siralama: BakiyeSiralama = 'sorumlu'): BakiyeModeli {
  const aranan = sade(suzgec.arama)
  const satirlar = model.satirlar
    .filter((s) => {
      if (aranan && !sade(`${s.kod} ${s.ad}`).includes(aranan)) return false
      if (suzgec.sorumlu === SORUMLUSUZ ? s.sorumlu !== null : suzgec.sorumlu && s.sorumlu !== suzgec.sorumlu) return false
      if (suzgec.yalnizGecikmis && s.gecikmis <= 0) return false
      if (suzgec.bitenleriGizle && s.toplamKalan <= 0) return false
      return true
    })
    .map((s) => ({ ...s }))
  if (siralama === 'sorumlu') satirlar.sort(sorumluSirasi)
  else if (siralama === 'ad') satirlar.sort((a, b) => TR.compare(a.ad, b.ad) || TR.compare(a.kod, b.kod))
  else if (siralama === 'kalan') satirlar.sort((a, b) => b.toplamKalan - a.toplamKalan || TR.compare(a.ad, b.ad))
  else satirlar.sort((a, b) => b.gecikmis - a.gecikmis || b.toplamKalan - a.toplamKalan || TR.compare(a.ad, b.ad))
  bloklariNumarala(satirlar)
  return ozetle(model.bugun, model.aylar, satirlar)
}

/** Modeldeki sorumlular (süzgeç listesi için), Türkçe sırada */
export function bakiyeSorumlulari(model: BakiyeModeli): string[] {
  return Array.from(new Set(model.satirlar.map((s) => s.sorumlu).filter((s): s is string => !!s))).sort(TR.compare)
}
