import { Destination, RouteMonthData } from "../shared/types";

export function isRouteCode(value: string): boolean {
  return /^[A-Z]{3}-[A-Z]{3}$/.test(value);
}

export function getRouteEndpoints(route: Destination): { originCode: string | null; destinationCode: string | null } {
  const [fallbackOrigin, fallbackDestination] = route.code.split("-");
  return {
    originCode: (route.originCode || fallbackOrigin || "").toUpperCase() || null,
    destinationCode: (route.destinationCode || fallbackDestination || "").toUpperCase() || null,
  };
}

function routeMatchesAnyFilter(route: Destination, filters: string[]): boolean {
  if (filters.length === 0) return true;
  const routeCode = route.code.toUpperCase();
  const endpoints = getRouteEndpoints(route);

  for (const rawToken of filters) {
    const token = rawToken.toUpperCase();
    if (token.includes("-")) {
      if (routeCode === token) return true;
      continue;
    }
    if (
      token.length === 3 &&
      (endpoints.originCode === token || endpoints.destinationCode === token)
    ) {
      return true;
    }
  }

  return false;
}

export function filterRoutes(routes: Destination[], filters: string[]): Destination[] {
  if (filters.length === 0) return routes;
  return routes.filter((route) => routeMatchesAnyFilter(route, filters));
}

export function filterDestinationData(
  destinationData: Map<string, RouteMonthData>,
  routes: Destination[]
): Map<string, RouteMonthData> {
  if (routes.length === 0) return new Map<string, RouteMonthData>();
  const allowedRouteCodes = new Set(routes.map((route) => route.code));
  const filtered = new Map<string, RouteMonthData>();
  destinationData.forEach((value, code) => {
    if (allowedRouteCodes.has(code)) filtered.set(code, value);
  });
  return filtered;
}

export function filterDestinationsMetadata(
  destinations: Destination[],
  destinationData: Map<string, RouteMonthData>
): Destination[] {
  const available = new Set(destinationData.keys());
  return destinations.filter((destination) => available.has(destination.code));
}
