import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { eur, trDate, trMonth } from '@/lib/format'
import { formatCents } from '@/lib/engine/money'
import { metinGenisligi, sigdir } from '@/lib/pdf/olcu'
import {
  PDF_RENK,
  TABLO_YAZI_BOYU,
  baslikBandi,
  belge,
  bolum,
  bolumBasligi,
  cubukListesi,
  dipnot,
  gostergeKutulari,
  tablo,
  uyariKutusu,
  yigilmisCubuk,
  yildizGenisligi,
  type Hucre,
  type Sutun,
} from '@/lib/pdf/parcalar'
import { RAPOR_TURLERI, aylariDerle, type RaporFirma, type RaporTuru, type TahsilatDurumu } from './tahsilatDurumu'
import { kisaUnvan } from './unvan'

// TAHSİLAT DURUM RAPORU — PDF belgesi (pdfmake belge ağacı).
// Sayıların hepsi tahsilatDurumuKur çıktısından gelir; burada yalnız dizilir.
//   kisa      : tek sayfa — ana rakamlar, yaşlandırma, en çok geciken 10 firma
//   ozet      : kısa (15 firma) + kategori ve sorumlu kırılımı + aylık vade / tahsilat + dönem tahsilatı + veri uyarıları
//   ayrintili : özet + her sorumlu için firma listesi + alacaklı firmalar
//
// Firma unvanları tablolarda TEK satırdır: sütuna sığmayan unvan kısaltılır (bkz. unvan.ts).
// Hiçbir firmaya sorumlu atanmamışsa "Sorumlu" sütunu ve sorumlu kırılımı çizilmez.

const YAS_RENKLERI = ['#94a3b8', '#fbbf24', '#f97316', '#ef4444', '#991b1b']
/** Veri bu kadar günden eskiyse ilk sayfada uyarı çıkar */
const ESKI_VERI_GUNU = 7

const para = (v: number): string => formatCents(v)
const yuzde = (pay: number, payda: number): string => (payda > 0 ? `%${Math.round((pay / payda) * 100)}` : '—')
const kirmizi = (v: number): Hucre => (v > 0 ? { text: para(v), color: PDF_RENK.kirmizi } : { text: '–', color: PDF_RENK.soluk })
const tarih = (iso: string | null): string => (iso ? trDate(iso) : '–')
/** Bir sütunun metin genişliğine sığdırılmış düz metin (sorumlu adı gibi) */
const sigan = (metin: string, genislik: number): string => sigdir(metin, genislik, TABLO_YAZI_BOYU)

/** "KOD  UNVAN" — `genislik` pt'lik tek satıra sığacak biçimde; `ek` unvandan sonra aynen eklenir */
function firmaHucresi(f: { kod: string; ad: string }, genislik: number, ek = ''): string {
  const on = `${f.kod}  `
  return on + kisaUnvan(f.ad, genislik - metinGenisligi(on + ek, TABLO_YAZI_BOYU), TABLO_YAZI_BOYU) + ek
}

const SORUMLU_GENISLIGI = 56

function gecikenTablosu(firmalar: RaporFirma[], sorumluSutunu: boolean): Content {
  const sutunlar: Sutun[] = [
    { baslik: 'Firma', genislik: '*' },
    ...(sorumluSutunu ? [{ baslik: 'Sorumlu', genislik: SORUMLU_GENISLIGI } as Sutun] : []),
    { baslik: 'Vadesi geçmiş €', genislik: 60, hiza: 'right' },
    { baslik: 'En eski vade', genislik: 46, hiza: 'right' },
    { baslik: 'Gün', genislik: 22, hiza: 'right' },
    { baslik: 'Toplam kalan €', genislik: 60, hiza: 'right' },
    { baslik: 'Son tahsilat', genislik: 46, hiza: 'right' },
  ]
  const g = yildizGenisligi(sutunlar)
  return tablo(
    sutunlar,
    firmalar.map((f) => [
      firmaHucresi(f, g),
      ...(sorumluSutunu ? [sigan(f.sorumlu ?? '–', SORUMLU_GENISLIGI)] : []),
      { text: para(f.gecikmis), bold: true, color: PDF_RENK.kirmizi },
      tarih(f.enEskiVade),
      String(f.gecikmeGunu),
      para(f.kalan),
      tarih(f.sonTahsilat),
    ]),
  )
}

/** Alacağı da olan borçlu firmanın unvanına eklenen işaret (açıklaması tablonun altında) */
const ALACAK_ISARETI = ' †'

