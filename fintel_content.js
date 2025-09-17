/**
 * @file
 * fintel_content.js
 * 
 * Content script for fintel.io pages
 * Extracts Short Interest, Cost to Borrow, FTD, and other short metrics
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

console.log('🔍 Fintel content script loaded');

// Check if we're on a short interest page
const currentUrl = window.location.href;
const tickerMatch = currentUrl.match(/fintel\.io\/ss\/us\/([A-Z]{1,5})/i);

if (tickerMatch) {
  const ticker = tickerMatch[1].toUpperCase();
  console.log(`📊 Detected Fintel ticker page: ${ticker}`);
  
  // Wait for page to load and extract data
  setTimeout(() => {
    extractFintelData(ticker);
    // Also run generic page crawler storing all label/value + tables
    setTimeout(() => crawlAndStoreStructuredPageData(ticker, 'fintel'), 800);
  }, 3000); // Wait 3 seconds for dynamic content
  
  // Also set up observer for dynamic content changes
  const observer = new MutationObserver(() => {
    extractFintelData(ticker);
    // Debounced crawl on DOM changes
    clearTimeout(window.__qseFintelCrawlTimer);
    window.__qseFintelCrawlTimer = setTimeout(() => crawlAndStoreStructuredPageData(ticker, 'fintel'), 700);
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * Extract short interest and related data from Fintel page
 * @param {string} ticker - Stock ticker symbol
 */
async function extractFintelData(ticker) {
  try {
    console.log(`🔍 Extracting Fintel data for ${ticker}...`);
    
    // Check if user has access (not behind paywall)
    const paywallIndicators = document.querySelectorAll('[class*="paywall"], [class*="premium"], [class*="subscribe"]');
    if (paywallIndicators.length > 0) {
      console.log('💰 Paywall detected - skipping extraction');
      return;
    }
    
    const pageText = document.body.textContent || '';
    const fintelData = extractFintelMetrics(pageText);
    
    if (fintelData && Object.keys(fintelData).length > 0) {
      console.log('📊 Parsed Fintel data:', fintelData);
      
      // Old label-based highlighting disabled; we now highlight by crawled values
      
      // Check if data has changed before storing
      await storeFintelDataIfChanged(ticker, fintelData);
    } else {
      console.log('❌ Could not parse Fintel data from page');
    }

    // Value highlighting removed by request
    
  } catch (error) {
    console.error('❌ Error extracting Fintel data:', error);
  }
}

/**
 * Find "Short Interest" on the page and color just the VALUE in green.
 * Handles common Fintel layouts: tables (label/value in cells) and inline text "Short Interest: <value>".
 */

/**
 * Crawl entire page for label/value pairs and tables into normalized JSON
 * and store under ticker in chrome.storage.local.
 */
async function crawlAndStoreStructuredPageData(ticker, hostKey = 'fintel') {
  try {
    const data = buildStructuredPageData();
    if (!data) return;

    // Attach meta and host key
    data.meta = {
      url: location.href,
      title: document.title,
      crawledAt: new Date().toISOString(),
      host: hostKey
    };

    // Final cleanup: drop any blacklisted values/tables
    purgeBlacklistedFromStructured(data);

    // Store under ticker
    const storageKey = `ticker_${ticker}`;
    const current = await chrome.storage.local.get(storageKey);
    const existing = current[storageKey] || {};
    // Clean existing object from blacklisted keys as well
    purgeBlacklistedFromObject(existing);
    const pageCrawls = existing.pageCrawls || {};
    pageCrawls[hostKey] = data;

    // Optionally surface a few canonical fields at top-level when present
    const inferred = data.inferred || {};
    const merged = { ...existing, pageCrawls, lastUpdated: Date.now(), ...inferred };

    await chrome.storage.local.set({ [storageKey]: merged });
    console.log(`💾 Stored structured crawl for ${ticker} (${hostKey})`, data, merged);

    // Highlighting removed by request
  } catch (e) {
    console.warn('crawlAndStoreStructuredPageData error:', e);
  }
}

function purgeBlacklistedFromStructured(data) {
  try {
    if (!data) return;
    if (data.values) {
      Object.keys(data.values).forEach(k => {
        if (isBlacklistedKey(k)) delete data.values[k];
      });
    }
    if (Array.isArray(data.tables)) {
      data.tables = data.tables.filter(t => {
        const name = (t?.name || t?.key || '').toString();
        if (isBlacklistedTableName(name)) return false;
        // Drop empty tables titled "values"/"Values"
        const norm = name.trim().toLowerCase();
        if (norm === 'values' && isTableEffectivelyEmpty(t)) return false;
        return true;
      });
    }
    if (data.inferred) {
      Object.keys(data.inferred).forEach(k => {
        if (isBlacklistedKey(k)) delete data.inferred[k];
      });
    }
  } catch {}
}

function purgeBlacklistedFromObject(obj) {
  try {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach(k => {
      if (isBlacklistedKey(k)) delete obj[k];
    });
    if (obj.pageCrawls && obj.pageCrawls.fintel) {
      purgeBlacklistedFromStructured(obj.pageCrawls.fintel);
    }
  } catch {}
}

function isTableEffectivelyEmpty(t) {
  try {
    if (!t || !Array.isArray(t.rows)) return true;
    if (t.rows.length === 0) return true;
    // If none of the rows has any non-empty cell, consider it empty
    const hasAny = t.rows.some(row => {
      if (!row || typeof row !== 'object') return false;
      return Object.values(row).some(v => String(v ?? '').trim().length > 0);
    });
    return !hasAny;
  } catch { return false; }
}

