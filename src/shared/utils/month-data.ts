import { MonthData } from "../types";
import { CACHE_RAW_MONTHS_PREFIX } from "./cache";

export function getMonthCacheFilename(
  origin: string,
  destination: string,
  year: string,
  month: string
): string {
  return `${CACHE_RAW_MONTHS_PREFIX}${origin}-${destination}-${year}-${month}.json`;
}

export function hasMissingSeatCounts(monthData: MonthData): boolean {
  for (const day of Object.values(monthData)) {
    if (day.economy !== undefined && day.economySeats === undefined) return true;
    if (day.premium !== undefined && day.premiumSeats === undefined) return true;
    if (day.upper !== undefined && day.upperSeats === undefined) return true;
  }
  return false;
}

export function mergeMonthData(monthDataArray: MonthData[]): MonthData {
  const merged: MonthData = {};
  for (const monthData of monthDataArray) {
    for (const [date, pricing] of Object.entries(monthData)) {
      merged[date] = pricing;
    }
  }
  return merged;
}
