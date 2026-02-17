#!/usr/bin/env node

import { chromium } from "playwright";
import { scrapeAllMonths } from "./scrape/month";
import { scrapeDestinations } from "./scrape/destinations";
import { buildReportShell, writeDestinationMetadata, writeReportData } from "./report/output";
import { ensureDirs, readCache, writeCache } from "./utils/cache";
import { getNext12Months } from "./utils/dates";
import { Destination, MonthData, YearMonth } from "./types";

type ScrapeManifest = {
  destinations: Destination[];
  months: YearMonth[];
  destinationMonths?: Record<string, YearMonth[]>;
  scrapedAt: string;
};

type DestinationDataByCode = Record<string, { outbound: MonthData[]; inbound: MonthData[] }>;

type CliOptions = {
  noCache: boolean;
  requestedDestinations: string[];
};

const SCRAPE_METADATA_CACHE = "scrape-metadata.json";
const FLIGHTS_DATASET_CACHE = "flights-dataset.json";
const OUTPUT_FLIGHTS_DATA_FILE = "flights-data.json";
const OUTPUT_DESTINATIONS_FILE = "destinations.json";
const OUTPUT_REPORT_FILE = "index.html";

function getPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

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

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function printUsage(): void {
  console.log(`Usage: virgin-atlantic-optimizer <command> [options]

Commands:
  scrape     Scrape reward flight data and save cache only
  process    Build UI data file from cache (scrapes implicitly if needed)
  build      Build report HTML/CSS/JS shell from cached metadata
  all        Run scrape, process, and build (default)

Options:
  --no-cache                For process/all: force fresh scrape before processing
  <DEST> [DEST...]          Restrict to destination codes (e.g. JFK LAX)
`);
}

function parseCliOptions(args: string[]): CliOptions {
  const noCache = args.includes("--no-cache");

  const requestedDestinations: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) continue;
    requestedDestinations.push(arg.toUpperCase());
  }

  return { noCache, requestedDestinations };
}

function loadScrapeMetadata(): ScrapeManifest | null {
  return readCache<ScrapeManifest>(SCRAPE_METADATA_CACHE);
}

function loadFlightsDatasetCache(): DestinationDataByCode | null {
  return readCache<DestinationDataByCode>(FLIGHTS_DATASET_CACHE);
}

function serializeDestinationData(
  destinationData: Map<string, { outbound: MonthData[]; inbound: MonthData[] }>
): DestinationDataByCode {
  const serialized: DestinationDataByCode = {};
  destinationData.forEach((value, code) => {
    serialized[code] = value;
  });
  return serialized;
}

function deserializeDestinationData(
  data: DestinationDataByCode
): Map<string, { outbound: MonthData[]; inbound: MonthData[] }> {
  return new Map(Object.entries(data));
}

function ensureScrapeTimestampsInDestinationData(
  destinationData: Map<string, { outbound: MonthData[]; inbound: MonthData[] }>,
  fallbackScrapedAt: string
): boolean {
  let mutated = false;

  destinationData.forEach((routeData) => {
    [routeData.outbound, routeData.inbound].forEach((months) => {
      months.forEach((monthData) => {
        Object.values(monthData).forEach((dayData) => {
          if (!dayData.scrapedAt) {
            dayData.scrapedAt = fallbackScrapedAt;
            mutated = true;
          }
        });
      });
    });
  });

  return mutated;
}

function filterDestinationData(
  destinationData: Map<string, { outbound: MonthData[]; inbound: MonthData[] }>,
  requestedDestinations: string[]
): Map<string, { outbound: MonthData[]; inbound: MonthData[] }> {
  if (requestedDestinations.length === 0) return destinationData;
  const requested = new Set(requestedDestinations);
  const filtered = new Map<string, { outbound: MonthData[]; inbound: MonthData[] }>();
  destinationData.forEach((value, code) => {
    if (requested.has(code)) filtered.set(code, value);
  });
  return filtered;
}

function filterDestinationsMetadata(
  destinations: Destination[],
  destinationData: Map<string, { outbound: MonthData[]; inbound: MonthData[] }>
): Destination[] {
  const available = new Set(destinationData.keys());
  return destinations.filter((destination) => available.has(destination.code));
}

function loadDestinationDataFromCache(manifest: ScrapeManifest): Map<string, { outbound: MonthData[]; inbound: MonthData[] }> {
  const cachedDestinationData = loadFlightsDatasetCache();
  if (!cachedDestinationData || Object.keys(cachedDestinationData).length === 0) {
    return new Map<string, { outbound: MonthData[]; inbound: MonthData[] }>();
  }

  const destinationData = deserializeDestinationData(cachedDestinationData);
  const migrated = ensureScrapeTimestampsInDestinationData(destinationData, manifest.scrapedAt);
  if (migrated) {
    writeCache(FLIGHTS_DATASET_CACHE, serializeDestinationData(destinationData));
  }
  return destinationData;
}

