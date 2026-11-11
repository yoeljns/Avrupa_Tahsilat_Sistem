import { kitapYaz } from '@/lib/export/exceljsYaz'
import { vadeliBakiyelerPlanlari } from '@/lib/export/vadeliBakiyeler'
import { todayISO } from '@/lib/format'
import { VARSAYILAN_KATEGORILER } from '@/lib/kategoriMeta'
import type { BakiyeVerisi } from '@/lib/queries'

// BELGE ÖZ-SINAMASI — /api/saglik?belge=1
// Belge kütüphanelerinin (Excel yazıcısı) bu sunucuda yüklenip çalıştığını
// kanıtlar: UYDURMA örnek veriden küçük bir dosya üretir ve yalnız boyutunu
// döndürür. Veritabanına gitmez, gerçek veri içermez.
//
// Neden var: kütüphaneler dağıtım paketine dosya izlemeyle girer; izleme bir
// dosyayı kaçırırsa hata yalnız canlıda, ilk indirmede görünür. Bu sınama
// yayından hemen sonra oturum açmadan denenebilir.

export interface SinamaSonucu {
  ok: boolean
  /** üretilen dosyanın boyutu */
  bayt?: number
  ms: number
  hata?: string
}

/** Uydurma veri: üç firma, iki ay (bu ay ve gelecek ay), bir alacaklı. */
function ornekVeri(bugun: string): BakiyeVerisi {
  const ay = bugun.slice(0, 7)
  const [y, m] = ay.split('-').map(Number)
  const sonraki = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return {
    run_id: null,
    tazelik: null,
    firmalar: [
      { id: 'ornek-1', kod: '00 A01', ad: 'ÖRNEK BOYA', sorumlu: 'ÖRNEK' },
      { id: 'ornek-2', kod: '00 B02', ad: 'ÖRNEK ŞİRKETİ', sorumlu: 'ÖRNEK' },
      { id: 'ornek-3', kod: '00 C03', ad: 'ĞÜŞİÖÇ ğüşıöç', sorumlu: null },
    ],
    hucreler: [
      [0, 'VADELI', 'KONSINYE', `${ay}-05`, 1250000, 250000, 2, false],
      [0, 'VADELI', 'KONSINYE', `${ay}-15`, 340000, 340000, 1, false],
      [1, 'VADELI', 'KONSINYE_PESIN', `${ay}-20`, 815000, 0, 1, false],
      [2, 'VADELI', 'KONSINYE', `${sonraki}-05`, 990000, 990000, 1, true],
    ],
    dokum: [
      [0, 'VADELI', 'KONSINYE', `${ay}-05`, 1250000, 250000, 'ORNEK0001', `${ay}-01`, false],
      [0, 'VADELI', 'KONSINYE', `${ay}-15`, 340000, 340000, 'ORNEK0002', `${ay}-01`, false],
      [1, 'VADELI', 'KONSINYE_PESIN', `${ay}-20`, 815000, 0, 'ORNEK0003', `${ay}-02`, false],
      [2, 'VADELI', 'KONSINYE', `${sonraki}-05`, 990000, 990000, 'ORNEK0004', `${ay}-03`, true],
    ],
    alacaklar: [{ firm_id: 'ornek-2', kod: '00 B02', ad: 'ÖRNEK ŞİRKETİ', sorumlu: 'ÖRNEK', alacak: 12345 }],
    kategoriler: [...VARSAYILAN_KATEGORILER],
  }
}

/** Örnek veriden Vadeli Bakiyeler çalışma kitabı üretir; yalnız boyut ve süre döner. */
export async function excelSinamasi(simdi: Date = new Date()): Promise<SinamaSonucu> {
  const t0 = performance.now()
  try {
    const bugun = todayISO(simdi)
    const { planlar } = vadeliBakiyelerPlanlari(ornekVeri(bugun), bugun, undefined, simdi)
    const baytlar = await kitapYaz(planlar)
    // .xlsx bir zip dosyasıdır: 'PK' ile başlar
    const gecerli = baytlar.length > 1000 && baytlar[0] === 0x50 && baytlar[1] === 0x4b
    return { ok: gecerli, bayt: baytlar.length, ms: Math.round(performance.now() - t0), ...(gecerli ? {} : { hata: 'Üretilen dosya geçerli görünmüyor.' }) }
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t0), hata: e instanceof Error ? e.message : String(e) }
  }
}
