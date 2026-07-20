import Link from 'next/link'
import { requireRole } from '@/lib/auth'

export default async function YonetimPage() {
  const session = await requireRole(['yonetici', 'tahsilat_yoneticisi'])

  const cards = [
    ...(session.role === 'yonetici'
      ? [{ href: '/yonetim/kullanicilar', title: 'Kullanıcılar', desc: 'Kullanıcı ekleme, rol atama (Tahsilat Yöneticisi dahil), şifre sıfırlama' }]
      : []),
    { href: '/yonetim/haric-firmalar', title: 'Takip Dışı Firmalar', desc: 'Ödemeleri sisteme dahil edilmeyen firma kodları listesi' },
    { href: '/yonetim/bayiler', title: 'Bayi Listesi', desc: 'Firma–pazarlamacı eşlemesini Excel ile güncelleme' },
    { href: '/yonetim/denetim', title: 'Denetim Kaydı', desc: 'Kim, ne zaman, neyi değiştirdi — tüm değişiklik geçmişi' },
    ...(session.email.toLowerCase() === 'yy@avrupagroup.com'
      ? [{ href: '/yonetim/sifirlama', title: '⚠️ Veri Sıfırlama', desc: 'Tüm ödeme ve irsaliye verisini kalıcı olarak siler (yalnız siz)' }]
      : []),
  ]

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">Yönetim</h1>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="rounded-2xl bg-white p-5 shadow-sm hover:bg-blue-50/40">
            <h2 className="font-semibold text-slate-900">{c.title} →</h2>
            <p className="mt-1 text-sm text-slate-500">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