function buildStructuredPageData() {
  try {
    const values = {}; // key -> [{label,value,source,selector,heading}]
    const tables = []; // {key,name,id,class,headers,rows}

    // Helper to normalize keys and push occurrences
    function pushKV(label, value, source, el) {
      const key = canonicalKeyForLabel(label);
      if (!key) return;
      // Drop unwanted field names like Title
      if (key === 'title' || /^\s*title\s*$/i.test(String(label))) return;

      const cleanVal = sanitizeValueForStorage(String(value), key);
      if (!shouldKeepPair(key, String(label), cleanVal)) return;
      if (!values[key]) values[key] = [];
      const heading = findNearestHeading(el);
      values[key].push({ label: String(label).trim(), value: cleanVal, rawValue: String(value), source, selector: cssPath(el), heading });
    }

    // 1) Definition lists
    document.querySelectorAll('dl').forEach(dl => {
      const items = dl.querySelectorAll('dt, dd');
      for (let i = 0; i < items.length; i++) {
        const dt = items[i];
        if (dt.tagName !== 'DT') continue;
        const dd = items[i + 1];
        if (dd && dd.tagName === 'DD') {
          const label = dt.textContent?.trim();
          const value = dd.textContent?.trim();
          if (label && value) pushKV(label, value, 'dl', dd);
        }
      }
    });

    // 2) Tables (th/td or two-cell rows)
    const allowedIds = new Set([
      'short-shares-availability-table',
      'table-short-borrow-rate',
      'fails-to-deliver-table',
      'short-sale-volume-finra-table',
      'short-sale-volume-combined-table',
      'short-interest-daily-nasdaq-table',
      'short-interest-nasdaq-table'
    ]);

    document.querySelectorAll('table').forEach((table) => {
      // Only keep whitelisted tables by id
      const id = (table.getAttribute('id') || '').trim();
      if (!id || !allowedIds.has(id)) return;
      const t = extractTable(table, tables.length);
      if (t && t.rows && t.rows.length) {
        // Also filter out blacklisted table names by heading/name
        const name = (t.name || '').toString();
        const key = (t.key || '').toString();
        if (isBlacklistedTableName(name) || isBlacklistedTableName(key)) return;
        tables.push(t);
      }

      // Also treat simple two-column tables as label/value
      // Do not auto-treat rows as label/value for non-whitelisted tables (filtered above)
    });

    // 3) Inline "Label: Value" pairs within blocks
    const blocks = document.querySelectorAll('p,li,div,section,span');
    const re = /^\s*([A-Za-z][A-Za-z0-9 .%/()&-]{1,40})\s*[:\-–—]\s*(.+)$/;
    blocks.forEach(el => {
      const text = el.childElementCount ? null : el.textContent; // avoid large containers
      if (!text) return;
      const m = text.match(re);
      if (!m) return;
      const label = m[1];
      const value = m[2];
      if (isLikelyLabel(label) && value) pushKV(label, value, 'inline', el);
    });

    // Build inferred canonical single-value object (pick first occurrence of known keys)
    const inferred = {};
    const preferKeys = [
      'shortInterest','shortInterestRatio','shortInterestPercentFloat','costToBorrow',
      'shortSharesAvailable','finraExemptVolume','failureToDeliver','float','sharesOutstanding',
      'sector','industry','country','exchange','marketCap','enterpriseValue','lastDataUpdate'
    ];
    for (const k of preferKeys) {
      if (values[k] && values[k].length) {
        const v = values[k][0].value;
        inferred[k] = transformFieldForStorage(k, v);
      }
    }

    return { values, tables, inferred };
  } catch (e) {
    console.warn('buildStructuredPageData error:', e);
    return null;
  }
}

function extractTable(table, index = 0) {
  const headers = [];
  let headerRow = table.querySelector('thead tr') || table.querySelector('tr');
  if (headerRow) {
    headerRow.querySelectorAll('th,td').forEach(h => headers.push(cleanText(h.textContent)));
  }
  const rows = [];
  const bodyRows = table.querySelectorAll('tbody tr');
  const dataRows = bodyRows.length ? bodyRows : table.querySelectorAll('tr');
  dataRows.forEach((row, idx) => {
    if (row === headerRow) return;
    const cells = row.querySelectorAll('td,th');
    if (!cells.length) return;
    const obj = {};
    cells.forEach((cell, i) => {
      const key = headers[i] || `col_${i}`;
      obj[key] = cleanText(cell.textContent);
    });
    // Prune explanation-only rows: drop cells that are not value-like and keep dates
    const pruned = {};
    Object.entries(obj).forEach(([h, v]) => {
      if (isUsefulTableCell(h, v)) pruned[h] = v;
    });
    const hasAny = Object.keys(pruned).length > 0;
    // Drop rows that are labeled with blacklisted labels like Update Frequency, Source, etc.
    const isBlacklisted = hasAny && isBlacklistedRow(pruned, headers);
    if (hasAny && !isBlacklisted) rows.push(pruned);
  });
  const name = table.getAttribute('id') || table.getAttribute('aria-label') || table.getAttribute('data-name') || findNearestHeading(table) || `table_${index}`;
  const key = normalizeKey(name);
  return { key, name, id: table.id || null, class: table.className || null, headers, rows };
}

function isBlacklistedTableName(name) {
  const n = String(name || '').toLowerCase().trim();
  const norm = n.replace(/[^a-z0-9]+/g, '');
  const set = new Set([
    'updatefrequency',
    'thissectionusestheofficialnasdaq',
    'startminmaxlatestborrowrates',
    'source',
    'finratotalvolume',
    'finrashortvolumeratio',
    'finrashortvolume',
    'shortsalevolumecombinedtable'
  ]);
  return set.has(norm);
}

function isBlacklistedRow(row, headers) {
  // Try to detect a label cell (first header) or scan all values
  const bl = new Set([
    'updatefrequency',
    'thissectionusestheofficialnasdaq',
    'startminmaxlatestborrowrates',
    'source',
    'finratotalvolume',
    'finrashortvolumeratio',
    'finrashortvolume'
  ]);

  // Check first column if available
  const firstHeader = Array.isArray(headers) && headers.length ? headers[0] : null;
  if (firstHeader && row[firstHeader]) {
    const norm = String(row[firstHeader]).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (bl.has(norm)) return true;
  }
  // Scan any short textual value that matches blacklist exactly
  for (const val of Object.values(row)) {
    const s = String(val).trim();
    if (!s) continue;
    if (/\d/.test(s)) continue; // likely a data value
    const norm = s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (bl.has(norm)) return true;
  }
  return false;
}

