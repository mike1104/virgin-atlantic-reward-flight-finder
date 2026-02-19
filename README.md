# Virgin Atlantic Reward Return Optimizer

TypeScript CLI + static web report for scraping Virgin Atlantic reward-seat availability and exploring round-trip options.

## What it does

- Scrapes available routes and route-specific month ranges from Virgin Atlantic Reward Flight Finder.
- Fetches monthly outbound/inbound reward availability with seat counts and saver flags.
- Caches raw and processed data locally.
- Builds a static report (`output/index.html`) with client-side filters and sorting.
- Shows one global `Last scrape completed` timestamp from `output/scrape-metadata.json`.

## Requirements

- Node.js 18+
- npm

## Setup

```bash
npm install
npx playwright install chromium
npm run compile
```

## CLI commands

- `scrape`: scrape and cache only.
- `process`: build output JSON files from cache (scrapes first if needed).
- `build`: copy HTML/CSS/JS shell to `output/`.
- `all` (default): `scrape -> process -> build`.

Examples:

```bash
npm run all
npm run scrape -- JFK LAX
npm run process -- --no-cache
npm run build
```

Route filters accept either:

- route keys (`LHR-JFK`)
- airport codes (`JFK`)

## Output files

- `output/index.html`
- `output/app.js`
- `output/data-contracts.js`
- `output/style.css`
- `output/favicon.svg`
- `output/flights-data.json`
- `output/destinations.json`
- `output/scrape-metadata.json`

## Cache files

Stored in `cache/` with schema-versioned envelopes:

- `aggregates/destinations.json`
- `aggregates/scrape-metadata.json`
- `aggregates/flights-dataset.json`
- `raw-months/{ORIGIN}-{DEST}-{YEAR}-{MONTH}.json`

## Quality checks

- `npm run compile`
- `npm run typecheck`
- `npm run lint`
- `npm run test`

PRs run `.github/workflows/ci.yml` (compile + lint + tests).

## Deployment workflows

- `.github/workflows/scrape.yml`
  - scheduled/manual scrape
  - uploads a durable `scraped-data` artifact
  - deploys latest scrape output to GitHub Pages
- `.github/workflows/deploy.yml`
  - on `main` pushes
  - builds latest shell from code
  - downloads latest successful `scraped-data` artifact from `scrape.yml`
  - deploys combined shell + data

## Project layout

```text
src/
├── cli.ts
├── cli/
│   ├── cache-data.ts
│   ├── filters.ts
│   ├── options.ts
│   └── progress.ts
├── scraper/
│   ├── destinations.ts
│   └── month.ts
├── app/
│   ├── app.js
│   ├── data-contracts.js
│   ├── output.ts
│   ├── style.css
│   ├── favicon.svg
│   └── templates/report.html
└── shared/
    ├── types.ts
    └── utils/
        ├── cache.ts
        ├── dates.ts
        ├── env.ts
        ├── month-data.ts
        ├── validation.ts
        └── year-month.ts
```

## License

MIT
