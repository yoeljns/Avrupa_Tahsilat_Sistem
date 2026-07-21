import * as XLSX from 'xlsx'
import { excelSerialToTimestamp } from '@/lib/engine/dates'
import { numberToCents, parseEurToCents } from '@/lib/engine/money'
import { normText, normalizeFirmCode } from '@/lib/engine/normalize'

// Gelen ödemeler .xlsx ayrıştırıcısı.
// Yalnız PEŞİN ve VADELİ sayfaları okunur (LOG_*, ODEME_* vb. atlanır).
// Sütunlar pozisyonla değil, BAŞLIK ADLARIYLA (Türkçe katlanmış) eşlenir —
// sütun sırası değişse de içe aktarma bozulmaz.
//
// İKİ BİÇİM DESTEKLENİR:
//  * Tam biçim: FİRMA KODU + AÇIKLAMA/ALACAKLI/KDV/DURUM kolonlarıyla.
//  * İnce biçim (10.07 sonrası yedekler): yalnız İŞLEM KODU, İŞLEM TARİHİ,
//    FİRMA, GELEN TL, DÖVİZ EURO, KUR, TOPLAM TL. Firma eşleşmesi FİRMA
//    adından yapılır (önizleme aşamasında çözülür); dosyada OLMAYAN kolonlar
//    mevcut kayıtlar üzerinde ASLA ezilmez.

export interface OdemeRecord {
  rowIndex: number
  sheet: string
  sheetSide: 'PESIN' | 'VADELI'
  islemKodu: string
  islemTarihiISO: string | null
  firmaRaw: string
  firmCodeRaw: string
  firmCodeNorm: string
  gelenTl: number | null
  dovizEurCents: number | null
  kur: number | null
  toplamTl: number | null
  fark: number | null
  odemeSekli: string
  aciklama: string
  alacakliDurumu: string
  alacakliTl: number | null
  alacakliEurCents: number | null
  alacakliIslemi: string
  kdv15Durumu: string
  kdvFaturaReferansi: string
  kdvFaturaToplamiEurCents: number | null
  kdv15OnOdemeEurCents: number | null
  kdvKalanBorcEurCents: number | null
  kdvTaksitSayisi: string
  kdvTaksitBasiEurCents: number | null
  kayitDurumu: string
  eksikAlanlar: string
  isleyen: string
  islemZamaniRaw: string
  hedefFisNo: string
  hedefAcikEurRaw: string
  isAlc: boolean
  isComplete: boolean
  /** KDV 1/5 ön ödemesi — referansındaki irsaliyeden düşülür */
  isKdv: boolean
  /** Dosyada FİRMA KODU kolonu var mıydı? Yoksa firma, addan çözülür. */
  hasKodu: boolean
  /** Dosyada detay kolonları (AÇIKLAMA/ALACAKLI/KDV/DURUM) var mıydı? Yoksa mevcut değerler korunur. */
  hasDetails: boolean
}

export interface OdemeInvalidRow {
  rowIndex: number
  sheet: string
  error: string
  preview: string
}

export interface ParsedOdemeler {
  records: OdemeRecord[]
  invalids: OdemeInvalidRow[]
  warnings: string[]
}

type Cell = string | number | boolean | null | undefined

function cellStr(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v)
  return String(v).trim()
}

function cellNum(v: Cell): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const cents = parseEurToCents(v)
    return cents === null ? null : cents / 100
  }
  return null
}

function cellCents(v: Cell): number | null {
  if (typeof v === 'number') return numberToCents(v)
  if (typeof v === 'string' && v.trim()) return parseEurToCents(v)
  return null
}

