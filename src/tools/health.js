import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/health.js';

export function registerHealthTools(server) {
  server.tool('tv_health_check', 'Check CDP connection to TradingView and return current chart state. Works with TradingView Desktop or browser mode on tradingview.com/chart.', {}, async () => {
    try { return jsonResult(await core.healthCheck()); }
    catch (err) { return jsonResult({ success: false, error: err.message, hint: 'TradingView is not running with CDP enabled. Use tv_launch, and on Windows prefer mode=browser.' }, true); }
  });

  server.tool('tv_discover', 'Report which known TradingView API paths are available and their methods', {}, async () => {
    try { return jsonResult(await core.discover()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_ui_state', 'Get current UI state: which panels are open, what buttons are visible/enabled/disabled', {}, async () => {
    try { return jsonResult(await core.uiState()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_launch', 'Launch TradingView with Chrome DevTools Protocol (remote debugging) enabled. Supports TradingView Desktop and Chromium browsers that open tradingview.com/chart.', {
    port: z.coerce.number().optional().describe('CDP port (default 9222)'),
    mode: z.enum(['auto', 'desktop', 'browser']).optional().describe('Launch mode: auto, desktop, or browser (default auto)'),
    kill_existing: z.coerce.boolean().optional().describe('Kill existing TradingView instances first (default true)'),
    browser_path: z.string().optional().describe('Optional explicit Chromium executable path. Useful for version-pinned browser binaries such as Chrome for Testing.'),
    browser_profile_dir: z.string().optional().describe('Optional explicit browser profile directory for browser mode. Useful when you want a stable reusable profile.'),
  }, async ({ port, mode, kill_existing, browser_path, browser_profile_dir }) => {
    try { return jsonResult(await core.launch({ port, mode, kill_existing, browser_path, browser_profile_dir })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
