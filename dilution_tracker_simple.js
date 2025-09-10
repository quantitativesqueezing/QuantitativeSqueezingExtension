/**
 * @file
 * dilution_tracker_simple.js
 * 
 * Simplified DilutionTracker API integration - fast authentication
 * Based on AWS WAF bypass insights: normal requests pass through easily
 */

class DilutionTrackerAPI {
  constructor() {
    this.authenticated = false;
    this.authTimestamp = null;
    this.sessionTimeout = 90 * 60 * 1000; // 90 minutes
    this.cache = new Map(); // ticker -> { timestamp, float, dayKey }
    this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
    
    // Rate limiting
    this.lastRequest = 0;
    this.minRequestInterval = 500; // 500ms between requests (faster)
    this.lastActivity = null;
    this.activityTimeout = 20 * 60 * 1000; // 20 minutes activity timeout
  }

  /**
   * Get current day key for cache invalidation
   * @private
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
   */
  isCacheValid(cached) {
    if (!cached) return false;
    
    const now = Date.now();
    const currentDayKey = this.getCurrentDayKey();
    
    return cached.dayKey === currentDayKey && 
           (now - cached.timestamp) < this.cacheTimeout;
  }

  /**
   * Get float data for a single ticker
   */
  async getFloatData(symbol) {
    const ticker = symbol.toUpperCase();
    console.log(`🔍 getFloatData() START for ${ticker}`);
    
    // Check cache first
    const cached = this.cache.get(ticker);
    if (this.isCacheValid(cached)) {
      console.log(`💾 Cache HIT for ${ticker}: ${cached.float}`);
      return cached.float;
    }
    
    try {
      console.log('📝 Ensuring authentication...');
      await this.ensureAuthenticated();
      console.log('✅ Authentication completed');
      
      console.log('⏱️ Applying rate limiting...');
      await this.respectRateLimit();
      console.log('✅ Rate limiting applied');
      
      console.log('🌐 Fetching float data from API...');
      const floatValue = await this.fetchFloatFromAPI(ticker);
      console.log('📊 Received float value:', floatValue, typeof floatValue);
      
      // Cache the result
      const currentDayKey = this.getCurrentDayKey();
      this.cache.set(ticker, {
        timestamp: Date.now(),
        float: floatValue,
        dayKey: currentDayKey
      });
      console.log('💾 Cached result for', ticker);
      
      return floatValue;
      
    } catch (error) {
      console.error(`❌ DilutionTracker error for ${ticker}:`, error);
      return null;
    }
  }

  /**
   * Ensure we have a valid authenticated session
   * @private
   */
  async ensureAuthenticated() {
    const now = Date.now();
    
    const sessionValid = (this.authenticated && this.authTimestamp && 
                         (now - this.authTimestamp) < this.sessionTimeout);
    const activityRecent = (this.lastActivity && 
                           (now - this.lastActivity) < this.activityTimeout);
    
    if (sessionValid && activityRecent) {
      console.log('✅ Using existing valid session');
      return;
    }
    
    await this.authenticate();
  }

  /**
   * Simple and fast authentication - just establish session cookies
   * Based on AWS WAF research: normal browser requests pass through
   * @private
   */
  async authenticate() {
    try {
      console.log('🔐 Starting simple authentication...');
      
      // Check if we're in extension context
      const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
      
      if (!isExtension) {
        console.log('⚠️ Browser context detected - will attempt real requests');
        console.log('⚠️ CORS errors expected but will show actual failure points');
      }
      
      // Step 1: Visit main site to establish session cookies
      console.log('📡 Visiting dilutiontracker.com...');
      
      const mainResponse = await fetch('https://dilutiontracker.com/', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        },
        cache: 'no-cache'
      });
      
      if (!mainResponse.ok) {
        throw new Error(`Main site failed: ${mainResponse.status}`);
      }
      console.log('✅ Main site loaded');
      
      // Step 2: Brief wait for client-side JS (1 second max)
      console.log('⏳ Waiting for client-side JS...');
      await this.delay(1000);
      
      // Step 3: Test API access
      console.log('🧪 Testing API access...');
      
