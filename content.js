/**
 * @file
 * content.js
 * 
 * — scans text nodes for $TICKER patterns and shows a tooltip on hover.
 * — zero‑mutation hover detector for $TICKER patterns.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // symbol -> { fetchedAt, float, shortInterest, ctb, ftd }

// Daily cache (per ticker, resets at local midnight)
const dailyCache = new Map(); // symbol -> { dayKey, pack }

// Simple per-URL minute cache + host rate limit for fintel.io
const minuteCache = new Map(); // url -> { ts, text }
const hostLastHit = new Map();  // host -> ts
const ONE_MINUTE = 60 * 1000;

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`; // local day key
}

let tooltipEl;
let lastSymbol = null;
let rafId = null;
let hideTimeout = null;

/* Tooltip creation and helpers */
function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  const el = document.createElement('div');
  el.className = 'shi-tooltip';
  el.innerHTML = `
    <div class="shi-header">
      <div class="shi-header-top">
        <div class="shi-symbol"></div>
        <div class="shi-updated"></div>
      </div>
      <div class="shi-price-changes">
        <div class="shi-regular-change"></div>
        <div class="shi-extended-change"></div>
      </div>
    </div>
    <div class="shi-body">
      <div class="shi-row"><span>Free Float</span><span class="shi-float">—</span></div>
      <div class="shi-row"><span>Shares Outstanding</span><span class="shi-shares-outstanding">—</span></div>
      <div class="shi-row"><span>Estimated Cash</span><span class="shi-cash">—</span></div>
      <div class="shi-row"><span>Market Cap</span><span class="shi-market-cap">—</span></div>
      <div class="shi-row"><span>Enterprise Value</span><span class="shi-enterprise-value">—</span></div>
      <div class="shi-short-info">
        <div class="shi-row"><span>Short Interest</span><span class="shi-short-interest">—</span></div>
        <div class="shi-row"><span>Cost To Borrow</span><span class="shi-cost-to-borrow">—</span></div>
        <div class="shi-row"><span>Failure To Deliver</span><span class="shi-failure-to-deliver">—</span></div>
        <div class="shi-row"><span>Short Shares Available</span><span class="shi-short-shares-available">—</span></div>
        <div class="shi-row"><span>Short-Exempt Volume</span><span class="shi-short-exempt-volume">—</span></div>
      </div>
      <div class="shi-company-info">
        <div class="shi-row"><span>Sector</span><span class="shi-sector">—</span></div>
        <div class="shi-row"><span>Industry</span><span class="shi-industry">—</span></div>
        <div class="shi-row"><span>Country</span><span class="shi-country">—</span></div>
      </div>
    </div>
    <div class="shi-footer">
      <span class="shi-source">Source: DilutionTracker.com</span>
    </div>
  `;
  document.documentElement.appendChild(el);
  // Hide on mouseout
  el.addEventListener('mouseleave', hideTooltip);
  tooltipEl = el;
  return el;
}

function positionTooltip(x, y) {
  const el = ensureTooltip();
  const pad = 12;
  const maxW = 360;
  el.style.maxWidth = `${maxW}px`;
  el.style.left = `${Math.min(x + 16, window.innerWidth - maxW - pad)}px`;
  // Wait for height to calculate; fallback to 100px
  const h = el.offsetHeight || 100;
  el.style.top = `${Math.min(y + 16, window.innerHeight - h - pad)}px`;
}

function showLoading(symbol, x, y) {
  const el = ensureTooltip();
  clearTimeout(hideTimeout);
  
  // Helper function to safely set text content
  function safeSetText(selector, value) {
    const element = el.querySelector(selector);
    if (element) {
      element.textContent = value;
    }
  }
  
  safeSetText('.shi-symbol', `$${symbol}`);
  safeSetText('.shi-updated', 'Loading…');
  safeSetText('.shi-float', '—');
  safeSetText('.shi-shares-outstanding', '—');
  safeSetText('.shi-cash', '—');
  safeSetText('.shi-market-cap', '—');
  safeSetText('.shi-enterprise-value', '—');
  safeSetText('.shi-short-interest', '—');
  safeSetText('.shi-cost-to-borrow', '—');
  safeSetText('.shi-failure-to-deliver', '—');
  safeSetText('.shi-short-shares-available', '—');
  safeSetText('.shi-short-exempt-volume', '—');
  safeSetText('.shi-sector', '—');
  safeSetText('.shi-industry', '—');
  safeSetText('.shi-country', '—');
  
  // Clear price changes
  safeSetText('.shi-regular-change', '');
  safeSetText('.shi-extended-change', '');
  
  el.style.display = 'block';
  positionTooltip(x, y);
}

