const chalk = require('chalk');
const https = require('https');
const readline = require('readline');
const { getStripeKey } = require('../stripe-client');
const { getStripeApiVersion } = require('../config-loader');
const { printSettingsTree } = require('../output');

// Writing balance_settings via the `payments` parameter grouping requires this
// preview API version (or newer). Overridable via --api-version or config.yml.
const BALANCE_SETTINGS_WRITE_API_VERSION = '2025-08-27.preview';

/**
 * Make a raw HTTP request to the Stripe API.
 * Keys in `data` may contain Stripe's bracket notation (e.g.
 * `payments[settlement_timing][start_of_day][hour]`) — they are form-encoded as-is.
 * @param {string} secretKey - Stripe secret key
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {Object} [data] - Request data (form-encoded)
 * @param {string} [accountId] - Connected account ID (Stripe-Account header)
 * @param {string} [apiVersion] - Optional Stripe-Version header value
 * @returns {Promise<Object>} Parsed response data
 */
function makeStripeRequest(secretKey, method, path, data = null, accountId = null, apiVersion = null) {
  return new Promise((resolve, reject) => {
    let postData = null;
    if (data) {
      postData = Object.keys(data)
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
        .join('&');
    }

    const headers = {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    if (apiVersion) {
      headers['Stripe-Version'] = apiVersion;
    }

    if (accountId) {
      headers['Stripe-Account'] = accountId;
    }

    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path,
      method,
      headers
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const error = new Error(parsed.error?.message || 'API request failed');
            error.type = parsed.error?.type || 'StripeAPIError';
            error.code = parsed.error?.code;
            reject(error);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (error) => reject(error));

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Flatten a nested object into Stripe's bracket-notation form keys.
 * e.g. { payments: { settlement_timing: { start_of_day: { hour: 9 } } } }
 *   -> { 'payments[settlement_timing][start_of_day][hour]': 9 }
 * `null` becomes an empty string (Stripe's convention for "reset to default").
 * @param {Object} obj - Nested object
 * @param {string} [prefix] - Current key prefix (internal)
 * @returns {Object} Flat map of bracket keys to scalar values
 */
function flattenForStripe(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const ik = `${key}[${i}]`;
        if (item !== null && typeof item === 'object') {
          Object.assign(out, flattenForStripe(item, ik));
        } else {
          out[ik] = item === null ? '' : item;
        }
      });
    } else if (v !== null && typeof v === 'object') {
      Object.assign(out, flattenForStripe(v, key));
    } else {
      out[key] = v === null ? '' : v;
    }
  }
  return out;
}

