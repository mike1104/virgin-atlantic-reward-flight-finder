import * as fs from "fs";
import * as path from "path";

const CACHE_DIR = path.join(process.cwd(), "cache");
const OUTPUT_DIR = path.join(process.cwd(), "output");
const CACHE_RAW_MONTHS_DIR = "raw-months";
const CACHE_AGGREGATES_DIR = "aggregates";
const CACHE_SCHEMA_VERSION = 1;

export const CACHE_RAW_MONTHS_PREFIX = `${CACHE_RAW_MONTHS_DIR}/`;
export const CACHE_AGGREGATES_PREFIX = `${CACHE_AGGREGATES_DIR}/`;

type CacheEnvelope<T> = {
  schemaVersion: number;
  writtenAt: string;
  data: T;
};

type CacheReadOptions<T> = {
  expectedVersion?: number;
  validator?: (value: unknown) => value is T;
  description?: string;
};

function normalizeCacheFilename(filename: string): string {
  const normalized = path.posix.normalize(String(filename).replace(/\\/g, "/")).replace(/^\/+/, "");
  if (!normalized || normalized === ".") {
    throw new Error(`Invalid cache filename: "${filename}"`);
  }
  if (normalized.startsWith("..") || normalized.includes("/../")) {
    throw new Error(`Invalid cache filename traversal: "${filename}"`);
  }
  return normalized;
}

function resolvePrimaryCachePath(normalizedFilename: string): string {
  const resolved = path.resolve(CACHE_DIR, normalizedFilename);
  if (resolved !== CACHE_DIR && !resolved.startsWith(CACHE_DIR + path.sep)) {
    throw new Error(`Resolved cache path escaped cache directory: "${normalizedFilename}"`);
  }
  return resolved;
}

export function ensureDirs(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(path.join(CACHE_DIR, CACHE_RAW_MONTHS_DIR), { recursive: true });
  fs.mkdirSync(path.join(CACHE_DIR, CACHE_AGGREGATES_DIR), { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

export function getCachePath(filename: string): string {
  const normalizedFilename = normalizeCacheFilename(filename);
  return resolvePrimaryCachePath(normalizedFilename);
}

function getOutputPath(filename: string): string {
  return path.join(OUTPUT_DIR, filename);
}

export function cacheExists(filename: string): boolean {
  try {
    return fs.existsSync(getCachePath(filename));
  } catch {
    return false;
  }
}

function isCacheEnvelope(value: unknown): value is CacheEnvelope<unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.schemaVersion === "number" &&
    typeof candidate.writtenAt === "string" &&
    Object.prototype.hasOwnProperty.call(candidate, "data")
  );
}

export function readCache<T>(filename: string, options?: CacheReadOptions<T>): T | null {
  const filePath = getCachePath(filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const expectedVersion = options?.expectedVersion ?? CACHE_SCHEMA_VERSION;
  const description = options?.description || filename;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    let value: unknown = null;

    if (isCacheEnvelope(raw)) {
      if (raw.schemaVersion !== expectedVersion) {
        console.error(
          `Cache version mismatch for ${description}: expected v${expectedVersion}, got v${raw.schemaVersion}`
        );
        return null;
      }
      value = raw.data;
    } else {
      console.error(`Invalid cache payload for ${description}: missing schema envelope`);
      return null;
    }

    if (options?.validator && !options.validator(value)) {
      console.error(`Invalid cache shape for ${description}`);
      return null;
    }

    return value as T;
  } catch (error) {
    console.error(`Error reading cache ${filename}:`, error);
    return null;
  }
}

export function writeCache<T>(filename: string, data: T): void {
  const filePath = getCachePath(filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: CacheEnvelope<T> = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    writtenAt: new Date().toISOString(),
    data,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

export function writeOutput(filename: string, content: string): void {
  const filePath = getOutputPath(filename);
  fs.writeFileSync(filePath, content, "utf-8");
}
