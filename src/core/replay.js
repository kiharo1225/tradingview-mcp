/**
 * Core replay mode logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getReplayApi as _getReplayApi } from '../connection.js';

export const VALID_AUTOPLAY_DELAYS = [100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000];
const REPLAY_START_TIMEOUT_MS = 20000;

function wv(path) {
  return `(function(){ var v = ${path}; return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; })()`;
}

function unwrapExpression(valueExpr) {
  return `(function(){ var v = ${valueExpr}; return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; })()`;
}

function replayReadyProbe(rp) {
  return `
    new Promise(function(resolve) {
      var r = ${rp};
      function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
      var start = Date.now();
      function check() {
        try {
          var toolbarVisible = typeof r.isReplayToolbarVisible === 'function' ? !!unwrap(r.isReplayToolbarVisible()) : false;
          var readyToPlay = typeof r.isReadyToPlay === 'function' ? !!unwrap(r.isReadyToPlay()) : false;
          var uiReady = !!(r._replayUIController && typeof r._replayUIController.readyToPlay === 'function' && unwrap(r._replayUIController.readyToPlay()));
          if (toolbarVisible || readyToPlay || uiReady) {
            resolve({ ready: true, toolbar_visible: toolbarVisible, ready_to_play: readyToPlay || uiReady });
            return;
          }
          if (Date.now() - start > 5000) {
            resolve({ ready: false, toolbar_visible: toolbarVisible, ready_to_play: readyToPlay || uiReady });
            return;
          }
          setTimeout(check, 200);
        } catch (e) {
          resolve({ ready: false, error: e.message });
        }
      }
      check();
    })
  `;
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}

async function summarizeReplayTimeout(evaluate, rp) {
  const blocker = await detectReplayBlocker(evaluate).catch(() => null);
  if (blocker?.message) return blocker.message;

  const snapshot = await evaluate(`
    (function() {
      try {
        var r = ${rp};
        function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
        var toolbar = document.querySelector('[data-name="replay-control-bar"]')
          || document.querySelector('[class*="replay"]');
        var replayButton = document.querySelector('[aria-label="Bar replay"]');
      return {
        replay_available: unwrap(r.isReplayAvailable()),
        replay_started: unwrap(r.isReplayStarted()),
        replay_mode: unwrap(r.replayMode()),
        current_date: unwrap(r.currentDate()),
        api_toolbar_visible: typeof r.isReplayToolbarVisible === 'function' ? !!unwrap(r.isReplayToolbarVisible()) : null,
        ready_to_play: typeof r.isReadyToPlay === 'function' ? !!unwrap(r.isReadyToPlay()) : null,
        dom_toolbar_visible: !!(toolbar && toolbar.offsetParent !== null),
        replay_button_visible: !!(replayButton && replayButton.offsetParent !== null),
        ui_ready_to_play: !!(r._replayUIController && typeof r._replayUIController.readyToPlay === 'function' && unwrap(r._replayUIController.readyToPlay())),
      };
      } catch (e) {
        return { error: e.message };
      }
    })()
  `, { timeoutMs: 5000 }).catch(() => null);

  if (snapshot?.error) {
    return `Replay start timed out and replay state could not be inspected: ${snapshot.error}`;
  }
  if (
    snapshot
    && snapshot.replay_available
    && snapshot.replay_button_visible
    && !snapshot.api_toolbar_visible
    && !snapshot.dom_toolbar_visible
    && !snapshot.ready_to_play
    && !snapshot.ui_ready_to_play
  ) {
    return 'Replay did not become ready in the current browser session. The Bar replay button is visible, but the replay toolbar never appeared and the replay UI never reported ready_to_play. TradingView Web may still be gating replay behind account, sign-in, or feature checks for this session.';
  }
  if (
    snapshot
    && snapshot.replay_available
    && !snapshot.api_toolbar_visible
    && !snapshot.dom_toolbar_visible
    && !snapshot.ready_to_play
    && !snapshot.ui_ready_to_play
  ) {
    return 'Replay did not become ready in the current browser session. The replay toolbar never became visible and the replay UI never reported ready_to_play.';
  }
  if (snapshot && snapshot.replay_available && !snapshot.replay_started) {
    return 'Replay start timed out before the replay session became active. The browser session may still be waiting for replay date selection or chart data loading.';
  }
  return `Replay start timed out after ${REPLAY_START_TIMEOUT_MS}ms`;
}

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    getReplayApi: deps?.getReplayApi || _getReplayApi,
  };
}

async function detectReplayBlocker(evaluate) {
  return evaluate(`
    (function() {
      function visible(el) {
        return !!(el && el.offsetParent !== null);
      }

      function hasVisibleText(patterns) {
        var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
        var node;
        while ((node = walker.nextNode())) {
          if (!visible(node)) continue;
          var text = (node.innerText || node.textContent || '').trim();
          if (!text) continue;
          var lower = text.toLowerCase();
          for (var i = 0; i < patterns.length; i++) {
            if (lower.indexOf(patterns[i]) !== -1) return text;
          }
        }
        return null;
      }

      function replayControlsVisible() {
        var toolbar = document.querySelector('[data-name="replay-control-bar"]')
          || document.querySelector('[class*="replay"]');
        if (visible(toolbar)) return true;
        var goTo = document.querySelector('[data-name="go-to-date"]');
        if (visible(goTo)) return true;
        var rangeTabs = document.querySelectorAll('[data-name^="date-range-tab-"]');
        for (var i = 0; i < rangeTabs.length; i++) {
          if (visible(rangeTabs[i])) return true;
        }
        return false;
      }

      var paywall = document.querySelector('[data-name="join-for-free-button"]')
        || document.querySelector('button[data-name="join-for-free-button"]');
      var paywallText = hasVisibleText([
        'unlock bar replay',
        'join for free',
        'start replaying bars',
        'replay is available on'
      ]);
      if (visible(paywall) || paywallText) {
        return {
          type: 'paywall',
          message: 'Replay is gated by the current TradingView account or browser session. A replay upsell or Join for free modal is blocking replay startup.',
          details: paywallText,
        };
      }
      var replayButtons = document.querySelectorAll('[aria-label="Bar replay"]');
      var replayVisible = false;
      for (var i = 0; i < replayButtons.length; i++) {
        if (visible(replayButtons[i])) { replayVisible = true; break; }
      }
      if (replayVisible && !replayControlsVisible()) {
        return {
          type: 'toolbar_hidden',
          message: 'Replay controls did not open even though the Bar replay button is visible. The current browser session may require manual replay UI interaction or may not fully support replay startup.',
        };
      }
      return null;
    })()
  `);
}

export async function start({ date, _deps } = {}) {
  const { evaluate, evaluateAsync, getReplayApi } = _resolve(_deps);
  return withTimeout((async () => {
    const rp = await getReplayApi();
    const available = await evaluate(wv(`${rp}.isReplayAvailable()`), { timeoutMs: 5000 });
    if (!available) throw new Error('Replay is not available for the current symbol/timeframe');

    const replayUi = await evaluate(`
      (function() {
        try {
          var r = ${rp};
          if (r._replayUIController && typeof r._replayUIController.enableReplayMode === 'function') {
            r._replayUIController.enableReplayMode();
          }
          if (typeof r.showReplayToolbar === 'function') {
            r.showReplayToolbar();
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `, { timeoutMs: 8000 });
    if (!replayUi?.success) throw new Error(replayUi?.error || 'Failed to enable replay mode');

    await evaluateAsync(replayReadyProbe(rp), { timeoutMs: 7000 }).catch(() => null);

    if (date) {
      const ts = new Date(date).getTime();
      if (isNaN(ts)) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD format.`);
      try {
        await evaluateAsync(`${rp}.selectDate(${ts}).then(function() { return 'ok'; })`, { timeoutMs: 15000 });
      } catch (err) {
        if (/Timed out evaluating JavaScript|Promise was collected/i.test(String(err?.message || err))) {
          throw new Error(`Replay date selection timed out for ${date}. The browser session may still be waiting for chart data or replay initialization.`);
        }
        throw err;
      }
    } else {
      try {
        await evaluate(`${rp}.selectFirstAvailableDate()`, { timeoutMs: 15000 });
      } catch (err) {
        if (/Timed out evaluating JavaScript/i.test(String(err?.message || err))) {
          throw new Error('Replay first-date selection timed out. The browser session may still be waiting for chart data or replay initialization.');
        }
        throw err;
      }
    }

    let started = false;
    let currentDate = null;
    for (let i = 0; i < 30; i++) {
      started = await evaluate(wv(`${rp}.isReplayStarted()`), { timeoutMs: 5000 });
      currentDate = await evaluate(wv(`${rp}.currentDate()`), { timeoutMs: 5000 });
      if (started && currentDate !== null) break;
      await new Promise(r => setTimeout(r, 250));
    }

    if (!started) {
      const blocker = await detectReplayBlocker(evaluate);
      try { await evaluate(`${rp}.stopReplay()`); } catch {}
      if (blocker?.type === 'paywall' || blocker?.type === 'toolbar_hidden') {
        throw new Error(blocker.message);
      }
      throw new Error('Replay failed to start. The selected date may not have data for this timeframe. Try a more recent date or a higher timeframe (e.g., Daily).');
    }

    return { success: true, replay_started: true, date: date || '(first available)', current_date: currentDate };
  })(), REPLAY_START_TIMEOUT_MS, await summarizeReplayTimeout(evaluate, await getReplayApi()));
}

export async function step({ _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  const before = await evaluate(wv(`${rp}.currentDate()`));
  await evaluate(`${rp}.doStep()`);
  // doStep() is async internally — currentDate takes ~500ms to update.
  // Poll until it changes or timeout after 3s.
  let currentDate = before;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 250));
    currentDate = await evaluate(wv(`${rp}.currentDate()`));
    if (currentDate !== before) break;
  }
  return { success: true, action: 'step', current_date: currentDate };
}

export async function autoplay({ speed, _deps } = {}) {
  // Validate BEFORE any CDP calls — invalid values corrupt cloud account state permanently
  if (speed > 0 && !VALID_AUTOPLAY_DELAYS.includes(speed))
    throw new Error(`Invalid autoplay delay ${speed}ms. Valid values: ${VALID_AUTOPLAY_DELAYS.join(', ')}`);

  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  if (speed > 0) {
    await evaluate(`${rp}.changeAutoplayDelay(${speed})`);
  }
  await evaluate(`${rp}.toggleAutoplay()`);
  const isAutoplay = await evaluate(wv(`${rp}.isAutoplayStarted()`));
  const currentDelay = await evaluate(wv(`${rp}.autoplayDelay()`));
  return { success: true, autoplay_active: !!isAutoplay, delay_ms: currentDelay };
}

export async function stop({ _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) {
    return { success: true, action: 'already_stopped' };
  }
  await evaluate(`${rp}.stopReplay()`);
  return { success: true, action: 'replay_stopped' };
}

export async function trade({ action, _deps }) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');

  if (action === 'buy') await evaluate(`${rp}.buy()`);
  else if (action === 'sell') await evaluate(`${rp}.sell()`);
  else if (action === 'close') await evaluate(`${rp}.closePosition()`);
  else throw new Error('Invalid action. Use: buy, sell, or close');

  const position = await evaluate(wv(`${rp}.position()`));
  const pnl = await evaluate(wv(`${rp}.realizedPL()`));
  return { success: true, action, position, realized_pnl: pnl };
}

export async function status({ _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const st = await evaluate(`
    (function() {
      var r = ${rp};
      function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
      return {
        is_replay_available: unwrap(r.isReplayAvailable()),
        is_replay_started: unwrap(r.isReplayStarted()),
        is_autoplay_started: unwrap(r.isAutoplayStarted()),
        replay_mode: unwrap(r.replayMode()),
        current_date: unwrap(r.currentDate()),
        autoplay_delay: unwrap(r.autoplayDelay()),
        is_replay_toolbar_visible: typeof r.isReplayToolbarVisible === 'function' ? !!unwrap(r.isReplayToolbarVisible()) : null,
        is_ready_to_play: typeof r.isReadyToPlay === 'function' ? !!unwrap(r.isReadyToPlay()) : null,
        ui_ready_to_play: !!(r._replayUIController && typeof r._replayUIController.readyToPlay === 'function' && unwrap(r._replayUIController.readyToPlay())),
      };
    })()
  `);
  const pos = await evaluate(wv(`${rp}.position()`));
  const pnl = await evaluate(wv(`${rp}.realizedPL()`));
  return { success: true, ...st, position: pos, realized_pnl: pnl };
}
