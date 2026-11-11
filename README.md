# Avrupa Tahsilat Sistemi

Boya/hırdavat toptan satışı için **alacak ve tahsilat takip sistemi**. Satış irsaliyelerini
(Peşin / Konsinye / Konsinye Peşin ve panelden eklenen diğer satış kategorileri) ve gelen
ödemeleri Excel'den okur, borçları firma ve vade tarihi bazında takvim görünümünde izler,
ödemeleri FIFO kuralıyla borçlardan düşer.

## Ne yapar?

- **İrsaliye içe aktarma (.xls):** Satış kategorisini **tanıma kurallarıyla** (Belge No / Türü
  kolonu), Ödeme Planı'ndan vade tarihlerini otomatik çözer. Desteklenen plan biçimleri: `NAKİT` · `05.03.2026` · `05/3-4-5` (aylar listesi) ·
  `05/ 4--8--12` (**çift çizgi = aralık**: 4'ten 12'ye tüm aylar) · boş (vade = irsaliye tarihi,
  "tarih girilmedi" işaretiyle). Çok aylı planlarda tutar taksitlere **eşit bölünür**, küsurat son taksite eklenir.
- **31/12 kuralı:** 31 Aralık tarihli irsaliyeler içe aktarılır ama borç hesabına **hiç katılmaz**.
- **Ödeme içe aktarma (.xlsx):** "Bağlanan Kurlar" yedeğinin PEŞİN ve VADELİ sayfalarını okur.
  `ALC-` (eski alacak kayıtları) ve `TAMAMLANMAMIŞ` kayıtlar bilgi olarak saklanır, tahsise girmez.
- **Tek havuz mutabakatı (EUR üzerinden):** Firmanın TÜM ödemeleri (hangi sayfadan gelirse gelsin)
  tek havuzda toplanır; **önce peşin borçlar** (en eski önce), **sonra en yakın vadeli konsinye
  taksitleri** kapatılır. Fazla ödeme **alacak** olur ve bir sonraki borcu otomatik kapatır.
  **KDV 1/5 ödemeleri** havuza girmez: ödemenin yanındaki irsaliye referansı (son 4 hane —
  'KDV FATURA REFERANSI' kolonu veya açıklamadaki `0042-5TE1` deseni) ile **eşleşen irsaliyeden
  tamamı düşülür, kalan tutar taksitlendirilmiş kabul edilir**. Referansı çözülemeyen KDV
  ödemeleri tahsise girmez ve panelde "eşleşmedi" olarak görünür. **DÖVİZ EURO'su boş** ödemeler
  de hesaba giremez: **İnceleme → Ödeme Tutarı**'ndan EUR girilir (öneri: GELEN TL ÷ kur); girilen
  tutar sonraki yüklemelerde korunur. Her gece otomatik tam hesap yapılır (`vercel.json` → `crons`).
- **Takvim görünümleri:** Konsinye/Konsinye Peşin ayrı, Peşin ayrı sayfada; satır = firma.
  **Sade** görünümde her vade günü (ya da haftası) tek hücre: kalan tutar, **bugüne göre** renkli
  (vadesi geçti kırmızı · 7 gün içinde turuncu · ödendi yeşil); tıklayınca Borç · Ödeme · Kalan.
  **Excel düzeni** görünümünde her vade için **BORÇ | ÖDEME | KALAN** üçlüsü — mevcut Excel
  tablonuzla aynı düzen (Excel çıktısı da bu düzendedir). Firma arama, sorumlu / yalnız gecikmiş
  süzgeçleri, satış tipi düğmeleri, sıralama, ay listesi, sabit başlık, yazdırma ve mobil görünüm.
- **Bakiye tablosu ve "Vadeli Bakiyeler" Excel'i:** **Konsinye → Bakiye tablosu** sekmesi, elle
  tutulan "Vadeli ve Peşin Borç Tablosu"nun karşılığıdır: satır = firma; her vade **ayı** için
  **VADELİ BORÇ · PEŞİN BORÇ (ayın başı) · PEŞİN BORÇ (ayın ortası) · ÖDEME · KALAN**
  (VADELİ = Konsinye, PEŞİN = Konsinye Peşin). Aylar dönüşümlü turuncu / sarı; borcu tamamen
  kapanmış geçmiş aylar **gizli** gelir ("Kapanan ayları göster"); camgöbeği sütun **bu aya kadar
  kalan** toplamdır; başlıktaki tarihten farklı vadeler hücre **notu** olur; tıklanan satır sarıya
  boyanır. **Excel'e aktar** aynı tabloyu — ekrandaki süzgeçlerle — renkleri, donmuş başlıkları,
  gizli sütunları, notları ve **formülleriyle** indirir (sayfalar: *Vadeli Bakiyeler*, *ALACAKLILAR*,
  *Taksit Dökümü*, *Bilgi*). Her rol indirebilir; pazarlamacının dosyasında yalnız kendi firmaları
  olur. SENET ÇEK sütunu elle doldurulmak üzere boş gelir.
