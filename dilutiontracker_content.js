/**
 * @file
 * dilutiontracker_content.js
 * 
 * Content script for dilutiontracker.com pages
 * Extracts Float & OS data from company pages and stores in extension storage
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

// Prevent multiple executions
if (window.qseDilutionTrackerLoaded) {
  console.log('🔍 DilutionTracker content script already loaded, skipping');
} else {
  window.qseDilutionTrackerLoaded = true;
  console.log('🔍 DilutionTracker content script loaded');

  // Function to check and handle ticker page URLs
  function checkAndHandleTickerPage() {
    const currentUrl = window.location.href;
    console.log(`🔍 DilutionTracker: Checking URL: ${currentUrl}`);
    
    // Match pattern: /app/search/TICKER with optional query params (?a=) or fragments (#)
    const tickerMatch = currentUrl.match(/\/app\/search\/([A-Z]{1,5})(?:[/?#]|$)/i);

    if (tickerMatch) {
      const ticker = tickerMatch[1].toUpperCase();
      console.log(`📊 Detected ticker page: ${ticker} (from URL: ${currentUrl})`);
      
      // Store the current ticker for comparison
      if (window.qseCurrentTicker !== ticker) {
        window.qseCurrentTicker = ticker;
        
        // Wait for page to load and extract data
        setTimeout(() => {
          extractTickerData(ticker);
          // Also run generic page crawler storing all label/value + tables
          setTimeout(() => crawlAndStoreStructuredPageDataDT(ticker), 800);
        }, 2000); // Wait 2 seconds for dynamic content
        
        // Set up observer for dynamic content changes if not already set
        if (!window.qseMutationObserver) {
          const observer = new MutationObserver((mutations) => {
            // Only trigger if there are significant changes (not just our highlighting)
            const hasSignificantChanges = mutations.some(mutation => {
              // Skip mutations caused by our own highlighting
              if (mutation.target.classList && (
                mutation.target.classList.contains('qse-verified-label') ||
                mutation.target.classList.contains('qse-verified-value')
              )) {
                return false;
              }
              
              // Check for significant content changes
              return mutation.type === 'childList' && 
                     mutation.addedNodes.length > 0 &&
                     Array.from(mutation.addedNodes).some(node => 
                       node.nodeType === Node.ELEMENT_NODE && 
                       node.tagName !== 'SPAN' // Ignore our span additions
                     );
            });
            
            if (hasSignificantChanges && window.qseCurrentTicker) {
              console.log('🔍 Significant DOM changes detected, re-extracting data');
              // Add delay to prevent rapid re-execution
              clearTimeout(window.qseExtractionTimeout);
              window.qseExtractionTimeout = setTimeout(() => {
                extractTickerData(window.qseCurrentTicker);
                // Debounced crawl on DOM changes
                clearTimeout(window.__qseDTCrawlTimer);
                window.__qseDTCrawlTimer = setTimeout(() => crawlAndStoreStructuredPageDataDT(window.qseCurrentTicker), 700);
              }, 1000);
            }
          });
          
          observer.observe(document.body, {
            childList: true,
            subtree: true
          });
          
          window.qseMutationObserver = observer;
          console.log(`🔍 Set up mutation observer for dynamic content changes`);
        }
      }
    } else {
      // Not a ticker page, clear current ticker
      window.qseCurrentTicker = null;
      console.log(`🔍 Not a ticker page: ${currentUrl}`);
    }
  }

  // Check initial page load
  checkAndHandleTickerPage();

  // Listen for URL changes (for single-page app navigation)
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      console.log(`🔍 DilutionTracker: URL changed to: ${currentUrl}`);
      setTimeout(() => {
        checkAndHandleTickerPage();
      }, 100); // Small delay to let page settle
    }
  }).observe(document, { subtree: true, childList: true });

  // Also listen for popstate events (back/forward navigation)
  window.addEventListener('popstate', () => {
    console.log(`🔍 DilutionTracker: Popstate event detected`);
    setTimeout(() => {
      checkAndHandleTickerPage();
    }, 100);
  });

  // Expose debugging functions to window for manual testing
  window.qseDebug = {
    extractTickerData: extractTickerData,
    addVerificationIcons: addVerificationIcons,
    checkUrl: checkAndHandleTickerPage,
    testPattern: (url) => {
      const pattern = /\/app\/search\/([A-Z]{1,5})(?:[/?#]|$)/i;
      const match = url.match(pattern);
      return match ? match[1] : null;
    }
  };
  
  console.log('🔧 DilutionTracker: Debug functions exposed at window.qseDebug');
}

/**
 * Extract float and shares outstanding data from the page
 * @param {string} ticker - Stock ticker symbol
 */
async function extractTickerData(ticker) {
  try {
    // Prevent concurrent executions
    if (window.qseExtracting) {
      console.log('🔍 Data extraction already in progress, skipping');
      return;
    }
    
    window.qseExtracting = true;
    console.log(`🔍 Extracting data for ${ticker}...`);
    console.log(`🔍 Current URL: ${window.location.href}`);
    console.log(`🔍 Page title: ${document.title}`);
    console.log(`🔍 Page loaded: ${document.readyState}`);
    
    // Find the float wrapper div
    const floatWrapper = document.getElementById('company-description-float-wrapper');
    
    if (!floatWrapper) {
      console.log('❌ Float wrapper not found');
      return;
    }
    
    console.log('✅ Found float wrapper');
    
    // Check if user is logged in (no login link present)
    const loginLink = floatWrapper.querySelector('a[href*="login"]');
    if (loginLink) {
      console.log('⚠️ User not logged in - login link detected');
      return;
    }
    
    // Extract Float & OS text content
    const floatText = floatWrapper.textContent || '';
    console.log('📄 Float wrapper text:', floatText);
    
    // Extract estimated cash from the page
    const estimatedCash = extractEstimatedCash();
    console.log('💰 Estimated cash:', estimatedCash);
    
    // Extract additional company data
    const companyData = extractCompanyData();
    console.log('🏢 Company data extracted:', companyData);
    
    if (companyData && Object.keys(companyData).length > 0) {
      console.log('✅ Company fields found:', Object.keys(companyData));
      Object.keys(companyData).forEach(key => {
        console.log(`   ${key}: "${companyData[key]}"`);
      });
    } else {
      console.log('❌ No company data extracted');
    }
    
    // Extract price change data
    const priceData = extractPriceData();
    console.log('📈 Price data:', priceData);
    
    // Parse float and shares outstanding values (initial regex)
    const floatData = parseFloatData(floatText);
    
    // Combine all data
    if (floatData) {
      if (estimatedCash) floatData.estimatedCash = estimatedCash;
      if (companyData) Object.assign(floatData, companyData);
      if (priceData) Object.assign(floatData, priceData);

      // Strong override using DOM structure: #company-description-float-wrapper
      const fo = parseFloatAndOSFromWrapper(document);
      if (fo) {
        if (typeof fo.floatM === 'number') floatData.latestFloat = fo.floatM;
        if (typeof fo.sharesM === 'number') floatData.sharesOutstanding = fo.sharesM;
      }
    }
    
    if (floatData) {
      console.log('📊 Parsed data:', floatData);
      
      // Add checkmark icons for verified data (with slight delay to ensure DOM is ready)
      setTimeout(() => {
        addVerificationIcons(ticker, floatData);
      }, 500);
      
      // Prepare storage-safe copy: store Float/OS with unit suffix (M/B)
      const storeReady = { ...floatData };
      if (typeof storeReady.latestFloat === 'number') {
        storeReady.latestFloat = formatMillionsToUnitString(storeReady.latestFloat);
      }
      if (typeof storeReady.sharesOutstanding === 'number') {
        storeReady.sharesOutstanding = formatMillionsToUnitString(storeReady.sharesOutstanding);
      }
      // Check if data has changed before storing
      await storeTickerDataIfChanged(ticker, storeReady);
    } else {
      console.log('❌ Could not parse float data from text');
    }
    
  } catch (error) {
    console.error('❌ Error extracting ticker data:', error);
  } finally {
    // Always clear the extraction flag
    window.qseExtracting = false;
  }

  // Finished extraction for ticker
}

/**
 * Crawl entire DilutionTracker page for label/value pairs and tables
 * and store structured JSON under the ticker in chrome.storage.local
 */
async function crawlAndStoreStructuredPageDataDT(ticker) {
  try {
    const data = buildStructuredPageDataGeneric();
    if (!data) return;

    data.meta = {
      url: location.href,
      title: document.title,
      crawledAt: new Date().toISOString(),
      host: 'dilutiontracker'
    };

    const storageKey = `ticker_${ticker}`;
    const current = await chrome.storage.local.get(storageKey);
    const existing = current[storageKey] || {};
    const pageCrawls = existing.pageCrawls || {};
    pageCrawls['dilutiontracker'] = data;

    const inferred = data.inferred || {};
    // Merge without clobbering authoritative numeric fields (latestFloat, sharesOutstanding)
    const merged = { ...existing, pageCrawls, lastUpdated: Date.now() };
    const protectedKeys = new Set(['latestFloat','sharesOutstanding']);
    Object.entries(inferred).forEach(([k,v]) => {
      if (protectedKeys.has(k)) {
        if (merged[k] == null) {
          // Convert unit string to millions if possible
          const pu = parseNumUnitDT(v);
          const unit = pu.unit || 'M';
          merged[k] = pu.num ? (unit === 'B' ? parseFloat(pu.num) * 1000 : unit === 'K' ? parseFloat(pu.num) / 1000 : parseFloat(pu.num)) : v;
        }
      } else {
        merged[k] = v;
      }
    });
    await chrome.storage.local.set({ [storageKey]: merged });
    console.log(`💾 Stored structured crawl for ${ticker} (dilutiontracker)`, data, merged);

    // Value highlighting removed by request
  } catch (e) {
    console.warn('crawlAndStoreStructuredPageDataDT error:', e);
  }
}

