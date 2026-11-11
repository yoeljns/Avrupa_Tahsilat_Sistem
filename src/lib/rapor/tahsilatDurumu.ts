import { SORUMLUSUZ } from '@/lib/bakiye/model'
import { addMonths, trMonth } from '@/lib/format'
import { kategoriEtiketi } from '@/lib/kategoriMeta'
import type { RaporVerisi, VeriTazeligi } from '@/lib/queries'

// TAHSİLAT DURUM RAPORU — veri kurucu (saf).
// rpc_rapor_verisi çıktısından raporun bütün sayılarını üretir; PDF belgesi
// (tahsilatDurumuPdf.ts) yalnız dizer. Tutarlar kuruş (tam sayı).
//
// TANIMLAR (ekranlarla aynı):
//  * Borç          : kapsamdaki taksitlerin tutarı (iptal, 31/12, sınıflandırılmamış, takip dışı hariç).
//  * Ödeme         : ödemelerin borca işlenen kısmı (borç − kalan).
//  * Alacak        : borca işlenemeyen fazla ödeme.  Toplam tahsilat = ödeme + alacak (Pano'daki rakam).
//  * Vadesi geçmiş : vadesi bugünden ÖNCE olan kalan. Peşin borcun vadesi irsaliye tarihidir.
//  * 7 / 30 gün    : konsinye tarafında bugün dahil 7 / 30 gün içinde vadesi gelen kalan (Pano ile aynı).
//  * Tahsilat (ay) : o ay içinde yapılan ödemelerin borca işlenen kısmı (Türkiye günü).

export type RaporTuru = 'kisa' | 'ozet' | 'ayrintili'

export const RAPOR_TURLERI: Record<RaporTuru, { ad: string; aciklama: string }> = {
  kisa: { ad: 'Kısa özet', aciklama: 'Tek sayfa: ana rakamlar, yaşlandırma, en çok geciken 10 firma.' },
  ozet: { ad: 'Yönetim özeti', aciklama: 'Kısa özet + kategori ve sorumlu kırılımı, aylık vade / tahsilat, dönem tahsilatı.' },
  ayrintili: { ad: 'Ayrıntılı', aciklama: 'Yönetim özeti + her sorumlu için firma firma liste ve alacaklı firmalar.' },
}

export interface RaporSecenegi {
  tur: RaporTuru
  /** '' = hepsi · 'ERCAN' = o sorumlu · '-' = sorumlusu olmayanlar */
  sorumlu: string
  /** dönem tahsilatı için ay ('YYYY-MM'); null → tahsilat kaydı olan son ay */
  ay: string | null
}

export interface RaporFirma {
  firm_id: string
  kod: string
  ad: string
  sorumlu: string | null
  borc: number
  /** borca işlenen ödeme (borç − kalan) */
  odeme: number
  kalan: number
  pesinKalan: number
  vadeliKalan: number
  gecikmis: number
  alacak: number
  /** en eski gecikmiş (açık) vade; yoksa null */
  enEskiVade: string | null
  /** en eski gecikmiş vadeden bugüne gün sayısı */
  gecikmeGunu: number
  /** bugün ve sonrasındaki ilk açık vade */
  enYakinVade: string | null
  /** borca işlenen son ödemenin günü */
  sonTahsilat: string | null
}

export interface RaporToplami {
  firma: number
  borc: number
  odeme: number
  kalan: number
  gecikmis: number
  alacak: number
}

