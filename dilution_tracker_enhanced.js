/**
 * @file
 * dilution_tracker_enhanced.js
 * 
 * Enhanced DilutionTracker API integration for Chrome extension
 * Handles AWS WAF challenges and authentication for reliable float data retrieval
 * 
 * Based on successful Python implementation that bypasses AWS WAF protection
 * and maintains authenticated sessions for bulk processing
 */

class DilutionTrackerAPI {
  constructor() {
    this.authenticated = false;
    this.authTimestamp = null;
    this.sessionTimeout = 90 * 60 * 1000; // 90 minutes (longer like ssera)
    this.cache = new Map(); // ticker -> { timestamp, float, dayKey }
    this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
    
    // Credentials - from working ssera config
    this.email = 'floridamanfinance@gmail.com';
    this.password = '!26goY9#UZ*Zi@*5zq6B5#85';
    
    // Rate limiting (from ssera)
    this.lastRequest = 0;
    this.minRequestInterval = 1000; // 1 second between requests (more conservative)
    this.lastActivity = null;
    this.activityTimeout = 20 * 60 * 1000; // 20 minutes activity timeout
  }

  /**
   * Get current day key for cache invalidation
   * @private
   * @returns {string} Day key in YYYY-MM-DD format
   */
  getCurrentDayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Check if cached data is still valid
   * @private
   * @param {Object} cached - Cached data object
   * @returns {boolean} True if cache is valid
   */
  isCacheValid(cached) {
    if (!cached) return false;
    
    const now = Date.now();
    const currentDayKey = this.getCurrentDayKey();
    
    // Check if it's the same day and within 24 hours
    return cached.dayKey === currentDayKey && 
           (now - cached.timestamp) < this.cacheTimeout;
  }

  /**
   * Get float data for a single ticker
   * @param {string} symbol - Stock ticker symbol
   * @returns {Promise<number|null>} Float value in millions or null if not found
   */
  async getFloatData(symbol) {
    const ticker = symbol.toUpperCase();
    console.log(`🔍 getFloatData() START for ${ticker}`);
    
    // Check cache first
    const cached = this.cache.get(ticker);
    if (this.isCacheValid(cached)) {
      console.log(`💾 Cache HIT for ${ticker}: ${cached.float} (cached on ${cached.dayKey})`);
      return cached.float;
    }
    
    if (cached) {
      console.log(`⏰ Cache EXPIRED for ${ticker} (cached on ${cached.dayKey}, current: ${this.getCurrentDayKey()})`);
    } else {
      console.log(`🆕 No cache found for ${ticker}`);
    }
    
    try {
      console.log('📝 Step 1: Ensuring authentication...');
      // Ensure we're authenticated
      await this.ensureAuthenticated();
      console.log('✅ Authentication check complete');
      
      console.log('⏱️ Step 2: Applying rate limiting...');
      // Rate limiting
      await this.respectRateLimit();
      console.log('✅ Rate limiting complete');
      
      console.log('🌐 Step 3: Fetching float data from API...');
      // Fetch float data via API endpoint
      const floatValue = await this.fetchFloatFromAPI(ticker);
      console.log('📊 Float data received:', floatValue);
      
      // Cache the result with current day key
      const currentDayKey = this.getCurrentDayKey();
      this.cache.set(ticker, {
        timestamp: Date.now(),
        float: floatValue,
        dayKey: currentDayKey
      });
      console.log(`💾 Result cached for ${ticker} on ${currentDayKey}`);
      
      return floatValue;
      
    } catch (error) {
      console.error(`❌ DilutionTracker error for ${ticker}:`, error);
      console.error('Error stack:', error.stack);
      return null;
    }
  }

