import { MonthData, ReturnCombo, CabinType } from "../types";
import { addDays } from "../utils/dates";

const MIN_NIGHTS = 7;
const MAX_NIGHTS = 15;

function mergeMonthData(monthDataArray: MonthData[]): MonthData {
  const merged: MonthData = {};

  for (const monthData of monthDataArray) {
    for (const [date, pricing] of Object.entries(monthData)) {
      merged[date] = pricing;
    }
  }

  return merged;
}

export function computeReturnCombos(
  destination: string,
  outboundMonths: MonthData[],
  inboundMonths: MonthData[]
): ReturnCombo[] {
  const combos: ReturnCombo[] = [];

  // Merge all month data into single objects
  const outboundData = mergeMonthData(outboundMonths);
  const inboundData = mergeMonthData(inboundMonths);

  // Get all outbound dates
  const outboundDates = Object.keys(outboundData).sort();

  for (const departDate of outboundDates) {
    const outboundPricing = outboundData[departDate];

    // For each valid night duration
    for (let nights = MIN_NIGHTS; nights <= MAX_NIGHTS; nights++) {
      const returnDate = addDays(departDate, nights);

      // Check if return flight exists
      if (!(returnDate in inboundData)) {
        continue;
      }

      const inboundPricing = inboundData[returnDate];

      // Generate all cabin combinations
      const outboundCabins: CabinType[] = [];
      if (outboundPricing.economy !== undefined) {
        outboundCabins.push("economy");
      }
      if (outboundPricing.premium !== undefined) {
        outboundCabins.push("premium");
      }
      if (outboundPricing.upper !== undefined) {
        outboundCabins.push("upper");
      }

      const inboundCabins: CabinType[] = [];
      if (inboundPricing.economy !== undefined) {
        inboundCabins.push("economy");
      }
      if (inboundPricing.premium !== undefined) {
        inboundCabins.push("premium");
      }
      if (inboundPricing.upper !== undefined) {
        inboundCabins.push("upper");
      }

      // Create all combinations
      for (const outboundCabin of outboundCabins) {
        for (const inboundCabin of inboundCabins) {
          const outboundPoints = outboundPricing[outboundCabin]!;
          const inboundPoints = inboundPricing[inboundCabin]!;

          combos.push({
            route: `LHR-${destination}`,
            depart: departDate,
            return: returnDate,
            nights,
            outboundCabin,
            inboundCabin,
            outboundPoints,
            inboundPoints,
            totalPoints: outboundPoints + inboundPoints,
          });
        }
      }
    }
  }

  // Sort by total points ascending
  combos.sort((a, b) => a.totalPoints - b.totalPoints);

  return combos;
}
