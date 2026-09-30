// Tam hesabı neyin başlattığı (recon_runs.trigger_kind) — Pano ve Genel Bakış aynı adları kullanır.

export const TETIK_ADLARI: Record<string, string> = {
  import: 'içe aktarma',
  edit: 'düzenleme',
  manual: 'elle',
  setup: 'kurulum',
  cron: 'gece (otomatik)',
}

export function tetikAdi(tur: string): string {
  return TETIK_ADLARI[tur] ?? tur
}