/**
 * Generic DOM-to-JSON builder (shared logic as in fintel crawler)
 */
function buildStructuredPageDataGeneric() {
  try {
    const values = {};
    const tables = [];

    function pushKV(label, value, source, el) {
      const key = canonicalKeyForLabelDT(label);
      if (!key) return;
      // Drop unwanted field names like Title
      if (key === 'title' || /^\s*title\s*$/i.test(String(label))) return;
      if (!values[key]) values[key] = [];
      const heading = findNearestHeadingDT(el);
      const cleanVal = sanitizeValueForStorageDT(String(value), key);
      if (!shouldKeepPairDT(key, String(label), cleanVal)) return;
      values[key].push({ label: String(label).trim(), value: cleanVal, rawValue: String(value), source, selector: cssPathDT(el), heading });
    }

    // Definition lists
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

    // Tables
    document.querySelectorAll('table').forEach(table => {
      const t = extractTableDT(table);
      if (t && t.rows && t.rows.length) tables.push(t);

      const rows = table.querySelectorAll('tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('th,td');
        if (cells.length >= 2) {
          const label = cells[0].textContent?.trim();
          const value = cells[1].textContent?.trim();
          if (label && value && isLikelyLabelDT(label)) pushKV(label, value, 'table', cells[1]);
        }
      });
    });

    // Inline label: value (support multiple pairs within one element)
    const blocks = document.querySelectorAll('p,li,div,section,span');
    blocks.forEach(el => {
      const text = (el.textContent || '').trim();
      if (!text) return;
      const pairs = extractInlinePairsDT(text);
      if (!pairs || !pairs.length) return;
      pairs.forEach(({ label, value }) => {
        // Special-case split: "Mkt Cap & EV: 20.4M / 83.1M"
        if (/^mkt\s*cap\s*&\s*ev$/i.test(label)) {
          const parts = String(value).split('/').map(s => s.trim());
          if (parts[0]) pushKV('Mkt Cap', parts[0], 'inline', el);
          if (parts[1]) pushKV('EV', parts[1], 'inline', el);
          return;
        }
        // Special-case split: "Float & OS: 1.96M / 2.57M"
        if (/^float\s*&\s*os$/i.test(label)) {
          const parts = String(value).split('/').map(s => s.trim());
          if (parts[0]) pushKV('Float', parts[0], 'inline', el);
          if (parts[1]) pushKV('OS', parts[1], 'inline', el);
          return;
        }
        if (isLikelyLabelDT(label) && value) pushKV(label, value, 'inline', el);
      });
    });

    // Infer canonical values
    const inferred = {};
    const preferKeys = [
      'float','sharesOutstanding','estimatedCash','marketCap','enterpriseValue',
      'sector','industry','country','exchange','institutionalOwnership','lastDataUpdate'
    ];
    for (const k of preferKeys) {
      if (values[k] && values[k].length) inferred[k] = transformFieldForStorageDT(k, values[k][0].value);
    }

    return { values, tables, inferred };
  } catch (e) {
    console.warn('buildStructuredPageDataGeneric error:', e);
    return null;
  }
}

function extractTableDT(table) {
  const headers = [];
  let headerRow = table.querySelector('thead tr') || table.querySelector('tr');
  if (headerRow) headerRow.querySelectorAll('th,td').forEach(h => headers.push(cleanTextDT(h.textContent)));
  const rows = [];
  const bodyRows = table.querySelectorAll('tbody tr');
  const dataRows = bodyRows.length ? bodyRows : table.querySelectorAll('tr');
  dataRows.forEach((row) => {
    if (row === headerRow) return;
    const cells = row.querySelectorAll('td,th');
    if (!cells.length) return;
    const obj = {};
    cells.forEach((cell, i) => {
      const key = headers[i] || `col_${i}`;
      obj[key] = cleanTextDT(cell.textContent);
    });
    // prune explanatory rows
    const pruned = {};
    Object.entries(obj).forEach(([h, v]) => {
      if (isUsefulTableCellDT(h, v)) pruned[h] = v;
    });
    if (Object.keys(pruned).length) rows.push(pruned);
  });
  const name = table.getAttribute('id') || table.getAttribute('aria-label') || table.getAttribute('data-name') || findNearestHeadingDT(table) || 'table';
  const key = normalizeKeyDT(name);
  return { key, name, id: table.id || null, class: table.className || null, headers, rows };
}

function canonicalKeyForLabelDT(label) {
  const raw = String(label).trim().toLowerCase();
  const map = {
    'float': 'float', 'free float': 'float',
    'shares outstanding': 'sharesOutstanding', 'outstanding shares': 'sharesOutstanding', 'os': 'sharesOutstanding',
    'estimated cash': 'estimatedCash', 'cash': 'estimatedCash',
    'est. net cash/sh': 'estimatedNetCashPerShare', 'est net cash/sh': 'estimatedNetCashPerShare', 'estimated net cash/sh': 'estimatedNetCashPerShare',
    'institutional ownership': 'institutionalOwnership', 'inst own': 'institutionalOwnership', 'inst': 'institutionalOwnership',
    'market cap': 'marketCap', 'mkt cap': 'marketCap',
    'enterprise value': 'enterpriseValue', 'ev': 'enterpriseValue',
    'sector': 'sector', 'industry': 'industry', 'country': 'country', 'exchange': 'exchange',
    'last update': 'lastDataUpdate', 'data as of': 'lastDataUpdate', 'as of': 'lastDataUpdate'
  };
  if (map[raw]) return map[raw];
  return normalizeKeyDT(raw);
}

function normalizeKeyDT(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ (\w)/g, (_, c) => c.toUpperCase());
}
function isLikelyLabelDT(s) { const t = String(s).trim(); if (!t) return false; if (/\d{2,}/.test(t)) return false; return /[A-Za-z]/.test(t) && t.length <= 48; }
function cleanTextDT(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function findNearestHeadingDT(el) {
  const headingSel = 'h1,h2,h3,h4,h5,h6';
  let cur = el;
  for (let i = 0; i < 5 && cur; i++) {
    let p = cur.previousElementSibling;
    while (p) { if (p.matches && p.matches(headingSel)) return cleanTextDT(p.textContent); p = p.previousElementSibling; }
    cur = cur.parentElement;
  }
  return null;
}
function cssPathDT(el) {
  try { if (!(el instanceof Element)) return ''; const path = []; while (el && el.nodeType === Node.ELEMENT_NODE) { let selector = el.nodeName.toLowerCase(); if (el.id) { selector += `#${el.id}`; path.unshift(selector); break; } else { let sib = el; let nth = 1; while ((sib = sib.previousElementSibling)) { if (sib.nodeName.toLowerCase() === selector) nth++; } selector += `:nth-of-type(${nth})`; } path.unshift(selector); el = el.parentNode; } return path.join(' > ');} catch { return ''; }
}

// Extract multiple label:value pairs from a single text, e.g. "Exchange: NASDAQ Mkt Cap & EV: 20.4M / 83.1M Float & OS: 1.96M / 2.57M"
function extractInlinePairsDT(text) {
  try {
    const pairs = [];
    const re = /([A-Za-z][A-Za-z0-9 .%/()&-]{1,40})\s*[:\-–—]\s*([^]|[^])+?/g; // we'll bound matches by lookahead check
    // We will iterate by finding label positions, then slicing value up to next label
    const labelRe = /([A-Za-z][A-Za-z0-9 .%/()&-]{1,40})\s*[:\-–—]\s*/g;
    let match;
    const indices = [];
    while ((match = labelRe.exec(text)) !== null) {
      indices.push({ idx: match.index, label: match[1], next: labelRe.lastIndex });
    }
    for (let i = 0; i < indices.length; i++) {
      const curr = indices[i];
      const nextStart = (i + 1 < indices.length) ? indices[i + 1].idx : text.length;
      const value = text.substring(curr.next, nextStart).trim();
      const label = curr.label.trim();
      if (label && value) pairs.push({ label, value });
    }
    return pairs;
  } catch { return []; }
}

// New: Highlight by values from crawled JSON
function highlightValuesFromStructuredDataDT(_pageData) { return; }

function highlightByPatternsDT() { return; }

function wrapMatchesInTextNodeDT() { return; }

function buildFlexiblePatternsForValueDT() { return []; }

function escapeRegexDT(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Sanitization and transforms (mirror Fintel helpers)
function sanitizeValueForStorageDT(val, key) {
  try {
    if (!val) return '';
    let s = String(val);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
    s = s.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
    if (key === 'description') return s.trim();
    s = s.replace(/\s+/g, ' ').trim();
    return normalizeFieldValueDT(key, s);
  } catch { return String(val).trim(); }
}

// Decide whether to keep a label/value pair
function shouldKeepPairDT(key, label, value) {
  if (!value) return false;
  const k = String(key).toLowerCase();
  if (k === 'title') return false;
  if (isBlacklistedKeyDT(k) || isBlacklistedKeyDT(label)) return false;
  const allowedTextKeys = new Set(['sector','industry','country','exchange','description','marketCap','enterpriseValue','institutionalOwnership','lastDataUpdate']);
  if (allowedTextKeys.has(k)) {
    if (k === 'description') return true;
    return !isLikelyExplanationTextDT(value);
  }
  return isValueLikeDT(value);
}

function isLikelyExplanationTextDT(s) {
  const v = String(s).trim();
  if (v.length > 140) return true;
  const sentences = v.split(/[.!?]/).filter(x => x.trim().length);
  if (sentences.length >= 2 && v.length > 80) return true;
  if (/\b(this\s+number|provided\s+by|that\s+were|number\s+of\s+short\s+shares|included\s+in)\b/i.test(v)) return true;
  return false;
}

function isValueLikeDT(s) {
  const v = String(s).trim();
  if (!v) return false;
  if (/\d/.test(v)) return true;
  if (/[%$]/.test(v)) return true;
  if (/\b(shares?|days?|volume|rate|float|borrow|exempt|deliver|ftd)\b/i.test(v)) return true;
  if (v.length <= 24 && /^[A-Za-z][A-Za-z &-]*$/.test(v)) return true;
  return false;
}

function isUsefulTableCellDT(header, value) {
  const h = String(header || '').toLowerCase();
  if (isBlacklistedKeyDT(h)) return false;
  if (/date|time|settlement|as of/.test(h)) return true;
  if (/label|description|notes?/.test(h)) return false;
  if (isLikelyExplanationTextDT(value)) return false;
  return isValueLikeDT(value);
}

function isBlacklistedKeyDT(name) {
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
    'values'
  ]);
  return set.has(norm);
}

