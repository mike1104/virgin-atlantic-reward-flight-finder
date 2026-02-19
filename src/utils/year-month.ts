import { YearMonth } from "../types";

export function normalizeYearMonths(months: YearMonth[]): YearMonth[] {
  const uniq = new Set<string>();
  const normalized: YearMonth[] = [];

  for (const m of months) {
    const monthNum = Number(m.month);
    const yearNum = Number(m.year);
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) continue;
    if (!Number.isInteger(yearNum) || yearNum < 2000) continue;

    const month = String(monthNum).padStart(2, "0");
    const year = String(yearNum);
    const key = `${year}-${month}`;
    if (uniq.has(key)) continue;

    uniq.add(key);
    normalized.push({ month, year });
  }

  normalized.sort((a, b) => `${a.year}-${a.month}`.localeCompare(`${b.year}-${b.month}`));
  return normalized;
}
