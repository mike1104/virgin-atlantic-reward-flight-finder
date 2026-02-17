import * as fs from "fs";
import * as path from "path";
import { Destination, MonthData } from "../types";
import { writeOutput } from "../utils/cache";

function loadReportTemplate(): string {
  const candidates = [
    path.resolve(__dirname, "templates/report.html"),
    path.resolve(__dirname, "../../src/report/templates/report.html"),
  ];

  for (const templatePath of candidates) {
    if (fs.existsSync(templatePath)) {
      return fs.readFileSync(templatePath, "utf-8");
    }
  }

  throw new Error("Could not find report template file (report.html)");
}

function mergeMonthData(monthDataArray: MonthData[]): MonthData {
  const merged: MonthData = {};
  for (const monthData of monthDataArray) {
    for (const [date, pricing] of Object.entries(monthData)) {
      merged[date] = pricing;
    }
  }
  return merged;
}

function copyStaticAssets(): void {
  const staticFiles = ["style.css", "app.js"];

  // At runtime __dirname is dist/report/. Source assets live in src/report/.
  const candidates = [
    path.resolve(__dirname, "../../src/report"),
    __dirname,
  ];

  for (const file of staticFiles) {
    let copied = false;
    for (const dir of candidates) {
      const src = path.join(dir, file);
      if (fs.existsSync(src)) {
        writeOutput(file, fs.readFileSync(src, "utf-8"));
        copied = true;
        break;
      }
    }
    if (!copied) {
      console.warn(`Warning: could not find ${file} to copy to output`);
    }
  }
}

type DestinationDataMap = Map<string, { outbound: MonthData[]; inbound: MonthData[] }>;
type DestinationMeta = Pick<Destination, "code" | "name" | "group">;

function buildRawData(destinationData: DestinationDataMap): Record<string, { outbound: MonthData; inbound: MonthData }> {
  const rawData: Record<string, { outbound: MonthData; inbound: MonthData }> = {};
  for (const [dest, data] of destinationData) {
    rawData[dest] = {
      outbound: mergeMonthData(data.outbound),
      inbound: mergeMonthData(data.inbound),
    };
  }
  return rawData;
}

export function writeReportData(
  destinationData: DestinationDataMap,
  outputDataFilename: string = "flights-data.json"
): void {
  const rawData = buildRawData(destinationData);
  writeOutput(outputDataFilename, JSON.stringify(rawData));
}

export function writeDestinationMetadata(
  destinations: DestinationMeta[],
  outputMetadataFilename: string = "destinations.json"
): void {
  writeOutput(outputMetadataFilename, JSON.stringify(destinations));
}

export function buildReportShell(
  outputFilename: string = "index.html"
): void {
  copyStaticAssets();

  const templateSrc = loadReportTemplate();
  writeOutput(outputFilename, templateSrc);
}

export function generateReportArtifacts(
  destinationData: DestinationDataMap,
  outputFilename: string = "index.html"
): void {
  writeReportData(destinationData, "flights-data.json");
  buildReportShell(outputFilename);
  console.log(`\nReport generated: output/${outputFilename}`);
}
