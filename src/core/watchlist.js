/**
 * Core watchlist logic.
 * Uses TradingView's internal widget API with DOM fallback.
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';

export async function get() {
  // Try internal API first — reads from the active watchlist widget
  const readSymbols = () => evaluate(`
    (function() {
      // Method 1: Try the watchlist widget's internal data
      try {
        var rightArea = document.querySelector('[class*="layout__area--right"]');
        if (!rightArea || rightArea.offsetWidth < 50) return { symbols: [], source: 'panel_closed', panel_state: 'closed' };
      } catch(e) {}

      var watchlistTab = document.querySelector('[data-name="watchlists-button"]')
        || document.querySelector('[data-name="base"]')
        || document.querySelector('[aria-label*="Watchlist"]');
      var tabActive = !!(watchlistTab && (
        watchlistTab.getAttribute('aria-pressed') === 'true'
        || watchlistTab.classList.toString().indexOf('Active') !== -1
        || watchlistTab.classList.toString().indexOf('active') !== -1
      ));
      var watchlistWidget = document.querySelector('.widgetbar-widget-watchlist')
        || document.querySelector('[class*="widgetbar-widget-watchlist"]')
        || document.querySelector('[class*="watchlist"]');
      var watchlistText = watchlistWidget ? (watchlistWidget.textContent || '').trim() : '';
      var watchlistClass = watchlistWidget ? String(watchlistWidget.className || '') : '';
      if (!tabActive && watchlistWidget && watchlistWidget.offsetParent !== null) {
        tabActive = true;
      }
      var listLooksEmpty = /listEmpl?ty|empty/i.test(watchlistClass) || watchlistText === '';
      var compactText = watchlistText.replace(/\s+/g, '');
      var headersOnly = compactText.indexOf('Watchlist') === 0
        && compactText.indexOf('Symbol') !== -1
        && compactText.indexOf('Last') !== -1
        && compactText.indexOf('Chg') !== -1;
      if (!headersOnly && /Watchlist/i.test(watchlistText) && /Symbol/i.test(watchlistText) && /Last/i.test(watchlistText)) {
        headersOnly = true;
      }

      // Method 2: Read data-symbol-full attributes from watchlist rows
      var results = [];
      var seen = {};
      var container = watchlistWidget || document.querySelector('[class*="layout__area--right"]');
      if (!container) return { symbols: [], source: 'no_container', panel_state: tabActive ? 'watchlist_tab_active' : 'other_tab_active' };

      // Find all elements with symbol data attributes
      var symbolEls = container.querySelectorAll('[data-symbol-full]');
      for (var i = 0; i < symbolEls.length; i++) {
        var sym = symbolEls[i].getAttribute('data-symbol-full');
        if (!sym || seen[sym]) continue;
        seen[sym] = true;
        var status = symbolEls[i].getAttribute('data-status') || null;

        // Find the row and extract price data
        var row = symbolEls[i].closest('[class*="row"]') || symbolEls[i].parentElement;
        var cells = row ? row.querySelectorAll('[class*="cell"], [class*="column"]') : [];
        var nums = [];
        for (var j = 0; j < cells.length; j++) {
          var t = cells[j].textContent.trim();
          if (t && /^[\\-+]?[\\d,]+\\.?\\d*%?$/.test(t.replace(/[\\s,]/g, ''))) nums.push(t);
        }
        results.push({
          symbol: sym,
          last: nums[0] || null,
          change: nums[1] || null,
          change_percent: nums[2] || null,
          status,
        });
      }

      if (results.length > 0) {
        return {
          symbols: results,
          source: 'data_attributes',
          panel_state: tabActive ? 'watchlist_tab_active' : 'other_tab_active',
        };
      }

      // Method 3: Scan for ticker-like text in the right panel
      var items = container.querySelectorAll('[class*="symbolName"], [class*="tickerName"], [class*="symbol-"]');
      for (var k = 0; k < items.length; k++) {
        var text = items[k].textContent.trim();
        if (text && /^[A-Z][A-Z0-9.:!]{0,20}$/.test(text) && !seen[text]) {
          seen[text] = true;
          results.push({ symbol: text, last: null, change: null, change_percent: null, status: null });
        }
      }

      return {
        symbols: results,
        source: results.length > 0 ? 'text_scan' : (headersOnly ? 'watchlist_headers_only' : (listLooksEmpty ? 'watchlist_widget_empty' : 'empty')),
        panel_state: tabActive ? 'watchlist_tab_active' : 'other_tab_active',
        panel_text: watchlistText.slice(0, 200),
      };
    })()
  `, { timeoutMs: 5000 });

  let symbols = await readSymbols();
  let retryCount = 0;
  const isAllPending = (snapshot) => (snapshot?.symbols || []).length > 0 && (snapshot.symbols || []).every((item) => item && item.status === 'pending');
  if (symbols?.source === 'data_attributes' && isAllPending(symbols)) {
    for (let i = 0; i < 2; i++) {
      retryCount += 1;
      await new Promise((r) => setTimeout(r, 600));
      const retry = await readSymbols();
      symbols = retry;
      if (!isAllPending(retry)) break;
    }
  }

  let hydrationSource = null;
  let hydratedCount = 0;
  if ((symbols?.symbols || []).length > 0) {
    try {
      const quoteHydration = await evaluateAsync(`
        (async function() {
          try {
            var rows = ${JSON.stringify((symbols?.symbols || []).map((item) => item.symbol).filter(Boolean))};
            if (!rows.length || typeof window.getQuoteSessionInstance !== 'function') {
              return { ok: false, reason: 'no_symbols_or_quote_session' };
            }
            var session = window.getQuoteSessionInstance();
            if (!session) return { ok: false, reason: 'no_session' };
            if (typeof session.connect === 'function') {
              try { session.connect(); } catch (e) {}
            }
            var key = 'tv-mcp-watchlist-hydration';
            var seen = {};
            function readValue(v) {
              if (!v) return null;
              return {
                last: v.last_price ?? v.lp ?? null,
                change: v.change ?? v.ch ?? null,
                change_percent: v.change_percent ?? v.chp ?? null,
                status: v.status || null,
              };
            }
            function capture(symbol) {
              var data = session._symbol_data && session._symbol_data[symbol];
              if (data && data.values) seen[symbol] = readValue({ ...data.values, status: data.status || null });
            }
            rows.forEach(capture);
            if (typeof session.subscribe === 'function') {
              session.subscribe(key, rows, function(v) {
                if (v && v.symbolname && v.values) {
                  seen[v.symbolname] = readValue({ ...v.values, status: v.status || null });
                }
              });
            }
            await new Promise(function(resolve) { setTimeout(resolve, 1200); });
            rows.forEach(capture);
            if (typeof session.unsubscribe === 'function') {
              try { session.unsubscribe(key, rows); } catch (e) {}
            }
            return { ok: true, seen: seen };
          } catch (e) {
            return { ok: false, reason: e.message };
          }
        })()
      `, { timeoutMs: 3500 }).catch(() => null);

      if (quoteHydration?.ok && quoteHydration.seen) {
        const bySymbol = quoteHydration.seen;
        symbols = {
          ...symbols,
          symbols: (symbols.symbols || []).map((item) => {
            const hydrated = bySymbol[item.symbol];
            if (!hydrated) return item;
            const next = {
              ...item,
              last: item.last ?? hydrated.last ?? null,
              change: item.change ?? hydrated.change ?? null,
              change_percent: item.change_percent ?? hydrated.change_percent ?? null,
            };
            if (next.status === 'pending' && hydrated.status && hydrated.status !== 'pending') {
              next.status = hydrated.status;
            }
            if (next.last !== null || next.change !== null || next.change_percent !== null) hydratedCount += 1;
            return next;
          }),
        };
        hydrationSource = 'quote_session';
      }
    } catch {}
  }

  const pendingCount = (symbols?.symbols || []).filter((item) => item && item.status === 'pending').length;
  const allPending = (symbols?.symbols || []).length > 0 && (symbols?.symbols || []).every((item) => item && item.status === 'pending');

  return {
    success: true,
    count: symbols?.symbols?.length || 0,
    source: symbols?.source || 'unknown',
    panel_state: symbols?.panel_state || 'unknown',
    panel_text: symbols?.panel_text || '',
    state: allPending ? 'pending_rows' : ((symbols?.symbols || []).length > 0 ? 'rows_ready_or_partial' : 'empty'),
    retry_count: retryCount,
    pending_count: pendingCount,
    all_pending: allPending,
    hydration_source: hydrationSource,
    hydrated_count: hydratedCount,
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
        || document.querySelector('[data-name="watchlists-button"]')
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
      var containsSymbol = false;
      try {
        hasRows = !!container && !!container.querySelector('[data-symbol-full], [data-symbol], [role="row"], [class*="row"]');
        if (container) {
          var symbolEls = container.querySelectorAll('[data-symbol-full]');
          for (var i = 0; i < symbolEls.length; i++) {
            var full = symbolEls[i].getAttribute('data-symbol-full') || '';
            if (full === ${JSON.stringify(symbol)} || full.endsWith(':' + ${JSON.stringify(symbol)}) || full === 'NASDAQ:' + ${JSON.stringify(symbol)}) {
              containsSymbol = true;
              break;
            }
          }
          if (!containsSymbol && text) {
            containsSymbol = text.indexOf(${JSON.stringify(symbol)}) !== -1;
          }
        }
      } catch(e) {}
      return {
        has_rows: hasRows,
        panel_text: text.slice(0, 200),
        contains_symbol: containsSymbol,
      };
    })()
  `);

  return {
    success: true,
    symbol,
    action: 'added',
    watchlist_visible_rows: !!verification?.has_rows,
    watchlist_panel_text: verification?.panel_text || '',
    watchlist_contains_symbol: !!verification?.contains_symbol,
    state: verification?.contains_symbol
      ? 'confirmed_visible'
      : (verification?.has_rows ? 'panel_visible_unconfirmed' : 'panel_not_visible'),
  };
}