  /**
   * Get float data for multiple tickers efficiently
   * @param {string[]} symbols - Array of ticker symbols
   * @returns {Promise<Object>} Map of ticker -> float value
   */
  async getBulkFloatData(symbols) {
    const results = {};
    
    try {
      // Ensure authentication once for bulk operation
      await this.ensureAuthenticated();
      
      // Process tickers with rate limiting
      for (const symbol of symbols) {
        const ticker = symbol.toUpperCase();
        
        // Check cache first
        const cached = this.cache.get(ticker);
        if (this.isCacheValid(cached)) {
          console.log(`💾 Bulk cache HIT for ${ticker}: ${cached.float}`);
          results[ticker] = cached.float;
          continue;
        }
        
        // Rate limiting between requests
        await this.respectRateLimit();
        
        try {
          const floatValue = await this.fetchFloatFromAPI(ticker);
          results[ticker] = floatValue;
          
          // Cache the result
          const currentDayKey = this.getCurrentDayKey();
          this.cache.set(ticker, {
            timestamp: Date.now(),
            float: floatValue,
            dayKey: currentDayKey
          });
          
        } catch (error) {
          console.warn(`Failed to get float for ${ticker}:`, error);
          results[ticker] = null;
        }
      }
      
    } catch (error) {
      console.error('Bulk float data fetch failed:', error);
    }
    
    return results;
  }

  /**
   * Ensure we have a valid authenticated session
   * @private
   */
  async ensureAuthenticated() {
    const now = Date.now();
    
    // Check if current session is still valid (from ssera logic)
    const sessionValid = (this.authenticated && this.authTimestamp && 
                         (now - this.authTimestamp) < this.sessionTimeout);
    const activityRecent = (this.lastActivity && 
                           (now - this.lastActivity) < this.activityTimeout);
    
    if (sessionValid && activityRecent) {
      console.log('✅ Using existing valid session');
      return;
    }
    
    if (this.authenticated && !activityRecent) {
      console.log('⚠️ Session expired due to inactivity, re-authenticating...');
    }
    
    // Need to authenticate
    await this.authenticate();
  }

  /**
   * Update last activity timestamp for session management (ssera pattern)
   * @private
   */
  updateActivity() {
    this.lastActivity = Date.now();
    console.log('🕒 Activity timestamp updated for session management');
  }

  /**
   * Replicate the manual CSRF regeneration process that works in ssera
   * Adapted from the working Python implementation with Selenium
   * @private
   */
  async authenticate() {
    try {
      console.log('🔐 Starting AWS WAF bypass authentication (ssera method)...');
      
      // Check if we're running in a Chrome extension context
      const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
      console.log('🔧 Running in extension context:', isExtension);
      
      if (!isExtension) {
        console.warn('⚠️ Not running in Chrome extension - CORS will likely fail');
        return this.authenticateWithMockData();
      }
      
      // Step 1: Fresh session - visit main site to regenerate CSRF tokens (ssera manual process)
      console.log('🔄 Step 1: Manual CSRF regeneration - visiting main dilutiontracker.com');
      
      const mainResponse = await fetch('https://dilutiontracker.com/', {
        method: 'GET',
        credentials: 'include',
        headers: {
          // Exact headers from ssera's successful browser simulation
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
          'Pragma': 'no-cache'
        },
        cache: 'no-cache'
      });
      
      if (!mainResponse.ok) {
        throw new Error(`Main site access failed: ${mainResponse.status} ${mainResponse.statusText}`);
      }
      console.log('✅ Main site loaded - waiting for JavaScript challenges and CSRF token generation');
      
      // Step 1.5: Wait for JavaScript authentication detection (critical insight!)
      console.log('⏳ Waiting for JavaScript authentication detection to complete...');
      // DilutionTracker shows "Login" button initially, then JS checks auth state and removes it
      // This takes ~0.5-1 seconds, but we need extra time for AWS WAF challenges
      await this.delay(5000); // Wait for both JS auth detection AND AWS WAF challenges
      
      // Step 2: Multiple authentication detection passes (critical for JS-based auth)
      console.log('🔍 Step 2: Multiple authentication detection passes (JS-based auth detection)');
      
      // Pass 1: Visit main page and allow extra time for JS auth detection
      console.log('📡 Auth detection pass 1: Main page with extended JS wait');
      await fetch('https://dilutiontracker.com/', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        },
        cache: 'no-cache'
      });
      // Wait for Login button to appear and then disappear (JS auth detection)
      await this.delay(2000);
      
