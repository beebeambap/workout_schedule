// Korean public holidays. Tries nager.at API first (accurate including
// lunar holidays), falls back to a small hardcoded set on failure.
// Cached per year in localStorage.

const FALLBACK = {
  '2025-01-01': '신정',
  '2025-03-01': '삼일절',
  '2025-05-05': '어린이날',
  '2025-06-06': '현충일',
  '2025-08-15': '광복절',
  '2025-10-03': '개천절',
  '2025-10-09': '한글날',
  '2025-12-25': '성탄절',
  '2026-01-01': '신정',
  '2026-03-01': '삼일절',
  '2026-05-05': '어린이날',
  '2026-06-06': '현충일',
  '2026-08-15': '광복절',
  '2026-10-03': '개천절',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  '2027-01-01': '신정',
  '2027-03-01': '삼일절',
  '2027-05-05': '어린이날',
  '2027-06-06': '현충일',
  '2027-08-15': '광복절',
  '2027-10-03': '개천절',
  '2027-10-09': '한글날',
  '2027-12-25': '성탄절',
};

const cache = {};

async function fetchYear(year) {
  if (cache[year]) return cache[year];
  const stored = localStorage.getItem(`holidays_${year}`);
  if (stored) {
    try { cache[year] = JSON.parse(stored); return cache[year]; } catch (_) {}
  }
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const map = {};
    for (const h of data) map[h.date] = h.localName || h.name;
    localStorage.setItem(`holidays_${year}`, JSON.stringify(map));
    cache[year] = map;
    return map;
  } catch (_) {
    const map = {};
    for (const [k, v] of Object.entries(FALLBACK)) {
      if (k.startsWith(String(year))) map[k] = v;
    }
    cache[year] = map;
    return map;
  }
}

// Synchronous lookup against cache. Call ensureYearLoaded(year) first to populate.
export function lookupHoliday(dateStr) {
  if (!dateStr) return null;
  const y = dateStr.slice(0, 4);
  return cache[y]?.[dateStr] || null;
}

export async function ensureYearLoaded(year) {
  await fetchYear(year);
}

// Preload commonly used years
export async function preloadHolidays() {
  const y = new Date().getFullYear();
  await Promise.all([fetchYear(y - 1), fetchYear(y), fetchYear(y + 1)]);
}