function canonicalKeyForLabel(label) {
  const raw = String(label).trim().toLowerCase();
  const map = {
    'short interest': 'Short Interest',
    'short interest ratio': 'shortInterestRatio',
    'short ratio': 'shortInterestRatio',
    'days to cover': 'Days to Cover',
    'short interest % float': 'Short Float %',
    'short interest % of float': 'Short Float %',
    'short % float': 'Short Float %',
    'cost to borrow': 'Cost to Borrow (IBKR)',
    'borrow rate': 'Cost to Borrow (IBKR)',
    'borrow fee': 'Cost to Borrow (IBKR)',
    'ctb': 'Cost to Borrow (IBKR)',
    'short shares available': 'Short Shares Available (IBKR)',
    'shares available': 'Short Shares Available (IBKR)',
    'available shares': 'Short Shares Available (IBKR)',
    'short-exempt volume': 'Short-Exempt Volume',
    'exempt volume': 'Short-Exempt Volume',
    'finra exempt volume': 'Short-Exempt Volume',
    'regulation sho exempt': 'Short-Exempt Volume',
    'failure to deliver': 'Failure to Deliver (FTDs)',
    'fails to deliver': 'Failure to Deliver (FTDs)',
    'ftd': 'Failure to Deliver (FTDs)',
    'float': 'Free Float',
    'free float': 'Free Float',
    'shares outstanding': 'Shares Outstanding',
    'outstanding shares': 'Shares Outstanding',
    'sector': 'Sector',
    'industry': 'Industry',
    'country': 'Country',
    'exchange': 'Exchange',
    'market cap': 'Market Cap',
    'mkt cap': 'Market Cap',
    'enterprise value': 'E/V',
    'ev': 'E/V',
    'last update': 'Last Updated',
    'data as of': 'Last Updated',
    'as of': 'Last Updated'
  };
  if (map[raw]) return map[raw];
  return normalizeKey(raw);
}

function normalizeKey(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ (\w)/g, (_, c) => c.toUpperCase()); // camelCase-ish
}

function isLikelyLabel(s) {
  const t = String(s).trim();
  if (!t) return false;
  if (/\d{2,}/.test(t)) return false; // lots of digits not a label
  return /[A-Za-z]/.test(t) && t.length <= 48;
}

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// Decide whether to keep a label/value pair
function shouldKeepPair(key, label, value) {
  if (!value) return false;
  const k = String(key).toLowerCase();
  // never store Title field in values
  if (k === 'title') return false;
  // blacklist unwanted keys
  if (isBlacklistedKey(k) || isBlacklistedKey(label)) return false;
  // allow select textual fields
  const allowedTextKeys = new Set(['sector','industry','country','exchange','description','marketCap','enterpriseValue','institutionalOwnership','lastDataUpdate']);
  if (allowedTextKeys.has(k)) {
    if (k === 'description') return true; // description allowed as-is (sanitized earlier)
    // other textual: keep short, non-sentence values
    return !isLikelyExplanationText(value);
  }
  // numeric or unit-like values
  if (isValueLike(value)) return true;
  return false;
}

function isLikelyExplanationText(s) {
  const v = String(s).trim();
  if (v.length > 140) return true;
  const sentences = v.split(/[.!?]/).filter(x => x.trim().length);
  if (sentences.length >= 2 && v.length > 80) return true;
  // heuristics for explanatory phrases
  if (/\b(this\s+number|provided\s+by|that\s+were|number\s+of\s+short\s+shares|included\s+in)\b/i.test(v)) return true;
  return false;
}

function isValueLike(s) {
  const v = String(s).trim();
  if (!v) return false;
  if (/\d/.test(v)) return true; // contains digits
  if (/[%$]/.test(v)) return true;
  if (/\b(shares?|days?|volume|rate|float|borrow|exempt|deliver|ftd)\b/i.test(v)) return true;
  // short single tokens
  if (v.length <= 24 && /^[A-Za-z][A-Za-z &-]*$/.test(v)) return true;
  return false;
}

function isUsefulTableCell(header, value) {
  const h = String(header || '').toLowerCase();
  if (isBlacklistedKey(h)) return false;
  if (/date|time|settlement|as of/.test(h)) return true;
  if (/label|description|notes?/.test(h)) return false;
  if (isLikelyExplanationText(value)) return false;
  return isValueLike(value);
}

// Sanitize values for storage: collapse exotic spaces/zero-width; allow rich spacing only for description
function sanitizeValueForStorage(val, key) {
  try {
    if (!val) return '';
    let s = String(val);
    // Unicode normalize
    if (s.normalize) s = s.normalize('NFKC');
    // Remove zero-width characters
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
    // Replace non-breaking and various unicode spaces with normal space
    s = s.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
    if (key === 'description') {
      // Keep user-facing spacing; just trim ends
      return s.trim();
    }
    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    // Field-specific normalization
    return normalizeFieldValue(key, s);
  } catch {
    return String(val).trim();
  }
}

// Field-specific transforms for inferred storage
function transformFieldForStorage(key, value) {
  if (key === 'shortInterest') {
    const n = parseShareCount(value);
    return Number.isFinite(n) ? n : value;
  }
  if (key === 'shortInterestPercentFloat') {
    const p = extractPercent(value);
    return p || value;
  }
  if (key === 'finraExemptVolume' || key === 'finraNonExemptVolume') {
    const v = extractSharesCount(value);
    return v || value;
  }
  return value;
}

// Parse counts like "167,565,108 shares", "167.6M", "150K" into integer
function parseShareCount(input) {
  if (input == null) return NaN;
  let s = String(input).trim();
  // Remove unit words
  s = s.replace(/shares?|shrs?/ig, '').trim();
  // Match number with optional unit
  const m = s.match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!m) {
    // Try to extract first number chunk
    const m2 = s.match(/([\d][\d.,]*)/);
    if (!m2) return NaN;
    return parseInt(m2[1].replace(/,/g, ''), 10);
  }
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(num)) return NaN;
  const unit = (m[2] || '').toUpperCase();
  const mult = unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
  return Math.round(num * mult);
}

// Blacklist for unwanted keys/labels/headers
function isBlacklistedKey(name) {
  const n = String(name || '').toLowerCase().trim();
  const norm = n.replace(/[^a-z0-9]+/g, '');
  const set = new Set([
    'offexchangeshortvolume',
    'offexchangeshortvolumeratio',
    'psxbxshortvolume',
    'aggregatetotalvolume',
    'aggregateshortvolume',
    'aggregateshortvolumeratio',
    'cboeshortvolume',
    'offexchangeshortvolume',
    'source',
    'startminmaxlatestborrowrates',
    'thissectionusestheofficialnasdaq',
    'updatefrequency',
    'check', 'ki', 'mutwor', 'rlhdt', 'type',
    'values' // stray Values blob with non-data tokens
  ]);
  return set.has(norm);
}

