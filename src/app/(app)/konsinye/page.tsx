import KonsinyeSekmeleri from '@/components/bakiye/KonsinyeSekmeleri'
import TakvimSayfasi from '@/components/takvim/TakvimSayfasi'

export const dynamic = 'force-dynamic'

export default async function KonsinyePage({ searchParams }: { searchParams: Promise<{ ay?: string; kategori?: string }> }) {
  return (
    <>
      <KonsinyeSekmeleri aktif="takvim" />
      <div className="mt-4">
        <TakvimSayfasi
          taraf="VADELI"
          yol="/konsinye"
          baslik="Konsinye / Konsinye Peşin"
          aciklama="Vade takvimi: her firmanın bu aydaki vadeleri, ödenen ve kalan tutarları. Renkler bugüne göredir."
          arama={await searchParams}
        />
      </div>
    </>
  )
}