/** Split a comma-separated list into trimmed, non-empty values */
function parseList(value) {
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

/** Parse a boolean-ish string; throws on unrecognized input */
function parseBool(value) {
  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  throw new Error(`Expected a boolean (true/false), got "${value}".`);
}

/**
 * Build the nested `payments` update object from CLI options, validating as it goes.
 * Only fields explicitly provided are included, so the update is a partial patch.
 * @param {Object} options - Command options
 * @returns {Object} { payments: {...} } or {} if nothing to change
 */
function buildPayoutParams(options) {
  const payments = {};
  const payouts = {};
  const schedule = {};
  const settlementTiming = {};
  const startOfDay = {};

  if (options.interval !== undefined) {
    const allowed = ['daily', 'weekly', 'monthly', 'manual'];
    if (!allowed.includes(options.interval)) {
      throw new Error(`--interval must be one of: ${allowed.join(', ')}.`);
    }
    schedule.interval = options.interval;
  }

  if (options.weeklyPayoutDays !== undefined) {
    const allowed = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const days = parseList(options.weeklyPayoutDays).map(d => d.toLowerCase());
    for (const d of days) {
      if (!allowed.includes(d)) {
        throw new Error(`--weekly-payout-days values must be one of: ${allowed.join(', ')}.`);
      }
    }
    schedule.weekly_payout_days = days;
  }

  if (options.monthlyPayoutDays !== undefined) {
    const days = parseList(options.monthlyPayoutDays).map(Number);
    for (const d of days) {
      if (!Number.isInteger(d) || d < 1 || d > 31) {
        throw new Error('--monthly-payout-days values must be integers between 1 and 31.');
      }
    }
    schedule.monthly_payout_days = days;
  }

  if (Object.keys(schedule).length) payouts.schedule = schedule;

  if (options.statementDescriptor !== undefined) {
    payouts.statement_descriptor = options.statementDescriptor;
  }

  if (options.minimumBalance !== undefined) {
    const entries = Array.isArray(options.minimumBalance) ? options.minimumBalance : [options.minimumBalance];
    const map = {};
    for (const entry of entries) {
      const idx = String(entry).indexOf('=');
      if (idx === -1) {
        throw new Error('--minimum-balance must be <currency>=<amount> (e.g. usd=1000).');
      }
      const currency = String(entry).slice(0, idx).trim().toLowerCase();
      const amount = Number(String(entry).slice(idx + 1).trim());
      if (!currency || !Number.isInteger(amount) || amount < 0) {
        throw new Error('--minimum-balance must be <currency>=<non-negative integer> in the smallest currency unit (e.g. usd=1000).');
      }
      map[currency] = amount;
    }
    payouts.minimum_balance_by_currency = map;
  }

  if (Object.keys(payouts).length) payments.payouts = payouts;

  if (options.delayDays !== undefined) {
    const raw = String(options.delayDays).trim().toLowerCase();
    if (raw === '' || raw === 'reset' || raw === 'default') {
      settlementTiming.delay_days_override = null; // reset to default
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 31) {
        throw new Error('--delay-days must be an integer between 0 and 31, or "reset".');
      }
      settlementTiming.delay_days_override = n;
    }
  }

  if (options.hour !== undefined) {
    const hour = Number(options.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new Error("--hour must be an integer between 0 and 23 (and within the account country's allowed range).");
    }
    startOfDay.hour = hour;
  }

  if (options.minutes !== undefined) {
    const minutes = Number(options.minutes);
    if (minutes !== 0 && minutes !== 30) {
      throw new Error('--minutes must be 0 or 30.');
    }
    startOfDay.minutes = minutes;
  }

  if (options.timezone !== undefined) {
    if (!String(options.timezone).trim()) {
      throw new Error('--timezone cannot be empty.');
    }
    startOfDay.timezone = options.timezone;
  }

  if (Object.keys(startOfDay).length) settlementTiming.start_of_day = startOfDay;
  if (Object.keys(settlementTiming).length) payments.settlement_timing = settlementTiming;

  if (options.debitNegativeBalances !== undefined) {
    payments.debit_negative_balances = parseBool(options.debitNegativeBalances);
  }

  return Object.keys(payments).length ? { payments } : {};
}

/** Prompt for a single line on stderr; returns the trimmed answer */
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

/** Prompt yes/no on stderr; resolves true for y/yes */
function promptYesNo(message) {
  return prompt(message).then((a) => ['y', 'yes'].includes(a.toLowerCase()));
}

// Supported customized start-of-day timezones (per Stripe docs), plus common US
// zones since US is in private preview. Stripe validates the final value against
// the account's country, so these are completion candidates, not a hard allowlist.
const TIMEZONE_CANDIDATES = [
  'Etc/UTC',
  'US/Eastern', 'US/Central', 'US/Mountain', 'US/Pacific', 'US/Alaska', 'US/Hawaii', 'US/Arizona',
  'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Darwin', 'Australia/Hobart',
  'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
  'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Jayapura', 'Asia/Makassar', 'Asia/Kolkata',
  'Asia/Tokyo', 'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Bangkok',
  'Pacific/Auckland', 'Pacific/Chatham'
];

/**
 * Interactive list selector: type to filter, ↑/↓ to move, Tab to complete,
 * Enter to select, Esc to keep current. Renders on stderr. Requires a TTY.
 * @param {string} label - Prompt label
 * @param {string[]} candidates - Selectable values
 * @param {string} current - Current value (kept on empty/Esc)
 * @returns {Promise<string>} The chosen value ('' means keep current)
 */