function transformFieldForStorageDT(key, value) {
  if (key === 'shortInterest') {
    const n = parseShareCountDT(value);
    return Number.isFinite(n) ? n : value;
  }
  if (key === 'shortInterestPercentFloat') {
    const p = extractPercentDT(value);
    return p || value;
  }
  if (key === 'finraExemptVolume' || key === 'finraNonExemptVolume') {
    const v = extractSharesCountDT(value);
    return v || value;
  }
  return value;
}

function parseShareCountDT(input) {
  if (input == null) return NaN;
  let s = String(input).trim();
  s = s.replace(/shares?|shrs?/ig, '').trim();
  const m = s.match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!m) {
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

function normalizeFieldValueDT(key, value) {
  const k = String(key || '').toLowerCase();
  if (k === 'shortinterestpercentfloat') {
    const p = extractPercentDT(value);
    return p || value;
  }
  if (k === 'finraexemptvolume' || k === 'finranonexemptvolume') {
    const v = extractSharesCountDT(value);
    return v || value;
  }
  if (k === 'institutionalownership') {
    const p = extractPercentDT(value);
    return p || value;
  }
  if (k === 'marketcap' || k === 'enterprisevalue' || k === 'float' || k === 'sharesoutstanding') {
    const pu = parseNumUnitDT(value);
    const unit = pu.unit || 'M';
    return pu.num ? `${pu.num}${unit}` : value;
  }
  return value;
}

function extractPercentDT(s) {
  const m = String(s).match(/([\d.,]+)\s*%/);
  if (!m) return null;
  const num = m[1].replace(/\s/g, '');
  return `${num}%`;
}

function extractSharesCountDT(s) {
  const txt = String(s);
  const m = txt.match(/([\d.,]+)\s*([KMB])?\s*(shares?)?/i);
  if (!m) return null;
  let val = m[1].trim();
  if (m[2]) val = `${val}${m[2].toUpperCase()}`;
  if (m[3]) val = `${val} shares`;
  return val;
}

// Extract the first numeric+unit token like "1.96M", "2.57M", "20.4M", "83.1M"
function pickFirstUnitValue(s, units = ['K','M','B']) {
  const txt = String(s || '');
  const u = units.map(u => u.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
  const m = txt.match(new RegExp(`([0-9][0-9.,]*)\s*(?:${u})`, 'i'));
  if (!m) return null;
  const num = m[1].replace(/\s/g, '');
  const unitMatch = txt.slice(m.index + m[0].length - 1).match(/^[A-Za-z]/);
  // Better: pull the actual unit from the matched slice
  const unit = (m[0].match(new RegExp(`(${u})`, 'i')) || [])[1] || '';
  return `${num}${unit.toUpperCase()}`;
}

// Parse number and optional unit (K/M/B). Returns { num: '1.96', unit: 'M' | null }
function parseNumUnitDT(s) {
  const txt = String(s || '').trim();
  const m = txt.match(/([0-9][0-9.,]*)\s*([KMB])?/i);
  if (!m) return { num: null, unit: null };
  const num = (m[1] || '').replace(/\s+/g, '');
  const unit = m[2] ? m[2].toUpperCase() : null;
  return { num, unit };
}

/**
 * Extract company data (Sector, Industry, Country, Market Cap) from structured sections
 * @returns {Object|null} Company data or null
 */
function extractCompanyData() {
  try {
    const result = {};

    // Prefer the company description wrapper area to scope extraction
    const scope = document.getElementById('company-description-float-wrapper') || document.body;

    // Pull description from specific element if available
    const companyDescElement = document.getElementById('companyDesc');
    if (companyDescElement) {
      result.description = companyDescElement.textContent?.trim();
    }

    // Extract inline pairs within scope and split combined labels
    const blocks = scope.querySelectorAll('p,li,div,section,span');
    blocks.forEach(el => {
      const text = (el.textContent || '').trim();
      if (!text) return;
      const pairs = extractInlinePairsDT(text);
      if (!pairs || !pairs.length) return;

      pairs.forEach(({ label, value }) => {
        // Split pairs we know may contain two values
        if (/^mkt\s*cap\s*&\s*ev$/i.test(label)) {
          const parts = String(value).split('/').map(s => s.trim());
          const a = parseNumUnitDT(parts[0] || '');
          const b = parseNumUnitDT(parts[1] || '');
          const unitA = a.unit || 'M';
          const unitB = b.unit || unitA;
          if (a.num && !result.marketCap) result.marketCap = `${a.num}${unitA}`;
          if (b.num && !result.enterpriseValue) result.enterpriseValue = `${b.num}${unitB}`;
          return;
        }
        if (/^float\s*&\s*(os|shares\s*outstanding|outstanding\s*shares)\b/i.test(label)) {
          const parts = String(value).split('/').map(s => s.trim());
          const a = parseNumUnitDT(parts[0] || '');
          const b = parseNumUnitDT(parts[1] || '');
          const unitA = a.unit || 'M';
          const unitB = b.unit || unitA;
          if (a.num && !result.float) result.float = `${a.num}${unitA}`;
          if (b.num && !result.sharesOutstanding) result.sharesOutstanding = `${b.num}${unitB}`;
          return;
        }

        // Map label -> key and assign if not already present
        const key = canonicalKeyForLabelDT(label);
        if (!key) return;
        if (['exchange','sector','industry','country','institutionalOwnership','estimatedNetCashPerShare','marketCap','enterpriseValue','float','sharesOutstanding'].includes(key)) {
          let val = String(value).trim();
          if (key === 'institutionalOwnership') {
            const m = val.match(/([0-9][0-9.,]*)\s*%/);
            if (m) val = `${m[1]}%`; else return;
          }
          if (key === 'exchange') {
            if (!isGoodExchangeDT(val)) return;
          }
          if (key === 'marketCap' || key === 'enterpriseValue' || key === 'float' || key === 'sharesOutstanding') {
            const cleaned = pickFirstUnitValue(val, ['K','M','B']);
            if (cleaned) val = cleaned; else return;
          }
          if (!result[key]) result[key] = val;
        }
      });
    });

    return Object.keys(result).length ? result : null;

  } catch (error) {
    console.error('❌ Error extracting company data:', error);
    return null;
  }
}

/**
 * Extract price change data from header divs
 * @returns {Object|null} Price change data with styles or null
 */
function extractPriceData() {
  try {
    const result = {};
    
    // Extract regular market price change
    const regularMktDiv = document.getElementById('header-price-change-regular-mkt');
    if (regularMktDiv) {
      result.regularMarketChange = {
        text: regularMktDiv.textContent?.trim() || '',
        styles: getComputedStylesString(regularMktDiv)
      };
      console.log(`✅ Found regular market change: ${result.regularMarketChange.text}`);
    }
    
    // Extract extended market price change
    const extendedMktDiv = document.getElementById('header-price-change-extended-mkt');
    if (extendedMktDiv) {
      result.extendedMarketChange = {
        text: extendedMktDiv.textContent?.trim() || '',
        styles: getComputedStylesString(extendedMktDiv)
      };
      console.log(`✅ Found extended market change: ${result.extendedMarketChange.text}`);
    }
    
    return Object.keys(result).length > 0 ? result : null;
    
  } catch (error) {
    console.error('❌ Error extracting price data:', error);
    return null;
  }
}

/**
 * Get computed styles as a string for an element
 * @param {Element} element - DOM element
 * @returns {string} CSS styles string
 */
function getComputedStylesString(element) {
  const computedStyles = window.getComputedStyle(element);
  const importantStyles = [
    'color', 'background-color', 'font-size', 'font-weight', 
    'font-family', 'text-align', 'padding', 'margin', 'border'
  ];
  
  return importantStyles
    .map(prop => `${prop}: ${computedStyles.getPropertyValue(prop)}`)
    .filter(style => !style.includes('initial') && !style.includes('normal'))
    .join('; ');
}

/**
 * Extract estimated cash from the page content
 * @returns {number|null} Estimated cash in millions or null
 */
function extractEstimatedCash() {
  try {
    // Look for cash information in the page text
    const pageText = document.body.textContent || '';
    
    // Pattern to match: "estimated current cash of $22.9M" or "quarterly operating cash flow of $22.9M"
    const cashPatterns = [
      /estimated\s+current\s+cash\s+of\s+\$([0-9,.]+)\s*([MB])(?!\w)/i,
      /quarterly\s+operating\s+cash\s+flow\s+of\s+\$([0-9,.]+)\s*([MB])(?!\w)/i,
      /current\s+cash\s+of\s+\$([0-9,.]+)\s*([MB])(?!\w)/i,
      /cash\s+of\s+\$([0-9,.]+)\s*([MB])(?!\w)/i,
      /estimated\s+cash[:\s]+\$([0-9,.]+)\s*([MB])(?!\w)/i,
      /quarterly\s+cash\s+burn\s+of\s+-?\$[0-9,.]+[MB]\s+and\s+estimated\s+current\s+cash\s+of\s+\$([0-9,.]+)\s*([MB])(?!\w)/i
    ];
    
    for (let i = 0; i < cashPatterns.length; i++) {
      const pattern = cashPatterns[i];
      const match = pageText.match(pattern);
      if (match) {
        const rawNum = match[1].replace(/,/g, '').trim();
        const unit = match[2].toUpperCase(); // 'M' or 'B'
        const unitStr = `${rawNum}${unit}`;
        return unitStr; // Store with unit to avoid ambiguity
      }
    }
    
    console.log('❌ No cash information found');
    return null;
    
  } catch (error) {
    console.error('❌ Error extracting cash:', error);
    return null;
  }
}

/**
 * Parse float and shares outstanding from text content
 * @param {string} text - Raw text content
 * @param {string} ticker - Ticker symbol for logging
 * @returns {Object|null} Parsed data or null
 */
function parseFloatData(text) {
  try {
    // Common patterns for float data
    const patterns = [
      // "Float: 12.5M" or "Float: 12.5 M"
      /float[:\s]+([0-9,.]+)\s*([MB])/i,
      // "12.5M Float" 
      /([0-9,.]+)\s*([MB])\s+float/i,
      // "Float & OS: 12.5M / 25.0M"
      /float\s*&\s*os[:\s]+([0-9,.]+)\s*([MB])\s*\/\s*([0-9,.]+)\s*([MB])/i,
      // "Float 12.5M OS 25.0M"
      /float\s+([0-9,.]+)\s*([MB])\s+os\s+([0-9,.]+)\s*([MB])/i
    ];
    
    let latestFloat = null;
    let sharesOutstanding = null;
    
    // Try each pattern
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        console.log(`✅ Pattern matched: ${pattern}`, match);
        
        // Parse based on pattern
        if (match.length >= 3) {
          // Float value found
          const floatNum = parseFloat(match[1].replace(/,/g, ''));
          const floatUnit = match[2].toUpperCase();
          latestFloat = convertToMillions(floatNum, floatUnit);
        }
        
        if (match.length >= 5) {
          // Float & OS pattern - also has shares outstanding
          const osNum = parseFloat(match[3].replace(/,/g, ''));
          const osUnit = match[4].toUpperCase();
          sharesOutstanding = convertToMillions(osNum, osUnit);
        }
        
        break; // Use first matching pattern
      }
    }
    
    // Also try to find shares outstanding separately if not found
    if (!sharesOutstanding) {
      const osPatterns = [
        /(?:shares?\s*outstanding|outstanding\s*shares?)[:\s]+([0-9,.]+)\s*([MB])/i,
        /os[:\s]+([0-9,.]+)\s*([MB])/i
      ];
      
      for (const osPattern of osPatterns) {
        const osMatch = text.match(osPattern);
        if (osMatch) {
          const osNum = parseFloat(osMatch[1].replace(/,/g, ''));
          const osUnit = osMatch[2].toUpperCase();
          sharesOutstanding = convertToMillions(osNum, osUnit);
          console.log(`✅ Found shares outstanding: ${sharesOutstanding}M`);
          break;
        }
      }
    }
    
    // Return data if we found at least float
    if (latestFloat !== null) {
      return {
        latestFloat,
        sharesOutstanding: sharesOutstanding || null,
        lastUpdated: Date.now(),
        source: 'dilutiontracker.com'
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ Error parsing float data:', error);
    return null;
  }
}

/**
 * Convert number with unit to millions
 * @param {number} num - Number value
 * @param {string} unit - Unit (M, B)
 * @returns {number} Value in millions
 */
function convertToMillions(num, unit) {
  console.log('num: ' + num);
  console.log('unit: ' + unit);
  if (unit === 'B') {
    return num * 1000; // Billions to millions
  } else if (unit === 'M') {
    return num; // Already in millions
  }
  return num; // Default to millions
}

function formatMillionsToUnitString(n) {
  if (typeof n !== 'number' || !isFinite(n)) return String(n);
  if (n >= 1000) {
    const v = (n / 1000);
    return trimZeros(v.toFixed(2)) + 'B';
  }
  return trimZeros(n.toFixed(2)) + 'M';
}

function trimZeros(s) {
  return String(s).replace(/\.00$/, '').replace(/(\.[1-9])0$/, '$1');
}

/**
 * Robustly parse Float & OS from the float wrapper element and return numbers in millions
 */
function parseFloatAndOSFromWrapper(root = document) {
  try {
    const el = root.querySelector('#company-description-float-wrapper');
    if (!el) return null;
    // DOM-first: locate the value container next to the label
    const valueEl = el.querySelector('.mr-4.pr-1, span.mr-4.pr-1, span[class*="mr-4"][class*="pr-1"]') || el;
    const nums = [];
    const walker = document.createTreeWalker(valueEl, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      const s = n.nodeValue.replace(/\u00A0/g, ' ').trim();
      if (!s) continue;
      const m = s.match(/([0-9][\d.,]*)\s*([KMB])?/i);
      if (m) nums.push({ num: m[1], unit: (m[2] || null) });
    }
    if (nums.length >= 2) {
      const a = nums[0];
      const b = nums[1];
      const unitA = (a.unit || 'M').toUpperCase();
      const unitB = (b.unit || unitA).toUpperCase();
      const num1 = parseFloat(a.num.replace(/,/g, ''));
      const num2 = parseFloat(b.num.replace(/,/g, ''));
      const floatM = unitA === 'B' ? num1 * 1000 : unitA === 'K' ? num1 / 1000 : num1;
      const sharesM = unitB === 'B' ? num2 * 1000 : unitB === 'K' ? num2 / 1000 : num2;
      return { floatM, sharesM, floatText: `${num1}${unitA}`, sharesText: `${num2}${unitB}` };
    }
    // Fallback to text regex as last resort
    const txt = (el.textContent || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
    const mr = txt.match(/([0-9][\d.,]*)\s*([KMB])?\s*\/\s*([0-9][\d.,]*)\s*([KMB])?/i);
    if (!mr) return null;
    const num1 = parseFloat(mr[1].replace(/,/g, ''));
    const unit1 = (mr[2] || 'M').toUpperCase();
    const num2 = parseFloat(mr[3].replace(/,/g, ''));
    const unit2 = (mr[4] || unit1 || 'M').toUpperCase();
    const floatM = unit1 === 'B' ? num1 * 1000 : unit1 === 'K' ? num1 / 1000 : num1;
    const sharesM = unit2 === 'B' ? num2 * 1000 : unit2 === 'K' ? num2 / 1000 : num2;
    return { floatM, sharesM, floatText: `${num1}${unit1}`, sharesText: `${num2}${unit2}` };
  } catch { return null; }
}

/**
 * Add verification checkmark icons to the float wrapper container
 * @param {string} ticker - Stock ticker
 * @param {Object} currentData - Currently extracted data
 */
async function addVerificationIcons(ticker, currentData) {
  try {
    // Check if chrome.storage is available
    if (!chrome || !chrome.storage) {
      console.error('❌ Chrome storage API not available');
      return;
    }

    // Get existing stored data
    const result = await chrome.storage.local.get(`ticker_${ticker}`);
    const storedData = result[`ticker_${ticker}`];
    
    // If no stored data, this is first time crawling - show checkmarks for all values
    const isFirstTime = !storedData;
    
    console.log(`✅ Adding verification icons for ${ticker} (first time: ${isFirstTime})`);
    
    // Find the float wrapper container
    const floatWrapper = document.getElementById('company-description-float-wrapper');
    if (!floatWrapper) {
      console.log('❌ Float wrapper not found');
      return;
    }
    
    console.log('✅ Found float wrapper, checking data matches...');
    
    // Check which data matches and prepare checkmarks
    const matchingFields = [];
    
    // Check float data
    if (currentData.latestFloat && (isFirstTime || 
        (storedData?.latestFloat && Math.abs(currentData.latestFloat - storedData.latestFloat) < 0.01))) {
      matchingFields.push({ field: 'float', value: `${currentData.latestFloat}M`, label: 'Float' });
    }
    
    // Check shares outstanding
    if (currentData.sharesOutstanding && (isFirstTime || 
        (storedData?.sharesOutstanding && Math.abs(currentData.sharesOutstanding - storedData.sharesOutstanding) < 0.01))) {
      matchingFields.push({ field: 'outstanding', value: `${currentData.sharesOutstanding}M`, label: 'Shares Outstanding' });
    }
    
    // Check other company data
    const companyFields = [
      { field: 'estimatedCash', label: 'Estimated Cash', unit: 'M' },
      { field: 'sector', label: 'Sector' },
      { field: 'industry', label: 'Industry' },
      { field: 'country', label: 'Country' },
      { field: 'exchange', label: 'Exchange' },
      { field: 'institutionalOwnership', label: 'Inst Own' },
      { field: 'marketCap', label: 'Market Cap' },
      { field: 'enterpriseValue', label: 'Enterprise Value' }
    ];
    
    companyFields.forEach(({ field, label, unit }) => {
      const hasCurrentData = !!currentData[field];
      const storedValue = storedData?.[field];
      const currentValue = currentData[field];
      const valuesMatch = storedValue === currentValue;
      
      // Enhanced debugging for sector and industry
      if (field === 'sector' || field === 'industry') {
        console.log(`🔍 DEBUG ${field}:`, {
          hasCurrentData,
          currentValue,
          storedValue,
          valuesMatch,
          isFirstTime,
          willAdd: hasCurrentData && (isFirstTime || valuesMatch)
        });
      }
      
      if (currentData[field] && (isFirstTime || storedData?.[field] === currentData[field])) {
        const value = unit ? `${currentData[field]}${unit}` : currentData[field];
        matchingFields.push({ field, value, label });
        
        // Additional debug for sector/industry
        if (field === 'sector' || field === 'industry') {
          console.log(`✅ Added ${field} to matching fields: "${value}"`);
        }
      } else if (field === 'sector' || field === 'industry') {
        console.log(`❌ ${field} not added to matching fields - hasData: ${hasCurrentData}, isFirstTime: ${isFirstTime}, valuesMatch: ${valuesMatch}`);
      }
    });
    
    // Add individual checkmarks to each value's container
    if (matchingFields.length > 0) {
      addIndividualCheckmarks(matchingFields, isFirstTime);
    }
    
    console.log(`✅ Verification icons added for ${ticker}, matching fields: ${matchingFields.length}`);
    
  } catch (error) {
    console.error('❌ Error adding verification icons:', error);
  }
}

/**
 * Add individual checkmark icons to each value's parent container
 * @param {Array} matchingFields - Array of matching field objects
 * @param {boolean} isFirstTime - Whether this is first time crawling
 */
function addIndividualCheckmarks(matchingFields, isFirstTime) {
  try {
    console.log(`🔍 Adding individual checkmarks for fields:`, matchingFields);
    // Note: Green text styling removed; we no longer modify colors.
    matchingFields.forEach(({ field, value, label }) => {
      const container = findContainerForValue(field, label, value);
      if (!container) console.log(`❌ Could not find container for ${field}: ${label}`);
    });
    console.log(`✅ Processed ${matchingFields.length} fields (no color changes)`);
  
  } catch (error) {
    console.error('❌ Error adding individual checkmarks:', error);
  }
}

/**
 * Direct search and highlight for specific DilutionTracker elements
 * @param {Array} matchingFields - Array of field objects to check
 */
// highlightDirectElements removed (no color changes)

/**
 * Find label and highlight the label element when data is synced
 * @param {string} labelText - The label text to search for (e.g., "Industry:", "Sector:")
 * @param {string} expectedValue - Expected value to verify match
 */
function highlightLabelSibling(labelText, expectedValue) {
  if (!expectedValue) {
    console.log(`🎯 No expected value for label "${labelText}", skipping`);
    return;
  }
  
  console.log(`🎯 Searching for label "${labelText}" with expected value "${expectedValue}"`);
  
  // Create a TreeWalker to find all text nodes (excluding already processed elements)
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip text nodes that are inside already highlighted elements
        if (node.parentElement && (
          node.parentElement.classList.contains('qse-verified-label') ||
          node.parentElement.classList.contains('qse-verified-value')
        )) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    },
    false
  );
  
  let node;
  let processedNodes = 0;
  const maxNodes = 50; // Limit processing to prevent infinite loops
  
  while ((node = walker.nextNode()) && processedNodes < maxNodes) {
    processedNodes++;
    const text = node.nodeValue.trim();
    
    // Check if this text node contains our label
    if (text.includes(labelText)) {
      console.log(`🎯 Found label "${labelText}" in text: "${text}"`);
      
      // Get the parent element
      let parentElement = node.parentElement;
      if (parentElement) {
        // Look for sibling elements that might contain the value to verify data sync
        const siblings = Array.from(parentElement.parentElement?.children || []);
        const parentIndex = siblings.indexOf(parentElement);
        
        // Check next sibling for the value to confirm this is the right label
        let valueFound = false;
        if (parentIndex >= 0 && parentIndex < siblings.length - 1) {
          const nextSibling = siblings[parentIndex + 1];
          const siblingText = nextSibling.textContent.trim();
          
          if (siblingText.includes(expectedValue)) {
            console.log(`🎯 Verified value match for "${labelText}": "${siblingText}"`);
            valueFound = true;
          }
        }
        
        // Also check if the same element contains both label and value
        const fullText = parentElement.textContent;
        if (fullText.includes(labelText) && fullText.includes(expectedValue)) {
          console.log(`🎯 Verified label and value in same element for "${labelText}": "${fullText}"`);
          valueFound = true;
        }
        
        // If we found the matching value, highlight the LABEL element
        if (valueFound) {
          // Check if this element is already highlighted
          if (parentElement.classList.contains('qse-verified-label') || parentElement.style.color === 'rgb(34, 197, 94)') {
            console.log(`⚠️ Label "${labelText}" already highlighted, skipping`);
            return;
          }
          
          // Highlight the label element (the one containing the label text)
          parentElement.style.color = 'rgb(34, 197, 94) !important';
          parentElement.style.fontWeight = '500';
          parentElement.classList.add('qse-verified-label');
          console.log(`🎯 Applied green styling to LABEL "${labelText}"`);
          return;
        }
      }
    }
  }
  
  console.log(`❌ Could not find and verify label "${labelText}" with expected value`);
}

/**
 * Generic label highlighting - highlights labels even without exact value matching
 * @param {string} labelText - The label text to search for (e.g., "Industry:", "Sector:")
 */
function highlightGenericLabel(labelText) {
  console.log(`🎯 Generic highlighting for label "${labelText}"`);
  
  // Create a TreeWalker to find all text nodes
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip text nodes that are inside already highlighted elements
        if (node.parentElement && (
          node.parentElement.classList.contains('qse-verified-label') ||
          node.parentElement.classList.contains('qse-verified-value') ||
          node.parentElement.style.color === 'rgb(34, 197, 94)'
        )) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    },
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    
    // Check if this text node contains our label
    if (text.includes(labelText)) {
      console.log(`🎯 Found generic label "${labelText}" in text: "${text}"`);
      
      // Get the parent element
      let parentElement = node.parentElement;
      if (parentElement) {
        // Check if this element is already highlighted
        if (parentElement.classList.contains('qse-verified-label') || parentElement.style.color === 'rgb(34, 197, 94)') {
          console.log(`⚠️ Generic label "${labelText}" already highlighted, skipping`);
          return;
        }
        
        // Highlight the element containing the label
        parentElement.style.color = 'rgb(34, 197, 94) !important';
        parentElement.style.fontWeight = '500';
        parentElement.classList.add('qse-verified-label');
        console.log(`🎯 Applied generic green styling to label "${labelText}"`);
        return;
      }
    }
  }
  
  console.log(`❌ Could not find generic label "${labelText}"`);
}