async function scrapeToCache(
  requestedDestinations: string[],
  forceFresh: boolean
): Promise<{ manifest: ScrapeManifest; destinationData: Map<string, { outbound: MonthData[]; inbound: MonthData[] }> }> {
  const scrapeStartedAt = Date.now();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const allDestinations = await scrapeDestinations(page);
    const targetDestinations = requestedDestinations.length > 0
      ? allDestinations.filter((d) => requestedDestinations.includes(d.code))
      : allDestinations;

    if (targetDestinations.length === 0) {
      console.error("❌ No valid destinations found");
      console.log("\nAvailable destinations:");
      allDestinations.forEach((d) => {
        console.log(`  ${d.code} - ${d.name}`);
      });
      process.exit(1);
    }

    console.log(`📍 Searching ${targetDestinations.length} destinations:`);
    targetDestinations.forEach((d) => {
      console.log(`  • ${d.code} - ${d.name}`);
    });

    const defaultMonths = getNext12Months();
    const destinationMonths: Record<string, YearMonth[]> = {};
    targetDestinations.forEach((destination) => {
      const selectedMonths = normalizeYearMonths(destination.availableMonths || []);
      destinationMonths[destination.code] = selectedMonths.length > 0 ? selectedMonths : defaultMonths;
    });

    const allMonths = normalizeYearMonths(Object.values(destinationMonths).flat());
    console.log(
      `\n🗓️  Fetching availability for destination-specific month ranges (${allMonths.length} total unique months)...\n`
    );

    const destinationData = new Map<string, { outbound: MonthData[]; inbound: MonthData[] }>();
    const DEST_BATCH_SIZE = getPositiveIntEnv("VA_DESTINATION_CONCURRENCY", 1);

    for (let i = 0; i < targetDestinations.length; i += DEST_BATCH_SIZE) {
      const batch = targetDestinations.slice(i, i + DEST_BATCH_SIZE);

      await Promise.all(batch.map(async (destination) => {
        const monthsToScrape = destinationMonths[destination.code] || defaultMonths;
        const { outbound, inbound } = await scrapeAllMonths(
          page,
          destination.code,
          monthsToScrape,
          forceFresh
        );

        const hasData = outbound.some((m) => Object.keys(m).length > 0) ||
                        inbound.some((m) => Object.keys(m).length > 0);
        if (hasData) {
          destinationData.set(destination.code, { outbound, inbound });
          console.log(`  ✅ ${destination.code}: data collected`);
        } else {
          console.log(`  ⚠️  ${destination.code}: No availability data found`);
        }
      }));
    }

    if (destinationData.size === 0) {
      console.log("\n❌ No data found for any destination\n");
      process.exit(1);
    }

    const scrapedAt = new Date().toISOString();
    const successfulDestinationCodes = new Set(destinationData.keys());
    const successfulDestinations = targetDestinations.filter((dest) =>
      successfulDestinationCodes.has(dest.code)
    );
    const successfulDestinationMonths: Record<string, YearMonth[]> = {};
    successfulDestinations.forEach((destination) => {
      successfulDestinationMonths[destination.code] = destinationMonths[destination.code] || defaultMonths;
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
  await scrapeToCache(options.requestedDestinations, options.noCache);
  console.log("✅ Scrape complete. Cache populated.\n");
}

async function processCommand(args: string[]): Promise<void> {
  ensureDirs();
  const options = parseCliOptions(args);

  let manifest = loadScrapeMetadata();
  let destinationData = manifest ? loadDestinationDataFromCache(manifest) : new Map<string, { outbound: MonthData[]; inbound: MonthData[] }>();

  const missingCache = !manifest || destinationData.size === 0;
  const missingRequested = options.requestedDestinations.some((code) => !destinationData.has(code));
  if (options.noCache || missingCache || missingRequested) {
    console.log("📦 Cache missing/incomplete (or --no-cache set). Running scrape first...");
    const scraped = await scrapeToCache(options.requestedDestinations, options.noCache);
    manifest = scraped.manifest;
    destinationData = scraped.destinationData;
  } else if (manifest) {
    console.log(`📦 Processing from cache (scraped ${manifest.scrapedAt})`);
  }

  const filteredDestinationData = filterDestinationData(destinationData, options.requestedDestinations);
  if (filteredDestinationData.size === 0) {
    console.error("❌ No data available for requested destinations.");
    process.exit(1);
  }

  writeReportData(filteredDestinationData, OUTPUT_FLIGHTS_DATA_FILE);
  if (manifest) {
    const filteredDestinations = filterDestinationsMetadata(manifest.destinations, filteredDestinationData);
    writeDestinationMetadata(filteredDestinations, OUTPUT_DESTINATIONS_FILE);
  }
  console.log(`🧱 Processed data file written for ${filteredDestinationData.size} destinations: output/${OUTPUT_FLIGHTS_DATA_FILE}\n`);
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

  const scraped = await scrapeToCache(options.requestedDestinations, options.noCache);
  const filteredDestinationData = filterDestinationData(scraped.destinationData, options.requestedDestinations);
  writeReportData(filteredDestinationData, OUTPUT_FLIGHTS_DATA_FILE);
  const filteredDestinations = filterDestinationsMetadata(scraped.manifest.destinations, filteredDestinationData);
  writeDestinationMetadata(filteredDestinations, OUTPUT_DESTINATIONS_FILE);
  buildReportShell(OUTPUT_REPORT_FILE);

  console.log(`\nReport generated: output/${OUTPUT_REPORT_FILE}`);
  console.log("✅ Done! Open output/" + OUTPUT_REPORT_FILE + " in your browser.\n");
}

async function main(): Promise<void> {
  console.log("🛫 Virgin Atlantic Reward Return Optimizer\n");

  const args = process.argv.slice(2);
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
      // Default command keeps one-shot behavior.
      await allCommand(args);
      break;
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
