// Simple debug test to run in browser console
console.log('🧪 Starting debug test...');

// Test if the function exists
if (typeof getFloatData === 'function') {
    console.log('✅ getFloatData function exists');
    
    // Test calling it
    getFloatData('OPAD').then(result => {
        console.log('🎯 Test result:', result);
    }).catch(error => {
        console.error('❌ Test error:', error);
    });
} else {
    console.error('❌ getFloatData function not found');
    console.log('Available globals:', Object.keys(window).filter(k => k.includes('dilution') || k.includes('Float')));
}

// Check if DilutionTrackerAPI class exists
if (typeof DilutionTrackerAPI === 'function') {
    console.log('✅ DilutionTrackerAPI class exists');
    
    // Try creating instance manually
    try {
        const api = new DilutionTrackerAPI();
        console.log('✅ API instance created:', api);
        
        api.getFloatData('OPAD').then(result => {
            console.log('🎯 Direct API test result:', result);
        }).catch(error => {
            console.error('❌ Direct API test error:', error);
        });
    } catch (error) {
        console.error('❌ Failed to create API instance:', error);
    }
} else {
    console.error('❌ DilutionTrackerAPI class not found');
}