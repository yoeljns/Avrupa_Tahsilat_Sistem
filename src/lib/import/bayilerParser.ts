import * as XLSX from 'xlsx'
import { normText, normalizeFirmCode } from '@/lib/engine/normalize'

// Bayi listesi .xlsx ayrıştırıcısı — sheet 'Bayiler':
// logo_kodu, bayi_adi, segment, borc_durumu, sehir, telefon, pazarlamaci_email

export interface BayiRecord {
  rowIndex: number
  codeNorm: string
  codeRaw: string
  name: string
  segment: string
  borcDurumu: string
  city: string
  phone: string
  pazarlamaciEmail: string
  /**
   * Dosyada GERÇEKTEN bulunan isteğe bağlı kolonlar. Olmayan kolon mevcut
   * firmada ASLA boşaltılmaz (ör. pazarlamaci_email kolonu olmayan bir dosya
   * tüm pazarlamacı atamalarını silmemeli).
   */
  kolonlar: { segment: boolean; borcDurumu: boolean; city: boolean; phone: boolean; pazarlamaciEmail: boolean }
}

export interface ParsedBayiler {
  records: BayiRecord[]
  invalids: Array<{ rowIndex: number; error: string; preview: string }>
  warnings: string[]
}

type Cell = string | number | boolean | null | undefined

function cellStr(v: Cell): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

export function parseBayilerXlsx(buf: Buffer | ArrayBuffer): ParsedBayiler {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? 'array' : 'buffer', raw: true })
  const sheetName = wb.SheetNames.find((n) => normText(n) === 'BAYILER') ?? wb.SheetNames[0]
  if (!sheetName) return { records: [], invalids: [], warnings: ['Dosyada sayfa bulunamadı.'] }

  const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: null })
  if (rows.length < 2) return { records: [], invalids: [], warnings: ['Dosyada veri satırı yok.'] }

  const header = (rows[0] ?? []).map((c) => normText(cellStr(c)))
  const col = (name: string) => header.indexOf(name)
  const iKod = col('LOGO_KODU')
  const iAd = col('BAYI_ADI')
  if (iKod < 0 || iAd < 0) {
    return { records: [], invalids: [], warnings: ["Başlıklar bulunamadı: 'logo_kodu' ve 'bayi_adi' sütunları zorunlu."] }
  }
  const iSegment = col('SEGMENT')
  const iBorc = col('BORC_DURUMU')
  const iSehir = col('SEHIR')
  const iTel = col('TELEFON')
  const iEmail = col('PAZARLAMACI_EMAIL')

  const kolonlar = {
    segment: iSegment >= 0,
    borcDurumu: iBorc >= 0,
    city: iSehir >= 0,
    phone: iTel >= 0,
    pazarlamaciEmail: iEmail >= 0,
  }

  const records: BayiRecord[] = []
  const invalids: ParsedBayiler['invalids'] = []
  const seen = new Set<string>()
  const warnings: string[] = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const codeRaw = cellStr(row[iKod])
    if (!codeRaw) continue
    const codeNorm = normalizeFirmCode(codeRaw)
    if (seen.has(codeNorm)) {
      invalids.push({ rowIndex: r + 1, error: `Kod tekrar ediyor: ${codeRaw}`, preview: codeRaw })
      continue
    }
    seen.add(codeNorm)

    const email = cellStr(iEmail >= 0 ? row[iEmail] : '').toLowerCase()
    if (email && !email.includes('@')) {
      invalids.push({ rowIndex: r + 1, error: `Geçersiz e-posta: ${email}`, preview: codeRaw })
      continue
    }

    records.push({
      rowIndex: r + 1,
      codeNorm,
      codeRaw,
      name: cellStr(row[iAd]),
      segment: cellStr(iSegment >= 0 ? row[iSegment] : ''),
      borcDurumu: cellStr(iBorc >= 0 ? row[iBorc] : ''),
      city: cellStr(iSehir >= 0 ? row[iSehir] : ''),
      phone: cellStr(iTel >= 0 ? row[iTel] : ''),
      pazarlamaciEmail: email,
      kolonlar,
    })
  }

  if (records.length === 0) warnings.push('Hiç bayi satırı okunamadı.')
  const eksik = [
    !kolonlar.pazarlamaciEmail && 'pazarlamaci_email',
    !kolonlar.segment && 'segment',
    !kolonlar.city && 'sehir',
    !kolonlar.phone && 'telefon',
    !kolonlar.borcDurumu && 'borc_durumu',
  ].filter(Boolean)
  if (eksik.length > 0) {
    warnings.push(`Dosyada olmayan kolonlar (${eksik.join(', ')}) mevcut firmalarda DEĞİŞTİRİLMEYECEK.`)
  }
  return { records, invalids, warnings }
}
