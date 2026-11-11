import { describe, expect, it } from 'vitest'
import { PDF_KARAKTERLERI, pdfMetni, pdfUret } from '@/lib/pdf/pdf'
import { butunMetinler, duzMetin, kalinParcala } from '@/lib/yardim/bloklar'
import { PROSEDUR } from '@/lib/yardim/icerik'
import { prosedurBelgesi } from '@/lib/yardim/prosedurPdf'

// İş Akış Prosedürü: içerik tek kaynaktır; PDF belgesi içeriğin TAMAMINI taşır.
// (Yardım sayfası aynı veriyi doğrudan çizer; tarayıcı sınaması uçtan uca testtedir.)

/** pdfmake belge ağacındaki bütün metinleri, kalın parçalar birleştirilmiş olarak toplar */
function belgeMetinleri(dugum: unknown, out: string[] = []): string[] {
  if (Array.isArray(dugum)) {
    for (const d of dugum) belgeMetinleri(d, out)
  } else if (dugum && typeof dugum === 'object') {
    const o = dugum as Record<string, unknown>
    if (typeof o.text === 'string') out.push(o.text)
    else if (Array.isArray(o.text)) out.push(o.text.map((p) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? ''))).join(''))
    for (const [k, v] of Object.entries(o)) if (k !== 'text') belgeMetinleri(v, out)
  }
  return out
}

describe('içerik yapısı', () => {
  it('**kalın** işareti parçalara ayrılır; eşleşmeyen işaret düz metin kalır', () => {
    expect(kalinParcala('Önce **Önizle**, sonra **Onayla ve Aktar**.')).toEqual([
      { metin: 'Önce ', kalin: false },
      { metin: 'Önizle', kalin: true },
      { metin: ', sonra ', kalin: false },
      { metin: 'Onayla ve Aktar', kalin: true },
      { metin: '.', kalin: false },
    ])
    expect(kalinParcala('düz metin')).toEqual([{ metin: 'düz metin', kalin: false }])
    expect(kalinParcala('tek ** işaret')).toEqual([{ metin: 'tek ** işaret', kalin: false }])
    expect(duzMetin('**Pano:** açık borç')).toBe('Pano: açık borç')
  })

  it('bölümler: benzersiz ve adrese uygun kimlikler; her bölüm dolu; tablolar tutarlı', () => {
    const kimlikler = PROSEDUR.bolumler.map((b) => b.id)
    expect(new Set(kimlikler).size).toBe(kimlikler.length)
    expect(kimlikler).toEqual(['amac', 'roller', 'is-akisi', 'hesap', 'ekranlar', 'durumlar', 'sozluk'])
    for (const b of PROSEDUR.bolumler) {
      expect(b.id, b.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(b.bloklar.length, b.id).toBeGreaterThan(0)
      for (const k of b.bloklar) {
        if (k.tur === 'tablo') {
          expect(k.satirlar.length, `${b.id}: boş tablo`).toBeGreaterThan(0)
          for (const r of k.satirlar) expect(r.length, `${b.id}: ${r[0]}`).toBe(k.basliklar.length)
          if (k.genislikler) expect(k.genislikler.length, b.id).toBe(k.basliklar.length)
        }
        if (k.tur === 'adimlar' || k.tur === 'liste') expect(k.ogeler.length, b.id).toBeGreaterThan(0)
        if (k.tur === 'kutu') expect(k.satirlar.length, b.id).toBeGreaterThan(0)
      }
    }
    expect(PROSEDUR.guncelleme).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('hiçbir metinde eşleşmemiş ** işareti ya da boş metin yok', () => {
    for (const m of butunMetinler(PROSEDUR)) {
      expect(m.trim().length, 'boş metin').toBeGreaterThan(0)
      expect(m, m.slice(0, 60)).not.toContain('**')
    }
  })

  it('uygulamadaki adlarla aynı: inceleme sekmeleri ve içe aktarma düğmeleri prosedürde geçer', () => {
    const hepsi = butunMetinler(PROSEDUR).join('\n')
    for (const ad of ['Sınıflandırma', 'Plan Çözülemedi', 'Diğer Uyarılar', 'İadeler', 'Çakışmalar', '31/12 Hariçler', 'Tarih Girilmedi', 'Ödeme Tutarı']) {
      expect(hepsi, ad).toContain(ad)
    }
    for (const ad of ['Önizle', 'Onayla ve Aktar', 'Vazgeç', 'Kontrol edildi', 'Seçilenleri Onayla', 'Sorumlu ata', 'Yeniden Hesapla', 'Kapanan ayları göster', 'Bu iadeyi borca ekle']) {
      expect(hepsi, ad).toContain(ad)
    }
  })
})

describe('PDF belgesi', () => {
  it('içeriğin bütün metinleri belge ağacında var (sayfa ile PDF ayrışamaz)', () => {
    const agac = new Set(belgeMetinleri(prosedurBelgesi(PROSEDUR, '11.11.2026 12:00').content))
    // PDF'te ok işareti › olarak yazılır; karşılaştırma aynı dönüşümle yapılır
    const eksik = butunMetinler(PROSEDUR)
      .map(pdfMetni)
      .filter((m) => !agac.has(m) && ![...agac].some((a) => a.endsWith(m)))
    expect(eksik).toEqual([])
  })

  it('belgedeki bütün karakterler yazı tipinde var (eksik işaret boş kutu basılır)', () => {
    const metinler = belgeMetinleri(prosedurBelgesi(PROSEDUR, '11.11.2026 12:00').content)
    expect(metinler.length).toBeGreaterThan(100)
    for (const m of metinler) expect(m, m.slice(0, 80)).toMatch(PDF_KARAKTERLERI)
    expect(pdfMetni('Yönetim → Bayiler ✓')).toBe('Yönetim › Bayiler +')
  })

  it('PDF üretilir: içindekiler ve her bölüm ayrı sayfada', async () => {
    const pdf = await pdfUret(prosedurBelgesi(PROSEDUR, '11.11.2026 12:00'))
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const sayfa = (pdf.toString('latin1').match(/\/Type \/Page\n/g) ?? []).length
    expect(sayfa).toBeGreaterThanOrEqual(PROSEDUR.bolumler.length)
    expect(sayfa).toBeLessThanOrEqual(16)
  })
})