- **Raporlar sayfası ve PDF "Tahsilat Durum Raporu":** bütün indirmeler **Raporlar** sayfasında
  toplanır. PDF rapor üç türdedir, indirirken seçilir — **Kısa özet** (tek sayfa: ana rakamlar,
  yaşlandırma, en çok geciken 10 firma), **Yönetim özeti** (+ kategori ve sorumlu kırılımı, aylara
  göre vade / tahsilat, dönem tahsilatı, veri uyarıları) ve **Ayrıntılı** (+ her sorumlu için firma
  firma liste, alacaklı firmalar). Sorumluya ve döneme göre süzülür. Her rol indirebilir;
  pazarlamacının raporu yalnız kendi firmalarını içerir. Rapordaki rakamlar Pano ve Excel ile aynı
  kaynaktan gelir (*toplam tahsilat = borca işlenen ödeme + alacak*). Uzun firma unvanları PDF
  tablolarında tek satıra kısaltılır ("… LİMİTED ŞİRKETİ" → "… LTD. ŞTİ.", sığmazsa "…"); firmayı
  kodu tanımlar, tam unvan uygulamadadır. Hiçbir firmaya sorumlu atanmamışsa "Sorumlu" sütunu ve
  sorumlu kırılımı çizilmez; aylık tabloda 12 aydan eski aylar tek satırda toplanır.
- **Yardım — İş Akış Prosedürü:** kimin ne yapacağı (yükleme sırası, inceleme, düzeltmeler,
  raporlar) ve yazılımın nasıl hesapladığı (kategori tanıma, taksit planı, ödemelerin borca
  işlenmesi) **Yardım** sayfasında durur; aynı içerik PDF olarak indirilir.
- **Sorumlu atama:** **Yönetim → Bayiler ve Sorumlular**'da firmalar işaretlenip sorumlu
  (pazarlamacı) atanır ya da kaldırılır — dosya yüklemeden. Sorumlu; pazarlamacının hangi
  firmaları göreceğini ve tablolardaki / Excel'deki SORUMLU sütununu belirler; borç hesabını
  etkilemez. Bayi listesi yeniden yüklendiğinde dosyadaki **boş** sorumlu hücresi mevcut atamayı silmez.
- **Tahsilat Yöneticisi düzenlemeleri:** İrsaliye iptali, tutar/tip/vade değişikliği, taksitleri elle
  düzenleme. Her değişiklik **denetim kaydına** işlenir; aynı dosya yeniden yüklendiğinde
  düzenlemeler **asla ezilmez**.
- **Roller:** `yonetici` (her şey + kullanıcı yönetimi) · `tahsilat_yoneticisi` (düzenleme, içe
  aktarma, Excel raporları) · `pazarlamaci` (yalnız kendi firmalarının borçlarını görür).
- **Takip dışı firmalar:** Tanımlı kodların (42 adet kurulumla gelir) verileri hesaplara katılmaz;
  liste panelden yönetilir. Eşleşme Türkçe karakter duyarsızdır (`54 C03` ↔ `54 Ç03`).
- **Satış kategorileri ve tanıma kuralları (Yönetim paneli):** Peşin / Konsinye / Konsinye Peşin
  dışında yeni kategoriler oluşturulur; her kategorinin **davranışı** seçilir — *Peşin gibi*
  (Peşin sayfası), *Vadeli gibi* (Konsinye sayfası) ya da *Hesaba katılmaz* (yalnız bilgi).
  Ad, renk, sayfadaki süzgeç düğmesi ve panodaki kart ayarlanır. İrsaliyeler kategorilere
  sıralı **tanıma kurallarıyla** (Belge No / Türü: içerir, ile başlar, ile biter, tam olarak,
  düzenli ifade) atanır; kural kaydı önce **etkisini gösterir**, onaydan sonra mevcut irsaliyeler de
  yeniden sınıflandırılır. Elle seçilmiş kategoriler asla değişmez. Ayarları yalnız **Yönetici**
  değiştirir; Tahsilat Yöneticisi görür.

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
2. Bu depodaki migration dosyalarını SIRAYLA çalıştırın: **`supabase/migrations/0001_init.sql`** →
   **`0002_havuz_tahsis.sql`** → **`0003_kdv_eslestirme.sql`** → **`0004_hiz.sql`** →
   **`0005_hiz_rls.sql`** → **`0006_takvim.sql`** → **`0007_kategoriler.sql`** →
   **`0008_duzeltmeler.sql`** → **`0009_bakiye_tablosu.sql`** → **`0010_rapor.sql`** (her birinin
   içeriğini yapıştırıp **Run**).
