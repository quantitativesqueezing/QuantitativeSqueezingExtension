/**
 * @file
 * service_worker.js
 * 
 * service_worker.js — fetch + parse data cross-origin with host_permissions.
 * Caches per symbol for CACHE_TTL_MS.
 */
// Debug mode guard: wrap console.log/debug based on chrome.storage.local.debug_mode
(function initDebugGuard(){
  try {
    const origLog = console.log.bind(console);
    const origDebug = (console.debug || console.log).bind(console);
    let enabled = false;
    function apply(){
      console.log = enabled ? origLog : function(){};
      console.debug = enabled ? origDebug : function(){};
    }
    apply();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('debug_mode', (res)=>{ enabled = !!res.debug_mode; apply(); });
      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area)=>{
          if (area === 'local' && changes.debug_mode) { enabled = !!changes.debug_mode.newValue; apply(); }
        });
      }
    }
  } catch(e){}
})();

try {
  importScripts('dilution_tracker_simple.js');
} catch (e) {
  console.error('importScripts error:', e);
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const OPTIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map(); // symbol -> { fetchedAt, float, shortInterest, ctb, ftd }

async function getOptionsTradingEnabled(symbol) {
  try {
    const key = `options_meta_${symbol}`;
    const now = Date.now();
    const existing = await chrome.storage.local.get(key);
    const cached = existing[key];
    if (cached && cached.timestamp && (now - cached.timestamp) < OPTIONS_CACHE_TTL_MS) {
      return cached.enabled;
    }

    const endpoints = [
      `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`,
      `https://www.cboe.com/delayed_quote/api/options/${encodeURIComponent(symbol)}`
    ];

    let enabled = null;
    let sawAccessDenied = false;

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
          await res.json();
          enabled = true;
          break;
        }
        if (res.status === 403 || res.status === 404) {
          sawAccessDenied = true;
          continue;
        }
        console.warn(`⚠️ Options lookup unexpected status for ${symbol} via ${url}:`, res.status);
      } catch (err) {
        console.error(`❌ Options lookup failed for ${symbol} via ${url}:`, err);
      }
    }

    if (enabled === null && sawAccessDenied) {
      enabled = false;
    }

    if (enabled !== null) {
      await chrome.storage.local.set({ [key]: { enabled, timestamp: now } });
      return enabled;
    }

    return cached && typeof cached.enabled === 'boolean' ? cached.enabled : null;
  } catch (err) {
    console.error(`❌ getOptionsTradingEnabled error for ${symbol}:`, err);
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  console.log(`🔧 Service worker: Received message:`, msg);
  
  // Handle fetch-pack requests (main data fetching)
  if (msg?.type === 'fetch-pack' && msg.symbol) {
    console.log(`📦 Service worker: Processing fetch-pack for ${msg.symbol}`);
    
    let responseSent = false;
    
    // Set up timeout to ensure we always respond
    const timeoutId = setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        console.warn(`⏰ Service worker: Timeout for fetch-pack ${msg.symbol}`);
        sendResponse({
          fetchedAt: Date.now(),
          float: 'Timeout',
          shortInterest: 'N/A',
          ctb: 'N/A', 
          ftd: 'N/A'
        });
      }
    }, 50000); // 50 second timeout
    
    fetchPack(msg.symbol).then(result => {
      clearTimeout(timeoutId);
      if (!responseSent) {
        responseSent = true;
        console.log(`📦 Service worker: fetch-pack result for ${msg.symbol}:`, result);
        sendResponse(result || {
          fetchedAt: Date.now(),
          float: 'N/A',
          shortInterest: 'N/A',
          ctb: 'N/A',
          ftd: 'N/A'
        });
      }
    }).catch(error => {
      clearTimeout(timeoutId);
      if (!responseSent) {
        responseSent = true;
        console.error(`❌ Service worker: fetch-pack error for ${msg.symbol}:`, error);
        sendResponse({
          fetchedAt: Date.now(),
          float: 'Error',
          shortInterest: 'Error',
          ctb: 'Error',
          ftd: 'Error'
        });
      }
    });
    
    return true; // async sendResponse
  }
  
  // Handle dilution tracker float requests from content script
  if (msg?.type === 'get-dilution-float' && msg.symbol) {
    console.log(`🔧 Service worker: Received dilution request for ${msg.symbol}`);
    
    let responseSent = false;
    
    // Set up reasonable timeout for simple authentication process
    const timeoutId = setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        console.warn(`⏰ Service worker: Timeout (15s) for ${msg.symbol} - authentication taking too long`);
        sendResponse({ float: null, error: 'Authentication timeout - process taking longer than 15 seconds' });
      }
    }, 15000); // 15 second timeout for simple authentication process
    
    console.log(`🔧 Service worker: Calling fetchFreeFloat(${msg.symbol})...`);
    fetchFreeFloat(msg.symbol).then(float => {
      clearTimeout(timeoutId);
      if (!responseSent) {
        responseSent = true;
        console.log(`📊 Service worker: fetchFreeFloat returned:`, float);
        
        const response = { float };
        console.log(`📨 Service worker: Sending response:`, response);
        
        try {
          sendResponse(response);
        } catch (error) {
          console.error(`❌ Service worker: Failed to send response:`, error);
        }
      } else {
        console.warn(`⚠️ Service worker: Response already sent for ${msg.symbol}, ignoring result`);
      }
    }).catch(error => {
      clearTimeout(timeoutId);
      if (!responseSent) {
        responseSent = true;
        console.error(`❌ Service worker: fetchFreeFloat error:`, error);
        
        const errorResponse = { float: null, error: error.message };
        console.log(`📨 Service worker: Sending error response:`, errorResponse);
        
        try {
          sendResponse(errorResponse);
        } catch (sendError) {
          console.error(`❌ Service worker: Failed to send error response:`, sendError);
        }
      } else {
        console.warn(`⚠️ Service worker: Error response already sent for ${msg.symbol}, ignoring error`);
      }
    });
    
    return true; // Keep message channel open for async response
  }
  
  console.log(`🔧 Service worker: Unhandled message type:`, msg?.type);
  return false;
});

