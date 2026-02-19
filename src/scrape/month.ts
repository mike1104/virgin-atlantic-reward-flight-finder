import * as fs from "fs";
import { APIRequestContext, Browser, Page } from "playwright";
import { MonthData } from "../types";
import { readCache, writeCache, cacheExists, getCachePath } from "../utils/cache";
import { getMonthCacheFilename, hasMissingSeatCounts } from "../utils/month-data";

const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const REWARD_SEAT_CHECKER_API_URL = "https://www.virginatlantic.com/travelplus/reward-seat-checker-api/";
const DIRECT_API_RETRY_DELAY_MS = 300;
const VERBOSE_MONTH_REQUEST_LOGS = process.env.VA_VERBOSE_MONTH_REQUEST_LOGS === "1";
const MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

type FetchMonthResult = {
  monthData: MonthData;
  status: "success" | "empty" | "failed";
  failReason?: string;
  usedFallback?: boolean;
  fromCache?: boolean;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function logMonthRequestDetail(message: string): void {
  if (VERBOSE_MONTH_REQUEST_LOGS) {
    console.log(message);
  }
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

function buildMonthDataFromApiPayload(apiResponseRaw: unknown, scrapedAt: string): FetchMonthResult {
  if (!Array.isArray(apiResponseRaw)) {
    return { monthData: {}, status: "failed" };
  }
  if (apiResponseRaw.length === 0) {
    return { monthData: {}, status: "empty" };
  }

  const first = apiResponseRaw[0] as any;
  const pointsDays: any[] = Array.isArray(first?.pointsDays)
    ? first.pointsDays
    : apiResponseRaw;
  if (!Array.isArray(pointsDays)) {
    return { monthData: {}, status: "failed" };
  }

  const monthData: MonthData = {};
  for (const day of pointsDays) {
    if (!day || !day.seats) continue;

    const dateStr = day.date;
    monthData[dateStr] = {
      scrapedAt,
      minPrice: day.minPrice ?? null,
      currency: day.currency ?? null,
      minAwardPointsTotal: day.minAwardPointsTotal ?? 0,
    };

    if (day.seats.awardEconomy && day.seats.awardEconomy.cabinPointsValue > 0) {
      monthData[dateStr].economy = day.seats.awardEconomy.cabinPointsValue;
      monthData[dateStr].economySeats = day.seats.awardEconomy.cabinClassSeatCount;
      monthData[dateStr].economySeatsDisplay = day.seats.awardEconomy.cabinClassSeatCountString;
      monthData[dateStr].economyIsSaver = day.seats.awardEconomy.isSaverAward;
    }

    if (day.seats.awardComfortPlusPremiumEconomy && day.seats.awardComfortPlusPremiumEconomy.cabinPointsValue > 0) {
      monthData[dateStr].premium = day.seats.awardComfortPlusPremiumEconomy.cabinPointsValue;
      monthData[dateStr].premiumSeats = day.seats.awardComfortPlusPremiumEconomy.cabinClassSeatCount;
      monthData[dateStr].premiumSeatsDisplay = day.seats.awardComfortPlusPremiumEconomy.cabinClassSeatCountString;
      monthData[dateStr].premiumIsSaver = day.seats.awardComfortPlusPremiumEconomy.isSaverAward;
    }

    if (day.seats.awardBusiness && day.seats.awardBusiness.cabinPointsValue > 0) {
      monthData[dateStr].upper = day.seats.awardBusiness.cabinPointsValue;
      monthData[dateStr].upperSeats = day.seats.awardBusiness.cabinClassSeatCount;
      monthData[dateStr].upperSeatsDisplay = day.seats.awardBusiness.cabinClassSeatCountString;
      monthData[dateStr].upperIsSaver = day.seats.awardBusiness.isSaverAward;
    }
  }

  return {
    monthData,
    status: Object.keys(monthData).length > 0 ? "success" : "empty",
  };
}

async function fetchMonthDataWithRequest(
  request: APIRequestContext,
  origin: string,
  destination: string,
  month: string,
  year: string
): Promise<FetchMonthResult> {
  try {
    const scrapedAt = new Date().toISOString();
    const monthNum = Number(month);
    const monthName = Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12
      ? MONTH_NAMES[monthNum - 1]
      : null;
    const yearNum = Number(year);
    if (!monthName || !Number.isInteger(yearNum)) {
      return { monthData: {}, status: "failed", failReason: "invalid month/year" };
    }
    const monthPadded = String(monthNum).padStart(2, "0");
    const departure = `${year}-${monthPadded}-01`;
    const referer = `https://www.virginatlantic.com/reward-flight-finder/results/month?origin=${origin}&destination=${destination}&month=${monthPadded}&year=${year}`;

    const response = await request.post(REWARD_SEAT_CHECKER_API_URL, {
      data: {
        slice: {
          origin,
          destination,
          departure,
        },
        passengers: ["ADULT"],
        permittedCarriers: ["VS"],
        years: [yearNum],
        months: [monthName],
      },
      headers: {
        "content-type": "application/json",
        referer,
      },
      timeout: 60000,
    });
    if (!response.ok()) {
      const status = response.status();
      const statusText = response.statusText().trim();
      let responseSnippet = "";
      try {
        responseSnippet = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 140);
      } catch {
        // Body can be unavailable for blocked/terminated requests.
      }

      const reason =
        responseSnippet.length > 0
          ? `HTTP ${status}${statusText ? ` ${statusText}` : ""} - ${responseSnippet}`
          : `HTTP ${status}${statusText ? ` ${statusText}` : ""}`;
      return { monthData: {}, status: "failed", failReason: reason };
    }

    const apiResponseRaw = await response.json();
    return buildMonthDataFromApiPayload(apiResponseRaw, scrapedAt);
  } catch (error) {
    return { monthData: {}, status: "failed", failReason: getErrorMessage(error) };
  }
}

async function fetchMonthDataWithPageFallback(
  page: Page,
  origin: string,
  destination: string,
  month: string,
  year: string
): Promise<FetchMonthResult> {
  try {
    const scrapedAt = new Date().toISOString();
    const pageUrl = `https://www.virginatlantic.com/reward-flight-finder/results/month?origin=${origin}&destination=${destination}&month=${month}&year=${year}`;
    let lastApiStatus: number | null = null;
    let apiParseErrors = 0;

    const apiResponsePromise = new Promise<unknown | null>((resolve) => {
      let settled = false;
      const finish = (value: unknown | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        page.off("response", responseHandler);
        resolve(value);
      };

      const timeout = setTimeout(() => finish(null), 30000);
      const responseHandler = async (response: any) => {
        const url = response.url();
        if (!url.includes("/reward-seat-checker-api/")) return;
        const status = response.status();
        if (status !== 200) {
          lastApiStatus = status;
          return;
        }
        try {
          const data = await response.json();
          finish(data);
        } catch {
          apiParseErrors += 1;
          // Continue listening until timeout/next valid response.
        }
      };

      page.on("response", responseHandler);
    });

    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch {
      // Ignore navigation errors if API response still arrives.
    }

    const apiResponseRaw = await apiResponsePromise;
    if (!apiResponseRaw) {
      if (lastApiStatus !== null) {
        return {
          monthData: {},
          status: "failed",
          failReason: `fallback API HTTP ${lastApiStatus}`,
        };
      }
      return {
        monthData: {},
        status: "failed",
        failReason: apiParseErrors > 0 ? "fallback API parse failure" : "fallback API timeout",
      };
    }
    return buildMonthDataFromApiPayload(apiResponseRaw, scrapedAt);
  } catch (error) {
    return { monthData: {}, status: "failed", failReason: getErrorMessage(error) };
  }
}

export async function scrapeMonth(
  request: APIRequestContext,
  browser: Browser,
  origin: string,
  destination: string,
  month: string,
  year: string,
  refresh: boolean = false
): Promise<FetchMonthResult> {
  const cacheFilename = getMonthCacheFilename(origin, destination, year, month);

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
        logMonthRequestDetail(`  ↻ Refreshing ${origin} → ${destination} ${year}-${month} (cache older than 1 hour)`);
      } else if (hasMissingSeatCounts(upgradedCached)) {
        logMonthRequestDetail(`  ↻ Refreshing ${origin} → ${destination} ${year}-${month} to capture seat counts`);
      } else {
        logMonthRequestDetail(`  ✓ Loaded ${origin} → ${destination} ${year}-${month} from cache`);
        return {
          monthData: upgradedCached,
          status: Object.keys(upgradedCached).length > 0 ? "success" : "empty",
          fromCache: true,
        };
      }
    }
  }

  logMonthRequestDetail(`  Fetching ${origin} → ${destination} ${year}-${month}...`);

  let result = await fetchMonthDataWithRequest(request, origin, destination, month, year);
  let usedFallback = false;
  if (result.status === "failed") {
    // First call can fail before session/cookies settle; retry direct once before browser fallback.
    await new Promise((resolve) => setTimeout(resolve, DIRECT_API_RETRY_DELAY_MS));
    result = await fetchMonthDataWithRequest(request, origin, destination, month, year);
  }

  if (result.status === "failed") {
    const directReason = result.failReason ? ` (${result.failReason})` : "";
    logMonthRequestDetail(
      `  ↻ Direct API request failed for ${origin} → ${destination} ${year}-${month}${directReason}; falling back to browser path`
    );
    const fallbackPage = await browser.newPage();
    usedFallback = true;
    try {
      result = await fetchMonthDataWithPageFallback(fallbackPage, origin, destination, month, year);
    } finally {
      await fallbackPage.close();
    }
  }

  if (result.status === "failed") {
    const reason = result.failReason ? ` (${result.failReason})` : "";
    logMonthRequestDetail(`    ✖ Failed to load data${reason}`);
    return { monthData: {}, status: "failed", failReason: result.failReason, usedFallback, fromCache: false };
  }

  const monthData = result.monthData;
  if (result.status === "empty") {
    logMonthRequestDetail(`    ○ Loaded data but found 0 dates with availability`);
  } else {
    logMonthRequestDetail(`    Found ${Object.keys(monthData).length} dates with availability`);
  }
  writeCache(cacheFilename, monthData);

  return { monthData, status: result.status, usedFallback, fromCache: false };
}