// Normalize specific fields by extracting numeric/units only
function normalizeFieldValue(key, value) {
  const k = String(key || '').toLowerCase();
  if (k === 'shortinterestpercentfloat') {
    const p = extractPercent(value);
    return p || value;
  }
  if (k === 'finraexemptvolume' || k === 'finranonexemptvolume') {
    const v = extractSharesCount(value);
    return v || value;
  }
  return value;
}

function extractPercent(s) {
  const m = String(s).match(/([\d.,]+)\s*%/);
  if (!m) return null;
  const num = m[1].replace(/\s/g, '');
  return `${num}%`;
}

function extractSharesCount(s) {
  const txt = String(s);
  const m = txt.match(/([\d.,]+)\s*([KMB])?\s*(shares?)?/i);
  if (!m) return null;
  let val = m[1].trim();
  if (m[2]) val = `${val}${m[2].toUpperCase()}`;
  if (m[3]) val = `${val} shares`;
  return val;
}

function findNearestHeading(el) {
  const headingSel = 'h1,h2,h3,h4,h5,h6';
  let cur = el;
  for (let i = 0; i < 5 && cur; i++) {
    // Look backwards among siblings for a heading
    let p = cur.previousElementSibling;
    while (p) {
      if (p.matches && p.matches(headingSel)) return cleanText(p.textContent);
      p = p.previousElementSibling;
    }
    cur = cur.parentElement;
  }
  return null;
}

function cssPath(el) {
  try {
    if (!(el instanceof Element)) return '';
    const path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        selector += `#${el.id}`;
        path.unshift(selector);
        break;
      } else {
        let sib = el;
        let nth = 1;
        while ((sib = sib.previousElementSibling)) {
          if (sib.nodeName.toLowerCase() === selector) nth++;
        }
        selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(' > ');
  } catch { return ''; }
}

/**
 * Extract Fintel metrics from page text and DOM elements
 * @param {string} text - Raw page text
 * @returns {Object|null} Parsed data or null
 */
function extractFintelMetrics(text) {
  try {
    const result = {};
    
    // Extract data from specific selectors and patterns
    const extractedData = {
      ...extractBasicMetrics(text),
      ...extractFromSpecificTables(),
      ...extractLastUpdate(),
      ...extractFinraExemptVolume(text)
    };
    
    // Merge all extracted data
    Object.assign(result, extractedData);
    
    // Add metadata
    if (Object.keys(result).length > 0) {
      result.lastUpdated = Date.now();
      result.source = 'fintel.io';
      result.extractedAt = new Date().toISOString();
    }
    
    return Object.keys(result).length > 0 ? result : null;
    
  } catch (error) {
    console.error('❌ Error parsing Fintel metrics:', error);
    return null;
  }
}

/**
 * Extract basic metrics using text patterns
 * @param {string} text - Page text
 * @returns {Object} Extracted basic metrics
 */
function extractBasicMetrics(text) {
  const result = {};
  
  // Enhanced patterns for all required fields
  const patterns = [
    // Short Interest patterns - focus on share counts, not percentages
    { 
      field: 'shortInterest', 
      patterns: [
        /Short\s+Interest[:\s]*([0-9.,]+[KMB]?\s*shares)/i,
        /Short\s+Interest\s+Shares[:\s]*([0-9.,]+[KMB]?)/i,
        /Shares\s+Short[:\s]*([0-9.,]+[KMB]?)/i,
        /Short\s+Interest[:\s]*([0-9.,]+[KMB])(?!\s*%)/i
      ]
    },
    
    // Short Interest Ratio patterns
    { 
      field: 'shortInterestRatio', 
      patterns: [
        /Short\s+Interest\s+Ratio[:\s]*([0-9.,]+\s*days?)/i,
        /Short\s+Ratio[:\s]*([0-9.,]+\s*days?)/i,
        /Days\s+to\s+Cover[:\s]*([0-9.,]+\s*days?)/i
      ]
    },
    
    // Short Interest % Float patterns  
    { 
      field: 'shortInterestPercentFloat', 
      patterns: [
        /Short\s+Interest\s+%\s+Float[:\s]*([0-9.,]+%?)/i,
        /Short\s+Interest\s+%\s+of\s+Float[:\s]*([0-9.,]+%?)/i,
        /Short\s+%\s+Float[:\s]*([0-9.,]+%?)/i
      ]
    },
    
    // Cost to Borrow patterns
    { 
      field: 'costToBorrow', 
      patterns: [
        /Cost\s+to\s+Borrow[:\s]*([0-9.,]+%)/i,
        /Borrow\s+Rate[:\s]*([0-9.,]+%)/i,
        /CTB[:\s]*([0-9.,]+%)/i,
        /Borrow\s+Fee[:\s]*([0-9.,]+%)/i
      ]
    },
    
    // FINRA Exempt Volume patterns
    { 
      field: 'finraExemptVolume', 
      patterns: [
        /FINRA\s+Exempt\s+Volume[:\s]*([0-9.,]+[KMB]?)/i,
        /Exempt\s+Volume[:\s]*([0-9.,]+[KMB]?)/i,
        /Short\s+Exempt\s+Volume[:\s]*([0-9.,]+[KMB]?)/i
      ]
    }
  ];
  
  // Try each pattern group
  patterns.forEach(({ field, patterns: fieldPatterns }) => {
    for (const pattern of fieldPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        result[field] = cleanValue(match[1]);
        console.log(`✅ Found ${field}: ${result[field]}`);
        break;
      }
    }
  });
  
  return result;
}

/**
 * Extract data from specific table selectors
 * @returns {Object} Extracted table data
 */
