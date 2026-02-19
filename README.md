# Virgin Atlantic Reward Return Optimizer

A TypeScript CLI that scrapes Virgin Atlantic reward-flight availability from the public Reward Flight Finder flow, caches it locally, and generates an interactive HTML report for round-trip planning from London Heathrow (`LHR`).

## Features

- Scrapes destinations directly from the Virgin Atlantic landing page each run.
- Scrapes outbound and inbound monthly availability data.
- Supports Economy, Premium, and Upper cabin combinations.
- Stores richer per-day metadata for future analysis:
  - points by cabin
  - seat counts by cabin
  - seat-count display strings (for example `9+`)
  - saver flags per cabin
  - `minPrice`, `currency`, and `minAwardPointsTotal`
  - per-day `scrapedAt` timestamps
- Generates an interactive report with:
  - destination/date/night/cabin filters
  - traveler count filtering that enforces seat availability
  - points balance and bonus top-up modeling
  - sortable columns (including scrape staleness)
  - pagination and deep-linkable filters via URL hash
  - direct search links to Virgin Atlantic booking flow

## Requirements

- Node.js 18+
- npm

## Installation

```bash
npm install
npx playwright install chromium
npm run compile
```

## Usage

The CLI commands are:

- `scrape`: fetch data and write cache only
- `process`: build UI data file (`output/flights-data.js`) from cache
- `build`: build report shell (`report.html`, `app.js`, `style.css`)
- `all` (default): run `scrape -> process -> build`

### Basic

```bash
# Default command is all
npm run dev

# Explicit full pipeline
npm run all
```

### Scrape Specific Destinations

```bash
npm run scrape -- JFK LAX SFO
```

### Process From Cache (Implicit Scrape If Needed)

```bash
npm run process
npm run process -- JFK LAX
```

### No-Cache Processing (Force Fresh Scrape First)

```bash
npm run process -- --no-cache
npm run process -- --no-cache JFK
```

### Build Report Shell Without Scraping

```bash
npm run build
```

## CLI Options

- `--no-cache`: force a fresh scrape before processing/building
- `<DEST> [DEST...]`: optional list of destination codes to include (for example `JFK LAX`)

## How Data Is Selected

1. Destination list is always scraped from the Reward Flight Finder landing page.
2. If destination-specific month availability is present on the page, those months are used.
3. If not, the scraper falls back to the next 12 months for that destination.
4. Outbound (`LHR -> DEST`) and inbound (`DEST -> LHR`) data are both collected.

## Report Behavior

- Traveler count impacts:
  - total points (multiplied by travelers)
  - eligibility (rows are excluded if either leg has fewer seats than selected travelers)
- Scrape freshness is shown as relative age, with exact outbound/inbound scrape times in tooltips.
- Filtering and sort state are persisted in the URL hash.

## Cache Layout

All cache files live under `cache/`.

- `destinations.json`: latest destination discovery payload
- `scrape-metadata.json`: metadata for the last successful scrape run
- `flights-dataset.json`: consolidated route data used by processing/build steps
- `{DEST}-{outbound|inbound}-{YEAR}-{MONTH}.json`: per-month raw day-level data

`output/` contains generated artifacts:

- `report.html`
- `flights-data.js`
- copied static assets (`app.js`, `style.css`)

## Scripts

- `npm run compile` -> TypeScript compile
- `npm run scrape` -> compile + run `scrape`
- `npm run process` -> compile + run `process`
- `npm run build` -> compile + run CLI `build`
- `npm run all` -> compile + run full pipeline
- `npm run dev` -> compile + run default CLI path
- `npm run start` -> run compiled CLI from `dist/`

## Project Structure

```text
src/
├── cli.ts
├── scraper/
│   ├── destinations.ts
│   └── month.ts
├── app/
│   ├── output.ts
│   ├── app.js
│   ├── style.css
│   ├── favicon.svg
│   └── templates/
│       └── report.html
└── shared/
    ├── types.ts
    └── utils/
        ├── cache.ts
        ├── dates.ts
        ├── env.ts
        ├── month-data.ts
        └── year-month.ts
```

## License

MIT
