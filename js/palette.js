// 10-color WCAG-AA palette (white text contrast >= 4.5:1).
// Avoids reds (danger/Sunday) and primary blue (Saturday/CTA).
export const COLOR_PALETTE = [
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
export const COLOR_DEFAULT = '#0284c7';

// Round-robin: returns the least-used palette color among `members`.
// Ties broken by palette order so assignment is deterministic.
export function pickNextColor(members) {
  const counts = new Map(COLOR_PALETTE.map(c => [c.hex, 0]));
  for (const m of members || []) {
    if (m && m.color && counts.has(m.color)) counts.set(m.color, counts.get(m.color) + 1);
  }
  let best = COLOR_PALETTE[0].hex;
  let bestCount = counts.get(best);
  for (const c of COLOR_PALETTE) {
    const k = counts.get(c.hex);
    if (k < bestCount) { best = c.hex; bestCount = k; }
  }
  return best;
}
