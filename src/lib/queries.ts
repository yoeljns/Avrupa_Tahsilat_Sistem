import type { SupabaseClient } from '@supabase/supabase-js'
import { todayISO } from '@/lib/format'
import { ayAraligi as ayAraligiHesapla, type TakvimFirmaSatiri } from '@/lib/takvim'

// Okuma sayfalarının verisi — her sayfa TEK ağ turu (0005_hiz_rls.sql).
// Kullanıcı oturumlu istemciyle çağrılır: RLS sayesinde pazarlamacı yalnız
// kendi firmalarının verisini görür. Toplama işleri veritabanında yapılır;
// uygulamaya binlerce satır yerine hazır özet gelir.

async function rpc<T>(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {})
  if (error) {
    const kod = (error as { code?: string }).code
    throw new Error(`${fn}: ${error.message}${kod ? ` (${kod})` : ''}`)
  }
  return data as T
}

export { ayAraligi } from '@/lib/takvim'

// ---------------------------------------------------------------------------
// Pano
// ---------------------------------------------------------------------------
export interface PanoOzeti {
  run_id: string | null
  kosu: {
    started_at: string
    finished_at: string | null
    triggered_by: string | null
    trigger_kind: string
    stats: Record<string, unknown>
  } | null
  bakiye: {
    pesin_acik: number
    vadeli_acik: number
    alacak: number
    toplam_borc: number
    toplam_odenen: number
    borclu_firma: number
  } | null
  vade: { gecikmis: number; gun7: number; gun30: number } | null
  inceleme: { adet: number; tutar: number } | null
}

export function panoOzeti(supabase: SupabaseClient, bugun = todayISO()): Promise<PanoOzeti> {
  return rpc<PanoOzeti>(supabase, 'rpc_pano_ozeti', { p_bugun: bugun })
}

// ---------------------------------------------------------------------------
// Firma listesi
// ---------------------------------------------------------------------------
export interface FirmaListeSatiri {
  id: string
  kod: string
  ad: string
  sehir: string | null
  sorumlu: string | null
  oto: boolean
  pesin: number
  vadeli: number
  alacak: number
  gecikmis: number
  ilk_vade: string | null
}

export function firmaListesi(supabase: SupabaseClient, bugun = todayISO()): Promise<FirmaListeSatiri[]> {
  return rpc<FirmaListeSatiri[]>(supabase, 'rpc_firma_listesi', { p_bugun: bugun }).then((r) => r ?? [])
}

// ---------------------------------------------------------------------------
// Firma detayı
// ---------------------------------------------------------------------------
export interface BalanceRow {
  pesin_open_eur_cents: number
  vadeli_open_eur_cents: number
  vadeli_overdue_eur_cents: number
  credit_eur_cents: number
  next_due_date: string | null
  total_debt_eur_cents: number
  total_paid_eur_cents: number
}

export interface FirmaDetayIrsaliye {
  id: string
  fis_no: string
  invoice_date: string
  belge_no_raw: string
  odeme_plani_raw: string
  plan_override_note: string | null
  sale_type: string
  sale_type_auto: string
  sale_type_override: string | null
  suggested_sale_type: string | null
  amount_eur_cents: number | null
  amount_eur_cents_override: number | null
  amount_tl: number | null
  plan_parse_status: string
  plan_parse_note: string | null
  is_31_12: boolean
  is_cancelled: boolean
  cancel_reason: string | null
  excluded_override: boolean | null
  is_excluded_firm: boolean
  is_allocatable: boolean
  needs_review: boolean
  raw_changed_after_override: boolean
  is_iade: boolean
  turu_raw: string
}

export interface FirmaDetayTaksit {
  id: string
  invoice_id: string
  seq: number
  side: string
  due_date: string
  amount_eur_cents: number
  remaining_eur_cents: number | null
  source: string
  no_date_flag: boolean
}

export interface FirmaDetayOdeme {
  id: string
  islem_kodu: string
  sheet_side: string
  islem_tarihi: string | null
  gelen_tl: number | null
  doviz_eur_cents: number | null
  kur: number | null
  aciklama: string | null
  kayit_durumu: string | null
  is_alc: boolean
  is_kdv: boolean
  allocatable: boolean
}