function extractFromSpecificTables() {
  const result = {};
  
  try {
    // Whitelist of allowed table IDs
    const allowedIds = [
      'short-shares-availability-table',
      'table-short-borrow-rate',
      'fails-to-deliver-table',
      'short-sale-volume-finra-table',
      'short-interest-daily-nasdaq-table',
      'short-interest-nasdaq-table'
    ];

    // Extract from #short-shares-availability-table (recent 3 rows only)
    const shortSharesTable = document.querySelector('#short-shares-availability-table');
    if (shortSharesTable) {
      result.shortSharesAvailabilityTable = extractShortSharesAvailabilityData(shortSharesTable);
      console.log('✅ Extracted short shares availability table data (recent 3 rows)');
    }

    // Extract from #table-short-borrow-rate
    const borrowRateTable = document.querySelector('#table-short-borrow-rate');
    if (borrowRateTable) {
      result.shortBorrowRateTable = extractTableData(borrowRateTable, 'Short Borrow Rate');
      console.log('✅ Extracted short borrow rate table data');
    }

    // Extract from #fails-to-deliver-table
    const ftdTable = document.querySelector('#fails-to-deliver-table');
    if (ftdTable) {
      result.failsToDeliverTable = extractTableData(ftdTable, 'Fails to Deliver');
      console.log('✅ Extracted fails to deliver table data');
    }

    // Extract allowed short sale volume and NASDAQ short interest tables
    const finraVol = document.querySelector('#short-sale-volume-finra-table');
    if (finraVol) {
      result.shortSaleVolumeFinraTable = extractTableData(finraVol, 'Short Sale Volume (FINRA)');
      console.log('✅ Extracted FINRA short sale volume table');
    }

    // Note: We still capture NASDAQ short interest tables via structured crawl,
    // but we don't inject them into named result fields here (hidden from summary/UI).
  
  } catch (error) {
    console.error('❌ Error extracting from specific tables:', error);
  }
  
  return result;
}

/**
 * Extract table data with dates and values
 * @param {Element} table - Table element
 * @param {string} tableName - Name for logging
 * @returns {Array} Array of row data with dates
 */
function extractTableData(table, tableName) {
  const rows = [];
  
  try {
    const tableRows = table.querySelectorAll('tr');
    const headers = [];
    
    tableRows.forEach((row, index) => {
      const cells = row.querySelectorAll('td, th');
      const rowData = {};
      
      if (index === 0) {
        // Header row
        cells.forEach(cell => {
          headers.push(cell.textContent.trim());
        });
      } else {
        // Data row
        cells.forEach((cell, cellIndex) => {
          const header = headers[cellIndex] || `col_${cellIndex}`;
          const value = cell.textContent.trim();
          if (value) {
            rowData[header] = value;
          }
        });
        
        if (Object.keys(rowData).length > 0) {
          // Try to identify date column
          const dateField = Object.keys(rowData).find(key => 
            key.toLowerCase().includes('date') || 
            /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/.test(rowData[key])
          );
          
          if (dateField) {
            rowData.date = rowData[dateField];
          }
          
          rows.push(rowData);
        }
      }
    });
    
    console.log(`📊 Extracted ${rows.length} rows from ${tableName} table`);
    
  } catch (error) {
    console.error(`❌ Error extracting ${tableName} table:`, error);
  }
  
  return rows;
}

/**
 * Extract Short Shares Availability data - only recent 3 rows with specific columns
 * @param {Element} table - The table element
 * @returns {Array} Array of recent 3 rows with Time Since Last Change and Short Shares Availability
 */
function extractShortSharesAvailabilityData(table) {
  const rows = [];
  
  try {
    const tableRows = table.querySelectorAll('tr');
    const headers = [];
    let timeSinceColumnIndex = -1;
    let sharesAvailableColumnIndex = -1;
    
    console.log(`🔍 Processing Short Shares Availability table with ${tableRows.length} rows`);
    
    tableRows.forEach((row, index) => {
      const cells = row.querySelectorAll('td, th');
      
      if (index === 0) {
        // Header row - find the columns we need
        cells.forEach((cell, cellIndex) => {
          const headerText = cell.textContent.trim();
          headers.push(headerText);
          
          // Look for "Time Since Last Change" column
          if (headerText.toLowerCase().includes('time since') || 
              headerText.toLowerCase().includes('last change')) {
            timeSinceColumnIndex = cellIndex;
            console.log(`✅ Found "Time Since Last Change" column at index ${cellIndex}`);
          }
          
          // Look for "Short Shares Availability" column
          if (headerText.toLowerCase().includes('short shares') || 
              headerText.toLowerCase().includes('availability')) {
            sharesAvailableColumnIndex = cellIndex;
            console.log(`✅ Found "Short Shares Availability" column at index ${cellIndex}`);
          }
        });
      } else {
        // Data row
        const rowData = {};
        let hasValidData = false;
        
        cells.forEach((cell, cellIndex) => {
          const value = cell.textContent.trim();
          
          // Only store the columns we care about
          if (cellIndex === timeSinceColumnIndex && value) {
            rowData.timeSinceLastChange = value;
            hasValidData = true;
          }
          
          if (cellIndex === sharesAvailableColumnIndex && value) {
            rowData.shortSharesAvailability = value;
            hasValidData = true;
          }
        });
        
        if (hasValidData) {
          console.log(`📊 Row ${index}: Time Since: "${rowData.timeSinceLastChange}", Shares: "${rowData.shortSharesAvailability}"`);
          rows.push(rowData);
        }
      }
    });
    
    // Only keep the most recent 3 rows
    const recentRows = rows.slice(0, 3);
    console.log(`✅ Extracted ${recentRows.length} recent rows from Short Shares Availability table`);
    
    return recentRows;
    
  } catch (error) {
    console.error('❌ Error extracting Short Shares Availability data:', error);
    return [];
  }
}

/**
 * Extract "Last Update" information
 * @returns {Object} Last update data
 */
