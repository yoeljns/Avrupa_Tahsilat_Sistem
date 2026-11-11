import Tabs from '@/components/ui/Tabs'

/** Konsinye sayfasının iki görünümü: aylık vade takvimi ve bütün ayların bakiye tablosu. */
export default function KonsinyeSekmeleri({ aktif }: { aktif: 'takvim' | 'bakiye' }) {
  return (
    <div className="print:hidden">
      <Tabs
        items={[
          { href: '/konsinye', label: 'Takvim', aktif: aktif === 'takvim' },
          { href: '/konsinye/bakiye', label: 'Bakiye tablosu', aktif: aktif === 'bakiye' },
        ]}
      />
    </div>
  )
}
