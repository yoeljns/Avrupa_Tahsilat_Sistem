import { BOS_BAKIYE_SUZGEC, SORUMLUSUZ, bakiyeGorunumu, bakiyeModeliKur, type BakiyeModeli, type BakiyeSuzgec } from '@/lib/bakiye/model'
import { alacaklilarPlani, bilgiPlani, durumNotu, taksitDokumuPlani, vadeliBakiyelerPlani, type BilgiGirdisi, type SayfaPlani } from '@/lib/bakiye/sayfaPlani'
import { trDateTime } from '@/lib/format'
import { kategoriEtiketi } from '@/lib/kategoriMeta'
import type { BakiyeVerisi } from '@/lib/queries'
import { sade } from '@/lib/takvim'

// "Vadeli Bakiyeler" çalışma kitabı — kullanıcının Excel düzeni.
// rpc_bakiye_verisi(…, p_dokum = true) çıktısından dört sayfanın planını kurar.
// Saf işlev (dosyaya yazma: exceljsYaz.kitapYaz).

/** Süzgecin okunur özeti ("Bilgi" sayfası ve dosya adı için) */
export function kapsamYazisi(s: BakiyeSuzgec): string {
  const parca: string[] = []
  if (s.sorumlu === SORUMLUSUZ) parca.push('Sorumlusu olmayan firmalar')
  else if (s.sorumlu) parca.push(`Sorumlu: ${s.sorumlu}`)
  if (s.arama.trim()) parca.push(`Arama: "${s.arama.trim()}"`)
  if (s.yalnizGecikmis) parca.push('Yalnız gecikmiş')
  if (s.bitenleriGizle) parca.push('Borcu bitenler hariç')
  return parca.length > 0 ? parca.join(' · ') : 'Tüm firmalar'
}

export interface VadeliBakiyelerSonucu {
  model: BakiyeModeli
  planlar: SayfaPlani[]
}

export function vadeliBakiyelerPlanlari(veri: BakiyeVerisi, bugun: string, suzgec: BakiyeSuzgec = BOS_BAKIYE_SUZGEC, simdi: Date = new Date()): VadeliBakiyelerSonucu {
  const model = bakiyeGorunumu(bakiyeModeliKur(veri, bugun), suzgec, 'sorumlu')
  const t = veri.tazelik
  const bilgi: BilgiGirdisi = {
    bugun,
    uretimZamani: trDateTime(simdi.toISOString()),
    sonHesap: t?.son_hesap ? trDateTime(t.son_hesap) : null,
    sonIrsaliyeYukleme: t?.son_irsaliye_yukleme ? trDateTime(t.son_irsaliye_yukleme) : null,
    sonOdemeYukleme: t?.son_odeme_yukleme ? trDateTime(t.son_odeme_yukleme) : null,
    sonIrsaliyeTarihi: t?.son_irsaliye_tarihi ?? null,
    sonOdemeTarihi: t?.son_odeme_tarihi ?? null,
    kapsam: kapsamYazisi(suzgec),
    firmaSayisi: model.satirlar.length,
  }
  // Alacaklar: firma süzgeçleri (arama, sorumlu) uygulanır; borç süzgeçleri alacağı etkilemez
  const aranan = sade(suzgec.arama)
  const alacaklar = veri.alacaklar.filter((a) => {
    if (aranan && !sade(`${a.kod} ${a.ad}`).includes(aranan)) return false
    if (suzgec.sorumlu === SORUMLUSUZ ? a.sorumlu !== null : suzgec.sorumlu && a.sorumlu !== suzgec.sorumlu) return false
    return true
  })
  return {
    model,
    planlar: [
      vadeliBakiyelerPlani(model, durumNotu(bilgi)),
      alacaklilarPlani(alacaklar),
      taksitDokumuPlani(model, veri.firmalar, veri.dokum ?? [], (kod) => kategoriEtiketi(veri.kategoriler, kod)),
      bilgiPlani(model, bilgi),
    ],
  }
}
