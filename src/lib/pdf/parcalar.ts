import type { Content, CustomTableLayout, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import { pdfMetni as m } from './karakter'

// PDF belgelerinin ortak parçaları (pdfmake belge ağacı üreten saf işlevler).
// Her işlev HER çağrıda yeni nesneler döndürür: pdfmake verilen ağacı yerinde değiştirir.
// Bütün metinler pdfMetni'den (m) geçer: yazı tipinde olmayan işaretler karşılıklarıyla yazılır.

export const PDF_RENK = {
  yazi: '#0f172a',
  soluk: '#64748b',
  cizgi: '#cbd5e1',
  inceCizgi: '#e2e8f0',
  zemin: '#f1f5f9',
  zebra: '#f8fafc',
  mavi: '#1d4ed8',
  kirmizi: '#b91c1c',
  amber: '#b45309',
  yesil: '#047857',
  beyaz: '#ffffff',
} as const

/** A4 dikey, kenar boşlukları düşülmüş içerik genişliği (pt) */
export const SAYFA_KENARI = 36
export const ICERIK_GENISLIGI = 595.28 - 2 * SAYFA_KENARI

export type Ton = 'normal' | 'kirmizi' | 'amber' | 'yesil' | 'mavi'
const TON_RENGI: Record<Ton, string> = { normal: PDF_RENK.yazi, kirmizi: PDF_RENK.kirmizi, amber: PDF_RENK.amber, yesil: PDF_RENK.yesil, mavi: PDF_RENK.mavi }

/** Belgenin başlığı: solda ad ve alt başlık, sağda künye satırları; altında çizgi. */
export function baslikBandi(baslik: string, altBaslik: string, kunye: string[]): Content {
  return {
    stack: [
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: m(baslik), fontSize: 17, bold: true, color: PDF_RENK.yazi },
              { text: m(altBaslik), fontSize: 9.5, color: PDF_RENK.soluk, margin: [0, 2, 0, 0] },
            ],
          },
          { width: 'auto', stack: kunye.map((k) => ({ text: m(k), fontSize: 7.5, color: PDF_RENK.soluk, alignment: 'right' as const })) },
        ],
      },
      { canvas: [{ type: 'rect', x: 0, y: 6, w: ICERIK_GENISLIGI, h: 1.5, color: PDF_RENK.mavi }] },
    ],
    margin: [0, 0, 0, 10],
  }
}

/**
 * Bölüm başlığı (isteğe bağlı açıklama satırıyla). TEK metin düğümüdür: sayfanın en
 * altında tek başına kalırsa `belge()` içindeki kural onu sonraki sayfaya taşır.
 */
export function bolumBasligi(metin: string, aciklama?: string, yalnizKalabilir = false): Content {
  return {
    text: [
      { text: m(metin), fontSize: 10.5, bold: true, color: PDF_RENK.yazi },
      ...(aciklama ? [{ text: '\n' + m(aciklama), fontSize: 7.5, color: PDF_RENK.soluk }] : []),
    ],
    margin: [0, 12, 0, 5],
    // Arkasından içerik gelmeyen başlık kurala sokulmaz: "yalnız kaldı" sayılıp boş sayfa üretir.
    ...(yalnizKalabilir ? {} : { headlineLevel: 1 }),
  }
}

/**
 * Başlığı ve içeriği bir arada tutan bölüm. `bolunmez` kısa içerikler içindir:
 * bölüm sayfa sonuna sığmazsa ikiye bölünmek yerine bütün olarak sonraki sayfaya geçer.
 * (Bir sayfadan uzun olabilecek tablolarda kullanılmaz.)
 */
export function bolum(baslik: string, aciklama: string | undefined, icerik: Content[], bolunmez = false): Content {
  // İçeriksiz bölüm (yalnız başlık + açıklama) kendi başına bir paragraftır.
  if (icerik.length === 0) return bolumBasligi(baslik, aciklama, true)
  return { stack: [bolumBasligi(baslik, aciklama), ...icerik], unbreakable: bolunmez }
}

export interface Gosterge {
  baslik: string
  deger: string
  alt?: string
  ton?: Ton
}

