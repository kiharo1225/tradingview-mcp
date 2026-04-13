import { evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  let lastReadySignature = '';
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
        var symbolResolvingActive = null;
        var seriesLoaded = null;
        var seriesCompleted = null;
        var seriesStatus = null;
        var chartLoading = null;
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
            if (bars && chart._chartWidget && chart._chartWidget.model) {
              var mainSeries = chart._chartWidget.model().mainSeries();
              if (mainSeries && mainSeries._symbolResolvingActive != null) {
                symbolResolvingActive = typeof mainSeries._symbolResolvingActive.value === 'function'
                  ? mainSeries._symbolResolvingActive.value()
                  : !!mainSeries._symbolResolvingActive;
              } else if (mainSeries && typeof mainSeries.symbolResolvingActive === 'function') {
                symbolResolvingActive = !!mainSeries.symbolResolvingActive();
              }
              if (mainSeries && typeof mainSeries.isLoading === 'function') {
                chartLoading = !!mainSeries.isLoading();
              }
              if (mainSeries && mainSeries._seriesLoaded != null) {
                seriesLoaded = typeof mainSeries._seriesLoaded.value === 'function'
                  ? mainSeries._seriesLoaded.value()
                  : !!mainSeries._seriesLoaded;
              }
              if (mainSeries && mainSeries._seriesCompleted != null) {
                seriesCompleted = typeof mainSeries._seriesCompleted.value === 'function'
                  ? mainSeries._seriesCompleted.value()
                  : !!mainSeries._seriesCompleted;
              }
              if (mainSeries && mainSeries._seriesStatus != null) {
                seriesStatus = typeof mainSeries._seriesStatus.value === 'function'
                  ? mainSeries._seriesStatus.value()
                  : mainSeries._seriesStatus;
              } else if (mainSeries && typeof mainSeries.status === 'function') {
                seriesStatus = mainSeries.status();
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

        var hasUsableChartData = !!currentSymbol && barCount > 0 && lastBarTime != null;

        return {
          isLoading: !!isLoading,
          hasUsableChartData: hasUsableChartData,
          barCount: barCount,
          currentSymbol: currentSymbol,
          currentResolution: currentResolution,
          lastBarTime: lastBarTime,
          symbolResolvingActive: symbolResolvingActive,
          seriesLoaded: seriesLoaded,
          seriesCompleted: seriesCompleted,
          seriesStatus: seriesStatus,
          chartLoading: chartLoading,
        };
      })()
    `);

    if (!state) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Some browser-mode pages keep generic "loading" nodes mounted even when chart data is already usable.
    if (state.isLoading && !state.hasUsableChartData) {
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

    if (state.symbolResolvingActive === true) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    if (state.chartLoading === true || state.seriesLoaded === false || state.seriesCompleted === false) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    const readySignature = `${state.currentSymbol}:${state.currentResolution}:${state.barCount}`;
    if (readySignature === lastReadySignature && state.barCount > 0 && state.lastBarTime != null) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastReadySignature = readySignature;

    if (stableCount >= 2) {
      return true;
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout — return true anyway, caller should verify
  return false;
}