export interface FirmaDetayTahsis {
  payment_id: string
  installment_id: string
  invoice_id: string
  amount_eur_cents: number
}

export interface FirmaDetay {
  firma: {
    id: string
    code_norm: string
    code_raw: string
    name: string
    segment: string | null
    city: string | null
    phone: string | null
    pazarlamaci_email: string | null
    is_auto_created: boolean
  }
  run_id: string | null
  bakiye: BalanceRow | null
  irsaliyeler: FirmaDetayIrsaliye[]
  taksitler: FirmaDetayTaksit[]
  odemeler: FirmaDetayOdeme[]
  tahsisler: FirmaDetayTahsis[]
}

/** Firma görünmüyorsa (yok ya da yetki dışı) null. */
export function firmaDetay(supabase: SupabaseClient, firmId: string): Promise<FirmaDetay | null> {
  return rpc<FirmaDetay | null>(supabase, 'rpc_firma_detay', { p_firm_id: firmId })
}

// ---------------------------------------------------------------------------
// Takvim matrisi (Konsinye / Peşin)
// ---------------------------------------------------------------------------
export interface TakvimVerisi {
  run_id: string | null
  /** Tüm aylar (kategori süzgeci uygulanmış) */
  ozet: {
    toplam_borc: number
    toplam_odenen: number
    toplam_kalan: number
    /** bugüne göre vadesi geçmiş kalan */
    gecikmis: number
    /** bugün dahil 7 gün içinde vadesi gelen kalan */
    yakin_7: number
    tarihsiz_adet: number
    yas_0_30: number
    yas_31_60: number
    yas_61_90: number
    yas_90p: number
  } | null
  /** Yalnız seçili ay */
  ay_ozet: { borc: number; odeme: number; kalan: number; gecikmis: number } | null
  /** Verisi olan aylar — ay seçici için */
  aylar: Array<{ ay: string; borc: number; kalan: number }>
  /** Bu taraftaki tipler (süzgeçten bağımsız) — süzgeç düğmeleri için */
  kategoriler: Array<{ kod: string; borc: number; kalan: number; gecikmis: number; firma: number }>
  firmalar: TakvimFirmaSatiri[]
}

/** Takvim sayfası verisi — tek ağ turu (0006_takvim.sql, rpc_takvim). */
export function takvim(
  supabase: SupabaseClient,
  side: 'PESIN' | 'VADELI',
  ay: string,
  kategori: string | null = null,
  bugun = todayISO(),
): Promise<TakvimVerisi> {
  const { bas, son } = ayAraligiHesapla(ay)
  return rpc<TakvimVerisi>(supabase, 'rpc_takvim', {
    p_side: side,
    p_ay_bas: bas,
    p_ay_son: son,
    p_bugun: bugun,
    p_kategoriler: kategori ? [kategori] : null,
  })
}

// ---------------------------------------------------------------------------
// İnceleme kuyruğu
// ---------------------------------------------------------------------------
export interface IncelemeIrsaliye {
  id: string
  fis_no: string
  firm_id: string
  firm_code: string
  firm_name: string
  invoice_date: string
  belge_no_raw: string
  odeme_plani_raw: string
  plan_override_note: string | null
  amount_eur_cents: number | null
  sale_type: string
  suggested_sale_type: string | null
  classify_reason: string | null
  plan_parse_status: string
  plan_parse_note: string | null
  is_31_12: boolean
  is_cancelled: boolean
  is_excluded_firm: boolean
  excluded_override: boolean | null
  fisno_nonstandard: boolean
  needs_review: boolean
  raw_changed_after_override: boolean
  is_iade: boolean
  turu_raw: string
  sale_type_override: string | null
  is_allocatable: boolean
}

export interface IncelemeTarihsiz {
  installment_id: string
  firm_id: string
  firm_code: string
  firm_name: string
  fis_no: string
  due_date: string
  remaining_eur_cents: number
}

export interface IncelemeVerisi {
  irsaliyeler: IncelemeIrsaliye[]
  tarihsiz: IncelemeTarihsiz[]
}

export function incelemeVerisi(supabase: SupabaseClient): Promise<IncelemeVerisi> {
  return rpc<IncelemeVerisi>(supabase, 'rpc_inceleme')
}
