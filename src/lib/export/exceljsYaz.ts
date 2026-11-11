import ExcelJS from 'exceljs'
import type { HucreBicimi, SayfaPlani } from '@/lib/bakiye/sayfaPlani'

// SayfaPlani → .xlsx (exceljs). İnce uyarlayıcı: biçim kararlarının hepsi
// src/lib/bakiye/sayfaPlani.ts içindedir; burada yalnız dosyaya aktarılır.
//
// exceljs tuzakları (bilerek böyle yazıldı):
//  * Birleştirilen hücreler biçim NESNESİNİ ana hücreyle paylaşır → önce
//    birleştirilir, sonra HER hücreye yeni bir biçim nesnesi atanır.
//  * Birleşik aralığın yan hücresine değer atamak ana hücrenin değerini ezer →
//    değeri olmayan (null) hücrelere değer ataması yapılmaz.
//  * Renkler 8 haneli ARGB; tarihler sayı (seri no) + sayı biçimi olarak gelir.
//  * Formüller önbellek sonucuyla yazılır; Excel açılışta yeniden hesaplar.
//
// DAĞITIM NOTU: exceljs derlemeye GÖMÜLÜR (Next varsayılanı). next.config'te
// `serverExternalPackages`e EKLEMEYİN: o durumda kütüphane çalışma zamanında
// node_modules'ten yüklenir ve dosya izleme bir alt bağımlılığın dosyasını
// (unzipper → … → generator-function/require.mjs) kaçırdığı için Vercel'de
// "Cannot find module" ile 500 verir. Yerelde `output: 'standalone'` derlemesiyle
// denenmiştir; canlıda /api/saglik?belge=1 aynı şeyi sınar.

const argb = (rrggbb: string) => 'FF' + rrggbb

function stil(b: HucreBicimi, yaziBoyu: number): Partial<ExcelJS.Style> {
  const s: Partial<ExcelJS.Style> = {
    font: { name: 'Calibri', size: b.yaziBoyu ?? yaziBoyu, bold: !!b.kalin, color: { argb: argb(b.yaziRengi ?? '000000') } },
  }
  if (b.dolgu) s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(b.dolgu) } }
  if (b.sayiBicimi) s.numFmt = b.sayiBicimi
  if (b.yatay || b.dikey || b.sar) {
    s.alignment = { ...(b.yatay ? { horizontal: b.yatay } : {}), ...(b.dikey ? { vertical: b.dikey } : {}), ...(b.sar ? { wrapText: true } : {}) }
  }
  if (b.kenar) {
    s.border = {
      ...(b.kenar.sol ? { left: { style: b.kenar.sol } } : {}),
      ...(b.kenar.sag ? { right: { style: b.kenar.sag } } : {}),
      ...(b.kenar.ust ? { top: { style: b.kenar.ust } } : {}),
      ...(b.kenar.alt ? { bottom: { style: b.kenar.alt } } : {}),
    }
  }
  return s
}

export function sayfaYaz(wb: ExcelJS.Workbook, plan: SayfaPlani): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(plan.ad, {
    properties: { defaultRowHeight: 12.75 },
    views: [
      plan.dondur
        ? {
            state: 'frozen',
            xSplit: plan.dondur.sutun,
            ySplit: plan.dondur.satir,
            topLeftCell: ws_adres(plan.dondur.sutun, plan.dondur.satir),
            zoomScale: 100,
          }
        : { state: 'normal', zoomScale: 100 },
    ],
    pageSetup: plan.yazdirma
      ? {
          paperSize: 9,
          orientation: plan.yazdirma.yatay ? 'landscape' : 'portrait',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          ...(plan.yazdirma.baslikSatirlari ? { printTitlesRow: plan.yazdirma.baslikSatirlari } : {}),
          ...(plan.yazdirma.baslikSutunlari ? { printTitlesColumn: plan.yazdirma.baslikSutunlari } : {}),
        }
      : { paperSize: 9 },
  })

  plan.sutunlar.forEach((s, i) => {
    const sutun = ws.getColumn(i + 1)
    sutun.width = s.genislik
    if (s.gizli) sutun.hidden = true
  })

  // Önce birleştir, sonra değer ve biçim (bkz. baştaki tuzaklar)
  for (const aralik of plan.birlesimler) ws.mergeCells(aralik)

  plan.hucreler.forEach((satir, r) => {
    const row = ws.getRow(r + 1)
    const yukseklik = plan.satirYukseklikleri[r]
    if (yukseklik) row.height = yukseklik
    satir.forEach((hucre, c) => {
      if (!hucre) return
      const cell = row.getCell(c + 1)
      const d = hucre.deger
      if (d !== null) {
        cell.value = typeof d === 'object' ? { formula: d.formul, result: d.sonuc } : d
      }
      cell.style = stil(hucre.bicim, plan.yaziBoyu)
      if (hucre.not) cell.note = hucre.not
    })
  })

  if (plan.suzgec) ws.autoFilter = plan.suzgec
  return ws
}

/** 0 tabanlı (sütun, satır) → 'G4' */
function ws_adres(sutun: number, satir: number): string {
  let n = sutun + 1
  let harf = ''
  while (n > 0) {
    const k = (n - 1) % 26
    harf = String.fromCharCode(65 + k) + harf
    n = Math.floor((n - 1) / 26)
  }
  return harf + (satir + 1)
}

/** Planlardan çalışma kitabı üretir ve .xlsx baytlarını döndürür. */
export async function kitapYaz(planlar: SayfaPlani[], uretici = 'Avrupa Tahsilat Sistemi'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = uretici
  wb.lastModifiedBy = uretici
  wb.created = new Date()
  wb.modified = new Date()
  // Formüller önbellek sonucuyla yazılır; Excel yine de açılışta yeniden hesaplasın
  wb.calcProperties.fullCalcOnLoad = true
  for (const plan of planlar) sayfaYaz(wb, plan)
  const cikti = await wb.xlsx.writeBuffer()
  return Buffer.from(cikti as ArrayBuffer)
}

/** .xlsx indirme yanıtı (dosya adı Türkiye tarihiyle verilir) */
export function xlsxYaniti(baytlar: Buffer, dosyaAdi: string): Response {
  return new Response(new Uint8Array(baytlar), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${dosyaAdi}"`,
      'Cache-Control': 'no-store',
    },
  })
}