function firmaTablosu(firmalar: RaporFirma[]): Content[] {
  const t = firmalar.reduce((a, f) => ({ borc: a.borc + f.borc, odeme: a.odeme + f.odeme, kalan: a.kalan + f.kalan, gecikmis: a.gecikmis + f.gecikmis }), { borc: 0, odeme: 0, kalan: 0, gecikmis: 0 })
  const sutunlar: Sutun[] = [
    { baslik: 'Firma', genislik: '*' },
    { baslik: 'Toplam borç €', genislik: 54, hiza: 'right' },
    { baslik: 'Ödenen €', genislik: 54, hiza: 'right' },
    { baslik: 'Kalan €', genislik: 54, hiza: 'right' },
    { baslik: 'Vadesi geçmiş €', genislik: 54, hiza: 'right' },
    { baslik: 'En eski vade', genislik: 42, hiza: 'right' },
    { baslik: 'Son tahsilat', genislik: 42, hiza: 'right' },
  ]
  const g = yildizGenisligi(sutunlar)
  const alacakli = firmalar.some((f) => f.alacak > 0)
  return [
    tablo(
      sutunlar,
      firmalar.map((f) => [
        firmaHucresi(f, g, f.alacak > 0 ? ALACAK_ISARETI : ''),
        para(f.borc),
        para(f.odeme),
        { text: para(f.kalan), bold: true },
        kirmizi(f.gecikmis),
        tarih(f.enEskiVade),
        tarih(f.sonTahsilat),
      ]),
      { toplam: [`TOPLAM · ${firmalar.length} firma`, para(t.borc), para(t.odeme), para(t.kalan), kirmizi(t.gecikmis), '', ''] },
    ),
    ...(alacakli ? [dipnot('† Firmanın borca işlenmemiş fazla ödemesi (alacağı) da var; tutarı "Alacaklı firmalar" tablosundadır.')] : []),
  ]
}

