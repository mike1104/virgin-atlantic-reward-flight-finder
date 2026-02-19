#!/usr/bin/env node

import * as fs from "fs";
import { chromium } from "playwright";
import { writeReportData, writeDestinationMetadata, writeScrapeMetadata, buildReportShell } from "./app/output";
import {
  loadDestinationDataFromCache,
  loadScrapeMetadata,
  serializeDestinationData,
} from "./cli/cache-data";
import { filterDestinationData, filterDestinationsMetadata, filterRoutes, getRouteEndpoints, isRouteCode } from "./cli/filters";
import { parseCliOptions, printUsage } from "./cli/options";
import { formatDuration, ScrapeProgressBar } from "./cli/progress";
import { scrapeDestinations } from "./scraper/destinations";
import { scrapeMonth } from "./scraper/month";
import { Destination, MonthData, RouteMonthData, ScrapeManifest, YearMonth } from "./shared/types";
import {
  cacheExists,
  CACHE_AGGREGATES_PREFIX,
  ensureDirs,
  getCachePath,
  readCache,
  writeCache,
} from "./shared/utils/cache";
import { getNext12Months } from "./shared/utils/dates";
import { getNonNegativeIntEnv, getPositiveIntEnv } from "./shared/utils/env";
import { getMonthCacheFilename, hasMissingSeatCounts } from "./shared/utils/month-data";
import { isMonthData } from "./shared/utils/validation";
import { normalizeYearMonths } from "./shared/utils/year-month";

const SCRAPE_METADATA_CACHE = `${CACHE_AGGREGATES_PREFIX}scrape-metadata.json`;
const FLIGHTS_DATASET_CACHE = `${CACHE_AGGREGATES_PREFIX}flights-dataset.json`;
const OUTPUT_FLIGHTS_DATA_FILE = "flights-data.json";
const OUTPUT_DESTINATIONS_FILE = "destinations.json";
const OUTPUT_SCRAPE_METADATA_FILE = "scrape-metadata.json";
const OUTPUT_REPORT_FILE = "index.html";

function willUseMonthCache(
  refresh: boolean,
  origin: string,
  destination: string,
  year: string,
  month: string
): boolean {
  if (refresh) return false;
  const cacheFilename = getMonthCacheFilename(origin, destination, year, month);
  if (!cacheExists(cacheFilename)) return false;

  const cached = readCache<MonthData>(cacheFilename, {
    validator: isMonthData,
    description: `month cache ${cacheFilename}`,
  });
  if (!cached) return false;
  if (hasMissingSeatCounts(cached)) return false;

  const cachePath = getCachePath(cacheFilename);
  const cacheStat = fs.statSync(cachePath);
  const cacheAgeMs = Date.now() - cacheStat.mtime.getTime();
  const cacheMaxAgeMs = 60 * 60 * 1000;
  return cacheAgeMs <= cacheMaxAgeMs;
}

