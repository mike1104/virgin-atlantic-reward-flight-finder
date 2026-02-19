var RAW_DATA = {};
var DESTINATIONS_META = [];
var ROUTE_META_BY_CODE = {};
var ROUTES = [];
var ROUTES_BY_OD = {};
var ORIGIN_OPTIONS = [];
var LAST_SCRAPE_COMPLETED_AT = null;

// ===== Utility functions =====
function addDays(dateStr, days) {
  var d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatCabin(cabin) {
  return cabin.charAt(0).toUpperCase() + cabin.slice(1);
}

function formatDate(dateStr) {
  var d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

function formatDateTime(dateStr) {
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatPoints(n) {
  return n.toLocaleString();
}

function formatCurrencyGBP(n) {
  return '\u00A3' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getRouteParts(routeCode) {
  var parts = String(routeCode || '').split('-');
  return {
    origin: parts[0] || '',
    destination: parts[1] || ''
  };
}

function getDepartureSelection() {
  var selected = document.querySelector('.from-radio:checked');
  return selected ? selected.value : '';
}

function buildRouteCatalog() {
  ROUTE_META_BY_CODE = {};
  for (var i = 0; i < DESTINATIONS_META.length; i++) {
    var meta = DESTINATIONS_META[i];
    if (!meta || !meta.code) continue;
    ROUTE_META_BY_CODE[meta.code] = meta;
  }

  ROUTES = [];
  ROUTES_BY_OD = {};
  var originsByCode = {};
  function registerRoute(routeDef) {
    if (!routeDef || !routeDef.originCode || !routeDef.destinationCode) return;
    var odKey = routeDef.originCode + '|' + routeDef.destinationCode;
    if (ROUTES_BY_OD[odKey]) return;
    ROUTES.push(routeDef);
    ROUTES_BY_OD[odKey] = routeDef;
    if (!originsByCode[routeDef.originCode]) {
      originsByCode[routeDef.originCode] = {
        name: routeDef.originName || routeDef.originCode,
        group: routeDef.originGroup || 'Other'
      };
    }
  }

  var routeCodes = Object.keys(RAW_DATA || {});
  for (var ri = 0; ri < routeCodes.length; ri++) {
    var routeCode = routeCodes[ri];
    var routeMeta = ROUTE_META_BY_CODE[routeCode] || {};
    var parts = getRouteParts(routeCode);
    var originCode = routeMeta.originCode || parts.origin;
    var destinationCode = routeMeta.destinationCode || parts.destination;
    if (!originCode || !destinationCode) continue;

    var destinationName = routeMeta.destinationName || destinationCode;
    var originName = routeMeta.originName || originCode;
    registerRoute({
      routeCode: routeCode,
      cacheKey: routeCode,
      reverse: false,
      originCode: originCode,
      destinationCode: destinationCode,
      originName: originName,
      destinationName: destinationName,
      originGroup: routeMeta.originGroup || 'Other',
      group: routeMeta.group || 'Other',
      routeLabel: routeMeta.name || (originName + ' -> ' + destinationName)
    });

    var reverseCode = destinationCode + '-' + originCode;
    if (!RAW_DATA[reverseCode]) {
      var reverseMeta = ROUTE_META_BY_CODE[reverseCode] || {};
      var reverseOriginName = reverseMeta.originName || destinationName;
      var reverseDestinationName = reverseMeta.destinationName || originName;
      registerRoute({
        routeCode: routeCode,
        cacheKey: routeCode + '|rev',
        reverse: true,
        originCode: reverseMeta.originCode || destinationCode,
        destinationCode: reverseMeta.destinationCode || originCode,
        originName: reverseOriginName,
        destinationName: reverseDestinationName,
        originGroup: reverseMeta.originGroup || routeMeta.group || 'Other',
        group: reverseMeta.group || routeMeta.originGroup || 'Other',
        routeLabel: reverseMeta.name || (reverseOriginName + ' -> ' + reverseDestinationName)
      });
    }
  }

  ORIGIN_OPTIONS = Object.keys(originsByCode).map(function(code) {
    return {
      code: code,
      name: originsByCode[code].name,
      group: originsByCode[code].group || 'Other'
    };
  }).sort(function(a, b) {
    var groupCmp = (a.group || 'Other').localeCompare(b.group || 'Other');
    if (groupCmp !== 0) return groupCmp;
    return (a.name + ' (' + a.code + ')').localeCompare(b.name + ' (' + b.code + ')');
  });
}

function populateDepartureOptions() {
  var fromList = document.querySelector('.from-list');
  if (!fromList) return;
  var current = getDepartureSelection();
  fromList.innerHTML = '';

  var groups = {};
  for (var i = 0; i < ORIGIN_OPTIONS.length; i++) {
    var optionDef = ORIGIN_OPTIONS[i];
    var groupName = optionDef.group || 'Other';
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(optionDef);
  }

  var groupNames = Object.keys(groups).sort(function(a, b) {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b);
  });

  for (var gi = 0; gi < groupNames.length; gi++) {
    var groupName = groupNames[gi];
    var groupHtml = '<div class="dest-group-label">' + escapeHtml(groupName) + '</div>';
    var options = groups[groupName];
    for (var oi = 0; oi < options.length; oi++) {
      var optionDef = options[oi];
      var checked = current && current === optionDef.code;
      groupHtml += '<label class="from-option">' +
        '<input type="radio" name="from-airport" class="from-radio" value="' + escapeAttr(optionDef.code) + '"' + (checked ? ' checked' : '') + '>' +
        '<span>' + escapeHtml(optionDef.name + ' (' + optionDef.code + ')') + '</span>' +
      '</label>';
    }
    fromList.innerHTML += groupHtml;
  }
}

function updateFromToggleLabel() {
  var btn = document.querySelector('.from-toggle');
  if (!btn) return;
  var selected = document.querySelector('.from-radio:checked');
  if (!selected) {
    btn.textContent = 'Select';
    btn.classList.add('is-placeholder');
    updateSwapButtonState();
    return;
  }
  var label = selected.parentElement ? selected.parentElement.textContent : '';
  btn.textContent = (label || '').trim() || selected.value;
  btn.classList.remove('is-placeholder');
  updateSwapButtonState();
}

function setDepartureSelection(code) {
  if (!code) return;
  var target = document.querySelector('.from-radio[value="' + code.replace(/"/g, '\\"') + '"]');
  if (target) target.checked = true;
}

function bindFromOptionEvents() {
  document.querySelectorAll('.from-radio').forEach(function(radio) {
    radio.addEventListener('change', function() {
      populateDestinations();
      bindDestinationCheckboxEvents();
      updateFromToggleLabel();
      updateDestToggleLabel();
      invalidateAndRender();
      var fromDropdown = document.querySelector('.from-dropdown');
      if (fromDropdown) fromDropdown.classList.remove('open');
    });
  });
}

function parseIsoDateInput(value) {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function parseIsoTimestamp(value) {
  if (!value) return null;
  var ms = Date.parse(value);
  return isNaN(ms) ? null : ms;
}

function renderLastScrapeStatus() {
  var el = document.querySelector('.last-scrape-value');
  if (!el) return;
  if (!LAST_SCRAPE_COMPLETED_AT) {
    el.textContent = 'Unknown';
    return;
  }
  var parsed = parseIsoTimestamp(LAST_SCRAPE_COMPLETED_AT);
  el.textContent = parsed === null ? LAST_SCRAPE_COMPLETED_AT : formatDateTime(LAST_SCRAPE_COMPLETED_AT);
}

function getOutboundDateBounds() {
  var minDate = null;
  var maxDate = null;
  var destCodes = Object.keys(RAW_DATA || {});
  for (var di = 0; di < destCodes.length; di++) {
    var outbound = RAW_DATA[destCodes[di]] && RAW_DATA[destCodes[di]].outbound;
    if (!outbound) continue;
    var outDates = Object.keys(outbound);
    for (var i = 0; i < outDates.length; i++) {
      var d = outDates[i];
      if (minDate === null || d < minDate) minDate = d;
      if (maxDate === null || d > maxDate) maxDate = d;
    }
  }
  return { minDate: minDate, maxDate: maxDate };
}

function getCabinRank(cabin) {
  if (cabin === 'economy') return 1;
  if (cabin === 'premium') return 2;
  if (cabin === 'upper') return 3;
  return 0;
}

function getCabinComboSortRank(outCabin, inCabin) {
  var outRank = getCabinRank(outCabin);
  var inRank = getCabinRank(inCabin);
  var low = Math.min(outRank, inRank);
  var high = Math.max(outRank, inRank);
  return (low * 10) + high;
}

function getCabinSeatCount(pricing, cabin) {
  if (!pricing) return null;
  if (cabin === 'economy') return pricing.economySeats !== undefined ? pricing.economySeats : null;
  if (cabin === 'premium') return pricing.premiumSeats !== undefined ? pricing.premiumSeats : null;
  if (cabin === 'upper') return pricing.upperSeats !== undefined ? pricing.upperSeats : null;
  return null;
}

function getCabinSeatDisplay(pricing, cabin) {
  if (!pricing) return null;
  if (cabin === 'economy') return pricing.economySeatsDisplay || null;
  if (cabin === 'premium') return pricing.premiumSeatsDisplay || null;
  if (cabin === 'upper') return pricing.upperSeatsDisplay || null;
  return null;
}

function getCabinIsSaver(pricing, cabin) {
  if (!pricing) return false;
  if (cabin === 'economy') return pricing.economyIsSaver === true;
  if (cabin === 'premium') return pricing.premiumIsSaver === true;
  if (cabin === 'upper') return pricing.upperIsSaver === true;
  return false;
}

function saverTagIconHtml() {
  return '<span class="saver-tag-icon" aria-label="Saver" title="Saver">' +
    '<svg width="21" height="12" viewBox="0 0 21 12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M0.103516 2C0.103516 0.895431 0.998946 0 2.10352 0L14.1035 0V12H2.10352C0.998946 12 0.103516 11.1046 0.103516 10L0.103516 2Z" fill="#DA0530"></path>' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M14.6882 0L14.1035 0V6V12H14.6882C15.5648 12 16.3976 11.6165 16.9676 10.9504L20.0909 7.30029C20.7314 6.55174 20.7314 5.44826 20.0909 4.69971L16.9676 1.04957C16.3976 0.383465 15.5648 0 14.6882 0ZM14.1035 6C14.1035 5.33726 14.6408 4.8 15.3035 4.8C15.9663 4.8 16.5035 5.33726 16.5035 6C16.5035 6.66274 15.9663 7.2 15.3035 7.2C14.6408 7.2 14.1035 6.66274 14.1035 6Z" fill="#DA0530"></path>' +
    '</svg>' +
    '</span>';
}

function selectRemainingSeatDisplay(outSeats, inSeats, outDisplay, inDisplay, remainingSeats) {
  if (remainingSeats === null) return null;
  if (outSeats !== null && inSeats !== null) {
    if (outSeats < inSeats) return outDisplay || String(outSeats);
    if (inSeats < outSeats) return inDisplay || String(inSeats);

    var outPlus = !!(outDisplay && /\+$/.test(outDisplay));
    var inPlus = !!(inDisplay && /\+$/.test(inDisplay));
    if (outPlus && !inPlus) return inDisplay || String(remainingSeats);
    if (inPlus && !outPlus) return outDisplay || String(remainingSeats);
    if (outPlus && inPlus) return outDisplay || inDisplay || String(remainingSeats);
    return outDisplay || inDisplay || String(remainingSeats);
  }
  if (outSeats !== null) return outDisplay || String(outSeats);
  if (inSeats !== null) return inDisplay || String(inSeats);
  return null;
}

// Estimated taxes/fees model in GBP.
// Defaults apply to all routes, then route overrides (by destination code) can adjust values.
var DEFAULT_EST_FEES_GBP = {
  outbound: { economy: 180, premium: 300, upper: 650 }, // origin -> destination
  inbound: { economy: 120, premium: 220, upper: 500 }   // destination -> origin
};

var ROUTE_FEE_OVERRIDES_GBP = {
  // Example format:
  // JFK: {
  //   outbound: { upper: 700 },
  //   inbound: { upper: 540 }
  // }
};

// Route calibration models in GBP, per traveller.
// ICN model derived from real fare breakdowns across multiple cabin pairs.
var ROUTE_TAX_MODELS_GBP = {
  ICN: {
    basePerTraveller: 62.99, // UK PSC + Korea departure taxes contribution
    apdPerTravellerByOutboundCabin: {
      economy: 102.00,
      premium: 244.00,
      upper: 244.00
    },
    variablePerTraveller: {
      // Bilinear model over cabin ranks (outbound/inbound):
      // v = a + b*outRank + c*inRank + d*outRank*inRank
      a: 280.00,
      b: -169.00,
      c: -124.00,
      d: 127.00
    },
    // Empirical correction from observed Premium-Economy ICN quote:
    // when inbound is Economy, add an uplift per outbound rank step above Economy.
    inboundEconomyAdjPerOutboundRankStep: 60.00,
    // Empirical correction from observed Economy-Premium ICN quote:
    // when outbound is Economy, add an uplift per inbound rank step above Economy.
    outboundEconomyAdjPerInboundRankStep: 67.00
  }
};

function getLegEstimatedFeesGBP(destCode, direction, cabin) {
  var route = ROUTE_FEE_OVERRIDES_GBP[destCode];
  if (route && route[direction] && route[direction][cabin] !== undefined) {
    return route[direction][cabin];
  }
  return DEFAULT_EST_FEES_GBP[direction][cabin] || 0;
}

function estimateTaxesFeesGBP(destCode, outCabin, inCabin, travellers) {
  var model = ROUTE_TAX_MODELS_GBP[destCode];
  if (model) {
    var outRank = getCabinRank(outCabin);
    var inRank = getCabinRank(inCabin);
    var v = model.variablePerTraveller;
    var variablePerTraveller = v.a + (v.b * outRank) + (v.c * inRank) + (v.d * outRank * inRank);
    if (inCabin === 'economy' && outRank > 1 && model.inboundEconomyAdjPerOutboundRankStep) {
      variablePerTraveller += model.inboundEconomyAdjPerOutboundRankStep * (outRank - 1);
    }
    if (outCabin === 'economy' && inRank > 1 && model.outboundEconomyAdjPerInboundRankStep) {
      variablePerTraveller += model.outboundEconomyAdjPerInboundRankStep * (inRank - 1);
    }
    var apdPerTraveller = model.apdPerTravellerByOutboundCabin[outCabin] || 0;
    var perTraveller = model.basePerTraveller + apdPerTraveller + variablePerTraveller;
    return perTraveller * travellers;
  }

  var perTraveller =
    getLegEstimatedFeesGBP(destCode, 'outbound', outCabin) +
    getLegEstimatedFeesGBP(destCode, 'inbound', inCabin);
  return perTraveller * travellers;
}

var CABIN_MIN_OPTIONS = [
  { value: 'economy', label: 'Economy +' },
  { value: 'premium', label: 'Premium +' },
  { value: 'upper', label: 'Upper' }
];

function populateCabinMinControl(preferredValue) {
  var cabinMinSelect = document.querySelector('.cabin-min');
  if (!cabinMinSelect) return 'economy';

  var current = preferredValue || cabinMinSelect.value || 'economy';
  if (!getCabinRank(current)) current = 'economy';

  cabinMinSelect.innerHTML = '';
  CABIN_MIN_OPTIONS.forEach(function(optionDef) {
    var option = document.createElement('option');
    option.value = optionDef.value;
    option.textContent = optionDef.label;
    cabinMinSelect.appendChild(option);
  });
  cabinMinSelect.value = current;
  return current;
}

function generateSearchUrl(origin, destination, departDate, returnDate, adults) {
  var params = new URLSearchParams({
    passengers: 'a' + adults + 't0c0i0',
    awardSearch: 'true'
  });
  params.append('origin', origin);
  params.append('origin', destination);
  params.append('destination', destination);
  params.append('destination', origin);
  params.append('departing', departDate);
  params.append('departing', returnDate);
  return 'https://www.virginatlantic.com/flights/search/slice?' + params.toString();
}

// ===== Get current filter state =====
function getFilterState() {
  var minNights = parseInt(document.querySelector('.nights-min').value) || 1;
  var maxNights = parseInt(document.querySelector('.nights-max').value) || 365;
  var adults = parseInt(document.querySelector('.adults-count').value) || 2;
  var cabinMinInput = document.querySelector('.cabin-min');
  var cabinMin = cabinMinInput ? cabinMinInput.value : 'economy';
  if (!getCabinRank(cabinMin)) cabinMin = 'economy';
  var dateStart = parseIsoDateInput(document.querySelector('.date-start').value);
  var dateEnd = parseIsoDateInput(document.querySelector('.date-end').value);
  if (dateStart && dateEnd && dateStart > dateEnd) {
    var tmp = dateStart;
    dateStart = dateEnd;
    dateEnd = tmp;
  }
  if (adults < 1) adults = 1;
  var balance = parseInt(document.querySelector('.points-balance').value) || 0;
  var bonusRate = parseInt(document.querySelector('.bonus-rate').value) || 0;
  if (bonusRate < 0) bonusRate = 0;
  return {
    cabinMin: cabinMin,
    minNights: minNights,
    maxNights: maxNights,
    dateStart: dateStart,
    dateEnd: dateEnd,
    adults: adults,
    balance: balance,
    bonusRate: bonusRate
  };
}

function computeTopUpMeta(totalPts, filters) {
  var pointsNeeded = Math.max(0, totalPts - filters.balance);
  var maxBase = 200000 * filters.adults;
  var bonusMultiplier = 1 + filters.bonusRate / 100;
  var baseToBuy = bonusMultiplier > 0 ? Math.ceil(pointsNeeded / bonusMultiplier) : pointsNeeded;
  var canAfford = baseToBuy <= maxBase;
  return {
    pointsNeeded: pointsNeeded,
    baseToBuy: baseToBuy,
    canAfford: canAfford
  };
}

// ===== Check if a cabin combo passes filter =====
function cabinPassesFilter(outCabin, inCabin, filters) {
  var minRank = getCabinRank(filters.cabinMin);
  var outRank = getCabinRank(outCabin);
  var inRank = getCabinRank(inCabin);
  return outRank >= minRank && inRank >= minRank;
}

// ===== Compute combos for a destination using current filters =====
function computeCombos(routeRef, filters) {
  var routeCode = typeof routeRef === 'string' ? routeRef : routeRef.routeCode;
  var reverse = !!(routeRef && typeof routeRef === 'object' && routeRef.reverse);
  var data = RAW_DATA[routeCode];
  if (!data) return [];

  var outbound = reverse ? data.inbound : data.outbound;
  var inbound = reverse ? data.outbound : data.inbound;
  if (!outbound || !inbound) return [];
  var combos = [];
  var cabins = ['economy', 'premium', 'upper'];

  var outDates = Object.keys(outbound).sort();
  for (var di = 0; di < outDates.length; di++) {
    var departDate = outDates[di];
    if (filters.dateStart && departDate < filters.dateStart) continue;
    if (filters.dateEnd && departDate > filters.dateEnd) continue;
    var outPricing = outbound[departDate];

    for (var nights = filters.minNights; nights <= filters.maxNights; nights++) {
      var returnDate = addDays(departDate, nights);
      if (filters.dateStart && returnDate < filters.dateStart) continue;
      if (filters.dateEnd && returnDate > filters.dateEnd) continue;
      if (!(returnDate in inbound)) continue;
      var inPricing = inbound[returnDate];

      for (var oi = 0; oi < cabins.length; oi++) {
        var outCabin = cabins[oi];
        if (outPricing[outCabin] === undefined) continue;

        for (var ii = 0; ii < cabins.length; ii++) {
          var inCabin = cabins[ii];
          if (inPricing[inCabin] === undefined) continue;

          if (!cabinPassesFilter(outCabin, inCabin, filters)) continue;

          var outSeats = getCabinSeatCount(outPricing, outCabin);
          var inSeats = getCabinSeatCount(inPricing, inCabin);
          var outSeatsDisplay = getCabinSeatDisplay(outPricing, outCabin);
          var inSeatsDisplay = getCabinSeatDisplay(inPricing, inCabin);
          var outIsSaver = getCabinIsSaver(outPricing, outCabin);
          var inIsSaver = getCabinIsSaver(inPricing, inCabin);
          if (outSeats !== null && outSeats < filters.adults) continue;
          if (inSeats !== null && inSeats < filters.adults) continue;
          var remainingSeats = null;
          if (outSeats !== null && inSeats !== null) remainingSeats = Math.min(outSeats, inSeats);
          else if (outSeats !== null) remainingSeats = outSeats;
          else if (inSeats !== null) remainingSeats = inSeats;
          var remainingSeatsDisplay = selectRemainingSeatDisplay(
            outSeats,
            inSeats,
            outSeatsDisplay,
            inSeatsDisplay,
            remainingSeats
          );

          var outPts = outPricing[outCabin] * filters.adults;
          var inPts = inPricing[inCabin] * filters.adults;
          var totalPts = outPts + inPts;

          combos.push({
            depart: departDate,
            ret: returnDate,
            nights: nights,
            outCabin: outCabin,
            inCabin: inCabin,
            outPts: outPts,
            inPts: inPts,
            totalPts: totalPts,
            outSeats: outSeats,
            inSeats: inSeats,
            outSeatsDisplay: outSeatsDisplay,
            inSeatsDisplay: inSeatsDisplay,
            outIsSaver: outIsSaver,
            inIsSaver: inIsSaver,
            remainingSeats: remainingSeats,
            remainingSeatsDisplay: remainingSeatsDisplay
          });
        }
      }
    }
  }

  return combos;
}

// ===== Sort state per destination =====
var sortState = {};

function sortCombos(combos, column, direction, filters) {
  combos.sort(function(a, b) {
    var aVal, bVal;
    switch (column) {
      case 'origin': aVal = a.originCode || ''; bVal = b.originCode || ''; break;
      case 'destination': aVal = a.destinationCode || ''; bVal = b.destinationCode || ''; break;
      case 'depart': aVal = a.depart; bVal = b.depart; break;
      case 'return': aVal = a.ret; bVal = b.ret; break;
      case 'nights': aVal = a.nights; bVal = b.nights; break;
      case 'outCabin': aVal = getCabinRank(a.outCabin) || 0; bVal = getCabinRank(b.outCabin) || 0; break;
      case 'inCabin': aVal = getCabinRank(a.inCabin) || 0; bVal = getCabinRank(b.inCabin) || 0; break;
      case 'remainingSeats':
        aVal = a.remainingSeats === null ? -1 : a.remainingSeats;
        bVal = b.remainingSeats === null ? -1 : b.remainingSeats;
        break;
      case 'taxesFees':
        aVal = estimateTaxesFeesGBP(a.destinationCode || a.dest, a.outCabin, a.inCabin, filters.adults);
        bVal = estimateTaxesFeesGBP(b.destinationCode || b.dest, b.outCabin, b.inCabin, filters.adults);
        break;
      case 'totalPoints': aVal = a.totalPts; bVal = b.totalPts; break;
      case 'topUpCost': aVal = a.totalPts; bVal = b.totalPts; break;
      default: aVal = a.totalPts; bVal = b.totalPts;
    }
    if (direction === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    } else {
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    }
  });
}

// ===== Pagination state per destination =====
var paginationState = {};

// ===== Cached combos per destination (recomputed when filters change) =====
var comboCache = {};

// ===== Get currently selected destinations =====
function getSelectedDestinations() {
  var cbs = document.querySelectorAll('.dest-cb');
  var selected = [];
  cbs.forEach(function(cb) { if (cb.checked) selected.push(cb.value); });
  return selected;
}

function updateSwapButtonState() {
  var swapBtn = document.querySelector('.swap-route-btn');
  if (!swapBtn) return;

  var currentOrigin = getDepartureSelection();
  var selectedDestinations = getSelectedDestinations();
  if (!currentOrigin || selectedDestinations.length !== 1) {
    swapBtn.disabled = true;
    return;
  }

  var newOrigin = selectedDestinations[0];
  var targetOriginRadio = document.querySelector('.from-radio[value="' + newOrigin.replace(/"/g, '\\"') + '"]');
  swapBtn.disabled = !targetOriginRadio;
}

function swapFromToSelection() {
  var currentOrigin = getDepartureSelection();
  var selectedDestinations = getSelectedDestinations();
  if (!currentOrigin || selectedDestinations.length !== 1) return;

  var newOrigin = selectedDestinations[0];
  setDepartureSelection(newOrigin);
  populateDestinations(currentOrigin);
  bindDestinationCheckboxEvents();
  updateFromToggleLabel();
  updateDestToggleLabel();
  invalidateAndRender();

  var fromDropdown = document.querySelector('.from-dropdown');
  var destDropdown = document.querySelector('.dest-dropdown');
  if (fromDropdown) fromDropdown.classList.remove('open');
  if (destDropdown) destDropdown.classList.remove('open');
}

function updateDestToggleLabel() {
  var cbs = document.querySelectorAll('.dest-cb');
  var total = cbs.length;
  var checked = 0;
  cbs.forEach(function(cb) { if (cb.checked) checked++; });
  var btn = document.querySelector('.dest-toggle');
  if (!btn) return;

  var selectAllCb = document.querySelector('.dest-select-all-cb');
  if (selectAllCb) {
    if (total === 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
      selectAllCb.disabled = true;
    } else if (checked === 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
      selectAllCb.disabled = false;
    } else if (checked === total) {
      selectAllCb.checked = true;
      selectAllCb.indeterminate = false;
      selectAllCb.disabled = false;
    } else {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = true;
      selectAllCb.disabled = false;
    }
  }

  if (total === 0) {
    btn.textContent = 'Select departure first';
    btn.classList.add('is-placeholder');
  }
  else if (checked === 0) {
    btn.textContent = 'Select';
    btn.classList.add('is-placeholder');
  }
  else if (checked === 1) {
    var sel = document.querySelector('.dest-cb:checked');
    var selLabel = sel && sel.nextElementSibling ? sel.nextElementSibling.textContent : '';
    btn.textContent = (selLabel || '').trim() || (sel && sel.value ? sel.value : ('1 of ' + total + ' destinations'));
    btn.classList.remove('is-placeholder');
  }
  else {
    btn.textContent = checked + ' of ' + total + ' destinations';
    btn.classList.remove('is-placeholder');
  }

  updateSwapButtonState();
}

// ===== Filters summary (shown when collapsed) =====
function updateFiltersSummary() {
  var el = document.querySelector('.filters-summary');
  if (!el) return;

  var from = (document.querySelector('.from-toggle') || {}).textContent || '';
  var to = (document.querySelector('.dest-toggle') || {}).textContent || '';
  if (!from || from === 'Select') { el.textContent = ''; return; }

  var parts = [from.trim() + ' \u2192 ' + to.trim()];

  var dateStart = document.querySelector('.date-start').value;
  var dateEnd = document.querySelector('.date-end').value;
  if (dateStart || dateEnd) {
    var ds = dateStart ? formatDate(dateStart) : '...';
    var de = dateEnd ? formatDate(dateEnd) : '...';
    parts.push(ds + ' \u2013 ' + de);
  }

  var minN = document.querySelector('.nights-min').value;
  var maxN = document.querySelector('.nights-max').value;
  if (minN === maxN) parts.push(minN + ' nights');
  else parts.push(minN + '\u2013' + maxN + ' nights');

  var adults = document.querySelector('.adults-count').value;
  parts.push(adults + (adults === '1' ? ' traveller' : ' travellers'));

  var cabinMin = document.querySelector('.cabin-min');
  if (cabinMin && cabinMin.value !== 'economy') parts.push(formatCabin(cabinMin.value) + '+');

  el.textContent = parts.join('  \u00B7  ');
}

// ===== Render current page of combos =====
function render() {
  var selectedDestinations = getSelectedDestinations();
  var departureCode = getDepartureSelection();
  if (!departureCode || selectedDestinations.length === 0) {
    document.querySelector('.results-table tbody').innerHTML = '';
    var comboCountEl = document.querySelector('.combo-count');
    var visibleCountEl = document.querySelector('.visible-count');
    var pageRangeEl = document.querySelector('.page-range');
    if (comboCountEl) comboCountEl.textContent = '0';
    if (visibleCountEl) visibleCountEl.textContent = '0';
    if (pageRangeEl) pageRangeEl.textContent = '0';
    return;
  }

  var filters = getFilterState();

  // Merge combos from all selected destinations
  var combos = [];
  for (var di = 0; di < selectedDestinations.length; di++) {
    var destinationCode = selectedDestinations[di];
    var routeRef = ROUTES_BY_OD[departureCode + '|' + destinationCode];
    if (!routeRef) continue;
    var comboCacheKey = routeRef.cacheKey || (routeRef.routeCode + (routeRef.reverse ? '|rev' : ''));

    if (!comboCache[comboCacheKey]) {
      comboCache[comboCacheKey] = computeCombos(routeRef, filters);
    }
    var destCombos = comboCache[comboCacheKey];
    for (var ci = 0; ci < destCombos.length; ci++) {
      var combo = destCombos[ci];
      combo.dest = routeRef.routeCode;
      combo.destLabel = routeRef.routeLabel || (routeRef.originName + ' -> ' + routeRef.destinationName);
      combo.originCode = routeRef.originCode;
      combo.destinationCode = routeRef.destinationCode;
      combos.push(combo);
    }
  }

  var ss = sortState['_global'] || { column: 'totalPoints', direction: 'asc' };
  sortCombos(combos, ss.column, ss.direction, filters);

  var totalCombos = combos.length;
  var state = paginationState['_global'] || { currentPage: 1, rowsPerPage: 100 };
  paginationState['_global'] = state;

  var visibleCombos = combos.length;
  var rowsPerPage = state.rowsPerPage;
  var totalPages = Math.max(1, Math.ceil(visibleCombos / rowsPerPage));
  var currentPage = Math.min(state.currentPage, totalPages);
  state.currentPage = currentPage;

  var startIdx = (currentPage - 1) * rowsPerPage;
  var endIdx = Math.min(startIdx + rowsPerPage, visibleCombos);
  var pageItems = combos.slice(startIdx, endIdx);

  var balance = filters.balance;
  var adults = filters.adults;
  var bonusRate = filters.bonusRate;
  var ACCOUNT_CAP = 200000;
  var MAX_ACCOUNTS = adults;
  var MAX_BASE = ACCOUNT_CAP * MAX_ACCOUNTS;
  var bonusMultiplier = 1 + bonusRate / 100;

  var rowsHtml = '';
  for (var i = 0; i < pageItems.length; i++) {
    var c = pageItems[i];
    var topUpMeta = computeTopUpMeta(c.totalPts, filters);
    var pointsNeeded = topUpMeta.pointsNeeded;
    var baseToBuy = topUpMeta.baseToBuy;
    var canAfford = topUpMeta.canAfford;

    var topUpHtml;
    var accountsLabel = MAX_ACCOUNTS === 1 ? '1 account' : MAX_ACCOUNTS + ' accounts';
    // Cost bar: 0% = green, 100% = at max purchasable, >100% = red
    var maxEffective = Math.floor(MAX_BASE * bonusMultiplier);
    var costRatio = maxEffective > 0 ? Math.min(pointsNeeded / maxEffective, 1) : (pointsNeeded > 0 ? 1 : 0);
    // Interpolate hue from 120 (green) to 0 (red)
    var barHue = Math.round(120 * (1 - costRatio));
    var barPct = Math.round(costRatio * 100);
    var pointsStyle = 'background:linear-gradient(to right, hsl(' + barHue + ',70%,85%) ' + barPct + '%, transparent ' + barPct + '%);';

    if (pointsNeeded === 0) {
      var surplus = balance - c.totalPts;
      var tooltip = 'Total: ' + formatPoints(c.totalPts) + ' pts (' + adults + (adults === 1 ? ' adult' : ' adults') + ')' +
        '\nBalance: ' + formatPoints(balance) + ' pts' +
        '\nSurplus: ' + formatPoints(surplus) + ' pts' +
        '\n\nMax purchasable: ' + formatPoints(MAX_BASE) + ' base pts across ' + accountsLabel;
      topUpHtml = '<td class="top-up-cost" style="color:var(--color-success);font-weight:500" title="' + escapeAttr(tooltip) + '">\u2713 Enough</td>';
    } else if (!canAfford) {
      var cappedBase = MAX_BASE;
      var pointsCost = (cappedBase / 1000) * 15;
      var fees = MAX_ACCOUNTS * 15;
      var totalCost = pointsCost + fees;
      var effectivePts = Math.floor(cappedBase * bonusMultiplier);
      var tooltip = 'Need ' + formatPoints(pointsNeeded) + ' pts \u2014 exceeds purchase limit\n' +
        'Max purchasable: ' + formatPoints(cappedBase) + ' base pts across ' + accountsLabel;
      if (bonusRate > 0) tooltip += ' + ' + formatPoints(effectivePts - cappedBase) + ' bonus = ' + formatPoints(effectivePts) + ' effective';
      tooltip += '\n';
      for (var t = 1; t <= MAX_ACCOUNTS; t++) {
        tooltip += '\nTransaction ' + t + ': ' + formatPoints(ACCOUNT_CAP) + ' pts \u2192 \u00A3' + ((ACCOUNT_CAP / 1000) * 15).toFixed(2) + ' + \u00A315 fee';
      }
      tooltip += '\n\nPoints: \u00A3' + pointsCost.toFixed(2) +
        '\nFees: \u00A3' + fees.toFixed(2) +
        '\nTotal: \u00A3' + totalCost.toFixed(2) +
        '\nShortfall: ' + formatPoints(pointsNeeded - effectivePts) + ' pts';
      topUpHtml = '<td class="top-up-cost" style="color:var(--color-primary);font-weight:500" title="' + escapeAttr(tooltip) + '">\u00A3' + totalCost.toFixed(2) + '+</td>';
    } else {
      var numTransactions = Math.ceil(baseToBuy / ACCOUNT_CAP);
      var pointsCost = (baseToBuy / 1000) * 15;
      var fees = numTransactions * 15;
      var totalCost = pointsCost + fees;
      var effectivePts = Math.floor(baseToBuy * bonusMultiplier);
      var tooltip = 'Need ' + formatPoints(pointsNeeded) + ' pts\n' +
        'Buy ' + formatPoints(baseToBuy) + ' base pts across ' + numTransactions + (numTransactions === 1 ? ' account' : ' accounts');
      if (bonusRate > 0) tooltip += ' + ' + formatPoints(effectivePts - baseToBuy) + ' bonus = ' + formatPoints(effectivePts) + ' effective';
      tooltip += '\n';
      var remaining = baseToBuy;
      for (var t = 1; t <= numTransactions; t++) {
        var txnPts = Math.min(remaining, ACCOUNT_CAP);
        var txnCost = (txnPts / 1000) * 15;
        tooltip += '\nTransaction ' + t + ': ' + formatPoints(txnPts) + ' pts \u2192 \u00A3' + txnCost.toFixed(2) + ' + \u00A315 fee';
        remaining -= txnPts;
      }
      tooltip += '\n\nPoints: \u00A3' + pointsCost.toFixed(2) +
        '\nFees: \u00A3' + fees.toFixed(2) +
        '\nTotal: \u00A3' + totalCost.toFixed(2);
      topUpHtml = '<td class="top-up-cost" title="' + escapeAttr(tooltip) + '">\u00A3' + totalCost.toFixed(2) + '</td>';
    }

    var routeOrigin = c.originCode || getRouteParts(c.dest).origin;
    var routeDestination = c.destinationCode || getRouteParts(c.dest).destination;
    var searchUrl = generateSearchUrl(routeOrigin, routeDestination, c.depart, c.ret, adults);
    var estFees = estimateTaxesFeesGBP(routeDestination || c.dest, c.outCabin, c.inCabin, adults);
    var remainingSeatsLabel = c.remainingSeatsDisplay || (c.remainingSeats === null ? '-' : String(c.remainingSeats));
    var remainingSeatsTooltip = 'Outbound seats: ' + (c.outSeatsDisplay || (c.outSeats === null ? 'Unknown' : String(c.outSeats))) +
      '\nInbound seats: ' + (c.inSeatsDisplay || (c.inSeats === null ? 'Unknown' : String(c.inSeats))) +
      '\nRemaining seats for return option: ' + (c.remainingSeatsDisplay || (c.remainingSeats === null ? 'Unknown' : String(c.remainingSeats)));
    var outCabinHtml = '<span class="cabin-leg cabin-' + c.outCabin + '"><span class="cabin-label">' +
      formatCabin(c.outCabin) + (c.outIsSaver ? saverTagIconHtml() : '') + '</span></span>';
    var inCabinHtml = '<span class="cabin-leg cabin-' + c.inCabin + '"><span class="cabin-label">' +
      formatCabin(c.inCabin) + (c.inIsSaver ? saverTagIconHtml() : '') + '</span></span>';

    rowsHtml += '<tr>' +
      '<td>' + (routeOrigin || '-') + '</td>' +
      '<td>' + (routeDestination || '-') + '</td>' +
      '<td>' + formatDate(c.depart) + '</td>' +
      '<td>' + formatDate(c.ret) + '</td>' +
      '<td>' + c.nights + '</td>' +
      '<td>' + outCabinHtml + '</td>' +
      '<td>' + inCabinHtml + '</td>' +
      '<td title="' + escapeAttr(remainingSeatsTooltip) + '">' + remainingSeatsLabel + '</td>' +
      '<td class="fees" title="Estimated taxes and carrier fees">' + formatCurrencyGBP(estFees) + '</td>' +
      '<td class="points" style="' + pointsStyle + '">' + formatPoints(c.totalPts) + '</td>' +
      topUpHtml +
      '<td><a href="' + searchUrl + '" target="_blank" class="external-link search-link">Go</a></td>' +
      '</tr>';
  }

  document.querySelector('.results-table tbody').innerHTML = rowsHtml;

  // Update summary
  var comboCountEl = document.querySelector('.combo-count');
  var visibleCountEl = document.querySelector('.visible-count');
  var pageRangeEl = document.querySelector('.page-range');
  if (comboCountEl) comboCountEl.textContent = totalCombos;
  if (visibleCountEl) visibleCountEl.textContent = visibleCombos;
  if (pageRangeEl) {
    pageRangeEl.textContent = visibleCombos === 0 ? '0' : (startIdx + 1) + '-' + endIdx;
  }

  // Pagination controls
  var prevBtn = document.querySelector('.prev-btn');
  var nextBtn = document.querySelector('.next-btn');
  if (prevBtn) prevBtn.disabled = currentPage === 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

  var pageNumbersEl = document.querySelector('.page-numbers');
  if (pageNumbersEl) {
    var pageNumbers = '';
    var maxButtons = 7;

    if (totalPages <= maxButtons) {
      for (var p = 1; p <= totalPages; p++) {
        pageNumbers += '<button class="page-number' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
      }
    } else {
      if (currentPage <= 4) {
        for (var p = 1; p <= 5; p++) {
          pageNumbers += '<button class="page-number' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
        }
        pageNumbers += '<span class="page-ellipsis">...</span>';
        pageNumbers += '<button class="page-number" data-page="' + totalPages + '">' + totalPages + '</button>';
      } else if (currentPage >= totalPages - 3) {
        pageNumbers += '<button class="page-number" data-page="1">1</button>';
        pageNumbers += '<span class="page-ellipsis">...</span>';
        for (var p = totalPages - 4; p <= totalPages; p++) {
          pageNumbers += '<button class="page-number' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
        }
      } else {
        pageNumbers += '<button class="page-number" data-page="1">1</button>';
        pageNumbers += '<span class="page-ellipsis">...</span>';
        for (var p = currentPage - 1; p <= currentPage + 1; p++) {
          pageNumbers += '<button class="page-number' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
        }
        pageNumbers += '<span class="page-ellipsis">...</span>';
        pageNumbers += '<button class="page-number" data-page="' + totalPages + '">' + totalPages + '</button>';
      }
    }

    pageNumbersEl.innerHTML = pageNumbers;

    pageNumbersEl.querySelectorAll('.page-number').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.currentPage = parseInt(btn.dataset.page);
        render();
      });
    });
  }

  // Update sort header classes
  var currentSs = sortState['_global'];
  var headers = document.querySelectorAll('.results-table th.sortable');
  headers.forEach(function(h) {
    h.classList.remove('asc', 'desc');
    if (currentSs && h.dataset.column === currentSs.column) {
      h.classList.add(currentSs.direction);
    }
  });

  updateFiltersSummary();
}

// ===== URL hash persistence =====
function saveFiltersToHash() {
  var params = new URLSearchParams();
  var departure = getDepartureSelection();
  if (departure) params.set('origin', departure);

  var allCbs = document.querySelectorAll('.dest-cb');
  var allChecked = true;
  var selectedDests = [];
  allCbs.forEach(function(cb) {
    if (cb.checked) selectedDests.push(cb.value);
    else allChecked = false;
  });
  if (!allChecked) params.set('dest', selectedDests.join(','));

  var cabinMin = document.querySelector('.cabin-min');
  if (cabinMin) params.set('cabinMin', cabinMin.value);
  var showCostCols = document.querySelector('.show-cost-cols');
  if (showCostCols) params.set('costCols', showCostCols.checked ? '1' : '0');
  var filtersShellEl = document.querySelector('.filters-shell');
  if (filtersShellEl && filtersShellEl.classList.contains('collapsed')) params.set('filters', 'collapsed');
  var pointsShellEl = document.querySelector('.points-shell');
  params.set('pts', pointsShellEl && pointsShellEl.classList.contains('collapsed') ? 'collapsed' : 'expanded');

  params.set('minN', document.querySelector('.nights-min').value);
  params.set('maxN', document.querySelector('.nights-max').value);
  var dateStart = document.querySelector('.date-start').value;
  var dateEnd = document.querySelector('.date-end').value;
  if (dateStart) params.set('dStart', dateStart);
  if (dateEnd) params.set('dEnd', dateEnd);
  params.set('adults', document.querySelector('.adults-count').value);

  var balance = document.querySelector('.points-balance').value;
  if (balance) params.set('bal', balance);

  var bonus = document.querySelector('.bonus-rate').value;
  if (bonus && bonus !== '0') params.set('bonus', bonus);

  history.replaceState(null, '', '#' + params.toString());
}

function restoreFiltersFromHash() {
  var hash = window.location.hash.slice(1);
  if (!hash) return;

  var params;
  try { params = new URLSearchParams(hash); } catch(e) { return; }

  var origin = params.get('origin');
  if (origin) setDepartureSelection(origin);
  updateFromToggleLabel();

  populateDestinations(params.get('dest'));

  var cabinMin = params.get('cabinMin');
  if (cabinMin && getCabinRank(cabinMin)) {
    var cabinMinSelect = document.querySelector('.cabin-min');
    if (cabinMinSelect) cabinMinSelect.value = cabinMin;
  } else if (params.get('cabins') !== null) {
    // Backward compatibility: map old checkbox hash to minimum ranked cabin.
    var oldCabins = new Set(params.get('cabins').split(',').filter(Boolean));
    var derivedMin = 'economy';
    if (!oldCabins.has('economy') && oldCabins.has('premium')) derivedMin = 'premium';
    if (!oldCabins.has('economy') && !oldCabins.has('premium') && oldCabins.has('upper')) derivedMin = 'upper';
    var minSelect = document.querySelector('.cabin-min');
    if (minSelect) minSelect.value = derivedMin;
  }
  var costColsVal = params.get('costCols');
  if (costColsVal !== null) {
    var showCostColsCb = document.querySelector('.show-cost-cols');
    var rt = document.querySelector('.results-table');
    if (costColsVal === '1') {
      if (showCostColsCb) showCostColsCb.checked = true;
      if (rt) rt.classList.remove('hide-cost-cols');
    } else {
      if (showCostColsCb) showCostColsCb.checked = false;
      if (rt) rt.classList.add('hide-cost-cols');
    }
  }

  if (params.get('minN')) document.querySelector('.nights-min').value = params.get('minN');
  if (params.get('maxN')) document.querySelector('.nights-max').value = params.get('maxN');
  if (params.get('dStart')) document.querySelector('.date-start').value = params.get('dStart');
  if (params.get('dEnd')) document.querySelector('.date-end').value = params.get('dEnd');
  if (params.get('adults')) document.querySelector('.adults-count').value = params.get('adults');
  if (params.get('bal')) document.querySelector('.points-balance').value = params.get('bal');
  if (params.get('bonus')) document.querySelector('.bonus-rate').value = params.get('bonus');

  if (params.get('filters') === 'collapsed') {
    var filtersShell = document.querySelector('.filters-shell');
    if (filtersShell) filtersShell.classList.add('collapsed');
    var filtersToggle = document.querySelector('.filters-toggle');
    if (filtersToggle) filtersToggle.setAttribute('aria-expanded', 'false');
  }

  var ptsVal = params.get('pts');
  var pointsShell = document.querySelector('.points-shell');
  var pointsToggle = document.querySelector('.points-toggle');
  if (ptsVal === 'expanded') {
    if (pointsShell) pointsShell.classList.remove('collapsed');
    if (pointsToggle) pointsToggle.setAttribute('aria-expanded', 'true');
  } else if (ptsVal === 'collapsed') {
    if (pointsShell) pointsShell.classList.add('collapsed');
    if (pointsToggle) pointsToggle.setAttribute('aria-expanded', 'false');
  }
}

// ===== Invalidate combo cache and re-render =====
function invalidateAndRender() {
  comboCache = {};
  for (var dest in paginationState) {
    paginationState[dest].currentPage = 1;
  }
  saveFiltersToHash();
  render();
}

function populateDestinations(preferredDestinationsCsv) {
  var destList = document.querySelector('.dest-list');
  if (!destList) return;
  var departureCode = getDepartureSelection();
  var hasPreferredDestinations = preferredDestinationsCsv !== undefined && preferredDestinationsCsv !== null;
  var preferredSet = hasPreferredDestinations
    ? new Set(preferredDestinationsCsv.split(',').filter(Boolean))
    : null;

  var groups = {};
  for (var ci = 0; ci < ROUTES.length; ci++) {
    var route = ROUTES[ci];
    if (route.originCode !== departureCode) continue;
    var group = route.group || 'Other';
    if (!groups[group]) groups[group] = [];
    groups[group].push({
      code: route.destinationCode,
      label: route.destinationName ? (route.destinationName + ' (' + route.destinationCode + ')') : route.destinationCode
    });
  }

  var groupNames = Object.keys(groups).sort(function(a, b) {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b);
  });

  var html = '';
  for (var gi = 0; gi < groupNames.length; gi++) {
    var groupName = groupNames[gi];
    html += '<div class="dest-group-label">' + escapeHtml(groupName) + '</div>';

    groups[groupName].sort(function(a, b) {
      return a.label.localeCompare(b.label);
    });

    for (var di = 0; di < groups[groupName].length; di++) {
      var dest = groups[groupName][di];
      var checked = preferredSet ? preferredSet.has(dest.code) : true;
      html += '<label class="dest-option"><input type="checkbox" class="dest-cb" value="' +
        escapeAttr(dest.code) + '"' + (checked ? ' checked' : '') + '><span>' + escapeHtml(dest.label) + '</span></label>';
    }
  }
  destList.innerHTML = html;
}

function bindDestinationCheckboxEvents() {
  document.querySelectorAll('.dest-cb').forEach(function(cb) {
    cb.addEventListener('change', function() {
      updateDestToggleLabel();
      invalidateAndRender();
    });
  });
}

function initApp() {
  buildRouteCatalog();
  populateDepartureOptions();
  populateDestinations();
  populateCabinMinControl();

  var dateBounds = getOutboundDateBounds();
  var dateStartInput = document.querySelector('.date-start');
  var dateEndInput = document.querySelector('.date-end');
  if (dateStartInput && dateEndInput) {
    if (dateBounds.minDate) {
      dateStartInput.min = dateBounds.minDate;
      dateEndInput.min = dateBounds.minDate;
    }
    if (dateBounds.maxDate) {
      dateStartInput.max = dateBounds.maxDate;
      dateEndInput.max = dateBounds.maxDate;
    }
    dateStartInput.value = dateBounds.minDate || '';
    dateEndInput.value = dateBounds.maxDate || '';
  }

  // Restore saved filters from URL hash
  restoreFiltersFromHash();
  bindFromOptionEvents();
  bindDestinationCheckboxEvents();
  updateFromToggleLabel();
  updateDestToggleLabel();
  renderLastScrapeStatus();

  var filtersShell = document.querySelector('.filters-shell');
  var filtersToggle = document.querySelector('.filters-toggle');
  if (filtersShell && filtersToggle) {
    filtersToggle.addEventListener('click', function() {
      filtersShell.classList.toggle('collapsed');
      var collapsed = filtersShell.classList.contains('collapsed');
      filtersToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      saveFiltersToHash();
    });
  }

  var pointsShell = document.querySelector('.points-shell');
  var pointsToggle = document.querySelector('.points-toggle');
  if (pointsShell && pointsToggle) {
    pointsToggle.addEventListener('click', function() {
      pointsShell.classList.toggle('collapsed');
      var collapsed = pointsShell.classList.contains('collapsed');
      pointsToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      saveFiltersToHash();
    });
  }

  var showCostColsCb = document.querySelector('.show-cost-cols');
  var resultsTable = document.querySelector('.results-table');
  if (showCostColsCb && resultsTable) {
    resultsTable.classList.toggle('hide-cost-cols', !showCostColsCb.checked);
    showCostColsCb.addEventListener('change', function() {
      resultsTable.classList.toggle('hide-cost-cols', !showCostColsCb.checked);
      saveFiltersToHash();
    });
  }

  // Destination multi-select
  var fromToggle = document.querySelector('.from-toggle');
  var fromDropdown = document.querySelector('.from-dropdown');
  var destToggle = document.querySelector('.dest-toggle');
  var destDropdown = document.querySelector('.dest-dropdown');
  var swapRouteBtn = document.querySelector('.swap-route-btn');

  if (fromToggle && fromDropdown) {
    fromToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      fromDropdown.classList.toggle('open');
      destDropdown.classList.remove('open');
    });
  }

  destToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    destDropdown.classList.toggle('open');
    if (fromDropdown) fromDropdown.classList.remove('open');
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.from-multiselect') && fromDropdown) {
      fromDropdown.classList.remove('open');
    }
    if (!e.target.closest('.dest-multiselect')) {
      destDropdown.classList.remove('open');
    }
  });

  var destSelectAllCb = document.querySelector('.dest-select-all-cb');
  if (destSelectAllCb) {
    destSelectAllCb.addEventListener('change', function() {
      var shouldSelectAll = destSelectAllCb.checked;
      document.querySelectorAll('.dest-cb').forEach(function(cb) { cb.checked = shouldSelectAll; });
      updateDestToggleLabel();
      invalidateAndRender();
    });
  }

  if (swapRouteBtn) {
    swapRouteBtn.addEventListener('click', function() {
      swapFromToSelection();
    });
  }

  // Filter listeners - these invalidate combo cache
  document.querySelector('.cabin-min').addEventListener('change', invalidateAndRender);
  document.querySelector('.nights-min').addEventListener('input', invalidateAndRender);
  document.querySelector('.nights-max').addEventListener('input', invalidateAndRender);
  document.querySelector('.date-start').addEventListener('input', invalidateAndRender);
  document.querySelector('.date-end').addEventListener('input', invalidateAndRender);
  document.querySelector('.adults-count').addEventListener('input', invalidateAndRender);

  // These only affect display, not combos
  document.querySelector('.points-balance').addEventListener('input', function() { saveFiltersToHash(); render(); });
  document.querySelector('.bonus-rate').addEventListener('input', function() { saveFiltersToHash(); render(); });

  // Sorting
  document.querySelectorAll('.results-table th.sortable').forEach(function(header) {
    header.addEventListener('click', function() {
      var column = header.dataset.column;
      var ss = sortState['_global'] || { column: 'totalPoints', direction: 'asc' };
      if (ss.column === column) {
        ss.direction = ss.direction === 'asc' ? 'desc' : 'asc';
      } else {
        ss.direction = 'asc';
      }
      ss.column = column;
      sortState['_global'] = ss;

      if (paginationState['_global']) {
        paginationState['_global'].currentPage = 1;
      }
      render();
    });
  });

  // Pagination controls
  document.querySelector('.prev-btn').addEventListener('click', function() {
    var state = paginationState['_global'];
    if (state && state.currentPage > 1) {
      state.currentPage--;
      render();
    }
  });

  document.querySelector('.next-btn').addEventListener('click', function() {
    var state = paginationState['_global'];
    if (state) {
      state.currentPage++;
      render();
    }
  });

  document.querySelector('.rows-per-page').addEventListener('change', function() {
    var state = paginationState['_global'] || { currentPage: 1, rowsPerPage: 100 };
    state.rowsPerPage = parseInt(this.value);
    state.currentPage = 1;
    paginationState['_global'] = state;
    render();
  });

  // Initial render
  render();
}

// ===== Initialise on DOM ready =====
document.addEventListener('DOMContentLoaded', function() {
  Promise.all([
    fetch('flights-data.json').then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }),
    fetch('destinations.json')
      .then(function(res) {
        if (!res.ok) return [];
        return res.json();
      })
      .catch(function() { return []; }),
    fetch('scrape-metadata.json')
      .then(function(res) {
        if (!res.ok) return null;
        return res.json();
      })
      .catch(function() { return null; })
  ])
    .then(function(results) {
      RAW_DATA = results[0] || {};
      DESTINATIONS_META = Array.isArray(results[1]) ? results[1] : [];
      LAST_SCRAPE_COMPLETED_AT = results[2] && typeof results[2].scrapedAt === 'string'
        ? results[2].scrapedAt
        : null;
      initApp();
    })
    .catch(function() {
      document.querySelector('.results-area').innerHTML =
        '<p class="no-data-message">No flight data available yet. Run a scrape first or wait for the next scheduled update.</p>';
    });
});