const KUTU_DUZENI: CustomTableLayout = {
  hLineWidth: () => 0.7,
  vLineWidth: () => 0.7,
  hLineColor: () => PDF_RENK.cizgi,
  vLineColor: () => PDF_RENK.cizgi,
  paddingLeft: () => 7,
  paddingRight: () => 7,
  paddingTop: () => 6,
  paddingBottom: () => 6,
}

/** Gösterge kutuları: satır başına `sutun` kutu; eksik kutular boş bırakılır. */
export function gostergeKutulari(ogeler: Gosterge[], sutun = 4): Content {
  const hucre = (o: Gosterge | undefined): TableCell =>
    o
      ? {
          stack: [
            { text: m(o.baslik).toLocaleUpperCase('tr-TR'), fontSize: 6.5, color: PDF_RENK.soluk, characterSpacing: 0.3 },
            { text: m(o.deger), fontSize: 12, bold: true, color: TON_RENGI[o.ton ?? 'normal'], margin: [0, 2, 0, 0] },
            ...(o.alt ? [{ text: m(o.alt), fontSize: 7, color: PDF_RENK.soluk, margin: [0, 1, 0, 0] as [number, number, number, number] }] : []),
          ],
        }
      : { text: '' }
  const satirlar: TableCell[][] = []
  for (let i = 0; i < ogeler.length; i += sutun) {
    satirlar.push(Array.from({ length: sutun }, (_, j) => hucre(ogeler[i + j])))
  }
  return { table: { widths: Array.from({ length: sutun }, () => '*'), body: satirlar }, layout: KUTU_DUZENI }
}

export interface Sutun {
  baslik: string
  genislik: number | '*' | 'auto'
  hiza?: 'left' | 'right' | 'center'
}

/** tablo() gövde yazısının varsayılan boyu (pt) */
export const TABLO_YAZI_BOYU = 7.5
/** tablo() hücrelerinin sol ve sağ iç boşluğu (pt) */
const HUCRE_YAN_BOSLUGU = 4

/**
 * tablo() ile çizilen bir tabloda '*' sütununun METİN genişliği (pt): içerik genişliğinden
 * sabit sütunlar ve hücre boşlukları düşülür; birden çok '*' varsa eşit paylaşılır.
 * Tek satırda kalması gereken hücreleri (firma unvanı) sığdırmak için kullanılır.
 */
export function yildizGenisligi(sutunlar: Sutun[], toplam = ICERIK_GENISLIGI): number {
  const sabit = sutunlar.reduce((t, s) => t + (typeof s.genislik === 'number' ? s.genislik : 0), 0)
  const yildiz = sutunlar.filter((s) => s.genislik === '*').length || 1
  return (toplam - sabit - sutunlar.length * 2 * HUCRE_YAN_BOSLUGU) / yildiz
}

export type Hucre = string | { text: string; bold?: boolean; color?: string; italics?: boolean }

export interface TabloSecenegi {
  /** en altta kalın toplam satırı */
  toplam?: Hucre[]
  yaziBoyu?: number
  /** tablo sayfa sonunda bölünürse başlık yinelenir (varsayılan: evet) */
  baslikYinele?: boolean
}

