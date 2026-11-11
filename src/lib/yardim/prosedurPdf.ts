import type { Content, CustomTableLayout, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import { trDate } from '@/lib/format'
import { ICERIK_GENISLIGI, PDF_RENK, baslikBandi, belge } from '@/lib/pdf/parcalar'
import { pdfMetni } from '@/lib/pdf/karakter'
import { kalinParcala, type Blok, type KutuTonu, type Prosedur } from './bloklar'

// İŞ AKIŞ PROSEDÜRÜ — PDF belgesi. İçerik src/lib/yardim/icerik.ts'ten gelir;
// aynı içerik /yardim sayfasında da gösterilir.

const GOVDE = 9
// Ok işareti (→) yazı tipinde yok: PDF'te ›  olarak yazılır (bkz. pdfMetni)
const metin = (s: string) => kalinParcala(pdfMetni(s)).map((p) => ({ text: p.metin, bold: p.kalin }))

const KUTU: Record<KutuTonu, { zemin: string; cizgi: string; yazi: string; ad: string }> = {
  bilgi: { zemin: '#eff6ff', cizgi: '#93c5fd', yazi: '#1e3a8a', ad: 'Bilgi' },
  uyari: { zemin: '#fffbeb', cizgi: '#fcd34d', yazi: '#78350f', ad: 'Dikkat' },
  ornek: { zemin: '#f8fafc', cizgi: '#cbd5e1', yazi: '#0f172a', ad: 'Örnek' },
}

const TABLO_DUZENI: CustomTableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => PDF_RENK.cizgi,
  vLineColor: () => PDF_RENK.cizgi,
  fillColor: (satir) => (satir === 0 ? PDF_RENK.zemin : null),
  paddingLeft: () => 5,
  paddingRight: () => 5,
  paddingTop: () => 3.5,
  paddingBottom: () => 3.5,
}

function blokIcerigi(b: Blok): Content {
  switch (b.tur) {
    case 'paragraf':
      return { text: metin(b.metin), fontSize: GOVDE, lineHeight: 1.3, margin: [0, 0, 0, 6] }
    case 'altbaslik':
      return { text: pdfMetni(b.metin), fontSize: 10.5, bold: true, color: PDF_RENK.yazi, margin: [0, 8, 0, 4], headlineLevel: 1 }
    case 'adimlar':
      return { ol: b.ogeler.map((o) => ({ text: metin(o), fontSize: GOVDE, lineHeight: 1.3, margin: [0, 0, 0, 2.5] as [number, number, number, number] })), margin: [0, 0, 0, 6] }
    case 'liste':
      return { ul: b.ogeler.map((o) => ({ text: metin(o), fontSize: GOVDE, lineHeight: 1.3, margin: [0, 0, 0, 2.5] as [number, number, number, number] })), margin: [0, 0, 0, 6] }
    case 'tablo': {
      const n = b.basliklar.length
      const oranlar = b.genislikler ?? b.basliklar.map(() => 1)
      const toplamOran = oranlar.reduce((t, g) => t + g, 0)
      // hücre dolguları (2 × 5) ve çizgiler düşülür; sütunlar orana göre paylaşır
      const kullanilabilir = ICERIK_GENISLIGI - n * 10 - (n + 1) * 0.5
      const govde: TableCell[][] = [
        b.basliklar.map((h) => ({ text: pdfMetni(h), fontSize: 8, bold: true, color: PDF_RENK.soluk })),
        ...b.satirlar.map((r) => r.map((h) => ({ text: metin(h), fontSize: 8.5, lineHeight: 1.2 }))),
      ]
      return {
        table: { headerRows: 1, dontBreakRows: true, widths: oranlar.map((g) => (kullanilabilir * g) / toplamOran), body: govde },
        layout: TABLO_DUZENI,
        margin: [0, 2, 0, 8],
      }
    }
    case 'kutu': {
      const t = KUTU[b.ton]
      return {
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: [
                  { text: pdfMetni(b.baslik ?? t.ad), fontSize: 8.5, bold: true, color: t.yazi, margin: [0, 0, 0, 3] as [number, number, number, number] },
                  ...b.satirlar.map((s) => ({ text: metin(s), fontSize: 8.5, lineHeight: 1.3, color: t.yazi, margin: [0, 0, 0, 2] as [number, number, number, number] })),
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
          paddingLeft: () => 9,
          paddingRight: () => 9,
          paddingTop: () => 7,
          paddingBottom: () => 5,
        },
        margin: [0, 2, 0, 8],
        unbreakable: true,
      }
    }
  }
}

export function prosedurBelgesi(p: Prosedur, uretimZamani: string): TDocumentDefinitions {
  const icerik: Content[] = [
    baslikBandi(pdfMetni(p.baslik), pdfMetni(p.altBaslik), [`Güncelleme: ${trDate(p.guncelleme)}`, 'Avrupa Tahsilat Sistemi']),
    {
      toc: {
        title: { text: 'İçindekiler', fontSize: 11, bold: true, margin: [0, 4, 0, 6] },
        textStyle: { fontSize: 9.5 },
        numberStyle: { fontSize: 9.5, color: PDF_RENK.soluk },
      },
      margin: [0, 0, 0, 4],
    },
  ]
  p.bolumler.forEach((b, i) => {
    const baslik = pdfMetni(`${i + 1}. ${b.baslik}`)
    icerik.push({
      stack: [
        { text: baslik, fontSize: 14, bold: true, color: PDF_RENK.mavi, tocItem: true },
        { canvas: [{ type: 'rect', x: 0, y: 3, w: ICERIK_GENISLIGI, h: 0.8, color: PDF_RENK.cizgi }] },
        ...(b.ozet ? [{ text: metin(b.ozet), fontSize: 9, italics: true, color: PDF_RENK.soluk, margin: [0, 5, 0, 0] as [number, number, number, number] }] : []),
      ],
      // ilk bölüm içindekilerin ardından aynı sayfada; sonrakiler yeni sayfada başlar
      ...(i > 0 ? { pageBreak: 'before' as const } : {}),
      margin: [0, i > 0 ? 0 : 10, 0, 8],
    })
    for (const blok of b.bloklar) icerik.push(blokIcerigi(blok))
  })
  return belge(icerik, {
    baslik: `${p.baslik} — Avrupa Tahsilat Sistemi`,
    altBilgi: `${p.baslik} · güncelleme ${trDate(p.guncelleme)} · üretim ${uretimZamani}`,
  })
}
