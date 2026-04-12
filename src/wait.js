import { evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  let lastBarSignature = '';
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    const state = await evaluate(`
      (function() {
        var spinner = document.querySelector('[class*="loader"]')
          || document.querySelector('[class*="loading"]')
          || document.querySelector('[data-name="loading"]');
        var isLoading = spinner && spinner.offsetParent !== null;

        var currentSymbol = '';
        var currentResolution = '';
        var barCount = -1;
        var lastBarTime = null;
        try {
          var chart = window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV
            ? window.TradingViewApi._activeChartWidgetWV.value()
            : null;
          if (chart) {
            currentSymbol = chart.symbol ? String(chart.symbol() || '') : '';
            currentResolution = chart.resolution ? String(chart.resolution() || '') : '';
            var bars = chart._chartWidget && chart._chartWidget.model
              ? chart._chartWidget.model().mainSeries().bars()
              : null;
            if (bars && typeof bars.lastIndex === 'function' && typeof bars.firstIndex === 'function') {
              var firstIdx = bars.firstIndex();
              var lastIdx = bars.lastIndex();
              if (firstIdx != null && lastIdx != null && lastIdx >= firstIdx) {
                barCount = lastIdx - firstIdx + 1;
                var lastBar = bars.valueAt(lastIdx);
                if (lastBar && lastBar.length > 0) lastBarTime = lastBar[0];
              }
            }
          }
        } catch (e) {}

        if (!currentSymbol) {
          try {
            var symbolEl = document.querySelector('[data-name="legend-source-title"]')
              || document.querySelector('[class*="title"] [class*="apply-common-tooltip"]');
            currentSymbol = symbolEl ? symbolEl.textContent.trim() : '';
          } catch (e) {}
        }

        return {
          isLoading: !!isLoading,
          barCount: barCount,
          currentSymbol: currentSymbol,
          currentResolution: currentResolution,
          lastBarTime: lastBarTime,
        };
      })()
    `);

    if (!state) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Not ready if still loading
    if (state.isLoading) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Check symbol match if expected
    if (expectedSymbol && state.currentSymbol && !state.currentSymbol.toUpperCase().includes(expectedSymbol.toUpperCase())) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    if (expectedTf && state.currentResolution) {
      const normalizedExpectedTf = String(expectedTf).toUpperCase();
      const normalizedCurrentTf = String(state.currentResolution).toUpperCase();
      const timeframeMatches =
        normalizedCurrentTf === normalizedExpectedTf
        || normalizedCurrentTf === `1${normalizedExpectedTf}`;
      if (!timeframeMatches) {
        stableCount = 0;
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        continue;
      }
    }

    const barSignature = `${state.barCount}:${state.lastBarTime}:${state.currentSymbol}:${state.currentResolution}`;
    if (barSignature === lastBarSignature && state.barCount > 0 && state.lastBarTime != null) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastBarSignature = barSignature;

    if (stableCount >= 2) {
      return true;
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout — return true anyway, caller should verify
  return false;
}
