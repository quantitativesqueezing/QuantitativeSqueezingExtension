/**
 * @file
 * content.js
 * 
 * — scans text nodes for $TICKER patterns and shows a tooltip on hover.
 * — zero‑mutation hover detector for $TICKER patterns.
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
let lastReferenceRect = null;

function cancelHideTimer() {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
}

/* Tooltip creation and helpers */
function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  const el = document.createElement('div');
  el.className = 'shi-tooltip';
  el.innerHTML = `
    <div class="shi-header">
      <div class="shi-header-top">
        <div class="shi-header-info">
          <div class="shi-symbol"></div>
          <div class="shi-updated"></div>
        </div>
        <div class="shi-header-links">
          <a href="#" class="refresh-data-link dilutiontracker" target="_blank" rel="noopener noreferrer">DilutionTracker</a>
          <a href="#" class="refresh-data-link fintel" target="_blank" rel="noopener noreferrer">Fintel</a>
        </div>
      </div>
      <div class="shi-price-changes">
        <div class="shi-regular-change"></div>
        <div class="shi-extended-change"></div>
      </div>
    </div>
    <div class="shi-body">
      <div class="shi-columns">
        <div class="shi-column shi-column-left">
          <div class="shi-section shi-float-info">
            <div class="shi-row"><span>Free Float:</span><span class="shi-float">—</span></div>
            <div class="shi-row"><span>Shares Outstanding:</span><span class="shi-shares-outstanding">—</span></div>
          </div>
          <div class="shi-section shi-short-info">
            <div class="shi-row"><span>Short Interest:</span><span class="shi-short-interest">—</span></div>
            <div class="shi-row"><span>Short Interest Ratio:</span><span class="shi-short-interest-ratio">—</span></div>
            <div class="shi-row"><span>Short Float %:</span><span class="shi-short-interest-percent-float">—</span></div>
            <div class="shi-row"><span>Cost To Borrow:</span><span class="shi-cost-to-borrow">—</span></div>
            <div class="shi-row"><span>Short Shares Available:</span><span class="shi-short-shares-available">—</span></div>
            <div class="shi-row"><span>Short-Exempt Volume:</span><span class="shi-finra-exempt-volume">—</span></div>
            <div class="shi-row"><span>Failure To Deliver (FTDs):</span><span class="shi-failure-to-deliver">—</span></div>
            <div class="shi-row"><span>Reg SHO Min FTDs:</span><span class="shi-regsho-min-ftds">—</span></div>
          </div>
          <div class="shi-section shi-financial-info">
            <div class="shi-row"><span>Market Cap:</span><span class="shi-market-cap">—</span></div>
            <div class="shi-row"><span>Estimated Cash:</span><span class="shi-est-cash">—</span></div>
            <div class="shi-row"><span>Est. Net Cash/Sh:</span><span class="shi-est-net-cash">—</span></div>
            <div class="shi-row"><span>Institutional Ownership:</span><span class="shi-institutional-ownership">—</span></div>
            <div class="shi-row"><span>E/V:</span><span class="shi-enterprise-value">—</span></div>
          </div>
          <div class="shi-section shi-company-info">
            <div class="shi-row"><span>Country:</span><span class="shi-country">—</span></div>
            <div class="shi-row"><span>Sector:</span><span class="shi-sector">—</span></div>
            <div class="shi-row"><span>Industry:</span><span class="shi-industry">—</span></div>
            <div class="shi-row"><span>Exchange:</span><span class="shi-exchange">—</span></div>
            <div class="shi-row"><span>Options Trading:</span><span class="shi-options-enabled">—</span></div>
          </div>
          <div class="shi-section shi-last-update">
            <div class="shi-row"><span>Last Update:</span><span class="shi-last-data-update">—</span></div>
          </div>
        </div>
        <div class="shi-column shi-column-right">
          <div class="shi-table-placeholder">Loading…</div>
        </div>
      </div>
    </div>
    <div class="shi-footer">
      <span class="shi-source">Source: DT / FNTL</span>
    </div>
  `;
  document.documentElement.appendChild(el);
  // Hide on mouseout
  el.addEventListener('mouseleave', hideTooltip);
  el.addEventListener('mouseenter', cancelHideTimer);
  tooltipEl = el;
  return el;
}

