import { Page } from "playwright";
import { Destination, YearMonth } from "../types";
import { writeCache } from "../utils/cache";

const DESTINATIONS_CACHE = "destinations.json";
const DESTINATION_POPULATION_TIMEOUT_MS = 1500;
const DESTINATION_POPULATION_POLL_MS = 100;

function normalizeYearMonths(months: YearMonth[]): YearMonth[] {
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

export async function scrapeDestinations(
  page: Page
): Promise<Destination[]> {
  console.log("Scraping routes from Virgin Atlantic...");

  try {
    await page.goto("https://www.virginatlantic.com/reward-flight-finder", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Handle cookie consent if present
    try {
      const cookieButton = page.locator("#onetrust-accept-btn-handler");
      if (await cookieButton.isVisible({ timeout: 5000 })) {
        await cookieButton.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // Cookie banner not present or already accepted
    }

    // Wait for route selectors to be ready.
    await page.waitForSelector("#origin", { timeout: 10000 });
    await page.waitForSelector("#destination", { timeout: 10000 });

    const origins: Array<{ code: string; name: string; group?: string }> = await page.evaluate(() => {
      const originSelect = document.querySelector("#origin") as HTMLSelectElement | null;
      if (!originSelect) return [];
      const origins: Array<{ code: string; name: string; group?: string }> = [];
      const optgroups = originSelect.querySelectorAll("optgroup");

      if (optgroups.length > 0) {
        optgroups.forEach((optgroup) => {
          const groupLabel = (optgroup.label || "").trim() || undefined;
          Array.from(optgroup.querySelectorAll("option")).forEach((optionEl) => {
            const option = optionEl as HTMLOptionElement;
            const code = option.value.trim().toUpperCase();
            if (code.length !== 3) return;
            origins.push({
              code,
              name: option.textContent?.trim() || code,
              group: groupLabel,
            });
          });
        });
      } else {
        Array.from(originSelect.options).forEach((option) => {
          const code = option.value.trim().toUpperCase();
          if (code.length !== 3) return;
          origins.push({
            code,
            name: option.textContent?.trim() || code,
          });
        });
      }

      return origins;
    });

    if (origins.length === 0) {
      throw new Error("No origins found in #origin select");
    }

    const routes: Destination[] = [];
    const routeCodes = new Set<string>();

    for (const origin of origins) {
      try {
        await page.selectOption("#origin", origin.code);
      } catch {
        console.warn(`  ⚠️  ${origin.code}: could not select origin`);
        continue;
      }

      const destinationsAvailable = await waitForDestinationOptions(page);
      if (!destinationsAvailable) {
        console.warn(`  ⚠️  ${origin.code}: no destinations found within ${DESTINATION_POPULATION_TIMEOUT_MS}ms`);
        continue;
      }
      await page.waitForTimeout(120);

      const destinationsForOrigin: Array<{ code: string; name: string; group?: string }> = await page.evaluate(() => {
        const destSelect = document.querySelector("#destination") as HTMLSelectElement | null;
        if (!destSelect) return [];

        const results: Array<{ code: string; name: string; group?: string }> = [];
        const optgroups = destSelect.querySelectorAll("optgroup");

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
          Array.from(destSelect.options).forEach((option) => {
            const code = option.value.trim().toUpperCase();
            if (code.length !== 3) return;
            results.push({
              code,
              name: (option.textContent || code).trim(),
            });
          });
        }

        return results;
      });

      if (destinationsForOrigin.length === 0) {
        console.warn(`  ⚠️  ${origin.code}: destination list was empty`);
        continue;
      }

      for (const destination of destinationsForOrigin) {
        const routeCode = `${origin.code}-${destination.code}`;
        if (routeCodes.has(routeCode)) continue;

        const routeName = `${cleanLocationName(origin.name) || origin.code} -> ${cleanLocationName(destination.name) || destination.code}`;
        const route: Destination = {
          code: routeCode,
          originCode: origin.code,
          originName: cleanLocationName(origin.name),
          originGroup: origin.group,
          destinationCode: destination.code,
          destinationName: cleanLocationName(destination.name),
          name: routeName,
          group: destination.group,
          availableMonths: [],
        };

        try {
          await page.selectOption("#destination", destination.code);
          await page.waitForTimeout(150);
          route.availableMonths = await extractAvailableMonths(page);
          if (route.availableMonths.length === 0) {
            console.warn(`  ⚠️  ${route.code}: no month options found`);
          }
        } catch {
          console.warn(`  ⚠️  ${route.code}: failed to read month options`);
          route.availableMonths = [];
        }

        routeCodes.add(routeCode);
        routes.push(route);
      }
    }

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
