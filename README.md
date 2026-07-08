# Avrupa Tahsilat Sistemi

Boya/hırdavat toptan satışı için **alacak ve tahsilat takip sistemi**. Satış irsaliyelerini
(Peşin / Konsinye / Konsinye Peşin) ve gelen ödemeleri Excel'den okur, borçları firma ve
vade tarihi bazında takvim görünümünde izler, ödemeleri FIFO kuralıyla borçlardan düşer.

## Ne yapar?

- **İrsaliye içe aktarma (.xls):** Belge No'dan satış tipini, Ödeme Planı'ndan vade tarihlerini
  otomatik çözer. Desteklenen plan biçimleri: `NAKİT` · `05.03.2026` · `05/3-4-5` (aylar listesi) ·
  `05/ 4--8--12` (**çift çizgi = aralık**: 4'ten 12'ye tüm aylar) · boş (vade = irsaliye tarihi,
  "tarih girilmedi" işaretiyle). Çok aylı planlarda tutar taksitlere **eşit bölünür**, küsurat son taksite eklenir.
- **31/12 kuralı:** 31 Aralık tarihli irsaliyeler içe aktarılır ama borç hesabına **hiç katılmaz**.
- **Ödeme içe aktarma (.xlsx):** "Bağlanan Kurlar" yedeğinin PEŞİN ve VADELİ sayfalarını okur.
  `ALC-` (eski alacak kayıtları) ve `TAMAMLANMAMIŞ` kayıtlar bilgi olarak saklanır, tahsise girmez.
- **FIFO mutabakat (EUR üzerinden):** PEŞİN ödemeler en eski peşin borçtan; VADELİ ödemeler en erken
  vadeli konsinye taksitinden düşülür. Fazla ödeme **alacak** olur, kendi tarafında kalır ve bir
  sonraki borcu otomatik kapatır. Taraflar arası geçiş yoktur.
- **Takvim görünümleri:** Konsinye/Konsinye Peşin ayrı, Peşin ayrı tabloda; satır = firma,
  sütun = vade günleri, devreden/gecikmiş sütunu ve toplamlarla.
- **Tahsilat Yöneticisi düzenlemeleri:** İrsaliye iptali, tutar/tip/vade değişikliği, taksitleri elle
  düzenleme. Her değişiklik **denetim kaydına** işlenir; aynı dosya yeniden yüklendiğinde
  düzenlemeler **asla ezilmez**.
- **Roller:** `yonetici` (her şey + kullanıcı yönetimi) · `tahsilat_yoneticisi` (düzenleme, içe
  aktarma, Excel raporları) · `pazarlamaci` (yalnız kendi firmalarının borçlarını görür).
- **Takip dışı firmalar:** Tanımlı kodların (42 adet kurulumla gelir) verileri hesaplara katılmaz;
  liste panelden yönetilir. Eşleşme Türkçe karakter duyarsızdır (`54 C03` ↔ `54 Ç03`).

---

## Kurulum (adım adım)