function extractLastUpdate() {
  const result = {};
  
  try {
    // Look for "Last Update" text patterns
    const pageText = document.body.textContent || '';
    const updatePatterns = [
      /Last\s+Update[:\s]*([^.\n]+)/i,
      /Updated[:\s]*([^.\n]+)/i,
      /As\s+of[:\s]*([^.\n]+)/i,
      /Data\s+as\s+of[:\s]*([^.\n]+)/i
    ];
    
    for (const pattern of updatePatterns) {
      const match = pageText.match(pattern);
      if (match && match[1]) {
        result.lastDataUpdate = cleanValue(match[1]);
        console.log(`✅ Found last update: ${result.lastDataUpdate}`);
        break;
      }
    }
    
    // Also look for update info in specific elements
    const updateElements = document.querySelectorAll('[class*="update"], [class*="timestamp"], [id*="update"]');
    updateElements.forEach(element => {
      const text = element.textContent.trim();
      if (text && (text.toLowerCase().includes('update') || text.toLowerCase().includes('as of'))) {
        if (!result.lastDataUpdate) {
          result.lastDataUpdate = cleanValue(text);
          console.log(`✅ Found last update in element: ${result.lastDataUpdate}`);
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error extracting last update:', error);
  }
  
  return result;
}

/**
 * Extract FINRA Exempt Volume with enhanced detection
 * @param {string} text - Page text  
 * @returns {Object} FINRA exempt volume data
 */
function extractFinraExemptVolume(text) {
  const result = {};
  
  try {
    // Look for FINRA exempt volume in various formats
    const finraPatterns = [
      /FINRA\s+Exempt\s+Volume[:\s]*([0-9.,]+[KMB]?)/i,
      /Exempt\s+Volume[:\s]*([0-9.,]+[KMB]?)/i,
      /Short\s+Exempt[:\s]*([0-9.,]+[KMB]?)/i,
      /Regulation\s+SHO\s+Exempt[:\s]*([0-9.,]+[KMB]?)/i
    ];
    
    for (const pattern of finraPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        result.finraExemptVolume = cleanValue(match[1]);
        console.log(`✅ Found FINRA exempt volume: ${result.finraExemptVolume}`);
        break;
      }
    }
    
    // Also check for FINRA exempt volume in tables
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
      const text = table.textContent.toLowerCase();
      if (text.includes('finra') && text.includes('exempt')) {
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
          const cells = row.querySelectorAll('td, th');
          if (cells.length >= 2) {
            const label = cells[0].textContent.toLowerCase().trim();
            const value = cells[1].textContent.trim();
            
            if (label.includes('finra') && label.includes('exempt') && value && !result.finraExemptVolume) {
              result.finraExemptVolume = cleanValue(value);
              console.log(`✅ Found FINRA exempt volume in table: ${result.finraExemptVolume}`);
            }
          }
        });
      }
    });
    
  } catch (error) {
    console.error('❌ Error extracting FINRA exempt volume:', error);
  }
  
  return result;
}

/**
 * Extract data from HTML tables on the page (legacy function, now supplemented by extractFromSpecificTables)
 * @returns {Object|null} Extracted table data or null
 */
function extractFromTables() {
  try {
    const result = {};
    
    // Look for tables with specific patterns
    const tables = document.querySelectorAll('table');
    
    tables.forEach(table => {
      const rows = table.querySelectorAll('tr');
      
      rows.forEach(row => {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const label = cells[0].textContent?.trim().toLowerCase() || '';
          const value = cells[1].textContent?.trim() || '';
          
          // Enhanced label mappings for all required fields
          const labelMappings = {
            'short interest': 'shortInterest',
            'short interest %': 'shortInterest', 
            'short interest ratio': 'shortInterestRatio',
            'short ratio': 'shortInterestRatio',
            'days to cover': 'shortInterestRatio',
            'short interest % float': 'shortInterestPercentFloat',
            'short interest % of float': 'shortInterestPercentFloat',
            'short % float': 'shortInterestPercentFloat',
            'cost to borrow': 'costToBorrow',
            'borrow rate': 'costToBorrow',
            'borrow fee': 'costToBorrow',
            'ctb': 'costToBorrow',
            'failure to deliver': 'failureToDeliver',
            'ftd': 'failureToDeliver',
            'fails to deliver': 'failureToDeliver',
            'short shares available': 'shortSharesAvailable',
            'shares available': 'shortSharesAvailable',
            'available shares': 'shortSharesAvailable',
            'short-exempt volume': 'shortExemptVolume',
            'exempt volume': 'shortExemptVolume',
            'finra exempt volume': 'finraExemptVolume',
            'regulation sho exempt': 'finraExemptVolume'
          };
          
          const field = labelMappings[label];
          if (field && value && !result[field]) {
            const cleaned = cleanValue(value);
            if (shouldKeepPair(field, label, cleaned)) {
              result[field] = cleaned;
              console.log(`✅ Found ${field} in table: ${result[field]}`);
            } else {
              console.log(`⚠️ Skipping non-value content for ${field}`);
            }
          }
        }
      });
    });
    
    return Object.keys(result).length > 0 ? result : null;
    
  } catch (error) {
    console.error('❌ Error extracting from tables:', error);
    return null;
  }
}

/**
 * Clean and standardize extracted values
 * @param {string} value - Raw extracted value
 * @returns {string} Cleaned value
 */