async function scrapeToCache(
  requestedRoutes: string[],
  forceFresh: boolean
): Promise<{ manifest: ScrapeManifest; destinationData: Map<string, RouteMonthData> }> {
  const scrapeStartedAt = Date.now();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const allRoutes = await scrapeDestinations(page, forceFresh);
    const targetRoutes = filterRoutes(allRoutes, requestedRoutes);

    if (targetRoutes.length === 0) {
      const available = allRoutes.map((route) => `${route.code} - ${route.name}`).join("\n  ");
      throw new Error(`No valid routes found.\nAvailable routes:\n  ${available}`);
    }

    console.log(`📍 Searching ${targetRoutes.length} routes:`);
    targetRoutes.forEach((route) => {
      console.log(`  • ${route.code} - ${route.name}`);
    });

    const defaultMonths = getNext12Months();
    const destinationMonths: Record<string, YearMonth[]> = {};
    targetRoutes.forEach((route) => {
      const selectedMonths = normalizeYearMonths(route.availableMonths || []);
      destinationMonths[route.code] = selectedMonths.length > 0 ? selectedMonths : defaultMonths;
    });

    const allMonths = normalizeYearMonths(Object.values(destinationMonths).flat());
    console.log(
      `\n🗓️  Fetching availability for route-specific month ranges (${allMonths.length} total unique months)...\n`
    );

    type RouteScrapeState = {
      route: Destination;
      outbound: MonthData[];
      inbound: MonthData[];
      pendingRequests: number;
      completed: boolean;
    };

    type MonthQueueItem = {
      requestOrigin: string;
      requestDestination: string;
      month: string;
      year: string;
      likelyCacheHit: boolean;
      dependents: Array<{
        routeCode: string;
        type: "outbound" | "inbound";
        monthIndex: number;
      }>;
    };

    const destinationData = new Map<string, RouteMonthData>();
    const routeStates = new Map<string, RouteScrapeState>();
    const requestQueueByKey = new Map<string, MonthQueueItem>();

    for (const route of targetRoutes) {
      const endpoints = getRouteEndpoints(route);
      if (!endpoints.originCode || !endpoints.destinationCode) {
        console.log(`  ⚠️  ${route.code}: Invalid route definition`);
        continue;
      }

      const monthsToScrape = destinationMonths[route.code] || defaultMonths;
      const routeState: RouteScrapeState = {
        route,
        outbound: new Array(monthsToScrape.length),
        inbound: new Array(monthsToScrape.length),
        pendingRequests: monthsToScrape.length * 2,
        completed: false,
      };
      routeStates.set(route.code, routeState);

      const addRequest = (
        type: "outbound" | "inbound",
        monthIndex: number,
        month: string,
        year: string,
        requestOrigin: string,
        requestDestination: string
      ): void => {
        const requestKey = `${requestOrigin}-${requestDestination}-${year}-${month}`;
        const likelyCacheHit = willUseMonthCache(
          forceFresh,
          requestOrigin,
          requestDestination,
          year,
          month
        );
        const existing = requestQueueByKey.get(requestKey);
        if (existing) {
          existing.dependents.push({ routeCode: route.code, type, monthIndex });
          existing.likelyCacheHit = existing.likelyCacheHit && likelyCacheHit;
          return;
        }

        requestQueueByKey.set(requestKey, {
          requestOrigin,
          requestDestination,
          month,
          year,
          likelyCacheHit,
          dependents: [{ routeCode: route.code, type, monthIndex }],
        });
      };

      monthsToScrape.forEach((m, monthIndex) => {
        addRequest(
          "outbound",
          monthIndex,
          m.month,
          m.year,
          endpoints.originCode!,
          endpoints.destinationCode!
        );
        addRequest(
          "inbound",
          monthIndex,
          m.month,
          m.year,
          endpoints.destinationCode!,
          endpoints.originCode!
        );
      });
    }

    const requestQueue: MonthQueueItem[] = Array.from(requestQueueByKey.values());
    const scrapeProgressBar = new ScrapeProgressBar(requestQueue.length);
    const requestMaxInFlight = getPositiveIntEnv("VA_REQUEST_MAX_IN_FLIGHT", 8);
    const dispatchIntervalMs = getPositiveIntEnv("VA_REQUEST_DISPATCH_INTERVAL_MS", 100);
    const dispatchIntervalJitterMs = getNonNegativeIntEnv("VA_REQUEST_DISPATCH_INTERVAL_JITTER_MS", 10);
    const requestFailureRetryLimit = getNonNegativeIntEnv("VA_REQUEST_FAILURE_RETRY_LIMIT", 1);
    const abortConsecutiveFailures = getPositiveIntEnv("VA_REQUEST_ABORT_CONSECUTIVE_FAILURES", 16);
    scrapeProgressBar.log(
      `  ⚙️  Request tuning: max in-flight ${requestMaxInFlight}, interval ${dispatchIntervalMs}ms (+0-${dispatchIntervalJitterMs}ms jitter), failure retries ${requestFailureRetryLimit}`
    );

    if (requestQueue.length === 0) {
      throw new Error("No valid routes with month requests to scrape");
    }

    const request = page.context().request;
    let completedRequests = 0;
    let successfulRequests = 0;
    let emptyRequests = 0;
    let failedRequests = 0;
    let fallbackRequests = 0;
    let cachedRequests = 0;
    let consecutiveFailedRequests = 0;
    let nextQueueIndex = 0;
    let nextDispatchAt = 0;
    const activeTasks = new Set<Promise<void>>();
    let abortError: Error | null = null;
    let rewarmLock: Promise<void> = Promise.resolve();

    const sleep = async (ms: number): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    };

    const rewarmScrapeSession = async (): Promise<boolean> => {
      try {
        scrapeProgressBar.log("  ↻ Rewarming reward session...");
        await page.goto("https://www.virginatlantic.com/reward-flight-finder", {
          waitUntil: "domcontentloaded",
          timeout: 25000,
        });

        try {
          const cookieButton = page.locator("#onetrust-accept-btn-handler");
          if (await cookieButton.isVisible({ timeout: 3000 })) {
            await cookieButton.click();
          }
        } catch {
          // Cookie banner is optional.
        }

        await page.waitForTimeout(250);
        return true;
      } catch {
        scrapeProgressBar.log("  ⚠️  Session rewarm failed");
        return false;
      }
    };

    const withRewarmLock = async (): Promise<boolean> => {
      let rewarmed = false;
      const run = async () => {
        rewarmed = await rewarmScrapeSession();
      };
      rewarmLock = rewarmLock.then(run, run);
      await rewarmLock;
      return rewarmed;
    };

    const waitForDispatchWindow = async (): Promise<void> => {
      const now = Date.now();
      if (nextDispatchAt > now) {
        await sleep(nextDispatchAt - now);
      }
      const jitterMs = dispatchIntervalJitterMs > 0
        ? Math.floor(Math.random() * (dispatchIntervalJitterMs + 1))
        : 0;
      nextDispatchAt = Date.now() + dispatchIntervalMs + jitterMs;
    };

    const runQueueItem = async (item: MonthQueueItem) => {
      let result = await scrapeMonth(
        request,
        browser,
        item.requestOrigin,
        item.requestDestination,
        item.month,
        item.year,
        forceFresh
      );

      if (result.status === "failed") {
        for (let retry = 0; retry < requestFailureRetryLimit; retry++) {
          const rewarmed = await withRewarmLock();
          if (!rewarmed) break;
          scrapeProgressBar.log(
            `  ↻ Retrying ${item.requestOrigin} → ${item.requestDestination} ${item.year}-${item.month} after session rewarm...`
          );
          result = await scrapeMonth(
            request,
            browser,
            item.requestOrigin,
            item.requestDestination,
            item.month,
            item.year,
            forceFresh
          );
          if (result.status !== "failed") break;
        }
      }

      return result;
    };

    const launchQueueItem = (item: MonthQueueItem): void => {
      const task = (async () => {
        let result: Awaited<ReturnType<typeof scrapeMonth>>;
        try {
          result = await runQueueItem(item);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          scrapeProgressBar.log(
            `  ✖ Unhandled error for ${item.requestOrigin} → ${item.requestDestination} ${item.year}-${item.month} (${reason})`
          );
          result = { monthData: {}, status: "failed", failReason: reason };
        }

        completedRequests += 1;
        if (result.usedFallback) fallbackRequests += 1;
        if (result.fromCache) cachedRequests += 1;

        if (result.status === "failed") {
          failedRequests += 1;
          consecutiveFailedRequests += 1;
          if (consecutiveFailedRequests >= abortConsecutiveFailures && !abortError) {
            abortError = new Error(
              `Aborting scrape: ${consecutiveFailedRequests} consecutive failed requests`
            );
          }
        } else {
          successfulRequests += 1;
          consecutiveFailedRequests = 0;
          if (result.status === "empty") {
            emptyRequests += 1;
          }
        }

        scrapeProgressBar.update({
          completed: completedRequests,
          successful: successfulRequests,
          empty: emptyRequests,
          failed: failedRequests,
          fallbackUsed: fallbackRequests,
          cached: cachedRequests,
        });

        for (const dependent of item.dependents) {
          const routeState = routeStates.get(dependent.routeCode);
          if (!routeState) continue;

          if (dependent.type === "outbound") {
            routeState.outbound[dependent.monthIndex] = result.monthData;
          } else {
            routeState.inbound[dependent.monthIndex] = result.monthData;
          }

          routeState.pendingRequests -= 1;
          if (!routeState.completed && routeState.pendingRequests === 0) {
            routeState.completed = true;
            const hasData = routeState.outbound.some((m) => Object.keys(m || {}).length > 0) ||
              routeState.inbound.some((m) => Object.keys(m || {}).length > 0);
            if (hasData) {
              destinationData.set(routeState.route.code, {
                outbound: routeState.outbound,
                inbound: routeState.inbound,
              });
              scrapeProgressBar.log(`  ✅ ${routeState.route.code}: data collected`);
            } else {
              scrapeProgressBar.log(`  ⚠️  ${routeState.route.code}: No availability data found`);
            }
          }
        }
      })().finally(() => {
        activeTasks.delete(task);
      });

      activeTasks.add(task);
    };

    try {
      while ((nextQueueIndex < requestQueue.length || activeTasks.size > 0) && !abortError) {
        while (
          nextQueueIndex < requestQueue.length &&
          activeTasks.size < requestMaxInFlight &&
          !abortError
        ) {
          const item = requestQueue[nextQueueIndex];
          if (!item.likelyCacheHit) {
            await waitForDispatchWindow();
          }
          nextQueueIndex += 1;
          launchQueueItem(item);
        }

        if (activeTasks.size > 0) {
          await Promise.race(activeTasks);
        }
      }

      if (activeTasks.size > 0) {
        await Promise.all(activeTasks);
      }

      if (abortError) {
        throw abortError;
      }
    } finally {
      scrapeProgressBar.finish();
    }

    if (destinationData.size === 0) {
      throw new Error("No data found for any route");
    }

    const scrapedAt = new Date().toISOString();
    const successfulDestinationCodes = new Set(destinationData.keys());
    const successfulDestinations = targetRoutes.filter((route) =>
      successfulDestinationCodes.has(route.code)
    );
    const successfulDestinationMonths: Record<string, YearMonth[]> = {};
    successfulDestinations.forEach((route) => {
      successfulDestinationMonths[route.code] = destinationMonths[route.code] || defaultMonths;
    });

    const manifest: ScrapeManifest = {
      destinations: successfulDestinations,
      months: normalizeYearMonths(Object.values(successfulDestinationMonths).flat()),
      destinationMonths: successfulDestinationMonths,
      scrapedAt,
    };

    writeCache(SCRAPE_METADATA_CACHE, manifest);
    writeCache(FLIGHTS_DATASET_CACHE, serializeDestinationData(destinationData));

    const elapsedMs = Date.now() - scrapeStartedAt;
    console.log(`\n⏱️ Total scrape time: ${formatDuration(elapsedMs)} (${elapsedMs}ms)`);
    return { manifest, destinationData };
  } finally {
    await browser.close();
  }
}

