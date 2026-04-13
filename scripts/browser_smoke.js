import { disconnect } from '../src/connection.js';
import { healthCheck } from '../src/core/health.js';
import { getQuote, getOhlcv } from '../src/core/data.js';

async function main() {
  const startedAt = new Date().toISOString();
  let cdpVersion = null;
  try {
    const resp = await fetch('http://localhost:9222/json/version');
    if (resp.ok) {
      cdpVersion = await resp.json();
    }
  } catch {
    // Best-effort only.
  }
  const status = await healthCheck();
  const quote = await getQuote({});
  const ohlcv = await getOhlcv({ count: 5, summary: true });

  const result = {
    success: true,
    started_at: startedAt,
    browser: cdpVersion ? {
      browser: cdpVersion.Browser || '',
      user_agent: cdpVersion['User-Agent'] || '',
      websocket_debugger_url: cdpVersion.webSocketDebuggerUrl || '',
    } : null,
    status: {
      chart_symbol: status.chart_symbol,
      chart_resolution: status.chart_resolution,
      chart_type: status.chart_type,
      visible_symbol_button: status.visible_symbol_button,
      legend_title: status.legend_title,
      legend_matches_chart: status.legend_matches_chart,
      chart_consistent: status.chart_consistent,
      chart_loading: status.chart_loading,
      series_loaded: status.series_loaded,
      series_completed: status.series_completed,
      symbol_resolving_active: status.symbol_resolving_active,
    },
    quote: {
      symbol: quote.symbol,
      close: quote.close,
      description: quote.description,
      exchange: quote.exchange,
      legend_matches_symbol: quote.legend_matches_symbol,
      series_ready: quote.series_ready,
    },
    ohlcv_summary: {
      bar_count: ohlcv.bar_count,
      close: ohlcv.close,
      change_pct: ohlcv.change_pct,
      last_bar: ohlcv.last_5_bars?.[ohlcv.last_5_bars.length - 1] || null,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  await disconnect();
  process.exit(0);
}

main().catch((err) => {
  Promise.resolve()
    .then(() => disconnect())
    .catch(() => {})
    .finally(() => {
  console.error(JSON.stringify({
    success: false,
    error: err.message,
  }, null, 2));
      process.exit(1);
    });
});
