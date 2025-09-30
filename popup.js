/* popup.js — Shows stored crawl data for the current page's ticker */
(function() {
  const $ = (sel) => document.querySelector(sel);
  // Debug mode guard: wrap console.log/debug based on chrome.storage.local.debug_mode
  (function initDebugGuard(){
    try {
      const origLog = console.log.bind(console);
      const origDebug = (console.debug || console.log).bind(console);
      let enabled = false;
      function apply(){ console.log = enabled ? origLog : function(){}; console.debug = enabled ? origDebug : function(){}; }
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
  const statusEl = $('#status');
  const urlEl = $('#url');
  const tickerEl = $('#ticker');
  const hoverContentEl = $('#hoverContent');
  const storedContentEl = $('#storedContent');
  const storedPanelEl = $('#storedPanel');
  const symbolInput = $('#symbolInput');
  const loadSymbolBtn = $('#loadSymbol');
  const debugToggle = $('#debugToggle');

  const LAST_SYMBOL_STORAGE_KEY = 'popup_last_symbol';

  // Debug mode flag (persisted in chrome.storage.local as 'debug_mode')
  let debugEnabled = false;
  function dbg(...args) { if (debugEnabled) console.log(...args); }

  if (debugToggle) {
    debugToggle.addEventListener('change', () => {
      debugEnabled = !!debugToggle.checked;
      chrome.storage.local.set({ debug_mode: debugEnabled }, () => {
        setStatus(debugEnabled ? 'Debug enabled' : 'Debug disabled');
      });
    });
  }
  if (loadSymbolBtn) {
    loadSymbolBtn.addEventListener('click', () => {
      const symbol = normalizeSymbol(symbolInput?.value);
      loadForSymbol(symbol, { manual: true });
    });
  }
  if (symbolInput) {
    symbolInput.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        const symbol = normalizeSymbol(symbolInput.value);
        loadForSymbol(symbol, { manual: true });
      }
    });
  }

  let currentSymbol = null;
  let deriveTickerFallback = null;

  async function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs && tabs[0]));
    });
  }

  function deriveTickerFromUrl(href) {
    try {
      if (!href) return null;
      const u = new URL(href);
      const s = u.href;
      // Fintel short interest pages: /ss/us/TICKER
      const m1 = s.match(/fintel\.io\/ss\/us\/([A-Z]{1,5})(?:[/?#]|$)/i);
      if (m1) return m1[1].toUpperCase();
      // DilutionTracker app search: /app/search/TICKER
      const m2 = s.match(/dilutiontracker\.com\/app\/search\/([A-Z]{1,5})(?:[/?#]|$)/i);
      if (m2) return m2[1].toUpperCase();
      return null;
    } catch { return null; }
  }

  async function getStoredForTicker(t) {
    return new Promise((resolve) => {
      if (!t) return resolve(null);
      const key = `ticker_${t}`;
      chrome.storage.local.get(key, (res) => resolve(res[key] || null));
    });
  }

  function renderData(ticker, data) {
    tickerEl.textContent = ticker || '—';
    if (storedContentEl) storedContentEl.innerHTML = '';
    if (storedPanelEl) storedPanelEl.open = !!data;
    if (!ticker) {
      setStatus('No ticker recognized from this URL', true);
      renderAllTickersHint();
      storedContentEl.dataset.json = '';
      return;
    }
    if (!data) {
      setStatus(`No stored data for ${ticker}`, true);
      renderAllTickersHint();
      storedContentEl.dataset.json = '';
      return;
    }

    // Summary
    const updated = data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'N/A';
    const summary = document.createElement('div');
    summary.className = 'small muted';
    summary.textContent = `Last Updated: ${updated}`;
    //storedContentEl.appendChild(summary);

    // Top-level fields (selected known keys)
    const fields = [
      'latestFloat','sharesOutstanding','estimatedCash','shortInterest','shortInterestRatio','shortInterestPercentFloat',
      'costToBorrow','shortSharesAvailable','finraExemptVolume','failureToDeliver',
      'sector','industry','country','exchange','optionsTradingEnabled','marketCap','enterpriseValue','lastDataUpdate', //'estimatedNetCashPerShare',
      // Derived from tables (most recent row)
      'latestCTB','latestFTD',
      // Derived metrics
      'regShoMinFtds'
    ];
    const grid = document.createElement('div');
    grid.className = 'grid2';
    const shallow = { ...data };
    delete shallow.pageCrawls;
    // Compute derived summary values from tables
    try {
      const derived = deriveLatestFromTables(data.pageCrawls || {});
      if (derived.latestCTB) shallow.latestCTB = derived.latestCTB;
      if (derived.latestFTD) shallow.latestFTD = derived.latestFTD;
    } catch {}

    // Compute shortInterestPercentFloat = shortInterest / Free Float (stored as percentage string)
    try {
      const siShares = toAbsoluteShares(shallow.shortInterest);
      const floatSource = shallow.latestFloat != null ? shallow.latestFloat : shallow.float;
      const floatShares = toAbsoluteShares(floatSource, { assumeMillions: true });
      if (siShares != null && floatShares && floatShares > 0) {
        const pctString = formatPercentDisplay((siShares / floatShares));
        shallow.shortInterestPercentFloat = pctString;
        if (data && typeof data === 'object') data.shortInterestPercentFloat = pctString;
    }
  } catch {}
    // Compute RegSHO Min FTDs = sharesOutstanding * 0.005 (display with commas)
    try {
      const soAbs = parseSharesToNumber(shallow.sharesOutstanding);
      if (soAbs) {
        const minShares = Math.round(soAbs * 0.005);
        shallow.regShoMinFtds = minShares;
      }
    } catch {}
    // Repair sharesOutstanding if it numerically equals latestFloat (handles string or number)
    if (data.pageCrawls && shallow && shallow.latestFloat != null && shallow.sharesOutstanding != null) {
      const lfNum = typeof shallow.latestFloat === 'number' ? shallow.latestFloat : parseNumUnitToMillions(shallow.latestFloat);
      const soNum = typeof shallow.sharesOutstanding === 'number' ? shallow.sharesOutstanding : parseNumUnitToMillions(shallow.sharesOutstanding);
      if (typeof lfNum === 'number' && typeof soNum === 'number' && isFinite(lfNum) && isFinite(soNum)) {
        if (Math.abs(lfNum - soNum) < 1e-6) {
          const fixed = deriveSharesFromCrawls(data.pageCrawls);
          if (typeof fixed === 'number' && fixed > 0) shallow.sharesOutstanding = fixed;
        }
      }
    }
    //const usedLabels = new Set();
    /*fields.forEach(k => {
      if (shallow[k] == null) return;
      const kElTitle = canonicalLabelFromKey(k);
      if (usedLabels.has(kElTitle)) return; // avoid duplicate Summary labels
      const kEl = document.createElement('div'); kEl.className = 'k'; kEl.textContent = kElTitle;
      const vEl = document.createElement('div'); vEl.className = 'v';
      let val = shallow[k];
      // Display-only formatting for Short Interest (commas)
      if (k === 'shortInterest') {
        vEl.textContent = formatShortInterestDisplay(val);
        grid.appendChild(kEl); grid.appendChild(vEl); usedLabels.add(kElTitle); return;
      }

      // Display-only: format Free Float and Shares Outstanding as M/B based on absolute shares
      if (k === 'latestFloat' || k === 'float' || k === 'sharesOutstanding') {
        const abs = parseSharesToNumber(val);
        if (abs != null) {
          vEl.textContent = formatAbsSharesToMB(abs) + ' shares';
          grid.appendChild(kEl); grid.appendChild(vEl); usedLabels.add(kElTitle); return;
        }
      }
      if (k === 'estimatedCash') {
        vEl.textContent = formatCashToMBDisplay(val);
      }
      else if (k === 'shortInterestPercentFloat') {
        vEl.textContent = formatPercentDisplay(val);
      }
      else if (k === 'currentCash') {
        vEl.textContent = `$${val}`;
      }
      else if (k === 'shortSharesAvailable') {
        const abs = parseSharesToNumber(val);
        vEl.textContent = abs != null ? `${Math.round(abs).toLocaleString()} shares` : String(val);
      }
      else if (k === 'costToBorrow') {
        vEl.textContent = formatPercentDisplay(val);
      }
      else if (k === 'failureToDeliver') {
        vEl.textContent = formatCashToMBDisplay(val);
      }
      else if (k === 'optionsTradingEnabled') {
        vEl.textContent = formatOptionsTradingStatus(val);
      }
      else if (k === 'regShoMinFtds') {
        vEl.textContent = formatRegShoShares(val);
      }
      else if (k === 'marketCap') {
        vEl.textContent = formatCashToMBDisplay(val);
      }
      else if (k === 'enterpriseValue' || k === 'ev') {
        vEl.textContent = formatCashToMBDisplay(val);
      } else {
        vEl.textContent = String(val);
      }
      grid.appendChild(kEl); grid.appendChild(vEl);
      usedLabels.add(kElTitle);
    });
    if (grid.children.length) {
      const title = document.createElement('div');
      title.className = 'section-title';
      title.textContent = 'Summary Fields';
      storedContentEl.appendChild(title);
      storedContentEl.appendChild(grid);
    }*/

    // Page Crawls per host
    //const crawls = data.pageCrawls || {};
    //const hostOrder = ['dilutiontracker','fintel'];
    //const hosts = Object.keys(crawls).sort((a,b) => (hostOrder.indexOf(a) === -1 ? 99 : hostOrder.indexOf(a)) - (hostOrder.indexOf(b) === -1 ? 99 : hostOrder.indexOf(b)));
    /*hosts.forEach(host => {
      const payload = crawls[host];
      const section = document.createElement('div');
      section.className = 'host-section';

      // Meta (card)
      if (payload.meta) {
        const card = document.createElement('div'); card.className = 'card host-card';
        const metaGrid = document.createElement('div'); metaGrid.className = 'grid2';
        // Render host and crawledAt first (to mimic header info prominence)
        const displayMeta = { host: host, crawledAt: payload?.meta?.crawledAt ? new Date(payload.meta.crawledAt).toLocaleString() : '', url: payload?.meta?.url || '' };
        Object.entries({ ...displayMeta, ...payload.meta }).forEach(([k,v]) => {
          if (String(k).toLowerCase() === 'title') return;
          const kEl = document.createElement('div'); kEl.className = 'k'; kEl.textContent = k;
          const vEl = document.createElement('div'); vEl.className = 'v'; vEl.textContent = String(v);
          metaGrid.appendChild(kEl); metaGrid.appendChild(vEl);
        });
        card.appendChild(metaGrid);
        section.appendChild(card);
      }

      // Inferred (card)
      if (payload.inferred && Object.keys(payload.inferred).length) {
        const card = document.createElement('div'); card.className = 'card';
        const title = document.createElement('div'); title.className = 'key'; title.textContent = 'Inferred'; card.appendChild(title);
        const infGrid = document.createElement('div'); infGrid.className = 'grid2';
        Object.entries(payload.inferred).forEach(([k,v]) => {
          if (isBlacklistedValueKey(k)) return;
          const kEl = document.createElement('div'); kEl.className = 'k'; kEl.textContent = k;
          const vEl = document.createElement('div'); vEl.className = 'v'; vEl.textContent = String(v);
          infGrid.appendChild(kEl); infGrid.appendChild(vEl);
        });
        card.appendChild(infGrid);
        section.appendChild(card);
      }

      // Values card removed per request (do not render)

      // Tables (not collapsed)
      if (Array.isArray(payload.tables) && payload.tables.length) {
        const block = document.createElement('div');
        const title = document.createElement('div'); title.className = 'key'; title.textContent = ''; block.appendChild(title);
        // Order tables as requested, then render with View More (5 rows initially)
        const order = {
          'table-short-borrow-rate': 0, // Cost To Borrow (IBKR)
          'fails-to-deliver-table': 1,  // Failure To Deliver (FTDs)
          'short-shares-availability-table': 2, // Short Shares Available (IBKR)
          'short-sale-volume-finra-table': 3 // Short Sale Volume (FINRA)
        };

        const filtered = (payload.tables || []).filter(t => {
          const idNorm = String(t.id || t.name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '');
          // Skip empty Values tables
          const mapped = mapPrettyTableName(t);
          const tableName = mapped || t.name || t.key || '';
          if (String(tableName).trim().toLowerCase() === 'values') {
            const isEmpty = !Array.isArray(t.rows) || t.rows.length === 0 || !t.rows.some(r => Object.values(r || {}).some(v => String(v ?? '').trim().length > 0));
            if (isEmpty) return false;
          }
          // Hide NASDAQ short interest and combined short-sale volume
          const normName = String(tableName).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
          if (normName === 'shortinterestdailynasdaqtable' || normName === 'shortinterestnasdaqtable') return false;
          if (normName === 'shortsalevolumecombinedtable') return false;
          return true;
        }).sort((a,b) => {
          const aKey = String(a.id || a.name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '');
          const bKey = String(b.id || b.name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '');
          const ai = (aKey in order) ? order[aKey] : 999;
          const bi = (bKey in order) ? order[bKey] : 999;
          return ai - bi;
        });

        filtered.forEach(t => {
          const mapped = mapPrettyTableName(t);
          const idNorm = String(t.id || t.name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '');
          // Special handling: Short Shares Available (IBKR)
          if (idNorm === 'short-shares-availability-table') {
            const card = buildShortSharesAvailabilityCard(t);
            block.appendChild(card);
            return;
          }
          // Generic table (render all rows; no View More)
          const headers = (t.headers && t.headers.length) ? t.headers : (t.rows && t.rows.length ? Object.keys(t.rows[0]) : []);
          const rows = (t.rows || []).map(row => headers.map(h => row[h] ?? ''));
          const titleText = mapped || t.name || t.key || 'table';
          const card = document.createElement('div'); card.className = 'card';
          const ttitle = document.createElement('div'); ttitle.className = 'table-title';
          ttitle.textContent = mapped ? titleText : `${titleText} (${rows.length})`;
          card.appendChild(ttitle);
          card.appendChild(makeTable(headers, rows, 100));
          block.appendChild(card);
        });
        section.appendChild(block);
      }

      storedContentEl.appendChild(section);
    });*/

    // Save last rendered for copy
    storedContentEl.dataset.json = JSON.stringify(data, null, 2);
  }

  function makeKV(label, obj) {
    const wrap = document.createElement('details');
    wrap.open = false;
    const sum = document.createElement('summary'); sum.textContent = label; sum.className = 'key';
    wrap.appendChild(sum);
    const pre = document.createElement('pre'); pre.className = 'mono'; pre.textContent = pretty(obj);
    wrap.appendChild(pre);
    return wrap;
  }

  function canonicalLabelFromKey(key) {
    //const raw = String(label).trim().toLowerCase();
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
      'country': 'Country',
      'ctb': 'Cost to Borrow (IBKR)',
      'crawledAt': 'Crawled At',
      'short shares available': 'Short Shares Available (IBKR)',
      'shares available': 'Short Shares Available (IBKR)',
      'available shares': 'Short Shares Available (IBKR)',
      'short-exempt volume': 'Short-Exempt Volume',
      'estimatedCash': 'Estimated Cash',
      'exempt volume': 'Short-Exempt Volume',
      'finra exempt volume': 'Short-Exempt Volume',
      'regulation sho exempt': 'Short-Exempt Volume',
      'failure to deliver': 'Failure to Deliver (FTDs)',
      'fails to deliver': 'Failure to Deliver (FTDs)',
      'ftd': 'Failure to Deliver (FTDs)',
      'float': 'Free Float',
      'free float': 'Free Float',
      'host': 'Host',
      'inferred': 'Dilution Tracker',
      'latestFloat': 'Free Float',
      'shares outstanding': 'Shares Outstanding',
      'sharesOutstanding': 'Shares Outstanding',
      'outstanding shares': 'Shares Outstanding',
      'sector': 'Sector',
      'industry': 'Industry',
      'institutionalOwnership': 'Institutional Ownership',
      'exchange': 'Exchange',
      'market cap': 'Market Cap',
      'mkt cap': 'Market Cap',
      'enterprise value': 'E/V',
      'ev': 'E/V',
      'enterpriseValue': 'E/V',
      'optionsTradingEnabled': 'Options Trading',
      'last update': 'Last Updated',
      'data as of': 'Last Updated',
      'as of': 'Last Updated',
      'marketCap': 'Market Cap',
      'url': 'URL',
      // Derived summary fields
      'latestFTD': 'Failure to Deliver (FTDs)',
      'latestCTB': 'Cost To Borrow (IBKR)',
      'regShoMinFtds': 'RegSHO Min FTDs'
    };
    if (map[key]) return map[key];
    return key;
  } 

  function createSection(title, text) {
    const details = document.createElement('details');
    details.open = true;
    const sum = document.createElement('summary');
    sum.textContent = title;
    sum.className = 'key';
    details.appendChild(sum);
    const pre = document.createElement('pre');
    pre.className = 'mono';
    pre.textContent = text;
    details.appendChild(pre);
    return details;
  }

  function makeTable(headers, rows, limit) {
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    const max = Math.min(rows.length, limit || rows.length);
    for (let i = 0; i < max; i++) {
      const tr = document.createElement('tr');
      (rows[i] || []).forEach(cell => { const td = document.createElement('td'); td.textContent = String(cell ?? ''); tr.appendChild(td); });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    if (rows.length > max) {
      const note = document.createElement('div');
      note.className = 'small muted';
      note.textContent = `Showing first ${max} of ${rows.length} rows`;
      const wrap = document.createElement('div');
      wrap.appendChild(table);
      wrap.appendChild(note);
      return wrap;
    }
    return table;
  }

  function deriveSharesFromCrawls(pageCrawls) {
    try {
      const dt = pageCrawls && pageCrawls.dilutiontracker;
      if (!dt) return null;
      // Look in values occurrences first
      if (dt.values && dt.values.sharesOutstanding && Array.isArray(dt.values.sharesOutstanding)) {
        const occ = dt.values.sharesOutstanding.find(o => /[0-9]/.test(String(o?.value || '')));
        const parsed = parseNumUnitToMillions(occ && occ.value);
        if (parsed != null) return parsed;
      }
      // Fallback to inferred
      if (dt.inferred && dt.inferred.sharesOutstanding) {
        const parsed = parseNumUnitToMillions(dt.inferred.sharesOutstanding);
        if (parsed != null) return parsed;
      }
      return null;
    } catch { return null; }
  }

  function parseNumUnitToMillions(s) {
    if (!s) return null;
    const m = String(s).match(/([0-9][\d.,]*)\s*([KMB])?/i);
    if (!m) return null;
    const raw = parseFloat(m[1].replace(/,/g, ''));
    const unit = (m[2] || 'M').toUpperCase();
    if (isNaN(raw)) return null;
    if (unit === 'B') return raw * 1000;
    if (unit === 'K') return raw / 1000;
    return raw;
  }

  // Format absolute shares to M/B string (e.g., 900000 -> 0.9M, 10400000 -> 10.4M, 1750000000 -> 1.75B)
  function formatAbsSharesToMB(n) {
    const num = Number(n);
    if (!isFinite(num)) return String(n);
    if (num >= 1e9) return trimZeros((num / 1e9).toFixed(2)) + 'B';
    return trimZeros((num / 1e6).toFixed(2)) + 'M';
  }

  function formatCashToMBDisplay(value) {
    if (value == null) return 'N/A';
    const cleaned = typeof value === 'string' ? value.replace(/\$/g, '') : value;
    const num = (typeof cleaned === 'number' && isFinite(cleaned)) ? cleaned : parseAbbrevNumber(String(cleaned));
    if (!Number.isFinite(num)) return String(value);
    const sign = num < 0 ? '-' : '';
    const abs = Math.abs(num);
    let unit;
    if (abs >= 1e12) unit = `${trimZeros((abs / 1e12).toFixed(2))}T`;
    else if (abs >= 1e9) unit = `${trimZeros((abs / 1e9).toFixed(2))}B`;
    else if (abs >= 1e6) unit = `${trimZeros((abs / 1e6).toFixed(2))}M`;
    else if (abs >= 1e3) unit = `${trimZeros((abs / 1e3).toFixed(2))}K`;
    else return `${sign}$${Math.round(abs).toLocaleString()}`;
    return `${sign}$${unit}`;
  }

  // Convert stored/share-like values to absolute share counts.
  function toAbsoluteShares(value, opts = {}) {
    const assumeMillions = !!opts.assumeMillions;
    if (value == null) return null;
    if (typeof value === 'number') {
      if (!isFinite(value)) return null;
      if (Math.abs(value) >= 1e6) return Math.round(value);
      if (assumeMillions) return Math.round(value * 1e6);
      return Math.round(value);
    }
    const cleaned = String(value)
      .replace(/shares?/ig, '')
      .replace(/\$/g, '')
      .replace(/,/g, '')
      .trim();
    if (!cleaned) return null;
    const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)([KMB])?$/i);
    if (match) {
      const raw = parseFloat(match[1]);
      if (!isFinite(raw)) return null;
      const unit = match[2] ? match[2].toUpperCase() : null;
      if (unit === 'B') return Math.round(raw * 1e9);
      if (unit === 'M') return Math.round(raw * 1e6);
      if (unit === 'K') return Math.round(raw * 1e3);
      if (Math.abs(raw) >= 1e6) return Math.round(raw);
      if (assumeMillions) return Math.round(raw * 1e6);
      return Math.round(raw);
    }
    const numeric = parseFloat(cleaned);
    if (!isNaN(numeric)) {
      if (Math.abs(numeric) >= 1e6) return Math.round(numeric);
      if (assumeMillions) return Math.round(numeric * 1e6);
      return Math.round(numeric);
    }
    return null;
  }

  function parseSharesToNumber(s) {
    if (s == null) return null;
    const m = String(s).match(/([0-9][\d.,]*)\s*([KMB])?/i);
    if (!m) return null;
    const raw = parseFloat(m[1].replace(/,/g, ''));
    const unit = (m[2] || '').toUpperCase();
    if (isNaN(raw)) return null;
    if (unit === 'B') return raw * 1e9;
    if (unit === 'M') return raw * 1e6;
    if (unit === 'K') return raw * 1e3;
    return raw; // default raw shares
  }

  function trimZeros(s) {
    return String(s).replace(/\.00$/, '').replace(/(\.[1-9])0$/, '$1');
  }

  function formatMillionsToUnitString(n) {
    if (typeof n !== 'number' || !isFinite(n)) return String(n);
    if (n >= 1000) {
      const v = (n / 1000);
      return trimZeros(v.toFixed(2)) + 'B';
    }
    return trimZeros(n.toFixed(2)) + 'M';
  }

  function formatOptionsTradingStatus(value) {
    if (value === true || value === 'true' || value === 'Yes' || value === 'Yes') return 'Yes';
    if (value === false || value === 'false' || value === 'No' || value === 'No') return 'No';
    return 'Unknown';
  }

  function formatRegShoShares(value) {
    const num = parseSharesToNumber(value);
    if (num != null && isFinite(num)) return `${Math.round(num).toLocaleString()} shares`;
    return 'N/A';
  }

  function formatShortInterestDisplay(value) {
    const num = parseSharesToNumber(value);
    if (num != null && isFinite(num)) return `${Math.round(num).toLocaleString()} shares`;
    if (value == null) return 'N/A';
    const cleaned = String(value).replace(/shares?/ig, '').trim();
    if (cleaned && !/^n\/?a$/i.test(cleaned)) return `${cleaned} shares`;
    return 'N/A';
  }

  function formatPercentDisplay(value) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.endsWith('%')) return trimmed;
      const parsed = parseFloat(trimmed);
      if (Number.isFinite(parsed)) {
        const pct = trimmed.includes('%') || parsed > 1 ? parsed : parsed * 100;
        return `${trimZeros(pct.toFixed(2))}%`;
      }
    }
    const num = Number(value);
    if (Number.isFinite(num)) {
      const pct = num > 1 ? num : num * 100;
      return `${trimZeros(pct.toFixed(2))}%`;
    }
    return 'N/A';
  }

  /**
  * Parse numbers with financial suffixes, e.g. "50M", "15.8B", "100", "-2.5K"
  * Supported suffixes: K (thousand), M (million), B (billion), T (trillion)
  * Returns a Number (use BigInt only if you truly need > Number.MAX_SAFE_INTEGER).
  */
  function parseAbbrevNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    if (typeof value !== 'string') return NaN;

    // Normalize: trim, remove commas/underscores/spaces, uppercase
    const s = value.trim().replace(/[, _]/g, '').toUpperCase();

    // Match sign, numeric part, optional suffix
    const match = s.match(/^([+-]?)(\d+(?:\.\d+)?|\.\d+)([KMBT])?$/);
    if (!match) return NaN;

    const [, signStr, numStr, suffix] = match;
    const sign = signStr === '-' ? -1 : 1;
    const num = parseFloat(numStr);

    const mult = suffix
      ? { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[suffix]
      : 1;

    return sign * num * mult;
  }

  function deriveLatestFromTables(pageCrawls) {
    const out = {};
    try {
      const fin = pageCrawls.fintel || {};
      const tables = Array.isArray(fin.tables) ? fin.tables : [];
      // Latest CTB from table-short-borrow-rate
      const ctb = tables.find(t => String(t.id || '').toLowerCase() === 'table-short-borrow-rate');
      if (ctb && Array.isArray(ctb.rows) && ctb.rows.length) {
        const headers = ctb.headers || (ctb.rows.length ? Object.keys(ctb.rows[0]) : []);
        const dateH = headers.find(h => /date/i.test(h)) || headers[0];
        const rateH = headers.find(h => /borrow\s*rate|fee|ctb/i.test(h)) || headers[1];
        const r = ctb.rows[0] || {};
        const date = r[dateH] || '';
        const rate = r[rateH] || '';
        if (rate) out.latestCTB = date ? `${date}: ${rate}` : String(rate);
      }
      // Latest FTD from fails-to-deliver-table
      const ftd = tables.find(t => String(t.id || '').toLowerCase() === 'fails-to-deliver-table');
      if (ftd && Array.isArray(ftd.rows) && ftd.rows.length) {
        const headers = ftd.headers || (ftd.rows.length ? Object.keys(ftd.rows[0]) : []);
        const dateH = headers.find(h => /date|settlement/i.test(h)) || headers[0];
        const qtyH = headers.find(h => /ftd|quantity|qty/i.test(h)) || headers[1];
        const r = ftd.rows[0] || {};
        const date = r[dateH] || '';
        const qty = r[qtyH] || '';
        if (qty) out.latestFTD = date ? `${date}: ${qty}` : String(qty);
      }
    } catch {}
    return out;
  }

  function buildShortSharesAvailabilityCard(t) {
    const card = document.createElement('div'); card.className = 'card';
    const title = document.createElement('div'); title.className = 'table-title'; title.textContent = 'Short Shares Available (IBKR):';
    card.appendChild(title);
    const headers = (t.headers && t.headers.length) ? t.headers : (t.rows && t.rows.length ? Object.keys(t.rows[0]) : []);
    const rows = Array.isArray(t.rows) ? t.rows : [];

    // Identify columns
    const findCol = (pred) => headers.find(h => pred(String(h || '')));
    const tsHeader = findCol(h => /timestamp/i.test(h));
    const sharesHeader = findCol(h => /short|avail/i.test(h) && !/time|date|timestamp/i.test(h)) || findCol(h => /shares/i.test(h));
    const timeHeader = findCol(h => /time\s*since|date/i.test(h));

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['Time Ago', 'Short Shares Available (IBKR):'].forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
    thead.appendChild(trh); table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      // Compute timeAgo: prefer timestamp; fallback to original time header
      let timeAgoText = '';
      let tooltip = '';
      const ts = tsHeader ? row[tsHeader] : null;
      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) {
          timeAgoText = formatTimeAgo(d);
          tooltip = formatDateFull(d);
        }
      }
      if (!timeAgoText && timeHeader) timeAgoText = String(row[timeHeader] ?? '');

      const tdAgo = document.createElement('td'); tdAgo.textContent = timeAgoText || '';
      if (tooltip) tdAgo.title = tooltip;
      tr.appendChild(tdAgo);

      const shares = sharesHeader ? String(row[sharesHeader] ?? '') : '';
      const tdShares = document.createElement('td'); tdShares.textContent = shares;
      tr.appendChild(tdShares);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    return card;
  }

  function formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const sec = Math.floor(diffMs / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    const day = Math.floor(hr / 24);
    if (day > 0) return day === 1 ? '1 day ago' : `${day} days ago`;
    if (hr > 0) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
    if (min > 0) return min === 1 ? '1 minute ago' : `${min} minutes ago`;
    return 'Just now';
  }

  function formatDateFull(date) {
    try {
      return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
    } catch {
      return date.toString();
    }
  }

  function mapPrettyTableName(t) {
    try {
      const id = String(t?.id || '').trim().toLowerCase();
      const name = String(t?.name || '').trim().toLowerCase();
      const key = id || name;
      switch (key) {
        case 'short-shares-availability-table':
          return 'Short Shares Available (IBKR):';
        case 'table-short-borrow-rate':
          return 'Cost To Borrow (IBKR):';
        case 'short-sale-volume-finra-table':
          return 'Short Sale Volume (FINRA):';
        case 'fails-to-deliver-table':
          return 'Failure To Deliver (FTDs):';
        default:
          return null;
      }
    } catch { return null; }
  }

  function isBlacklistedValueKey(k) {
    try {
      const n = String(k || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
      return (
        n === 'finrashortvolume' ||
        n === 'finrashortvolumeratio' ||
        n === 'finratotalvolume' ||
        n === 'source' ||
        n === 'check' || n === 'ki' || n === 'mutwor' || n === 'rlhdt' || n === 'type'
      );
    } catch { return false; }
  }

  function pretty(obj, keys) {
    try {
      if (obj == null) return 'null';
      if (keys && Array.isArray(keys)) {
        const ordered = {};
        keys.forEach(k => { ordered[k] = obj[k]; });
        return JSON.stringify(ordered, null, 2);
      }
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return String(obj);
    }
  }

  async function copyJSON() {
    try {
      const storedJson = storedContentEl.dataset.json;
      const hoverJson = hoverContentEl.dataset.pack;
      let storedData = null;
      let hoverPack = null;
      try { if (hoverJson) hoverPack = JSON.parse(hoverJson); } catch {}
      try { if (storedJson) storedData = JSON.parse(storedJson); } catch {}
      const payload = {
        symbol: currentSymbol || null,
        hoverPack,
        storedData
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setStatus('Copied JSON to clipboard');
    } catch (e) {
      setStatus('Copy failed', true);
    }
  }

  function renderAllTickersHint() {
    const hint = document.createElement('div');
    hint.className = 'small muted';
    hint.style.marginTop = '8px';
    hint.textContent = 'Tip: No ticker detected. You can still view saved tickers in DevTools via chrome.storage.local.';
    storedContentEl.appendChild(hint);
  }

  function setStatus(msg, isErr) {
    statusEl.textContent = msg;
    statusEl.className = 'small' + (isErr ? ' err' : '');
  }

  function normalizeSymbol(input) {
    if (!input) return null;
    const trimmed = String(input).trim().replace(/^\$/,'').toUpperCase();
    const cleaned = trimmed.replace(/[^A-Z0-9]/g, '');
    if (!cleaned) return null;
    return cleaned.slice(0, 6);
  }

  let hoverRequestId = 0;

  function openAnalysisTabs(primaryUrl, secondaryUrl) {
    try {
      chrome.tabs.create({ url: primaryUrl, active: true });
      chrome.tabs.create({ url: secondaryUrl, active: false });
    } catch (err) {
      window.open(primaryUrl, '_blank', 'noopener');
      window.open(secondaryUrl, '_blank', 'noopener');
    }
  }

  async function shareTooltipSnapshot(rootTooltip) {
    const tooltip = rootTooltip || hoverContentEl?.querySelector('.shi-tooltip');
    if (!tooltip) {
      setStatus('Nothing to share yet — load a symbol first.', true);
      return;
    }
    if (typeof html2canvas !== 'function') {
      setStatus('Sharing unavailable (missing html2canvas).', true);
      return;
    }
    try {
      setStatus('Capturing tooltip…');
      const canvas = await html2canvas(tooltip, {
        backgroundColor: '#0d1117',
        scale: window.devicePixelRatio || 2,
        useCORS: true
      });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Snapshot failed')), 'image/png');
      });
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setStatus('Tooltip copied to clipboard.');
      } else {
        window.open(canvas.toDataURL('image/png'), '_blank');
        setStatus('Snapshot opened in new tab (clipboard unavailable).');
      }
    } catch (err) {
      console.error('❌ Share screenshot failed:', err);
      setStatus('Failed to copy tooltip screenshot.', true);
    }
  }

  async function loadForSymbol(symbol, opts = {}) {
    const normalized = normalizeSymbol(symbol);
    currentSymbol = normalized || null;
    if (symbolInput && normalized) symbolInput.value = normalized;
    if (normalized) {
      chrome.storage.local.set({ [LAST_SYMBOL_STORAGE_KEY]: normalized }, () => {});
    }
    if (tickerEl) tickerEl.textContent = normalized || '—';

    if (!normalized) {
      hoverContentEl.innerHTML = '<div class="small muted">Enter a symbol above to load data.</div>';
      if (hoverContentEl.dataset) hoverContentEl.dataset.pack = '';
      storedContentEl.innerHTML = '';
      if (storedContentEl.dataset) storedContentEl.dataset.json = '';
      if (storedPanelEl) storedPanelEl.open = false;
      if (opts.manual) {
        setStatus('Enter a ticker symbol', true);
      }
      return;
    }

    setStatus(`Loading ${normalized}…`);

    const [hoverPack, storedData] = await Promise.all([
      loadHoverData(normalized),
      loadStoredData(normalized)
    ]);

    if (!hoverPack && !storedData) {
      setStatus(`Loaded ${normalized} • no data available`, true);
    } else if (!storedData) {
      setStatus(`Loaded ${normalized} • no stored cache`, false);
    } else {
      setStatus(`Loaded ${normalized}`);
    }
  }

  function loadHoverData(symbol) {
    if (!hoverContentEl) return Promise.resolve();
    const requestId = ++hoverRequestId;
    hoverContentEl.innerHTML = `<div class="small muted">Fetching data for ${symbol}…</div>`;
    if (hoverContentEl.dataset) hoverContentEl.dataset.pack = '';

    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'fetch-pack', symbol }, (resp) => {
          if (hoverRequestId !== requestId) return resolve();
          if (chrome.runtime.lastError) {
            hoverContentEl.innerHTML = `<div class="err small">${chrome.runtime.lastError.message || 'Request failed'}</div>`;
            hoverContentEl.dataset.pack = '';
            return resolve(null);
          }
          renderHoverPack(symbol, resp);
          resolve(resp);
        });
      } catch (err) {
        hoverContentEl.innerHTML = `<div class="err small">${err.message || 'Request failed'}</div>`;
        hoverContentEl.dataset.pack = '';
        resolve(null);
      }
    });
  }

  async function loadStoredData(symbol) {
    const data = await getStoredForTicker(symbol);
    renderData(symbol, data);
    return data;
  }

  let squeezeScoreModulePromise = null;

  function loadSqueezeScoreModule() {
    if (!squeezeScoreModulePromise) {
      const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('squeezeScore.js')
        : './squeezeScore.js';
      squeezeScoreModulePromise = import(url).catch(err => {
        console.error('❌ Failed to load squeezeScore module:', err);
        return null;
      });
    }
    return squeezeScoreModulePromise;
  }

  function stripTrailingZeros(text) {
    return String(text).replace(/\.00$/, '').replace(/(\.[1-9])0$/, '$1');
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

  function formatSharesDisplay(value) {
    const num = parseSharesValue(value);
    if (!Number.isFinite(num)) return 'N/A';
    const abs = Math.abs(num);
    if (abs >= 1e12) return `${stripTrailingZeros((abs / 1e12).toFixed(2))}T shares`;
    if (abs >= 1e9) return `${stripTrailingZeros((abs / 1e9).toFixed(2))}B shares`;
    if (abs >= 1e6) return `${stripTrailingZeros((abs / 1e6).toFixed(2))}M shares`;
    if (abs >= 1e3) return `${stripTrailingZeros((abs / 1e3).toFixed(2))}K shares`;
    return `${Math.round(abs).toLocaleString()} shares`;
  }

  function formatCurrencyDisplay(value) {
    if (value === null || value === undefined) return 'N/A';
    const num = Number(value);
    if (!Number.isFinite(num)) return 'N/A';
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}$${stripTrailingZeros((abs / 1e12).toFixed(2))}T`;
    if (abs >= 1e9) return `${sign}$${stripTrailingZeros((abs / 1e9).toFixed(2))}B`;
    if (abs >= 1e6) return `${sign}$${stripTrailingZeros((abs / 1e6).toFixed(2))}M`;
    if (abs >= 1e3) return `${sign}$${stripTrailingZeros((abs / 1e3).toFixed(2))}K`;
    return `${sign}$${stripTrailingZeros(abs.toFixed(2))}`;
  }

  function formatPercentValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'N/A';
    return `${stripTrailingZeros(num.toFixed(2))}%`;
  }

  function formatDaysValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'N/A';
    return `${stripTrailingZeros(num.toFixed(2))} days`;
  }

  function formatOptionsTrading(value) {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return 'Unknown';
  }

  function formatYesNoValue(value) {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return 'Unknown';
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

  function formatRegShoShares(value) {
    const num = parseSharesValue(value);
    if (Number.isFinite(num)) {
      return `${Math.round(num).toLocaleString()} shares`;
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

  function formatShortFloatPercentDisplay(value, shortInterest, float) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.endsWith('%')) return trimmed;
    }
    const computed = computeShortFloatPercent(shortInterest, float);
    if (computed) return computed;
    const num = Number(value);
    if (Number.isFinite(num)) {
      const pct = num <= 1 ? num * 100 : num;
      return `${stripTrailingZeros(pct.toFixed(2))}%`;
    }
    return 'N/A';
  }

  function parsePercentNumber(value) {
    if (value === null || value === undefined) return NaN;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }
    const text = String(value).trim();
    if (!text) return NaN;
    const match = text.replace(/,/g, '').match(/([+-]?\d+(?:\.\d+)?)/);
    if (!match) return NaN;
    const num = parseFloat(match[1]);
    if (!Number.isFinite(num)) return NaN;
    if (text.includes('%')) return num;
    return num > 1 ? num : num * 100;
  }

  function renderHoverPack(symbol, pack) {
    if (!hoverContentEl) return;
    hoverContentEl.innerHTML = '';

    if (!pack || typeof pack !== 'object') {
      hoverContentEl.innerHTML = '<div class="err small">No hover data available.</div>';
      hoverContentEl.dataset.pack = '';
      return;
    }

    hoverContentEl.dataset.pack = JSON.stringify(pack, null, 2);

    const factory = window.QSETooltipTemplate && typeof window.QSETooltipTemplate.createTooltipElement === 'function'
      ? window.QSETooltipTemplate.createTooltipElement
      : null;
    const tooltip = factory ? factory() : null;

    if (!tooltip) {
      hoverContentEl.innerHTML = '<div class="err small">Unable to render tooltip layout.</div>';
      hoverContentEl.dataset.pack = '';
      return;
    }

    tooltip.style.position = 'static';
    tooltip.style.display = 'block';
    tooltip.style.left = '0';
    tooltip.style.top = '0';
    tooltip.style.margin = '0 auto';
    tooltip.style.maxWidth = '768px';
    //tooltip.style.minWidth = '600px';
    tooltip.style.width = '100%';
    tooltip.style.boxShadow = 'none';

    hoverContentEl.appendChild(tooltip);
    populateTooltipFromPack(tooltip, symbol, pack);
  }

  function populateTooltipFromPack(tooltip, symbol, pack) {
    const safeSetText = (selector, value) => {
      const element = tooltip.querySelector(selector);
      if (!element) return;
      const textValue = value === null || value === undefined ? 'N/A' : value;
      element.textContent = textValue;
    };

    safeSetText('.shi-symbol', `$${symbol}`);
    safeSetText('.shi-updated', pack.fetchedAt ? formatUpdatedTimestamp(pack.fetchedAt) : '');

    const dtUrl = `https://dilutiontracker.com/app/search/${encodeURIComponent(symbol)}`;
    const fintelUrl = `https://fintel.io/ss/us/${encodeURIComponent(symbol)}`;

    const dilutionLink = tooltip.querySelector('.refresh-data-link.dilutiontracker');
    if (dilutionLink) {
      dilutionLink.href = dtUrl;
      dilutionLink.title = `Open DilutionTracker for ${symbol}`;
      dilutionLink.onclick = (evt) => {
        evt.preventDefault();
        openAnalysisTabs(dtUrl, fintelUrl);
      };
    }
    const fintelLink = tooltip.querySelector('.refresh-data-link.fintel');
    if (fintelLink) {
      fintelLink.href = fintelUrl;
      fintelLink.title = `Open Fintel short squeeze data for ${symbol}`;
      fintelLink.onclick = (evt) => {
        evt.preventDefault();
        openAnalysisTabs(dtUrl, fintelUrl);
      };
    }

    const shareBtn = tooltip.querySelector('#share');
    if (shareBtn) {
      shareBtn.onclick = (evt) => {
        evt.preventDefault();
        shareTooltipSnapshot(tooltip);
      };
    }

    const copyBtn = tooltip.querySelector('#copy');
    if (copyBtn) {
      copyBtn.onclick = (evt) => {
        evt.preventDefault();
        copyJSON();
      };
    }
    /*const refreshBtn = tooltip.querySelector('.refresh-button');
    if (refreshBtn) {
      refreshBtn.onclick = (evt) => {
        evt.preventDefault();
        loadForSymbol(symbol, { manual: false });
      };
    }*/

    safeSetText('.shi-float', formatSharesDisplay(pack.float));
    safeSetText('.shi-shares-outstanding', formatSharesDisplay(pack.sharesOutstanding));
    safeSetText('.shi-market-cap', formatCurrencyDisplay(pack.marketCap));
    safeSetText('.shi-est-cash', formatCurrencyDisplay(pack.estimatedCash));
    safeSetText('.shi-institutional-ownership', formatPercentDisplay(pack.institutionalOwnership));
    safeSetText('.shi-enterprise-value', formatCurrencyDisplay(pack.enterpriseValue));

    safeSetText('.shi-short-interest', formatShortInterestDisplay(pack.shortInterest));
    safeSetText('.shi-short-interest-ratio', formatDaysValue(pack.shortInterestRatio));
    safeSetText('.shi-short-interest-percent-float', formatShortFloatPercentDisplay(pack.shortInterestPercentFloat, pack.shortInterest, pack.float));
    safeSetText('.shi-cost-to-borrow', formatPercentDisplay(pack.costToBorrow));
    safeSetText('.shi-short-shares-available', formatSharesDisplay(pack.shortSharesAvailable));
    safeSetText('.shi-finra-exempt-volume', formatSharesDisplay(pack.finraExemptVolume));
    safeSetText('.shi-failure-to-deliver', formatCurrencyDisplay(pack.failureToDeliver));
    safeSetText('.shi-regsho-min-ftds', formatRegShoShares(pack.regShoMinFtds));

    safeSetText('.shi-country', pack.country || 'N/A');
    safeSetText('.shi-sector', pack.sector || 'N/A');
    safeSetText('.shi-industry', pack.industry || 'N/A');
    safeSetText('.shi-exchange', pack.exchange || 'N/A');
    safeSetText('.shi-options-enabled', formatOptionsTrading(pack.optionsTradingEnabled));
    safeSetText('.shi-regsho-threshold', formatYesNoValue(pack.regShoThreshold));
    safeSetText('.shi-last-data-update', pack.lastDataUpdate || 'N/A');

    const regularChangeEl = tooltip.querySelector('.shi-regular-change');
    if (regularChangeEl) {
      if (pack.regularMarketChange) {
        regularChangeEl.textContent = pack.regularMarketChange.text || '';
        if (pack.regularMarketChange.styles) {
          regularChangeEl.setAttribute('style', pack.regularMarketChange.styles);
        } else {
          regularChangeEl.removeAttribute('style');
        }
      } else {
        regularChangeEl.textContent = '';
        regularChangeEl.removeAttribute('style');
      }
    }

    const extendedChangeEl = tooltip.querySelector('.shi-extended-change');
    if (extendedChangeEl) {
      if (pack.extendedMarketChange) {
        extendedChangeEl.textContent = pack.extendedMarketChange.text || '';
        if (pack.extendedMarketChange.styles) {
          extendedChangeEl.setAttribute('style', pack.extendedMarketChange.styles);
        } else {
          extendedChangeEl.removeAttribute('style');
        }
      } else {
        extendedChangeEl.textContent = '';
        extendedChangeEl.removeAttribute('style');
      }
    }

    const squeezeScoreEl = tooltip.querySelector('.shi-squeeze-score');
    if (squeezeScoreEl) {
      squeezeScoreEl.textContent = 'Calculating…';
      updatePopupSqueezeScore(squeezeScoreEl, pack, symbol);
    }

    const rightCol = tooltip.querySelector('.shi-column-right');
    renderTooltipTables(rightCol, pack);
  }

  function renderTooltipTables(container, data) {
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
      const card = buildTooltipTableCard(cfg.title, rows, cfg.maxRows || 5, cfg.preferredColumns || []);
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

  function buildTooltipTableCard(title, rows, maxRows, preferredColumns) {
    const columns = deriveTooltipTableColumns(rows, preferredColumns);
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
      th.textContent = prettifyTooltipColumnName(col);
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

  function deriveTooltipTableColumns(rows, preferredColumns) {
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

  function prettifyTooltipColumnName(name) {
    if (!name) return '';
    if (/\s/.test(name)) return name;
    const spaced = name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    return spaced.replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function formatUpdatedTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!isNaN(date.valueOf())) {
      return `Updated: ${date.toLocaleString()}`;
    }
    return typeof value === 'string' ? value : '';
  }

  function updatePopupSqueezeScore(targetEl, pack, symbol) {
    if (!targetEl) return;
    loadSqueezeScoreModule().then(module => {
      if (symbol !== currentSymbol) return;
      if (!module || typeof module.scoreConsensus !== 'function') {
        targetEl.textContent = 'N/A';
        return;
      }
      const floatShares = parseSharesValue(pack.float);
      const siPct = parsePercentNumber(pack.shortInterestPercentFloat);
      const costToBorrowPct = parsePercentNumber(pack.costToBorrow);
      const ftdValue = typeof pack.failureToDeliver === 'number'
        ? pack.failureToDeliver
        : parseFloat(String(pack.failureToDeliver || '').replace(/[$,]/g, ''));
      const regShoShares = parseSharesValue(pack.regShoMinFtds);
      const regshoFlag = Number.isFinite(regShoShares) && regShoShares > 0;

      let siValue = siPct;
      if (!Number.isFinite(siValue)) {
        const computed = computeShortFloatPercent(pack.shortInterest, pack.float);
        siValue = parsePercentNumber(computed);
      }

      if (!Number.isFinite(floatShares) || floatShares <= 0 || !Number.isFinite(siValue)) {
        targetEl.textContent = 'N/A';
        return;
      }

      try {
        const score = module.scoreConsensus({
          float_shares: floatShares,
          si_pct: siValue,
          ctb: Number.isFinite(costToBorrowPct) ? costToBorrowPct : 0,
          ftd_val: Number.isFinite(ftdValue) ? ftdValue : 0,
          regsho: regshoFlag
        });
        if (symbol !== currentSymbol) return;
        targetEl.textContent = Number.isFinite(score)
          ? (score.toFixed(1).endsWith('.0') ? score.toFixed(1).slice(0, -2) : stripTrailingZeros(score.toFixed(1)))
          : 'N/A';
      } catch (err) {
        console.error(`❌ Failed to compute squeeze score for ${symbol}:`, err);
        targetEl.textContent = 'N/A';
      }
    }).catch(err => {
      console.error('❌ Error loading squeeze score module:', err);
      targetEl.textContent = 'N/A';
    });
  }

  async function loadInitial() {
    setStatus('Loading…');
    const tab = await getActiveTab();
    const href = tab?.url || '';
    urlEl.textContent = href || 'Unknown';
    deriveTickerFallback = deriveTickerFromUrl(href);
    const storedSymbolRaw = await new Promise(resolve => {
      chrome.storage.local.get(LAST_SYMBOL_STORAGE_KEY, data => {
        resolve(data ? data[LAST_SYMBOL_STORAGE_KEY] : null);
      });
    });
    const storedSymbol = normalizeSymbol(storedSymbolRaw);
    const inputSymbol = normalizeSymbol(symbolInput?.value);
    const initialSymbol = inputSymbol || storedSymbol || deriveTickerFallback;
    if (symbolInput) {
      symbolInput.value = initialSymbol || '';
    }
    // Clean storage once per popup open
    await cleanupStorage({ silent: true });
    await loadForSymbol(initialSymbol, { manual: false });
  }

  // --- Cleanup: purge blacklisted value keys across all tickers ---
  function normalizeKeyName(k) {
    return String(k || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
  }

  function isBlacklistedValueKey(k) {
    try {
      const n = normalizeKeyName(k);
      return (
        n === 'finrashortvolume' ||
        n === 'finrashortvolumeratio' ||
        n === 'finratotalvolume' ||
        n === 'source' ||
        n === 'check' || n === 'ki' || n === 'mutwor' || n === 'rlhdt' || n === 'type'
      );
    } catch { return false; }
  }

  async function cleanupStorage(opts = {}) {
    try {
      const all = await new Promise(res => chrome.storage.local.get(null, res));
      const updates = {};
      const removed = [];
      for (const [key, obj] of Object.entries(all)) {
        if (!key.startsWith('ticker_') || !obj || typeof obj !== 'object') continue;
        const before = JSON.stringify(obj);

        // Top-level: drop blacklisted keys
        Object.keys(obj).forEach(k => { if (isBlacklistedValueKey(k)) delete obj[k]; });

        // pageCrawls: scrub values/inferred per host
        if (obj.pageCrawls && typeof obj.pageCrawls === 'object') {
          for (const host of Object.keys(obj.pageCrawls)) {
            const crawl = obj.pageCrawls[host];
            if (!crawl || typeof crawl !== 'object') continue;
            if (crawl.values && typeof crawl.values === 'object') {
              Object.keys(crawl.values).forEach(k => {
                if (isBlacklistedValueKey(k)) { delete crawl.values[k]; return; }
                const arr = crawl.values[k];
                if (Array.isArray(arr)) {
                  arr.forEach(occ => {
                    if (!occ) return;
                    // Convert numeric-like strings to absolute numbers (e.g., 12.4M -> 12400000)
                    const v = occ.value;
                    const abs = numAbsAny(v);
                    if (abs != null) occ.value = abs;
                  });
                }
              });
            }
            if (crawl.inferred && typeof crawl.inferred === 'object') {
              Object.keys(crawl.inferred).forEach(k => {
                if (isBlacklistedValueKey(k)) { delete crawl.inferred[k]; return; }
                const v = crawl.inferred[k];
                const abs = numAbsAny(v);
                if (abs != null) crawl.inferred[k] = abs;
              });
            }
            // Remove empty "Values" tables
            if (Array.isArray(crawl.tables)) {
              crawl.tables = crawl.tables.filter(t => {
                const name = String(t?.name || t?.key || '').trim().toLowerCase();
                if (name === 'values' && isTableEffectivelyEmpty(t)) return false;
                // Also remove combined short-sale volume table from stored tables
                const norm = name.replace(/[^a-z0-9]+/g, '');
                if (norm === 'shortsalevolumecombinedtable') return false;
                return true;
              });
            }
          }
        }

        // Migrate numeric-like fields to absolute numbers (one-time migration)
        try {
          const numAbs = (s) => {
            const m = String(s).match(/([0-9][\d.,]*)\s*([KMBT])?/i);
            if (!m) return null;
            const raw = parseFloat(m[1].replace(/,/g, ''));
            const unit = (m[2] || '').toUpperCase();
            if (isNaN(raw)) return null;
            const mult = unit === 'T' ? 1e12 : unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
            return Math.round(raw * mult);
          };
          // Float & OS (convert M/B strings or plain numbers to absolute count of shares)
          if (typeof obj.latestFloat === 'string') { const v = numAbs(obj.latestFloat); if (v != null) obj.latestFloat = v; }
          if (typeof obj.sharesOutstanding === 'string') { const v = numAbs(obj.sharesOutstanding); if (v != null) obj.sharesOutstanding = v; }
          // Estimated cash to absolute dollars
          if (typeof obj.estimatedCash === 'string') { const v = numAbs(obj.estimatedCash); if (v != null) obj.estimatedCash = v; }
          // Fintel numeric-like fields to absolute shares
          ['shortSharesAvailable','finraExemptVolume','failureToDeliver'].forEach(f => {
            if (typeof obj[f] === 'string') { const v = numAbs(obj[f]); if (v != null) obj[f] = v; }
          });
        } catch {}

        // Fix previously mis-saved exchange values (e.g., huge concatenated strings)
        if (typeof obj.exchange === 'string' && looksBadExchange(obj.exchange)) {
          const replacement = deriveExchangeFromCrawls(obj.pageCrawls);
          if (replacement) obj.exchange = replacement; else delete obj.exchange;
        }

        const after = JSON.stringify(obj);
        if (before !== after) {
          updates[key] = obj;
          removed.push(key);
        }
      }

      if (Object.keys(updates).length) {
        await new Promise(res => chrome.storage.local.set(updates, res));
      }
      if (!opts.silent) setStatus(removed.length ? `Cleaned ${removed.length} item(s)` : 'Nothing to clean');
      return removed.length;
    } catch (e) {
      if (!opts.silent) setStatus('Cleanup failed', true);
      return 0;
    }
  }

  // Convert strings with K/M/B/T (and optional $ or commas) to absolute numbers. Returns null if not numeric-like.
  function numAbsAny(s) {
    if (s == null) return null;
    if (typeof s === 'number' && isFinite(s)) return s;
    const str = String(s).replace(/\$/g, '').trim();
    const m = str.match(/([+-]?[0-9][\d.,]*)\s*([KMBT])?/i);
    if (!m) return null;
    const raw = parseFloat(m[1].replace(/,/g, ''));
    const unit = (m[2] || '').toUpperCase();
    if (isNaN(raw)) return null;
    const mult = unit === 'T' ? 1e12 : unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
    return Math.round(raw * mult);
  }

  function isTableEffectivelyEmpty(t) {
    try {
      if (!t || !Array.isArray(t.rows)) return true;
      if (t.rows.length === 0) return true;
      return !t.rows.some(row => row && Object.values(row).some(v => String(v ?? '').trim().length > 0));
    } catch { return false; }
  }

  function looksBadExchange(val) {
    try {
      const s = String(val || '').trim();
      if (!s) return false;
      if (s.length > 40) return true;
      if (s.includes(':')) return true;
      // If it contains many spaces and common labels, it's likely a dump
      if (/\b(Mkt Cap|Enterprise Value|Float|Shares Outstanding|Inst\s*Own)\b/i.test(s)) return true;
      return false;
    } catch { return false; }
  }

  function isGoodExchangeCandidate(s) {
    const v = String(s || '').trim();
    if (!v) return false;
    if (v.length > 30) return false;
    if (v.includes(':')) return false;
    // Known exchanges and OTC variants
    const ok = /^(NASDAQ|NYSE|NYSE\s*American|NYSEMKT|AMEX|OTC(?:Q[XB])?|OTC|CBOE|TSX|TSXV|LSE|ASX)$/i;
    if (ok.test(v)) return true;
    // Also accept simple uppercase tokens up to 6 chars
    if (/^[A-Z]{2,6}$/.test(v)) return true;
    return false;
  }

  function deriveExchangeFromCrawls(pageCrawls) {
    try {
      if (!pageCrawls || typeof pageCrawls !== 'object') return null;
      const dt = pageCrawls.dilutiontracker;
      if (dt && dt.values && dt.values.exchange && Array.isArray(dt.values.exchange)) {
        for (const occ of dt.values.exchange) {
          if (occ && isGoodExchangeCandidate(occ.value)) return occ.value.trim();
        }
      }
      if (dt && dt.inferred && isGoodExchangeCandidate(dt.inferred.exchange)) return dt.inferred.exchange.trim();
      return null;
    } catch { return null; }
  }

  // initial load with debug-mode hydration
  chrome.storage.local.get('debug_mode', (res) => {
    debugEnabled = !!res.debug_mode;
    if (debugToggle) debugToggle.checked = debugEnabled;
    loadInitial();
  });
})();
