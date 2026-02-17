import * as fs from "fs";
import * as path from "path";

const CACHE_DIR = path.join(process.cwd(), "cache");
const OUTPUT_DIR = path.join(process.cwd(), "output");

export function ensureDirs(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

export function getCachePath(filename: string): string {
  return path.join(CACHE_DIR, filename);
}

export function getOutputPath(filename: string): string {
  return path.join(OUTPUT_DIR, filename);
}

export function cacheExists(filename: string): boolean {
  return fs.existsSync(getCachePath(filename));
}

export function readCache<T>(filename: string): T | null {
  const filePath = getCachePath(filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (error) {
    console.error(`Error reading cache ${filename}:`, error);
    return null;
  }
}

export function writeCache<T>(filename: string, data: T): void {
  const filePath = getCachePath(filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function writeOutput(filename: string, content: string): void {
  const filePath = getOutputPath(filename);
  fs.writeFileSync(filePath, content, "utf-8");
}
