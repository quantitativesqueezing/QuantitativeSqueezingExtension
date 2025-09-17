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
const cache = new Map(); // symbol -> { fetchedAt, float, shortInterest, ctb, ftd }

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

async function fetchPack(symbol) {
  const now = Date.now();
  const key = symbol.toUpperCase();

  /*const cached = cache.get(key);
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached;
  }*/
 console.log('fetchPack() SERVICE_WORKER');

  const [floatVal, siVal, ctbVal, ftdVal] = await Promise.allSettled([
    fetchFreeFloat(key),
    fetchShortInterest(key),
    fetchCTB(key),
    fetchLatestFTD(key)
  ]);

  // Get estimated cash from stored data
  const storedResult = await chrome.storage.local.get(`ticker_${key}`);
  const storedData = storedResult[`ticker_${key}`];
  
  console.log(`🔧 Service Worker: Retrieved stored data for ${key}:`, storedData);
  if (storedData) {
    console.log(`🎯 Service Worker: Available fintel fields:`, {
      shortInterest: storedData.shortInterest,
      shortInterestRatio: storedData.shortInterestRatio,
      shortInterestPercentFloat: storedData.shortInterestPercentFloat,
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

  const pack = {
    fetchedAt: storedData?.lastUpdated || now,
    float: valueOrNull(floatVal),
    shortInterest: valueOrNull(siVal),
    ctb: valueOrNull(ctbVal),
    ftd: storedData?.estimatedCash ? `$${storedData.estimatedCash}` : valueOrNull(ftdVal),
    // Enhanced Fintel.io fields from stored data
    shortInterestRatio: storedData?.shortInterestRatio || 'N/A',
    shortInterestPercentFloat: storedData?.shortInterestPercentFloat || 'N/A',
    costToBorrow: storedData?.costToBorrow || valueOrNull(ctbVal),
    shortSharesAvailable: storedData?.shortSharesAvailable || 'N/A',
    finraExemptVolume: storedData?.finraExemptVolume || 'N/A',
    failureToDeliver: storedData?.failureToDeliver || valueOrNull(ftdVal),
    lastDataUpdate: storedData?.lastDataUpdate || pickFromCrawlsTop(storedData, 'lastDataUpdate') || 'N/A',
    // Additional fields from stored data
    sharesOutstanding: storedData?.sharesOutstanding || 'N/A',
    estimatedCash: storedData?.estimatedCash ? `$${storedData.estimatedCash}` : (pickFromCrawlsTop(storedData, 'estimatedCash') ? `$${pickFromCrawlsTop(storedData, 'estimatedCash')}` : 'N/A'),
    marketCap: storedData?.marketCap || pickFromCrawlsTop(storedData, 'marketCap') || 'N/A',
    enterpriseValue: storedData?.enterpriseValue || pickFromCrawlsTop(storedData, 'enterpriseValue') || 'N/A',
    sector: storedData?.sector || pickFromCrawlsTop(storedData, 'sector') || 'N/A',
    industry: storedData?.industry || pickFromCrawlsTop(storedData, 'industry') || 'N/A',
    country: storedData?.country || pickFromCrawlsTop(storedData, 'country') || 'N/A',
    exchange: storedData?.exchange || pickFromCrawlsTop(storedData, 'exchange') || 'N/A',
    institutionalOwnership: storedData?.institutionalOwnership || pickFromCrawlsTop(storedData, 'institutionalOwnership') || 'N/A',
    regularMarketChange: storedData?.regularMarketChange || null,
    extendedMarketChange: storedData?.extendedMarketChange || null
  };

  console.log(`📦 Service Worker: Final pack for ${key}:`, pack);
  console.log(`🔍 Service Worker: Key fintel fields in pack:`, {
    shortInterest: pack.shortInterest,
    shortInterestRatio: pack.shortInterestRatio,
    shortInterestPercentFloat: pack.shortInterestPercentFloat,
    costToBorrow: pack.costToBorrow,
    finraExemptVolume: pack.finraExemptVolume
  });
  
  cache.set(key, pack);
  return pack;
}

function valueOrNull(p) {
  return p.status === 'fulfilled' ? (p.value ?? null) : null;
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
