import { Page } from "playwright";
import { Destination, YearMonth } from "../types";
import { cacheExists, getCachePath, readCache, writeCache } from "../utils/cache";
import { normalizeYearMonths } from "../utils/year-month";
import * as fs from "fs";

const DESTINATIONS_CACHE = "destinations.json";
const DESTINATION_POPULATION_TIMEOUT_MS = 1500;
const DESTINATION_POPULATION_POLL_MS = 100;
const DESTINATIONS_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
type AirportOption = { code: string; name: string; group?: string };

async function extractAvailableMonths(page: Page): Promise<YearMonth[]> {
  const dateMonths = await page.evaluate(() => {
    const dateSelect = document.querySelector("#date") as HTMLSelectElement | null;
    if (!dateSelect) return [];

    return Array.from(dateSelect.options)
      .map((option) => option.value.trim())
      .map((value) => {
        // Expected format: MM_YYYY (e.g. "02_2026")
        const match = /^(\d{1,2})_(\d{4})$/.exec(value);
        if (!match) return null;
        return { month: match[1], year: match[2] };
      })
      .filter((item): item is { month: string; year: string } => item !== null);
  });

  return normalizeYearMonths(dateMonths);
}

function cleanLocationName(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s*\([A-Z]{3}\)\s*$/, "").trim();
  return cleaned || undefined;
}

async function hasDestinationOptions(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const destSelect = document.querySelector("#destination") as HTMLSelectElement | null;
    if (!destSelect) return false;
    const realOptions = Array.from(destSelect.options).filter((option) => option.value.trim().length === 3);
    return realOptions.length > 0;
  });
}

async function waitForDestinationOptions(page: Page): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DESTINATION_POPULATION_TIMEOUT_MS) {
    if (await hasDestinationOptions(page)) return true;
    await page.waitForTimeout(DESTINATION_POPULATION_POLL_MS);
  }
  return hasDestinationOptions(page);
}

function loadDestinationsFromCache(forceRefresh: boolean): Destination[] | null {
  if (forceRefresh || !cacheExists(DESTINATIONS_CACHE)) return null;
  const cached = readCache<Destination[]>(DESTINATIONS_CACHE);
  if (!cached || cached.length === 0) return null;

  try {
    const cachePath = getCachePath(DESTINATIONS_CACHE);
    const cacheStat = fs.statSync(cachePath);
    const cacheAgeMs = Date.now() - cacheStat.mtime.getTime();
    if (cacheAgeMs <= DESTINATIONS_CACHE_MAX_AGE_MS) {
      console.log("✓ Loaded route options from cache (<= 3 days old)");
      return cached;
    }
    console.log("↻ Refreshing route options cache (older than 3 days)");
  } catch {
    // If stat fails, just proceed to a fresh scrape.
  }

  return null;
}