/**
 * Highlight only the value portion within an element that contains both label and value
 * @param {Element} element - The element containing both label and value
 * @param {string} expectedValue - The value to highlight
 * @param {string} labelText - The label text to avoid highlighting
 */
function highlightValueInElement(element, expectedValue, labelText) {
  console.log(`🎯 Attempting to highlight value "${expectedValue}" in element with text: "${element.textContent}"`);
  
  // Create a TreeWalker to examine text nodes within this element
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    const text = node.nodeValue;
    
    // Skip text nodes that contain the label
    if (text.includes(labelText)) {
      continue;
    }
    
    // If this text node contains our expected value
    if (text.includes(expectedValue)) {
      console.log(`🎯 Found value "${expectedValue}" in text node: "${text}"`);
      
      // Check if the parent of this text node can be styled
      let parentToStyle = node.parentElement;
      
      // Make sure we're not styling the same element that contains the label
      if (parentToStyle && !parentToStyle.textContent.includes(labelText)) {
        parentToStyle.style.color = 'rgb(34, 197, 94) !important';
        parentToStyle.style.fontWeight = '500';
        parentToStyle.classList.add('qse-verified-value');
        console.log(`🎯 Applied green styling to value element for "${expectedValue}"`);
        return;
      }
      
      // If that doesn't work, try to create a span around just the value
      if (parentToStyle) {
        highlightValueWithSpan(node, expectedValue);
        return;
      }
    }
  }
  
  // Fallback: if we can't isolate the value, look for child elements
  const childElements = element.children;
  for (const child of childElements) {
    const childText = child.textContent.trim();
    
    // If this child contains the value but not the label
    if (childText.includes(expectedValue) && !childText.includes(labelText)) {
      console.log(`🎯 Found child element with value "${expectedValue}": "${childText}"`);
      child.style.color = 'rgb(34, 197, 94) !important';
      child.style.fontWeight = '500';
      child.classList.add('qse-verified-value');
      return;
    }
  }
  
  console.log(`⚠️ Could not isolate value "${expectedValue}" from label "${labelText}" in element`);
}