function updateHeaderLinks(root, symbol) {
  if (!root) return;
  const trimmed = typeof symbol === 'string' ? symbol.trim() : '';
  if (!trimmed) return;
  const upper = trimmed.toUpperCase();
  const encoded = encodeURIComponent(upper);

  const dilutionLink = root.querySelector('.refresh-data-link.dilutiontracker');
  if (dilutionLink) {
    dilutionLink.href = `https://dilutiontracker.com/app/search/${encoded}`;
    dilutionLink.title = `Open DilutionTracker for ${upper}`;
  }

  const fintelLink = root.querySelector('.refresh-data-link.fintel');
  if (fintelLink) {
    fintelLink.href = `https://fintel.io/ss/us/${encoded}`;
    fintelLink.title = `Open Fintel short squeeze data for ${upper}`;
  }
}

function positionTooltip(referenceRect) {
  const el = ensureTooltip();
  const pad = 12;
  const maxW = 600;
  el.style.maxWidth = `${maxW}px`;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const tooltipWidth = Math.min(maxW, el.offsetWidth || maxW);
  const tooltipHeight = el.offsetHeight || 100;

  let left = (viewportWidth - tooltipWidth) / 2;
  let top = (viewportHeight - tooltipHeight) / 2;

  if (referenceRect) {
    left = referenceRect.left + (referenceRect.width / 2) - (tooltipWidth / 2);
    top = referenceRect.bottom + 8;

    if (left < pad) left = pad;
    if (left + tooltipWidth + pad > viewportWidth) {
      left = Math.max(pad, viewportWidth - tooltipWidth - pad);
    }

    if (top + tooltipHeight + pad > viewportHeight) {
      const above = referenceRect.top - tooltipHeight - 8;
      if (above >= pad) {
        top = above;
      } else {
        top = Math.max(pad, viewportHeight - tooltipHeight - pad);
      }
    }
  } else {
    left = Math.min(Math.max(pad, left), viewportWidth - tooltipWidth - pad);
    top = Math.min(Math.max(pad, top), viewportHeight - tooltipHeight - pad);
  }

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function cloneRect(rect) {
  if (!rect) return null;
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
}

function deriveReferenceRect(target, node, start, end) {
  let el = null;
  if (target instanceof Element) {
    el = target.closest('a, .shi-ticker, [data-ticker], [data-symbol], [data-quote]');
  }
  if (!el && node && node.parentElement) {
    el = node.parentElement.closest('a, .shi-ticker, [data-ticker], [data-symbol], [data-quote]');
  }
  if (el && el.getBoundingClientRect) {
    const rect = cloneRect(el.getBoundingClientRect());
    if (rect && (rect.width > 0 || rect.height > 0)) return rect;
  }

  if (node && typeof start === 'number' && typeof end === 'number' && end > start) {
    try {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      if (range.getClientRects) {
        const rectList = Array.from(range.getClientRects());
        if (rectList.length) {
          const union = {
            top: rectList[0].top,
            right: rectList[0].right,
            bottom: rectList[0].bottom,
            left: rectList[0].left
          };
          for (let i = 1; i < rectList.length; i++) {
            const r = rectList[i];
            union.top = Math.min(union.top, r.top);
            union.left = Math.min(union.left, r.left);
            union.right = Math.max(union.right, r.right);
            union.bottom = Math.max(union.bottom, r.bottom);
          }
          union.width = union.right - union.left;
          union.height = union.bottom - union.top;
          if (union.width > 0 || union.height > 0) {
            return union;
          }
        }
      }
      const rect = cloneRect(range.getBoundingClientRect());
      if (rect && (rect.width > 0 || rect.height > 0)) {
        return rect;
      }
    } catch (err) {
      // ignore - fallback below
    }
  }

  if (target instanceof Element && target.getBoundingClientRect) {
    const rect = cloneRect(target.getBoundingClientRect());
    if (rect) return rect;
  }

  return null;
}

function pointToRect(x, y) {
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  return {
    top: y - 0.5,
    bottom: y + 0.5,
    left: x - 0.5,
    right: x + 0.5,
    width: 1,
    height: 1
  };
}

function isPointLikeRect(rect) {
  if (!rect) return false;
  return rect.width <= 1.5 && rect.height <= 1.5;
}

function formatShortFloatPercentDisplay(value, shortInterest, float) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.endsWith('%')) return trimmed;
  }

  const computed = computeShortFloatPercent(shortInterest, float);
  if (computed) return computed;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const pct = value <= 1 ? value * 100 : value;
    return `${stripTrailingZeros(pct.toFixed(2))}%`;
  }

  if (value != null) {
    const str = String(value).trim();
    const match = str.match(/([+-]?\d+(?:\.\d+)?)/);
    if (match) {
      const parsed = parseFloat(match[1]);
      if (Number.isFinite(parsed)) {
        const pct = str.includes('%') || parsed > 1 ? parsed : parsed * 100;
        return `${stripTrailingZeros(pct.toFixed(2))}%`;
      }
    }
  }

  return 'N/A';
}