async function scrapeCommand(args: string[]): Promise<void> {
  ensureDirs();
  const options = parseCliOptions(args);
  await scrapeToCache(options.requestedRoutes, options.noCache);
  console.log("✅ Scrape complete. Cache populated.\n");
}

async function processCommand(args: string[]): Promise<void> {
  ensureDirs();
  const options = parseCliOptions(args);

  let manifest = loadScrapeMetadata(SCRAPE_METADATA_CACHE);
  let destinationData = manifest
    ? loadDestinationDataFromCache(FLIGHTS_DATASET_CACHE)
    : new Map<string, RouteMonthData>();

  const legacyManifestFormat = !!manifest && manifest.destinations.some((route) => !isRouteCode(route.code));
  const requestedFromManifest = manifest ? filterRoutes(manifest.destinations, options.requestedRoutes) : [];
  const missingCache = !manifest || destinationData.size === 0 || legacyManifestFormat;
  const missingRequested =
    options.requestedRoutes.length > 0 &&
    (requestedFromManifest.length === 0 || requestedFromManifest.some((route) => !destinationData.has(route.code)));

  if (options.noCache || missingCache || missingRequested) {
    console.log("📦 Cache missing/incomplete (or --no-cache set). Running scrape first...");
    const scraped = await scrapeToCache(options.requestedRoutes, options.noCache);
    manifest = scraped.manifest;
    destinationData = scraped.destinationData;
  } else if (manifest) {
    console.log(`📦 Processing from cache (scraped ${manifest.scrapedAt})`);
  }

  if (!manifest) {
    throw new Error("No scrape metadata available.");
  }

  const scopedRoutes = filterRoutes(manifest.destinations, options.requestedRoutes);
  const routesToProcess = options.requestedRoutes.length > 0 ? scopedRoutes : manifest.destinations;
  const filteredDestinationData = filterDestinationData(destinationData, routesToProcess);

  if (filteredDestinationData.size === 0) {
    throw new Error("No data available for requested routes.");
  }

  writeReportData(filteredDestinationData, OUTPUT_FLIGHTS_DATA_FILE);
  const filteredDestinations = filterDestinationsMetadata(routesToProcess, filteredDestinationData);
  writeDestinationMetadata(filteredDestinations, OUTPUT_DESTINATIONS_FILE);
  writeScrapeMetadata(manifest.scrapedAt, OUTPUT_SCRAPE_METADATA_FILE);
  console.log(`🧱 Processed data file written for ${filteredDestinationData.size} routes: output/${OUTPUT_FLIGHTS_DATA_FILE}\n`);
}