const REG_SHO_MARKETS = ['NYSE', 'NYSE American', 'NYSE Arca', 'NYSE National', 'NYSE Chicago'];

function easternNowDate() {
  const now = new Date();
  // Convert to America/New_York by formatting then re-parsing to avoid tz math issues
  const localeString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(localeString);
}

function isWeekendDay(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function previousBusinessDay(date) {
  const d = new Date(date.getTime());
  do {
    d.setDate(d.getDate() - 1);
  } while (isWeekendDay(d));
  return d;
}

function determineRegShoStartDate() {
  // Start from "today" in Eastern time and adjust for weekend / Monday guidance
  const eastern = easternNowDate();
  const start = new Date(eastern.getFullYear(), eastern.getMonth(), eastern.getDate());
  const day = start.getDay();
  if (day === 1) { // Monday → use prior Friday
    start.setDate(start.getDate() - 3);
  } else if (day === 0) { // Sunday → prior Friday
    start.setDate(start.getDate() - 2);
  } else if (day === 6) { // Saturday → prior Friday
    start.setDate(start.getDate() - 1);
  }
  if (isWeekendDay(start)) {
    return previousBusinessDay(start);
  }
  return start;
}

function formatDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fetchNasdaqRegShoForDate(symbol, date) {
  const dateStamp = formatDateYYYYMMDD(date);
  const url = `https://www.nasdaqtrader.com/dynamic/symdir/regsho/nasdaqth${dateStamp}.txt`;
  try {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) {
      return { success: false };
    }
    const text = await resp.text();
    if (!text) {
      return { success: true, onList: false, date: dateStamp };
    }
    const lines = text.split(/\r?\n/);
    const matched = lines.some((line, idx) => {
      if (idx === 0) return false; // skip header
      if (!line || !line.includes('|')) return false;
      const first = line.split('|')[0]?.trim().toUpperCase();
      return first === symbol;
    });
    return { success: true, onList: matched, date: dateStamp };
  } catch (err) {
    console.warn(`⚠️ Nasdaq RegSHO fetch failed for ${symbol} ${dateStamp}:`, err);
    return { success: false };
  }
}

async function fetchNasdaqRegShoStatus(symbol, startDate) {
  let attemptDate = new Date(startDate.getTime());
  for (let i = 0; i < 5; i++) {
    const result = await fetchNasdaqRegShoForDate(symbol, attemptDate);
    if (result.success) {
      return result;
    }
    attemptDate = previousBusinessDay(attemptDate);
  }
  return null;
}

