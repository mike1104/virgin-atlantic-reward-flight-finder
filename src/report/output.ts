import * as fs from "fs";
import * as path from "path";
import { Eta } from "eta";
import { MonthData } from "../types";
import { writeOutput } from "../utils/cache";

type DestinationOption = {
  code: string;
  name: string;
  group: string;
};

type DestinationGroup = {
  name: string;
  destinations: DestinationOption[];
};

function loadReportTemplate(): string {
  const candidates = [
    path.resolve(__dirname, "templates/report.eta"),
    path.resolve(__dirname, "../../src/report/templates/report.eta"),
  ];

  for (const templatePath of candidates) {
    if (fs.existsSync(templatePath)) {
      return fs.readFileSync(templatePath, "utf-8");
    }
  }

  throw new Error("Could not find report template file (report.eta)");
}

function buildDestinationGroups(
  destinations: string[],
  destinationNames?: Map<string, string>,
  destinationGroups?: Map<string, string>
): DestinationGroup[] {
  const options: DestinationOption[] = destinations.map(code => ({
    code,
    name: destinationNames?.get(code) || code,
    group: destinationGroups?.get(code) || "Other",
  }));

  if (!destinationGroups || destinationGroups.size === 0) {
    return [
      {
        name: "",
        destinations: options,
      },
    ];
  }

  const grouped = new Map<string, DestinationOption[]>();
  for (const option of options) {
    const list = grouped.get(option.group) || [];
    list.push(option);
    grouped.set(option.group, list);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([groupName, groupDestinations]) => ({
      name: groupName,
      destinations: groupDestinations,
    }));
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
  outputDataFilename: string = "flights-data.js"
): void {
  const rawData = buildRawData(destinationData);
  writeOutput(outputDataFilename, `var RAW_DATA = ${JSON.stringify(rawData)};\n`);
}

export function buildReportShell(
  destinations: string[],
  outputFilename: string = "report.html",
  destinationNames?: Map<string, string>,
  destinationGroups?: Map<string, string>
): void {
  const groupedDestinations = buildDestinationGroups(destinations.sort(), destinationNames, destinationGroups);
  const eta = new Eta({ autoEscape: true });
  const template = loadReportTemplate();
  const html = eta.renderString(template, {
    destinationGroupsEnabled: !!(destinationGroups && destinationGroups.size > 0),
    groupedDestinations,
  });

  if (!html) {
    throw new Error("Failed to render report HTML template");
  }

  copyStaticAssets();
  writeOutput(outputFilename, html);
}

export function generateReportArtifacts(
  destinationData: DestinationDataMap,
  outputFilename: string = "report.html",
  destinationNames?: Map<string, string>,
  destinationGroups?: Map<string, string>
): void {
  const destinations = Array.from(destinationData.keys());
  writeReportData(destinationData, "flights-data.js");
  buildReportShell(destinations, outputFilename, destinationNames, destinationGroups);
  console.log(`\nReport generated: output/${outputFilename}`);
}
