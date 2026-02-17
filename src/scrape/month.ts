import * as fs from "fs";
import { Page } from "playwright";
import { MonthData, ApiMonthResponse, YearMonth } from "../types";
import { readCache, writeCache, cacheExists, getCachePath } from "../utils/cache";

const ORIGIN = "LHR";
const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function getMonthCacheFilename(
  dest: string,
  direction: "outbound" | "inbound",
  year: string,
  month: string
): string {
  return `${dest}-${direction}-${year}-${month}.json`;
}

function addMissingScrapeTimestamps(
  monthData: MonthData,
  fallbackScrapedAt: string
): { monthData: MonthData; mutated: boolean } {
  let mutated = false;

  for (const date of Object.keys(monthData)) {
    const day = monthData[date];
    if (!day.scrapedAt) {
      day.scrapedAt = fallbackScrapedAt;
      mutated = true;
    }
  }

  return { monthData, mutated };
}

function hasMissingSeatCounts(monthData: MonthData): boolean {
  for (const day of Object.values(monthData)) {
    if (day.economy !== undefined && day.economySeats === undefined) return true;
    if (day.premium !== undefined && day.premiumSeats === undefined) return true;
    if (day.upper !== undefined && day.upperSeats === undefined) return true;
  }
  return false;
}

async function fetchMonthDataWithPage(
  page: Page,
  origin: string,
  destination: string,
  month: string,
  year: string
): Promise<MonthData> {
  try {
    const scrapedAt = new Date().toISOString();
    // Navigate to the monthly view page
    const pageUrl = `https://www.virginatlantic.com/reward-flight-finder/results/month?origin=${origin}&destination=${destination}&month=${month}&year=${year}`;

    // Create promise to capture API response
    const apiResponsePromise = new Promise<ApiMonthResponse[] | null>((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 30000); // 30 second timeout for API response

      const responseHandler = async (response: any) => {
        if (resolved) return;
        const url = response.url();
        if (url.includes('/reward-seat-checker-api/') && response.status() === 200) {
          try {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
              resolved = true;
              clearTimeout(timeout);
              page.off('response', responseHandler);
              resolve(data as ApiMonthResponse[]);
            }
          } catch (e) {
            // Ignore parsing errors (redirects, etc.)
          }
        }
      };

      page.on('response', responseHandler);
    });

    // Navigate - use domcontentloaded which is faster than networkidle
    try {
      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
    } catch (e) {
      // Ignore navigation errors if we got the API response
    }

    // Wait for API response
    const apiResponse = await apiResponsePromise;

    if (!apiResponse || apiResponse.length === 0) {
      return {};
    }

    const monthData: MonthData = {};
    const apiData = apiResponse[0];

    if (!apiData || !apiData.pointsDays) {
      return {};
    }

    for (const day of apiData.pointsDays) {
      if (!day || !day.seats) continue;

      const dateStr = day.date;
      monthData[dateStr] = {
        scrapedAt,
        minPrice: day.minPrice ?? null,
        currency: day.currency ?? null,
        minAwardPointsTotal: day.minAwardPointsTotal ?? 0,
      };

      // Economy class
      if (day.seats.awardEconomy && day.seats.awardEconomy.cabinPointsValue > 0) {
        monthData[dateStr].economy = day.seats.awardEconomy.cabinPointsValue;
        monthData[dateStr].economySeats = day.seats.awardEconomy.cabinClassSeatCount;
        monthData[dateStr].economySeatsDisplay = day.seats.awardEconomy.cabinClassSeatCountString;
        monthData[dateStr].economyIsSaver = day.seats.awardEconomy.isSaverAward;
      }

      // Premium Economy
      if (day.seats.awardComfortPlusPremiumEconomy && day.seats.awardComfortPlusPremiumEconomy.cabinPointsValue > 0) {
        monthData[dateStr].premium = day.seats.awardComfortPlusPremiumEconomy.cabinPointsValue;
        monthData[dateStr].premiumSeats = day.seats.awardComfortPlusPremiumEconomy.cabinClassSeatCount;
        monthData[dateStr].premiumSeatsDisplay = day.seats.awardComfortPlusPremiumEconomy.cabinClassSeatCountString;
        monthData[dateStr].premiumIsSaver = day.seats.awardComfortPlusPremiumEconomy.isSaverAward;
      }

      // Upper Class (Business)
      if (day.seats.awardBusiness && day.seats.awardBusiness.cabinPointsValue > 0) {
        monthData[dateStr].upper = day.seats.awardBusiness.cabinPointsValue;
        monthData[dateStr].upperSeats = day.seats.awardBusiness.cabinClassSeatCount;
        monthData[dateStr].upperSeatsDisplay = day.seats.awardBusiness.cabinClassSeatCountString;
        monthData[dateStr].upperIsSaver = day.seats.awardBusiness.isSaverAward;
      }
    }

    return monthData;
  } catch (error) {
    console.error(`    Error fetching data:`, error);
    return {};
  }
}