async function fetchNyseRegShoForDate(symbol, date) {
  const isoDate = formatDateISO(date);
  let anySuccess = false;
  let onList = false;
  const marketDetails = [];

  for (const market of REG_SHO_MARKETS) {
    const url = `https://www.nyse.com/api/regulatory/threshold-securities/download?selectedDate=${isoDate}&market=${encodeURIComponent(market)}`;
    try {
      const resp = await fetch(url, { cache: 'no-cache' });
      if (!resp.ok) {
        continue;
      }
      const text = await resp.text();
      if (!text || !text.includes('|')) {
        continue;
      }
      anySuccess = true;
      const lines = text.split(/\r?\n/);
      const matched = lines.some((line) => {
        if (!line || !line.includes('|')) return false;
        const first = line.split('|')[0]?.trim().toUpperCase();
        return first === symbol;
      });
      marketDetails.push({ market, onList: matched });
      if (matched) onList = true;
    } catch (err) {
      console.warn(`⚠️ NYSE RegSHO fetch failed for ${symbol} ${isoDate} (${market}):`, err);
    }
  }

  if (!anySuccess) {
    return { success: false };
  }

  return { success: true, onList, date: isoDate, markets: marketDetails };
}

async function fetchNyseRegShoStatus(symbol, startDate) {
  let attemptDate = new Date(startDate.getTime());
  for (let i = 0; i < 5; i++) {
    const result = await fetchNyseRegShoForDate(symbol, attemptDate);
    if (result.success) {
      return result;
    }
    attemptDate = previousBusinessDay(attemptDate);
  }
  return null;
}

async function fetchRegShoStatus(symbol) {
  const targetDate = determineRegShoStartDate();
  const [nasdaq, nyse] = await Promise.all([fetchNasdaqRegShoStatus(symbol, targetDate), fetchNyseRegShoStatus(symbol, targetDate)]);

  if (!nasdaq && !nyse) {
    return null;
  }

  const sources = {};
  if (nasdaq) {
    sources.nasdaq = {
      onList: !!nasdaq.onList,
      date: nasdaq.date || null
    };
  }
  if (nyse) {
    sources.nyse = {
      onList: !!nyse.onList,
      date: nyse.date || null,
      markets: nyse.markets || []
    };
  }

  return {
    onList: Boolean((nasdaq && nasdaq.onList) || (nyse && nyse.onList)),
    sources
  };
}

