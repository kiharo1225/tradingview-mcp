/**
 * Core batch execution logic.
 */
import { evaluate, getClient, getChartApi } from '../connection.js';
import { getOhlcv } from './data.js';
import { setSymbol as setChartSymbol, setTimeframe as setChartTimeframe } from './chart.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(dirname(dirname(__dirname)), 'screenshots');
const DEFAULT_ITERATION_TIMEOUT = 45000;

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}

async function getCurrentChartState() {
  return evaluate(`
    (function() {
      var symbol = '';
      var resolution = '';
      var chartLoading = null;
      var seriesLoaded = null;
      var seriesCompleted = null;
      try {
        var chart = window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV
          ? window.TradingViewApi._activeChartWidgetWV.value()
          : null;
        if (chart) {
          symbol = chart.symbol ? String(chart.symbol() || '') : '';
          resolution = chart.resolution ? String(chart.resolution() || '') : '';
          var mainSeries = chart._chartWidget && chart._chartWidget.model ? chart._chartWidget.model().mainSeries() : null;
          if (mainSeries) {
            if (typeof mainSeries.isLoading === 'function') chartLoading = !!mainSeries.isLoading();
            if (mainSeries._seriesLoaded != null) {
              seriesLoaded = typeof mainSeries._seriesLoaded.value === 'function'
                ? mainSeries._seriesLoaded.value()
                : !!mainSeries._seriesLoaded;
            }
            if (mainSeries._seriesCompleted != null) {
              seriesCompleted = typeof mainSeries._seriesCompleted.value === 'function'
                ? mainSeries._seriesCompleted.value()
                : !!mainSeries._seriesCompleted;
            }
          }
        }
      } catch (e) {}
      return { symbol: symbol, resolution: resolution, chartLoading: chartLoading, seriesLoaded: seriesLoaded, seriesCompleted: seriesCompleted };
    })()
  `);
}

function normalizeSymbol(value) {
  return String(value || '').toUpperCase().split(':').pop();
}

function normalizeResolution(value) {
  const v = String(value || '').toUpperCase();
  return v.startsWith('1') && v.length > 1 ? v.slice(1) : v;
}

export async function batchRun({ symbols, timeframes, action, delay_ms, ohlcv_count }) {
  const tfs = timeframes && timeframes.length > 0 ? timeframes : [null];
  const delay = delay_ms || 2000;
  const results = [];

  let apiPath;
  if (action === 'screenshot' || action === 'get_strategy_results') {
    try { apiPath = await getChartApi(); } catch {}
  }

  for (const symbol of symbols) {
    for (const tf of tfs) {
      const combo = { symbol, timeframe: tf };
      try {
        const actionResult = await withTimeout((async () => {
          const before = await getCurrentChartState();
          const sameSymbol =
            normalizeSymbol(before?.symbol) === normalizeSymbol(symbol) &&
            before?.chartLoading !== true &&
            before?.seriesLoaded !== false &&
            before?.seriesCompleted !== false;

          if (!sameSymbol) {
            await setChartSymbol({ symbol });
          }

          if (tf) {
            const currentResolution = normalizeResolution(before?.resolution);
            const expectedResolution = normalizeResolution(tf);
            if (currentResolution !== expectedResolution) {
              await setChartTimeframe({ timeframe: tf });
            }
          }

          await new Promise(r => setTimeout(r, delay));

          if (action === 'screenshot') {
            mkdirSync(SCREENSHOT_DIR, { recursive: true });
            const client = await getClient();
            const { data } = await client.Page.captureScreenshot({ format: 'png' });
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const fname = `batch_${symbol}_${tf || 'default'}_${ts}`.replace(/[\/\\]/g, '_') + '.png';
            const filePath = join(SCREENSHOT_DIR, fname);
            writeFileSync(filePath, Buffer.from(data, 'base64'));
            return { file_path: filePath };
          }

          if (action === 'get_ohlcv') {
            const limit = Math.min(ohlcv_count || 100, 500);
            const fallback = await getOhlcv({ count: limit });
            const bars = fallback?.bars || [];
            return {
              bar_count: bars.length,
              last_bar: bars[bars.length - 1] || null,
              source: 'direct_bars_fallback',
            };
          }

          if (action === 'get_strategy_results') {
            await new Promise(r => setTimeout(r, 1000));
            return evaluate(`
              (function() {
                var metrics = {};
                var panel = document.querySelector('[data-name="backtesting"]') || document.querySelector('[class*="strategyReport"]');
                if (!panel) return { error: 'Strategy Tester not found' };
                var items = panel.querySelectorAll('[class*="reportItem"], [class*="metric"]');
                items.forEach(function(item) {
                  var label = item.querySelector('[class*="label"]');
                  var value = item.querySelector('[class*="value"]');
                  if (label && value) metrics[label.textContent.trim()] = value.textContent.trim();
                });
                return { metric_count: Object.keys(metrics).length, metrics: metrics };
              })()
            `);
          }

          return { error: 'Unknown action or API not available: ' + action };
        })(), DEFAULT_ITERATION_TIMEOUT, `Batch iteration timed out after ${DEFAULT_ITERATION_TIMEOUT}ms for ${symbol}${tf ? ` @ ${tf}` : ''}`);

        if (actionResult && typeof actionResult === 'object' && actionResult.error) {
          throw new Error(actionResult.error);
        }

        results.push({ ...combo, success: true, result: actionResult });
      } catch (err) {
        results.push({ ...combo, success: false, error: err.message });
      }
    }
  }

  const successCount = results.filter(r => r.success).length;
  return { success: true, total_iterations: results.length, successful: successCount, failed: results.length - successCount, results };
}