/** Çizgili, başlığı dolgulu, sıra sıra hafif renkli veri tablosu. */
export function tablo(sutunlar: Sutun[], satirlar: Hucre[][], secenek: TabloSecenegi = {}): Content {
  const boy = secenek.yaziBoyu ?? TABLO_YAZI_BOYU
  const hucre = (h: Hucre, i: number, kalin = false): TableCell => {
    const o = typeof h === 'string' ? { text: h } : h
    return { text: m(o.text), fontSize: boy, alignment: sutunlar[i].hiza ?? 'left', bold: kalin || !!o.bold, color: o.color ?? PDF_RENK.yazi, italics: !!o.italics }
  }
  const govde: TableCell[][] = [
    sutunlar.map((s) => ({ text: m(s.baslik), fontSize: boy - 0.5, bold: true, color: PDF_RENK.soluk, alignment: s.hiza ?? 'left' })),
    ...satirlar.map((r) => r.map((h, i) => hucre(h, i))),
    ...(secenek.toplam ? [secenek.toplam.map((h, i) => hucre(h, i, true))] : []),
  ]
  const sonSatir = govde.length - 1
  const duzen: CustomTableLayout = {
    hLineWidth: (i) => (i === 0 || i === 1 || i === govde.length || (secenek.toplam && i === sonSatir) ? 0.8 : 0.4),
    vLineWidth: () => 0,
    hLineColor: (i) => (i === 0 || i === 1 || i === govde.length || (secenek.toplam && i === sonSatir) ? PDF_RENK.cizgi : PDF_RENK.inceCizgi),
    fillColor: (satir) => (satir === 0 ? PDF_RENK.zemin : secenek.toplam && satir === sonSatir ? PDF_RENK.zemin : satir % 2 === 0 ? PDF_RENK.zebra : null),
    paddingLeft: () => HUCRE_YAN_BOSLUGU,
    paddingRight: () => HUCRE_YAN_BOSLUGU,
    paddingTop: () => 2.5,
    paddingBottom: () => 2.5,
  }
  return {
    table: { headerRows: secenek.baslikYinele === false ? 0 : 1, dontBreakRows: true, widths: sutunlar.map((s) => s.genislik), body: govde },
    layout: duzen,
  }
}

export interface CubukParcasi {
  ad: string
  tutar: number
  renk: string
  /** açıklama satırında gösterilecek değer metni */
  yazi: string
}

/** Tek satır yığılmış çubuk + altında açıklama (ad, değer, pay). Toplam 0 ise yalnız açıklama. */
export function yigilmisCubuk(parcalar: CubukParcasi[], genislik = ICERIK_GENISLIGI): Content {
  const toplam = parcalar.reduce((t, p) => t + Math.max(0, p.tutar), 0)
  let x = 0
  const dikdortgenler = parcalar
    .filter((p) => p.tutar > 0 && toplam > 0)
    .map((p) => {
      const w = (p.tutar / toplam) * genislik
      const d = { type: 'rect' as const, x, y: 0, w, h: 11, color: p.renk }
      x += w
      return d
    })
  return {
    stack: [
      ...(dikdortgenler.length > 0 ? [{ canvas: dikdortgenler }] : []),
      {
        margin: [0, 5, 0, 0],
        table: {
          widths: parcalar.map(() => '*'),
          body: [
            parcalar.map((p) => ({
              stack: [
                { columns: [{ width: 9, canvas: [{ type: 'rect' as const, x: 0, y: 1.5, w: 6, h: 6, color: p.renk }] }, { width: '*', text: m(p.ad), fontSize: 7, color: PDF_RENK.soluk }] },
                { text: m(p.yazi), fontSize: 8.5, bold: true, color: PDF_RENK.yazi, margin: [0, 1, 0, 0] as [number, number, number, number] },
                { text: toplam > 0 ? `%${Math.round((Math.max(0, p.tutar) / toplam) * 100)}` : '', fontSize: 7, color: PDF_RENK.soluk },
              ],
            })),
          ],
        },
        layout: 'noBorders',
      },
    ],
  }
}

export interface CubukSatiri {
  etiket: string
  deger: number
  yazi: string
  /** vurgulu satır (ör. seçili dönem) */
  vurgu?: boolean
}

/** Yatay çubuk listesi: etiket · çubuk · değer. */
export function cubukListesi(satirlar: CubukSatiri[], secenek: { etiketGenisligi?: number; degerGenisligi?: number; renk?: string } = {}): Content {
  const eg = secenek.etiketGenisligi ?? 70
  const dg = secenek.degerGenisligi ?? 80
  const cubukAlani = ICERIK_GENISLIGI - eg - dg - 24
  const enBuyuk = Math.max(1, ...satirlar.map((s) => s.deger))
  return {
    table: {
      widths: [eg, cubukAlani, dg],
      body: satirlar.map((s) => [
        { text: m(s.etiket), fontSize: 7.5, bold: !!s.vurgu, color: s.vurgu ? PDF_RENK.yazi : PDF_RENK.soluk },
        { canvas: [{ type: 'rect' as const, x: 0, y: 1.5, w: Math.max(s.deger > 0 ? 1.5 : 0, (s.deger / enBuyuk) * cubukAlani), h: 7, color: s.vurgu ? PDF_RENK.mavi : (secenek.renk ?? '#93c5fd') }] },
        { text: m(s.yazi), fontSize: 7.5, bold: !!s.vurgu, alignment: 'right' as const, color: PDF_RENK.yazi },
      ]),
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 1.5, paddingBottom: () => 1.5 },
  }
}

