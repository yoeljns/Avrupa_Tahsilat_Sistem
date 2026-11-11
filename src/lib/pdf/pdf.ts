import * as pdfmakeModulu from 'pdfmake'
import vfs from 'pdfmake/build/vfs_fonts'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'

// PDF üretimi (sunucu) — pdfmake.
//
//  * Yazı tipi: paketle gelen Roboto, bellekten (base64 → Buffer) yüklenir; dosya
//    sistemine ve dosya izlemeye bağımlı değildir. Türkçe harflerin hepsi vardır.
//  * Güvenlik: belge tanımı adres ya da yerel dosya gösteremez (ikisi de reddedilir);
//    belgeler yalnız metin, tablo ve çizimden oluşur.
//  * pdfmake modülü tek bir örnektir (module.exports = new pdfmake()); ayar bir kez yapılır.
//  * Belge tanımı her çağrıda YENİ kurulmalıdır: pdfmake verilen ağacı yerinde değiştirir.
//
// DAĞITIM NOTU: kütüphane derlemeye gömülür (bkz. exceljsYaz.ts); canlıda
// /api/saglik?belge=1 PDF üretimini de sınar.

type Pdfmake = typeof pdfmakeModulu
// CommonJS modülü: paketleyiciye göre örnek ya `default` altında ya da ad alanının kendisidir
const pdfmake: Pdfmake = (pdfmakeModulu as unknown as { default?: Pdfmake }).default ?? pdfmakeModulu

export { PDF_KARAKTERLERI, pdfMetni } from './karakter'

let hazir = false

function hazirla(): void {
  if (hazir) return
  const dosyalar = vfs as Record<string, string>
  const yaziTipi = (ad: string): Buffer => {
    const b64 = dosyalar[ad]
    if (!b64) throw new Error(`PDF yazı tipi bulunamadı: ${ad}`)
    return Buffer.from(b64, 'base64')
  }
  pdfmake.setFonts({
    Roboto: {
      normal: yaziTipi('Roboto-Regular.ttf'),
      bold: yaziTipi('Roboto-Medium.ttf'),
      italics: yaziTipi('Roboto-Italic.ttf'),
      bolditalics: yaziTipi('Roboto-MediumItalic.ttf'),
    },
  })
  pdfmake.setUrlAccessPolicy(() => false)
  pdfmake.setLocalAccessPolicy(() => false)
  hazir = true
}

/** Belge tanımından PDF baytlarını üretir. */
export async function pdfUret(tanim: TDocumentDefinitions): Promise<Buffer> {
  hazirla()
  return pdfmake.createPdf(tanim).getBuffer()
}

/** PDF indirme / görüntüleme yanıtı */
export function pdfYaniti(baytlar: Buffer, dosyaAdi: string, satirIci = false): Response {
  return new Response(new Uint8Array(baytlar), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${satirIci ? 'inline' : 'attachment'}; filename="${dosyaAdi}"`,
      'Cache-Control': 'no-store',
    },
  })
}