Gerekenler: [GitHub](https://github.com) hesabı (bu repo), [Vercel](https://vercel.com) hesabı,
[Supabase](https://supabase.com) hesabı (Vercel üzerinden otomatik açılır). Kredi kartı gerekmez,
ücretsiz planlar yeterlidir.

### 1) Vercel'e bağlayın
1. [vercel.com](https://vercel.com) → **Add New… → Project**.
2. GitHub hesabınızı bağlayın ve bu depoyu (**Avrupa_Tahsilat_Sistem**) seçin → **Import**.
3. Ayarları değiştirmeden **Deploy**'a basın. (İlk deploy'da site açılır ama veritabanı
   bağlanmadığı için henüz çalışmaz — normaldir.)

### 2) Supabase'i Vercel üzerinden ekleyin
1. Vercel'de projenizin sayfasında **Storage** sekmesine gidin.
2. **Create Database → Supabase**'i seçin, yönergeleri izleyin (bölge seçin, isim verin).
3. Bağlantı bitince Vercel, gerekli ortam değişkenlerini projeye **otomatik ekler**
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

### 3) SETUP_SECRET ekleyin
1. Vercel → proje → **Settings → Environment Variables**.
2. İsim: `SETUP_SECRET`, değer: uzun rastgele bir şifre yazın (örn. bir şifre üreticisinden).
   Bu anahtar yalnız ilk kurulum sihirbazını korur.
3. **Save** deyin, sonra **Deployments** sekmesinden son deploy'un menüsünden **Redeploy** yapın
   (env değişkenlerinin uygulanması için şart).

### 4) Veritabanı şemasını kurun
1. [supabase.com/dashboard](https://supabase.com/dashboard) → projeniz → sol menüden **SQL Editor**.
2. Bu depodaki **`supabase/migrations/0001_init.sql`** dosyasının içeriğinin TAMAMINI kopyalayıp
   yapıştırın → **Run**.
3. "Success" görmelisiniz. (Dosya güvenlidir; yanlışlıkla ikinci kez çalıştırmak sorun çıkarmaz.)

### 5) Kurulum sihirbazını çalıştırın
1. Tarayıcıda `https://<vercel-adresiniz>/setup` sayfasını açın.
2. 3. adımda belirlediğiniz `SETUP_SECRET` değerini girin → **Kurulumu Başlat**.
3. Sihirbaz şu kullanıcıları oluşturur ve **geçici şifrelerini bir kez** gösterir —
   hepsini kopyalayıp güvenle saklayın:
   - `yy@avrupagroup.com` → **Yönetici**
   - `vedat@ / ercan@ / enis@ / mehmethan@ / levent@avrupagroup.com` → **Pazarlamacı**
4. Herkes ilk girişten sonra sağ üstteki **Hesap** sayfasından şifresini değiştirmelidir.
5. **Tahsilat Yöneticisi** atamak için: `yy@` ile girin → **Yönetim → Kullanıcılar** → ilgili
   kullanıcının rolünü değiştirin (veya yeni kullanıcı oluşturun).

### 6) Verileri yükleyin (sıra önemli)
1. `yy@avrupagroup.com` ile giriş yapın.
2. **Yönetim → Bayi Listesi** → bayi Excel'ini yükleyin (firma adları + pazarlamacı eşlemesi).
3. **İçe Aktarım** → sol panelden **irsaliye .xls** dosyasını yükleyin → önizlemeyi kontrol edin →
   **Onayla ve Aktar**.
4. Aynı sayfadan **ödemeler .xlsx** dosyasını yükleyin → önizleme → **Onayla ve Aktar**.
5. Pano açılır; **İnceleme** sayfasında sınıflandırma bekleyen irsaliyeleri (Belge No'su
   tanınamayanlar) onaylayın — bunlar onaylanana kadar borç hesabına katılmaz.

Bundan sonrası rutin: yeni irsaliye/ödeme dosyalarını aynı sayfadan yüklersiniz. Aynı kayıtlar
güncellenir, yeniler eklenir, sizin yaptığınız düzenlemeler korunur ve mutabakat otomatik
yeniden hesaplanır.

---

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| "Eksik ortam değişkeni" hatası | Vercel → Settings → Environment Variables'da Supabase anahtarlarının ve `SETUP_SECRET`'ın olduğundan emin olun, sonra **Redeploy** yapın. |
| `/setup` "Veritabanına ulaşılamadı" diyor | 4. adımdaki SQL henüz çalıştırılmamış. `0001_init.sql`'i Supabase SQL Editor'de çalıştırın. |
| `/setup` "Kurulum daha önce tamamlanmış" diyor | Normal — kullanıcılar zaten oluşturulmuş. Yeni kullanıcı/şifre işlemleri **Yönetim → Kullanıcılar**'dan yapılır. |
| Pazarlamacı hiç firma göremiyor | Bayi listesindeki `pazarlamaci_email` ile kullanıcının giriş e-postası birebir aynı olmalı. **Yönetim → Bayi Listesi**'nden dosyayı güncelleyin. |
| İçe aktarma "yetkiniz yok" diyor | İçe aktarmayı yalnız Yönetici ve Tahsilat Yöneticisi yapabilir. |
| Rakamlar beklediğinizden farklı | **İnceleme** sayfasını kontrol edin: sınıflandırma bekleyenler ve 31/12 kayıtları hesaplara katılmaz. Panodaki **Yeniden Hesapla** ile mutabakatı tazeleyebilirsiniz. |

## Geliştiriciler için

```bash
npm install          # bağımlılıklar
npm test             # 115 birim testi (motor + parserlar)
npm run dev          # geliştirme sunucusu
npm run build        # üretim derlemesi
```

- Kimlik doğrulama tamamen sunucu tarafındadır (`@supabase/ssr`); tarayıcıya service-role anahtarı asla gitmez.
- RLS: istemci **salt okunur**; hiçbir tabloda istemci yazma politikası yoktur. Tüm yazmalar rol
  kontrolü yapan route handler'lardan geçer.
- Para hesapları EUR **tam kuruş (cent) tamsayısıyla** yapılır; TL tutarlar bilgi amaçlıdır.
- Mutabakat sürümlüdür: her hesap yeni `recon_run` altına yazılır, sonra işaretçi çevrilir —
  yarım sonuç asla görünmez. Motor deterministiktir (aynı veri → aynı tahsis).
- Gerçek dosyalarla entegrasyon testleri (yerel PostgreSQL gerektirir):
  `PG_TEST_SOCKET=... IRSALIYE_FILE=... ODEMELER_FILE=... BAYILER_FILE=... npm test`