      const testResponse = await fetch('https://api.dilutiontracker.com/v1/getFloat?ticker=OPAD', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://dilutiontracker.com/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Cache-Control': 'no-cache'
        },
        cache: 'no-cache'
      });

      if (testResponse.ok) {
        const testData = await testResponse.json();
        console.log('✅ Authentication successful!', testData);
        
        this.authenticated = true;
        this.authTimestamp = Date.now();
        this.lastActivity = Date.now();
        return;
      }
      
      // If 403, try one more main site visit
      if (testResponse.status === 403) {
        console.log('🔄 Got 403, trying one more main site visit...');
        
        await fetch('https://dilutiontracker.com/app', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          cache: 'no-cache'
        });
        
        await this.delay(2000); // 2 seconds for JS
        
        const retryResponse = await fetch('https://api.dilutiontracker.com/v1/getFloat?ticker=OPAD', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Referer': 'https://dilutiontracker.com/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
          cache: 'no-cache'
        });
        
        if (retryResponse.ok) {
          console.log('✅ Authentication successful on retry!');
          this.authenticated = true;
          this.authTimestamp = Date.now();
          this.lastActivity = Date.now();
          return;
        }
      }
      
      throw new Error(`Authentication failed: ${testResponse.status}`);
      
    } catch (error) {
      console.error('❌ Authentication failed:', error);
      this.authenticated = false;
      this.authTimestamp = null;
      throw error;
    }
  }

  /**
   * Fetch float data from API
   * @private
   */
  async fetchFloatFromAPI(ticker) {
    try {
      const url = `https://api.dilutiontracker.com/v1/getFloat?ticker=${encodeURIComponent(ticker)}`;
      console.log('📡 API request:', url);
      
      // Attempt real API call regardless of context to see actual errors
      
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://dilutiontracker.com/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Cache-Control': 'no-cache'
        },
        cache: 'no-cache'
      });

      console.log('📊 API response:', response.status);
      
      if (!response.ok) {
        if (response.status === 403) {
          // Try re-authentication
          console.log('🔄 Got 403, re-authenticating...');
          this.authenticated = false;
          await this.authenticate();
          
          // Retry once
          const retryResponse = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Referer': 'https://dilutiontracker.com/',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
            cache: 'no-cache'
          });
          
          if (!retryResponse.ok) {
            throw new Error(`API failed after retry: ${retryResponse.status}`);
          }
          
          const retryData = await retryResponse.json();
          this.updateActivity();
          return this.parseFloatResponse(retryData);
        }
        
        if (response.status === 404) {
          console.log(`ℹ️ Ticker ${ticker} not found (404)`);
          return null;
        }
        
        throw new Error(`API failed: ${response.status}`);
      }

      const data = await response.json();
      this.updateActivity();
      return this.parseFloatResponse(data);
      
    } catch (error) {
      console.error(`API request failed for ${ticker}:`, error);
      return null;
    }
  }

  /**
   * Parse float response from API
   * @private
   */
  parseFloatResponse(data) {
    if (!data || typeof data !== 'object') {
      return null;
    }
    
    const floatFields = ['latestFloat', 'float', 'value', 'floatValue'];
    
    for (const field of floatFields) {
      if (field in data && typeof data[field] === 'number') {
        console.log(`✅ Found float: ${data[field]}`);
        return data[field];
      }
    }
    
    console.warn('⚠️ No float value found:', Object.keys(data));
    return null;
  }

  /**
   * Update activity timestamp
   * @private
   */
  updateActivity() {
    this.lastActivity = Date.now();
  }

  /**
   * Rate limiting
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
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Reset authentication
   */
  reset() {
    this.authenticated = false;
    this.authTimestamp = null;
    this.cache.clear();
    console.log('🔄 DilutionTracker reset');
  }
}

// Create global instance
const dilutionTrackerAPI = new DilutionTrackerAPI();

// Global function to get float data
async function getFloatData(symbol) {
  const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  const isContentScript = typeof window !== 'undefined' && window.location;
  
  console.log(`🔧 getFloatData(${symbol}) - Extension: ${!!isExtension}, ContentScript: ${isContentScript}`);
  
  if (isContentScript && isExtension) {
    console.log(`📨 Using message passing for ${symbol}`);
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn(`⏰ Timeout for ${symbol}`);
        resolve(null);
      }, 15000); // 15 second timeout (much faster)
      
      chrome.runtime.sendMessage({
        type: 'get-dilution-float',
        symbol: symbol
      }, (response) => {
        clearTimeout(timeout);
        
        if (chrome.runtime.lastError) {
          console.error('Runtime error:', chrome.runtime.lastError);
          resolve(null);
          return;
        }
        
        resolve(response?.float || null);
      });
    });
  }
  
  // Direct API call
  console.log(`🔧 Making direct API call for ${symbol}...`);
  
  try {
    const result = await dilutionTrackerAPI.getFloatData(symbol);
    console.log(`✅ Direct API result: ${result}`);
    return result;
  } catch (error) {
    console.error(`❌ Direct API failed: ${error.message}`);
    return null;
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DilutionTrackerAPI;
} else if (typeof self !== 'undefined') {
  self.DilutionTrackerAPI = DilutionTrackerAPI;
  self.getFloatData = getFloatData;
}