export interface TahsilatDurumu {
  bugun: string
  /** 'Tüm firmalar' | 'Sorumlu: ERCAN' | 'Sorumlusu olmayan firmalar' */
  kapsam: string
  suzuldu: boolean
  tazelik: VeriTazeligi | null
  /** son ödeme kaydından bugüne gün; kayıt yoksa null */
  veriYasi: number | null
  ozet: {
    firma: number
    borcluFirma: number
    gecikenFirma: number
    borc: number
    odeme: number
    alacak: number
    /** ödeme + alacak (Pano: "Toplam Tahsilat") */
    toplamTahsilat: number
    kalan: number
    pesinKalan: number
    vadeliKalan: number
    gecikmis: number
    gecikmisPesin: number
    gecikmisVadeli: number
    gun7: number
    gun30: number
  }
  /** vadesi gelmemiş · 1–30 · 31–60 · 61–90 · 90+ gün; toplamı = kalan */
  yaslandirma: Array<{ ad: string; tutar: number }>
  kategoriler: Array<{ kod: string; ad: string; borc: number; odeme: number; kalan: number; gecikmis: number; firma: number }>
  sorumlular: Array<RaporToplami & { ad: string; anahtar: string }>
  /** vade ayı / ödeme ayı; ilk hareketten son harekete kesintisiz */
  aylar: Array<{ ay: string; ad: string; vadeBorc: number; vadeKalan: number; tahsilat: number }>
  /** ödeme tarihi olmayan kayıtların borca işlenen tutarı */
  tarihsizTahsilat: number
  donem: { ay: string; ad: string; otomatik: boolean; toplam: number; firmalar: Array<{ kod: string; ad: string; sorumlu: string | null; tutar: number }> }
  /** gecikmişi olan firmalar, çoktan aza */
  enCokGeciken: RaporFirma[]
  /** borcu ya da alacağı olan firmalar; sorumlu (boşlar sonda), sonra ad */
  firmalar: RaporFirma[]
  alacaklilar: Array<{ kod: string; ad: string; sorumlu: string | null; alacak: number }>
  /** veri uyarıları (yönetime: sistem geneli; herkese: veri tazeliği) */
  uyarilar: string[]
}

const TR = new Intl.Collator('tr')
const GUN = 86_400_000

/** Aylık tablonun bir satırı; `ay` null ise birden çok eski ayın toplamıdır */
export interface AySatiri {
  ay: string | null
  ad: string
  vadeBorc: number
  vadeKalan: number
  tahsilat: number
}

/**
 * Aylık tabloyu derler: son `gecmis` ay (bu ay dahil) ve sonraki aylar tek tek kalır;
 * daha eski aylar "<ilk gösterilen ay> öncesi" adıyla TEK satırda toplanır. Böylece tablo
 * yıllar geçse de kısa kalır. Toplanacak tek ay varsa olduğu gibi bırakılır.
 */
export function aylariDerle(aylar: TahsilatDurumu['aylar'], buAy: string, gecmis = 12): AySatiri[] {
  const ilk = addMonths(buAy, -(gecmis - 1))
  const eski = aylar.filter((a) => a.ay < ilk)
  if (eski.length < 2) return aylar
  return [
    {
      ay: null,
      ad: `${trMonth(ilk)} öncesi`,
      vadeBorc: eski.reduce((t, a) => t + a.vadeBorc, 0),
      vadeKalan: eski.reduce((t, a) => t + a.vadeKalan, 0),
      tahsilat: eski.reduce((t, a) => t + a.tahsilat, 0),
    },
    ...aylar.filter((a) => a.ay >= ilk),
  ]
}

/** iki ISO gün arasındaki fark (b − a), gün */
export function gunFarki(a: string, b: string): number {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / GUN)
}

/** ISO güne gün ekler */
function gunEkle(iso: string, n: number): string {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * GUN).toISOString().slice(0, 10)
}

function kapsamAdi(sorumlu: string): string {
  if (sorumlu === SORUMLUSUZ) return 'Sorumlusu olmayan firmalar'
  return sorumlu ? `Sorumlu: ${sorumlu}` : 'Tüm firmalar'
}

const sorumluUyar = (suzgec: string, sorumlu: string | null): boolean => (suzgec === SORUMLUSUZ ? sorumlu === null : !suzgec || sorumlu === suzgec)

