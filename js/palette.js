// HSL ↔ hex converters
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

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = d / (l > 0.5 ? 2 - max - min : max + min);
  let h;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function wcagContrast(hex) {
  const lin = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return (1 + 0.05) / (lum + 0.05); // contrast with white background
}

// 10 base hues — kept exact for backward-compat with migration checks.
const BASE = [
  { hex: '#e11d48', name: '산호' },
  { hex: '#ea580c', name: '귤' },
  { hex: '#a16207', name: '머스터드' },
  { hex: '#15803d', name: '숲' },
  { hex: '#0d9488', name: '민트' },
  { hex: '#0284c7', name: '하늘' },
  { hex: '#4f46e5', name: '청보라' },
  { hex: '#7c3aed', name: '라벤더' },
  { hex: '#c026d3', name: '자두' },
  { hex: '#475569', name: '그라파이트' },
];

// 10 lightness steps, darkest→lightest.
// L=55,60 covers 청보라(L≈59)/라벤더(L≈58) which pass AA due to high blue luminance.
const SHADE_L = [22, 26, 30, 34, 38, 42, 46, 50, 55, 60];

// 10 hue × 10 shade = 100 color slots.
// Each base hex is placed at its closest shade index so the exact color appears in the grid.
export const COLOR_SLOTS = BASE.flatMap((base, hi) => {
  const [h, s, lBase] = hexToHsl(base.hex);
  const closestIdx = SHADE_L.reduce(
    (best, l, i) => Math.abs(l - lBase) < Math.abs(SHADE_L[best] - lBase) ? i : best, 0
  );
  return SHADE_L.map((l, si) => {
    const hex = si === closestIdx ? base.hex : hslToHex(h, s, l);
    const contrast = wcagContrast(hex);
    return { hueIndex: hi, shadeIndex: si, hex, name: `${base.name} ${si + 1}`, hueName: base.name, aa: contrast >= 4.5, baseShadeIndex: closestIdx };
  });
});

// Original 10 base colors — unchanged for backward-compat with migration checks.
export const COLOR_PALETTE = BASE.map(b => ({ hex: b.hex, name: b.name }));
export const COLOR_DEFAULT = '#0284c7';

// Lookup: any known hex → hueIndex (covers both base and computed slot colors).
const HEX_TO_HUE = new Map();
BASE.forEach((b, i) => HEX_TO_HUE.set(b.hex.toLowerCase(), i));
COLOR_SLOTS.forEach(s => HEX_TO_HUE.set(s.hex.toLowerCase(), s.hueIndex));

// 2-level round-robin: least-used hue → within that hue, least-used AA shade.
export function pickNextColor(members) {
  const aaSlots = COLOR_SLOTS.filter(s => s.aa);
  const arr = members || [];

  const hueCounts = Array(10).fill(0);
  const slotCounts = new Map(aaSlots.map(s => [s.hex, 0]));
  for (const m of arr) {
    const hi = m.color ? HEX_TO_HUE.get(m.color.toLowerCase()) : undefined;
    if (hi !== undefined) hueCounts[hi]++;
    if (m.color && slotCounts.has(m.color)) slotCounts.set(m.color, slotCounts.get(m.color) + 1);
  }

  const minHue = Math.min(...hueCounts);
  const bestHue = hueCounts.indexOf(minHue);

  const hueSlots = aaSlots.filter(s => s.hueIndex === bestHue);
  const baseShadeIdx = hueSlots[0]?.baseShadeIndex ?? 5;
  // Ties broken by proximity to base shade so the original color is assigned first.
  return hueSlots.sort((a, b) => {
    const ca = slotCounts.get(a.hex) ?? 0, cb = slotCounts.get(b.hex) ?? 0;
    if (ca !== cb) return ca - cb;
    return Math.abs(a.shadeIndex - baseShadeIdx) - Math.abs(b.shadeIndex - baseShadeIdx);
  })[0].hex;
}