async function fetchPack(symbol) {
  const now = Date.now();
  const key = symbol.toUpperCase();
  const storageKey = `ticker_${key}`;

  /*const cached = cache.get(key);
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached;
  }*/
 console.log('fetchPack() SERVICE_WORKER');

  const [floatVal, siVal, ctbVal, ftdVal, regShoVal] = await Promise.allSettled([
    fetchFreeFloat(key),
    fetchShortInterest(key),
    fetchCTB(key),
    fetchLatestFTD(key),
    fetchRegShoStatus(key)
  ]);

  let regShoResult = null;
  if (regShoVal.status === 'fulfilled') {
    regShoResult = regShoVal.value;
  } else if (regShoVal.status === 'rejected') {
    console.warn(`⚠️ RegSHO status fetch failed for ${key}:`, regShoVal.reason);
  }

  // Get estimated cash from stored data
  const storedResult = await chrome.storage.local.get(storageKey);
  let storedData = storedResult[storageKey];
  let workingData = storedData ? { ...storedData } : null;
  let storageMutated = false;

  console.log(`🔧 Service Worker: Retrieved stored data for ${key}:`, storedData);
  if (storedData) {
    console.log(`🎯 Service Worker: Available fintel fields:`, {
      shortInterest: storedData.shortInterest,
      shortInterestRatio: storedData.shortInterestRatio,
      costToBorrow: storedData.costToBorrow,
      shortSharesAvailable: storedData.shortSharesAvailable,
      finraExemptVolume: storedData.finraExemptVolume,
      failureToDeliver: storedData.failureToDeliver,
      lastDataUpdate: storedData.lastDataUpdate
    });
  }
  
  function pickFromCrawlsTop(stored, key) {
    try {
      if (!stored) return null;
      if (stored[key]) return stored[key];
      const dt = stored.pageCrawls && stored.pageCrawls.dilutiontracker;
      if (dt) {
        if (dt.values && Array.isArray(dt.values[key])) {
          const occ = dt.values[key].find(v => v && v.value != null && String(v.value).trim() !== '');
          if (occ) return occ.value;
        }
        if (dt.inferred && dt.inferred[key]) return dt.inferred[key];
      }
      const fi = stored.pageCrawls && stored.pageCrawls.fintel;
      if (fi) {
        if (fi.values && Array.isArray(fi.values[key])) {
          const occ = fi.values[key].find(v => v && v.value != null && String(v.value).trim() !== '');
          if (occ) return occ.value;
        }
        if (fi.inferred && fi.inferred[key]) return fi.inferred[key];
      }
      return null;
    } catch { return null; }
  }

  const optionsEnabledRaw = await getOptionsTradingEnabled(key);
  const optionsEnabled = optionsEnabledRaw === null ? null : !!optionsEnabledRaw;
  if (optionsEnabled !== null) {
    if (!workingData) workingData = {};
    if (workingData.optionsTradingEnabled !== optionsEnabled) {
      workingData.optionsTradingEnabled = optionsEnabled;
      storageMutated = true;
    }
  }

  const floatRaw = valueOrNull(floatVal);
  const shortInterestRaw = valueOrNull(siVal);
  const costToBorrowRaw = valueOrNull(ctbVal);
  const ftdRaw = valueOrNull(ftdVal);
  const shortBorrowRateTable = Array.isArray(storedData?.shortBorrowRateTable) ? storedData.shortBorrowRateTable : null;
  const failsToDeliverTable = Array.isArray(storedData?.failsToDeliverTable) ? storedData.failsToDeliverTable : null;
  const shortSharesAvailabilityTable = Array.isArray(storedData?.shortSharesAvailabilityTable) ? storedData.shortSharesAvailabilityTable : null;

  const floatAbs = firstNonNull(
    parseShares(storedData?.latestFloat),
    parseShares(floatRaw)
  );

  const sharesOutstandingAbs = firstNonNull(
    parseShares(storedData?.sharesOutstanding),
    parseShares(pickFromCrawlsTop(storedData, 'sharesOutstanding'))
  );

  const shortInterestAbs = firstNonNull(
    parseShares(storedData?.shortInterest),
    parseShares(shortInterestRaw)
  );

  const shortInterestFormatted = firstNonNull(
    formatSharesString(shortInterestRaw),
    formatSharesString(storedData?.shortInterest),
    shortInterestAbs != null ? Math.round(shortInterestAbs).toLocaleString() : null
  );

  if (shortInterestFormatted) {
    if (!workingData) workingData = storedData ? { ...storedData } : {};
    if (workingData.shortInterest !== shortInterestFormatted) {
      workingData.shortInterest = shortInterestFormatted;
      storageMutated = true;
    }
  } else if (workingData && Object.prototype.hasOwnProperty.call(workingData, 'shortInterest')) {
    delete workingData.shortInterest;
    storageMutated = true;
  }

  let shortSharesAvailableAbs = firstNonNull(
    parseShares(storedData?.shortSharesAvailable),
    parseShares(pickFromCrawlsTop(storedData, 'shortSharesAvailable'))
  );

  const finraExemptVolumeAbs = firstNonNull(
    parseShares(storedData?.finraExemptVolume),
    parseShares(pickFromCrawlsTop(storedData, 'finraExemptVolume'))
  );

  let failureToDeliverAbs = firstNonNull(
    parseShares(storedData?.failureToDeliver),
    parseShares(ftdRaw),
    parseShares(pickFromCrawlsTop(storedData, 'failureToDeliver'))
  );

  const estimatedCashDollars = firstNonNull(
    parseDollars(storedData?.estimatedCash),
    parseDollars(pickFromCrawlsTop(storedData, 'estimatedCash'))
  );

  const marketCapDollars = firstNonNull(
    parseDollars(storedData?.marketCap),
    parseDollars(pickFromCrawlsTop(storedData, 'marketCap'))
  );

  const enterpriseValueDollars = firstNonNull(
    parseDollars(storedData?.enterpriseValue),
    parseDollars(pickFromCrawlsTop(storedData, 'enterpriseValue'))
  );

  const estimatedNetCashPerShareVal = firstNonNull(
    parseNumber(storedData?.estimatedNetCashPerShare),
    parseNumber(pickFromCrawlsTop(storedData, 'estimatedNetCashPerShare'))
  );

  let costToBorrowPercent = deriveCostToBorrowPercent(shortBorrowRateTable, costToBorrowRaw, storedData?.costToBorrow);

  const tableShortShares = extractShortSharesAvailability(shortSharesAvailabilityTable);
  if (tableShortShares != null) {
    shortSharesAvailableAbs = tableShortShares;
    if (!workingData) workingData = storedData ? { ...storedData } : {};
    if (workingData.shortSharesAvailable !== tableShortShares) {
      workingData.shortSharesAvailable = tableShortShares;
      storageMutated = true;
    }
  }

  const tableCostToBorrow = extractCostToBorrowLatest(shortBorrowRateTable);
  if (tableCostToBorrow != null) {
    costToBorrowPercent = tableCostToBorrow;
    if (!workingData) workingData = storedData ? { ...storedData } : {};
    if (workingData.costToBorrow !== tableCostToBorrow) {
      workingData.costToBorrow = tableCostToBorrow;
      storageMutated = true;
    }
  }

  const tableFailureToDeliver = extractFtdValue(failsToDeliverTable);
  if (tableFailureToDeliver != null) {
    failureToDeliverAbs = tableFailureToDeliver;
    if (!workingData) workingData = storedData ? { ...storedData } : {};
    if (workingData.failureToDeliver !== tableFailureToDeliver) {
      workingData.failureToDeliver = tableFailureToDeliver;
      storageMutated = true;
    }
  }

  const shortInterestRatioDays = firstNonNull(
    parseNumber(storedData?.shortInterestRatio),
    parseNumber(pickFromCrawlsTop(storedData, 'shortInterestRatio'))
  );

  const institutionalOwnershipPercent = firstNonNull(
    parsePercent(storedData?.institutionalOwnership),
    parsePercent(pickFromCrawlsTop(storedData, 'institutionalOwnership'))
  );

  const regShoMinFtdsAbs = (typeof sharesOutstandingAbs === 'number' && isFinite(sharesOutstandingAbs) && sharesOutstandingAbs > 0)
    ? sharesOutstandingAbs * 0.005
    : null;

  const shortFloatPercent = (typeof shortInterestAbs === 'number' && typeof floatAbs === 'number' && floatAbs > 0)
    ? formatPercentTwoDecimals((shortInterestAbs / floatAbs) * 100)
    : null;
  if (shortFloatPercent) {
    if (!workingData) workingData = {};
    if (workingData.shortInterestPercentFloat !== shortFloatPercent) {
      workingData.shortInterestPercentFloat = shortFloatPercent;
      storageMutated = true;
    }
  }
  else if (workingData && workingData.shortInterestPercentFloat) {
    delete workingData.shortInterestPercentFloat;
    storageMutated = true;
  }

  if (regShoResult) {
    if (!workingData) workingData = storedData ? { ...storedData } : {};
    if (workingData.regShoThreshold !== regShoResult.onList) {
      workingData.regShoThreshold = regShoResult.onList;
      storageMutated = true;
    }
    if (JSON.stringify(workingData.regShoSources || null) !== JSON.stringify(regShoResult.sources || null)) {
      workingData.regShoSources = regShoResult.sources || null;
      storageMutated = true;
    }
  }

  if (storageMutated && workingData) {
    await chrome.storage.local.set({ [storageKey]: workingData });
    storedData = workingData;
  } else if (workingData) {
    storedData = workingData;
  }

  const packShortInterestDisplay = shortInterestFormatted
    || normalizeSharesString(shortInterestRaw)
    || (typeof storedData?.shortInterest === 'string' ? storedData.shortInterest : null);

  const pack = {
    fetchedAt: storedData?.lastUpdated || now,
    float: floatAbs ?? null,
    shortInterest: packShortInterestDisplay ?? null,
    shortInterestRatio: shortInterestRatioDays ?? null,
    shortInterestPercentFloat: shortFloatPercent,
    costToBorrow: costToBorrowPercent ?? null,
    shortSharesAvailable: shortSharesAvailableAbs ?? null,
    finraExemptVolume: finraExemptVolumeAbs ?? null,
    failureToDeliver: failureToDeliverAbs ?? null,
    regShoMinFtds: regShoMinFtdsAbs ?? null,
    lastDataUpdate: storedData?.lastDataUpdate || pickFromCrawlsTop(storedData, 'lastDataUpdate') || null,
    sharesOutstanding: sharesOutstandingAbs ?? null,
    estimatedCash: estimatedCashDollars ?? null,
    marketCap: marketCapDollars ?? null,
    enterpriseValue: enterpriseValueDollars ?? null,
    estimatedNetCashPerShare: estimatedNetCashPerShareVal ?? null,
    shortBorrowRateTable: storedData?.shortBorrowRateTable || null,
    failsToDeliverTable: storedData?.failsToDeliverTable || null,
    shortSharesAvailabilityTable: storedData?.shortSharesAvailabilityTable || null,
    sector: storedData?.sector || pickFromCrawlsTop(storedData, 'sector') || null,
    industry: storedData?.industry || pickFromCrawlsTop(storedData, 'industry') || null,
    country: storedData?.country || pickFromCrawlsTop(storedData, 'country') || null,
    exchange: storedData?.exchange || pickFromCrawlsTop(storedData, 'exchange') || null,
    institutionalOwnership: institutionalOwnershipPercent ?? null,
    optionsTradingEnabled: optionsEnabled,
    regShoThreshold: regShoResult ? regShoResult.onList : (storedData?.regShoThreshold ?? null),
    regShoSources: regShoResult ? regShoResult.sources : (storedData?.regShoSources || null),
    regularMarketChange: storedData?.regularMarketChange || null,
    extendedMarketChange: storedData?.extendedMarketChange || null
  };

  console.log(`📦 Service Worker: Final pack for ${key}:`, pack);
  console.log(`🔍 Service Worker: Key fintel fields in pack:`, {
    shortInterest: pack.shortInterest,
    shortInterestRatio: pack.shortInterestRatio,
    costToBorrow: pack.costToBorrow,
    shortSharesAvailable: pack.shortSharesAvailable,
    failureToDeliver: pack.failureToDeliver,
    finraExemptVolume: pack.finraExemptVolume
  });
  
  cache.set(key, pack);
  return pack;
}

