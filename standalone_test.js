/**
 * Standalone test for getFloatData() function
 * 
 * To use this:
 * 1. Load your Chrome extension
 * 2. Go to chrome://extensions → Click "service worker" link for your extension
 * 3. Copy and paste this entire script into the service worker console
 * 4. It will test the OPAD float data and show you exactly what's happening
 */

console.log('🧪 Starting standalone OPAD test...');

async function standaloneTest() {
  try {
    console.log('🔧 Step 1: Checking if dilutionTrackerAPI exists...');
    if (typeof dilutionTrackerAPI === 'undefined') {
      console.error('❌ dilutionTrackerAPI not found in service worker');
      return;
    }
    console.log('✅ dilutionTrackerAPI found:', dilutionTrackerAPI);

    console.log('🔧 Step 2: Testing direct API call...');
    console.log('📞 Calling dilutionTrackerAPI.getFloatData("OPAD")...');
    
    const startTime = Date.now();
    const result = await dilutionTrackerAPI.getFloatData('OPAD');
    const endTime = Date.now();
    
    console.log(`⏱️ API call took ${endTime - startTime}ms`);
    console.log('📊 Raw result:', result);
    console.log('📊 Result type:', typeof result);
    console.log('📊 Result === null:', result === null);
    console.log('📊 Result === undefined:', result === undefined);
    
    if (result !== null && result !== undefined) {
      console.log('✅ SUCCESS! OPAD float data:', result);
      return result;
    } else {
      console.log('❌ No float data returned for OPAD');
      return null;
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    return null;
  }
}

// Also test the API endpoint directly
async function testAPIDirectly() {
  try {
    console.log('🌐 Testing API endpoint directly...');
    
    const response = await fetch('https://api.dilutiontracker.com/v1/getFloat?ticker=OPAD', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://dilutiontracker.com/app',
        'Origin': 'https://dilutiontracker.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      },
      cache: 'no-cache'
    });
    
    console.log('📡 Direct API response status:', response.status);
    console.log('📡 Direct API response headers:', Object.fromEntries(response.headers.entries()));
    
    if (response.ok) {
      const data = await response.json();
      console.log('📋 Direct API response data:', data);
      
      if (data && typeof data.latestFloat === 'number') {
        console.log('✅ Direct API SUCCESS! OPAD float:', data.latestFloat);
        return data.latestFloat;
      } else {
        console.log('❌ Direct API returned unexpected format:', data);
        return null;
      }
    } else {
      console.log('❌ Direct API failed with status:', response.status);
      const text = await response.text();
      console.log('❌ Direct API response text:', text);
      return null;
    }
    
  } catch (error) {
    console.error('❌ Direct API test failed:', error);
    return null;
  }
}

// Run both tests
async function runAllTests() {
  console.log('=' .repeat(50));
  console.log('🧪 RUNNING COMPREHENSIVE OPAD FLOAT TEST');
  console.log('=' .repeat(50));
  
  // Test 1: Using our API wrapper
  console.log('\n📋 TEST 1: Using dilutionTrackerAPI.getFloatData()');
  const result1 = await standaloneTest();
  
  // Test 2: Direct API call
  console.log('\n📋 TEST 2: Direct API endpoint test');
  const result2 = await testAPIDirectly();
  
  // Summary
  console.log('\n' + '=' .repeat(50));
  console.log('📊 TEST RESULTS SUMMARY:');
  console.log('=' .repeat(50));
  console.log('🔧 API Wrapper Result:', result1);
  console.log('🌐 Direct API Result:', result2);
  
  if (result1 !== null) {
    console.log('✅ SUCCESS: API wrapper is working!');
  } else if (result2 !== null) {
    console.log('⚠️ Direct API works, but wrapper has issues');
  } else {
    console.log('❌ Both tests failed - API or network issue');
  }
}

// Start the test
runAllTests();