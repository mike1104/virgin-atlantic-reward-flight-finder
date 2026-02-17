import { Page } from "playwright";
import { Destination, YearMonth } from "../types";
import { writeCache } from "../utils/cache";

const DESTINATIONS_CACHE = "destinations.json";

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
  const hasMonthYearSelects = await page.evaluate(() => {
    const month = document.querySelector("#month");
    const year = document.querySelector("#year");
    return !!month && !!year;
  });

  if (!hasMonthYearSelects) {
    return [];
  }

  const yearValues: string[] = await page.evaluate(() => {
    const yearSelect = document.querySelector("#year") as HTMLSelectElement | null;
    if (!yearSelect) return [];
    return Array.from(yearSelect.options)
      .map((opt) => opt.value.trim())
      .filter((value) => /^\d{4}$/.test(value));
  });

  const months: YearMonth[] = [];

  for (const yearValue of yearValues) {
    await page.selectOption("#year", yearValue);
    await page.waitForTimeout(120);

    const monthsForYear: string[] = await page.evaluate(() => {
      const monthSelect = document.querySelector("#month") as HTMLSelectElement | null;
      if (!monthSelect) return [];
      return Array.from(monthSelect.options)
        .map((opt) => opt.value.trim())
        .filter((value) => /^\d{1,2}$/.test(value));
    });

    monthsForYear.forEach((month) => {
      months.push({ month, year: yearValue });
    });
  }

  return normalizeYearMonths(months);
}

export async function scrapeDestinations(
  page: Page
): Promise<Destination[]> {
  console.log("Scraping destinations from Virgin Atlantic...");

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

    // Wait for origin select to be ready
    await page.waitForSelector("#origin", { timeout: 10000 });

    // Select LHR as origin - this populates the destination dropdown
    await page.selectOption("#origin", "LHR");
    console.log("  Selected LHR as origin");

    // Wait for destination dropdown to populate
    await page.waitForFunction(() => {
      const destSelect = document.querySelector("#destination") as HTMLSelectElement;
      return destSelect && destSelect.options.length > 1;
    }, { timeout: 10000 });

    // Extract destinations from the #destination select
    const destinations: Destination[] = await page.evaluate(() => {
      const results: { code: string; name: string | undefined; group: string | undefined }[] = [];
      const destSelect = document.querySelector("#destination") as HTMLSelectElement;
      if (!destSelect) return results;

      // Check for optgroups
      const optgroups = destSelect.querySelectorAll("optgroup");
      if (optgroups.length > 0) {
        optgroups.forEach((og) => {
          const groupLabel = og.label;
          Array.from(og.children).forEach((opt) => {
            const option = opt as HTMLOptionElement;
            if (option.value && option.value.length === 3) {
              results.push({
                code: option.value.toUpperCase(),
                name: option.textContent?.trim(),
                group: groupLabel || undefined,
              });
            }
          });
        });
      } else {
        // Flat list
        Array.from(destSelect.options).forEach((option) => {
          if (option.value && option.value.length === 3) {
            results.push({
              code: option.value.toUpperCase(),
              name: option.textContent?.trim(),
              group: undefined,
            });
          }
        });
      }

      return results;
    });

    if (destinations.length === 0) {
      throw new Error("No destinations found in #destination select");
    }

    // Clean up names - remove the airport code suffix e.g. "Atlanta (ATL)" -> "Atlanta"
    destinations.forEach((d) => {
      if (d.name) {
        d.name = d.name.replace(/\s*\([A-Z]{3}\)\s*$/, "").trim();
      }
    });

    // Capture available month/year options for each destination
    for (const destination of destinations) {
      try {
        await page.selectOption("#destination", destination.code);
        await page.waitForTimeout(150);
        destination.availableMonths = await extractAvailableMonths(page);
        if (destination.availableMonths.length === 0) {
          console.warn(`  ⚠️  ${destination.code}: no month options found`);
        }
      } catch (err) {
        console.warn(`  ⚠️  ${destination.code}: failed to read month options`);
        destination.availableMonths = [];
      }
    }

    console.log(`  Found ${destinations.length} destinations`);
    writeCache(DESTINATIONS_CACHE, destinations);

    return destinations;
  } catch (error) {
    console.error("Error scraping destinations:", error);
    throw error;
  }
}
