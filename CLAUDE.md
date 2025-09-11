# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quantitative Squeezing Insights is a Chrome Extension (Manifest V3) that displays financial metrics in tooltips when hovering over ticker symbols (e.g., `$TSLA`, `$SPY`) on any website. The extension fetches data from multiple sources including DilutionTracker, Fintel, and FinViz to show:

- Free Float and Shares Outstanding
- Short Interest percentage 
- Cost to Borrow (CTB) rates
- Latest Fail-to-Deliver (FTD) data

## Development Commands

Since this is a Chrome extension without a build system, there are no npm scripts. Development workflow:

1. **Load Extension**: Load unpacked extension in Chrome at `chrome://extensions` with Developer mode enabled
2. **Test Extension**: Use the provided HTML test files in the root directory
3. **Debug**: Use Chrome DevTools console and the extension's service worker debugging

## Testing

The extension includes several HTML test files for development:
- `test_extension.html` - Basic ticker symbol testing
- `test_opad.html` - Specific ticker testing
- `test_simple_auth.html` - Authentication flow testing  
- `test_storage_system.html` - Cache and storage testing
- `enhanced_tooltip_features.html` - UI feature testing

Test JavaScript files:
- `simple_auth_test.js` - Authentication testing
- `standalone_test.js` - Isolated feature testing
- `test_auth_flow.js` - Full authentication flow
- `debug_*.js` - Various debugging utilities

## Architecture

### Core Components

**Content Scripts** (runs on web pages):
- `content.js` - Main content script that detects ticker symbols and shows tooltips on all URLs
- `dilutiontracker_content.js` - DilutionTracker-specific functionality  
- `fintel_content.js` - Fintel-specific functionality

**Service Worker** (background script):
- `service_worker.js` - Handles cross-origin data fetching, caching, and message passing between content scripts

**Data Sources**:
- `dilution_tracker_simple.js` - DilutionTracker API integration with authentication
- `dilution_tracker_enhanced.js` - Enhanced DilutionTracker features

### Key Architecture Patterns

1. **Multi-layered Caching**: 
   - 10-minute cache for basic data (`CACHE_TTL_MS`)
   - Daily cache for float data (resets at local midnight)
   - Per-URL minute cache with host rate limiting

2. **Cross-Origin Data Fetching**: Service worker uses host permissions to bypass CORS for data fetching from external APIs

3. **Progressive Data Sources**: Falls back from DilutionTracker → FinViz for float data, with multiple sources for different metrics

4. **Dynamic Content Detection**: Uses MutationObserver to detect ticker symbols on dynamically loaded content

## File Structure

```
├── manifest.json              # Chrome extension configuration
├── service_worker.js          # Background script for data fetching
├── content.js                 # Main content script (all URLs)
├── dilutiontracker_content.js # DilutionTracker-specific content script
├── fintel_content.js          # Fintel-specific content script
├── dilution_tracker_simple.js # DilutionTracker API integration
├── dilution_tracker_enhanced.js # Enhanced DilutionTracker features
├── css/
│   └── tooltip.css           # Tooltip styling
├── icons/                    # Extension icons (16, 32, 48, 128px)
└── test_*.html              # Development test files
```

## Important Configuration

- **Cache TTL**: `CACHE_TTL_MS = 10 * 60 * 1000` (10 minutes) - adjust in both service_worker.js and content.js
- **Host Permissions**: Required for cross-origin fetching - add new data sources to manifest.json
- **Rate Limiting**: Built-in delays between requests to avoid being throttled by data sources

## Data Source Integration

When adding new data sources:
1. Add host permission to `manifest.json`
2. Implement fetching logic in `service_worker.js`
3. Update fallback logic in data fetching functions
4. Consider rate limiting and caching requirements

## Debugging

- Service worker debugging: `chrome://extensions` → service worker link
- Content script debugging: Regular DevTools on target pages
- Network requests: Visible in service worker DevTools
- Console logs: Prefixed with emojis for easy filtering (🔧, 📦, etc.)

## Security Notes

The extension requires broad host permissions for cross-origin data fetching. All external API calls are made through the service worker to maintain security boundaries.