function cellTimestamp(v: Cell): string | null {
  if (typeof v === 'number') return excelSerialToTimestamp(v)
  if (typeof v === 'string' && v.trim()) {
    // '2026-01-05 00:00:00' veya '05.01.2026' biçimleri
    const iso = v.trim().replace(' ', 'T')
    const d = new Date(iso.includes('T') ? iso + (iso.endsWith('Z') ? '' : 'Z') : iso)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
    const tr = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(v.trim())
    if (tr) {
      const [, dd, mm, yyyy] = tr
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00.000Z`
    }
  }
  return null
}

// Bazı yedeklerde firma kodu, FİRMA adının sonunda parantez içinde gelir:
//   'KUZEY TOPTAN HIRDAVAT SAN TİC LTD.ŞTİ (06 K07)'
const PAREN_CODE = /\(([^()]+)\)\s*$/
const CODE_SHAPE = /^[0-9A-Za-zÇĞİÖŞÜçğıöşü]{1,4}\s+[0-9A-Za-zÇĞİÖŞÜçğıöşü]{1,4}$/

/** Ad sonundaki parantezli firma kodunu döndürür ('06 K07') — yoksa null. */
export function extractCodeFromName(firmaRaw: string): string | null {
  const m = PAREN_CODE.exec(firmaRaw)
  if (!m) return null
  const candidate = m[1].trim().replace(/\s+/g, ' ')
  return CODE_SHAPE.test(candidate) ? candidate : null
}

/** Parantezli kod ekini addan temizler (firma adı olarak kullanmak için). */
export function stripCodeSuffix(firmaRaw: string): string {
  const code = extractCodeFromName(firmaRaw)
  if (!code) return firmaRaw
  return firmaRaw.replace(PAREN_CODE, '').trim()
}

/** Başlık satırından katlanmış-ad → sütun indeksi haritası kurar. */
function headerMap(headerRow: Cell[]): Map<string, number> {
  const map = new Map<string, number>()
  headerRow.forEach((cell, idx) => {
    const key = normText(cellStr(cell))
    if (key && !map.has(key)) map.set(key, idx)
  })
  return map
}

const REQUIRED_HEADERS = ['ISLEM KODU', 'DOVIZ EURO']

export function parseOdemelerXlsx(buf: Buffer | ArrayBuffer): ParsedOdemeler {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? 'array' : 'buffer', raw: true })
  const records: OdemeRecord[] = []
  const invalids: OdemeInvalidRow[] = []
  const warnings: string[] = []
  const seenKodu = new Set<string>()

  const targetSheets = wb.SheetNames.filter((n) => {
    const f = normText(n)
    return f === 'PESIN' || f === 'VADELI'
  })
  if (targetSheets.length === 0) {
    return { records, invalids, warnings: ["Dosyada 'PEŞİN' veya 'VADELİ' sayfası bulunamadı."] }
  }

  for (const sheetName of targetSheets) {
    const side: 'PESIN' | 'VADELI' = normText(sheetName) === 'PESIN' ? 'PESIN' : 'VADELI'
    const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: null })
    if (rows.length === 0) continue

    const h = headerMap(rows[0] ?? [])
    const missing = REQUIRED_HEADERS.filter((k) => !h.has(k))
    if (missing.length > 0) {
      warnings.push(`'${sheetName}' sayfasında beklenen başlıklar eksik: ${missing.join(', ')} — sayfa atlandı.`)
      continue
    }
    const hasKodu = h.has('FIRMA KODU')
    const hasDetails = h.has('ACIKLAMA') || h.has('KAYIT DURUMU') || h.has('KDV 1/5 DURUMU')
    if (!hasKodu && !h.has('FIRMA')) {
      warnings.push(`'${sheetName}' sayfasında ne FİRMA KODU ne FİRMA başlığı var — sayfa atlandı.`)
      continue
    }

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] ?? []
      const get = (name: string): Cell => {
        const idx = h.get(name)
        return idx === undefined ? undefined : row[idx]
      }

      const islemKodu = cellStr(get('ISLEM KODU'))
      if (!islemKodu) continue // boş satır

      if (seenKodu.has(islemKodu)) {
        invalids.push({ rowIndex: r + 1, sheet: sheetName, error: `İşlem kodu tekrar ediyor: ${islemKodu}`, preview: islemKodu })
        continue
      }
      seenKodu.add(islemKodu)

      let firmCodeRaw = cellStr(get('FIRMA KODU'))
      const firmaRaw = cellStr(get('FIRMA'))
      let koduVar = hasKodu
      if (!koduVar) {
        // FİRMA KODU kolonu yoksa: önce ad sonundaki parantezli kodu dene
        const extracted = extractCodeFromName(firmaRaw)
        if (extracted) {
          firmCodeRaw = extracted
          koduVar = true
        }
      }
      if (hasKodu && !firmCodeRaw) {
        invalids.push({ rowIndex: r + 1, sheet: sheetName, error: 'Firma kodu boş', preview: islemKodu })
        continue
      }
      if (!koduVar && !firmaRaw) {
        invalids.push({ rowIndex: r + 1, sheet: sheetName, error: 'Firma adı boş', preview: islemKodu })
        continue
      }

      const kayitDurumu = cellStr(get('KAYIT DURUMU'))
      const kayitNorm = normText(kayitDurumu)
      const kdv15Durumu = cellStr(get('KDV 1/5 DURUMU'))

      records.push({
        rowIndex: r + 1,
        sheet: sheetName,
        sheetSide: side,
        islemKodu,
        islemTarihiISO: cellTimestamp(get('ISLEM TARIHI')),
        firmaRaw,
        firmCodeRaw,
        firmCodeNorm: normalizeFirmCode(firmCodeRaw),
        gelenTl: cellNum(get('GELEN TL')),
        dovizEurCents: cellCents(get('DOVIZ EURO')),
        kur: cellNum(get('KUR')),
        toplamTl: cellNum(get('TOPLAM TL')),
        fark: cellNum(get('FARK')),
        odemeSekli: cellStr(get('ODEME SEKLI')),
        aciklama: cellStr(get('ACIKLAMA')),
        alacakliDurumu: cellStr(get('ALACAKLI DURUMU')),
        alacakliTl: cellNum(get('ALACAKLI TL')),
        alacakliEurCents: cellCents(get('ALACAKLI EURO')),
        alacakliIslemi: cellStr(get('ALACAKLI ISLEMI')),
        kdv15Durumu,
        kdvFaturaReferansi: cellStr(get('KDV FATURA REFERANSI')),
        kdvFaturaToplamiEurCents: cellCents(get('KDV FATURA TOPLAMI EURO')),
        kdv15OnOdemeEurCents: cellCents(get('KDV 1/5 ON ODEME EURO')),
        kdvKalanBorcEurCents: cellCents(get('KDV KALAN BORC EURO')),
        kdvTaksitSayisi: cellStr(get('KDV TAKSIT SAYISI')),
        kdvTaksitBasiEurCents: cellCents(get('KDV TAKSIT BASI EURO')),
        kayitDurumu,
        eksikAlanlar: cellStr(get('EKSIK ALANLAR')),
        isleyen: cellStr(get('ISLEYEN')),
        islemZamaniRaw: cellStr(get('ISLEM ZAMANI')),
        hedefFisNo: cellStr(get('HEDEF FIS NO')),
        hedefAcikEurRaw: cellStr(get('HEDEF ACIK EUR')),
        isAlc: islemKodu.startsWith('ALC'),
        isComplete: kayitNorm === '' || kayitNorm === 'TAMAMLANDI',
        isKdv: normText(kdv15Durumu) === 'EVET',
        hasKodu: koduVar,
        hasDetails,
      })
    }
  }

  return { records, invalids, warnings }
}
