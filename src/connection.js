import CDP from 'chrome-remote-interface';

let client = null;
let targetInfo = null;
const CDP_HOST = 'localhost';
const CDP_PORT = 9222;
const MAX_RETRIES = 5;
const BASE_DELAY = 500;
const DEFAULT_EVALUATE_TIMEOUT = 10000;
const DEFAULT_AWAIT_PROMISE_TIMEOUT = 15000;

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

/**
 * Sanitize a string for safe interpolation into JavaScript code evaluated via CDP.
 * Uses JSON.stringify to produce a properly escaped JS string literal (with quotes).
 * Prevents injection via quotes, backticks, template literals, or control chars.
 */
export function safeString(str) {
  return JSON.stringify(String(str));
}

/**
 * Validate that a value is a finite number. Throws if NaN, Infinity, or non-numeric.
 * Prevents corrupt values from reaching TradingView APIs that persist to cloud state.
 */
export function requireFinite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${value}`);
  return n;
}

export async function getClient() {
  if (client) {
    try {
      // Quick liveness check
      await withTimeout(
        client.Runtime.evaluate({ expression: '1', returnByValue: true }),
        3000,
        'Timed out checking existing CDP client liveness'
      );
      await dismissKnownBlockingUi(client);
      const targets = await findChartTargets();
      if (targets.length > 1) {
        const best = await selectBestChartTarget(targets);
        if (best && targetInfo && best.target.id !== targetInfo.id) {
          try { await client.close(); } catch {}
          client = null;
          targetInfo = null;
          return connect();
        }
      }
      return client;
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  return connect();
}

export async function connect() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const targets = await findChartTargets();
      if (!targets.length) {
        throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
      }
      const best = await selectBestChartTarget(targets);
      if (!best) {
        throw new Error('Could not connect to any TradingView chart target');
      }
      targetInfo = best.target;
      client = best.client;
      await dismissKnownBlockingUi(client);
      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function findChartTargets() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const chartTargets = targets.filter(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url));
  if (chartTargets.length > 0) return [...chartTargets].reverse();
  const tvTargets = targets.filter(t => t.type === 'page' && /tradingview/i.test(t.url));
  return [...tvTargets].reverse();
}

async function connectToTarget(target) {
  const c = await withTimeout(
    CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id }),
    4000,
    `Timed out connecting to target ${target.id}`
  );

  try {
    await withTimeout(c.Runtime.enable(), 4000, `Timed out enabling Runtime for target ${target.id}`);
    await withTimeout(c.Page.enable(), 4000, `Timed out enabling Page for target ${target.id}`);
    await withTimeout(c.DOM.enable(), 4000, `Timed out enabling DOM for target ${target.id}`);
    await withTimeout(
      c.Runtime.evaluate({ expression: 'document.readyState', returnByValue: true }),
      4000,
      `Timed out evaluating target ${target.id}`
    );
    return c;
  } catch (err) {
    try { await c.close(); } catch {}
    throw err;
  }
}

async function dismissKnownBlockingUi(c) {
  let changed = false;

  for (let pass = 0; pass < 2; pass++) {
    try {
      const result = await withTimeout(
        c.Runtime.evaluate({
          expression: `(() => {
            const clicked = [];
            const visible = (node) => !!(node && node.offsetParent !== null);
            const textOf = (node) => (node && node.textContent ? node.textContent.trim() : '');

            const clickMatch = (matcher) => {
              const el = Array.from(document.querySelectorAll('button,[role="button"],[aria-label]'))
                .find((node) => {
                  if (!visible(node)) return false;
                  const text = textOf(node);
                  const aria = (node.getAttribute('aria-label') || '').trim();
                  return matcher(text, aria, node);
                });
              if (el) {
                el.click();
                clicked.push(textOf(el) || el.getAttribute('aria-label') || 'button');
                return true;
              }
              return false;
            };

            clickMatch((text) => text === 'Got it!');
            clickMatch((text) => text === 'Got it!Got it!');
            clickMatch((text) => text === 'Close menu');
            clickMatch((text, aria) => /^(close|dismiss|cancel|not now|maybe later|skip)$/i.test(text || aria));
            clickMatch((text, aria) => /close/i.test(aria) && !/Change symbol/i.test(aria));

            const removed = [];
            for (const el of Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-name="modal-wrap"], [class*="modal"], [class*="dialog"]'))) {
              if (!visible(el)) continue;
              const text = textOf(el);
              if (/Join for free|Look first \\/ Then leap/i.test(text)) {
                removed.push(text.slice(0, 80));
                el.remove();
              }
            }

            const bodyText = document.body ? textOf(document.body) : '';
            const dialogText = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-name="modal-wrap"], [class*="modal"], [class*="dialog"]'))
              .filter((node) => visible(node))
              .map((node) => textOf(node))
              .join('\\n');

            return {
              clicked,
              removed,
              hasSymbolSearch: /Symbol search/i.test(bodyText) || /Symbol search/i.test(dialogText),
              hasBlockingDialog: /Symbol search|Join for free|Look first \\/ Then leap|Got it!|Sign in|Log in/i.test(dialogText),
            };
          })()`,
          returnByValue: true,
        }),
        3000,
        'Timed out dismissing blocking UI'
      );

      const value = result.result?.value || {};
      if ((value.clicked && value.clicked.length > 0) || (value.removed && value.removed.length > 0)) {
        changed = true;
      }
      if (value.hasSymbolSearch || value.hasBlockingDialog) {
        for (let i = 0; i < 2; i++) {
          await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });
        }
        changed = true;
      }
    } catch {
      // Best-effort only.
    }

    if (!changed) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (changed) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  try {
    await withTimeout(
      c.Runtime.evaluate({
        expression: `(() => {
          try {
            const chart = window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV
              ? window.TradingViewApi._activeChartWidgetWV.value()
              : null;
            if (!chart || !chart.symbolExt) return false;

            const info = chart.symbolExt() || {};
            const description = String(info.description || info.short_description || info.name || info.symbol || '');
            const exchange = String(info.exchange || info.source_id || '');
            const shortSymbol = String(info.symbol || chart.symbol() || '').split(':').pop();

            const titleButton = document.querySelector('[data-qa-id="title-wrapper legend-source-title"] button[aria-label="Change symbol"]');
            if (titleButton && description && (titleButton.textContent || '').trim() !== description) {
              titleButton.textContent = description;
            }

            const exchangeNode = document.querySelector('[data-qa-id="title-wrapper legend-source-exchange"] .title-l31H9iuA, [data-qa-id="title-wrapper legend-source-exchange"] [class*="title"]');
            if (exchangeNode && exchange && (exchangeNode.textContent || '').trim() !== exchange) {
              exchangeNode.textContent = exchange;
            }

            const logoLetter = document.querySelector('[data-qa-id="legend-logo-wrapper"] .hidden-PsAlMQQF');
            if (logoLetter && shortSymbol) {
              const first = shortSymbol.charAt(0).toUpperCase();
              if ((logoLetter.textContent || '').trim() !== first) {
                logoLetter.textContent = first;
              }
            }

            const wrapper = document.querySelector('[data-qa-id="title-wrapper legend-source-title"]');
            if (wrapper && description) {
              wrapper.setAttribute('title', 'Change symbol');
            }

            return true;
          } catch (e) {
            return false;
          }
        })()`,
        returnByValue: true,
      }),
      3000,
      'Timed out syncing visible legend'
    );
  } catch {
    // Best-effort only.
  }
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}

function chartSnapshotExpression() {
  return `(() => {
    const textOf = (el) => el ? (el.textContent || '').trim() : '';
    const firstVisibleText = (selectors) => {
      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        const node = nodes.find((el) => el && el.offsetParent !== null && textOf(el));
        if (node) return textOf(node);
      }
      return '';
    };

    const symbolButton = document.querySelector('[aria-label="Change symbol"]');
    const topToolbarSymbolButton = Array.from(document.querySelectorAll('button,[role="button"]'))
      .find((el) => {
        if (!el || el.offsetParent === null) return false;
        const rect = el.getBoundingClientRect();
        const text = textOf(el);
        return rect.y >= 0 && rect.y < 40 && rect.x >= 0 && rect.x < 140 && text && text.length <= 30;
      });
    const legendTitle = firstVisibleText([
      '[data-qa-id="title-wrapper legend-source-title"] button[aria-label="Change symbol"]',
      'button[aria-label="Change symbol"]',
      '[data-name="legend-source-title"]',
      '[class*="legend"] [class*="source"]',
      '[class*="title"] [class*="apply-common-tooltip"]',
    ]);
    const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], .tv-dialog, [data-name="modal-wrap"], [class*="modal"], [class*="dialog"]'))
      .find((el) => {
        if (!el || el.offsetParent === null) return false;
        const text = textOf(el);
        return /Symbol search|Join for free|Look first \\/ Then leap|Got it!/i.test(text);
      });
    const dialogTitle = visibleDialog
      ? firstVisibleText([
          '[role="dialog"] [class*="title"]',
          '[role="dialog"] h1',
          '[role="dialog"] h2',
          '[aria-modal="true"] [class*="title"]',
        ]) || textOf(visibleDialog).slice(0, 120)
      : '';

    let apiSymbol = '';
    let apiResolution = '';
    let mainSeriesSymbol = '';
    let symbolResolvingActive = null;
    let barCount = -1;
    let seriesLoaded = null;
    let seriesCompleted = null;
    let seriesStatus = null;
    let chartLoading = null;

    try {
      const chart = window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV
        ? window.TradingViewApi._activeChartWidgetWV.value()
        : null;
      if (chart) {
        apiSymbol = chart.symbol ? String(chart.symbol() || '') : '';
        apiResolution = chart.resolution ? String(chart.resolution() || '') : '';
        const mainSeries = chart._chartWidget && chart._chartWidget.model
          ? chart._chartWidget.model().mainSeries()
          : null;
        if (mainSeries) {
          try {
            if (typeof mainSeries.symbol === 'function') {
              mainSeriesSymbol = String(mainSeries.symbol() || '');
            } else if (typeof mainSeries.symbolInfo === 'function') {
              const info = mainSeries.symbolInfo();
              mainSeriesSymbol = String(info?.symbol || info?.full_name || '');
            }
          } catch {}
          try {
            if (mainSeries._symbolResolvingActive != null) {
              symbolResolvingActive = typeof mainSeries._symbolResolvingActive.value === 'function'
                ? mainSeries._symbolResolvingActive.value()
                : !!mainSeries._symbolResolvingActive;
            } else if (typeof mainSeries.symbolResolvingActive === 'function') {
              symbolResolvingActive = !!mainSeries.symbolResolvingActive();
            }
          } catch {}
          try {
            chartLoading = typeof mainSeries.isLoading === 'function' ? !!mainSeries.isLoading() : null;
          } catch {}
          try {
            seriesLoaded = mainSeries._seriesLoaded != null
              ? (typeof mainSeries._seriesLoaded.value === 'function'
                ? mainSeries._seriesLoaded.value()
                : !!mainSeries._seriesLoaded)
              : null;
          } catch {}
          try {
            seriesCompleted = mainSeries._seriesCompleted != null
              ? (typeof mainSeries._seriesCompleted.value === 'function'
                ? mainSeries._seriesCompleted.value()
                : !!mainSeries._seriesCompleted)
              : null;
          } catch {}
          try {
            seriesStatus = mainSeries._seriesStatus != null
              ? (typeof mainSeries._seriesStatus.value === 'function'
                ? mainSeries._seriesStatus.value()
                : mainSeries._seriesStatus)
              : (typeof mainSeries.status === 'function' ? mainSeries.status() : null);
          } catch {}
          try {
            const bars = mainSeries.bars ? mainSeries.bars() : null;
            if (bars && typeof bars.firstIndex === 'function' && typeof bars.lastIndex === 'function') {
              const firstIdx = bars.firstIndex();
              const lastIdx = bars.lastIndex();
              if (firstIdx != null && lastIdx != null && lastIdx >= firstIdx) {
                barCount = lastIdx - firstIdx + 1;
              }
            }
          } catch {}
        }
      }
    } catch {}

    return {
      title: document.title,
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      href: location.href,
      hasSymbolButton: !!symbolButton,
      visibleSymbolButtonText: textOf(topToolbarSymbolButton) || textOf(symbolButton),
      legendTitle,
      hasBlockingDialog: !!visibleDialog,
      dialogTitle,
      apiSymbol,
      apiResolution,
      mainSeriesSymbol,
      symbolResolvingActive,
      chartLoading,
      seriesLoaded,
      seriesCompleted,
      seriesStatus,
      barCount,
    };
  })()`;
}

function normalizeSymbolLike(value) {
  return String(value || '').toUpperCase().split(':').pop();
}

async function selectBestChartTarget(targets, preferredSymbol = null) {
  let best = null;
  const normalizedPreferred = preferredSymbol ? normalizeSymbolLike(preferredSymbol) : '';

  for (const target of targets) {
    let c = null;
    try {
      c = await connectToTarget(target);
      const probe = await probeTarget(c, target);
      const score = scoreTarget(target, probe, normalizedPreferred);
      const candidate = { client: c, target, probe, score };
      if (!best || candidate.score > best.score) {
        if (best?.client) {
          try { await best.client.close(); } catch {}
        }
        best = candidate;
      } else {
        try { await c.close(); } catch {}
      }
    } catch {
      if (c) {
        try { await c.close(); } catch {}
      }
    }
  }

  return best;
}

async function probeTarget(c, target) {
  const result = await withTimeout(
    c.Runtime.evaluate({
      expression: chartSnapshotExpression(),
      returnByValue: true,
    }),
    4000,
    `Timed out probing target ${target.id}`
  );
  return result.result?.value || {};
}

function scoreTarget(target, probe, preferredSymbol = '') {
  let score = 0;
  if (probe.readyState === 'complete') score += 10;
  if (probe.hasSymbolButton) score += 30;
  if (probe.visibilityState === 'visible') score += 40;
  if (probe.hasFocus) score += 50;
  if (typeof target.title === 'string') score += Math.min(target.title.length, 30);
  if (typeof probe.title === 'string') score += Math.min(probe.title.length, 30);
  if (typeof target.title === 'string' && /\d/.test(target.title)) score += 20;
  if (typeof probe.visibleSymbolButtonText === 'string' && probe.visibleSymbolButtonText.length > 0) score += 20;
  if (typeof probe.legendTitle === 'string' && probe.legendTitle.length > 0) score += 20;
  if (typeof probe.apiSymbol === 'string' && probe.apiSymbol.length > 0) score += 25;
  if (typeof probe.mainSeriesSymbol === 'string' && probe.mainSeriesSymbol.length > 0) score += 25;
  if (typeof probe.barCount === 'number' && probe.barCount > 0) score += 15;
  if (probe.symbolResolvingActive === true) score -= 40;
  if (probe.chartLoading === false) score += 20;
  if (probe.seriesLoaded === true) score += 25;
  if (probe.seriesCompleted === true) score += 25;
  if (probe.seriesStatus === 0) score += 10;
  if (probe.hasBlockingDialog === true) score -= 60;
  if (probe.apiSymbol && probe.visibleSymbolButtonText && probe.apiSymbol.toUpperCase().includes(probe.visibleSymbolButtonText.toUpperCase())) score += 20;
  if (probe.apiSymbol && probe.legendTitle && probe.legendTitle.toUpperCase().includes(probe.apiSymbol.toUpperCase().split(':').pop())) score += 15;
  if (preferredSymbol) {
    const candidates = [
      normalizeSymbolLike(probe.apiSymbol),
      normalizeSymbolLike(probe.mainSeriesSymbol),
      normalizeSymbolLike(probe.visibleSymbolButtonText),
      normalizeSymbolLike(probe.title),
      normalizeSymbolLike(target.title),
    ].filter(Boolean);
    if (candidates.some((value) => value === preferredSymbol)) score += 120;
    if (candidates.some((value) => value.includes(preferredSymbol) || preferredSymbol.includes(value))) score += 50;
  }
  return score;
}

export async function getTargetInfo() {
  if (!targetInfo) {
    await getClient();
  }
  if (targetInfo?.id) {
    try {
      const targets = await findChartTargets();
      const fresh = targets.find((t) => t.id === targetInfo.id);
      if (fresh) {
        targetInfo = fresh;
      }
    } catch {
      // Best-effort refresh only.
    }
  }
  return targetInfo;
}

export async function evaluate(expression, opts = {}) {
  const c = await getClient();
  const { timeoutMs, ...runtimeOpts } = opts;
  const effectiveTimeout =
    timeoutMs
    ?? ((runtimeOpts.awaitPromise ?? false) ? DEFAULT_AWAIT_PROMISE_TIMEOUT : DEFAULT_EVALUATE_TIMEOUT);

  let result;
  try {
    result = await withTimeout(
      c.Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: runtimeOpts.awaitPromise ?? false,
        ...runtimeOpts,
      }),
      effectiveTimeout,
      `Timed out evaluating JavaScript after ${effectiveTimeout}ms`
    );
  } catch (err) {
    if (/Timed out evaluating JavaScript/i.test(err?.message || '')) {
      try { await disconnect(); } catch {}
    }
    throw err;
  }

  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression, opts = {}) {
  return evaluate(expression, { awaitPromise: true, ...opts });
}

export async function disconnect() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

export async function getChartSnapshot() {
  return evaluate(chartSnapshotExpression());
}

export async function reconnectToMatchingTarget(expectedSymbol) {
  const targets = await findChartTargets();
  if (!targets.length) return false;

  const best = await selectBestChartTarget(targets, expectedSymbol);
  if (!best) return false;

  const normalizedExpected = normalizeSymbolLike(expectedSymbol);
  const probe = best.probe || {};
  const matches = [
    normalizeSymbolLike(probe.apiSymbol),
    normalizeSymbolLike(probe.mainSeriesSymbol),
    normalizeSymbolLike(probe.visibleSymbolButtonText),
    normalizeSymbolLike(probe.title),
  ].some((value) => value === normalizedExpected);

  if (!matches) {
    try { await best.client.close(); } catch {}
    return false;
  }

  if (client && targetInfo && best.target.id === targetInfo.id) {
    try { await best.client.close(); } catch {}
    return true;
  }

  if (client) {
    try { await client.close(); } catch {}
  }

  client = best.client;
  targetInfo = best.target;
  await dismissKnownBlockingUi(client);
  return true;
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}
