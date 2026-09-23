import TakvimSayfasi from '@/components/takvim/TakvimSayfasi'

export const dynamic = 'force-dynamic'

// Peşin borçlarda vade = irsaliye tarihi; aynı takvim, haftalık sütunlar ve
// yaşlandırma kartlarıyla sunulur.
export default async function PesinPage({ searchParams }: { searchParams: Promise<{ ay?: string; kategori?: string }> }) {
  return (
    <TakvimSayfasi
      taraf="PESIN"
      yol="/pesin"
      baslik="Peşin Borçlar"
      aciklama="İrsaliye tarihine göre: her peşin borcun ödenen ve kalan tutarı. Ödemeler önce peşin borçları kapatır."
      arama={await searchParams}
    />
  )
}
