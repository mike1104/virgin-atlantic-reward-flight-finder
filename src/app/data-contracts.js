(function(global) {
  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isOptionalString(value) {
    return value === undefined || typeof value === 'string';
  }

  function isOptionalNumber(value) {
    return value === undefined || typeof value === 'number';
  }

  function isOptionalBoolean(value) {
    return value === undefined || typeof value === 'boolean';
  }

  function isMonthDataDay(value) {
    if (!isObject(value)) return false;
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
      (value.minPrice === undefined || value.minPrice === null || typeof value.minPrice === 'number') &&
      (value.currency === undefined || value.currency === null || typeof value.currency === 'string') &&
      isOptionalNumber(value.minAwardPointsTotal)
    );
  }

  function isMonthData(value) {
    if (!isObject(value)) return false;
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      var date = keys[i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      if (!isMonthDataDay(value[date])) return false;
    }
    return true;
  }

  function isFlightsData(value) {
    if (!isObject(value)) return false;
    var routeKeys = Object.keys(value);
    for (var i = 0; i < routeKeys.length; i++) {
      var routeData = value[routeKeys[i]];
      if (!isObject(routeData)) return false;
      if (!isMonthData(routeData.outbound) || !isMonthData(routeData.inbound)) return false;
    }
    return true;
  }

  function isDestinationsMeta(value) {
    if (!Array.isArray(value)) return false;
    for (var i = 0; i < value.length; i++) {
      var item = value[i];
      if (!isObject(item) || typeof item.code !== 'string') return false;
      if (!isOptionalString(item.originCode)) return false;
      if (!isOptionalString(item.originName)) return false;
      if (!isOptionalString(item.originGroup)) return false;
      if (!isOptionalString(item.destinationCode)) return false;
      if (!isOptionalString(item.destinationName)) return false;
      if (!isOptionalString(item.name)) return false;
      if (!isOptionalString(item.group)) return false;
    }
    return true;
  }

  function isScrapeMetadata(value) {
    return isObject(value) && typeof value.scrapedAt === 'string';
  }

  global.__appContracts = {
    isFlightsData: isFlightsData,
    isDestinationsMeta: isDestinationsMeta,
    isScrapeMetadata: isScrapeMetadata
  };
})(window);
