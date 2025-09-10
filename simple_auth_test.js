/**
 * Simple authentication test
 * 
 * Run this in the service worker console to test authentication step by step
 */

console.log('🔐 Testing DilutionTracker authentication...');

async function simpleAuthTest() {
  try {
    console.log('📡 Step 1: Testing main app page access...');
    
    const mainResponse = await fetch('https://dilutiontracker.com/app', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      cache: 'no-cache'
    });
    
    console.log('📊 Main app response status:', mainResponse.status);
    console.log('📊 Main app response headers:', Object.fromEntries(mainResponse.headers.entries()));
    
    if (!mainResponse.ok) {
      console.error('❌ Failed to load main app page');
      return false;
    }
    
    console.log('✅ Main app page loaded successfully');
    
    console.log('⏳ Waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('📡 Step 2: Testing API access with OPAD...');
    
    const apiResponse = await fetch('https://api.dilutiontracker.com/v1/getFloat?ticker=OPAD', {
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
    
    console.log('📊 API response status:', apiResponse.status);
    console.log('📊 API response statusText:', apiResponse.statusText);
    console.log('📊 API response headers:', Object.fromEntries(apiResponse.headers.entries()));
    
    if (apiResponse.ok) {
      const data = await apiResponse.json();
      console.log('📋 API response data:', data);
      
      if (data && typeof data.latestFloat === 'number') {
        console.log(`✅ SUCCESS! OPAD float data: ${data.latestFloat}M shares`);
        return data.latestFloat;
      } else {
        console.log('⚠️ API response format unexpected:', data);
        return null;
      }
    } else {
      console.log('❌ API request failed');
      const errorText = await apiResponse.text();
      console.log('❌ Error response:', errorText);
      return null;
    }
    
  } catch (error) {
    console.error('❌ Authentication test failed:', error);
    return null;
  }
}

// Test without credentials (to see if site is accessible)
async function testWithoutAuth() {
  try {
    console.log('🌐 Testing API without authentication...');
    
    const response = await fetch('https://api.dilutiontracker.com/v1/getFloat?ticker=OPAD', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-cache'
    });
    
    console.log('📊 No-auth response status:', response.status);
    
    if (response.status === 401 || response.status === 403) {
      console.log('✅ Expected: API requires authentication');
      return 'auth_required';
    } else if (response.ok) {
      const data = await response.json();
      console.log('📋 Unexpected success without auth:', data);
      return data;
    } else {
      console.log('❌ Unexpected response without auth:', response.status);
      return null;
    }
    
  } catch (error) {
    console.error('❌ No-auth test failed:', error);
    return null;
  }
}

async function runAuthTests() {
  console.log('🔐 DILUTION TRACKER AUTHENTICATION TEST');
  console.log('=' .repeat(50));
  
  // Test 1: Without auth (should fail)
  console.log('\n📋 TEST 1: API without authentication');
  const noAuthResult = await testWithoutAuth();
  
  // Test 2: With auth flow
  console.log('\n📋 TEST 2: Full authentication flow');
  const authResult = await simpleAuthTest();
  
  console.log('\n' + '=' .repeat(50));
  console.log('📊 AUTHENTICATION TEST RESULTS:');
  console.log('=' .repeat(50));
  console.log('🚫 Without auth:', noAuthResult);
  console.log('🔐 With auth:', authResult);
  
  return authResult;
}

// Run the auth test
runAuthTests();