const KUTU_TONU: Record<'amber' | 'mavi' | 'kirmizi', { zemin: string; cizgi: string; yazi: string }> = {
  amber: { zemin: '#fffbeb', cizgi: '#fcd34d', yazi: '#78350f' },
  mavi: { zemin: '#eff6ff', cizgi: '#93c5fd', yazi: '#1e3a8a' },
  kirmizi: { zemin: '#fef2f2', cizgi: '#fca5a5', yazi: '#7f1d1d' },
}

/** Uyarı / bilgi kutusu: isteğe bağlı başlık ve madde madde satırlar. */
export function uyariKutusu(satirlar: string[], ton: 'amber' | 'mavi' | 'kirmizi' = 'amber', baslik?: string): Content {
  const t = KUTU_TONU[ton]
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [
              ...(baslik ? [{ text: m(baslik), fontSize: 8, bold: true, color: t.yazi, margin: [0, 0, 0, 2] as [number, number, number, number] }] : []),
              ...(satirlar.length === 1 && !baslik
                ? [{ text: m(satirlar[0]), fontSize: 8, color: t.yazi }]
                : [{ ul: satirlar.map((s) => ({ text: m(s), fontSize: 7.5, color: t.yazi })), markerColor: t.yazi }]),
            ],
            fillColor: t.zemin,
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.8,
      vLineWidth: () => 0.8,
      hLineColor: () => t.cizgi,
      vLineColor: () => t.cizgi,
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    margin: [0, 0, 0, 8],
  }
}

/** Küçük, soluk açıklama paragrafı */
export function dipnot(metin: string): Content {
  return { text: m(metin), fontSize: 7, color: PDF_RENK.soluk, margin: [0, 6, 0, 0], lineHeight: 1.15 }
}

export interface BelgeSecenegi {
  /** PDF başlığı (dosya özellikleri) ve 2. sayfadan itibaren üst bilgi */
  baslik: string
  /** her sayfanın altında, solda */
  altBilgi: string
  yatay?: boolean
}

/** Ortak sayfa düzeni: A4, üst bilgi (2. sayfadan itibaren), alt bilgi ve sayfa numarası. */
export function belge(icerik: Content[], s: BelgeSecenegi): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: s.yatay ? 'landscape' : 'portrait',
    pageMargins: [SAYFA_KENARI, 44, SAYFA_KENARI, 40],
    info: { title: m(s.baslik), creator: 'Avrupa Tahsilat Sistemi', producer: 'Avrupa Tahsilat Sistemi' },
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: PDF_RENK.yazi, lineHeight: 1.1 },
    header: (sayfa: number) =>
      sayfa === 1 ? null : { text: m(s.baslik), fontSize: 7, color: PDF_RENK.soluk, alignment: 'right', margin: [SAYFA_KENARI, 20, SAYFA_KENARI, 0] },
    footer: (sayfa: number, toplam: number) => ({
      columns: [
        { width: '*', text: m(s.altBilgi), fontSize: 6.5, color: PDF_RENK.soluk },
        { width: 'auto', text: `Sayfa ${sayfa} / ${toplam}`, fontSize: 6.5, color: PDF_RENK.soluk, alignment: 'right' },
      ],
      margin: [SAYFA_KENARI, 14, SAYFA_KENARI, 0],
    }),
    // Bölüm başlığı sayfanın en altında tek başına kalmasın
    pageBreakBefore: (dugum, sorgu) => dugum.headlineLevel === 1 && sorgu.getFollowingNodesOnPage().length === 0,
    content: icerik,
  }
}
