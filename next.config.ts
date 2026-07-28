import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sayfalar arası gidiş-gelişte istemci yönlendirici önbelleği. Next
  // varsayılanı 0'dır: aynı sayfaya dönmek bile TAM sunucu turu demektir.
  // 30 sn'lik pencere, konsinye ↔ peşin gibi geçişleri anında yapar.
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
