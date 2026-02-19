const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterDestinationData,
  filterRoutes,
  getRouteEndpoints,
  isRouteCode,
} = require("../dist/cli/filters");

test("isRouteCode accepts ORG-DEST format", () => {
  assert.equal(isRouteCode("LHR-JFK"), true);
  assert.equal(isRouteCode("LHRJFK"), false);
});

test("getRouteEndpoints falls back to route code", () => {
  const endpoints = getRouteEndpoints({ code: "LHR-JFK" });
  assert.deepEqual(endpoints, { originCode: "LHR", destinationCode: "JFK" });
});

test("filterRoutes supports route and airport filters", () => {
  const routes = [
    { code: "LHR-JFK", originCode: "LHR", destinationCode: "JFK" },
    { code: "LHR-SFO", originCode: "LHR", destinationCode: "SFO" },
    { code: "MAN-JFK", originCode: "MAN", destinationCode: "JFK" },
  ];

  assert.deepEqual(
    filterRoutes(routes, ["LHR-JFK"]).map((r) => r.code),
    ["LHR-JFK"]
  );
  assert.deepEqual(
    filterRoutes(routes, ["JFK"]).map((r) => r.code).sort(),
    ["LHR-JFK", "MAN-JFK"]
  );
});

test("filterDestinationData keeps only selected route payloads", () => {
  const routeData = new Map([
    ["LHR-JFK", { outbound: [{}], inbound: [{}] }],
    ["LHR-SFO", { outbound: [{}], inbound: [{}] }],
  ]);

  const filtered = filterDestinationData(routeData, [{ code: "LHR-JFK" }]);
  assert.equal(filtered.size, 1);
  assert.equal(filtered.has("LHR-JFK"), true);
});
