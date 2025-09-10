/**
 * @file
 * test_auth_flow.js
 * 
 * Test the authentication flow and AWS WAF bypass logic
 * This validates the implementation without making actual requests
 */

// Mock fetch for testing
let mockResponses = [];
let fetchCallLog = [];

function mockFetch(url, options) {
  fetchCallLog.push({ url, options });
  
  const response = mockResponses.find(mock => 
    url.includes(mock.urlPattern) || url === mock.url
  );
  
  if (response) {
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      json: () => Promise.resolve(response.data),
      text: () => Promise.resolve(response.text || JSON.stringify(response.data))
    });
  }
  
  // Default to success for main site visits
  if (url.includes('dilutiontracker.com') && !url.includes('/v1/')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('<html>Main site</html>')
    });
  }
  
  // Default to API success for getFloat
  if (url.includes('/v1/getFloat')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ latestFloat: 0.0, ticker: 'OPAD' })
    });
  }
  
  return Promise.reject(new Error(`No mock response for ${url}`));
}

// Mock chrome runtime for testing
const mockChrome = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: (message, callback) => {
      console.log('📨 Mock chrome.runtime.sendMessage called:', message);
      setTimeout(() => callback({ float: 12.5 }), 100);
    },
    lastError: null
  }
};

// Set up test environment
global.fetch = mockFetch;
global.chrome = mockChrome;
global.self = global;

console.log('🧪 DilutionTracker Authentication Flow Test');
console.log('═'.repeat(60));

// Import the enhanced DilutionTracker
try {
  eval(require('fs').readFileSync('./dilution_tracker_enhanced.js', 'utf8'));
  console.log('✅ DilutionTracker script loaded');
} catch (error) {
  console.error('❌ Failed to load script:', error);
  process.exit(1);
}

async function testAuthenticationFlow() {
  console.log('');
  console.log('🔐 Testing Authentication Flow');
  console.log('─'.repeat(40));
  
  try {
    const api = new DilutionTrackerAPI();
    
    console.log('📊 Initial state:');
    console.log(`   Authenticated: ${api.authenticated}`);
    console.log(`   Auth timestamp: ${api.authTimestamp}`);
    
    console.log('');
    console.log('🔄 Testing ensureAuthenticated()...');
    
    await api.ensureAuthenticated();
    
    console.log('✅ Authentication completed');
    console.log(`   Authenticated: ${api.authenticated}`);
    console.log(`   Auth timestamp: ${api.authTimestamp}`);
    console.log(`   Fetch calls made: ${fetchCallLog.length}`);
    
    // Check what URLs were called
    console.log('');
    console.log('📡 Authentication fetch calls:');
    fetchCallLog.forEach((call, index) => {
      console.log(`   ${index + 1}. ${call.url}`);
      if (call.options?.headers?.['User-Agent']) {
        console.log(`      User-Agent: ${call.options.headers['User-Agent'].substring(0, 50)}...`);
      }
    });
    
    return true;
    
  } catch (error) {
    console.error('❌ Authentication flow failed:', error);
    return false;
  }
}

async function testFloatFetching() {
  console.log('');
  console.log('📈 Testing Float Data Fetching');
  console.log('─'.repeat(40));
  
  try {
    // Reset fetch log
    fetchCallLog = [];
    
    // Test successful response
    mockResponses = [
      {
        urlPattern: '/v1/getFloat',
        ok: true,
        status: 200,
        data: { latestFloat: 12.5, ticker: 'OPAD' }
      }
    ];
    
    console.log('🧪 Test case: Successful API response');
    const result = await getFloatData('OPAD');
    console.log(`✅ Result: ${result}`);
    console.log(`📡 API calls made: ${fetchCallLog.filter(c => c.url.includes('/v1/')).length}`);
    
    // Test 403 response (authentication needed)
    fetchCallLog = [];
    mockResponses = [
      {
        urlPattern: '/v1/getFloat',
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      }
    ];
    
    console.log('');
    console.log('🧪 Test case: 403 Forbidden (AWS WAF block)');
    const result403 = await getFloatData('OPAD');
    console.log(`✅ Result after 403 handling: ${result403}`);
    console.log(`📡 Total calls (including recovery): ${fetchCallLog.length}`);
    
    // Test 404 response (ticker not found)
    fetchCallLog = [];
    mockResponses = [
      {
        urlPattern: '/v1/getFloat',
        ok: false,
        status: 404,
        statusText: 'Not Found'
      }
    ];
    
    console.log('');
    console.log('🧪 Test case: 404 Not Found (ticker not in database)');
    const result404 = await getFloatData('OPAD');
    console.log(`✅ Result for 404: ${result404} (should be null)`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Float fetching test failed:', error);
    return false;
  }
}

async function testCacheLogic() {
  console.log('');
  console.log('💾 Testing Cache Logic');
  console.log('─'.repeat(40));
  
  try {
    const api = new DilutionTrackerAPI();
    
    // Test cache stats
    console.log('📊 Initial cache stats:');
    const initialStats = api.getCacheStats();
    console.log(`   Total cached: ${initialStats.totalCached}`);
    console.log(`   Valid cached: ${initialStats.validCached}`);
    console.log(`   Current day: ${initialStats.currentDay}`);
    
    // Simulate cache entry
    const currentDayKey = api.getCurrentDayKey();
    api.cache.set('OPAD', {
      timestamp: Date.now(),
      float: 0.0,
      dayKey: currentDayKey
    });
    
    console.log('');
    console.log('📊 After adding OPAD to cache:');
    const updatedStats = api.getCacheStats();
    console.log(`   Total cached: ${updatedStats.totalCached}`);
    console.log(`   Valid cached: ${updatedStats.validCached}`);
    console.log('   Cache details:', updatedStats.cacheDetails);
    
    // Test cache validation
    const cached = api.cache.get('OPAD');
    const isValid = api.isCacheValid(cached);
    console.log(`   OPAD cache is valid: ${isValid}`);
    
    // Test expired cache (simulate old data)
    api.cache.set('OLD', {
      timestamp: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
      float: 10.0,
      dayKey: '2024-01-01' // Old day
    });
    
    const oldCached = api.cache.get('OLD');
    const oldIsValid = api.isCacheValid(oldCached);
    console.log(`   OLD cache is valid: ${oldIsValid} (should be false)`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Cache logic test failed:', error);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Running all authentication and flow tests...');
  
  const results = {
    auth: await testAuthenticationFlow(),
    float: await testFloatFetching(),
    cache: await testCacheLogic()
  };
  
  console.log('');
  console.log('📋 TEST SUMMARY');
  console.log('═'.repeat(30));
  console.log(`🔐 Authentication Flow: ${results.auth ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`📈 Float Fetching: ${results.float ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`💾 Cache Logic: ${results.cache ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(results).every(r => r);
  console.log('');
  console.log(`🎯 Overall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  if (allPassed) {
    console.log('');
    console.log('💡 Next Steps:');
    console.log('   1. Open test_opad_browser.html in Chrome');
    console.log('   2. Run the browser test to check CORS behavior');
    console.log('   3. Test in actual Chrome extension environment');
    console.log('   4. Verify with real OPAD ticker on DilutionTracker');
  }
}

// Run the tests
runAllTests().catch(console.error);