export function tahsilatDurumuBelgesi(d: TahsilatDurumu, tur: RaporTuru, uretimZamani: string): TDocumentDefinitions {
  const o = d.ozet
  const tz = d.tazelik
  const icerik: Content[] = []
  /** Kapsamdaki firmalardan en az birine sorumlu atanmış mı (hiç atanmamışsa sütun ve kırılım çizilmez) */
  const sorumluVar = d.firmalar.some((f) => f.sorumlu !== null) || d.alacaklilar.some((a) => a.sorumlu !== null)
  const sorumluSutunu = sorumluVar && !d.suzuldu

  // --- Başlık ---
  icerik.push(
    baslikBandi('Tahsilat Durum Raporu', `${RAPOR_TURLERI[tur].ad} · ${d.kapsam}`, [
      `Rapor tarihi: ${trDate(d.bugun)}`,
      `Son irsaliye: ${tarih(tz?.son_irsaliye_tarihi ?? null)}`,
      `Son ödeme kaydı: ${tarih(tz?.son_odeme_tarihi ?? null)}`,
    ]),
  )

  // --- Veri tazeliği uyarısı ---
  if (d.veriYasi !== null && d.veriYasi > ESKI_VERI_GUNU) {
    icerik.push(
      uyariKutusu([
        `Sistemdeki son ödeme kaydı ${trDate(tz!.son_odeme_tarihi)} tarihli (${d.veriYasi} gün önce). Rapor bu tarihe kadar yüklenen verilerle üretildi; ` +
          'güncel durum için yeni irsaliye ve ödeme dosyalarını yükleyin.',
      ]),
    )
  } else if (d.veriYasi === null) {
    icerik.push(uyariKutusu(['Sistemde ödeme kaydı yok; tahsilat rakamları boş görünür.']))
  }

  // --- Ana rakamlar ---
  icerik.push(
    gostergeKutulari([
      { baslik: 'Toplam satış', deger: eur(o.borc), alt: `${o.firma} firma` },
      { baslik: 'Toplam tahsilat', deger: eur(o.toplamTahsilat), ton: 'yesil', alt: `borca işlenen ${para(o.odeme)}\nalacak ${para(o.alacak)}` },
      { baslik: 'Açık borç', deger: eur(o.kalan), alt: `konsinye ${para(o.vadeliKalan)}\npeşin ${para(o.pesinKalan)}` },
      { baslik: 'Vadesi geçmiş', deger: eur(o.gecikmis), ton: o.gecikmis > 0 ? 'kirmizi' : 'normal', alt: `${o.gecikenFirma} firma\naçık borcun ${yuzde(o.gecikmis, o.kalan)}'i` },
      { baslik: 'Tahsilat oranı', deger: yuzde(o.odeme, o.borc), alt: 'borca işlenen ödeme ÷ satış' },
      { baslik: '7 gün içinde vadesi gelen', deger: eur(o.gun7), ton: o.gun7 > 0 ? 'amber' : 'normal', alt: 'konsinye, bugün dahil' },
      { baslik: '30 gün içinde vadesi gelen', deger: eur(o.gun30), alt: 'konsinye, bugün dahil' },
      { baslik: 'Alacak (fazla ödeme)', deger: eur(o.alacak), alt: `${d.alacaklilar.length} firma` },
    ]),
  )

  // --- Yaşlandırma ---
  icerik.push(
    bolum(
      'Açık borcun yaşı',
      'Kalan borcun, vadesinden bugüne kaç gün geçtiğine göre dağılımı (konsinye ve peşin birlikte).',
      [yigilmisCubuk(d.yaslandirma.map((y, i) => ({ ad: y.ad, tutar: y.tutar, renk: YAS_RENKLERI[i], yazi: eur(y.tutar) })))],
      true,
    ),
  )

  // --- En çok geciken firmalar ---
  const gecikenSayisi = tur === 'kisa' ? 10 : 15
  const gecikenler = d.enCokGeciken.slice(0, gecikenSayisi)
  icerik.push(
    bolum(
      `En çok geciken ${Math.min(gecikenSayisi, d.enCokGeciken.length)} firma`,
      d.enCokGeciken.length > gecikenler.length
        ? `Vadesi geçmiş borcu olan ${d.enCokGeciken.length} firmadan ilk ${gecikenler.length}; listedekiler vadesi geçmiş tutarın ${yuzde(gecikenler.reduce((t, f) => t + f.gecikmis, 0), o.gecikmis)}'ini oluşturur.`
        : undefined,
      [gecikenler.length > 0 ? gecikenTablosu(gecikenler, sorumluSutunu) : dipnot('Vadesi geçmiş borcu olan firma yok.')],
      true,
    ),
  )

  if (tur === 'kisa') {
    icerik.push(dipnot('Tanımlar — Vadesi geçmiş: vadesi bugünden önce olan kalan borç (peşin borcun vadesi irsaliye tarihidir). Tahsilat: ödemelerin borca işlenen kısmı; fazlası alacak olarak durur.'))
  } else {
    // --- Kategori kırılımı ---
    icerik.push(bolum('Satış kategorisine göre', undefined, [
      tablo(
        [
          { baslik: 'Kategori', genislik: '*' },
          { baslik: 'Satış €', genislik: 72, hiza: 'right' },
          { baslik: 'Ödenen €', genislik: 72, hiza: 'right' },
          { baslik: 'Kalan €', genislik: 72, hiza: 'right' },
          { baslik: 'Vadesi geçmiş €', genislik: 72, hiza: 'right' },
          { baslik: 'Borçlu firma', genislik: 50, hiza: 'right' },
        ],
        d.kategoriler.map((k) => [k.ad, para(k.borc), para(k.odeme), { text: para(k.kalan), bold: true }, kirmizi(k.gecikmis), String(k.firma)]),
        { toplam: ['TOPLAM', para(o.borc), para(o.odeme), para(o.kalan), kirmizi(o.gecikmis), String(o.borcluFirma)] },
      ),
    ], d.kategoriler.length <= 20))

    // --- Sorumlu kırılımı ---
    if (!sorumluVar) {
      icerik.push(bolum('Sorumluya göre', 'Firmalara henüz sorumlu atanmamış. Atama yapıldığında (Yönetim → Bayiler ve Sorumlular) bu bölümde her sorumlunun satış, tahsilat ve gecikmiş borç toplamı yer alır.', []))
    } else icerik.push(bolum('Sorumluya göre', undefined, [
      tablo(
        [
          { baslik: 'Sorumlu', genislik: '*' },
          { baslik: 'Firma', genislik: 34, hiza: 'right' },
          { baslik: 'Satış €', genislik: 68, hiza: 'right' },
          { baslik: 'Ödenen €', genislik: 68, hiza: 'right' },
          { baslik: 'Kalan €', genislik: 68, hiza: 'right' },
          { baslik: 'Vadesi geçmiş €', genislik: 68, hiza: 'right' },
          { baslik: 'Alacak €', genislik: 58, hiza: 'right' },
        ],
        d.sorumlular.map((s) => [s.ad, String(s.firma), para(s.borc), para(s.odeme), { text: para(s.kalan), bold: true }, kirmizi(s.gecikmis), s.alacak > 0 ? para(s.alacak) : '–']),
        { toplam: ['TOPLAM', String(o.firma), para(o.borc), para(o.odeme), para(o.kalan), kirmizi(o.gecikmis), o.alacak > 0 ? para(o.alacak) : '–'] },
      ),
    ], d.sorumlular.length <= 20))

    // --- Aylık vade ve tahsilat ---
    const buAy = d.bugun.slice(0, 7)
    const aySatirlari = aylariDerle(d.aylar, buAy)
    icerik.push(bolum('Aylara göre vade ve tahsilat', 'Vadesi gelen: o ay vadesi dolan taksitler. Tahsilat: o ay yapılan ödemelerin borca işlenen kısmı.', [
      tablo(
        [
          { baslik: 'Ay', genislik: '*' },
          { baslik: 'Vadesi gelen €', genislik: 84, hiza: 'right' },
          { baslik: 'Bu vadelerden kalan €', genislik: 92, hiza: 'right' },
          { baslik: 'Ödenme oranı', genislik: 60, hiza: 'right' },
          { baslik: 'O ay tahsilat €', genislik: 84, hiza: 'right' },
        ],
        aySatirlari.map((a) => [
          a.ay === buAy ? { text: `${a.ad}  (bu ay)`, bold: true } : a.ay === null ? { text: a.ad, italics: true } : a.ad,
          a.vadeBorc > 0 ? para(a.vadeBorc) : '–',
          a.vadeKalan > 0 ? { text: para(a.vadeKalan), color: a.ay === null || a.ay < buAy ? PDF_RENK.kirmizi : PDF_RENK.yazi } : '–',
          a.vadeBorc > 0 ? yuzde(a.vadeBorc - a.vadeKalan, a.vadeBorc) : '–',
          a.tahsilat > 0 ? para(a.tahsilat) : '–',
        ]),
        { toplam: ['TOPLAM', para(o.borc), para(o.kalan), yuzde(o.odeme, o.borc), para(o.odeme - d.tarihsizTahsilat)] },
      ),
      ...(d.tarihsizTahsilat > 0 ? [dipnot(`Ödeme tarihi olmayan kayıtlardan borca işlenen ${eur(d.tarihsizTahsilat)} aylara dağıtılamadı.`)] : []),
    ], aySatirlari.length <= 26))

    // --- Dönem tahsilatı ---
    const donemSirasi = d.aylar.findIndex((a) => a.ay === d.donem.ay)
    const sonAltiAy = donemSirasi >= 0 ? d.aylar.slice(Math.max(0, donemSirasi - 5), donemSirasi + 1) : []
    const donemIcerigi: Content[] = []
    if (sonAltiAy.length > 1) {
      donemIcerigi.push(cubukListesi(sonAltiAy.map((a) => ({ etiket: trMonth(a.ay), deger: a.tahsilat, yazi: eur(a.tahsilat), vurgu: a.ay === d.donem.ay }))))
    }
    if (d.donem.firmalar.length > 0) {
      const ilkOn = d.donem.firmalar.slice(0, 10)
      const sutunlar: Sutun[] = [
        { baslik: `${d.donem.ad} — en çok ödeme yapan firmalar`, genislik: '*' },
        ...(sorumluSutunu ? [{ baslik: 'Sorumlu', genislik: SORUMLU_GENISLIGI } as Sutun] : []),
        { baslik: 'Borca işlenen €', genislik: 84, hiza: 'right' },
        { baslik: 'Pay', genislik: 40, hiza: 'right' },
      ]
      const g = yildizGenisligi(sutunlar)
      donemIcerigi.push({ text: '', margin: [0, 0, 0, 6] })
      donemIcerigi.push(
        tablo(
          sutunlar,
          ilkOn.map((f) => [
            firmaHucresi(f, g),
            ...(sorumluSutunu ? [sigan(f.sorumlu ?? '–', SORUMLU_GENISLIGI)] : []),
            { text: para(f.tutar), bold: true },
            yuzde(f.tutar, d.donem.toplam),
          ]),
        ),
      )
      if (d.donem.firmalar.length > ilkOn.length) {
        donemIcerigi.push(dipnot(`Diğer ${d.donem.firmalar.length - ilkOn.length} firma: ${eur(d.donem.toplam - ilkOn.reduce((t, f) => t + f.tutar, 0))}.`))
      }
    } else {
      donemIcerigi.push(dipnot('Bu ay borca işlenen ödeme yok.'))
    }
    icerik.push(
      bolum(
        `${d.donem.ad} tahsilatı: ${eur(d.donem.toplam)}`,
        d.donem.otomatik ? `Tahsilat kaydı olan son ay. ${d.donem.firmalar.length} firmadan ödeme borca işlendi.` : `${d.donem.firmalar.length} firmadan ödeme borca işlendi.`,
        donemIcerigi,
        true,
      ),
    )

    // --- Veri uyarıları (yalnız yönetim) ---
    if (d.uyarilar.length > 0) {
      icerik.push(bolum('Veri uyarıları', 'Sistem geneli; raporun doğruluğunu etkileyebilecek açık işler.', [uyariKutusu(d.uyarilar, 'amber')], true))
    }
  }

  // --- Ayrıntı: sorumlu sorumlu firmalar ---
  if (tur === 'ayrintili') {
    for (const s of d.sorumlular) {
      const firmalar = d.firmalar.filter((f) => (f.sorumlu ?? '-') === s.anahtar && f.kalan > 0)
      if (firmalar.length === 0) continue
      const baslik = !sorumluVar ? 'Borcu olan firmalar' : s.anahtar === '-' ? 'Sorumlusu olmayan firmalar' : `Sorumlu: ${s.ad}`
      icerik.push({ text: baslik, fontSize: 13, bold: true, pageBreak: 'before', margin: [0, 0, 0, 6] })
      icerik.push(
        gostergeKutulari(
          [
            { baslik: 'Borcu olan firma', deger: String(firmalar.length), alt: `${s.firma} firmadan` },
            { baslik: 'Açık borç', deger: eur(s.kalan) },
            { baslik: 'Vadesi geçmiş', deger: eur(s.gecikmis), ton: s.gecikmis > 0 ? 'kirmizi' : 'normal', alt: `açık borcun ${yuzde(s.gecikmis, s.kalan)}'i` },
            { baslik: 'Tahsilat oranı', deger: yuzde(s.odeme, s.borc), alt: `ödenen ${para(s.odeme)}` },
          ],
          4,
        ),
      )
      icerik.push({ text: '', margin: [0, 0, 0, 8] })
      icerik.push(...firmaTablosu(firmalar))
    }
    if (d.alacaklilar.length > 0) {
      icerik.push(bolumBasligi(`Alacaklı firmalar (${d.alacaklilar.length})`, 'Ödemesi borcundan fazla olan firmalar; fazlası sonraki borca kendiliğinden işlenir.'))
      const sutunlar: Sutun[] = [
        { baslik: 'Firma', genislik: '*' },
        ...(sorumluSutunu ? [{ baslik: 'Sorumlu', genislik: SORUMLU_GENISLIGI } as Sutun] : []),
        { baslik: 'Alacak €', genislik: 80, hiza: 'right' },
      ]
      const g = yildizGenisligi(sutunlar)
      icerik.push(
        tablo(
          sutunlar,
          d.alacaklilar.map((a) => [firmaHucresi(a, g), ...(sorumluSutunu ? [sigan(a.sorumlu ?? '–', SORUMLU_GENISLIGI)] : []), { text: para(a.alacak), bold: true }]),
          { toplam: ['TOPLAM', ...(sorumluSutunu ? [''] : []), para(o.alacak)] },
        ),
      )
    }
  }

  if (tur !== 'kisa') {
    icerik.push(
      dipnot(
        'Tanımlar — Satış: hesaba katılan irsaliyelerin taksit tutarı (iptal, 31/12 tarihli, sınıflandırılmamış ve takip dışı firmalar hariç). ' +
          'Ödenen: ödemelerin borca işlenen kısmı. Alacak: borca işlenemeyen fazla ödeme. Toplam tahsilat = ödenen + alacak. ' +
          'Vadesi geçmiş: vadesi bugünden önce olan kalan borç; peşin borcun vadesi irsaliye tarihidir. ' +
          'Ödemeler önce peşin borçları (en eskiden), sonra en yakın vadeli taksitleri kapatır.',
      ),
    )
  }

  return belge(icerik, {
    baslik: `Tahsilat Durum Raporu — ${RAPOR_TURLERI[tur].ad} · ${d.kapsam} · ${trDate(d.bugun)}`,
    altBilgi: `Avrupa Tahsilat Sistemi · üretim ${uretimZamani} · son ödeme kaydı ${tarih(tz?.son_odeme_tarihi ?? null)}`,
  })
}

/** İndirilen dosyanın adı (yalnız ASCII) */
export function tahsilatDurumuDosyaAdi(bugun: string, tur: RaporTuru, sorumluEki: string): string {
  return `tahsilat_durumu_${tur}${sorumluEki ? '_' + sorumluEki : ''}_${bugun}.pdf`
}