function cleanValue(value) {
  return value
    .trim()
    .replace(/[^\w\s.,%$-]/g, '') // Remove special chars except common ones
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Add green text highlighting to matching Fintel data elements
 * @param {string} ticker - Stock ticker
 * @param {Object} currentData - Currently extracted Fintel data
 */
async function addFintelGreenTextHighlighting() { return; }

/**
 * Add green text highlighting to Fintel data elements
 * @param {Element} container - Container element to search within
 * @param {string} field - Field name (shortInterest, costToBorrow, etc.)
 * @param {string} value - Current value to match
 */
function addFintelGreenTextToElement(container, field, value) {
  try {
    // Define search patterns for different Fintel fields
    const searchPatterns = {
      shortInterest: [
        /Short\s+Interest[:\s]*([0-9.,]+[KMB]?\s*shares)/i,
        /Short\s+Interest\s+Shares[:\s]*([0-9.,]+[KMB]?)/i,
        /Shares\s+Short[:\s]*([0-9.,]+[KMB]?)/i,
        /Short\s+Interest[:\s]*([0-9.,]+[KMB])(?!\s*%)/i
      ],
      shortInterestRatio: [
        /Short\s+Interest\s+Ratio[:\s]*([0-9.,]+\s*days?)/i,
        /Short\s+Ratio[:\s]*([0-9.,]+\s*days?)/i,
        /Days\s+to\s+Cover[:\s]*([0-9.,]+\s*days?)/i
      ],
      shortInterestPercentFloat: [
        /Short\s+Interest\s+%\s+Float[:\s]*([0-9.,]+%?)/i,
        /Short\s+Interest\s+%\s+of\s+Float[:\s]*([0-9.,]+%?)/i
      ],
      costToBorrow: [
        /Cost\s+to\s+Borrow[:\s]*([0-9.,]+%)/i,
        /Borrow\s+Rate[:\s]*([0-9.,]+%)/i,
        /CTB[:\s]*([0-9.,]+%)/i
      ],
      failureToDeliver: [
        /Failure\s+to\s+Deliver[:\s]*([0-9.,]+[KMB]?)/i,
        /Fails?\s+to\s+Deliver[:\s]*([0-9.,]+[KMB]?)/i,
        /FTD[:\s]*([0-9.,]+[KMB]?)/i
      ],
      shortSharesAvailable: [
        /Short\s+Shares\s+Available[:\s]*([0-9.,]+[KMB]?)/i,
        /Shares\s+Available[:\s]*([0-9.,]+[KMB]?)/i
      ],
      shortExemptVolume: [
        /Short[- ]Exempt\s+Volume[:\s]*([0-9.,]+[KMB]?)/i,
        /Exempt\s+Volume[:\s]*([0-9.,]+[KMB]?)/i
      ],
      finraExemptVolume: [
        /FINRA\s+Exempt\s+Volume[:\s]*([0-9.,]+[KMB]?)/i,
        /Regulation\s+SHO\s+Exempt[:\s]*([0-9.,]+[KMB]?)/i
      ]
    };
    
    const patterns = searchPatterns[field];
    if (!patterns) return;
    
    // Find text nodes that contain any of the patterns
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      const text = node.nodeValue;
      
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          const parent = node.parentElement;
          
          // Check if green styling already exists for this field
          if (parent && !parent.hasAttribute(`data-qse-green-${field}`)) {
            // Try to find and highlight the label part instead of the value
            const labelHighlighted = highlightFintelLabel(parent, field, value, text);
            
            if (!labelHighlighted) {
              // Fallback: Apply green text styling to the parent element
              parent.style.color = 'rgb(34, 197, 94) !important';
              parent.style.fontWeight = '500';
              parent.setAttribute(`data-qse-green-${field}`, 'true');
              parent.title = `${field} matches extension storage: ${value}`;
              console.log(`🟢 Added Fintel green text (fallback) for ${field}: ${value} to element: "${text.trim()}"`);
            }
            
            return; // Exit after applying green styling
          } else if (parent?.hasAttribute(`data-qse-green-${field}`)) {
            console.log(`⚠️ Fintel green text already applied for ${field}`);
          }
        }
      }
    }
    
  } catch (error) {
    console.error(`❌ Error adding Fintel green text for ${field}:`, error);
  }
}

/**
 * Highlight the label portion of Fintel data elements
 * @param {Element} parentElement - The parent element containing the text
 * @param {string} field - Field name (shortInterest, costToBorrow, etc.)
 * @param {string} value - Current value
 * @param {string} text - The text content to search within
 * @returns {boolean} True if label was highlighted, false otherwise
 */
function highlightFintelLabel(parentElement, field, value, text) {
  try {
    // Define label patterns for different Fintel fields
    const labelPatterns = {
      shortInterest: [
        /Short\s+Interest(?=[:\s])/i,
        /Shares\s+Short(?=[:\s])/i
      ],
      shortInterestRatio: [
        /Short\s+Interest\s+Ratio(?=[:\s])/i,
        /Short\s+Ratio(?=[:\s])/i,
        /Days\s+to\s+Cover(?=[:\s])/i
      ],
      shortInterestPercentFloat: [
        /Short\s+Interest\s+%\s+Float(?=[:\s])/i,
        /Short\s+Interest\s+%\s+of\s+Float(?=[:\s])/i
      ],
      costToBorrow: [
        /Cost\s+to\s+Borrow(?=[:\s])/i,
        /Borrow\s+Rate(?=[:\s])/i
      ],
      failureToDeliver: [
        /Failure\s+to\s+Deliver(?=[:\s])/i,
        /Fails\s+to\s+Deliver(?=[:\s])/i
      ],
      utilization: [
        /Utilization(?=[:\s])/i
      ]
    };
    
    const patterns = labelPatterns[field];
    if (!patterns) {
      console.log(`❌ No label patterns defined for Fintel field: ${field}`);
      return false;
    }
    
    // Check if the text contains the value (confirming this is the right element)
    if (!text.includes(value)) {
      return false;
    }
    
    // Try to find and highlight just the label portion
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        // If the parent element text is short, highlight the whole element
        if (parentElement.textContent.length < 100) {
          // Look for a more specific child element containing just the label
          const labelElement = findLabelOnlyElement(parentElement, pattern);
          
          if (labelElement) {
            labelElement.style.color = 'rgb(34, 197, 94) !important';
            labelElement.style.fontWeight = '500';
            labelElement.setAttribute(`data-qse-green-${field}`, 'true');
            labelElement.title = `${field} matches extension storage: ${value}`;
            console.log(`🟢 Added Fintel green text to label for ${field}`);
            return true;
          }
        }
        
        // Fallback: Create a span around the label text
        return createLabelSpan(parentElement, pattern, field, value);
      }
    }
    
    return false;
    
  } catch (error) {
    console.error(`❌ Error highlighting Fintel label for ${field}:`, error);
    return false;
  }
}

/**
 * Find a child element that contains only the label (not the value)
 * @param {Element} parentElement - The parent element
 * @param {RegExp} labelPattern - The label pattern to match
 * @returns {Element|null} The label-only element or null
 */
function findLabelOnlyElement(parentElement, labelPattern) {
  const children = Array.from(parentElement.children);
  
  for (const child of children) {
    const childText = child.textContent.trim();
    
    // If child contains label but is short and doesn't contain numbers, it's likely just the label
    if (labelPattern.test(childText) && childText.length < 50 && !/\d+/.test(childText)) {
      return child;
    }
  }
  
  return null;
}

