import type { Prosedur } from './bloklar'

// İŞ AKIŞ PROSEDÜRÜ — içerik (tek kaynak).
// /yardim sayfası ve /api/rapor/prosedur (PDF) bu veriden üretilir.
//
// YAZIM KURALI: buradaki her cümle kodun gerçekte yaptığını anlatır. Bir kural ya da
// ekran etiketi değiştiğinde bu dosya da güncellenir (ilgili kaynaklar: src/lib/engine/*,
// src/lib/tahsisGirdisi.ts, src/lib/recompute.ts, src/lib/import/*, sayfa bileşenleri).
// Metinlerde yalnız **kalın** işareti kullanılır.

export const PROSEDUR: Prosedur = {
  baslik: 'İş Akış Prosedürü',
  altBaslik: 'Avrupa Tahsilat Sistemi — kim ne yapar, yazılım nasıl hesaplar',
  guncelleme: '2026-11-11',
  bolumler: [
    // -----------------------------------------------------------------------
    {
      id: 'amac',
      baslik: 'Amaç ve kapsam',
      ozet: 'Sistem neyi takip eder, veriyi nereden alır, neyi yapmaz.',
      bloklar: [
        {
          tur: 'paragraf',
          metin:
            'Sistem, satış irsaliyelerinden doğan alacakları ve gelen ödemeleri tek yerde izler: hangi firmanın ne kadar borcu var, borç hangi vadede, ne kadarı ödendi, ne kadarı gecikti.',
        },
        {
          tur: 'paragraf',
          metin:
            'Veri iki Excel dosyasından gelir: **satış irsaliyeleri** ve **gelen ödemeler**. Sistem bu dosyaları okur, borçları vadelere böler ve ödemeleri sabit bir kurala göre borçlara işler. Bütün hesap **avro (EUR)** üzerindendir; TL tutarlar yalnız bilgi içindir.',
        },
        {
          tur: 'liste',
          ogeler: [
            'İrsaliyeleri satış kategorisine ayırır: Peşin, Konsinye, Konsinye Peşin ve panelden eklenen kategoriler.',
            'Ödeme planından vade tarihlerini çıkarır ve tutarı taksitlere böler.',
            'Ödemeleri borçlara işler; fazla ödemeyi firmanın alacağı olarak tutar.',
            'Takvim, bakiye tablosu, firma kartı, Excel ve PDF raporları üretir.',
            'Elle yapılan her düzeltmeyi denetim kaydına yazar.',
          ],
        },
        {
          tur: 'kutu',
          ton: 'uyari',
          baslik: 'Kapsam dışı',
          satirlar: [
            'Senet, çek ve teminat takibi sistemde yoktur; Excel çıktısındaki SENET ÇEK sütunu elle doldurulmak üzere boş gelir.',
            'Sistem resmi muhasebe kaydı değildir. Kaynağı yüklenen dosyalardır: dosyalar yüklenmedikçe rakamlar güncellenmez.',
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'roller',
      baslik: 'Kim ne yapar',
      ozet: 'Üç rol vardır. Veriyi yalnız Yönetici ve Tahsilat Yöneticisi değiştirebilir.',
      bloklar: [
        {
          tur: 'tablo',
          genislikler: [2, 4, 5],
          basliklar: ['Rol', 'Neyi görür', 'Ne yapar'],
          satirlar: [
            [
              '**Yönetici**',
              'Bütün firmalar ve bütün ekranlar.',
              'Tahsilat Yöneticisinin yaptığı her şey. Ayrıca kullanıcı açar, rol verir, şifre sıfırlar; satış kategorilerini ve tanıma kurallarını değiştirir.',
            ],
            [
              '**Tahsilat Yöneticisi**',
              'Bütün firmalar. Yönetim panelinde kategori ve kuralları görür ama değiştiremez.',
              'Dosya yükler, inceleme kuyruğunu boşaltır, irsaliye düzeltir, ödemeye EUR girer, sorumlu atar, takip dışı firmaları yönetir, yeniden hesap başlatır, bütün raporları alır.',
            ],
            [
              '**Pazarlamacı**',
              'Yalnız kendisine atanmış firmalar: Pano, Konsinye, Peşin, Firmalar, Raporlar, Yardım.',
              'Takip eder. Vadeli Bakiyeler Excel\'ini ve Tahsilat Durum Raporu\'nu kendi firmaları için indirir. Veri değiştiremez.',
            ],
          ],
        },
        {
          tur: 'paragraf',
          metin:
            'Pazarlamacının bir firmayı görebilmesi için firmanın **sorumlu e-postası**, pazarlamacının giriş e-postasıyla aynı olmalıdır. Atama **Yönetim → Bayiler ve Sorumlular** sayfasından yapılır. E-postası hiçbir aktif kullanıcıyla eşleşmeyen firmaları hiçbir pazarlamacı göremez; bu durum Yönetim → Genel Bakış\'ta uyarı olarak görünür.',
        },
        {
          tur: 'kutu',
          ton: 'bilgi',
          satirlar: [
            'Veri Sıfırlama yalnız sistem sahibinin hesabına açıktır.',
            'Hiçbir yönetici kendi hesabını pasifleştiremez ya da kendi rolünü düşüremez.',
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'is-akisi',
      baslik: 'İnsan tarafı: iş akışı',
      ozet: 'Sıra önemlidir: önce veri yüklenir, sonra inceleme kuyruğu boşaltılır, sonra takip edilir ve rapor alınır.',
      bloklar: [
        { tur: 'altbaslik', metin: 'Veri yükleme' },
        {
          tur: 'adimlar',
          ogeler: [
            '**Gerektiğinde bayi listesi.** Yeni bayi ya da ad, şehir değişikliği varsa **Yönetim → Bayiler ve Sorumlular** sayfasındaki "Bayi Listesi (.xlsx)" kutusundan yükleyin. Sütunlar: logo_kodu, bayi_adi, segment, sehir, telefon, pazarlamaci_email.',
            '**İrsaliyeler.** **İçe Aktarım** sayfasında "Satış İrsaliyeleri (.xls)" kutusundan dosyayı seçin ve **Önizle** deyin.',
            '**Önizlemeyi okuyun.** Yeni, Güncellenecek, Değişmeyen, İnceleme Bekleyecek, 31/12 (hariç) ve Geçersiz sayılarına bakın. Beklemediğiniz bir sayı varsa (örneğin çok sayıda Geçersiz satır) **Vazgeç** deyin; onaylamadıkça hiçbir veri değişmez.',
            '**Onayla ve Aktar.** Sistem kayıtları yazar ve bütün hesabı yeniden yapar.',
            '**Ödemeler.** Aynı sayfadaki "Gelen Ödemeler (.xlsx)" kutusu için 2–4. adımları yineleyin.',
          ],
        },
        {
          tur: 'kutu',
          ton: 'bilgi',
          baslik: 'Aynı dosyayı yeniden yüklemek güvenlidir',
          satirlar: [
            'Aynı kayıtlar güncellenir, yeniler eklenir; hiçbir kayıt silinmez.',
            'Elle yaptığınız düzeltmeler korunur: kategori, tutar, vade planı, elle girilen taksitler, iptal, ödemeye elle girilen EUR, sorumlu.',
            'Düzelttiğiniz bir kaydın dosyadaki hâli sonradan değişirse kayıt İnceleme → **Çakışmalar** sekmesine düşer.',
          ],
        },
        {
          tur: 'paragraf',
          metin:
            'Dosyada olup sistemde olmayan firma kodları kendiliğinden firma olarak açılır ve Firmalar listesinde "oto" etiketiyle görünür. Adlarını bayi listesini yükleyerek tamamlayabilirsiniz.',
        },

        { tur: 'altbaslik', metin: 'İnceleme kuyruğu' },
        {
          tur: 'paragraf',
          metin:
            'Her yüklemeden sonra **İnceleme** sayfasına bakın. Sekmelerdeki sayılar bekleyen işi gösterir; amaç bu sayıları sıfıra indirmektir. Sınıflandırma ve Ödeme Tutarı sekmelerindeki kayıtlar çözülene kadar hesaba hiç girmez.',
        },
        {
          tur: 'tablo',
          genislikler: [2, 4, 4],
          basliklar: ['Sekme', 'Neyi gösterir', 'Ne yapılır'],
          satirlar: [
            [
              '**Sınıflandırma**',
              'Kategorisi tanınamayan irsaliyeler. Sınıflandırılana kadar borç hesabına girmez.',
              'Kategoriyi seçip "Seçilenleri Onayla" deyin. Çok sayıdaysa Yönetim → Tanıma Kuralları ile toplu çözün.',
            ],
            [
              '**Plan Çözülemedi**',
              'Ödeme planı okunamayan irsaliyeler. Vadeleri irsaliye tarihi sayılmıştır.',
              '"Düzenle" ile firma kartını açıp vade planını yazın.',
            ],
            [
              '**Diğer Uyarılar**',
              'Şüpheli vade (irsaliye tarihinden 30 günden fazla önce) ya da okunamayan EUR tutarı gibi uyarılar.',
              'Yanlışsa düzeltin; doğruysa "Kontrol edildi" deyin. Tutarı düzeltmek uyarıyı kendiliğinden kapatmaz.',
            ],
            [
              '**İadeler**',
              'İade irsaliyeleri. Kendiliğinden borca eklenmez.',
              'Borca eklenecekse firma kartında "Düzenle" → "Bu iadeyi borca ekle". Eklenmeyecekse "Kontrol edildi".',
            ],
            [
              '**Çakışmalar**',
              'Elle düzeltilmiş ama dosyadaki hâli sonradan değişmiş kayıtlar.',
              'Düzeltmenizin hâlâ doğru olduğunu görüp "Kontrol edildi" deyin.',
            ],
            ['**31/12 Hariçler**', '31 Aralık tarihli irsaliyeler. Borç hesabına hiç katılmaz.', 'Yalnız bilgi; işlem gerekmez.'],
            [
              '**Tarih Girilmedi**',
              'Ödeme planı boş olduğu için vadesi irsaliye tarihi sayılan açık konsinye taksitleri.',
              '"Düzenle" ile gerçek vadeyi girin.',
            ],
            [
              '**Ödeme Tutarı**',
              'EUR tutarı olmayan ödemeler. Hiçbir borca işlenemez.',
              'EUR tutarını yazıp "Kaydet" deyin. Öneri, GELEN TL ÷ kur ile hesaplanır.',
            ],
          ],
        },

        { tur: 'altbaslik', metin: 'Takip' },
        {
          tur: 'liste',
          ogeler: [
            '**Pano:** açık borç, vadesi geçmiş, 7 ve 30 gün içinde vadesi gelen, alacak ve toplam tahsilat.',
            '**Konsinye → Takvim:** seçilen ayın vadeleri, firma firma. Kırmızı vadesi geçmiş, turuncu 7 gün içinde, yeşil ödenmiş.',
            '**Konsinye → Bakiye tablosu:** bütün aylar tek tabloda; her ay için vadeli borç, peşin borç, ödeme ve kalan.',
            '**Peşin:** peşin satışların açık borcu ve kaç gündür beklediği (yaşlandırma).',
            '**Firma kartı:** firmanın irsaliyeleri, vade takvimi ve ödemeleri. Bir rakamın nereden geldiğini görmek için buraya bakılır.',
          ],
        },

        { tur: 'altbaslik', metin: 'Düzeltmeler' },
        {
          tur: 'paragraf',
          metin:
            'Bir irsaliyeyi düzeltmek için firma kartında irsaliyenin yanındaki **Düzenle** düğmesini kullanın. Değiştirebilecekleriniz: satış kategorisi, EUR tutarı, vade planı, taksitler (elle; toplamı irsaliye tutarına eşit olmalıdır) ve iptal.',
        },
        {
          tur: 'liste',
          ogeler: [
            'İptal için **sebep zorunludur**. Diğer düzeltmelerde sebep isteğe bağlıdır ama yazmanız önerilir; denetim kaydına geçer.',
            'Yeni vade planı yazarsanız, elle girilmiş taksitler dahil bütün taksitler yeni plana göre yeniden kurulur.',
            'Tutarı değiştirirseniz elle girilmiş taksitler tarihleri korunarak yeni tutara oranlanır.',
            'Kaydettiğiniz anda yalnız o firmanın hesabı yenilenir; sonuç hemen ekrana yansır.',
          ],
        },

        { tur: 'altbaslik', metin: 'Sorumlu atama' },
        {
          tur: 'paragraf',
          metin:
            '**Yönetim → Bayiler ve Sorumlular** sayfasındaki tabloda firmaları işaretleyin, sorumluyu seçin ve "Sorumlu ata" deyin. Sorumlu; pazarlamacının hangi firmaları göreceğini, tablolardaki ve Excel\'deki SORUMLU sütununu ve raporlardaki sorumlu kırılımını belirler. Borç hesabını etkilemez.',
        },

        { tur: 'altbaslik', metin: 'Raporlar' },
        {
          tur: 'liste',
          ogeler: [
            '**Vadeli Bakiyeler (Excel):** bakiye tablosunun renkli, formüllü Excel hâli. Sorumluya göre ayrı ayrı indirilebilir.',
            '**Tahsilat Durum Raporu (PDF):** Kısa özet, Yönetim özeti ya da Ayrıntılı. Toplantı ve paylaşım için.',
            '**Borç Raporu ve Tahsilat Detayı (Excel):** düz listeler; yalnız yönetim.',
            'Hepsi **Raporlar** sayfasındadır. Dosyalar düğmeye basıldığı anda, o andaki veriyle üretilir.',
          ],
        },

        { tur: 'altbaslik', metin: 'Ne zaman ne yapılır' },
        {
          tur: 'tablo',
          genislikler: [2, 5, 3],
          basliklar: ['Sıklık', 'İş', 'Kim'],
          satirlar: [
            ['Her veri geldiğinde', 'İrsaliye ve ödeme dosyalarını yüklemek; inceleme kuyruğunu boşaltmak.', 'Tahsilat Yöneticisi'],
            ['Her gün', 'Pano ve Konsinye takvimine bakmak: vadesi geçenler ve 7 gün içinde vadesi gelenler.', 'Tahsilat Yöneticisi, Pazarlamacı'],
            ['Haftalık', 'Tahsilat Durum Raporu (Kısa özet ya da Yönetim özeti) almak; en çok geciken firmaları aramak.', 'Tahsilat Yöneticisi'],
            ['Aylık', 'Vadeli Bakiyeler Excel\'ini almak; Yönetim → Genel Bakış\'taki veri sağlığı satırlarını sıfırlamak.', 'Tahsilat Yöneticisi'],
            ['Gerektiğinde', 'Yeni bayi, sorumlu değişikliği, yeni kullanıcı, yeni kategori ya da tanıma kuralı.', 'Yönetici'],
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'hesap',
      baslik: 'Yazılım tarafı: hesap kuralları',
      ozet: 'Yazılım her seferinde aynı kuralları uygular; aynı veri her zaman aynı sonucu verir.',
      bloklar: [
        { tur: 'altbaslik', metin: 'İrsaliyenin kategorisi' },
        {
          tur: 'paragraf',
          metin:
            'Her irsaliye, **tanıma kuralları** ile bir satış kategorisine atanır. Kurallar irsaliyenin Belge No ya da Türü alanına bakar ve sırayla denenir; ilk uyan kural geçerlidir. Kurulumla gelen kurallar şunlardır:',
        },
        {
          tur: 'tablo',
          genislikler: [5, 3],
          basliklar: ['Belge No', 'Kategori'],
          satirlar: [
            ['"KONSİNYE PEŞİN" içeriyor', 'Konsinye Peşin'],
            ['"KONSİNYE" içeriyor', 'Konsinye'],
            ['"+" ile başlıyor', 'Peşin'],
            ['Yalnız rakam (sipariş numarası gibi)', 'Sınıflandırılmadı; öneri Peşin'],
            ['"AVI…", "REVİZE" ya da "IRS" içeriyor', 'Sınıflandırılmadı; öneri Konsinye'],
          ],
        },
        {
          tur: 'paragraf',
          metin:
            'Hiçbir atama kuralına uymayan irsaliye **Sınıflandırılmadı** olur: taksiti oluşmaz, borç hesabına girmez ve İnceleme → Sınıflandırma sekmesinde bekler. Her kategorinin bir **davranışı** vardır: "Peşin gibi" (Peşin sayfası), "Vadeli gibi" (Konsinye sayfası) ya da "Hesaba katılmaz". Kategorileri ve kuralları Yönetici değiştirir; elle seçilmiş kategoriler kural değişse de aynı kalır.',
        },

        { tur: 'altbaslik', metin: 'Hesaba katılmayan kayıtlar' },
        {
          tur: 'tablo',
          genislikler: [3, 6],
          basliklar: ['Kayıt', 'Ne olur'],
          satirlar: [
            ['31 Aralık tarihli irsaliye', 'İçe aktarılır ama borç hesabına hiç katılmaz.'],
            ['İptal edilen irsaliye', 'Borç hesabından çıkar; kayıt silinmez, iptal geri alınabilir.'],
            ['Sınıflandırılmamış irsaliye', 'Kategori seçilene kadar borç hesabına girmez.'],
            ['İade irsaliyesi', 'Borca eklenmez. Yalnız "Bu iadeyi borca ekle" işaretlenirse ya da kategorisi elle seçilirse eklenir.'],
            ['Takip dışı firma', 'İrsaliyeleri de ödemeleri de hesaba katılmaz. Liste: Yönetim → Takip Dışı Firmalar.'],
            ['"ALC" ile başlayan ödeme kaydı', 'Eski alacak kaydıdır; bilgi olarak saklanır, borca işlenmez.'],
            ['Kayıt durumu tamamlanmamış ödeme', 'Bilgi olarak saklanır, borca işlenmez.'],
            ['EUR tutarı olmayan ödeme', 'İnceleme → Ödeme Tutarı\'nda EUR girilene kadar borca işlenmez.'],
            ['İrsaliyesi bulunamayan KDV ödemesi', 'Borca işlenmez; Yönetim → Genel Bakış\'ta "Eşleşmeyen KDV ödemesi" olarak sayılır.'],
          ],
        },

        { tur: 'altbaslik', metin: 'Ödeme planı ve taksitler' },
        {
          tur: 'paragraf',
          metin: 'İrsaliyenin Ödeme Planı alanı vade tarihlerine çevrilir. Tanınan yazımlar:',
        },
        {
          tur: 'tablo',
          genislikler: [3, 6],
          basliklar: ['Yazım', 'Anlamı'],
          satirlar: [
            ['NAKİT', 'Vade, irsaliye tarihidir.'],
            ['05.03.2026', 'Tek vade: 5 Mart 2026.'],
            ['.30', 'İrsaliye tarihinden 30 gün sonra.'],
            ['05/3-4-5', 'Ayın 5\'i; Mart, Nisan ve Mayıs (tek çizgi: sayılan aylar).'],
            ['05/ 4--8', 'Ayın 5\'i; Nisan\'dan Ağustos\'a bütün aylar (çift çizgi: aralık).'],
            ['05/ 11-12-1-2', 'Aylar geriye dönünce yıl atlar: Kasım, Aralık, ertesi yılın Ocak ve Şubat ayları.'],
            ['(boş)', 'Vade, irsaliye tarihi sayılır. Konsinye taksitleri "tarih girilmedi" işaretiyle İnceleme\'ye düşer.'],
          ],
        },
        {
          tur: 'liste',
          ogeler: [
            'Tutar, vade sayısına **eşit bölünür**; kuruş farkı son taksite eklenir.',
            'Ay 31 çekmiyorsa gün, ayın son gününe çekilir (31 Şubat yazılmışsa 28 ya da 29 Şubat).',
            'Okunamayan plan: vade irsaliye tarihi sayılır ve kayıt Plan Çözülemedi sekmesine düşer.',
            'Vadelerden biri irsaliye tarihinden 30 günden fazla önceyse plan şüpheli sayılır ve Diğer Uyarılar sekmesine düşer.',
          ],
        },

        { tur: 'altbaslik', metin: 'Ödemelerin borca işlenmesi' },
        {
          tur: 'paragraf',
          metin:
            'Ödeme dosyasının yalnız PEŞİN ve VADELİ sayfaları okunur. Ödemenin hangi sayfada yazıldığı hesabı etkilemez: firmanın bütün ödemeleri **tek havuzda** toplanır ve şu sırayla borca işlenir:',
        },
        {
          tur: 'adimlar',
          ogeler: [
            '**KDV 1/5 ödemeleri** havuza girmez. Her biri, yanındaki irsaliye referansının (fiş numarasının son 4 hanesi) gösterdiği irsaliyeden düşülür; irsaliyenin taksitlerine kalanlarıyla orantılı dağıtılır.',
            'Diğer ödemeler tarih sırasıyla havuza girer. Havuz **önce peşin borçları**, en eskisinden başlayarak kapatır.',
            'Peşin borç kalmayınca **konsinye taksitleri**, en yakın vadeden ileriye doğru kapatılır.',
            'Borç bittikten sonra artan tutar firmanın **alacağıdır**. Yeni bir borç geldiğinde alacak onu kendiliğinden kapatır.',
          ],
        },
        {
          tur: 'kutu',
          ton: 'ornek',
          satirlar: [
            'Firmanın 1.000 € peşin borcu ve iki konsinye taksiti var: 5 Mart vadeli 2.000 € ve 5 Nisan vadeli 2.000 €.',
            'Firma 2.500 € öder. Önce peşin borcun 1.000 €\'su kapanır; kalan 1.500 € en yakın vadeye, 5 Mart taksitine işlenir.',
            'Sonuç: peşin borç 0 €; 5 Mart taksitinden 500 € kalır; 5 Nisan taksiti 2.000 € olarak durur. Toplam kalan 2.500 €.',
          ],
        },
        {
          tur: 'paragraf',
          metin:
            'Bir firmanın ödemesi başka bir firmanın borcunu asla kapatmaz. Hesap her seferinde baştan yapılır; bu yüzden geriye dönük bir düzeltme (örneğin eski bir irsaliyenin iptali) sonraki bütün işlemeleri de kendiliğinden düzeltir.',
        },

        { tur: 'altbaslik', metin: 'Tanımlar' },
        {
          tur: 'tablo',
          genislikler: [3, 6],
          basliklar: ['Terim', 'Nasıl hesaplanır'],
          satirlar: [
            ['Vadesi geçmiş', 'Vadesi bugünden önce olan ve henüz kapanmamış tutar. Bugün, Türkiye saatine göredir.'],
            ['7 gün / 30 gün içinde', 'Konsinye tarafında, bugün dahil 7 / 30 gün içinde vadesi gelen kalan tutar.'],
            ['Toplam tahsilat', 'Hesaba giren ödemelerin toplamı: borca işlenen kısım + alacak.'],
            ['Yaşlandırma', 'Açık borcun, vadesinden bugüne geçen güne göre dağılımı: vadesi gelmemiş, 1–30, 31–60, 61–90, 90+ gün.'],
            ['Bu aya kadar kalan', 'Bakiye tablosundaki camgöbeği sütun: içinde bulunulan ay dahil, açık ayların kalan toplamı.'],
          ],
        },

        { tur: 'altbaslik', metin: 'Hesap ne zaman yapılır' },
        {
          tur: 'tablo',
          genislikler: [4, 5],
          basliklar: ['Olay', 'Hesabın kapsamı'],
          satirlar: [
            ['İrsaliye ya da ödeme dosyası onaylanınca', 'Bütün firmalar.'],
            ['İrsaliye düzeltilince, sınıflandırılınca, ödemeye EUR girilince', 'Yalnız ilgili firma; sonuç hemen görünür.'],
            ['Tanıma kuralı, kategori davranışı ya da takip dışı listesi değişince', 'Bütün firmalar.'],
            ['Her gece (yaklaşık 03:00)', 'Bütün firmalar. O gün zaten tam hesap yapıldıysa atlanır.'],
            ['Pano → "Yeniden Hesapla"', 'Bütün firmalar; elle başlatılır.'],
          ],
        },
        {
          tur: 'paragraf',
          metin:
            'Tam hesap bitene kadar ekranlar bir önceki sonucu gösterir; yarım sonuç hiçbir zaman görünmez. Sorumlu atamak ve bayi listesi yüklemek borç hesabını etkilemez; bu yüzden yeniden hesap gerektirmez.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'ekranlar',
      baslik: 'Ekran rehberi',
      ozet: 'Hangi iş için hangi ekran.',
      bloklar: [
        {
          tur: 'tablo',
          genislikler: [3, 5, 5],
          basliklar: ['Ekran', 'Ne gösterir', 'İpucu'],
          satirlar: [
            ['**Pano**', 'Genel durum: açık borç, vadesi geçmiş, yaklaşan vadeler, alacak, toplam tahsilat.', 'Üstte son hesabın zamanı yazar. Kategori kartlarına tıklayınca ilgili sayfa süzülmüş açılır.'],
            [
              '**Konsinye → Takvim**',
              'Seçilen ayın vadeleri; satır firma, sütun vade günü ya da haftası.',
              '"Sade" görünüm kalanı renkle gösterir; "Excel düzeni" Borç, Ödeme, Kalan üçlüsünü verir. Hücreye tıklayınca ayrıntı açılır.',
            ],
            [
              '**Konsinye → Bakiye tablosu**',
              'Bütün aylar: ay başına vadeli borç, iki peşin borç sütunu, ödeme ve kalan.',
              'Borcu kapanmış geçmiş aylar gizli gelir; "Kapanan ayları göster" ile açılır. Kırmızı köşe işareti, başlıktaki tarihten farklı bir vade olduğunu gösterir. Satıra tıklayınca satır işaretlenir.',
            ],
            ['**Peşin**', 'Peşin satışların borcu ve yaşlandırması.', 'Peşin borç, ödemelerin ilk kapattığı borçtur.'],
            ['**Firmalar**', 'Bütün firmalar: peşin ve konsinye borç, vadesi geçmiş, alacak, ilk vade.', 'Koda tıklayınca firma kartı açılır.'],
            [
              '**Firma kartı**',
              'İrsaliyeler, vade takvimi, ödemeler ve her ödemenin hangi irsaliyeye işlendiği.',
              'Düzeltmeler buradan yapılır. Ödenmiş geçmiş aylar katlanmış gelir.',
            ],
            ['**Raporlar**', 'Bütün indirmeler: PDF rapor, Excel\'ler, bu prosedür.', 'PDF raporun türünü, sorumluyu ve dönemi indirmeden önce seçin.'],
            ['**İçe Aktarım**', 'İrsaliye ve ödeme dosyalarının yüklenmesi; son yüklemelerin listesi.', 'Önce Önizle, sonra Onayla ve Aktar.'],
            ['**İnceleme**', 'Karar bekleyen kayıtlar, sekme sekme.', 'Sekmelerdeki sayılar sıfır olmalıdır.'],
            [
              '**Yönetim**',
              'Genel Bakış, Satış Kategorileri, Tanıma Kuralları, Kullanıcılar, Bayiler ve Sorumlular, Takip Dışı Firmalar, Denetim Kaydı.',
              'Genel Bakış\'taki "Veri sağlığı" satırları, raporların doğruluğunu etkileyen açık işleri gösterir.',
            ],
          ],
        },
        { tur: 'altbaslik', metin: 'Vadeli Bakiyeler Excel\'i' },
        {
          tur: 'liste',
          ogeler: [
            '**Vadeli Bakiyeler** sayfası ekrandaki tablonun aynısıdır: aylar dönüşümlü turuncu ve sarı; ilk altı sütun ve üç başlık satırı dondurulmuştur.',
            'Borcu kapanmış geçmiş ayların sütunları **gizlidir**. Görmek için iki yanındaki sütun harflerini seçip sağ tıklayın ve "Göster" deyin.',
            'Köşesinde kırmızı işaret olan hücrelerde not vardır: başlıktaki tarihten farklı vadeler ve tutarları.',
            'Toplamlar formüldür; bir hücreyi değiştirirseniz satır ve sütun toplamları kendiliğinden güncellenir.',
            '**ALACAKLILAR** sayfası fazla ödemesi olan firmaları, **Taksit Dökümü** tablodaki her sayının dayandığı taksitleri, **Bilgi** sayfası veri tarihlerini ve sütun açıklamalarını verir.',
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'durumlar',
      baslik: 'Sık karşılaşılan durumlar',
      ozet: 'Bir rakam beklediğiniz gibi değilse önce buraya bakın.',
      bloklar: [
        {
          tur: 'tablo',
          genislikler: [3, 4, 4],
          basliklar: ['Durum', 'Olası sebep', 'Çözüm'],
          satirlar: [
            [
              'Bir firmanın borcu beklenenden **az**',
              'İrsaliyesi sınıflandırılmamış, 31/12 tarihli, iptal edilmiş ya da iade olabilir.',
              'Firma kartında irsaliyenin yanındaki rozetlere bakın; İnceleme → Sınıflandırma\'yı kontrol edin.',
            ],
            [
              'Bir firmanın borcu beklenenden **çok**',
              'Ödemesi EUR tutarı olmadığı için, tamamlanmamış göründüğü için ya da KDV referansı eşleşmediği için işlenmemiş olabilir.',
              'İnceleme → Ödeme Tutarı\'na ve firma kartındaki Ödemeler bölümüne bakın.',
            ],
            [
              'Ödeme, beklenen irsaliyeye işlenmemiş',
              'Ödemeler irsaliye irsaliye değil, kurala göre işlenir: önce peşin, sonra en yakın vade.',
              'Firma kartında ödemenin hangi taksitlere işlendiğini görün. Kural gereği olan dağılım değiştirilemez.',
            ],
            [
              'Rakamlar güncel değil',
              'Son dosyalar yüklenmemiş olabilir.',
              'Raporlar sayfasının üstündeki "Son irsaliye" ve "Son ödeme" tarihlerine bakın; dosyaları yükleyin.',
            ],
            [
              'Pazarlamacı hiç firma göremiyor',
              'Firmaların sorumlu e-postası, pazarlamacının giriş e-postasıyla aynı değil.',
              'Yönetim → Bayiler ve Sorumlular\'da firmaları işaretleyip "Sorumlu ata" deyin.',
            ],
            [
              'Tablolarda ve Excel\'de SORUMLU boş',
              'Firmalara sorumlu atanmamış.',
              'Yönetim → Bayiler ve Sorumlular → "Sorumlusu olmayanlar" süzgeci → işaretleyip atayın.',
            ],
            [
              'Çok sayıda irsaliye Sınıflandırılmadı',
              'Belge No yazımı tanıma kurallarına uymuyor.',
              'Yönetim → Tanıma Kuralları\'nda uygun kuralı ekleyin, "Etkiyi önizle" ile sonucu görün, "Kaydet ve uygula" deyin (Yönetici).',
            ],
            [
              'Onayda "Tanıma kuralları ya da kategoriler bu önizlemeden sonra değişti" iletisi',
              'Önizleme ile onay arasında kurallar değişmiş.',
              'Dosyayı yeniden seçip önizleyin, sonra onaylayın.',
            ],
            [
              'Excel ya da PDF inmiyor',
              'Oturum süresi dolmuş ya da sunucuda geçici bir sorun olabilir.',
              'Sayfayı yenileyip yeniden giriş yapın. Sürerse yöneticiye haber verin.',
            ],
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'sozluk',
      baslik: 'Sözlük',
      bloklar: [
        {
          tur: 'tablo',
          genislikler: [3, 7],
          basliklar: ['Terim', 'Anlamı'],
          satirlar: [
            ['Alacak', 'Firmanın borcundan fazla ödediği tutar. Sonraki borcu kendiliğinden kapatır.'],
            ['Borca işleme (tahsis)', 'Bir ödemenin, kurala göre belirli taksitleri kapatması.'],
            ['Denetim kaydı', 'Elle yapılan her değişikliğin kim, ne zaman, neyi değiştirdi bilgisiyle tutulduğu, silinemeyen liste.'],
            ['Fiş No', 'İrsaliyenin numarası. Aynı fiş numarası yeniden yüklenirse kayıt güncellenir.'],
            ['İnceleme kuyruğu', 'Yazılımın kendi başına karar veremediği, insanın bakması gereken kayıtlar.'],
            ['Kategori', 'Satışın türü: Peşin, Konsinye, Konsinye Peşin ya da panelden eklenenler.'],
            ['Konsinye', 'Vadeli satış. Borç, ödeme planındaki vadelere bölünür.'],
            ['Konsinye Peşin', 'Konsinye sayfasında izlenen, bakiye tablosunda PEŞİN sütunlarında görünen satış türü.'],
            ['Sorumlu', 'Firmayla ilgilenen pazarlamacı. E-postasının @ işaretinden önceki kısmı tablolarda büyük harfle görünür.'],
            ['Takip dışı firma', 'Hesaplara hiç katılmayan firma kodu.'],
            ['Taksit', 'Bir irsaliyenin tek bir vadeye düşen parçası.'],
            ['Tam hesap', 'Bütün firmaların ödemelerinin baştan borca işlenmesi.'],
            ['Tanıma kuralı', 'İrsaliyenin Belge No ya da Türü alanına bakarak kategorisini belirleyen kural.'],
            ['Vade', 'Taksitin ödenmesi gereken gün.'],
          ],
        },
      ],
    },
  ],
}
