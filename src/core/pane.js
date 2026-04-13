/**
 * Core pane/layout management logic.
 * Controls multi-chart layouts (split panes) in TradingView.
 */
import { evaluate, evaluateAsync, getClient, safeString } from '../connection.js';
import { waitForChartReady } from '../wait.js';

const CWC = 'window.TradingViewApi._chartWidgetCollection';

const LAYOUT_NAMES = {
  's': '1 chart',
  '2h': '2 horizontal',
  '2v': '2 vertical',
  '2-1': '2 top, 1 bottom',
  '1-2': '1 top, 2 bottom',
  '3h': '3 horizontal',
  '3v': '3 vertical',
  '3s': '3 custom',
  '4': '2x2 grid',
  '4h': '4 horizontal',
  '4v': '4 vertical',
  '4s': '4 custom',
  '6': '6 charts',
  '8': '8 charts',
  '10': '10 charts',
  '12': '12 charts',
  '14': '14 charts',
  '16': '16 charts',
};

/**
 * List all panes in the current layout with their symbols and index.
 */
export async function list() {
  const result = await evaluate(`
    (function() {
      var cwc = ${CWC};
      var layoutType = cwc._layoutType;
      if (typeof layoutType === 'object' && layoutType && typeof layoutType.value === 'function') layoutType = layoutType.value();
      var count = cwc.inlineChartsCount;
      if (typeof count === 'object' && count && typeof count.value === 'function') count = count.value();

      var all = cwc.getAll();
      var panes = [];
      for (var i = 0; i < all.length; i++) {
        try {
          var c = all[i];
          var model = c.model ? c.model() : null;
          var mainSeries = model ? model.mainSeries() : null;
          var sym = mainSeries ? mainSeries.symbol() : 'unknown';
          var res = mainSeries ? mainSeries.interval() : null;
          panes.push({ index: i, symbol: sym, resolution: res || null });
        } catch(e) { panes.push({ index: i, error: e.message }); }
      }

      // Check which pane is active
      var activeChart = window.TradingViewApi._activeChartWidgetWV.value();
      var activeIndex = null;
      for (var j = 0; j < all.length; j++) {
        try {
          if (all[j].model && activeChart._chartWidget && all[j] === activeChart._chartWidget) { activeIndex = j; break; }
        } catch(e) {}
      }

      return { layout: layoutType, chart_count: count, active_index: activeIndex, panes: panes };
    })()
  `);

  return {
    success: true,
    layout: result.layout,
    layout_name: LAYOUT_NAMES[result.layout] || result.layout,
    chart_count: result.chart_count,
    active_index: result.active_index,
    panes: result.panes,
  };
}

/**
 * Set the chart layout grid.
 * @param {string} layout - Layout code: s, 2h, 2v, 2-1, 1-2, 3h, 3v, 4, 6, 8, etc.
 */
export async function setLayout({ layout }) {
  const code = layout.toLowerCase().replace(/\s+/g, '');

  // Map friendly names to codes
  const aliases = {
    'single': 's', '1': 's', '1x1': 's',
    '2x1': '2h', '1x2': '2v',
    '2x2': '4', 'grid': '4', 'quad': '4',
    '3x1': '3h', '1x3': '3v',
  };
  const resolved = aliases[code] || code;

  if (!LAYOUT_NAMES[resolved]) {
    const available = Object.entries(LAYOUT_NAMES).map(([k, v]) => `  ${k} — ${v}`).join('\n');
    throw new Error(`Unknown layout "${layout}". Available layouts:\n${available}`);
  }

  await evaluateAsync(`${CWC}.setLayout(${safeString(resolved)})`);
  await new Promise(r => setTimeout(r, 500));

  const state = await list();
  return {
    success: true,
    layout: resolved,
    layout_name: LAYOUT_NAMES[resolved],
    chart_count: state.chart_count,
    panes: state.panes,
  };
}

/**
 * Focus a specific pane by index.
 */
export async function focus({ index }) {
  const idx = Number(index);
  const result = await evaluate(`
    (function() {
      var cwc = ${CWC};
      var all = cwc.getAll();
      if (${idx} >= all.length) return { error: 'Pane index ' + ${idx} + ' out of range (have ' + all.length + ' panes)' };
      var chart = all[${idx}];
      // Click the main div to activate it
      if (chart._mainDiv) chart._mainDiv.click();
      return { focused: ${idx}, total: all.length };
    })()
  `);

  if (result?.error) throw new Error(result.error);
  return { success: true, focused_index: result.focused, total_panes: result.total };
}

/**
 * Set the symbol on a specific pane by index.
 * Works by focusing the pane, then using the active chart's setSymbol.
 */
export async function setSymbol({ index, symbol }) {
  const idx = Number(index);

  // Focus the target pane first
  await focus({ index: idx });
  await new Promise(r => setTimeout(r, 300));

  // Now set symbol on the now-active chart
  await evaluateAsync(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value();
      var result = chart.setSymbol(${safeString(symbol)}, {});
      if (result && typeof result.then === 'function') {
        return Promise.race([
          result.then(function() { return true; }),
          new Promise(function(resolve) { setTimeout(function() { resolve(false); }, 3000); }),
        ]);
      }
      return new Promise(function(resolve) { setTimeout(function() { resolve(true); }, 500); });
    })()
  `);

  let ready = await waitForChartReady(symbol);
  let reloadUsed = false;
  if (!ready) {
    const shouldReload = await evaluate(`
      (function() {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        var currentSymbol = '';
        var mainSeriesSymbol = '';
        var symbolResolvingActive = null;
        var chartLoading = null;
        var seriesLoaded = null;
        var seriesCompleted = null;
        try {
          currentSymbol = chart.symbol ? String(chart.symbol() || '') : '';
          var mainSeries = chart._chartWidget && chart._chartWidget.model ? chart._chartWidget.model().mainSeries() : null;
          if (mainSeries) {
            if (typeof mainSeries.symbol === 'function') mainSeriesSymbol = String(mainSeries.symbol() || '');
            if (typeof mainSeries.isLoading === 'function') chartLoading = !!mainSeries.isLoading();
            if (mainSeries._symbolResolvingActive != null) symbolResolvingActive = typeof mainSeries._symbolResolvingActive.value === 'function' ? mainSeries._symbolResolvingActive.value() : !!mainSeries._symbolResolvingActive;
            if (mainSeries._seriesLoaded != null) seriesLoaded = typeof mainSeries._seriesLoaded.value === 'function' ? mainSeries._seriesLoaded.value() : !!mainSeries._seriesLoaded;
            if (mainSeries._seriesCompleted != null) seriesCompleted = typeof mainSeries._seriesCompleted.value === 'function' ? mainSeries._seriesCompleted.value() : !!mainSeries._seriesCompleted;
          }
        } catch (e) {}
        function norm(v) { return String(v || '').toUpperCase().split(':').pop(); }
        var expected = norm(${safeString(symbol)});
        var matches = norm(currentSymbol) === expected || norm(mainSeriesSymbol) === expected;
        var stuck = symbolResolvingActive === true || chartLoading === true || seriesLoaded === false || seriesCompleted === false;
        return matches && stuck;
      })()
    `);
    if (shouldReload) {
      await evaluateAsync(`(function() { setTimeout(function() { window.location.reload(); }, 0); return true; })()`);
      await new Promise(r => setTimeout(r, 12000));
      ready = await waitForChartReady(symbol, null, 30000);
      reloadUsed = ready;
    }
  }

  return { success: true, index: idx, symbol, reload_used: reloadUsed, chart_ready: ready };
}
