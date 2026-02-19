import {
  Destination,
  DestinationDataByCode,
  FlightsOutputData,
  MonthData,
  ScrapeManifest,
  ScrapeMetadata,
  YearMonth,
} from "../types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isYearMonth(value: unknown): value is YearMonth {
  if (!isRecord(value)) return false;
  if (typeof value.month !== "string" || !/^\d{2}$/.test(value.month)) return false;
  if (typeof value.year !== "string" || !/^\d{4}$/.test(value.year)) return false;
  return true;
}

function isMonthDataDay(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isOptionalNumber(value.economy) &&
    isOptionalNumber(value.premium) &&
    isOptionalNumber(value.upper) &&
    isOptionalNumber(value.economySeats) &&
    isOptionalNumber(value.premiumSeats) &&
    isOptionalNumber(value.upperSeats) &&
    isOptionalString(value.economySeatsDisplay) &&
    isOptionalString(value.premiumSeatsDisplay) &&
    isOptionalString(value.upperSeatsDisplay) &&
    isOptionalBoolean(value.economyIsSaver) &&
    isOptionalBoolean(value.premiumIsSaver) &&
    isOptionalBoolean(value.upperIsSaver) &&
    (value.minPrice === undefined || value.minPrice === null || typeof value.minPrice === "number") &&
    (value.currency === undefined || value.currency === null || typeof value.currency === "string") &&
    isOptionalNumber(value.minAwardPointsTotal)
  );
}

export function isMonthData(value: unknown): value is MonthData {
  if (!isRecord(value)) return false;
  for (const [date, day] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    if (!isMonthDataDay(day)) return false;
  }
  return true;
}

export function isDestination(value: unknown): value is Destination {
  if (!isRecord(value)) return false;
  if (typeof value.code !== "string") return false;
  if (!isOptionalString(value.originCode)) return false;
  if (!isOptionalString(value.originName)) return false;
  if (!isOptionalString(value.originGroup)) return false;
  if (!isOptionalString(value.destinationCode)) return false;
  if (!isOptionalString(value.destinationName)) return false;
  if (!isOptionalString(value.name)) return false;
  if (!isOptionalString(value.group)) return false;
  if (value.availableMonths !== undefined) {
    if (!Array.isArray(value.availableMonths)) return false;
    if (!value.availableMonths.every(isYearMonth)) return false;
  }
  return true;
}

export function isDestinationArray(value: unknown): value is Destination[] {
  return Array.isArray(value) && value.every(isDestination);
}

function isRouteMonthData(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.outbound) || !Array.isArray(value.inbound)) return false;
  if (!value.outbound.every(isMonthData) || !value.inbound.every(isMonthData)) return false;
  return true;
}

export function isDestinationDataByCode(value: unknown): value is DestinationDataByCode {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isRouteMonthData);
}

export function isScrapeManifest(value: unknown): value is ScrapeManifest {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.destinations) || !value.destinations.every(isDestination)) return false;
  if (!Array.isArray(value.months) || !value.months.every(isYearMonth)) return false;
  if (typeof value.scrapedAt !== "string") return false;
  if (value.destinationMonths !== undefined) {
    if (!isRecord(value.destinationMonths)) return false;
    for (const months of Object.values(value.destinationMonths)) {
      if (!Array.isArray(months) || !months.every(isYearMonth)) return false;
    }
  }
  return true;
}

export function isScrapeMetadata(value: unknown): value is ScrapeMetadata {
  return isRecord(value) && typeof value.scrapedAt === "string";
}

function isFlightsRouteData(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isMonthData(value.outbound) && isMonthData(value.inbound);
}

export function isFlightsOutputData(value: unknown): value is FlightsOutputData {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isFlightsRouteData);
}
