/**
 * @file
 * debug_auth.js
 * 
 * Debug script to test authentication step by step
 */

// Load the enhanced DilutionTracker
importScripts('dilution_tracker_enhanced.js');

async function debugAuthentication() {
  console.log('🔍 DEBUG: Testing authentication process step by step');
  console.log('═'.repeat(60));
  
  try {
    const api = new DilutionTrackerAPI();
    
    console.log('📊 Initial state:');
    console.log(`   Authenticated: ${api.authenticated}`);
    console.log(`   Auth timestamp: ${api.authTimestamp}`);
    console.log(`   Extension context: ${typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id}`);
    
    console.log('');
    console.log('🚀 Starting authentication process...');
    
    // Override delay function to track progress
    const originalDelay = api.delay.bind(api);
    api.delay = function(ms) {
      console.log(`⏳ Waiting ${ms}ms...`);
      return originalDelay(ms);
    };
    
    console.log('🔐 Calling authenticate()...');
    await api.authenticate();
    
    console.log('');
    console.log('✅ Authentication completed!');
    console.log(`   Authenticated: ${api.authenticated}`);
    console.log(`   Auth timestamp: ${api.authTimestamp}`);
    
    // Test a quick API call
    console.log('');
    console.log('🧪 Testing API call...');
    const floatData = await api.fetchFloatFromAPI('OPAD');
    console.log(`📊 API result: ${floatData}`);
    
  } catch (error) {
    console.error('❌ Authentication debug failed:');
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    
    // Analyze the error
    if (error.message.includes('CORS')) {
      console.error('💡 CORS error - this means fetch() is working but blocked by browser policy');
    } else if (error.message.includes('fetch is not defined')) {
      console.error('💡 Fetch not available - running in wrong context');
    } else if (error.message.includes('timeout')) {
      console.error('💡 Request timed out - network or server issue');
    } else if (error.message.includes('403')) {
      console.error('💡 Still getting 403 - AWS WAF challenge not passed');
    }
  }
}

// Run the debug
debugAuthentication().catch(console.error);