import { register } from '../router.js';
import * as core from '../../core/health.js';

register('status', {
  description: 'Check CDP connection to TradingView desktop or browser mode',
  handler: () => core.healthCheck(),
});

register('launch', {
  description: 'Launch TradingView desktop or browser with CDP enabled',
  options: {
    port: { type: 'string', short: 'p', description: 'CDP port (default 9222)' },
    mode: { type: 'string', short: 'm', description: 'Launch mode: auto, desktop, browser (default auto)' },
    'browser-path': { type: 'string', description: 'Explicit Chromium executable path for browser mode (for example a version-pinned Chrome for Testing binary)' },
    'browser-profile-dir': { type: 'string', description: 'Explicit browser profile directory for browser mode' },
    'no-kill': { type: 'boolean', description: 'Do not kill existing instances' },
  },
  handler: (opts) => core.launch({
    port: opts.port ? Number(opts.port) : undefined,
    mode: opts.mode,
    browser_path: opts['browser-path'],
    browser_profile_dir: opts['browser-profile-dir'],
    kill_existing: !opts['no-kill'],
  }),
});
