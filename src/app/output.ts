import * as fs from "fs";
import * as path from "path";
import { Destination, MonthData } from "../shared/types";
import { writeOutput } from "../shared/utils/cache";
import { mergeMonthData } from "../shared/utils/month-data";

function loadReportTemplate(): string {
  const candidates = [
    path.resolve(__dirname, "templates/report.html"),
    path.resolve(__dirname, "../../src/app/templates/report.html"),
  ];

  for (const templatePath of candidates) {
    if (fs.existsSync(templatePath)) {
      return fs.readFileSync(templatePath, "utf-8");
    }
  }

  throw new Error("Could not find report template file (report.html)");
}

function copyStaticAssets(): void {
  const staticFiles = ["style.css", "app.js", "favicon.svg"];

  // At runtime __dirname is dist/app/. Source assets live in src/app/.
  const candidates = [
    path.resolve(__dirname, "../../src/app"),
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
type DestinationMeta = Pick<Destination, "code" | "name" | "group" | "originCode" | "destinationCode">;

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