function selectFromList(label, candidates, current) {
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stderr;
    const pageSize = 8;
    let filter = '';
    let index = 0;
    let lastLines = 0;

    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();

    const filtered = () => {
      const f = filter.toLowerCase();
      return candidates.filter((c) => c.toLowerCase().includes(f));
    };

    const erase = () => {
      if (lastLines > 0) {
        readline.moveCursor(output, 0, -lastLines);
        readline.clearScreenDown(output);
      }
    };

    const render = () => {
      erase();
      const list = filtered();
      if (index >= list.length) index = Math.max(0, list.length - 1);
      const lines = [];
      const hint = chalk.gray('(type to filter · ↑/↓ move · Tab complete · Enter select · Esc keep)');
      lines.push(`${label}: ${filter ? chalk.cyan(filter) : ''} ${hint}`);
      if (list.length === 0) {
        lines.push(chalk.gray('  (no matches — Enter uses the typed value)'));
      } else {
        list.slice(0, pageSize).forEach((c, i) => {
          const selected = i === index;
          lines.push(selected ? chalk.green(`❯ ${c}`) : `  ${c}`);
        });
        if (list.length > pageSize) lines.push(chalk.gray(`  … ${list.length - pageSize} more`));
      }
      output.write(lines.join('\n') + '\n');
      lastLines = lines.length;
    };

    const cleanup = () => {
      input.removeListener('keypress', onKey);
      if (typeof input.setRawMode === 'function') input.setRawMode(false);
      input.pause();
    };

    const finish = (value) => {
      erase();
      output.write(`${label}: ${chalk.cyan(value || current || '(unchanged)')}\n`);
      cleanup();
      resolve(value);
    };

    function onKey(str, key) {
      if (!key) return;
      if (key.ctrl && key.name === 'c') { cleanup(); output.write('\n'); process.exit(130); }
      const list = filtered();
      switch (key.name) {
        case 'up':
          index = Math.max(0, index - 1); render(); break;
        case 'down':
          index = Math.min(Math.max(0, list.length - 1), index + 1); render(); break;
        case 'tab':
          if (list[index]) { filter = list[index]; index = 0; render(); } break;
        case 'return':
        case 'enter':
          finish(list[index] || filter.trim()); break;
        case 'escape':
          finish(''); break;
        case 'backspace':
          filter = filter.slice(0, -1); index = 0; render(); break;
        default:
          if (str && str.length === 1 && !key.ctrl && !key.meta) {
            filter += str; index = 0; render();
          }
      }
    }

    input.on('keypress', onKey);
    render();
  });
}

/** Line prompt with Tab-completion over candidates (fallback when not a rich TTY) */
function promptWithCompleter(question, candidates) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    completer: (line) => {
      const hits = candidates.filter((c) => c.toLowerCase().startsWith(line.toLowerCase()));
      return [hits.length ? hits : candidates, line];
    }
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

/**
 * Prompt for a timezone with an interactive selector (arrows/type/Tab) in a rich
 * TTY, falling back to a Tab-completing line prompt otherwise.
 * @param {string} current - Current timezone value
 * @returns {Promise<string>} Chosen timezone ('' keeps current)
 */
function promptTimezone(current) {
  const canSelect = process.stdin.isTTY && process.stderr.isTTY && typeof process.stdin.setRawMode === 'function';
  const label = `start of day timezone (current: ${current || 'none'})`;
  if (canSelect) {
    return selectFromList(label, TIMEZONE_CANDIDATES, current);
  }
  return promptWithCompleter(`${label} [${current || ''}] (Tab to complete): `, TIMEZONE_CANDIDATES);
}

/**
 * Interactively collect payout settings, showing current values as defaults.
 * Empty input keeps the current value (no change).
 * @param {Object} current - Current balance_settings response
 * @returns {Object} An options-shaped object for buildPayoutParams
 */