function showData(symbol, x, y, data) {
  const el = ensureTooltip();
  clearTimeout(hideTimeout);
  
  console.log('📊 showData received:', data);
  console.log('📊 Tooltip element:', el);
  console.log('📊 Tooltip HTML:', el.innerHTML.substring(0, 200) + '...');

  // Helper function to safely set text content
  function safeSetText(selector, value) {
    const element = el.querySelector(selector);
    if (element) {
      element.textContent = value;
    } else {
      console.error(`❌ Element not found: ${selector}`);
      console.log('Available elements:', Array.from(el.querySelectorAll('*')).map(e => e.className).filter(c => c));
    }
  }

  // Basic info
  safeSetText('.shi-symbol', `$${symbol}`);
  safeSetText('.shi-updated', data?.fetchedAt
    ? `Updated: ${new Date(data.fetchedAt).toLocaleString()}`
    : '');
    
  // Core financial data
  safeSetText('.shi-float', data?.float ?? 'n/a');
  safeSetText('.shi-shares-outstanding', data?.sharesOutstanding 
    ? `${data.sharesOutstanding}m shares` : 'n/a');
  safeSetText('.shi-cash', data?.estimatedCash ?? 'n/a');
  safeSetText('.shi-market-cap', data?.marketCap ?? 'n/a');
  safeSetText('.shi-enterprise-value', data?.enterpriseValue ?? 'n/a');
  
  // Short interest information (from Fintel)
  safeSetText('.shi-short-interest', data?.shortInterest ?? 'n/a');
  safeSetText('.shi-cost-to-borrow', data?.costToBorrow ?? 'n/a');
  safeSetText('.shi-failure-to-deliver', data?.failureToDeliver ?? 'n/a');
  safeSetText('.shi-short-shares-available', data?.shortSharesAvailable ?? 'n/a');
  safeSetText('.shi-short-exempt-volume', data?.shortExemptVolume ?? 'n/a');
  
  // Company information
  safeSetText('.shi-sector', data?.sector ?? 'n/a');
  safeSetText('.shi-industry', data?.industry ?? 'n/a');
  safeSetText('.shi-country', data?.country ?? 'n/a');
  
  // Price changes with original styles
  const regularChangeEl = el.querySelector('.shi-regular-change');
  const extendedChangeEl = el.querySelector('.shi-extended-change');
  
  if (regularChangeEl) {
    if (data?.regularMarketChange) {
      regularChangeEl.textContent = data.regularMarketChange.text || '';
      if (data.regularMarketChange.styles) {
        regularChangeEl.setAttribute('style', data.regularMarketChange.styles);
      }
    } else {
      regularChangeEl.textContent = '';
    }
  }
  
  if (extendedChangeEl) {
    if (data?.extendedMarketChange) {
      extendedChangeEl.textContent = data.extendedMarketChange.text || '';
      if (data.extendedMarketChange.styles) {
        extendedChangeEl.setAttribute('style', data.extendedMarketChange.styles);
      }
    } else {
      extendedChangeEl.textContent = '';
    }
  }
  
  el.style.display = 'block';
  positionTooltip(x, y);
}

function hideTooltip() {
  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    if (tooltipEl) tooltipEl.style.display = 'none';
    lastSymbol = null;
  }, 200);
}

async function fetchPack(symbol) {
  console.log('fetchPack() START - using stored data');
  const key = symbol.toUpperCase();
  
  // Get stored data from extension storage
  const storedData = await getStoredTickerData(key);
  
  const now = Date.now();
  const pack = {
    fetchedAt: storedData?.lastUpdated || now,
    float: storedData?.latestFloat ? `${storedData.latestFloat}m shares` : 'n/a',
    sharesOutstanding: storedData?.sharesOutstanding || null,
    estimatedCash: storedData?.estimatedCash ? `$${storedData.estimatedCash}M` : 'n/a',
    marketCap: storedData?.marketCap || 'n/a',
    enterpriseValue: storedData?.enterpriseValue || 'n/a',
    shortInterest: storedData?.shortInterest || 'n/a',
    costToBorrow: storedData?.costToBorrow || 'n/a',
    failureToDeliver: storedData?.failureToDeliver || 'n/a',
    shortSharesAvailable: storedData?.shortSharesAvailable || 'n/a',
    shortExemptVolume: storedData?.shortExemptVolume || 'n/a',
    sector: storedData?.sector || 'n/a',
    industry: storedData?.industry || 'n/a',
    country: storedData?.country || 'n/a',
    regularMarketChange: storedData?.regularMarketChange || null,
    extendedMarketChange: storedData?.extendedMarketChange || null
  };

  return pack;
}

/**
 * Get stored ticker data from extension storage
 * @param {string} ticker - Ticker symbol
 * @returns {Promise<Object|null>} Stored ticker data or null
 */