/**
 * Wrap the value in a span to highlight it specifically
 * @param {Text} textNode - The text node containing the value
 * @param {string} expectedValue - The value to wrap and highlight
 */
function highlightValueWithSpan(textNode, expectedValue) {
  const text = textNode.nodeValue;
  const valueIndex = text.indexOf(expectedValue);
  
  if (valueIndex === -1) return;
  
  console.log(`🎯 Creating span wrapper for value "${expectedValue}"`);
  
  // Split the text into parts
  const beforeValue = text.substring(0, valueIndex);
  const value = text.substring(valueIndex, valueIndex + expectedValue.length);
  const afterValue = text.substring(valueIndex + expectedValue.length);
  
  // Create new elements
  const beforeText = document.createTextNode(beforeValue);
  const valueSpan = document.createElement('span');
  valueSpan.textContent = value;
  valueSpan.style.color = 'rgb(34, 197, 94) !important';
  valueSpan.style.fontWeight = '500';
  valueSpan.classList.add('qse-verified-value');
  const afterText = document.createTextNode(afterValue);
  
  // Replace the original text node
  const parent = textNode.parentNode;
  parent.insertBefore(beforeText, textNode);
  parent.insertBefore(valueSpan, textNode);
  parent.insertBefore(afterText, textNode);
  parent.removeChild(textNode);
  
  console.log(`🎯 Successfully wrapped value "${expectedValue}" in green span`);
}

