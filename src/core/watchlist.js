/**
 * Core watchlist logic.
 * Uses TradingView's internal widget API with DOM fallback.
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';

export async function get() {
  // Try internal API first — reads from the active watchlist widget
  const symbols = await evaluate(`
    (function() {
      // Method 1: Try the watchlist widget's internal data
      try {
        var rightArea = document.querySelector('[class*="layout__area--right"]');
        if (!rightArea || rightArea.offsetWidth < 50) return { symbols: [], source: 'panel_closed' };
      } catch(e) {}

      // Method 2: Read data-symbol-full attributes from watchlist rows
      var results = [];
      var seen = {};
      var container = document.querySelector('[class*="layout__area--right"]');
      if (!container) return { symbols: [], source: 'no_container' };

      // Find all elements with symbol data attributes
      var symbolEls = container.querySelectorAll('[data-symbol-full]');
      for (var i = 0; i < symbolEls.length; i++) {
        var sym = symbolEls[i].getAttribute('data-symbol-full');
        if (!sym || seen[sym]) continue;
        seen[sym] = true;

        // Find the row and extract price data
        var row = symbolEls[i].closest('[class*="row"]') || symbolEls[i].parentElement;
        var cells = row ? row.querySelectorAll('[class*="cell"], [class*="column"]') : [];
        var nums = [];
        for (var j = 0; j < cells.length; j++) {
          var t = cells[j].textContent.trim();
          if (t && /^[\\-+]?[\\d,]+\\.?\\d*%?$/.test(t.replace(/[\\s,]/g, ''))) nums.push(t);
        }
        results.push({ symbol: sym, last: nums[0] || null, change: nums[1] || null, change_percent: nums[2] || null });
      }

      if (results.length > 0) return { symbols: results, source: 'data_attributes' };

      // Method 3: Scan for ticker-like text in the right panel
      var items = container.querySelectorAll('[class*="symbolName"], [class*="tickerName"], [class*="symbol-"]');
      for (var k = 0; k < items.length; k++) {
        var text = items[k].textContent.trim();
        if (text && /^[A-Z][A-Z0-9.:!]{0,20}$/.test(text) && !seen[text]) {
          seen[text] = true;
          results.push({ symbol: text, last: null, change: null, change_percent: null });
        }
      }

      return { symbols: results, source: results.length > 0 ? 'text_scan' : 'empty' };
    })()
  `);

  return {
    success: true,
    count: symbols?.symbols?.length || 0,
    source: symbols?.source || 'unknown',
    symbols: symbols?.symbols || [],
  };
}

export async function add({ symbol }) {
  // Use keyboard shortcut to open symbol search in watchlist, type symbol, press Enter
  const c = await getClient();

  // First ensure watchlist panel is open
  const panelState = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="base"]')
        || document.querySelector('[data-name="base-watchlist-widget-button"]')
        || document.querySelector('[aria-label*="Watchlist"]');
      if (!btn) return { error: 'Watchlist button not found' };
      var isActive = btn.getAttribute('aria-pressed') === 'true'
        || btn.classList.toString().indexOf('Active') !== -1
        || btn.classList.toString().indexOf('active') !== -1;
      if (!isActive) { btn.click(); return { opened: true }; }
      return { opened: false };
    })()
  `);

  if (panelState?.error) throw new Error(panelState.error);
  if (panelState?.opened) await new Promise(r => setTimeout(r, 1000));

  // Click the "Add symbol" button (various selectors)
  const addClicked = await evaluate(`
    (function() {
      var container = document.querySelector('[class*="layout__area--right"]')
        || document.querySelector('[data-name="widgetbar-pages-with-tabs"]')
        || document.querySelector('[data-name="widgetbar-wrap"]');

      var selectors = [
        '[data-name="add-symbol-button"]',
        '[data-name*="add-symbol"]',
        '[data-name*="watchlist"]',
        '[aria-label="Add symbol"]',
        '[aria-label*="Add symbol"]',
        '[aria-label*="Watchlist"]',
        'button[class*="addSymbol"]',
        'button[class*="watchlist"]',
      ];
      for (var s = 0; s < selectors.length; s++) {
        var btn = (container || document).querySelector(selectors[s]);
        if (btn && btn.offsetParent !== null) { btn.click(); return { found: true, selector: selectors[s] }; }
      }

      // Fallback: find candidate buttons in the right panel
      if (container) {
        var buttons = container.querySelectorAll('button,[role="button"]');
        for (var i = 0; i < buttons.length; i++) {
          var text = buttons[i].textContent.trim();
          var ariaLabel = buttons[i].getAttribute('aria-label') || '';
          var dataName = buttons[i].getAttribute('data-name') || '';
          if (/add.*symbol|create.*watchlist|watchlist/i.test(ariaLabel) || /add.*symbol|watchlist/i.test(dataName) || text === '+') {
            buttons[i].click();
            return { found: true, method: 'fallback', text: text, aria: ariaLabel, data_name: dataName };
          }
        }

        return {
          found: false,
          panel_text: (container.textContent || '').trim().slice(0, 200),
          visible_button_count: buttons.length,
        };
      }
      return { found: false, panel_text: '', visible_button_count: 0 };
    })()
  `);

  if (!addClicked?.found) {
    throw new Error(`Add symbol button not found in watchlist panel (buttons=${addClicked?.visible_button_count || 0}, panel="${addClicked?.panel_text || ''}")`);
  }
  await new Promise(r => setTimeout(r, 300));

  // Type the symbol into the search input
  await c.Input.insertText({ text: symbol });
  await new Promise(r => setTimeout(r, 500));

  // Press Enter to select the first result
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  await new Promise(r => setTimeout(r, 300));

  // Press Escape to close search
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });

  await new Promise(r => setTimeout(r, 1200));

  const verification = await evaluate(`
    (function() {
      var container = document.querySelector('.widgetbar-widget-watchlist')
        || document.querySelector('[class*="watchlist"]');
      var text = container ? (container.textContent || '').trim() : '';
      var hasRows = false;
      try {
        hasRows = !!container && !!container.querySelector('[data-symbol-full], [data-symbol], [role="row"], [class*="row"]');
      } catch(e) {}
      return {
        has_rows: hasRows,
        panel_text: text.slice(0, 200),
      };
    })()
  `);

  return {
    success: true,
    symbol,
    action: 'added',
    watchlist_visible_rows: !!verification?.has_rows,
    watchlist_panel_text: verification?.panel_text || '',
  };
}