async function getStoredTickerData(ticker) {
  try {
    const result = await chrome.storage.local.get(`ticker_${ticker}`);
    const data = result[`ticker_${ticker}`];
    
    if (data) {
      console.log(`💾 Found stored data for ${ticker}:`, data);
      return data;
    } else {
      console.log(`❌ No stored data found for ${ticker}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error getting stored data for ${ticker}:`, error);
    return null;
  }
}

function valueOrNull(p) {
  return p.status === 'fulfilled' ? (p.value ?? null) : null;
}

async function fetchText(url, opts = {}) {
  const u = new URL(url, location.href);
  const host = u.hostname;

  // Include credentials so logged-in sessions help where needed
  const baseOpts = { cache: 'no-cache', credentials: 'include', ...opts };

  // Aggressive rate limit only for fintel.io
  const isFintel = /(^|\\.)fintel\\.io$/i.test(host);
  if (isFintel) {
    const now = Date.now();

    // Per-URL minute cache
    const mc = minuteCache.get(url);
    if (mc && (now - mc.ts) < ONE_MINUTE) {
      return mc.text;
    }

    // Host-wide rate limit (no more than once per minute if nothing cached)
    const last = hostLastHit.get(host) || 0;
    if ((now - last) < ONE_MINUTE && !mc) {
      throw new Error('Fintel rate-limited: skipping fetch within 60s window');
    }

    const res = await fetch(url, baseOpts);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();

    hostLastHit.set(host, now);
    minuteCache.set(url, { ts: now, text });
    return text;
  }

  // Other hosts: normal fetch
  const res = await fetch(url, baseOpts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/* ---------------------------
   Free Float (DilutionTracker -> FinViz fallback)
---------------------------- */

// fetchFreeFloat removed - now using stored data from DilutionTracker content script

/* ---------------------------
   Short Interest (Fintel)
---------------------------- */

async function fetchShortInterest(symbol) {
  // Placeholder - return mock data for now to avoid network issues
  return '15.2%';
  // Fintel short interest page
  // Common URL patterns (Fintel changes occasionally). We’ll try multiple.
  const urls = [
    `https://fintel.io/ss/us/${encodeURIComponent(symbol)}`,
    `https://fintel.io/short-interest/${encodeURIComponent(symbol)}`
  ];

  for (const url of urls) {
    try {
      let html;
      try { html = await fetchText(url); } catch (_) { continue; }
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // Heuristics: look for “Short Interest” % of float or shares
      // Try cells labeled "Short Interest %" or "Short Interest"
      let si = findByLabelText(doc, ['Short Interest % of Float','Short Interest %','Short Interest'], true);
      if (!si) {
        // Try regex fallback
        si = tryRegexFromText(doc.body?.innerText || '', /(short\s*interest(?:\s*%(?:\s*of\s*float)?)?)\s*[:\-]?\s*([\d.,]+%)/i, 2);
      }
      if (si) return si.toString().trim();
    } catch (e) {
      // try next
    }
  }
  return null;
}

/* ---------------------------
   Cost To Borrow (Fintel -> IBKR optional)
---------------------------- */

async function fetchCTB(symbol) {
  // Placeholder - return mock data for now to avoid network issues
  return '4.5%';
}

/* ---------------------------
   Latest FTD (Fintel, most recent row)
---------------------------- */

async function fetchLatestFTD(_symbol) {
  // Placeholder - return mock data for now to avoid network issues
  return '2024-01-15: 125,000';
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
  if (!isFinite(n)) return 'n/a';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return String(Math.round(n));
}

// Message listener removed - service worker handles fetch-pack messages

/* Main pointer handler */
document.addEventListener('mousemove', (e) => {
  // Throttle to animation frame
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    // Skip editable fields and code editors
    if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable], .monaco-editor, .CodeMirror, [role=\"textbox\"]')) {
      hideTooltip();
      return;
    }

    // Use caretRangeFromPoint or caretPositionFromPoint to find text node
    let range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }
    if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) {
      hideTooltip();
      return;
    }

    const node = range.startContainer;
    const text = node.textContent;
    const offset = range.startOffset;

    // Extract the word under the cursor
    let start = offset;
    let end = offset;
    while (start > 0 && /\S/.test(text[start - 1])) start--;
    while (end < text.length && /\S/.test(text[end])) end++;
    const word = text.slice(start, end).trim();

    const m = word.match(/^\$([A-Za-z]{1,5})\b/);
    if (!m) {
      hideTooltip();
      return;
    }

    const symbol = m[1].toUpperCase();
    console.log(symbol);
    // Reposition if same symbol, no refetch
    if (lastSymbol === symbol) {
      positionTooltip(e.clientX, e.clientY);
      return;
    }

    lastSymbol = symbol;
    showLoading(symbol, e.clientX, e.clientY);
    console.log(`📡 Content script: Requesting data for ${symbol}`);
    
    chrome.runtime.sendMessage({ type: 'fetch-pack', symbol }, (data) => {
      console.log(data);
      if (chrome.runtime.lastError) {
        console.error(`❌ Content script: Runtime error for ${symbol}:`, chrome.runtime.lastError);
        showData(symbol, e.clientX, e.clientY, { 
          float: 'Error', 
          shortInterest: 'Error', 
          ctb: 'Error', 
          ftd: 'Error' 
        });
        return;
      }
      
      console.log(`📊 Content script: Received data for ${symbol}:`, data);
      // Only update if still hovering same symbol
      if (lastSymbol === symbol) {
        showData(symbol, e.clientX, e.clientY, data || {
          float: 'n/a',
          shortInterest: 'n/a', 
          ctb: 'n/a',
          ftd: 'n/a'
        });
      }
    });
  });
});

// Also hide on scroll or when leaving the tooltip
document.addEventListener('scroll', hideTooltip, { passive: true });