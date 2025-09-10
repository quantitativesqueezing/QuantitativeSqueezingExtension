/**
 * Inspect DilutionTracker login form to find correct endpoint
 * 
 * Run this in the service worker console to find the real login endpoint
 */

async function inspectDilutionTrackerLogin() {
  try {
    console.log('🔍 Inspecting DilutionTracker login form...');
    
    // Get the main app page HTML
    const response = await fetch('https://dilutiontracker.com/app', {
      credentials: 'include',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
      cache: 'no-cache'
    });
    
    if (!response.ok) {
      console.error('❌ Failed to fetch app page:', response.status);
      return;
    }
    
    const html = await response.text();
    console.log('📄 App page HTML length:', html.length);
    
    // Look for login forms, API endpoints, and JavaScript that might reveal the login URL
    const patterns = [
      /action="([^"]*login[^"]*)"/gi,
      /fetch\(['"`]([^'"`]*login[^'"`]*)/gi,
      /post\(['"`]([^'"`]*login[^'"`]*)/gi,
      /api\/[^'"`\s]*login[^'"`\s]*/gi,
      /\/auth\/[^'"`\s]*login[^'"`\s]*/gi,
      /'([^']*login[^']*)'/gi,
      /"([^"]*login[^"]*)"/gi
    ];
    
    const foundEndpoints = new Set();
    
    patterns.forEach((pattern, index) => {
      const matches = [...html.matchAll(pattern)];
      matches.forEach(match => {
        const endpoint = match[1] || match[0];
        if (endpoint && endpoint.includes('login')) {
          foundEndpoints.add(endpoint);
          console.log(`🔍 Pattern ${index + 1} found:`, endpoint);
        }
      });
    });
    
    console.log('📋 All unique login-related endpoints found:');
    [...foundEndpoints].forEach((endpoint, i) => {
      console.log(`${i + 1}. ${endpoint}`);
    });
    
    // Look for any JavaScript files that might contain API endpoints
    const scriptMatches = [...html.matchAll(/<script[^>]+src="([^"]+)"/gi)];
    console.log('📜 JavaScript files found:');
    scriptMatches.forEach((match, i) => {
      console.log(`${i + 1}. ${match[1]}`);
    });
    
    // Look for form fields that might indicate the expected login format
    const formFields = [...html.matchAll(/<input[^>]+name="([^"]+)"/gi)];
    console.log('📝 Form fields found:');
    formFields.forEach((match, i) => {
      console.log(`${i + 1}. ${match[1]}`);
    });
    
    return foundEndpoints;
    
  } catch (error) {
    console.error('❌ Failed to inspect login form:', error);
    return null;
  }
}

// Run the inspection
inspectDilutionTrackerLogin();