/**
 * Find element containing specific text and highlight it
 * @param {string} searchText - Text to search for
 * @param {string} expectedValue - Expected value to verify match
 */
function highlightTextContainingElement(searchText, expectedValue) {
  console.log(`🎯 Searching for text containing "${searchText}" with value "${expectedValue}"`);
  
  // Search all elements for the text
  const allElements = document.querySelectorAll('*');
  
  for (const element of allElements) {
    const text = element.textContent;
    
    if (text.includes(searchText) && text.includes(expectedValue)) {
      console.log(`🎯 Found element containing "${searchText}": "${text.substring(0, 100)}..."`);
      element.style.color = 'rgb(34, 197, 94) !important';
      element.style.fontWeight = '500';
      element.classList.add('qse-verified-value');
      return;
    }
  }
  
  console.log(`❌ Could not find element containing "${searchText}"`);
}

/**
 * Find and highlight specific text regardless of surrounding content
 * @param {string} searchText - Text to search for and highlight
 */
function highlightSpecificText(searchText) {
  console.log(`🎯 Searching for specific text to highlight: "${searchText}"`);
  
  // Create a TreeWalker to find all text nodes
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    const text = node.nodeValue;
    
    if (text.includes(searchText)) {
      console.log(`🎯 Found text "${searchText}" in: "${text.trim()}"`);
      
      // Try to highlight the parent element
      let parentElement = node.parentElement;
      if (parentElement) {
        // Check if this is a small enough element to highlight
        const parentText = parentElement.textContent.trim();
        
        // If the parent element is mostly just our search text, highlight the whole element
        if (parentText.length < searchText.length + 50) { // Allow some extra context
          parentElement.style.color = 'rgb(34, 197, 94) !important';
          parentElement.style.fontWeight = '500';
          parentElement.classList.add('qse-verified-value');
          console.log(`🎯 Highlighted parent element containing "${searchText}"`);
          return;
        }
        
        // Otherwise, create a span around just the search text
        highlightSpecificTextWithSpan(node, searchText);
        return;
      }
    }
  }
  
  console.log(`❌ Could not find text "${searchText}" to highlight`);
}

/**
 * Find and highlight cash flow text snippets (e.g., "quarterly operating cash flow of $15.2M")
 * @param {string} cashPattern - The cash pattern text (e.g., "estimated current cash of")
 * @param {string} expectedValue - Expected cash value (e.g., "15.2M")
 */
function highlightCashFlowText(cashPattern, expectedValue) {
  console.log(`🎯 Searching for cash flow text: "${cashPattern}" with value: "${expectedValue}"`);
  
  // Convert expectedValue to search for both formats (15.2M and $15.2M)
  const cashAmount = expectedValue.replace('M', '').replace('B', '');
  const unit = expectedValue.match(/[MB]$/)?.[0] || 'M';
  
  // Create patterns to match the full cash flow text
  const fullPatterns = [
    new RegExp(`${cashPattern.replace(/\s+/g, '\\s+')}\\s+\\$${cashAmount}\\s*${unit}`, 'i'),
    new RegExp(`${cashPattern.replace(/\s+/g, '\\s+')}\\s+\\$${cashAmount}\\.\\d+\\s*${unit}`, 'i'),
    new RegExp(`${cashPattern.replace(/\s+/g, '\\s+')}\\s+\\$[0-9.,]+\\s*${unit}`, 'i')
  ];
  
  console.log(`🎯 DEBUG: Searching for patterns:`, fullPatterns);
  
  // Search all elements for the complete cash flow text
  const allElements = document.querySelectorAll('*');
  
  for (const element of allElements) {
    const text = element.textContent;
    
    // Skip if already highlighted
    if (element.classList.contains('qse-verified-value') || element.style.color === 'rgb(34, 197, 94)') {
      continue;
    }
    
    for (let i = 0; i < fullPatterns.length; i++) {
      const pattern = fullPatterns[i];
      const match = text.match(pattern);
      
      if (match) {
        console.log(`🎯 Found complete cash flow text: "${match[0]}" in element: "${text.substring(0, 100)}..."`);
        
        // Check if this is a reasonably sized element to highlight entirely
        if (text.length < 200) {
          // Highlight the entire element
          element.style.color = 'rgb(34, 197, 94) !important';
          element.style.fontWeight = '500';
          element.classList.add('qse-verified-value');
          console.log(`🎯 Highlighted entire element containing cash flow text`);
          return;
        } else {
          // Create a span around just the matching text
          highlightCashFlowTextWithSpan(element, match[0]);
          return;
        }
      }
    }
  }
  
  console.log(`❌ Could not find cash flow text for pattern "${cashPattern}"`);
}

/**
 * Create a span around specific cash flow text within an element
 * @param {Element} element - The element containing the text
 * @param {RegExp} pattern - The pattern that matched
 * @param {string} matchedText - The text that matched
 */
function highlightCashFlowTextWithSpan(element, matchedText) {
  console.log(`🎯 Creating span for cash flow text: "${matchedText}"`);
  
  // Find all text nodes in the element
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    const text = node.nodeValue;
    
    if (text.includes(matchedText)) {
      const textIndex = text.indexOf(matchedText);
      
      // Split the text into parts
      const beforeText = text.substring(0, textIndex);
      const cashText = text.substring(textIndex, textIndex + matchedText.length);
      const afterText = text.substring(textIndex + matchedText.length);
      
      // Create new elements
      const beforeNode = document.createTextNode(beforeText);
      const cashSpan = document.createElement('span');
      cashSpan.textContent = cashText;
      cashSpan.style.color = 'rgb(34, 197, 94) !important';
      cashSpan.style.fontWeight = '500';
      cashSpan.classList.add('qse-verified-value');
      const afterNode = document.createTextNode(afterText);
      
      // Replace the original text node
      const parent = node.parentNode;
      parent.insertBefore(beforeNode, node);
      parent.insertBefore(cashSpan, node);
      parent.insertBefore(afterNode, node);
      parent.removeChild(node);
      
      console.log(`🎯 Successfully wrapped cash flow text "${matchedText}" in green span`);
      return;
    }
  }
}

/**
 * Wrap specific text in a span to highlight it
 * @param {Text} textNode - The text node containing the text
 * @param {string} searchText - The text to wrap and highlight
 */
function highlightSpecificTextWithSpan(textNode, searchText) {
  const text = textNode.nodeValue;
  const textIndex = text.indexOf(searchText);
  
  if (textIndex === -1) return;
  
  console.log(`🎯 Creating span wrapper for text "${searchText}"`);
  
  // Split the text into parts
  const beforeText = text.substring(0, textIndex);
  const targetText = text.substring(textIndex, textIndex + searchText.length);
  const afterText = text.substring(textIndex + searchText.length);
  
  // Create new elements
  const beforeNode = document.createTextNode(beforeText);
  const textSpan = document.createElement('span');
  textSpan.textContent = targetText;
  textSpan.style.color = 'rgb(34, 197, 94) !important';
  textSpan.style.fontWeight = '500';
  textSpan.classList.add('qse-verified-value');
  const afterNode = document.createTextNode(afterText);
  
  // Replace the original text node
  const parent = textNode.parentNode;
  parent.insertBefore(beforeNode, textNode);
  parent.insertBefore(textSpan, textNode);
  parent.insertBefore(afterNode, textNode);
  parent.removeChild(textNode);
  
  console.log(`🎯 Successfully wrapped text "${searchText}" in green span`);
}

