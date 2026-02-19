const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isDestinationArray,
  isDestinationDataByCode,
  isMonthData,
  isScrapeManifest,
} = require("../dist/shared/utils/validation");

test("isMonthData validates day-level cabin payloads", () => {
  const valid = {
    "2026-02-14": {
      economy: 10000,
      economySeats: 2,
      economySeatsDisplay: "2",
      economyIsSaver: true,
      minPrice: 123.45,
      currency: "GBP",
      minAwardPointsTotal: 10000,
    },
  };
  assert.equal(isMonthData(valid), true);
  assert.equal(isMonthData({ "bad-date": {} }), false);
});

test("isDestinationArray validates route metadata records", () => {
  const valid = [{ code: "LHR-JFK", originCode: "LHR", destinationCode: "JFK", name: "London -> New York" }];
  assert.equal(isDestinationArray(valid), true);
  assert.equal(isDestinationArray([{ code: 123 }]), false);
});

test("isScrapeManifest validates scrape metadata structure", () => {
  const valid = {
    destinations: [{ code: "LHR-JFK" }],
    months: [{ month: "02", year: "2026" }],
    destinationMonths: { "LHR-JFK": [{ month: "02", year: "2026" }] },
    scrapedAt: "2026-02-19T11:00:00.000Z",
  };
  assert.equal(isScrapeManifest(valid), true);
  assert.equal(isScrapeManifest({ destinations: [], months: [] }), false);
});

test("isDestinationDataByCode validates month array payloads by route", () => {
  const valid = {
    "LHR-JFK": {
      outbound: [{ "2026-02-14": { economy: 10000 } }],
      inbound: [{ "2026-02-21": { economy: 12000 } }],
    },
  };
  assert.equal(isDestinationDataByCode(valid), true);

  const invalid = {
    "LHR-JFK": {
      outbound: [{ "bad-date": { economy: 10000 } }],
      inbound: [{}],
    },
  };
  assert.equal(isDestinationDataByCode(invalid), false);
});
