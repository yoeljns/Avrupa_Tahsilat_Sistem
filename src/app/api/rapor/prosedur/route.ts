import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { trDateTime } from '@/lib/format'
import { pdfUret, pdfYaniti } from '@/lib/pdf/pdf'
import { PROSEDUR } from '@/lib/yardim/icerik'
import { prosedurBelgesi } from '@/lib/yardim/prosedurPdf'

export const runtime = 'nodejs'
export const maxDuration = 60

// İŞ AKIŞ PROSEDÜRÜ (PDF) — /yardim sayfasındaki içeriğin aynısı.
// Oturum açmış herkes indirebilir; belge veri içermez.

export async function GET() {
  const session = await apiSession()
  if (!session) return NextResponse.json({ error: 'Oturum gerekli. Lütfen yeniden giriş yapın.' }, { status: 401 })
  try {
    const pdf = await pdfUret(prosedurBelgesi(PROSEDUR, trDateTime(new Date().toISOString())))
    return pdfYaniti(pdf, 'is_akis_proseduru.pdf')
  } catch (e) {
    console.error('prosedur:', e)
    return NextResponse.json({ error: 'Prosedür PDF\'i oluşturulamadı.' }, { status: 500 })
  }
}