function stripTrailingZeros(text) {
  return text.replace(/\.00$/, '').replace(/(\.[1-9])0$/, '$1');
}

function formatMagnitude(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  let scaled = abs;
  let suffix = '';
  if (abs >= 1e12) {
    scaled = abs / 1e12;
    suffix = 'T';
  } else if (abs >= 1e9) {
    scaled = abs / 1e9;
    suffix = 'B';
  } else if (abs >= 1e6) {
    scaled = abs / 1e6;
    suffix = 'M';
  } else if (abs >= 1e3) {
    scaled = abs / 1e3;
    suffix = 'K';
  }
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${sign}${stripTrailingZeros(scaled.toFixed(decimals))}${suffix}`;
}

function formatSharesDisplay(value) {
  const formatted = formatMagnitude(value);
  return formatted ? `${formatted} shares` : 'N/A';
}

function formatRegShoShares(value) {
  const num = parseSharesValue(value);
  if (Number.isFinite(num)) {
    return `${Math.round(num).toLocaleString()} shares`;
  }
  return 'N/A';
}

function formatCurrencyDisplay(value) {
  if (value === null || value === undefined) return 'N/A';
  let numeric = null;
  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string') {
    const cleaned = value.replace(/[$,]/g, '').trim();
    if (cleaned) {
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) numeric = parsed;
    }
  }

  if (numeric === null) {
    const fallback = formatMagnitude(value);
    return fallback || 'N/A';
  }

  const formatted = formatMagnitude(numeric);
  if (!formatted) return 'N/A';
  if (formatted.startsWith('-')) {
    return `-$${formatted.slice(1)}`;
  }
  return `$${formatted}`;
}

function formatPercentValue(value) {
  if (value === null || value === undefined) return 'N/A';
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  return `${stripTrailingZeros(num.toFixed(2))}%`;
}

function formatDaysValue(value) {
  if (value === null || value === undefined) return 'N/A';
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  return `${stripTrailingZeros(num.toFixed(2))} days`;
}

function formatOptionsTrading(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Unknown';
}

function parseSharesValue(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value)
    .replace(/shares?/ig, '')
    .replace(/,/g, '')
    .trim();
  if (!cleaned) return NaN;
  const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)([KMB])?$/i);
  if (match) {
    const raw = parseFloat(match[1]);
    if (!Number.isFinite(raw)) return NaN;
    const unit = match[2] ? match[2].toUpperCase() : '';
    const mult = unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
    return raw * mult;
  }
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function formatShortInterestDisplay(value) {
  const num = parseSharesValue(value);
  if (Number.isFinite(num)) {
    return `${Math.round(num).toLocaleString()} shares`;
  }
  if (typeof value === 'string' && value.trim()) {
    const cleaned = value.replace(/shares?/ig, '').trim();
    if (cleaned && !/^n\/?a$/i.test(cleaned)) return `${cleaned} shares`;
  }
  return 'N/A';
}

function computeShortFloatPercent(shortInterest, float) {
  const si = parseSharesValue(shortInterest);
  const fl = parseSharesValue(float);
  if (!Number.isFinite(si) || !Number.isFinite(fl) || fl <= 0) return null;
  const pct = (si / fl) * 100;
  return `${stripTrailingZeros(pct.toFixed(2))}%`;
}

function renderFintelTables(container, data) {
  if (!container) return;
  container.innerHTML = '';

  const configs = [
    { key: 'shortBorrowRateTable', title: 'Cost To Borrow', maxRows: 5 },
    { key: 'failsToDeliverTable', title: 'Failure To Deliver (FTDs)', maxRows: 5 },
    { key: 'shortSharesAvailabilityTable', title: 'Short Shares Available', maxRows: 3, preferredColumns: ['timeSinceLastChange', 'shortSharesAvailability'] }
  ];

  let hasContent = false;

  configs.forEach(cfg => {
    const rows = Array.isArray(data?.[cfg.key]) ? data[cfg.key] : null;
    if (!rows || !rows.length) return;
    const card = buildMiniTableCard(cfg.title, rows, cfg.maxRows || 5, cfg.preferredColumns || []);
    if (card) {
      container.appendChild(card);
      hasContent = true;
    }
  });

  if (!hasContent) {
    const empty = document.createElement('div');
    empty.className = 'shi-table-empty';
    empty.textContent = 'No recent Fintel table data';
    container.appendChild(empty);
  }
}

function buildMiniTableCard(title, rows, maxRows, preferredColumns) {
  const columns = deriveTableColumns(rows, preferredColumns);
  if (!columns.length) return null;

  const card = document.createElement('div');
  card.className = 'shi-table-card';

  const heading = document.createElement('div');
  heading.className = 'shi-table-title';
  heading.textContent = title;
  card.appendChild(heading);

  const table = document.createElement('table');
  table.className = 'shi-mini-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  columns.forEach(col => {
    const th = document.createElement('th');
    th.textContent = prettifyColumnName(col);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.slice(0, maxRows).forEach(row => {
    const tr = document.createElement('tr');
    columns.forEach(col => {
      const td = document.createElement('td');
      const val = row && Object.prototype.hasOwnProperty.call(row, col) ? row[col] : '';
      td.textContent = val && String(val).trim() !== '' ? val : '—';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  card.appendChild(table);
  return card;
}

function deriveTableColumns(rows, preferredColumns) {
  if (!rows || !rows.length) return [];
  let columns = [];
  if (preferredColumns && preferredColumns.length) {
    columns = preferredColumns.filter(col => rows.some(row => row && row[col] != null && String(row[col]).trim() !== ''));
  }
  if (!columns.length) {
    const set = new Set();
    rows.forEach(row => {
      Object.keys(row || {}).forEach(key => {
        const value = row[key];
        if (value != null && String(value).trim() !== '') {
          set.add(key);
        }
      });
    });
    columns = Array.from(set);
  }
  if (columns.includes('date')) {
    columns = ['date', ...columns.filter(col => col !== 'date')];
  }
  const seen = new Set();
  columns = columns.filter(col => {
    const key = String(col).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return columns.slice(0, 4);
}

function prettifyColumnName(name) {
  if (!name) return '';
  if (/\s/.test(name)) return name;
  const spaced = name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.replace(/\b\w/g, ch => ch.toUpperCase());
}

function showLoading(symbol, referenceRect) {
  const el = ensureTooltip();
  cancelHideTimer();
  
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
  safeSetText('.shi-market-cap', '—');
  safeSetText('.shi-est-cash', '—');
  safeSetText('.shi-est-net-cash', '—');
  safeSetText('.shi-institutional-ownership', '—');
  safeSetText('.shi-enterprise-value', '—');
  safeSetText('.shi-short-interest', '—');
  safeSetText('.shi-short-interest-ratio', '—');
  safeSetText('.shi-short-interest-percent-float', '—');
  safeSetText('.shi-cost-to-borrow', '—');
  safeSetText('.shi-short-shares-available', '—');
  safeSetText('.shi-finra-exempt-volume', '—');

  safeSetText('.shi-country', '—');
  safeSetText('.shi-sector', '—');
  safeSetText('.shi-industry', '—');
  safeSetText('.shi-exchange', '—');
  safeSetText('.shi-options-enabled', '—');
  safeSetText('.shi-last-data-update', '—');
  
  // Clear price changes
  safeSetText('.shi-regular-change', '');
  safeSetText('.shi-extended-change', '');

  const rightCol = el.querySelector('.shi-column-right');
  if (rightCol) rightCol.innerHTML = '<div class="shi-table-placeholder">Loading…</div>';

  updateHeaderLinks(el, symbol);
  if (referenceRect) {
    lastReferenceRect = referenceRect;
  }
  
  el.style.display = 'block';
  positionTooltip(referenceRect || lastReferenceRect);
}

function showData(symbol, referenceRect, data) {
  console.log(data);
  const el = ensureTooltip();
  cancelHideTimer();
  if (referenceRect) {
    lastReferenceRect = referenceRect;
  }
  
  console.log('📊 showData received for', symbol, ':', data);
  console.log('📊 Tooltip element:', el);
  console.log('🔍 Data type check:', typeof data, 'Is object:', typeof data === 'object');
  
  // Debug specific field values being set
  const fieldsToCheck = [
    'shortInterest', 'shortInterestRatio', 'shortInterestPercentFloat',
    'optionsTradingEnabled',
    'costToBorrow', 'shortSharesAvailable', 'finraExemptVolume', 'failureToDeliver'
  ];
  
  console.log('🎯 Field values being set:');
  fieldsToCheck.forEach(field => {
    const value = data?.[field];
    console.log(`   ${field}: "${value}" (type: ${typeof value})`);
  });

  // Helper function to safely set text content
  function safeSetText(selector, value) {
    const element = el.querySelector(selector);
    if (element) {
      const textValue = (value === null || value === undefined) ? 'N/A' : value;
      element.textContent = textValue;
    } else {
      console.error(`❌ Element not found: ${selector}`);
      console.log('Available elements:', Array.from(el.querySelectorAll('*')).map(e => e.className).filter(c => c));
    }
  }

  console.log(data);

  // Basic info
  safeSetText('.shi-symbol', `$${symbol}`);
  safeSetText('.shi-updated', data?.fetchedAt
    ? `Updated: ${new Date(data.fetchedAt).toLocaleString()}`
    : '');
    
  // Core financial data
  safeSetText('.shi-float', formatSharesDisplay(data?.float));
  safeSetText('.shi-shares-outstanding', formatSharesDisplay(data?.sharesOutstanding));
  safeSetText('.shi-est-cash', formatCurrencyDisplay(data?.estimatedCash));
  safeSetText('.shi-institutional-ownership', formatPercentValue(data?.institutionalOwnership));
  safeSetText('.shi-market-cap', formatCurrencyDisplay(data?.marketCap));
  safeSetText('.shi-enterprise-value', formatCurrencyDisplay(data?.enterpriseValue));
  // estimatedNetCashPerShare can be numeric or string; show numeric with $ if possible
  //safeSetText('.shi-est-net-cash', formatCurrencyDisplay(data?.estimatedNetCashPerShare ?? null));

  // Short interest information (from Fintel)
  safeSetText('.shi-short-interest', formatShortInterestDisplay(data?.shortInterest));
  safeSetText('.shi-short-interest-ratio', formatDaysValue(data?.shortInterestRatio));
  safeSetText('.shi-short-interest-percent-float', formatShortFloatPercentDisplay(
    data?.shortInterestPercentFloat,
    data?.shortInterest,
    data?.float
  ));
  safeSetText('.shi-cost-to-borrow', formatPercentValue(data?.costToBorrow));
  safeSetText('.shi-short-shares-available', formatSharesDisplay(data?.shortSharesAvailable));
  safeSetText('.shi-finra-exempt-volume', formatSharesDisplay(data?.finraExemptVolume));
  safeSetText('.shi-failure-to-deliver', formatSharesDisplay(data?.failureToDeliver));
  safeSetText('.shi-regsho-min-ftds', formatRegShoShares(data?.regShoMinFtds));
  
  // Company information
  console.log(`🏢 Setting company info in popup:`);
  console.log(`   Sector: "${data?.sector}"`);
  console.log(`   Industry: "${data?.industry}"`);
  console.log(`   Country: "${data?.country}"`);
  console.log(`   Exchange: "${data?.exchange}"`);
  
  safeSetText('.shi-sector', data?.sector ?? 'N/A');
  safeSetText('.shi-industry', data?.industry ?? 'N/A');
  safeSetText('.shi-country', data?.country ?? 'N/A');
  safeSetText('.shi-exchange', data?.exchange ?? 'N/A');
  safeSetText('.shi-options-enabled', formatOptionsTrading(data?.optionsTradingEnabled));
  
  // Last update information
  safeSetText('.shi-last-data-update', data?.lastDataUpdate ?? 'N/A');
  
  const rightCol = el.querySelector('.shi-column-right');
  renderFintelTables(rightCol, data);

  updateHeaderLinks(el, symbol);

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
  positionTooltip(referenceRect || lastReferenceRect);
}

function hideTooltip(arg) {
  const delay = typeof arg === 'number' ? arg : 1000;
  cancelHideTimer();
  if (delay <= 0) {
    if (tooltipEl) tooltipEl.style.display = 'none';
    lastSymbol = null;
    lastReferenceRect = null;
    return;
  }
  hideTimeout = setTimeout(() => {
    if (tooltipEl) tooltipEl.style.display = 'none';
    lastSymbol = null;
    lastReferenceRect = null;
    hideTimeout = null;
  }, delay);
}

async function fetchPack(symbol) {
  console.log('📦 fetchPack() START - using stored data for:', symbol);
  const key = symbol.toUpperCase();
  
  // Get stored data from extension storage
  const storedData = await getStoredTickerData(key);
  
  if (!storedData) {
    console.log(`❌ No stored data available for ${key}, returning default pack`);
    return {
      fetchedAt: Date.now(),
      float: 'N/A', shortInterest: 'N/A', costToBorrow: 'N/A', 
      failureToDeliver: 'N/A', shortInterestRatio: 'N/A',
      shortInterestPercentFloat: 'N/A', shortSharesAvailable: 'N/A',
      finraExemptVolume: 'N/A', lastDataUpdate: 'N/A'
    };
  }
  
  const now = Date.now();
  const pack = {
    fetchedAt: storedData?.lastUpdated || now,
    float: storedData?.latestFloat ? `${storedData.latestFloat}M Shares` : 'N/A',
    sharesOutstanding: storedData?.sharesOutstanding || 'N/A',
    estimatedCash: storedData?.estimatedCash || 'N/A',
    institutionalOwnership: storedData?.institutionalOwnership || 'N/A',
    marketCap: storedData?.marketCap || 'N/A',
    enterpriseValue: storedData?.enterpriseValue || 'N/A',
    // Enhanced Fintel.io fields
    shortInterest: storedData?.shortInterest || 'N/A',
    shortInterestRatio: storedData?.shortInterestRatio || 'N/A',
    shortInterestPercentFloat: storedData?.shortInterestPercentFloat || 'N/A',
    costToBorrow: storedData?.costToBorrow || 'N/A',
    shortSharesAvailable: storedData?.shortSharesAvailable || 'N/A',
    finraExemptVolume: storedData?.finraExemptVolume || 'N/A',
    failureToDeliver: storedData?.failureToDeliver || 'N/A',
    lastDataUpdate: storedData?.lastDataUpdate || 'N/A',
    shortBorrowRateTable: storedData?.shortBorrowRateTable || null,
    failsToDeliverTable: storedData?.failsToDeliverTable || null,
    shortSharesAvailabilityTable: storedData?.shortSharesAvailabilityTable || null,
    // Company information
    sector: storedData?.sector || 'N/A',
    industry: storedData?.industry || 'N/A',
    country: storedData?.country || 'N/A',
    exchange: storedData?.exchange || 'N/A',
    // Price changes
    regularMarketChange: storedData?.regularMarketChange || null,
    extendedMarketChange: storedData?.extendedMarketChange || null
  };

  console.log(`📦 fetchPack() RESULT for ${key}:`, pack);
  console.log(`🔍 Key mappings check:`);
  console.log(`   storedData.shortInterest: "${storedData.shortInterest}" → pack.shortInterest: "${pack.shortInterest}"`);
  console.log(`   storedData.costToBorrow: "${storedData.costToBorrow}" → pack.costToBorrow: "${pack.costToBorrow}"`);
  console.log(`   storedData.shortInterestRatio: "${storedData.shortInterestRatio}" → pack.shortInterestRatio: "${pack.shortInterestRatio}"`);
  console.log(`🏢 Company fields check:`);
  console.log(`   storedData.sector: "${storedData?.sector}" → pack.sector: "${pack.sector}"`);
  console.log(`   storedData.industry: "${storedData?.industry}" → pack.industry: "${pack.industry}"`);
  console.log(`   storedData.country: "${storedData?.country}" → pack.country: "${pack.country}"`);
  console.log(`   storedData.exchange: "${storedData?.exchange}" → pack.exchange: "${pack.exchange}"`);
  console.log(`   storedData.institutionalOwnership: "${storedData?.institutionalOwnership}" → pack.institutionalOwnership: "${pack.institutionalOwnership}"`);

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
      console.log(`🔍 Available fields in stored data:`, Object.keys(data));
      
      // Debug specific fintel fields
      const fintelFields = [
        'shortInterest', 'shortInterestRatio', 'shortInterestPercentFloat',
        'costToBorrow', 'shortSharesAvailable', 'finraExemptVolume', 
        'failureToDeliver', 'lastDataUpdate'
      ];
      
      console.log(`🎯 Fintel fields status:`);
      fintelFields.forEach(field => {
        console.log(`   ${field}: ${data[field] || 'MISSING'}`);
      });
      
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
  if (!isFinite(n)) return 'N/A';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return String(Math.round(n));
}

// Message listener removed - service worker handles fetch-pack messages

/* Main pointer handler */
document.addEventListener('mousemove', (event) => {
  const target = event.target;
  const pointerX = event.clientX;
  const pointerY = event.clientY;

  // Throttle to animation frame
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;

    const tooltip = tooltipEl;
    if (tooltip && target && tooltip.contains(target)) {
      cancelHideTimer();
      return;
    }

    // Skip editable fields and code editors
    if (target && target.closest && target.closest('input, textarea, [contenteditable], .monaco-editor, .CodeMirror, [role="textbox"]')) {
      hideTooltip();
      return;
    }

    // Use caretRangeFromPoint or caretPositionFromPoint to find text node
    let range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(pointerX, pointerY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(pointerX, pointerY);
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
    const text = node.textContent || '';
    const offset = range.startOffset;

    // Extract the word under the cursor
    let start = offset;
    let end = offset;
    while (start > 0 && /\S/.test(text[start - 1])) start--;
    while (end < text.length && /\S/.test(text[end])) end++;
    const rawWord = text.slice(start, end);
    const word = rawWord.trim();

    const match = word.match(/^\$([A-Za-z]{1,5})\b/);
    if (!match) {
      hideTooltip();
      return;
    }

    const symbol = match[1].toUpperCase();
    console.log(symbol);

    const matchedText = match[0];
    const relativeIndex = rawWord.indexOf(matchedText);
    let rectStart = start;
    let rectEnd = end;
    if (relativeIndex >= 0) {
      rectStart = start + relativeIndex;
      rectEnd = rectStart + matchedText.length;
    }

    let referenceRect = deriveReferenceRect(target, node, rectStart, rectEnd);
    if (!referenceRect) {
      referenceRect = deriveReferenceRect(target, node, start, end);
    }
    if (!referenceRect) {
      referenceRect = pointToRect(pointerX, pointerY);
    }
    if (!referenceRect && lastSymbol === symbol) {
      referenceRect = lastReferenceRect;
    }
    if (!referenceRect) {
      hideTooltip();
      return;
    }

    // Reposition if same symbol, no refetch
    if (lastSymbol === symbol) {
      if (!isPointLikeRect(referenceRect)) {
        lastReferenceRect = referenceRect;
      }
      cancelHideTimer();
      positionTooltip(lastReferenceRect || referenceRect);
      return;
    }

    if (isPointLikeRect(referenceRect) && lastReferenceRect && !isPointLikeRect(lastReferenceRect)) {
      referenceRect = lastReferenceRect;
    }

    lastSymbol = symbol;
    lastReferenceRect = referenceRect;
    showLoading(symbol, referenceRect);
    console.log(`📡 Content script: Requesting data for ${symbol}`);
    
    // Check if chrome.runtime is available
    if (!chrome || !chrome.runtime) {
      console.error('❌ Chrome runtime not available');
      showData(symbol, lastReferenceRect, { 
        float: 'Extension Error',
        shortInterest: 'Not Available',
        costToBorrow: 'Not Available', 
        failureToDeliver: 'Not Available'
      });
      return;
    }

    chrome.runtime.sendMessage({ type: 'fetch-pack', symbol }, (data) => {
      console.log(data);
      if (chrome.runtime.lastError) {
        console.error(`❌ Content script: Runtime error for ${symbol}:`, chrome.runtime.lastError);
        showData(symbol, lastReferenceRect, { 
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
        showData(symbol, lastReferenceRect, data || {
          float: 'N/A',
          shortInterest: 'N/A', 
          ctb: 'N/A',
          ftd: 'N/A'
        });
      }
    });
  });
});

// Also hide on scroll or when leaving the tooltip
document.addEventListener('scroll', () => hideTooltip(0), { passive: true });
