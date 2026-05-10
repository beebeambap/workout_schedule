// 레슨핏 컬러 시스템
// - 코어: #0d9488 (deep teal, 시그니처)
// - 휴 10개: 코어를 시작점으로 색상환 36° 등간격
// - 채도 통일(S=84%) + 휴별 베이스 L 자동 보정으로 흰 텍스트 WCAG AA 통과
// - 셰이드 10단계: 휴별 베이스 L 기준 -20%~+26% 오프셋

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function wcagContrast(hex) {
  const lin = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return (1 + 0.05) / (lum + 0.05);
}

export const BRAND_CORE = '#0d9488';
const CORE_S = 84;
const CORE_L = 32;

// 코어(177°)를 시작점으로 색상환 36° 등간격. 결과: [177, 213, 249, 285, 321, 357, 33, 69, 105, 141]
const HUE_DEFS = [
  { h: 177, name: '틸', isCore: true },
  { h: 213, name: '하늘' },
  { h: 249, name: '청보라' },
  { h: 285, name: '라벤더' },
  { h: 321, name: '자두' },
  { h: 357, name: '산호' },
  { h: 33,  name: '귤' },
  { h: 69,  name: '라임' },
  { h: 105, name: '새싹' },
  { h: 141, name: '숲' },
];

// 베이스 셰이드 기준 오프셋. 인덱스 1(=offset 0)이 베이스 = 휴 칩에 표시되는 메인 색.
// shade 0(왼쪽 첫 번째)은 한 단계 더 어두운 톤, shade 2~9는 점점 밝아짐.
const SHADE_OFFSETS = [-4, 0, 4, 8, 12, 16, 21, 27, 34, 42];
const BASE_SHADE_INDEX = 1;

// AA 통과(흰 텍스트 contrast≥4.5)하는 가장 밝은 L을 lMax 이하에서 탐색.
function findAaBaseL(h, s, lMax) {
  for (let l = lMax; l >= 12; l--) {
    if (wcagContrast(hslToHex(h, s, l)) >= 4.5) return l;
  }
  return 12;
}

export const COLOR_HUES = HUE_DEFS.map((hue, hi) => {
  // 모든 휴 베이스 L을 AA-safe 최대 밝기로 자동 보정. 코어도 동일.
  // 결과: 모든 베이스 셰이드(shade 5)가 흰 텍스트 contrast≥4.5 보장.
  const baseL = findAaBaseL(hue.h, CORE_S, CORE_L);
  const baseHex = hslToHex(hue.h, CORE_S, baseL);
  const shades = SHADE_OFFSETS.map((off, si) => {
    const l = Math.max(5, Math.min(85, baseL + off));
    const hex = hslToHex(hue.h, CORE_S, l);
    return { hueIndex: hi, shadeIndex: si, hex, l, aa: wcagContrast(hex) >= 4.5 };
  });
  return { hueIndex: hi, h: hue.h, name: hue.name, isCore: !!hue.isCore, baseL, baseHex, shades };
});

// 100-슬롯 평탄화 (이름 부착)
export const COLOR_SLOTS = COLOR_HUES.flatMap(hd =>
  hd.shades.map(s => ({ ...s, name: `${hd.name} ${s.shadeIndex + 1}`, hueName: hd.name }))
);

// 호환성: 기존 코드가 참조하는 10-색 베이스 팔레트
export const COLOR_PALETTE = COLOR_HUES.map(hd => ({ hex: hd.baseHex, name: hd.name }));
export const COLOR_DEFAULT = BRAND_CORE;

// hex → hueIndex 룩업 (베이스 + 모든 셰이드)
const HEX_TO_HUE = new Map();
COLOR_HUES.forEach(hd => {
  HEX_TO_HUE.set(hd.baseHex.toLowerCase(), hd.hueIndex);
  hd.shades.forEach(s => HEX_TO_HUE.set(s.hex.toLowerCase(), hd.hueIndex));
});

// 2단계 라운드로빈: 최소 사용 휴 → 해당 휴의 최소 사용 AA 셰이드 → 동률 시 베이스 셰이드 우선
export function pickNextColor(members) {
  const aaSlots = COLOR_SLOTS.filter(s => s.aa);
  const arr = members || [];
  const hueCounts = Array(COLOR_HUES.length).fill(0);
  const slotCounts = new Map(aaSlots.map(s => [s.hex, 0]));
  for (const m of arr) {
    if (!m || !m.color) continue;
    const lo = m.color.toLowerCase();
    const hi = HEX_TO_HUE.get(lo);
    if (hi !== undefined) hueCounts[hi]++;
    if (slotCounts.has(m.color)) slotCounts.set(m.color, slotCounts.get(m.color) + 1);
  }
  const minHue = Math.min(...hueCounts);
  const bestHue = hueCounts.indexOf(minHue);
  const hueSlots = aaSlots.filter(s => s.hueIndex === bestHue);
  return hueSlots.sort((a, b) => {
    const ca = slotCounts.get(a.hex) ?? 0, cb = slotCounts.get(b.hex) ?? 0;
    if (ca !== cb) return ca - cb;
    return Math.abs(a.shadeIndex - BASE_SHADE_INDEX) - Math.abs(b.shadeIndex - BASE_SHADE_INDEX);
  })[0].hex;
}

// 임의 hex → 새 팔레트의 가장 가까운 슬롯 색 (RGB 거리 기준). 마이그레이션용.
export function nearestSlotColor(hex) {
  if (!hex || hex.length !== 7) return COLOR_DEFAULT;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return COLOR_DEFAULT;
  let best = COLOR_DEFAULT;
  let bestDist = Infinity;
  for (const slot of COLOR_SLOTS) {
    const tr = parseInt(slot.hex.slice(1, 3), 16);
    const tg = parseInt(slot.hex.slice(3, 5), 16);
    const tb = parseInt(slot.hex.slice(5, 7), 16);
    const d = (tr - r) ** 2 + (tg - g) ** 2 + (tb - b) ** 2;
    if (d < bestDist) { bestDist = d; best = slot.hex; }
  }
  return best;
}
