import BakiyeSayfasi from '@/components/bakiye/BakiyeSayfasi'
import KonsinyeSekmeleri from '@/components/bakiye/KonsinyeSekmeleri'

export const dynamic = 'force-dynamic'

export default function KonsinyeBakiyePage() {
  return (
    <>
      <KonsinyeSekmeleri aktif="bakiye" />
      <div className="mt-4">
        <BakiyeSayfasi />
      </div>
    </>
  )
}