export function tahsilatDurumuKur(veri: RaporVerisi, bugun: string, secenek: RaporSecenegi): TahsilatDurumu {
  const b = veri.bakiye
  const gun7Son = gunEkle(bugun, 6)
  const gun30Son = gunEkle(bugun, 29)

  // --- Firma başına toplamlar (hücrelerden) ---
  const firmalar: RaporFirma[] = b.firmalar.map((f) => ({
    firm_id: f.id,
    kod: f.kod,
    ad: f.ad,
    sorumlu: f.sorumlu,
    borc: 0,
    odeme: 0,
    kalan: 0,
    pesinKalan: 0,
    vadeliKalan: 0,
    gecikmis: 0,
    alacak: 0,
    enEskiVade: null,
    gecikmeGunu: 0,
    enYakinVade: null,
    sonTahsilat: null,
  }))
  const kapsamda = firmalar.map((f) => sorumluUyar(secenek.sorumlu, f.sorumlu))
  const idIndeksi = new Map(firmalar.map((f, i) => [f.firm_id, i]))

  const ozet = { gecikmisPesin: 0, gecikmisVadeli: 0, gun7: 0, gun30: 0 }
  const yas = [0, 0, 0, 0, 0]
  const kategori = new Map<string, { borc: number; kalan: number; gecikmis: number; firmalar: Set<number> }>()
  const ayBorc = new Map<string, { borc: number; kalan: number }>()

  for (const [sira, taraf, kod, vade, borc, kalan] of b.hucreler) {
    const f = firmalar[sira]
    if (!f || !kapsamda[sira]) continue
    f.borc += borc
    f.kalan += kalan
    if (taraf === 'PESIN') f.pesinKalan += kalan
    else f.vadeliKalan += kalan

    let k = kategori.get(kod)
    if (!k) kategori.set(kod, (k = { borc: 0, kalan: 0, gecikmis: 0, firmalar: new Set() }))
    k.borc += borc
    k.kalan += kalan
    if (kalan > 0) k.firmalar.add(sira)

    const ay = vade.slice(0, 7)
    const a = ayBorc.get(ay)
    if (a) {
      a.borc += borc
      a.kalan += kalan
    } else ayBorc.set(ay, { borc, kalan })

    if (kalan <= 0) continue
    if (vade < bugun) {
      f.gecikmis += kalan
      k.gecikmis += kalan
      if (taraf === 'PESIN') ozet.gecikmisPesin += kalan
      else ozet.gecikmisVadeli += kalan
      if (f.enEskiVade === null || vade < f.enEskiVade) f.enEskiVade = vade
      const g = gunFarki(vade, bugun)
      yas[g <= 30 ? 1 : g <= 60 ? 2 : g <= 90 ? 3 : 4] += kalan
    } else {
      yas[0] += kalan
      if (f.enYakinVade === null || vade < f.enYakinVade) f.enYakinVade = vade
      if (taraf === 'VADELI') {
        if (vade <= gun7Son) ozet.gun7 += kalan
        if (vade <= gun30Son) ozet.gun30 += kalan
      }
    }
  }
  for (const f of firmalar) {
    f.odeme = f.borc - f.kalan
    if (f.enEskiVade) f.gecikmeGunu = gunFarki(f.enEskiVade, bugun)
  }

  // --- Alacaklar (firmanın taksiti olmasa da) ---
  const alacaklilar = b.alacaklar.filter((a) => sorumluUyar(secenek.sorumlu, a.sorumlu)).map((a) => ({ kod: a.kod, ad: a.ad, sorumlu: a.sorumlu, alacak: a.alacak }))
  for (const a of b.alacaklar) {
    const i = idIndeksi.get(a.firm_id)
    if (i !== undefined) firmalar[i].alacak = a.alacak
  }
  const alacak = alacaklilar.reduce((t, a) => t + a.alacak, 0)

  // --- Tahsilat: firma × ay ---
  const ayTahsilat = new Map<string, number>()
  const firmaAyTahsilat = new Map<string, Map<number, number>>()
  let tarihsizTahsilat = 0
  for (const [firmaId, ay, tutar, sonGun] of veri.tahsilat) {
    const i = idIndeksi.get(firmaId)
    if (i === undefined || !kapsamda[i]) continue
    const f = firmalar[i]
    if (sonGun && (f.sonTahsilat === null || sonGun > f.sonTahsilat)) f.sonTahsilat = sonGun
    if (ay === null) {
      tarihsizTahsilat += tutar
      continue
    }
    ayTahsilat.set(ay, (ayTahsilat.get(ay) ?? 0) + tutar)
    let m = firmaAyTahsilat.get(ay)
    if (!m) firmaAyTahsilat.set(ay, (m = new Map()))
    m.set(i, (m.get(i) ?? 0) + tutar)
  }

  // --- Aylar: ilk hareketten son harekete kesintisiz ---
  const ayAnahtarlari = [...ayBorc.keys(), ...ayTahsilat.keys()].sort()
  const aylar: TahsilatDurumu['aylar'] = []
  if (ayAnahtarlari.length > 0) {
    for (let ay = ayAnahtarlari[0]; ay <= ayAnahtarlari[ayAnahtarlari.length - 1]; ay = addMonths(ay, 1)) {
      aylar.push({ ay, ad: trMonth(ay), vadeBorc: ayBorc.get(ay)?.borc ?? 0, vadeKalan: ayBorc.get(ay)?.kalan ?? 0, tahsilat: ayTahsilat.get(ay) ?? 0 })
    }
  }

  // --- Dönem: istenen ay; yoksa tahsilat kaydı olan son ay (bu ayı geçmeyen); o da yoksa bu ay ---
  const buAy = bugun.slice(0, 7)
  const tahsilatAylari = [...ayTahsilat.keys()].filter((a) => a <= buAy).sort()
  const donemAyi = secenek.ay ?? tahsilatAylari[tahsilatAylari.length - 1] ?? buAy
  const donemFirmalari = Array.from(firmaAyTahsilat.get(donemAyi) ?? [])
    .map(([i, tutar]) => ({ kod: firmalar[i].kod, ad: firmalar[i].ad, sorumlu: firmalar[i].sorumlu, tutar }))
    .sort((x, y) => y.tutar - x.tutar || TR.compare(x.ad, y.ad))

  // --- Kapsamdaki firmalar ve toplamlar ---
  const secili = firmalar.filter((_, i) => kapsamda[i])
  const topla = (liste: RaporFirma[], alan: 'borc' | 'odeme' | 'kalan' | 'gecikmis' | 'pesinKalan' | 'vadeliKalan') => liste.reduce((t, f) => t + f[alan], 0)
  const borc = topla(secili, 'borc')
  const odeme = topla(secili, 'odeme')
  const kalan = topla(secili, 'kalan')

  // --- Sorumlu kırılımı (alacak: taksiti olmayan alacaklı firmalar da sayılır) ---
  const sorumluHaritasi = new Map<string, RaporToplami & { ad: string; anahtar: string }>()
  const sorumluSatiri = (s: string | null) => {
    const anahtar = s ?? SORUMLUSUZ
    let r = sorumluHaritasi.get(anahtar)
    if (!r) sorumluHaritasi.set(anahtar, (r = { ad: s ?? 'Sorumlusu yok', anahtar, firma: 0, borc: 0, odeme: 0, kalan: 0, gecikmis: 0, alacak: 0 }))
    return r
  }
  for (const f of secili) {
    const r = sorumluSatiri(f.sorumlu)
    r.firma++
    r.borc += f.borc
    r.odeme += f.odeme
    r.kalan += f.kalan
    r.gecikmis += f.gecikmis
  }
  for (const a of alacaklilar) sorumluSatiri(a.sorumlu).alacak += a.alacak
  const sorumlular = Array.from(sorumluHaritasi.values()).sort((x, y) => (x.anahtar === SORUMLUSUZ ? 1 : y.anahtar === SORUMLUSUZ ? -1 : TR.compare(x.ad, y.ad)))

  // --- Kategori kırılımı (panel sırasıyla) ---
  const sira = new Map(b.kategoriler.map((k) => [k.kod, k.sira]))
  const kategoriler = Array.from(kategori.entries())
    .map(([kod, k]) => ({ kod, ad: kategoriEtiketi(b.kategoriler, kod), borc: k.borc, odeme: k.borc - k.kalan, kalan: k.kalan, gecikmis: k.gecikmis, firma: k.firmalar.size }))
    .sort((x, y) => (sira.get(x.kod) ?? 500) - (sira.get(y.kod) ?? 500) || x.kod.localeCompare(y.kod))

  // --- Uyarılar ---
  const tz = b.tazelik
  const veriYasi = tz?.son_odeme_tarihi ? gunFarki(tz.son_odeme_tarihi, bugun) : null
  const uyarilar: string[] = []
  const y = veri.yonetim
  if (y) {
    const s = y.saglik
    if (s.siniflandirilmamis > 0) uyarilar.push(`${s.siniflandirilmamis} irsaliye sınıflandırılmadı; borç hesabına katılmıyor (İnceleme → Sınıflandırma).`)
    if (s.inceleme > 0) uyarilar.push(`${s.inceleme} irsaliye inceleme bekliyor.`)
    if (s.plan_okunamadi > 0) uyarilar.push(`${s.plan_okunamadi} irsaliyenin ödeme planı okunamadı; vadesi irsaliye tarihi sayıldı.`)
    if (y.tarihsiz_taksit > 0) uyarilar.push(`${y.tarihsiz_taksit} açık taksitte vade tarihi girilmemiş.`)
    if ((y.odeme_eur_eksik?.adet ?? 0) > 0) uyarilar.push(`${y.odeme_eur_eksik!.adet} ödemenin EUR tutarı yok; hiçbir borca işlenmedi (İnceleme → Ödeme Tutarı).`)
    if ((y.son_kosu?.kdv_eslesmeyen ?? 0) > 0) uyarilar.push(`${y.son_kosu!.kdv_eslesmeyen} KDV ödemesi irsaliyeyle eşleşmedi; hesaba girmedi.`)
    if (y.firmalar.sorumlusuz > 0) uyarilar.push(`${y.firmalar.sorumlusuz} firmada sorumlu atanmamış (Yönetim → Bayiler ve Sorumlular).`)
    if (y.firmalar.sorumlu_eslesmeyen > 0) uyarilar.push(`${y.firmalar.sorumlu_eslesmeyen} firmanın sorumlu e-postası hiçbir aktif kullanıcıyla eşleşmiyor.`)
  }

  const sorumluSirasi = (x: RaporFirma, z: RaporFirma) =>
    x.sorumlu !== z.sorumlu ? (x.sorumlu === null ? 1 : z.sorumlu === null ? -1 : TR.compare(x.sorumlu, z.sorumlu)) : TR.compare(x.ad, z.ad) || TR.compare(x.kod, z.kod)

  return {
    bugun,
    kapsam: kapsamAdi(secenek.sorumlu),
    suzuldu: secenek.sorumlu !== '',
    tazelik: tz,
    veriYasi,
    ozet: {
      firma: secili.length,
      borcluFirma: secili.filter((f) => f.kalan > 0).length,
      gecikenFirma: secili.filter((f) => f.gecikmis > 0).length,
      borc,
      odeme,
      alacak,
      toplamTahsilat: odeme + alacak,
      kalan,
      pesinKalan: topla(secili, 'pesinKalan'),
      vadeliKalan: topla(secili, 'vadeliKalan'),
      gecikmis: ozet.gecikmisPesin + ozet.gecikmisVadeli,
      gecikmisPesin: ozet.gecikmisPesin,
      gecikmisVadeli: ozet.gecikmisVadeli,
      gun7: ozet.gun7,
      gun30: ozet.gun30,
    },
    yaslandirma: [
      { ad: 'Vadesi gelmemiş', tutar: yas[0] },
      { ad: '1–30 gün', tutar: yas[1] },
      { ad: '31–60 gün', tutar: yas[2] },
      { ad: '61–90 gün', tutar: yas[3] },
      { ad: '90+ gün', tutar: yas[4] },
    ],
    kategoriler,
    sorumlular,
    aylar,
    tarihsizTahsilat,
    donem: { ay: donemAyi, ad: trMonth(donemAyi), otomatik: secenek.ay === null, toplam: donemFirmalari.reduce((t, f) => t + f.tutar, 0), firmalar: donemFirmalari },
    enCokGeciken: secili.filter((f) => f.gecikmis > 0).sort((x, z) => z.gecikmis - x.gecikmis || z.gecikmeGunu - x.gecikmeGunu || TR.compare(x.ad, z.ad)),
    firmalar: secili.filter((f) => f.kalan > 0 || f.alacak > 0).sort(sorumluSirasi),
    alacaklilar: alacaklilar.sort((x, z) => z.alacak - x.alacak || TR.compare(x.ad, z.ad)),
    uyarilar,
  }
}

/** Rapor seçeneklerini adres parametrelerinden okur (geçersiz değerler varsayılana döner). */
export function raporSecenegiOku(p: URLSearchParams): RaporSecenegi {
  const tur = p.get('tur')
  const ay = p.get('ay') ?? ''
  return {
    tur: tur === 'kisa' || tur === 'ayrintili' ? tur : 'ozet',
    sorumlu: (p.get('sorumlu') ?? '').trim().slice(0, 100),
    ay: /^\d{4}-(0[1-9]|1[0-2])$/.test(ay) ? ay : null,
  }
}