function valueOrNull(p) {
  return p.status === 'fulfilled' ? (p.value ?? null) : null;
}

function firstNonNull(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return value;
      continue;
    }
    if (typeof value === 'string' && value.trim().toLowerCase() === 'n/a') continue;
    if (value !== '') return value;
  }
  return null;
}

function parseShares(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (!Number.isInteger(value) && Math.abs(value) < 1e6) {
      return value * 1e6;
    }
    return value;
  }
  const cleaned = String(value)
    .replace(/shares?/ig, '')
    .replace(/,/g, '')
    .trim();
  if (!cleaned) return null;
  const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)([KMB])?$/i);
  if (match) {
    const raw = parseFloat(match[1]);
    if (!Number.isFinite(raw)) return null;
    const unit = match[2] ? match[2].toUpperCase() : '';
    const multiplier = unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
    if (!unit && cleaned.includes('.') && Math.abs(raw) < 1e6) {
      return raw * 1e6;
    }
    return raw * multiplier;
  }
  const numeric = parseFloat(cleaned);
  if (!Number.isFinite(numeric)) return null;
  if (cleaned.includes('.') && Math.abs(numeric) < 1e6) {
    return numeric * 1e6;
  }
  return numeric;
}

function formatSharesString(value) {
  const num = parseShares(value);
  if (num == null) return null;
  return Math.round(num).toLocaleString();
}