      // Pass 2: Test quick API call to see if JS auth worked
      console.log('🧪 Auth detection pass 2: Quick API test');
      try {
        const quickTest = await fetch('https://api.dilutiontracker.com/v1/getFloat?ticker=OPAD', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Referer': 'https://dilutiontracker.com/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          },
          cache: 'no-cache'
        });
        
        if (quickTest.ok) {
          console.log('✅ Quick API test successful - JS auth detection worked!');
        } else if (quickTest.status === 403) {
          console.log('🔄 Quick API test got 403 - need more JS auth time');
          // Give more time for the JavaScript authentication detection
          await this.delay(3000);
        }
      } catch (e) {
        console.debug('Quick API test failed:', e.message);
      }
      
      // Pass 3: Multi-step browsing pattern (original ssera approach)
      console.log('🌐 Auth detection pass 3: Multi-step browsing pattern');
      const browsingSites = [
        'https://dilutiontracker.com/about',
        'https://dilutiontracker.com/stocks',
        'https://dilutiontracker.com/' // Return home to trigger final JS auth check
      ];
      
      for (const site of browsingSites) {
        try {
          console.log(`📡 Visiting ${site}`);
          await fetch(site, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://dilutiontracker.com/',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'same-origin',
              'Upgrade-Insecure-Requests': '1'
            },
            cache: 'no-cache'
          });
          
          // Allow time for each page's JS auth detection to run
          await this.delay(1500 + Math.random() * 1000); // 1.5-2.5 seconds
        } catch (e) {
          console.debug(`Touchpoint ${site} failed (continuing): ${e.message}`);
        }
      }
      
      // Step 3: Navigate to API subdomain to establish cross-domain session (ssera technique)
      console.log('🔗 Step 3: Establishing API subdomain session (ssera cross-domain)');
      try {
        await fetch('https://api.dilutiontracker.com/', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://dilutiontracker.com/',
            'Origin': 'https://dilutiontracker.com',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-site'
          },
          cache: 'no-cache'
        });
        await this.delay(3000); // Wait for subdomain session establishment (ssera timing)
      } catch (error) {
        console.log('API subdomain visit failed (continuing):', error.message);
      }
      
      // Step 4: Test API access with multiple retry attempts (like ssera resilience)
      console.log('🧪 Step 4: Testing API access with retry logic (ssera approach)');
      
      let testResponse = null;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        attempts++;
        console.log(`🔄 API test attempt ${attempts}/${maxAttempts}`);
        
        try {
          testResponse = await fetch('https://api.dilutiontracker.com/v1/getFloat?ticker=OPAD', {
            method: 'GET',
            credentials: 'include',
            headers: {
              // Exact API headers from ssera's successful requests
              'Accept': 'application/json',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://dilutiontracker.com/',
              'Origin': 'https://dilutiontracker.com',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-site',
              'Cache-Control': 'no-cache'
            },
            cache: 'no-cache'
          });
          
          // If we got a response, break out of retry loop
          if (testResponse) {
            console.log(`📊 API test attempt ${attempts} got response: ${testResponse.status}`);
            break;
          }
        } catch (error) {
          console.warn(`⚠️ API test attempt ${attempts} failed: ${error.message}`);
          if (attempts < maxAttempts) {
            // Wait a bit before retrying, allowing more time for JS auth detection
            console.log('⏳ Waiting before retry (allowing more JS auth time)...');
            await this.delay(3000);
          }
        }
      }

      if (testResponse.ok) {
        try {
          const testData = await testResponse.json();
          console.log('📋 API test successful - parsing response:', testData);
          
          // Check for various response formats (ssera handles multiple formats)
          if (testData && typeof testData.latestFloat === 'number') {
            this.authenticated = true;
            this.authTimestamp = Date.now();
            this.lastActivity = Date.now();
            console.log('✅ AWS WAF bypass successful! CSRF tokens regenerated');
            console.log(`📊 Test result: OPAD float = ${testData.latestFloat}M shares`);
            return;
          } else if (testData && 'ticker' in testData) {
            // Handle different response formats
            for (const field of ['latestFloat', 'float', 'value', 'floatValue']) {
              if (field in testData && typeof testData[field] === 'number') {
                this.authenticated = true;
                this.authTimestamp = Date.now();
                this.lastActivity = Date.now();
                console.log(`✅ AWS WAF bypass successful! Found ${field} = ${testData[field]}`);
                return;
              }
            }
            console.warn('⚠️ API response structure unexpected but valid:', testData);
            // Still consider it authenticated if we got a valid response structure
            this.authenticated = true;
            this.authTimestamp = Date.now();
            this.lastActivity = Date.now();
            return;
          } else {
            console.warn('⚠️ API response format unexpected:', testData);
          }
        } catch (jsonError) {
          console.error('❌ Failed to parse API test response as JSON:', jsonError);
          const textResponse = await testResponse.text();
          console.log('📄 Raw API response:', textResponse.substring(0, 200));
        }
      } else {
        console.error('❌ API test failed after session establishment:', testResponse.status, testResponse.statusText);
        
        if (testResponse.status === 403) {
          console.error('🚫 Still getting 403 Forbidden after CSRF regeneration');
          console.error('💡 The manual CSRF process may have failed');
          console.error('🔗 Manual intervention required: visit https://dilutiontracker.com/app and log in');
          throw new Error('Manual CSRF regeneration failed - please log in at https://dilutiontracker.com/app');
        } else if (testResponse.status === 404) {
          console.warn('⚠️ API endpoint not found - OPAD may not exist, but auth likely succeeded');
          // 404 on specific ticker doesn't mean auth failed
          this.authenticated = true;
          this.authTimestamp = Date.now();
          this.lastActivity = Date.now();
          return;
        }
        
        const errorText = await testResponse.text();
        console.error('❌ API error response:', errorText.substring(0, 200));
        throw new Error(`Authentication test failed: ${testResponse.status} - ${testResponse.statusText}`);
      }
      
      // If we get here, something went wrong but didn't throw
      throw new Error('Authentication completed but verification failed');
      
    } catch (error) {
      console.error('❌ AWS WAF bypass authentication failed:', error);
      this.authenticated = false;
      this.authTimestamp = null;
      throw error;
    }
  }

  /**
   * Fallback authentication with mock data for testing
   * @private
   */
  async authenticateWithMockData() {
    console.log('🎭 Using mock authentication for testing outside extension context');
    this.authenticated = true;
    this.authTimestamp = Date.now();
    this.lastActivity = Date.now();
    return;
  }

  /**
   * Fetch float data from DilutionTracker API using ssera's proven request pattern
   * @private
   * @param {string} ticker - Stock ticker symbol
   * @returns {Promise<number|null>} Float value or null
   */
  async fetchFloatFromAPI(ticker) {
    console.log(`🌐 fetchFloatFromAPI() START for ${ticker} (ssera method)`);
    try {
      const url = `https://api.dilutiontracker.com/v1/getFloat?ticker=${encodeURIComponent(ticker)}`;
      console.log('📡 Making API request to:', url);
      
      // Use exact headers from ssera's successful API calls
      const headers = {
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://dilutiontracker.com/',
        'Origin': 'https://dilutiontracker.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      };
      
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: headers,
        cache: 'no-cache'
      });

      console.log('📊 API response status:', response.status, response.statusText);
      
      if (!response.ok) {
        // Handle 403 with JavaScript authentication detection approach
        if (response.status === 403) {
          console.log('🔄 Got 403 - performing JavaScript authentication detection (new approach)...');
          
          // Step 1: Visit main site and wait for JS auth detection (like manual visit)
          console.log('📡 Step 1: Visiting main site for JavaScript authentication detection');
          await fetch('https://dilutiontracker.com/', {
            method: 'GET',
            credentials: 'include',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Cache-Control': 'no-cache'
            }
          });
          
          // Step 2: Critical wait for JavaScript auth detection (Login button disappears)
          console.log('⏳ Waiting for JavaScript authentication detection to complete...');
          await this.delay(5000); // Extra time for JS auth detection + AWS WAF
          
          // Step 3: Quick test to see if JS auth detection worked
          console.log('🧪 Testing if JavaScript auth detection completed...');
          const testResponse = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: headers,
            cache: 'no-cache'
          });
          
          if (testResponse.ok) {
            console.log('✅ JavaScript auth detection successful!');
            const testData = await testResponse.json();
            this.updateActivity();
            return this.parseFloatResponse(testData);
          } else if (testResponse.status === 403) {
            // If still 403, try full re-authentication
            console.log('🔄 JS auth detection failed, attempting full re-authentication...');
            this.authenticated = false;
            this.authTimestamp = null;
            await this.authenticate();
            
            // Final retry with fresh authentication
            const retryResponse = await fetch(url, {
              method: 'GET',
              credentials: 'include',
              headers: headers,
              cache: 'no-cache'
            });
            
            if (!retryResponse.ok) {
              console.error('❌ Still getting 403 after full re-authentication');
              throw new Error(`Full re-authentication failed: ${retryResponse.status} for ${ticker}`);
            }
            
            const retryData = await retryResponse.json();
            console.log('✅ Retry successful after full re-authentication:', retryData);
            this.updateActivity();
            return this.parseFloatResponse(retryData);
          } else {
            throw new Error(`Unexpected response after JS auth detection: ${testResponse.status} for ${ticker}`);
          }
        }
        
        // Handle 404 (ticker not found) - this is expected for some tickers
        if (response.status === 404) {
          console.log(`ℹ️ Ticker ${ticker} not found on DilutionTracker (404)`);
          return null;
        }
        
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📋 API response data:', data);
      
      // Update activity timestamp for successful requests (ssera pattern)
      this.updateActivity();
      
      return this.parseFloatResponse(data);
      
    } catch (error) {
      console.warn(`API request failed for ${ticker}:`, error.message);
      return null;
    }
  }

  /**
   * Parse float response from API using ssera's multi-field approach
   * @private
   * @param {Object} data - API response data
   * @returns {number|null} Float value or null
   */
  parseFloatResponse(data) {
    console.log('parseFloatResponse() START with data:', data);
    
    if (!data || typeof data !== 'object') {
      console.log('❌ Invalid or missing response data');
      return null;
    }
    
    // Try multiple field names (ssera approach handles various response formats)
    const floatFields = ['latestFloat', 'float', 'value', 'floatValue', 'shares'];
    
    for (const field of floatFields) {
      if (field in data && typeof data[field] === 'number') {
        console.log(`✅ Found float data in field '${field}': ${data[field]}`);
        return data[field];
      }
    }
    
    // Log the structure we got for debugging
    console.warn('⚠️ No float value found in expected fields:', Object.keys(data));
    console.log('📋 Full response structure:', data);
    
    return null;
  }

  /**
   * Respect rate limiting between requests
   * @private
   */
  async respectRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const delay = this.minRequestInterval - timeSinceLastRequest;
      await this.delay(delay);
    }
    
    this.lastRequest = Date.now();
  }

  /**
   * Simple delay utility
   * @private
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear authentication and cache
   */
  reset() {
    this.authenticated = false;
    this.authTimestamp = null;
    this.cache.clear();
    console.log('🔄 DilutionTracker API reset');
  }

  /**
   * Clear only the cache (keep authentication)
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ Cache cleared - all symbols will be fetched fresh');
  }

  /**
   * Force re-authentication by clearing current auth state
   */
  forceReauth() {
    console.log('🔄 Forcing re-authentication...');
    this.authenticated = false;
    this.authTimestamp = null;
    return this.authenticate();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    const currentDayKey = this.getCurrentDayKey();
    const validEntries = Array.from(this.cache.values())
      .filter(entry => this.isCacheValid(entry));
    
    const cacheDetails = {};
    for (const [symbol, entry] of this.cache.entries()) {
      cacheDetails[symbol] = {
        float: entry.float,
        dayKey: entry.dayKey,
        valid: this.isCacheValid(entry),
        ageHours: Math.round((now - entry.timestamp) / (1000 * 60 * 60))
      };
    }
    
    return {
      currentDay: currentDayKey,
      totalCached: this.cache.size,
      validCached: validEntries.length,
      expiredCached: this.cache.size - validEntries.length,
      authenticated: this.authenticated,
      authAge: this.authTimestamp ? now - this.authTimestamp : null,
      cacheDetails
    };
  }
}

