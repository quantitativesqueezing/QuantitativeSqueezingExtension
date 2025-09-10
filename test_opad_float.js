/**
 * @file
 * test_opad_float.js
 * 
 * Specific test for OPAD float fetching from DilutionTracker
 * Tests the AWS WAF bypass and authentication flow
 */

// Import the enhanced DilutionTracker API
importScripts('dilution_tracker_enhanced.js');

async function testOPADFloat() {
  console.log('🧪 Starting OPAD float fetch test...');
  console.log('🧪 This test will verify:');
  console.log('   - AWS WAF protection bypass');
  console.log('   - JavaScript authentication detection');
  console.log('   - Free float data retrieval for OPAD');
  console.log('');
  
  try {
    // Test the global getFloatData function
    console.log('📡 Testing getFloatData("OPAD")...');
    const startTime = Date.now();
    
    const floatData = await getFloatData('OPAD');
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('');
    console.log('📊 RESULTS:');
    console.log('═══════════════════════════════════════════');
    console.log(`⏱️  Duration: ${duration} seconds`);
    console.log(`📈 OPAD Float: ${floatData}`);
    
    if (floatData !== null && floatData !== undefined) {
      console.log('✅ SUCCESS: Float data retrieved successfully!');
      
      if (typeof floatData === 'number') {
        console.log(`📊 Float as number: ${floatData}M shares`);
      } else {
        console.log(`📊 Float as string: "${floatData}"`);
      }
      
      // Test cache functionality
      console.log('');
      console.log('🧪 Testing cache functionality...');
      const cacheStartTime = Date.now();
      const cachedData = await getFloatData('OPAD');
      const cacheEndTime = Date.now();
      const cacheDuration = ((cacheEndTime - cacheStartTime) / 1000).toFixed(2);
      
      console.log(`⚡ Cached call duration: ${cacheDuration} seconds`);
      console.log(`📊 Cached result: ${cachedData}`);
      
      if (cacheDuration < 1.0) {
        console.log('✅ Cache working properly (fast response)');
      } else {
        console.log('⚠️ Cache may not be working (slow response)');
      }
      
    } else {
      console.log('❌ FAILED: No float data received');
      console.log('💡 Possible issues:');
      console.log('   - AWS WAF challenge not passed');
      console.log('   - Authentication failed');
      console.log('   - OPAD not found in database');
      console.log('   - Network connectivity issues');
    }
    
  } catch (error) {
    console.error('❌ TEST FAILED with error:');
    console.error(error);
    console.error('');
    console.error('🔍 Error analysis:');
    
    if (error.message.includes('403')) {
      console.error('   - AWS WAF protection blocking request');
      console.error('   - Try manual login at https://dilutiontracker.com/app');
    } else if (error.message.includes('CORS')) {
      console.error('   - CORS policy blocking request');
      console.error('   - Ensure running in Chrome extension context');
    } else if (error.message.includes('timeout')) {
      console.error('   - Request timeout (authentication taking too long)');
      console.error('   - AWS WAF challenges may be complex');
    } else {
      console.error(`   - Unexpected error: ${error.message}`);
    }
  }
  
  console.log('');
  console.log('🧪 Test completed');
}

// Also test the DilutionTrackerAPI class directly
async function testDilutionTrackerAPI() {
  console.log('');
  console.log('🧪 Testing DilutionTrackerAPI class directly...');
  
  try {
    const api = new DilutionTrackerAPI();
    
    // Get cache stats before
    const statsBefore = api.getCacheStats();
    console.log('📊 Cache stats before:', statsBefore);
    
    const floatData = await api.getFloatData('OPAD');
    console.log(`📈 Direct API result: ${floatData}`);
    
    // Get cache stats after
    const statsAfter = api.getCacheStats();
    console.log('📊 Cache stats after:', statsAfter);
    
    if (floatData !== null) {
      console.log('✅ Direct API call successful');
    } else {
      console.log('❌ Direct API call returned null');
    }
    
  } catch (error) {
    console.error('❌ Direct API test failed:', error);
  }
}

// Run the tests
console.log('🚀 Starting DilutionTracker OPAD Float Test Suite');
console.log('═══════════════════════════════════════════════════');

testOPADFloat().then(() => {
  return testDilutionTrackerAPI();
}).then(() => {
  console.log('');
  console.log('🎯 All tests completed');
  console.log('═══════════════════════════════════════════════════');
}).catch((error) => {
  console.error('🚨 Test suite failed:', error);
});