function normalizeSharesString(value) {
  if (value == null) return null;
  const str = String(value).replace(/shares?/ig, '').trim();
  if (!str) return null;
  if (/^n\/?a$/i.test(str)) return null;
  return str;
}

function parseDollars(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const cleaned = String(value)
    .replace(/[$,]/g, '')
    .trim();
  if (!cleaned) return null;
  const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)([KMBT])?$/i);
  if (match) {
    const raw = parseFloat(match[1]);
    if (!Number.isFinite(raw)) return null;
    const unit = match[2] ? match[2].toUpperCase() : '';
    const multiplier = unit === 'T' ? 1e12 : unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
    return raw * multiplier;
  }
  const numeric = parseFloat(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePercent(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const match = String(value).replace(/,/g, '').match(/([+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const numeric = parseFloat(match[1]);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const match = String(value).replace(/,/g, '').match(/([+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const numeric = parseFloat(match[1]);
  return Number.isFinite(numeric) ? numeric : null;
}

function deriveCostToBorrowPercent(tableRows, rawValue, storedValue) {
  if (Array.isArray(tableRows) && tableRows.length) {
    const firstRow = tableRows[0] || {};
    const candidates = ['Latest', 'latest', 'Borrow Rate', 'Fee', 'Rate'];
    for (const key of candidates) {
      if (firstRow[key] != null && String(firstRow[key]).trim() !== '') {
        const parsed = parsePercent(firstRow[key]);
        if (parsed != null) return parsed;
      }
    }
    const vals = Object.values(firstRow).filter(v => v != null && String(v).trim() !== '');
    if (vals.length) {
      const parsed = parsePercent(vals[0]);
      if (parsed != null) return parsed;
    }
  }
  const fallback = parsePercent(rawValue);
  if (fallback != null) return fallback;
  return parsePercent(storedValue);
}

function extractShortSharesAvailability(tableRows) {
  if (!Array.isArray(tableRows) || !tableRows.length) return null;
  const row = tableRows[0] || {};
  const candidates = ['shortSharesAvailability', 'shortSharesAvailable', 'sharesAvailable', 'availableShares', 'shares'];
  for (const key of candidates) {
    if (row[key] != null && String(row[key]).trim() !== '') {
      const parsed = parseShares(row[key]);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }
  return null;
}

function extractCostToBorrowLatest(tableRows) {
  if (!Array.isArray(tableRows) || !tableRows.length) return null;
  const row = tableRows[0] || {};
  const candidates = ['latest', 'Latest', 'borrowRate', 'Borrow Rate', 'fee', 'Fee', 'rate', 'Rate'];
  for (const key of candidates) {
    if (row[key] != null && String(row[key]).trim() !== '') {
      const parsed = parsePercent(row[key]);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

function extractFtdValue(tableRows) {
  if (!Array.isArray(tableRows) || !tableRows.length) return null;
  const row = tableRows[0] || {};
  const candidates = ['value', 'Value', 'amount', 'Amount', 'usd', 'USD'];
  for (const key of candidates) {
    if (row[key] != null && String(row[key]).trim() !== '') {
      const parsed = parseDollars(row[key]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function formatPercentTwoDecimals(value) {
  if (!Number.isFinite(value)) return null;
  const fixed = value.toFixed(2);
  return `${fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
}

/* ---------------------------
   Free Float (DilutionTracker -> FinViz fallback)
---------------------------- */

async function fetchFreeFloat(symbol) {
  console.log(`🔧 fetchFreeFloat: Using stored data for ${symbol}`);
  
  try {
    // Get stored data from extension storage
    const result = await chrome.storage.local.get(`ticker_${symbol.toUpperCase()}`);
    const data = result[`ticker_${symbol.toUpperCase()}`];
    
    if (data && data.latestFloat) {
      console.log(`💾 Found stored float for ${symbol}: ${data.latestFloat}M`);
      return data.latestFloat; // Return as number
    } else {
      console.log(`❌ No stored float data found for ${symbol}`);
      return null;
    }
    
  } catch (error) {
    console.error(`❌ fetchFreeFloat: Error getting stored data for ${symbol}:`, error);
    return null;
  }
}

/* ---------------------------
   Short Interest (Fintel)
---------------------------- */

/* Short Interest: Fintel first, FinViz fallback */
async function fetchShortInterest(symbol) {
  // Try Fintel short interest page (shares value)
  try {
    const fintel = await fetchFintelShortInterest(symbol);
    if (fintel) return fintel; // e.g., "167,565,108 shares"
  } catch (_) {
    // ignore and fallback
  }

  // IBKR placeholder (if ever implemented later)
  const ibkr = await fetchShortInterestIBKR(symbol);
  if (ibkr) return ibkr;

  // FinViz fallback (often a percent like "Short Float")
  try {
    const resp = await fetch(`https://finviz.com/quote.ashx?t=${encodeURIComponent(symbol)}`, { cache: 'no-cache' });
    if (!resp.ok) return null;
    const text = await resp.text();
    // parse “Short Float” or “Short Interest” values via regex
    let m = text.match(/Short\s*Float[^<]*<td[^>]*>([^<]+)/i);
    if (m) return m[1].trim();
    m = text.match(/Short\s*Interest[^<]*<td[^>]*>([^<]+)/i);
    if (m) return m[1].trim();
  } catch (_) {
    // swallow
  }
  return null;
}

async function fetchFintelShortInterest(symbol) {
  const url = `https://fintel.io/ss/us/${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { cache: 'no-cache', credentials: 'include' });
  if (!res.ok) return null;
  const html = await res.text();
  return parseFintelShortInterest(html);
}

function parseFintelShortInterest(html) {
  // Prefer explicit "Short Interest" with shares unit
  // Examples we try to capture:
  //  - Short Interest: 167,565,108 shares
  //  - Short Interest Shares: 167,565,108
  //  - Shares Short: 167,565,108
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ') // strip tags
    .replace(/\s+/g, ' ')
    .trim();

  // Try most specific first: "Short Interest" followed by shares
  let m = text.match(/Short\s*Interest\s*[:\-–—]?\s*([\d.,]+)\s*shares/i);
  if (m && m[1]) return `${m[1].trim()} shares`;

  // Alternate labels
  m = text.match(/Short\s*Interest\s*Shares\s*[:\-–—]?\s*([\d.,]+)/i);
  if (m && m[1]) return `${m[1].trim()} shares`;

  m = text.match(/Shares\s*Short\s*[:\-–—]?\s*([\d.,]+)/i);
  if (m && m[1]) return `${m[1].trim()} shares`;

  // Guard against percentage match (ensure not followed by %)
  m = text.match(/Short\s*Interest\s*[:\-–—]?\s*([\d.,]+)(?!\s*%)/i);
  if (m && m[1]) return `${m[1].trim()} shares`;

  return null;
}

/* CTB: IBKR stub (requires API credentials), FinViz has no borrow fee */
async function fetchCTB(symbol) {
  return await fetchCTBFromIBKR(symbol); // implement once you have IBKR access
}

/* FTD: disabled (Fintel removed) */
async function fetchLatestFTD(symbol) {
  return null;
}

/* ---------------------------
   Helpers
---------------------------- */

function tableValueByLabel(doc, labels) {
  // Looks for a TD/TH with any label, returns the sibling cell’s text
  const allCells = [...doc.querySelectorAll('td,th')];
  for (const cell of allCells) {
    const t = (cell.textContent || '').trim();
    if (!t) continue;
    if (labels.some(l => equalsLoose(t, l))) {
      // Prefer next sibling cell
      let sib = cell.nextElementSibling;
      if (!sib || !/td|th/i.test(sib.tagName)) {
        // Try parent row’s other cells
        const rowCells = [...cell.parentElement?.children || []];
        const idx = rowCells.indexOf(cell);
        if (idx >= 0 && rowCells[idx + 1]) sib = rowCells[idx + 1];
      }
      if (sib) return (sib.textContent || '').trim();
    }
  }
  return null;
}

function equalsLoose(a, b) {
  return a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
}

function findByLabelText(doc, labels, returnRaw = false) {
  // Generic label:value lookup in definition lists, cards, or tables
  // Scan for elements that look like label; return adjacent/sibling text
  const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    const txt = (el.textContent || '').trim();
    if (!txt) continue;
    for (const lbl of labels) {
      const re = new RegExp(`^${escapeRegex(lbl)}\\s*[:\\-]?\\s*(.+)$`, 'i');
      const m = txt.match(re);
      if (m && m[1]) return returnRaw ? m[1].trim() : sanitizeNumberish(m[1]);
    }
    // Sibling pattern: <label> <value>
    if (labels.some(lbl => equalsLoose(txt, lbl))) {
      const sib = el.nextElementSibling;
      if (sib && sib.textContent) {
        return returnRaw ? sib.textContent.trim() : sanitizeNumberish(sib.textContent);
      }
    }
  }
  return null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeNumberish(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function tryRegexFromText(text, re, groupIdx = 1) {
  const m = text.match(re);
  return m ? m[groupIdx] : null;
}

function normalizeFloat(s) {
  // Accept formats like "1.23B", "523.4M", "1,234,567,890", return as readable string
  const raw = s.trim();
  const unitMatch = raw.match(/^([\d.,]+)\s*([MB])\b/i);
  if (unitMatch) {
    const n = parseFloat(unitMatch[1].replace(/,/g, ''));
    const unit = unitMatch[2].toUpperCase();
    const value = unit === 'B' ? n * 1e9 : n * 1e6;
    return humanNumber(value);
  }
  const asNum = Number(raw.replace(/,/g, ''));
  return isFinite(asNum) ? humanNumber(asNum) : raw;
}

function humanNumber(n) {
  if (!isFinite(n)) return 'N/A';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return String(Math.round(n));
}

// IBKR API stubs (to be implemented when API credentials available)
async function fetchShortInterestIBKR(_symbol) {
  // TODO: implement when IBKR API setup
  return null;
}

async function fetchCTBFromIBKR(_symbol) {
  // TODO: implement when IBKR API setup
  return null;
}
