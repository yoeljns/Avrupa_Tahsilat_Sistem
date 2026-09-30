// Ödemeye elle EUR girişinin saf yardımcıları (istemci ve testler ortak kullanır).

/** GELEN TL ÷ kur → önerilen EUR (kuruş); hesaplanamazsa null. Öneri yalnız kutuyu doldurur. */
export function oneriKurus(gelenTl: number | null, kur: number | null): number | null {
  if (!gelenTl || !kur || gelenTl <= 0 || kur <= 0) return null
  return Math.round((gelenTl / kur) * 100)
}
