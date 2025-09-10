# Quantitative Squeezing Insights Extension

Hover over any `$TICKER` (e.g., `$TSLA`, `$SPY`, `$PLTR`) on any website to see:
- Free Float (DilutionTracker → FinViz fallback)
- Short Interest (Fintel)
- Cost To Borrow (Fintel; optional IBKR if added)
- Latest FTD (Fintel, most recent row only)

## Install (Developer Mode)
1. Download/clone this folder.
2. In Chrome: `chrome://extensions` → enable **Developer mode** (top-right).
3. Click **Load unpacked** → select this folder.
4. Visit any page with `$TICKER` text; hover to see the tooltip.

## Notes & Reality Checks
- Some sites (Fintel, DilutionTracker) gate or throttle data. If you’re not logged in or they change markup, values may show as `n/a`. The code is defensive and easy to update in `service_worker.js`.
- Cross-origin fetches require the `host_permissions` you see in `manifest.json`. If you add more sources, add them there too.
- Caching is 10 minutes. Adjust `CACHE_TTL_MS` as you wish.
- If IBKR provides you a borrow-rate endpoint you can access, plug it into `fetchCTB()` as an additional fallback.

## Troubleshooting
- If tooltips don’t appear, confirm that `$TICKER` is plain text (not inside a canvas/Image). The content script wraps matches in a `.shi-ticker` span using a MutationObserver for dynamic pages.
- If values are `n/a`, inspect the network panel for the target pages and tweak the selectors in `service_worker.js`.