function buildCommand(): void {
  ensureDirs();
  buildReportShell(OUTPUT_REPORT_FILE);
  console.log(`\nReport shell generated: output/${OUTPUT_REPORT_FILE}`);
  console.log("✅ Build complete.\n");
}

async function allCommand(args: string[]): Promise<void> {
  ensureDirs();
  const options = parseCliOptions(args);

  const scraped = await scrapeToCache(options.requestedRoutes, options.noCache);
  const filteredRoutes = filterRoutes(scraped.manifest.destinations, options.requestedRoutes);
  const routesToProcess = options.requestedRoutes.length > 0 ? filteredRoutes : scraped.manifest.destinations;

  const filteredDestinationData = filterDestinationData(scraped.destinationData, routesToProcess);
  writeReportData(filteredDestinationData, OUTPUT_FLIGHTS_DATA_FILE);

  const filteredDestinations = filterDestinationsMetadata(routesToProcess, filteredDestinationData);
  writeDestinationMetadata(filteredDestinations, OUTPUT_DESTINATIONS_FILE);
  writeScrapeMetadata(scraped.manifest.scrapedAt, OUTPUT_SCRAPE_METADATA_FILE);
  buildReportShell(OUTPUT_REPORT_FILE);

  console.log(`\nReport generated: output/${OUTPUT_REPORT_FILE}`);
  console.log("✅ Done! Open output/" + OUTPUT_REPORT_FILE + " in your browser.\n");
}

async function main(): Promise<void> {
  console.log("🛫 Virgin Atlantic Reward Return Optimizer\n");

  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }
  const first = args[0] && !args[0].startsWith("-") ? args[0] : null;
  const knownCommands = new Set(["scrape", "process", "build", "all", "help"]);
  const command = first && knownCommands.has(first) ? first : null;
  const commandArgs = command ? args.slice(1) : args;

  switch (command) {
    case "scrape":
      await scrapeCommand(commandArgs);
      break;
    case "process":
      await processCommand(commandArgs);
      break;
    case "build":
      buildCommand();
      break;
    case "all":
      await allCommand(commandArgs);
      break;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;
    default:
      await allCommand(args);
      break;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Fatal error:", message);
  process.exit(1);
});
