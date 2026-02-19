import { DestinationDataByCode, RouteMonthData, ScrapeManifest } from "../shared/types";
import { readCache } from "../shared/utils/cache";
import { isDestinationDataByCode, isScrapeManifest } from "../shared/utils/validation";

export function loadScrapeMetadata(filename: string): ScrapeManifest | null {
  return readCache<ScrapeManifest>(filename, {
    validator: isScrapeManifest,
    description: "scrape metadata",
  });
}

export function loadFlightsDatasetCache(filename: string): DestinationDataByCode | null {
  return readCache<DestinationDataByCode>(filename, {
    validator: isDestinationDataByCode,
    description: "flights dataset cache",
  });
}

export function serializeDestinationData(
  destinationData: Map<string, RouteMonthData>
): DestinationDataByCode {
  const serialized: DestinationDataByCode = {};
  destinationData.forEach((value, code) => {
    serialized[code] = value;
  });
  return serialized;
}

export function deserializeDestinationData(
  data: DestinationDataByCode
): Map<string, RouteMonthData> {
  return new Map(Object.entries(data));
}

export function loadDestinationDataFromCache(filename: string): Map<string, RouteMonthData> {
  const cachedDestinationData = loadFlightsDatasetCache(filename);
  if (!cachedDestinationData || Object.keys(cachedDestinationData).length === 0) {
    return new Map<string, RouteMonthData>();
  }
  return deserializeDestinationData(cachedDestinationData);
}
