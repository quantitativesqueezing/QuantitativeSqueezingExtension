/**
 * @file
 * dilutiontracker_content.js
 * 
 * Content script for dilutiontracker.com pages
 * Extracts Float & OS data from company pages and stores in extension storage
 */

// Prevent multiple executions
if (window.qseDilutionTrackerLoaded) {
  console.log('🔍 DilutionTracker content script already loaded, skipping');
} else {
  window.qseDilutionTrackerLoaded = true;
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
    
    // Parse float and shares outstanding values
    const floatData = parseFloatData(floatText);
    
    // Combine all data
    if (floatData) {
      if (estimatedCash) floatData.estimatedCash = estimatedCash;
      if (companyData) Object.assign(floatData, companyData);
      if (priceData) Object.assign(floatData, priceData);
    }
    
    if (floatData) {
      console.log('📊 Parsed data:', floatData);
      
      // Add checkmark icons for verified data (with slight delay to ensure DOM is ready)
      setTimeout(() => {
        addVerificationIcons(ticker, floatData);
      }, 500);
      
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
    
    console.log(`🔍 Searching company data in text: "${fullText.substring(0, 500)}..."`);
    
    // More precise patterns using word boundaries - enhanced for better matching
    const patterns = [
      { field: 'sector', regex: [
        /\bSector:\s*([^\n\r]*?)(?=\s*Industry:|\s*Country:|\s*Exchange:|\s*$)/i,
        /\bSector[:\s]+([^|\n\r]+?)(?=\s+Industry|\s+Country|\s+Exchange|$)/i,
        /sector[:\s]*([^|\n\r,;]+)/i,
        // Additional flexible patterns
        /\bSector\s+([A-Za-z\s&-]+?)(?=\s+Industry|\s+Country|\s+Exchange|\s*$)/i,
        /Sector[:\s]*([A-Za-z\s&-]+)(?=\s*\||\s*Industry|\s*Country)/i,
        /\bSector\b[:\s]*([A-Za-z\s&-]+?)(?=\s*\n|\s*\r|$)/i
      ]},
      { field: 'industry', regex: [
        /\bIndustry:\s*([^\n\r]*?)(?=\s*Country:|\s*Exchange:|\s*Sector:|\s*$)/i,
        /\bIndustry[:\s]+([^|\n\r]+?)(?=\s+Country|\s+Exchange|\s+Sector|$)/i,
        /industry[:\s]*([^|\n\r,;]+)/i,
        // Additional flexible patterns
        /\bIndustry\s+([A-Za-z\s&-]+?)(?=\s+Country|\s+Exchange|\s+Sector|\s*$)/i,
        /Industry[:\s]*([A-Za-z\s&-]+)(?=\s*\||\s*Country|\s*Exchange)/i,
        /\bIndustry\b[:\s]*([A-Za-z\s&-]+?)(?=\s*\n|\s*\r|$)/i
      ]},
      { field: 'country', regex: [
        /\bCountry:\s*([^\n\r]*?)(?=\s*Exchange:|\s*Sector:|\s*Industry:|\s*$)/i,
        /\bCountry[:\s]+([^|\n\r]+?)(?=\s+Exchange|\s+Sector|\s+Industry|$)/i,
        /country[:\s]*([^|\n\r,;]+)/i
      ]},
      { field: 'exchange', regex: [
        /\bExchange:\s*([^\n\r]*?)(?=\s*Sector:|\s*Industry:|\s*Country:|\s*$)/i,
        /\bExchange[:\s]+([^|\n\r]+?)(?=\s+Sector|\s+Industry|\s+Country|$)/i,
        /exchange[:\s]*([^|\n\r,;]+)/i
      ]},
      { field: 'institutionalOwnership', regex: [
        /\bInst Own:\s*([0-9.,]+%?)/i,
        /\bInstitutional Ownership[:\s]*([0-9.,]+%?)/i,
        /\bInst[:\s]+([0-9.,]+%?)/i
      ]},
      { field: 'marketCap', regex: [
        /\bMkt Cap & EV:\s*([0-9.,]+[KMB])\s*\//i,
        /\bMarket Cap[:\s]*([0-9.,]+[KMB])/i,
        /\bMkt Cap[:\s]*([0-9.,]+[KMB])/i
      ]},
      { field: 'enterpriseValue', regex: [
        /\bMkt Cap & EV:\s*[0-9.,]+[KMB]\s*\/\s*([0-9.,]+[KMB])/i,
        /\bEnterprise Value[:\s]*([0-9.,]+[KMB])/i,
        /\bEV[:\s]*([0-9.,]+[KMB])/i
      ]}
    ];
    
    // Extract description from #companyDesc element
    const companyDescElement = document.getElementById('companyDesc');
    if (companyDescElement) {
      result.description = companyDescElement.textContent?.trim();
      console.log(`✅ Found description: ${result.description?.substring(0, 100)}...`);
    }
    
    patterns.forEach(({ field, regex }) => {
      const regexArray = Array.isArray(regex) ? regex : [regex];
      
      // Special debugging for sector and industry
      if (field === 'sector' || field === 'industry') {
        console.log(`🔍 DEBUG ${field}: Trying ${regexArray.length} patterns against text sample:`, fullText.substring(0, 500));
      }
      
      for (let i = 0; i < regexArray.length; i++) {
        const currentRegex = regexArray[i];
        const match = fullText.match(currentRegex);
        
        // Special debugging for sector and industry
        if (field === 'sector' || field === 'industry') {
          console.log(`🔍 DEBUG ${field} pattern ${i + 1}: ${currentRegex} -> ${match ? `Match: "${match[1]}"` : 'No match'}`);
        }
        
        if (match && match[1]) {
          result[field] = match[1].trim();
          console.log(`✅ Found ${field}: ${result[field]} (using pattern ${i + 1})`);
          break; // Stop after first match
        }
      }
      
      if (!result[field]) {
        console.log(`❌ Could not find ${field} in text`);
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
  if (unit === 'B') {
    return num * 1000; // Billions to millions
  } else if (unit === 'M') {
    return num; // Already in millions
  }
  return num; // Default to millions
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
      if (currentData[field] && (isFirstTime || storedData?.[field] === currentData[field])) {
        const value = unit ? `${currentData[field]}${unit}` : currentData[field];
        matchingFields.push({ field, value, label });
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
    
    matchingFields.forEach(({ field, value, label }) => {
      const container = findContainerForValue(field, label, value);
      if (container) {
        addCheckmarkToContainer(container, field, label, value, isFirstTime);
      } else {
        console.log(`❌ Could not find container for ${field}: ${label}`);
      }
    });
    
    // Additional direct searches for specific elements
    highlightDirectElements(matchingFields);
    
    console.log(`✅ Added individual checkmarks for ${matchingFields.length} fields`);
    
  } catch (error) {
    console.error('❌ Error adding individual checkmarks:', error);
  }
}

/**
 * Direct search and highlight for specific DilutionTracker elements
 * @param {Array} matchingFields - Array of field objects to check
 */
function highlightDirectElements(matchingFields) {
  console.log(`🎯 Starting direct element highlighting`);
  
  // Create a map of field values for quick lookup
  const fieldValues = {};
  matchingFields.forEach(({ field, value }) => {
    fieldValues[field] = value;
  });
  
  // 1. Search for "Industry:" and highlight its sibling value
  highlightLabelSibling('Industry:', fieldValues.industry);
  
  // 2. Search for "Sector:" and highlight its sibling value  
  highlightLabelSibling('Sector:', fieldValues.sector);
  
  // 3. Search for "Country:" and highlight its sibling value
  highlightLabelSibling('Country:', fieldValues.country);
  
  // 4. Search for "Exchange:" and highlight its sibling value
  highlightLabelSibling('Exchange:', fieldValues.exchange);
  
  // 5. Search for "Inst Own:" and highlight its sibling value
  highlightLabelSibling('Inst Own:', fieldValues.institutionalOwnership);
  
  // 6. Highlight #companyDesc element
  const companyDescElement = document.getElementById('companyDesc');
  if (companyDescElement && fieldValues.description) {
    console.log(`🎯 Found #companyDesc element, applying green color`);
    companyDescElement.style.color = 'rgb(34, 197, 94) !important';
    companyDescElement.style.fontWeight = '500';
    companyDescElement.classList.add('qse-verified-value');
  }
  
  // 7. Search for "estimated current cash" text and highlight containing element
  if (fieldValues.estimatedCash) {
    highlightTextContainingElement('estimated current cash of', fieldValues.estimatedCash);
  }
  
  // 8. Also highlight just the "and estimated current cash of" text itself
  highlightSpecificText('and estimated current cash of');
}

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
  while (node = walker.nextNode()) {
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
function addCheckmarkToContainer(container, field, label, value, isFirstTime) {
  try {
    // Check if green styling already applied to this container
    if (container.style.color === 'rgb(34, 197, 94)' || container.classList.contains('qse-verified-label') || container.classList.contains('qse-verified-value')) {
      console.log(`⚠️ Green styling already applied to container for ${field}`);
      return;
    }
    
    // For label highlighting, we want to find and highlight the label part if this container has both
    const containerText = container.textContent;
    const hasLabel = containerText.includes(':') || 
                     containerText.toLowerCase().includes('float') || 
                     containerText.toLowerCase().includes('outstanding') ||
                     containerText.toLowerCase().includes('shares');
    
    if (hasLabel) {
      // Try to find the label portion and highlight it
      highlightLabelInContainer(container, field, label, value, isFirstTime);
    } else {
      // If no clear label structure, highlight the whole container (for backwards compatibility)
      container.style.color = 'rgb(34, 197, 94)';
      container.style.fontWeight = '500';
      container.title = isFirstTime ? 
        `First time extracting ${label}: ${value}` : 
        `${label} matches extension storage: ${value}`;
      container.classList.add('qse-verified-label');
      console.log(`✅ Applied green styling to whole container for ${field} (${label}): ${value}`);
    }
    
  } catch (error) {
    console.error(`❌ Error applying green styling to container for ${field}:`, error);
  }
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
c
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