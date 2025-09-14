/**
 * @file
 * fintel_content.js
 * 
 * Content script for fintel.io pages
 * Extracts Short Interest, Cost to Borrow, FTD, and other short metrics
 */

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
  }, 3000); // Wait 3 seconds for dynamic content
  
  // Also set up observer for dynamic content changes
  const observer = new MutationObserver(() => {
    extractFintelData(ticker);
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
      
      // Add green text highlighting for verified data (with slight delay to ensure DOM is ready)
      setTimeout(() => {
        addFintelGreenTextHighlighting(ticker, fintelData);
      }, 500);
      
      // Check if data has changed before storing
      await storeFintelDataIfChanged(ticker, fintelData);
    } else {
      console.log('❌ Could not parse Fintel data from page');
    }

    // Independently highlight the Short Interest VALUE in green when present
    // This runs regardless of stored/parsed data so users get immediate visual cue
    setTimeout(() => {
      try { highlightShortInterestValueGreen(); } catch (e) { console.warn('SI value highlight error', e); }
    }, 100);
    
  } catch (error) {
    console.error('❌ Error extracting Fintel data:', error);
  }
}

/**
 * Find "Short Interest" on the page and color just the VALUE in green.
 * Handles common Fintel layouts: tables (label/value in cells) and inline text "Short Interest: <value>".
 */
function highlightShortInterestValueGreen() {
  const GREEN = 'rgb(34, 197, 94)';

  try {
    // 1) Table layout: label in one cell, value in the next
    const rows = document.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = Array.from(row.querySelectorAll('th,td'));
      cells.forEach((cell, idx) => {
        const label = (cell.textContent || '').trim();
        if (/^\s*short\s*interest\s*$/i.test(label) || /short\s*interest/i.test(label)) {
          const valueCell = cells[idx + 1];
          if (valueCell && !valueCell.hasAttribute('data-qse-green-si-value')) {
            valueCell.style.color = GREEN;
            valueCell.style.fontWeight = '500';
            valueCell.setAttribute('data-qse-green-si-value', 'true');
            valueCell.title = 'Short Interest value';
          }
        }
      });
    });

    // 2) Inline text layout: "Short Interest: 167,565,108 shares"
    const re = /Short\s*Interest\s*[:\-–—]?\s*([\d.,]+\s*(?:[KMB]\b)?\s*(?:shares|shrs)?)(?!\s*%)/i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue || '';
      if (!/short\s*interest/i.test(text)) continue;
      const m = text.match(re);
      if (m && m[1]) {
        const valueText = m[1];
        const fullMatch = m[0];
        const valueOffsetInMatch = fullMatch.indexOf(valueText);
        const absStart = m.index + valueOffsetInMatch;
        const absEnd = absStart + valueText.length;

        const before = text.slice(0, absStart);
        const after = text.slice(absEnd);

        // Skip if parent already processed
        const parent = node.parentNode;
        if (!parent || parent.nodeType !== 1) continue;
        if (parent.hasAttribute && parent.hasAttribute('data-qse-green-si-inline')) continue;

        const beforeNode = document.createTextNode(before);
        const span = document.createElement('span');
        span.textContent = valueText;
        span.style.color = GREEN;
        span.style.fontWeight = '500';
        span.setAttribute('data-qse-green-si-value', 'true');
        const afterNode = document.createTextNode(after);

        parent.insertBefore(beforeNode, node);
        parent.insertBefore(span, node);
        parent.insertBefore(afterNode, node);
        parent.removeChild(node);
        parent.setAttribute('data-qse-green-si-inline', 'true');
      }
    }
  } catch (err) {
    console.warn('highlightShortInterestValueGreen error:', err);
  }
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
    
    // Also look for these tables by partial class names if IDs don't work
    if (!shortSharesTable) {
      const altShortTable = document.querySelector('table[class*="short"], table[class*="availability"]');
      if (altShortTable && altShortTable.textContent.toLowerCase().includes('short')) {
        result.shortSharesAvailabilityTable = extractTableData(altShortTable, 'Short Shares (alt)');
      }
    }
    
    if (!borrowRateTable) {
      const altBorrowTable = document.querySelector('table[class*="borrow"], table[class*="rate"]');
      if (altBorrowTable && altBorrowTable.textContent.toLowerCase().includes('borrow')) {
        result.shortBorrowRateTable = extractTableData(altBorrowTable, 'Borrow Rate (alt)');
      }
    }
    
    if (!ftdTable) {
      const altFtdTable = document.querySelector('table[class*="ftd"], table[class*="fail"]');
      if (altFtdTable && altFtdTable.textContent.toLowerCase().includes('fail')) {
        result.failsToDeliverTable = extractTableData(altFtdTable, 'FTD (alt)');
      }
    }
    
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
            result[field] = cleanValue(value);
            console.log(`✅ Found ${field} in table: ${result[field]}`);
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
async function addFintelGreenTextHighlighting(ticker, currentData) {
  try {
    // Check if chrome.storage is available
    if (!chrome || !chrome.storage) {
      console.error('❌ Chrome storage API not available');
      return;
    }

    // Get existing stored data
    const result = await chrome.storage.local.get(`ticker_${ticker}`);
    const storedData = result[`ticker_${ticker}`];
    
    // If no stored data, this is first time crawling - highlight all values
    const isFirstTime = !storedData;
    
    console.log(`🟢 Adding Fintel green text highlighting for ${ticker} (first time: ${isFirstTime})`);
    
    // Define fields to check and their comparison functions
    const fieldsToCheck = [
      { field: 'shortInterest', compareValue: true },
      { field: 'shortInterestRatio', compareValue: true },
      { field: 'shortInterestPercentFloat', compareValue: true },
      { field: 'costToBorrow', compareValue: true },
      { field: 'failureToDeliver', compareValue: true },
      { field: 'shortSharesAvailable', compareValue: true },
      { field: 'shortExemptVolume', compareValue: true },
      { field: 'finraExemptVolume', compareValue: true }
    ];
    
    // Add green highlighting for each field
    fieldsToCheck.forEach(({ field, compareValue }) => {
      const currentValue = currentData[field];
      const storedValue = storedData?.[field];
      
      if (currentValue && (isFirstTime || (compareValue && storedValue === currentValue))) {
        addFintelGreenTextToElement(document.body, field, currentValue);
      }
    });
    
    // Handle table data separately
    const tableFields = ['shortSharesAvailabilityTable', 'shortBorrowRateTable', 'failsToDeliverTable'];
    tableFields.forEach(tableField => {
      if (currentData[tableField] && Array.isArray(currentData[tableField])) {
        const currentRows = currentData[tableField].length;
        const storedRows = storedData?.[tableField]?.length || 0;
        
        if (isFirstTime || currentRows === storedRows) {
          const tableId = tableField.replace('Table', '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
          addGreenTextToTable(tableId);
        }
      }
    });
    
    console.log(`🟢 Fintel green text highlighting added for ${ticker}`);
    
  } catch (error) {
    console.error('❌ Error adding Fintel green text highlighting:', error);
  }
}

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