// Create global instance for Chrome extension
const dilutionTrackerAPI = new DilutionTrackerAPI();

// Global function to get float data
async function getFloatData(symbol) {
  // Check if we're in extension context
  const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  
  // Check if we're in a content script (subject to CORS) or service worker
  const isContentScript = typeof window !== 'undefined' && window.location;
  
  console.log(`🔧 getFloatData(${symbol}) - Extension: ${!!isExtension}, ContentScript: ${isContentScript}`);
  
  if (isContentScript) {
    console.log(`📨 Content script detected - using message passing for ${symbol}`);
    
    // Use Chrome message passing to service worker (which has host permissions)
    return new Promise((resolve) => {
      try {
        // Set up a client-side timeout as backup (longer for AWS WAF bypass authentication)
        const clientTimeoutId = setTimeout(() => {
          console.warn(`⏰ Content script: Timeout waiting for response for ${symbol} (AWS WAF authentication may be in progress)`);
          resolve(null);
        }, 95000); // 95 second client timeout (longer than service worker timeout for AWS WAF bypass)
        
        chrome.runtime.sendMessage({
          type: 'get-dilution-float',
          symbol: symbol
        }, (response) => {

          console.log(response);

          clearTimeout(clientTimeoutId);
          
          console.log(`📨 Raw service worker response for ${symbol}:`, response);
          console.log(`📨 Response type:`, typeof response);
          console.log(`📨 Response keys:`, response ? Object.keys(response) : 'null/undefined');
          
          if (chrome.runtime.lastError) {
            console.error(`❌ Chrome runtime error for ${symbol}:`, chrome.runtime.lastError);
            resolve(null);
            return;
          }
          
          if (!response) {
            console.warn(`⚠️ No response received from service worker for ${symbol}`);
            resolve(null);
            return;
          }
          
          if (response.error) {
            console.error(`❌ Service worker returned error for ${symbol}:`, response.error);
            resolve(null);
            return;
          }

          const floatValue = response.float;
          console.log(`✅ Extracted float value for ${symbol}:`, floatValue);
          resolve(floatValue);
        });
      } catch (error) {
        console.error(`❌ Error in message passing for ${symbol}:`, error);
        resolve(null);
      }
    });
  }
  
  // We're in service worker context or direct browser - attempt direct API calls
  console.log(`🔧 Making direct API call for ${symbol}...`);
  
  try {
    // Set a timeout for the direct API call
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('API call timeout after 30 seconds')), 30000);
    });
    
    const apiCallPromise = dilutionTrackerAPI.getFloatData(symbol);
    
    const result = await Promise.race([apiCallPromise, timeoutPromise]);
    console.log(`✅ Direct API call successful for ${symbol}:`, result);
    return result;
    
  } catch (error) {
    console.error(`❌ Direct API call failed for ${symbol}:`, error.message);
    
    // If it's a CORS error in browser context, provide helpful message
    if (error.message.includes('CORS') || error.message.includes('fetch')) {
      console.error('💡 CORS restriction detected - this is expected in browser context');
      console.error('💡 The extension service worker has host permissions to bypass this');
    }
    
    return null;
  }
}

// Export for use in Chrome extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DilutionTrackerAPI;
} else if (typeof self !== 'undefined') {
  self.DilutionTrackerAPI = DilutionTrackerAPI;
  self.getFloatData = getFloatData;
}