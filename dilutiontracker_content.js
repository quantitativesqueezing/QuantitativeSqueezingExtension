/**
 * @file
 * dilutiontracker_content.js
 * 
 * Content script for dilutiontracker.com pages
 * Extracts Float & OS data from company pages and stores in extension storage
 */

console.log('🔍 DilutionTracker content script loaded');

// Check if we're on a ticker search page
const currentUrl = window.location.href;
const tickerMatch = currentUrl.match(/\/app\/search\/([A-Z]{1,5})/i);

if (tickerMatch) {
  const ticker = tickerMatch[1].toUpperCase();
  console.log(`📊 Detected ticker page: ${ticker}`);
  
  // Wait for page to load and extract data
  setTimeout(() => {
    extractTickerData(ticker);
  }, 2000); // Wait 2 seconds for dynamic content
  
  // Also set up observer for dynamic content changes
  const observer = new MutationObserver(() => {
    extractTickerData(ticker);
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * Extract float and shares outstanding data from the page
 * @param {string} ticker - Stock ticker symbol
 */
async function extractTickerData(ticker) {
  try {
    console.log(`🔍 Extracting data for ${ticker}...`);
    
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
    console.log('🏢 Company data:', companyData);
    
    // Extract price change data
    const priceData = extractPriceData();
    console.log('📈 Price data:', priceData);
    
    // Parse float and shares outstanding values
    const floatData = parseFloatData(floatText, ticker);
    
    // Combine all data
    if (floatData) {
      if (estimatedCash) floatData.estimatedCash = estimatedCash;
      if (companyData) Object.assign(floatData, companyData);
      if (priceData) Object.assign(floatData, priceData);
    }
    
    if (floatData) {
      console.log('📊 Parsed data:', floatData);
      
      // Check if data has changed before storing
      await storeTickerDataIfChanged(ticker, floatData);
    } else {
      console.log('❌ Could not parse float data from text');
    }
    
  } catch (error) {
    console.error('❌ Error extracting ticker data:', error);
  }
}

/**
 * Extract company data (Sector, Industry, Country, Market Cap) from structured sections
 * @returns {Object|null} Company data or null
 */
function extractCompanyData() {
  try {
    const result = {};
    
    // Find all text nodes and look for structured data
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeValue.trim()) {
        textNodes.push(node.nodeValue.trim());
      }
    }
    
    // Combine text nodes into searchable content
    const fullText = textNodes.join(' ');
    
    // More precise patterns using word boundaries
    const patterns = [
      { field: 'sector', regex: /\bSector:\s*([^\n\r]*?)(?=\s*Industry:|\s*Country:|\s*Exchange:|\s*$)/i },
      { field: 'industry', regex: /\bIndustry:\s*([^\n\r]*?)(?=\s*Country:|\s*Exchange:|\s*Sector:|\s*$)/i },
      { field: 'country', regex: /\bCountry:\s*([^\n\r]*?)(?=\s*Exchange:|\s*Sector:|\s*Industry:|\s*$)/i },
      { field: 'marketCap', regex: /\bMkt Cap & EV:\s*([0-9.,]+[KMB])\s*\//i },
      { field: 'enterpriseValue', regex: /\bMkt Cap & EV:\s*[0-9.,]+[KMB]\s*\/\s*([0-9.,]+[KMB])/i }
    ];
    
    patterns.forEach(({ field, regex }) => {
      const match = fullText.match(regex);
      if (match && match[1]) {
        result[field] = match[1].trim();
        console.log(`✅ Found ${field}: ${result[field]}`);
      }
    });
    
    // Alternative patterns for market cap if the combined pattern doesn't work
    if (!result.marketCap) {
      const altCapPattern = /\b(?:Market Cap|Mkt Cap):\s*([0-9.,]+[KMB])/i;
      const altCapMatch = fullText.match(altCapPattern);
      if (altCapMatch) {
        result.marketCap = altCapMatch[1].trim();
        console.log(`✅ Found market cap (alt): ${result.marketCap}`);
      }
    }
    
    if (!result.enterpriseValue) {
      const altEvPattern = /\b(?:Enterprise Value|EV):\s*([0-9.,]+[KMB])/i;
      const altEvMatch = fullText.match(altEvPattern);
      if (altEvMatch) {
        result.enterpriseValue = altEvMatch[1].trim();
        console.log(`✅ Found EV (alt): ${result.enterpriseValue}`);
      }
    }
    
    return Object.keys(result).length > 0 ? result : null;
    
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
    
    // Pattern to match: "estimated current cash of $22.9M"
    const cashPatterns = [
      /estimated\s+current\s+cash\s+of\s+\$([0-9,.]+)\s*([MB])(?!\w)/i,
      /current\s+cash\s+of\s+\$([0-9,.]+)\s*([MB])(?!\w)/i,
      /cash\s+of\s+\$([0-9,.]+)\s*([MB])(?!\w)/i,
      /estimated\s+cash[:\s]+\$([0-9,.]+)\s*([MB])(?!\w)/i,
      /quarterly\s+cash\s+burn\s+of\s+-?\$[0-9,.]+[MB]\s+and\s+estimated\s+current\s+cash\s+of\s+\$([0-9,.]+)\s*([MB])(?!\w)/i
    ];
    
    for (const pattern of cashPatterns) {
      const match = pageText.match(pattern);
      if (match) {
        const cashNum = parseFloat(match[1].replace(/,/g, ''));
        const cashUnit = match[2].toUpperCase();
        const cashInMillions = convertToMillions(cashNum, cashUnit);
        
        console.log(`✅ Found cash: $${cashInMillions}M (from "${match[0]}")`);
        return cashInMillions;
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
function parseFloatData(text, ticker) {
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
  if (unit === 'B') {
    return num * 1000; // Billions to millions
  } else if (unit === 'M') {
    return num; // Already in millions
  }
  return num; // Default to millions
}

/**
 * Store ticker data only if it has changed
 * @param {string} ticker - Stock ticker
 * @param {Object} newData - New float data
 */
async function storeTickerDataIfChanged(ticker, newData) {
  try {
    // Get existing data
    const result = await chrome.storage.local.get(`ticker_${ticker}`);
    const existingData = result[`ticker_${ticker}`];
    
    // Check if data has changed
    if (existingData) {
      const fieldsToCheck = [
        'latestFloat', 'sharesOutstanding', 'estimatedCash',
        'sector', 'industry', 'country', 'marketCap', 'enterpriseValue',
        'regularMarketChange', 'extendedMarketChange'
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