async function interactiveCollect(current) {
  const { payouts, settlement_timing } = normalizeBalanceSettings(current);
  const st = settlement_timing || {};
  const sod = st.start_of_day || {};
  const po = payouts || {};
  const sched = po.schedule || {};

  console.error(chalk.gray('Press Enter to keep the current value shown in [brackets].\n'));

  const collected = {};

  const interval = await prompt(`payout interval (daily|weekly|monthly|manual) [${sched.interval || 'daily'}]: `);
  if (interval) collected.interval = interval;
  const effectiveInterval = interval || sched.interval;

  if (effectiveInterval === 'weekly') {
    const wd = await prompt(`weekly payout days (comma, monday..friday) [${(sched.weekly_payout_days || []).join(',')}]: `);
    if (wd) collected.weeklyPayoutDays = wd;
  } else if (effectiveInterval === 'monthly') {
    const md = await prompt(`monthly payout days (comma, 1-31) [${(sched.monthly_payout_days || []).join(',')}]: `);
    if (md) collected.monthlyPayoutDays = md;
  }

  const sd = await prompt(`payout statement descriptor [${po.statement_descriptor || ''}]: `);
  if (sd) collected.statementDescriptor = sd;

  const dd = await prompt(`settlement delay days override (0-31 or "reset") [${st.delay_days ?? ''}]: `);
  if (dd) collected.delayDays = dd;

  const hr = await prompt(`start of day hour (0-23) [${sod.hour ?? ''}]: `);
  if (hr) collected.hour = hr;

  const mn = await prompt(`start of day minutes (0 or 30) [${sod.minutes ?? ''}]: `);
  if (mn) collected.minutes = mn;

  const tz = await promptTimezone(sod.timezone);
  if (tz) collected.timezone = tz;

  return collected;
}

/**
 * Normalize a balance_settings response to { payouts, settlement_timing }.
 * Depending on API version, fields may be top-level or nested under `payments`.
 * @param {Object} settings - Raw balance_settings response
 * @returns {{payouts: Object|null, settlement_timing: Object|null}}
 */
function normalizeBalanceSettings(settings) {
  const s = settings || {};
  return {
    payouts: s.payouts ?? s.payments?.payouts ?? null,
    settlement_timing: s.settlement_timing ?? s.payments?.settlement_timing ?? null
  };
}

/**
 * Ensure a start_of_day patch is complete. Stripe requires hour + minutes +
 * timezone together, so backfill any missing fields from the account's current
 * values (defaulting to 00:00 Etc/UTC if never set). Mutates `params` in place.
 * @param {Object} params - Nested { payments: ... } patch
 * @param {Object} ctx - { secretKey, account, readApiVersion, current }
 * @returns {Promise<Object|null>} The current settings used (fetched if needed)
 */
async function ensureCompleteStartOfDay(params, ctx) {
  const sod = params.payments?.settlement_timing?.start_of_day;
  if (!sod) return ctx.current;
  const complete = ['hour', 'minutes', 'timezone'].every((k) => sod[k] !== undefined);
  if (complete) return ctx.current;

  let current = ctx.current;
  if (!current) {
    current = await makeStripeRequest(ctx.secretKey, 'GET', '/v1/balance_settings', null, ctx.account, ctx.readApiVersion);
  }
  const { settlement_timing } = normalizeBalanceSettings(current);
  const existing = settlement_timing?.start_of_day || {};
  if (sod.hour === undefined) sod.hour = existing.hour ?? 0;
  if (sod.minutes === undefined) sod.minutes = existing.minutes ?? 0;
  if (sod.timezone === undefined) sod.timezone = existing.timezone ?? 'Etc/UTC';
  return current;
}

/** Print the payouts + settlement_timing portions of a balance_settings response */
function printPayoutSettings(settings) {
  const { payouts, settlement_timing } = normalizeBalanceSettings(settings);
  console.log(chalk.bold('payouts:'));
  printSettingsTree(payouts, 2);
  console.log(chalk.bold('settlement_timing:'));
  printSettingsTree(settlement_timing, 2);
}

/**
 * Update payout settings (Balance Settings) for a connected account.
 * With no flags, prompts interactively (in a TTY) for each field.
 * @param {Object} options - Command options
 */
