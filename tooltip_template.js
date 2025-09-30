(function(global){
  function createTooltipElement() {
    const el = document.createElement('div');
    el.className = 'shi-tooltip';
    el.innerHTML = `
      <div class="shi-header">
        <div class="shi-header-top">
          <div class="shi-header-info">
            <div class="shi-symbol"></div>
            <div class="shi-updated"></div>
          </div>
          <div class="shi-header-links">
            <a href="#" class="refresh-data-link dilutiontracker" target="_blank" rel="noopener noreferrer">DilutionTracker</a>
            <a href="#" class="refresh-data-link fintel" target="_blank" rel="noopener noreferrer">Fintel</a>
            <button type="button" id="share" class="refresh-data-link">Share</button>
            <button type="button" id="copy" class="refresh-data-link">JSON</button>
            <!--<button type="button" class="refresh-data-link refresh-button">Refresh</button>-->
          </div>
        </div>
        <div class="shi-price-changes">
          <div class="shi-regular-change"></div>
          <div class="shi-extended-change"></div>
        </div>
      </div>
      <div class="shi-body">
        <div class="shi-columns">
          <div class="shi-column shi-column-left">
            <div class="shi-section shi-float-info">
              <div class="shi-row"><span>Free Float:</span><span class="shi-float">—</span></div>
              <div class="shi-row"><span>Shares Outstanding:</span><span class="shi-shares-outstanding">—</span></div>
              <div class="shi-row"><span>Options Trading:</span><span class="shi-options-enabled">—</span></div>
              <div class="shi-row"><span>Reg SHO Threshold:</span><span class="shi-regsho-threshold">—</span></div>
            </div>
            <div class="shi-section shi-short-info">
              <div class="shi-row"><span>Short Interest:</span><span class="shi-short-interest">—</span></div>
              <div class="shi-row"><span>Short Interest Ratio:</span><span class="shi-short-interest-ratio">—</span></div>
              <div class="shi-row"><span>Short Float %:</span><span class="shi-short-interest-percent-float">—</span></div>
              <div class="shi-row"><span>Cost To Borrow:</span><span class="shi-cost-to-borrow">—</span></div>
              <div class="shi-row"><span>Squeeze Score:</span><span class="shi-squeeze-score">—</span></div>
              <div class="shi-row"><span>Short Shares Available:</span><span class="shi-short-shares-available">—</span></div>
              <div class="shi-row"><span>Short-Exempt Volume:</span><span class="shi-finra-exempt-volume">—</span></div>
              <div class="shi-row"><span>Failure To Deliver (FTDs):</span><span class="shi-failure-to-deliver">—</span></div>
              <div class="shi-row"><span>Reg SHO Min FTDs:</span><span class="shi-regsho-min-ftds">—</span></div>
            </div>
            <div class="shi-section shi-financial-info">
              <div class="shi-row"><span>Market Cap:</span><span class="shi-market-cap">—</span></div>
              <div class="shi-row"><span>Estimated Cash:</span><span class="shi-est-cash">—</span></div>
              <div class="shi-row"><span>Est. Net Cash/Sh:</span><span class="shi-est-net-cash">—</span></div>
              <div class="shi-row"><span>Institutional Ownership:</span><span class="shi-institutional-ownership">—</span></div>
              <div class="shi-row"><span>E/V:</span><span class="shi-enterprise-value">—</span></div>
            </div>
            <div class="shi-section shi-company-info">
              <div class="shi-row"><span>Country:</span><span class="shi-country">—</span></div>
              <div class="shi-row"><span>Sector:</span><span class="shi-sector">—</span></div>
              <div class="shi-row"><span>Industry:</span><span class="shi-industry">—</span></div>
              <div class="shi-row"><span>Exchange:</span><span class="shi-exchange">—</span></div>
            </div>
            <div class="shi-section shi-last-update">
              <div class="shi-row"><span>Last Update:</span><span class="shi-last-data-update">—</span></div>
            </div>
          </div>
          <div class="shi-column shi-column-right">
            <div class="shi-table-placeholder">Loading…</div>
          </div>
        </div>
      </div>
    `;
    return el;
  }

  global.QSETooltipTemplate = global.QSETooltipTemplate || {};
  global.QSETooltipTemplate.createTooltipElement = createTooltipElement;
})(typeof window !== 'undefined' ? window : this);