/**
 * Find the parent container for a specific value based on field type and label
 * @param {string} field - Field type (float, outstanding, etc.)
 * @param {string} label - Display label for the field
 * @param {string} value - The value to search for
 * @returns {Element|null} The container element or null
 */
function findContainerForValue(field, label, value) {
  try {
    console.log(`🔍 Searching for ${field} with value "${value}" and label "${label}"`);
    
    // Special debugging for sector and industry
    if (field === 'sector' || field === 'industry') {
      console.log(`🔍 DEBUG ${field}: Starting container search for value "${value}"`);
    }
    
    // First, let's see what text is actually on the page
    const floatWrapper = document.getElementById('company-description-float-wrapper');
    if (floatWrapper) {
      console.log(`📄 Float wrapper text content: "${floatWrapper.textContent}"`);
      
      // Special debugging for sector and industry - show full text content
      if (field === 'sector' || field === 'industry') {
        console.log(`🔍 DEBUG ${field}: Full float wrapper content:`, floatWrapper.textContent);
      }
    }
    
    // Define search patterns for different field types - made more flexible
    const searchPatterns = {
      float: [
        // Match the actual extracted value format
        new RegExp(`${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        /float[:\s]*([0-9,.]+)\s*([MB])/i,
        /([0-9,.]+)\s*([MB])\s*float/i,
        // Look for "Float & OS" format
        /float\s*&\s*os[:\s]*([0-9,.]+)\s*([MB])/i
      ],
      outstanding: [
        // Match the actual extracted value format
        new RegExp(`${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        /(?:shares?\s*outstanding|outstanding\s*shares?|os)[:\s]*([0-9,.]+)\s*([MB])/i,
        /([0-9,.]+)\s*([MB])\s*(?:shares?\s*outstanding|outstanding\s*shares?|os)/i,
        // Look for "Float & OS" format with OS value
        /float\s*&\s*os[:\s]*[0-9,.]+[MB]?\s*\/\s*([0-9,.]+)\s*([MB])/i
      ],
      estimatedCash: [
        // Match the actual extracted value format
        new RegExp(`\\$?${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        /(?:estimated\s+)?(?:current\s+)?cash\s+of\s+\$([0-9,.]+)\s*([MB])/i,
        /cash[:\s]+\$([0-9,.]+)\s*([MB])/i
      ],
      sector: [
        // Match the actual extracted value anywhere in text
        new RegExp(`${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        new RegExp(`sector[:\\s]*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        /sector[:\s]+([^|\n\r]+)/i,
        // Look for "Sector:" label specifically
        /sector\s*:/i
      ],
      industry: [
        // Match the actual extracted value anywhere in text
        new RegExp(`${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        new RegExp(`industry[:\\s]*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        /industry[:\s]+([^|\n\r]+)/i,
        // Look for "Industry:" label specifically
        /industry\s*:/i
      ],
      country: [
        // Match the actual extracted value anywhere in text
        new RegExp(`${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        new RegExp(`country[:\\s]*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        /country[:\s]+([^|\n\r]+)/i,
        // Look for "Country:" label specifically
        /country\s*:/i
      ],
      exchange: [
        // Match the actual extracted value anywhere in text
        new RegExp(`${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        new RegExp(`exchange[:\\s]*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        /exchange[:\s]+([^|\n\r]+)/i,
        // Look for "Exchange:" label specifically
        /exchange\s*:/i
      ],
      institutionalOwnership: [
        // Match the actual extracted value anywhere in text
        new RegExp(`${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        new RegExp(`inst\\s+own[:\\s]*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        /inst\s+own[:\s]+([0-9.,]+%?)/i,
        /institutional\s+ownership[:\s]+([0-9.,]+%?)/i
      ],
      marketCap: [
        // Match the actual extracted value format
        new RegExp(`${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        /(?:market cap|mkt cap)[:\s]*([0-9,.]+[KMB])/i,
        /(?:market cap|mkt cap)\s*&\s*ev[:\s]*([0-9,.]+[KMB])/i
      ],
      enterpriseValue: [
        // Match the actual extracted value format
        new RegExp(`${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        /(?:enterprise value|ev)[:\s]*([0-9,.]+[KMB])/i,
        /mkt cap\s*&\s*ev[:\s]*[0-9,.]+[KMB]\s*\/\s*([0-9,.]+[KMB])/i
      ]
    };
    
    const containerPatterns = searchPatterns[field];
    if (!containerPatterns) {
      console.log(`❌ No search patterns defined for field: ${field}`);
      return null;
    }
    
    // First try to search within the float wrapper specifically
    if (floatWrapper) {
      const walkerFloat = document.createTreeWalker(
        floatWrapper,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      
      let nodeFloat;
      while (nodeFloat = walkerFloat.nextNode()) {
        const text = nodeFloat.nodeValue;
        
        for (let i = 0; i < containerPatterns.length; i++) {
          const pattern = containerPatterns[i];
          
          // Special debugging for sector and industry
          if (field === 'sector' || field === 'industry') {
            console.log(`🔍 DEBUG ${field}: Testing pattern ${i}: ${pattern} against text: "${text}"`);
            console.log(`🔍 DEBUG ${field}: Pattern test result: ${pattern.test(text)}`);
          }
          
          if (pattern.test(text)) {
            let container = nodeFloat.parentElement;
            while (container && container.tagName.toLowerCase() === 'text') {
              container = container.parentElement;
            }
            
            if (container) {
              console.log(`✅ Found container for ${field} (${label}) in float wrapper: ${container.tagName} with text: "${text.trim()}" using pattern ${i}`);
              return container;
            }
          }
        }
      }
    }
    
    // If not found in float wrapper, search the whole page
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let node;
    const allTextNodes = [];
    while (node = walker.nextNode()) {
      allTextNodes.push(node.nodeValue.trim());
      const text = node.nodeValue;
      
      for (let i = 0; i < containerPatterns.length; i++) {
        const pattern = containerPatterns[i];
        
        // Special debugging for sector and industry
        if (field === 'sector' || field === 'industry') {
          console.log(`🔍 DEBUG ${field}: Testing pattern ${i} in body search: ${pattern} against text: "${text}"`);
          console.log(`🔍 DEBUG ${field}: Pattern test result: ${pattern.test(text)}`);
        }
        
        if (pattern.test(text)) {
          let container = node.parentElement;
          while (container && container.tagName.toLowerCase() === 'text') {
            container = container.parentElement;
          }
          
          if (container) {
            console.log(`✅ Found container for ${field} (${label}) on page: ${container.tagName} with text: "${text.trim()}" using pattern ${i}`);
            return container;
          }
        }
      }
    }
    
    // Last resort: Try to find containers by common DilutionTracker selectors
    console.log(`🔄 Trying fallback selectors for ${field}...`);
    
    const fallbackSelectors = {
      float: ['#company-description-float-wrapper', '[class*="float"]', '[class*="Float"]'],
      outstanding: ['#company-description-float-wrapper', '[class*="outstanding"]', '[class*="shares"]'],
      estimatedCash: ['[class*="cash"]', '[class*="Cash"]', '[id*="cash"]'],
      sector: ['[class*="sector"]', '[class*="Sector"]', '[class*="company"]'],
      industry: ['[class*="industry"]', '[class*="Industry"]', '[class*="company"]'],
      country: ['[class*="country"]', '[class*="Country"]', '[class*="company"]'],
      exchange: ['[class*="exchange"]', '[class*="Exchange"]', '[class*="company"]'],
      institutionalOwnership: ['[class*="inst"]', '[class*="ownership"]', '[class*="company"]'],
      marketCap: ['[class*="cap"]', '[class*="Cap"]', '[class*="market"]'],
      enterpriseValue: ['[class*="enterprise"]', '[class*="value"]', '[class*="ev"]']
    };
    
    const selectors = fallbackSelectors[field] || [];
    
    // Special debugging for sector and industry
    if (field === 'sector' || field === 'industry') {
      console.log(`🔍 DEBUG ${field}: Trying ${selectors.length} fallback selectors: ${selectors.join(', ')}`);
    }
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      
      // Special debugging for sector and industry
      if (field === 'sector' || field === 'industry') {
        console.log(`🔍 DEBUG ${field}: Selector "${selector}" found ${elements.length} elements`);
      }
      
      for (const element of elements) {
        const text = element.textContent || '';
        
        // Special debugging for sector and industry
        if (field === 'sector' || field === 'industry') {
          console.log(`🔍 DEBUG ${field}: Checking element text: "${text.substring(0, 100)}..." for value "${value}"`);
        }
        
        // Check if this element contains our value
        if (text.includes(value) || text.toLowerCase().includes(value.toLowerCase())) {
          console.log(`✅ Found container for ${field} (${label}) using fallback selector "${selector}": ${element.tagName} with text: "${text.substring(0, 100)}..."`);
          return element;
        }
      }
    }
    
    // Final fallback: Search for specific label patterns and find parent containers
    console.log(`🔄 Trying label-based search for ${field}...`);
    const labelPatterns = {
      sector: [/sector\s*:/i, /sector\s+/i, /\bsector\b/i],
      industry: [/industry\s*:/i, /industry\s+/i, /\bindustry\b/i],
      country: [/country\s*:/i, /country\s+/i, /\bcountry\b/i],
      exchange: [/exchange\s*:/i, /exchange\s+/i, /\bexchange\b/i]
    };
    
    const labelSearchPatterns = labelPatterns[field];
    if (labelSearchPatterns) {
      // Special debugging for sector and industry
      if (field === 'sector' || field === 'industry') {
        console.log(`🔍 DEBUG ${field}: Trying ${labelSearchPatterns.length} label patterns: ${labelSearchPatterns.join(', ')}`);
      }
      
      const allElements = document.querySelectorAll('*');
      for (const element of allElements) {
        const text = element.textContent || '';
        
        for (const pattern of labelSearchPatterns) {
          if (pattern.test(text) && text.includes(value)) {
            // Special debugging for sector and industry
            if (field === 'sector' || field === 'industry') {
              console.log(`🔍 DEBUG ${field}: Label pattern "${pattern}" matched in element: "${text.substring(0, 100)}..."`);
            }
            
            console.log(`✅ Found container for ${field} (${label}) using label search: ${element.tagName} with text: "${text.substring(0, 100)}..."`);
            return element;
          }
        }
      }
    }
    
    console.log(`❌ Could not find container for ${field} with patterns or fallback selectors`);
    console.log(`📄 Available text nodes on page:`, allTextNodes.slice(0, 10)); // Show first 10 text nodes
    return null;
    
  } catch (error) {
    console.error(`❌ Error finding container for ${field}:`, error);
    return null;
  }
}

/**
 * Apply green color styling to a specific container for synced values
 * @param {Element} container - The container element
 * @param {string} field - Field type
 * @param {string} label - Display label
 * @param {string} value - Field value
 * @param {boolean} isFirstTime - Whether this is first time crawling
 */
function addCheckmarkToContainer(_container, _field, _label, _value, _isFirstTime) {
  // No-op: green text styling and label highlighting removed by request
  return;
}

/**
 * Highlight the label portion within a container that has both label and value
 * @param {Element} container - The container element
 * @param {string} field - Field type
 * @param {string} label - Display label
 * @param {string} value - Field value  
 * @param {boolean} isFirstTime - Whether this is first time crawling
 */
function highlightLabelInContainer(container, field, label, value, isFirstTime) {
  console.log(`🎯 Highlighting label in container for ${field}: "${label}"`);
  
  // Create a TreeWalker to examine text nodes within this container
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  let labelPatterns = [];
  
  // Define label patterns based on field type
  switch (field) {
    case 'float':
      labelPatterns = [/float/i, /free float/i];
      break;
    case 'outstanding':
      labelPatterns = [/outstanding/i, /shares outstanding/i, /os/i];
      break;
    case 'sector':
      labelPatterns = [/sector/i];
      break;
    case 'industry':
      labelPatterns = [/industry/i];
      break;
    case 'country':
      labelPatterns = [/country/i];
      break;
    case 'exchange':
      labelPatterns = [/exchange/i];
      break;
    case 'institutionalOwnership':
      labelPatterns = [/inst own/i, /institutional/i];
      break;
    case 'estimatedCash':
      labelPatterns = [/cash/i, /estimated/i];
      break;
    default:
      labelPatterns = [new RegExp(label, 'i')];
  }
  
  while (node = walker.nextNode()) {
    const text = node.nodeValue;
    
    // Check if this text node contains a label pattern
    for (const pattern of labelPatterns) {
      if (pattern.test(text)) {
        console.log(`🎯 Found label pattern in text node: "${text}"`);
        
        // Check if the parent of this text node can be styled
        let parentToStyle = node.parentElement;
        
        // Make sure we're highlighting the label part, not the value part
        if (parentToStyle && !text.includes(value)) {
          parentToStyle.style.color = 'rgb(34, 197, 94)';
          parentToStyle.style.fontWeight = '500';
          parentToStyle.title = isFirstTime ? 
            `First time extracting ${label}: ${value}` : 
            `${label} matches extension storage: ${value}`;
          parentToStyle.classList.add('qse-verified-label');
          console.log(`🎯 Applied green styling to label element for ${field}`);
          return;
        }
        
        // If that doesn't work, try to create a span around just the label text
        if (parentToStyle) {
          highlightLabelTextWithSpan(node, pattern, isFirstTime, label, value);
          return;
        }
      }
    }
  }
  
  // Fallback: look for child elements that contain label patterns
  const childElements = container.children;
  for (const child of childElements) {
    const childText = child.textContent.trim();
    
    for (const pattern of labelPatterns) {
      if (pattern.test(childText) && !childText.includes(value)) {
        console.log(`🎯 Found child element with label pattern: "${childText}"`);
        child.style.color = 'rgb(34, 197, 94)';
        child.style.fontWeight = '500';
        child.title = isFirstTime ? 
          `First time extracting ${label}: ${value}` : 
          `${label} matches extension storage: ${value}`;
        child.classList.add('qse-verified-label');
        return;
      }
    }
  }
  
  console.log(`⚠️ Could not isolate label for ${field} in container, highlighting whole container`);
  // Fallback to highlighting the whole container
  container.style.color = 'rgb(34, 197, 94)';
  container.style.fontWeight = '500';
  container.title = isFirstTime ? 
    `First time extracting ${label}: ${value}` : 
    `${label} matches extension storage: ${value}`;
  container.classList.add('qse-verified-label');
}

/**
 * Wrap the label text in a span to highlight it specifically
 * @param {Text} textNode - The text node containing the label
 * @param {RegExp} labelPattern - The pattern that matched the label
 * @param {boolean} isFirstTime - Whether this is first time crawling
 * @param {string} label - Display label
 * @param {string} value - Field value
 */
function highlightLabelTextWithSpan(textNode, labelPattern, isFirstTime, label, value) {
  const text = textNode.nodeValue;
  const match = text.match(labelPattern);
  
  if (!match) return;
  
  const labelText = match[0];
  const labelIndex = text.indexOf(labelText);
  
  console.log(`🎯 Creating span wrapper for label "${labelText}"`);
  
  // Split the text into parts
  const beforeLabel = text.substring(0, labelIndex);
  const labelPart = text.substring(labelIndex, labelIndex + labelText.length);
  const afterLabel = text.substring(labelIndex + labelText.length);
  
  // Create new elements
  const beforeNode = document.createTextNode(beforeLabel);
  const labelSpan = document.createElement('span');
  labelSpan.textContent = labelPart;
  labelSpan.style.color = 'rgb(34, 197, 94) !important';
  labelSpan.style.fontWeight = '500';
  labelSpan.title = isFirstTime ? 
    `First time extracting ${label}: ${value}` : 
    `${label} matches extension storage: ${value}`;
  labelSpan.classList.add('qse-verified-label');
  const afterNode = document.createTextNode(afterLabel);
  
  // Replace the original text node
  const parent = textNode.parentNode;
  parent.insertBefore(beforeNode, textNode);
  parent.insertBefore(labelSpan, textNode);
  parent.insertBefore(afterNode, textNode);
  parent.removeChild(textNode);
  
  console.log(`🎯 Successfully wrapped label "${labelText}" in green span`);
}

/**
 * Store ticker data only if it has changed
 * @param {string} ticker - Stock ticker
 * @param {Object} newData - New float data
 */
async function storeTickerDataIfChanged(ticker, newData) {
  try {
    // Check if chrome.storage is available
    if (!chrome || !chrome.storage) {
      console.error('❌ Chrome storage API not available');
      return;
    }

    // Get existing data
    const result = await chrome.storage.local.get(`ticker_${ticker}`);
    const existingData = result[`ticker_${ticker}`];
    
    // Check if data has changed
    if (existingData) {
      const fieldsToCheck = [
        'latestFloat', 'sharesOutstanding', 'estimatedCash',
        'sector', 'industry', 'country', 'exchange', 'institutionalOwnership',
        'marketCap', 'enterpriseValue', 'regularMarketChange', 'extendedMarketChange'
      ];
      
      const changes = [];
      for (const field of fieldsToCheck) {
        const oldValue = JSON.stringify(existingData[field]);
        const newValue = JSON.stringify(newData[field]);
        if (oldValue !== newValue) {
          changes.push({ field, oldValue: existingData[field], newValue: newData[field] });
        }
      }
      
      if (changes.length === 0) {
        console.log(`💾 Data unchanged for ${ticker}, skipping storage`);
        return;
      }
      
      console.log(`🔄 Data changed for ${ticker}:`);
      changes.forEach(({ field, oldValue, newValue }) => {
        console.log(`   ${field}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
      });
    }
    
    // Store updated data
    const storageKey = `ticker_${ticker}`;
    await chrome.storage.local.set({
      [storageKey]: newData
    });
    
    console.log(`💾 Stored data for ${ticker}:`, newData);
    
    // Also update the general ticker list
    const tickerListResult = await chrome.storage.local.get('ticker_list');
    const tickerList = tickerListResult.ticker_list || [];
    
    if (!tickerList.includes(ticker)) {
      tickerList.push(ticker);
      await chrome.storage.local.set({ ticker_list: tickerList });
      console.log(`📝 Added ${ticker} to ticker list`);
    }
    
  } catch (error) {
    console.error('❌ Error storing ticker data:', error);
  }
}
