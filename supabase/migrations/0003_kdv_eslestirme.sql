-- ============================================================================
-- 0003 — KDV 1/5 ÖDEMELERİNİN HEDEFLİ TAHSİSİ
--
-- Kural değişikliği: KDV 1/5 ödemeleri artık hariç tutulmaz. Ödemenin
-- yanındaki irsaliye referansı (son 4 hane — 'KDV FATURA REFERANSI' kolonu
-- veya açıklamadaki '0042-5TE1' deseni) ile eşleşen irsaliyeden ödemenin
-- TAMAMI düşülür, kalan tutar taksitlendirilmiş kabul edilir.
-- Referansı çözülemeyen KDV ödemeleri tahsise girmez ve panelde
-- "eşleşmedi" olarak görünür.
--
-- Bu dosyayı 0002_havuz_tahsis.sql'den SONRA Supabase SQL Editor'de çalıştırın.
-- İdempotenttir. Çalıştırdıktan sonra Pano > "Yeniden Hesapla"ya basın.
-- ============================================================================

-- allocatable: KDV ödemeleri de mutabakata katılır (hedefli); ALC ve
-- TAMAMLANMAMIŞ kayıtlar dışarıda kalmaya devam eder.
alter table public.payments drop column if exists allocatable;
alter table public.payments add column allocatable boolean
  generated always as (not is_alc and is_complete) stored;