export async function scrapeMonth(
  page: Page,
  origin: string,
  destination: string,
  month: string,
  year: string,
  refresh: boolean = false
): Promise<MonthData> {
  const direction = origin === ORIGIN ? "outbound" : "inbound";
  const dest = origin === ORIGIN ? destination : origin;
  const cacheFilename = getMonthCacheFilename(dest, direction, year, month);

  if (!refresh && cacheExists(cacheFilename)) {
    const cached = readCache<MonthData>(cacheFilename);
    if (cached) {
      const cachePath = getCachePath(cacheFilename);
      const cacheStat = fs.statSync(cachePath);
      const cacheMtimeIso = cacheStat.mtime.toISOString();
      const cacheAgeMs = Date.now() - cacheStat.mtime.getTime();
      const { monthData: upgradedCached, mutated } = addMissingScrapeTimestamps(cached, cacheMtimeIso);
      if (mutated) {
        writeCache(cacheFilename, upgradedCached);
      }
      if (cacheAgeMs > CACHE_MAX_AGE_MS) {
        console.log(`  ↻ Refreshing ${dest} ${direction} ${year}-${month} (cache older than 1 hour)`);
      } else if (hasMissingSeatCounts(upgradedCached)) {
        console.log(`  ↻ Refreshing ${dest} ${direction} ${year}-${month} to capture seat counts`);
      } else {
        console.log(`  ✓ Loaded ${dest} ${direction} ${year}-${month} from cache`);
        return upgradedCached;
      }
    }
  }

  console.log(`  Fetching ${origin} → ${destination} ${year}-${month}...`);

  const monthData = await fetchMonthDataWithPage(page, origin, destination, month, year);

  console.log(`    Found ${Object.keys(monthData).length} dates with availability`);
  writeCache(cacheFilename, monthData);

  return monthData;
}

export async function scrapeAllMonths(
  page: Page,
  destination: string,
  months: YearMonth[],
  refresh: boolean = false
): Promise<{ outbound: MonthData[]; inbound: MonthData[] }> {
  console.log(`\nFetching ${destination}...`);

  const browser = page.context().browser();
  if (!browser) {
    throw new Error("Browser not available");
  }

  // Create array of all requests (both outbound and inbound interleaved)
  const requests: Array<{
    type: 'outbound' | 'inbound';
    index: number;
    month: string;
    year: string;
  }> = [];

  months.forEach((m, index) => {
    requests.push({ type: 'outbound', index, month: m.month, year: m.year });
    requests.push({ type: 'inbound', index, month: m.month, year: m.year });
  });

  // Process in batches of 4 to avoid overwhelming the server
  const BATCH_SIZE = 4;
  const outboundResults: MonthData[] = new Array(months.length);
  const inboundResults: MonthData[] = new Array(months.length);

  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);

    // Process batch in parallel with separate pages
    const batchPromises = batch.map(async (req) => {
      const batchPage = await browser.newPage();
      try {
        const origin = req.type === 'outbound' ? ORIGIN : destination;
        const dest = req.type === 'outbound' ? destination : ORIGIN;
        const data = await scrapeMonth(batchPage, origin, dest, req.month, req.year, refresh);

        if (req.type === 'outbound') {
          outboundResults[req.index] = data;
        } else {
          inboundResults[req.index] = data;
        }
      } finally {
        await batchPage.close();
      }
    });

    await Promise.all(batchPromises);

    // Small delay between batches to be respectful
    if (i + BATCH_SIZE < requests.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return { outbound: outboundResults, inbound: inboundResults };
}