async function initRewardFinderPage(page: Page): Promise<void> {
  await page.goto("https://www.virginatlantic.com/reward-flight-finder", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Handle cookie consent if present.
  try {
    const cookieButton = page.locator("#onetrust-accept-btn-handler");
    if (await cookieButton.isVisible({ timeout: 5000 })) {
      await cookieButton.click();
      await page.waitForTimeout(1000);
    }
  } catch {
    // Cookie banner not present or already accepted.
  }

  // Wait for route selectors to be ready.
  await page.waitForSelector("#origin", { timeout: 10000 });
  await page.waitForSelector("#destination", { timeout: 10000 });
}

async function extractSelectOptions(page: Page, selector: string): Promise<AirportOption[]> {
  return page.evaluate((selectSelector) => {
    const select = document.querySelector(selectSelector) as HTMLSelectElement | null;
    if (!select) return [];

    const results: Array<{ code: string; name: string; group?: string }> = [];
    const optgroups = select.querySelectorAll("optgroup");
    if (optgroups.length > 0) {
      optgroups.forEach((optgroup) => {
        const groupLabel = (optgroup.label || "").trim() || undefined;
        Array.from(optgroup.querySelectorAll("option")).forEach((optionEl) => {
          const option = optionEl as HTMLOptionElement;
          const code = option.value.trim().toUpperCase();
          if (code.length !== 3) return;
          results.push({
            code,
            name: (option.textContent || code).trim(),
            group: groupLabel,
          });
        });
      });
    } else {
      Array.from(select.options).forEach((option) => {
        const code = option.value.trim().toUpperCase();
        if (code.length !== 3) return;
        results.push({
          code,
          name: (option.textContent || code).trim(),
        });
      });
    }

    return results;
  }, selector);
}

async function extractOrigins(page: Page): Promise<AirportOption[]> {
  const origins = await extractSelectOptions(page, "#origin");
  if (origins.length === 0) {
    throw new Error("No origins found in #origin select");
  }
  return origins;
}

async function extractDestinationsForOrigin(page: Page, originCode: string): Promise<AirportOption[]> {
  const destinationsAvailable = await waitForDestinationOptions(page);
  if (!destinationsAvailable) {
    console.warn(`  ⚠️  ${originCode}: no destinations found within ${DESTINATION_POPULATION_TIMEOUT_MS}ms`);
    return [];
  }
  await page.waitForTimeout(120);

  const destinations = await extractSelectOptions(page, "#destination");
  if (destinations.length === 0) {
    console.warn(`  ⚠️  ${originCode}: destination list was empty`);
  }
  return destinations;
}

function buildRoute(origin: AirportOption, destination: AirportOption): Destination {
  return {
    code: `${origin.code}-${destination.code}`,
    originCode: origin.code,
    originName: cleanLocationName(origin.name),
    originGroup: origin.group,
    destinationCode: destination.code,
    destinationName: cleanLocationName(destination.name),
    name: `${cleanLocationName(origin.name) || origin.code} -> ${cleanLocationName(destination.name) || destination.code}`,
    group: destination.group,
    availableMonths: [],
  };
}

async function populateAvailableMonthsForRoute(page: Page, route: Destination, destinationCode: string): Promise<void> {
  try {
    await page.selectOption("#destination", destinationCode);
    await page.waitForTimeout(150);
    route.availableMonths = await extractAvailableMonths(page);
    if (route.availableMonths.length === 0) {
      console.warn(`  ⚠️  ${route.code}: no month options found`);
    }
  } catch {
    console.warn(`  ⚠️  ${route.code}: failed to read month options`);
    route.availableMonths = [];
  }
}

async function scrapeRoutes(page: Page, origins: AirportOption[]): Promise<Destination[]> {
  const routes: Destination[] = [];
  const routeCodes = new Set<string>();

  for (const origin of origins) {
    try {
      await page.selectOption("#origin", origin.code);
    } catch {
      console.warn(`  ⚠️  ${origin.code}: could not select origin`);
      continue;
    }

    const destinationsForOrigin = await extractDestinationsForOrigin(page, origin.code);
    if (destinationsForOrigin.length === 0) continue;

    for (const destination of destinationsForOrigin) {
      const route = buildRoute(origin, destination);
      if (routeCodes.has(route.code)) continue;

      await populateAvailableMonthsForRoute(page, route, destination.code);
      routeCodes.add(route.code);
      routes.push(route);
    }
  }

  return routes;
}

export async function scrapeDestinations(
  page: Page,
  forceRefresh: boolean = false
): Promise<Destination[]> {
  const cached = loadDestinationsFromCache(forceRefresh);
  if (cached) return cached;

  console.log("Scraping routes from Virgin Atlantic...");

  try {
    await initRewardFinderPage(page);
    const origins = await extractOrigins(page);
    const routes = await scrapeRoutes(page, origins);

    if (routes.length === 0) {
      throw new Error("No valid routes found in origin/destination selectors");
    }

    console.log(`  Found ${routes.length} routes across ${origins.length} origins`);
    writeCache(DESTINATIONS_CACHE, routes);

    return routes;
  } catch (error) {
    console.error("Error scraping routes:", error);
    throw error;
  }
}
