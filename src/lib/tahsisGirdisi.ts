import { fisNoDigitCount, fisNoSuffix4, parseKdvRefs } from '@/lib/engine/kdvRefs'
import { foldFirmCodeForExclusion } from '@/lib/engine/normalize'
import type { EngineInstallment, EnginePayment, Side } from '@/lib/engine/types'

// Veritabanı satırlarından saf motor girdisini kurar. Tam yeniden hesap ve
// firma bazlı yeniden hesap AYNI fonksiyonu kullanır — iki yol asla farklı
// kural işletemez. Saf: ağ/veritabanı yok, test edilebilir.

export interface GirdiIrsaliye {
  id: string
  firm_id: string
  fis_no: string
  invoice_date: string
  side: Side | null
  is_allocatable: boolean
}

export interface GirdiTaksit {
  id: string
  invoice_id: string
  firm_id: string
  seq: number
  due_date: string
  amount_eur_cents: number
}

export interface GirdiOdeme {
  id: string
  islem_kodu: string
  firm_id: string
  islem_tarihi: string | null
  doviz_eur_cents: number | null
  is_kdv: boolean | null
  kdv_fatura_referansi: string | null
  aciklama: string | null
}

export interface MotorGirdisi {
  installments: EngineInstallment[]
  payments: EnginePayment[]
  /** Kapsam dışı (iptal, 31/12, sınıflandırılmamış, takip dışı) taksitler — kalanları NULL yazılır */
  kapsamDisiTaksitIds: string[]
  kdvEslesen: number
  kdvEslesmeyen: number
}

/** Takip dışı firma id'leri: kodlar Türkçe katlanarak karşılaştırılır ('54 C03' = '54 Ç03'). */
export function haricFirmaKumesi(firmalar: Array<{ id: string; code_norm: string }>, haricKodlar: string[]): Set<string> {
  const kodlar = new Set(haricKodlar.map((k) => foldFirmCodeForExclusion(k)))
  const out = new Set<string>()
  for (const f of firmalar) if (kodlar.has(foldFirmCodeForExclusion(f.code_norm))) out.add(f.id)
  return out
}

/** Ödeme tarihi olmayan kayıtlar sıranın sonuna gider. */
const TARIHSIZ = '9999-12-31T00:00:00.000Z'

export function motorGirdisiKur(
  irsaliyeler: GirdiIrsaliye[],
  taksitler: GirdiTaksit[],
  odemeler: GirdiOdeme[],
  haricFirmaIds: Set<string>,
): MotorGirdisi {
  const tahsisEdilebilir = new Map<string, GirdiIrsaliye>()
  for (const inv of irsaliyeler) {
    if (inv.is_allocatable && inv.side) tahsisEdilebilir.set(inv.id, inv)
  }

  const installments: EngineInstallment[] = []
  const kapsamDisiTaksitIds: string[] = []
  for (const t of taksitler) {
    const inv = tahsisEdilebilir.get(t.invoice_id)
    if (!inv) {
      kapsamDisiTaksitIds.push(t.id)
      continue
    }
    installments.push({
      id: t.id,
      invoiceId: t.invoice_id,
      firmId: t.firm_id,
      side: inv.side!,
      dueDate: t.due_date,
      invoiceDate: inv.invoice_date,
      fisNo: inv.fis_no,
      seq: t.seq,
      amountCents: t.amount_eur_cents,
    })
  }

  // KDV referans eşleşmesi: firma → son 4 hane → kapsam içi irsaliye adayları
  const sonDortIndeks = new Map<string, Map<string, GirdiIrsaliye[]>>()
  for (const inv of tahsisEdilebilir.values()) {
    const son4 = fisNoSuffix4(inv.fis_no)
    if (!son4) continue
    let m = sonDortIndeks.get(inv.firm_id)
    if (!m) sonDortIndeks.set(inv.firm_id, (m = new Map()))
    const arr = m.get(son4)
    if (arr) arr.push(inv)
    else m.set(son4, [inv])
  }

  /** Tüm referanslar çözülürse hedef irsaliye id'leri; aksi halde null (eşleşmedi). */
  function kdvHedefleri(firmId: string, refs: string[]): string[] | null {
    if (refs.length === 0) return null
    const firmaIndeksi = sonDortIndeks.get(firmId)
    if (!firmaIndeksi) return null
    const hedefler: string[] = []
    for (const ref of refs) {
      const adaylar = firmaIndeksi.get(ref)
      if (!adaylar || adaylar.length === 0) return null
      let secilen = adaylar[0]
      if (adaylar.length > 1) {
        // Çakışmada standart (en uzun rakamlı) fiş tercih edilir; eşitlik → belirsiz
        const sirali = [...adaylar].sort(
          (a, b) => fisNoDigitCount(b.fis_no) - fisNoDigitCount(a.fis_no) || (a.fis_no < b.fis_no ? -1 : 1),
        )
        if (fisNoDigitCount(sirali[0].fis_no) === fisNoDigitCount(sirali[1].fis_no)) return null
        secilen = sirali[0]
      }
      if (!hedefler.includes(secilen.id)) hedefler.push(secilen.id)
    }
    return hedefler
  }

  const payments: EnginePayment[] = []
  let kdvEslesen = 0
  let kdvEslesmeyen = 0
  for (const p of odemeler) {
    if (haricFirmaIds.has(p.firm_id)) continue
    if (!p.doviz_eur_cents || p.doviz_eur_cents <= 0) continue
    if (p.is_kdv) {
      const hedefler = kdvHedefleri(p.firm_id, parseKdvRefs(p.kdv_fatura_referansi, p.aciklama))
      if (!hedefler) {
        kdvEslesmeyen++
        continue // eşleşmeyen KDV ödemesi tahsise girmez (panelde 'eşleşmedi' görünür)
      }
      kdvEslesen++
      payments.push({
        id: p.id,
        islemKodu: p.islem_kodu,
        firmId: p.firm_id,
        dateISO: p.islem_tarihi ?? TARIHSIZ,
        amountCents: p.doviz_eur_cents,
        isKdv: true,
        targetInvoiceIds: hedefler,
      })
      continue
    }
    payments.push({
      id: p.id,
      islemKodu: p.islem_kodu,
      firmId: p.firm_id,
      dateISO: p.islem_tarihi ?? TARIHSIZ,
      amountCents: p.doviz_eur_cents,
    })
  }

  return { installments, payments, kapsamDisiTaksitIds, kdvEslesen, kdvEslesmeyen }
}
