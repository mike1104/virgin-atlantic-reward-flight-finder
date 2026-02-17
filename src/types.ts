export type YearMonth = {
  month: string;
  year: string;
};

export type Destination = {
  code: string;
  name?: string;
  group?: string; // Region grouping like "North America", "Asia", etc.
  availableMonths?: YearMonth[];
};

export type MonthData = {
  [date: string]: {
    economy?: number;
    premium?: number;
    upper?: number;
    economySeats?: number;
    premiumSeats?: number;
    upperSeats?: number;
    economySeatsDisplay?: string;
    premiumSeatsDisplay?: string;
    upperSeatsDisplay?: string;
    economyIsSaver?: boolean;
    premiumIsSaver?: boolean;
    upperIsSaver?: boolean;
    minPrice?: number | null;
    currency?: string | null;
    minAwardPointsTotal?: number;
    scrapedAt?: string;
  };
};

export type CabinType = "economy" | "premium" | "upper";

export type ApiSeatData = {
  cabinPointsValue: number;
  isSaverAward: boolean;
  cabinClassSeatCount: number;
  cabinClassSeatCountString: string;
};

export type ApiPointsDay = {
  date: string;
  minPrice: number;
  currency: string;
  minAwardPointsTotal: number;
  seats: {
    awardEconomy?: ApiSeatData;
    awardComfortPlusPremiumEconomy?: ApiSeatData;
    awardBusiness?: ApiSeatData;
  };
};

export type ApiMonthResponse = {
  pointsDays: ApiPointsDay[];
  month: string;
  year: string;
  totalAwardsSeatsForMonth: number;
};

export type ReturnCombo = {
  route: string;
  depart: string;
  return: string;
  nights: number;
  outboundCabin: CabinType;
  inboundCabin: CabinType;
  outboundPoints: number;
  inboundPoints: number;
  totalPoints: number;
};

export type ScrapeOptions = {
  refresh?: boolean;
  destinations?: string[];
  output?: string;
};
