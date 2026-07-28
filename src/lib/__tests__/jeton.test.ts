import { describe, expect, it } from "vitest";
import { jetonBitisi, jetonTazeMi, type Cerez } from '@/lib/jeton';

const SIMDI = Date.UTC(2026, 6, 28, 12, 0, 0); // 2026-07-28 12:00Z

function jwtYap(expSaniye: number): string {
  const govde = Buffer.from(JSON.stringify({ sub: "u1", exp: expSaniye })).toString("base64url");
  return `basliksiz.${govde}.imza`;
}

function cerezYap(jwt: string | null, opts: { base64?: boolean; parcali?: boolean } = {}): Cerez[] {
  const govde = JSON.stringify(jwt === null ? { user: {} } : { access_token: jwt });
  const deger = opts.base64 ? "base64-" + Buffer.from(govde).toString("base64") : govde;
  if (opts.parcali) {
    const orta = Math.floor(deger.length / 2);
    return [
      { name: "sb-abcdef-auth-token.0", value: deger.slice(0, orta) },
      { name: "sb-abcdef-auth-token.1", value: deger.slice(orta) },
    ];
  }
  return [{ name: "sb-abcdef-auth-token", value: deger }];
}

describe("jetonBitisi", () => {
  it("düz JSON çerezden bitiş anını okur", () => {
    const exp = Math.floor(SIMDI / 1000) + 3600;
    expect(jetonBitisi(cerezYap(jwtYap(exp)))).toBe(exp * 1000);
  });

  it("base64- önekli çerezi çözer", () => {
    const exp = Math.floor(SIMDI / 1000) + 600;
    expect(jetonBitisi(cerezYap(jwtYap(exp), { base64: true }))).toBe(exp * 1000);
  });

  it("parçalı (.0/.1) çerezleri sırayla birleştirir", () => {
    const exp = Math.floor(SIMDI / 1000) + 600;
    expect(jetonBitisi(cerezYap(jwtYap(exp), { base64: true, parcali: true }))).toBe(exp * 1000);
  });

  it("çerez yoksa / bozuksa / jeton yoksa null döner", () => {
    expect(jetonBitisi([])).toBeNull();
    expect(jetonBitisi([{ name: "baska-cerez", value: "x" }])).toBeNull();
    expect(jetonBitisi([{ name: "sb-abcdef-auth-token", value: "bozuk-json" }])).toBeNull();
    expect(jetonBitisi(cerezYap(null))).toBeNull();
    expect(jetonBitisi([{ name: "sb-abcdef-auth-token", value: '{"access_token":"tek-parca"}' }])).toBeNull();
  });
});

describe("jetonTazeMi — şüphede kalınca DAİMA ağa çıkan yola düşer", () => {
  it("bir saat ömrü kalan jeton taze", () => {
    expect(jetonTazeMi(cerezYap(jwtYap(Math.floor(SIMDI / 1000) + 3600)), SIMDI)).toBe(true);
  });

  it("süresi dolmuş jeton taze DEĞİL", () => {
    expect(jetonTazeMi(cerezYap(jwtYap(Math.floor(SIMDI / 1000) - 10)), SIMDI)).toBe(false);
  });

  it("bitmesine 60 sn kalan jeton (pay içinde) taze DEĞİL — tazeleme yoluna girer", () => {
    expect(jetonTazeMi(cerezYap(jwtYap(Math.floor(SIMDI / 1000) + 60)), SIMDI)).toBe(false);
  });

  it("payın hemen üstündeki jeton taze", () => {
    expect(jetonTazeMi(cerezYap(jwtYap(Math.floor(SIMDI / 1000) + 121)), SIMDI)).toBe(true);
  });

  it("çözülemeyen her durumda false (güvenli taraf)", () => {
    expect(jetonTazeMi([], SIMDI)).toBe(false);
    expect(jetonTazeMi([{ name: "sb-x-auth-token", value: "{}" }], SIMDI)).toBe(false);
  });
});