async function setPayoutSettings(options) {
  const secretKey = getStripeKey(options, 'account.setting.payouts.set');

  if (!options.account) {
    throw new Error('Connected account ID is required. Use --account option.');
  }

  // Writes require the balance_settings preview version unless overridden.
  const writeApiVersion = options.apiVersion || getStripeApiVersion() || BALANCE_SETTINGS_WRITE_API_VERSION;
  // Reads work without the preview version.
  const readApiVersion = options.apiVersion || getStripeApiVersion();

  let params = buildPayoutParams(options);
  let current = null;
  let prompted = false;

  // No settable flags provided → prompt interactively (only in a real terminal).
  if (Object.keys(params).length === 0) {
    if (!process.stdin.isTTY) {
      throw new Error(
        'No settings provided. Pass flags (e.g. --interval, --statement-descriptor, ' +
        '--delay-days, --hour, --minutes, --timezone) or run in an interactive terminal to be prompted.'
      );
    }
    prompted = true;

    current = await makeStripeRequest(secretKey, 'GET', '/v1/balance_settings', null, options.account, readApiVersion);
    console.error(chalk.blue(`Current payout settings for ${options.account}:`));
    printPayoutSettings(current);
    console.error('');

    const collected = await interactiveCollect(current);
    params = buildPayoutParams(collected);

    if (Object.keys(params).length === 0) {
      console.error(chalk.yellow('No changes entered — nothing to update.'));
      return;
    }
  }

  // start_of_day must be sent complete (hour + minutes + timezone). If only some
  // were provided, backfill the rest from the account's current values.
  current = await ensureCompleteStartOfDay(params, { secretKey, account: options.account, readApiVersion, current });

  const flat = flattenForStripe(params);

  if (prompted) {
    console.error(chalk.bold('\nWill apply:'));
    Object.entries(flat).forEach(([k, v]) => console.error(`  ${k} = ${v === '' ? chalk.gray('(reset)') : v}`));
    const ok = await promptYesNo(chalk.yellow('\nApply these changes? (y/n) '));
    if (!ok) {
      console.error(chalk.gray('Aborted — no changes made.'));
      return;
    }
  }

  try {
    console.error(chalk.blue(`Updating payout settings for account: ${options.account}`));

    const settings = await makeStripeRequest(
      secretKey,
      'POST',
      '/v1/balance_settings',
      flat,
      options.account,
      writeApiVersion
    );

    if (options.format === 'json') {
      console.log(JSON.stringify(settings, null, 2));
      return;
    }

    console.log(chalk.green('✅ Payout settings updated.'));
    console.log(chalk.gray('Note: start-of-day changes take effect at the specified time, not immediately.'));
    printPayoutSettings(settings);
  } catch (error) {
    throw wrapStripeError(error, 'update payout settings');
  }
}

/**
 * Get the current payout settings (Balance Settings) for a connected account.
 * @param {Object} options - Command options
 */
async function getPayoutSettings(options) {
  const secretKey = getStripeKey(options, 'account.setting.payouts');

  if (!options.account) {
    throw new Error('Connected account ID is required. Use --account option.');
  }

  try {
    const settings = await makeStripeRequest(
      secretKey,
      'GET',
      '/v1/balance_settings',
      null,
      options.account,
      options.apiVersion || getStripeApiVersion()
    );

    if (options.format === 'json') {
      console.log(JSON.stringify(settings, null, 2));
      return;
    }

    printPayoutSettings(settings);
  } catch (error) {
    throw wrapStripeError(error, 'get payout settings');
  }
}

/** Map a raw Stripe API error to a friendlier CLI error */
function wrapStripeError(error, action) {
  if (error.type === 'StripeAuthenticationError') {
    return new Error('Invalid Stripe API key. Please check your API key.');
  }
  if (error.type === 'StripePermissionError') {
    return new Error('Insufficient permissions. Make sure your API key has the required permissions.');
  }
  if (error.type === 'StripeAPIError' || error.type === 'invalid_request_error') {
    return new Error(`Stripe API error: ${error.message}`);
  }
  return new Error(`Failed to ${action}: ${error.message}`);
}

module.exports = {
  setPayoutSettings,
  getPayoutSettings,
  buildPayoutParams,
  flattenForStripe,
  makeStripeRequest
};