3. Hepsinde "Success" görmelisiniz. (Dosyalar güvenlidir; yanlışlıkla ikinci kez çalıştırmak sorun çıkarmaz.)

> **Sistemi daha önce kurduysanız (güncelleme):** yalnız henüz çalıştırmadığınız migration
> dosyalarını sırayla çalıştırın, ardından uygulamada **Pano → Yeniden Hesapla**'ya basın.
> Dosyaları yeniden yüklemeniz gerekmez.

> **Gece otomatik hesap (0008):** `vercel.json`'daki `crons` kaydı her gece 00:00 UTC'de
> (≈ 03:00 Türkiye) `/api/cron/gece-hesabi` ucunu çağırır; uç o gün henüz tam hesap
> yapılmadıysa bütün sistemi yeniden hesaplar (günde en fazla bir kez). Vercel Cron yalnız
> üretim dağıtımında çalışır. **İsteğe bağlı:** Vercel → Settings → Environment Variables'a
> `CRON_SECRET` (uzun rastgele bir değer) eklerseniz ucu yalnız Vercel'in zamanlayıcısı
> çağırabilir; eklemezseniz de günlük koruma sayesinde en fazla bir hesap yapılır.

> **Sürüm geri alma notu (0007):** Migration'lar geri uyumludur — eski uygulama sürümü yeni
> şemayla çalışmaya devam eder. **Ancak** panelden yeni bir satış kategorisi oluşturup
> irsaliyelere atadıktan sonra 0007 öncesi bir uygulama sürümüne dönmek güvenli değildir
> (eski kod yalnız Peşin / Konsinye / Konsinye Peşin'i tanır). Geri dönmeniz gerekirse önce
> yeni kategorilerdeki irsaliyeleri bu üç kategoriden birine taşıyın.

> **Bölge:** `vercel.json` uygulama sunucusunu Frankfurt'a (`fra1`) sabitler; Supabase
> projesi de Frankfurt'tadır (`eu-central-1`). İkisi farklı kıtalarda olursa her sorgu
> ~90 ms yol alır ve sayfalar saniyeler sürer. Supabase'i başka bölgede kurarsanız
> `regions` değerini ona en yakın Vercel bölgesiyle değiştirin. Kontrol: `/api/saglik`.

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
2. **Yönetim → Bayiler ve Sorumlular** → bayi Excel'ini yükleyin (firma adları + pazarlamacı
   eşlemesi). Sorumlular aynı sayfadaki tablodan da atanabilir (firmaları işaretleyin → **Sorumlu ata**).
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
| Site `404: NOT_FOUND` veriyor (deployment "Ready" olduğu halde) | Repo boşken import edildiyse Vercel framework'ü algılayamaz ve sayfaları servis etmez. Bu repodaki `vercel.json` bunu otomatik düzeltir — son kodu çekip yeniden deploy edin. Alternatif: Vercel → Settings → **Build and Deployment** → Framework Preset = **Next.js** → Redeploy. |
| "Eksik ortam değişkeni" hatası veya site sizi sürekli `/setup`'a atıyor | Vercel → Settings → Environment Variables'da Supabase anahtarlarının ve `SETUP_SECRET`'ın olduğundan emin olun (README adım 2–3), sonra **Redeploy** yapın. |
| `/setup` "Veritabanına ulaşılamadı" diyor | 4. adımdaki SQL henüz çalıştırılmamış. `0001_init.sql`'i Supabase SQL Editor'de çalıştırın. |
| `/setup` "Kurulum daha önce tamamlanmış" diyor | Normal — kullanıcılar zaten oluşturulmuş. Yeni kullanıcı/şifre işlemleri **Yönetim → Kullanıcılar**'dan yapılır. |
| Pazarlamacı hiç firma göremiyor | Firmaların sorumlu e-postası ile kullanıcının giriş e-postası birebir aynı olmalı. **Yönetim → Bayiler ve Sorumlular**'da firmaları işaretleyip **Sorumlu ata** deyin (ya da bayi listesini güncelleyip yeniden yükleyin). |
| Excel'de / tablolarda SORUMLU sütunu boş | Firmalara henüz sorumlu atanmamış. **Yönetim → Bayiler ve Sorumlular** → "Sorumlusu olmayanlar" süzgeci → işaretleyip atayın. |
| "Excel'e aktar" ya da "PDF indir" hata veriyor | `https://<adresiniz>/api/saglik?belge=1` açın: `belge.excel.ok` ve `belge.pdf.ok` **true** olmalı (sunucu örnek birer dosya üretip boyutlarını döndürür). "Veritabanı güncellemesi (0009 / 0010) uygulanmamış" iletisi geliyorsa 4. adımdaki ilgili dosyayı çalıştırın. |
| İçe aktarma "yetkiniz yok" diyor | İçe aktarmayı yalnız Yönetici ve Tahsilat Yöneticisi yapabilir. |
| Rakamlar beklediğinizden farklı | **İnceleme** sayfasını kontrol edin: sınıflandırma bekleyenler, iadeler ve 31/12 kayıtları hesaplara katılmaz. Panodaki **Yeniden Hesapla** ile mutabakatı hemen tazeleyebilirsiniz (her gece kendiliğinden de yapılır). EUR tutarı boş ödemeler hiçbir borca yazılmaz: **İnceleme → Ödeme Tutarı**'ndan EUR girin. **Yönetim → Genel Bakış** veri sağlığını tek ekranda gösterir. |
| Çok sayıda irsaliye "Sınıflandırılmadı" | **Yönetim → Tanıma Kuralları**: sağdaki "Tanınmayan Belge No kalıpları"na tıklayın, deneme kutusunda sonucu görün, uygun kuralı ekleyip **Etkiyi önizle → Kaydet ve uygula**. |
| İçe aktarma "kurallar önizlemeden sonra değişti" diyor | Önizleme ile onay arasında tanıma kuralları değişmiş. Dosyayı yeniden önizleyip onaylayın. |
| Sayfalar yavaş açılıyor | `https://<adresiniz>/api/saglik` açın: `sunucu_bolgesi` `fra1` ve `en_hizli_tur_ms` 60'ın altında olmalı (normalde ~35). Değilse Vercel'de son dağıtımın üretimde olduğunu ve `vercel.json`'daki bölgeyi kontrol edin. |

