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
      
      // Check if data has changed before storing
      await storeFintelDataIfChanged(ticker, fintelData);
    } else {
      console.log('❌ Could not parse Fintel data from page');
    }
    
  } catch (error) {
    console.error('❌ Error extracting Fintel data:', error);
  }
}

/**
 * Extract Fintel metrics from page text
 * @param {string} text - Raw page text
 * @returns {Object|null} Parsed data or null
 */
function extractFintelMetrics(text) {
  try {
    const result = {};
    
    // Define patterns for various Fintel metrics
    const patterns = [
      // Short Interest patterns
      { 
        field: 'shortInterest', 
        patterns: [
          /short\s+interest[:\s]*([0-9.,]+%)/i,
          /short\s+interest\s+%[:\s]*([0-9.,]+%)/i,
          /short\s+interest[:\s]*([0-9.,]+)\s*%/i
        ]
      },
      
      // Cost to Borrow patterns
      { 
        field: 'costToBorrow', 
        patterns: [
          /cost\s+to\s+borrow[:\s]*([0-9.,]+%)/i,
          /borrow\s+rate[:\s]*([0-9.,]+%)/i,
          /ctb[:\s]*([0-9.,]+%)/i
        ]
      },
      
      // Failure to Deliver patterns
      { 
        field: 'failureToDeliver', 
        patterns: [
          /failure\s+to\s+deliver[:\s]*([0-9.,]+[KMB]?)/i,
          /ftd[:\s]*([0-9.,]+[KMB]?)/i,
          /fails[:\s]*([0-9.,]+[KMB]?)/i
        ]
      },
      
      // Short Shares Available patterns
      { 
        field: 'shortSharesAvailable', 
        patterns: [
          /short\s+shares\s+available[:\s]*([0-9.,]+[KMB]?)/i,
          /shares\s+available[:\s]*([0-9.,]+[KMB]?)/i,
          /available\s+shares[:\s]*([0-9.,]+[KMB]?)/i
        ]
      },
      
      // Short-Exempt Volume patterns
      { 
        field: 'shortExemptVolume', 
        patterns: [
          /short[\s\-]*exempt\s+volume[:\s]*([0-9.,]+[KMB]?)/i,
          /exempt\s+volume[:\s]*([0-9.,]+[KMB]?)/i
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
          break; // Use first matching pattern
        }
      }
    });
    
    // Try to extract data from tables
    const tableData = extractFromTables();
    if (tableData) {
      Object.assign(result, tableData);
    }
    
    // Add metadata
    if (Object.keys(result).length > 0) {
      result.lastUpdated = Date.now();
      result.source = 'fintel.io';
    }
    
    return Object.keys(result).length > 0 ? result : null;
    
  } catch (error) {
    console.error('❌ Error parsing Fintel metrics:', error);
    return null;
  }
}

/**
 * Extract data from HTML tables on the page
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
          
          // Map table labels to our fields
          const labelMappings = {
            'short interest': 'shortInterest',
            'short interest %': 'shortInterest',
            'cost to borrow': 'costToBorrow',
            'borrow rate': 'costToBorrow',
            'failure to deliver': 'failureToDeliver',
            'ftd': 'failureToDeliver',
            'short shares available': 'shortSharesAvailable',
            'shares available': 'shortSharesAvailable',
            'short-exempt volume': 'shortExemptVolume',
            'exempt volume': 'shortExemptVolume'
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
 * Store Fintel data only if it has changed, merging with existing ticker data
 * @param {string} ticker - Stock ticker
 * @param {Object} newFintelData - New Fintel data
 */
async function storeFintelDataIfChanged(ticker, newFintelData) {
  try {
    // Get existing ticker data
    const result = await chrome.storage.local.get(`ticker_${ticker}`);
    let existingData = result[`ticker_${ticker}`] || {};
    
    // Check if Fintel data has changed
    const fintelFields = ['shortInterest', 'costToBorrow', 'failureToDeliver', 'shortSharesAvailable', 'shortExemptVolume'];
    
    let hasChanges = false;
    const changes = [];
    
    for (const field of fintelFields) {
      const oldValue = existingData[field];
      const newValue = newFintelData[field];
      
      if (oldValue !== newValue) {
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