/**
 * Create a span around just the label text
 * @param {Element} parentElement - The parent element
 * @param {RegExp} labelPattern - The label pattern to match
 * @param {string} field - Field name
 * @param {string} value - Field value
 * @returns {boolean} True if span was created successfully
 */
function createLabelSpan(parentElement, labelPattern, field, value) {
  try {
    // Find text nodes containing the label
    const walker = document.createTreeWalker(
      parentElement,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      const text = node.nodeValue;
      const match = text.match(labelPattern);
      
      if (match) {
        const labelText = match[0];
        const labelIndex = text.indexOf(labelText);
        
        // Split the text into parts
        const beforeLabel = text.substring(0, labelIndex);
        const label = text.substring(labelIndex, labelIndex + labelText.length);
        const afterLabel = text.substring(labelIndex + labelText.length);
        
        // Create new elements
        const beforeNode = document.createTextNode(beforeLabel);
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        labelSpan.style.color = 'rgb(34, 197, 94) !important';
        labelSpan.style.fontWeight = '500';
        labelSpan.setAttribute(`data-qse-green-${field}`, 'true');
        labelSpan.title = `${field} matches extension storage: ${value}`;
        const afterNode = document.createTextNode(afterLabel);
        
        // Replace the original text node
        const parent = node.parentNode;
        parent.insertBefore(beforeNode, node);
        parent.insertBefore(labelSpan, node);
        parent.insertBefore(afterNode, node);
        parent.removeChild(node);
        
        console.log(`🟢 Created label span for Fintel ${field}: "${labelText}"`);
        return true;
      }
    }
    
    return false;
    
  } catch (error) {
    console.error(`❌ Error creating label span for ${field}:`, error);
    return false;
  }
}

/**
 * Add green text highlighting to table headers and cells
 * @param {string} tableType - Type of table (short-shares-availability, etc.)
 */
function addGreenTextToTable(tableType) {
  try {
    const tableSelectors = [
      `#${tableType}-table`,
      `#table-${tableType}`,
      `table[class*="${tableType}"]`,
      `table[id*="${tableType}"]`
    ];
    
    for (const selector of tableSelectors) {
      const table = document.querySelector(selector);
      if (table) {
        // Check if green styling already applied
        if (!table.hasAttribute('data-qse-green-table')) {
          // Apply green styling to the entire table
          table.style.borderColor = '#22c55e';
          table.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.2)';
          table.setAttribute('data-qse-green-table', 'true');
          table.title = 'Table data matches extension storage';
          
          // Style table headers
          const headers = table.querySelectorAll('th, thead tr td');
          headers.forEach(header => {
            header.style.color = '#22c55e';
            header.style.fontWeight = 'bold';
            header.style.borderBottomColor = '#22c55e';
          });
          
          // Style first column (usually contains labels/dates)
          const firstColumnCells = table.querySelectorAll('tr td:first-child');
          firstColumnCells.forEach(cell => {
            cell.style.color = '#16a34a';
            cell.style.fontWeight = '600';
          });
          
          console.log(`🟢 Added green text styling to ${tableType} table`);
          break;
        } else {
          console.log(`⚠️ Green text styling already applied to ${tableType} table`);
        }
      }
    }
    
  } catch (error) {
    console.error(`❌ Error adding green text to ${tableType} table:`, error);
  }
}

/**
 * Store Fintel data only if it has changed, merging with existing ticker data
 * @param {string} ticker - Stock ticker
 * @param {Object} newFintelData - New Fintel data
 */
async function storeFintelDataIfChanged(ticker, newFintelData) {
  try {
    // Check if chrome.storage is available
    if (!chrome || !chrome.storage) {
      console.error('❌ Chrome storage API not available');
      return;
    }

    // Get existing ticker data
    const result = await chrome.storage.local.get(`ticker_${ticker}`);
    let existingData = result[`ticker_${ticker}`] || {};
    
    // Check if Fintel data has changed - expanded field list
    const fintelFields = [
      'shortInterest',
      'shortInterestRatio', 
      'shortInterestPercentFloat',
      'costToBorrow',
      'failureToDeliver',
      'shortSharesAvailable',
      'shortExemptVolume',
      'finraExemptVolume',
      'lastDataUpdate',
      'shortSharesAvailabilityTable',
      'shortBorrowRateTable', 
      'failsToDeliverTable'
    ];
    
    let hasChanges = false;
    const changes = [];
    
    for (const field of fintelFields) {
      const oldValue = existingData[field];
      const newValue = newFintelData[field];
      
      // For table data, do a deeper comparison
      if (field.includes('Table') && Array.isArray(oldValue) && Array.isArray(newValue)) {
        const oldJSON = JSON.stringify(oldValue);
        const newJSON = JSON.stringify(newValue);
        if (oldJSON !== newJSON) {
          hasChanges = true;
          changes.push({ field, oldValue: `${oldValue.length} rows`, newValue: `${newValue.length} rows` });
        }
      } else if (oldValue !== newValue) {
        hasChanges = true;
        changes.push({ field, oldValue, newValue });
      }
    }
    
    if (!hasChanges) {
      console.log(`💾 Fintel data unchanged for ${ticker}, skipping storage`);
      return;
    }
    
    console.log(`🔄 Fintel data changed for ${ticker}:`);
    changes.forEach(({ field, oldValue, newValue }) => {
      console.log(`   ${field}: ${oldValue} → ${newValue}`);
    });
    
    // Merge new Fintel data with existing data
    const updatedData = {
      ...existingData,
      ...newFintelData,
      lastUpdated: Date.now() // Update timestamp
    };
    
    // Store updated data
    const storageKey = `ticker_${ticker}`;
    await chrome.storage.local.set({
      [storageKey]: updatedData
    });
    
    console.log(`💾 Stored merged data for ${ticker}:`, updatedData);
    
    // Also update the general ticker list
    const tickerListResult = await chrome.storage.local.get('ticker_list');
    const tickerList = tickerListResult.ticker_list || [];
    
    if (!tickerList.includes(ticker)) {
      tickerList.push(ticker);
      await chrome.storage.local.set({ ticker_list: tickerList });
      console.log(`📝 Added ${ticker} to ticker list`);
    }
    
  } catch (error) {
    console.error('❌ Error storing Fintel data:', error);
  }
}
