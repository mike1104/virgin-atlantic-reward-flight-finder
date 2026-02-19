export type CliOptions = {
  noCache: boolean;
  requestedRoutes: string[];
};

export function printUsage(): void {
  console.log(`Usage: virgin-atlantic-optimizer <command> [options]

Commands:
  scrape     Scrape reward flight data and save cache only
  process    Build UI data file from cache (scrapes implicitly if needed)
  build      Build report HTML/CSS/JS shell from cached metadata
  all        Run scrape, process, and build (default)

Options:
  --no-cache                For process/all: force fresh scrape before processing
  <ROUTE|AIRPORT> [...]     Restrict by route key (LHR-JFK) or airport code (JFK/LHR)
`);
}

export function parseCliOptions(args: string[]): CliOptions {
  const noCache = args.includes("--no-cache");

  const requestedRoutes: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) continue;
    requestedRoutes.push(arg.toUpperCase());
  }

  return { noCache, requestedRoutes };
}