## Geliştiriciler için

```bash
npm install          # bağımlılıklar
npm test             # birim testleri (motor, parserlar, kategoriler, kurallar)
npm run dev          # geliştirme sunucusu
npm run build        # üretim derlemesi
```

- Kimlik doğrulama tamamen sunucu tarafındadır (`@supabase/ssr`); tarayıcıya service-role anahtarı asla gitmez.
- RLS: istemci **salt okunur**; hiçbir tabloda istemci yazma politikası yoktur. Tüm yazmalar rol
  kontrolü yapan route handler'lardan geçer.
- Para hesapları EUR **tam kuruş (cent) tamsayısıyla** yapılır; TL tutarlar bilgi amaçlıdır.
- Mutabakat sürümlüdür: her hesap yeni `recon_run` altına yazılır, sonra işaretçi çevrilir —
  yarım sonuç asla görünmez. Motor deterministiktir (aynı veri → aynı tahsis).
- Biçimli Excel (`exceljs`): sayfanın bütün hücreleri, biçimleri ve formülleri saf bir **sayfa
  planı** olarak kurulur (`src/lib/bakiye/sayfaPlani.ts`, exceljs içe aktarmaz — birim testli);
  `src/lib/export/exceljsYaz.ts` yalnız dosyaya aktarır. Ekrandaki tablo, Excel ve raporlar aynı
  modelden (`src/lib/bakiye/model.ts`) beslenir. `exceljs` derlemeye gömülür; `next.config`'te
  `serverExternalPackages`e **eklemeyin** (dosya izleme bir alt bağımlılığı kaçırır, canlıda 500 verir).
- PDF (`pdfmake`): `src/lib/pdf/pdf.ts` (yazı tipi bellekten, adres ve dosya erişimi kapalı) ve
  `src/lib/pdf/parcalar.ts` (ortak parçalar). Rapor sayıları saf `src/lib/rapor/tahsilatDurumu.ts`
  içinde kurulur; belge kurucu yalnız dizer. Prosedürün içeriği tek kaynaktadır
  (`src/lib/yardim/icerik.ts`); Yardım sayfası ve PDF ondan üretilir. `pdfmake` de derlemeye gömülür.
  pdfmake taşan metni kesmez (alt satıra indirir); tek satırda kalması gereken hücreler
  `src/lib/pdf/olcu.ts` (Roboto harf genişlikleri, `sigdir`) ve `src/lib/rapor/unvan.ts`
  (`kisaUnvan`) ile sütun genişliğine sığdırılır. Yazı tipinde olmayan karakterler (→ gibi)
  `src/lib/pdf/karakter.ts` içinde eşdeğeriyle değiştirilir; testler belgedeki bütün metinleri denetler.
- Veritabanı entegrasyon testleri (yerel PostgreSQL; tüm migration'lar sırayla kurulur — RLS,
  sayfa fonksiyonları, kategori/kural akışları): `PG_TEST_SOCKET=/tmp/pgs npm test`
- Gerçek dosyalarla entegrasyon testleri: `PG_TEST_SOCKET=... IRSALIYE_FILE=... ODEMELER_FILE=... BAYILER_FILE=... npm test`
