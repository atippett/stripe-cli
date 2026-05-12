const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { getPipelineConfig } = require('../config-loader');

/** Buyrates: configured per-unit fee from `buyrates_fees` for row currency — table header / JSON key. */
const BUYRATES_BUYRATE_COL = 'buyrate';

/** Buyrates: USD-comparable configured rate (`buyrate` ÷ `usd fx` or fallback) — table header / JSON key. */
const BUYRATES_BUYRATE_FX_COL = 'buyrate fx';

/** Buyrates: percent delta of median vs buyrate fx — table header / JSON key. */
const BUYRATES_VS_MEDIAN_COL = 'vs median';

/** Buyrates: sum of `itemized_fees.amount` for the report window — table header / JSON key (was `total`). */
const BUYRATES_PERIOD_SUM_COL = 'amount';

/** Buyrates: `amount` − (`buyrate fx` × `count`) — table header / JSON key. */
const BUYRATES_EST_SAVINGS_COL = 'est. savings';

/** Buyrates: USD→row-currency rate from `exchange_rates_from_usd` — table header / JSON key. */
const BUYRATES_USD_FX_COL = 'usd fx';

/**
 * Tables to look up in data_load_times for each canned report (Stripe Data Pipeline).
 * @see https://docs.stripe.com/stripe-data/available-data
 * @param {string} baseName - Report file base name (e.g. connect_volume)
 * @param {boolean} normalize - Whether --normalize was used
 * @returns {string[]}
 */
function getReportDataLoadTimeTables(baseName, normalize) {
  const norm = normalize === true ? ['exchange_rates_from_usd'] : [];
  const byReport = {
    connect_volume: ['connected_account_charges', 'accounts', ...norm],
    connect_balance_transactions: ['connected_account_balance_transactions', 'accounts', ...norm],
    reserves: ['summarized_balance_transactions', 'balance_transactions', 'accounts'],
    buyrates: ['itemized_fees', 'exchange_rates_from_usd']
  };
  return byReport[baseName] || [];
}

/**
 * Format a loaded timestamp for display (UTC).
 * @param {*} val - DB value
 * @returns {string}
 */
function formatLoadedTimestamp(val) {
  if (val == null || val === '') return '—';
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  return `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/**
 * @param {string} schema - Schema for data_load_times (e.g. stripe)
 * @param {string[]} tableNames - Allowed table names only
 * @returns {{ byName: Record<string, unknown>, safe: string[] }|null} null if query failed (error printed)
 */
async function fetchDataLoadTimesMap(client, schema, tableNames) {
  const safe = tableNames.filter((t) => /^[a-z0-9_]+$/i.test(t));
  if (safe.length === 0) return { byName: {}, safe: [] };

  const inList = safe.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
  const fq = schema && /^[a-z0-9_]+$/i.test(schema) ? `${schema}.data_load_times` : 'data_load_times';

  try {
    const result = await client.query(
      `SELECT table_name, loaded FROM ${fq} WHERE table_name IN (${inList}) ORDER BY table_name`
    );
    const byName = {};
    for (const r of result.rows) {
      if (r.table_name) byName[r.table_name] = r.loaded;
    }
    return { byName, safe };
  } catch (err) {
    const hint = err && err.message ? err.message : String(err);
    console.log('');
    console.log(chalk.gray(`Data freshness (data_load_times): unavailable — ${hint}`));
    return null;
  }
}

/**
 * @param {Record<string, unknown>} byName
 * @param {string[]} safe
 */
function printDataLoadTimesBlock(byName, safe) {
  if (!safe || safe.length === 0) return;
  const pad = Math.max(...safe.map((t) => t.length), 24);
  console.log('');
  console.log(chalk.gray('Data freshness (data_load_times):'));
  for (const t of safe) {
    const loaded = byName[t];
    const when = loaded != null ? formatLoadedTimestamp(loaded) : '— (no row for this table)';
    console.log(chalk.gray(`  ${t.padEnd(pad)}  ${when}`));
  }
}

/**
 * UTC calendar context for the current month (aligns with Redshift CURRENT_DATE in UTC environments).
 * @returns {{ daysInMonth: number, dayOfMonth: number, daysLeft: number, monthLabel: string }}
 */
function getUtcMonthContext() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - dayOfMonth;
  const monthLabel = new Date(Date.UTC(y, m, 15)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
  return { daysInMonth, dayOfMonth, daysLeft, monthLabel };
}

/**
 * @param {Object[]} rows - Raw query rows
 * @param {{ name: string }[]} fields - pg result.fields
 * @returns {{ total: number, column: string }|null}
 */
function sumReportVolumeColumn(rows, fields) {
  if (!rows || rows.length === 0 || !fields || fields.length === 0) return null;
  const names = fields.map((f) => f.name);
  const volCol = names.find((n) => /^volume_usd$/i.test(n)) || names.find((n) => /^volume$/i.test(n));
  if (!volCol) return null;
  let total = 0;
  for (const row of rows) {
    total += Number(row[volCol]) || 0;
  }
  return { total, column: volCol };
}

/**
 * Oldest `loaded` among tracked tables (stalest sync).
 * @param {Record<string, unknown>} byName
 * @param {string[]} safe
 * @returns {{ table: string, at: string }|null}
 */
function stalestLoadedSource(byName, safe) {
  let oldest = null;
  let oldestTable = null;
  for (const t of safe || []) {
    const v = byName[t];
    if (v == null) continue;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) continue;
    if (!oldest || d < oldest) {
      oldest = d;
      oldestTable = t;
    }
  }
  if (!oldest || !oldestTable) return null;
  return { table: oldestTable, at: formatLoadedTimestamp(oldest) };
}

function formatMoneyEn(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Previous complete ISO week Mon 00:00 UTC → next Mon 00:00 UTC (exclusive end).
 * @returns {{ startSql: string, endExclusiveSql: string, label: string }}
 */
function getPriorCompleteWeekBoundsUTC() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const dom = now.getUTCDate();
  const utcMidnight = Date.UTC(y, m, dom);
  const jsDow = now.getUTCDay();
  const daysFromMonday = jsDow === 0 ? 6 : jsDow - 1;
  const dayMs = 86400000;
  const thisMondayMs = utcMidnight - daysFromMonday * dayMs;
  const prevMondayMs = thisMondayMs - 7 * dayMs;

  const fmt = (ms) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };
  const shortFmt = (ms) =>
    new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const prevSunMs = thisMondayMs - dayMs;
  const label = `${shortFmt(prevMondayMs)}–${shortFmt(prevSunMs)}, ${new Date(prevSunMs).getUTCFullYear()} (Mon–Sun UTC)`;

  return {
    startSql: `'${fmt(prevMondayMs)}'::timestamp`,
    endExclusiveSql: `'${fmt(thisMondayMs)}'::timestamp`,
    label
  };
}

/**
 * SQL: one row per DOW (0=Sun … 6=Sat, matches JS getUTCDay) with total volume that day in the window.
 * @param {string} baseName - connect_volume | connect_balance_transactions
 * @param {Object} p
 * @returns {string|null}
 */
function buildPriorWeekDowVolumeSql(baseName, p) {
  const { schema, normalize, weekStartSql, weekEndExclusiveSql, paymentMethodType } = p;
  if (baseName !== 'connect_volume' && baseName !== 'connect_balance_transactions') return null;

  const schemaPrefix = schema && /^[a-z0-9_]+$/i.test(schema) ? `${schema}.` : '';
  const alias = baseName === 'connect_volume' ? 'ch' : 'bt';
  const dateCol = baseName === 'connect_volume' ? 'captured_at' : 'created';
  const useNetVolume = baseName === 'connect_volume';
  const amountCol = useNetVolume
    ? `(${alias}.amount - COALESCE(${alias}.amount_refunded, 0))`
    : `${alias}.amount`;
  const volExpr = normalize
    ? `SUM(${amountCol} / 100.0 / COALESCE(CAST(NULLIF(JSON_EXTRACT_PATH_TEXT(er.buy_currency_exchange_rates, ${alias}.currency), '') AS FLOAT), 1))`
    : `SUM(${amountCol}) / 100.0`;
  const exchangeJoin = normalize
    ? `LEFT JOIN ${schemaPrefix}exchange_rates_from_usd er ON er.date = date_trunc('day', ${alias}.${dateCol})`
    : '';

  const pmt = paymentMethodType ? String(paymentMethodType).toLowerCase() : '';
  let typeFilter = '';
  if (pmt && pmt !== 'all' && /^[a-z0-9_]+$/i.test(pmt)) {
    const esc = pmt.replace(/'/g, "''");
    typeFilter = `AND ${alias}.payment_method_type = '${esc}'`;
  }

  let fromWhere;
  if (baseName === 'connect_volume') {
    fromWhere = `FROM ${schemaPrefix}connected_account_charges ${alias}
${exchangeJoin}
WHERE ${alias}.status = 'succeeded'
  ${typeFilter}
  AND ${alias}.${dateCol} >= ${weekStartSql}
  AND ${alias}.${dateCol} < ${weekEndExclusiveSql}`;
  } else {
    fromWhere = `FROM ${schemaPrefix}connected_account_balance_transactions ${alias}
${exchangeJoin}
WHERE ${alias}.type = 'charge'
  ${typeFilter}
  AND ${alias}.${dateCol} >= ${weekStartSql}
  AND ${alias}.${dateCol} < ${weekEndExclusiveSql}`;
  }

  return `
SELECT DATE_PART('dow', date_trunc('day', ${alias}.${dateCol}))::int AS dow,
       (${volExpr}) AS daily_volume
${fromWhere}
GROUP BY 1
ORDER BY 1`.trim();
}

/**
 * @param {import('pg').Client} client
 * @param {Object} options - reportBaseName, schema from config merge, normalize, type
 * @returns {Promise<{ dowVolumes: Record<number, number>, label: string, weeklyTotal: number }|null>}
 */
async function fetchPriorWeekDowVolumeContext(client, options) {
  const baseName = options.reportBaseName;
  if (baseName !== 'connect_volume' && baseName !== 'connect_balance_transactions') return null;

  const config = getPipelineConfig();
  const schema = options.schema || (config && config.schema) || 'stripe';
  const bounds = getPriorCompleteWeekBoundsUTC();
  const sql = buildPriorWeekDowVolumeSql(baseName, {
    schema,
    normalize: options.normalize === true,
    weekStartSql: bounds.startSql,
    weekEndExclusiveSql: bounds.endExclusiveSql,
    paymentMethodType: options.type
  });
  if (!sql) return null;

  try {
    const result = await client.query(sql);
    const dowVolumes = {};
    let weeklyTotal = 0;
    for (const row of result.rows) {
      const dow = Number(row.dow);
      const v = Number(row.daily_volume) || 0;
      dowVolumes[dow] = v;
      weeklyTotal += v;
    }
    return { dowVolumes, label: bounds.label, weeklyTotal };
  } catch (err) {
    const hint = err && err.message ? err.message : String(err);
    console.log('');
    console.log(chalk.gray(`MTD projection (prior-week DOW): skipped — ${hint}`));
    return null;
  }
}

/**
 * Sum prior-week volumes for each calendar day from day after today through month-end (UTC).
 * @param {Record<number, number>} dowVolumes
 * @returns {number}
 */
function sumRemainingMonthByDowPattern(dowVolumes) {
  const { daysInMonth, dayOfMonth } = getUtcMonthContext();
  const now = new Date();
  const y = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  let sum = 0;
  for (let d = dayOfMonth + 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(y, monthIndex, d)).getUTCDay();
    sum += Number(dowVolumes[dow]) || 0;
  }
  return sum;
}

/**
 * @param {Object[]} reportRows
 * @param {{ name: string }[]} reportFields
 * @param {{ byName: Record<string, unknown>, safe: string[] }|null} loadPayload
 * @param {{ dowVolumes: Record<number, number>, label: string, weeklyTotal: number }|null} dowContext
 */
function printMtdVolumeProjection(reportRows, reportFields, loadPayload, dowContext) {
  const vol = sumReportVolumeColumn(reportRows, reportFields);
  if (!vol || vol.total <= 0) return;

  const { daysInMonth, dayOfMonth, daysLeft, monthLabel } = getUtcMonthContext();
  if (dayOfMonth < 1) return;

  const projectedLinear = (vol.total * daysInMonth) / dayOfMonth;
  const unit = /^volume_usd$/i.test(vol.column) ? 'USD' : 'report currency';

  let projectedDow = null;
  if (dowContext && dowContext.weeklyTotal > 0) {
    const rest = sumRemainingMonthByDowPattern(dowContext.dowVolumes);
    projectedDow = vol.total + rest;
  }

  let line =
    `MTD ${vol.column} total ${formatMoneyEn(vol.total)} ${unit} — projected ${monthLabel} month-end `;

  if (projectedDow != null) {
    line +=
      `~${formatMoneyEn(projectedDow)} ${unit} (remaining days use prior week Mon–Sun DOW pattern: ${dowContext.label}; ` +
      `linear reference ~${formatMoneyEn(projectedLinear)} ${unit}).`;
  } else {
    line +=
      `~${formatMoneyEn(projectedLinear)} ${unit} ` +
      `(${dayOfMonth} of ${daysInMonth} days elapsed, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left; linear only — prior-week DOW data unavailable).`;
  }

  if (loadPayload && loadPayload.safe && loadPayload.safe.length > 0) {
    const stale = stalestLoadedSource(loadPayload.byName, loadPayload.safe);
    if (stale) {
      line += ` Stalest sync for this report: \`${stale.table}\` ${stale.at}.`;
    }
  }

  console.log('');
  console.log(chalk.gray(line));
}

/**
 * @param {import('pg').Client} client
 * @param {Object} options - runPipelineQuery options
 * @param {Object|null} config - getPipelineConfig()
 * @param {{ rows: Object[], fields: { name: string }[] }|null} reportSnapshot
 */
async function maybePrintReportFooter(client, options, config, reportSnapshot) {
  const fmt = String(options.format || 'table').trim().toLowerCase();
  if (fmt === 'json' || fmt === 'csv') return;

  const dlTables = options.dataLoadTimesTables;
  const skipFresh = options.skipDataLoadTimes === true;
  const period = String(options.reportPeriod || '').trim().toLowerCase();
  const wantsFooter =
    (Array.isArray(dlTables) && dlTables.length > 0 && !skipFresh) || period === 'mtd';

  if (!wantsFooter) return;

  let loadPayload = null;
  if (!skipFresh && Array.isArray(dlTables) && dlTables.length > 0) {
    const dlSchema =
      (options.dataLoadTimesSchema && String(options.dataLoadTimesSchema).trim()) ||
      (config && config.data_load_times_schema) ||
      (config && config.schema) ||
      'stripe';
    loadPayload = await fetchDataLoadTimesMap(client, dlSchema, dlTables);
  }

  if (!skipFresh && loadPayload) {
    printDataLoadTimesBlock(loadPayload.byName, loadPayload.safe);
  }

  let dowContext = null;
  if (
    period === 'mtd' &&
    reportSnapshot &&
    reportSnapshot.rows &&
    reportSnapshot.fields &&
    (options.reportBaseName === 'connect_volume' || options.reportBaseName === 'connect_balance_transactions')
  ) {
    dowContext = await fetchPriorWeekDowVolumeContext(client, options);
  }

  if (period === 'mtd' && reportSnapshot && reportSnapshot.rows && reportSnapshot.fields) {
    printMtdVolumeProjection(reportSnapshot.rows, reportSnapshot.fields, loadPayload, dowContext);
  }
}

/**
 * Get pipeline (Redshift) credentials from env or .secrets
 * @returns {{ user: string, password: string }|null}
 */
function getPipelineCredentials() {
  const user = process.env.PIPELINE_USER;
  const password = process.env.PIPELINE_PASSWORD;
  if (user && password) {
    return { user, password };
  }
  try {
    const ProfileManager = require('../profile-manager');
    const pm = new ProfileManager();
    pm.loadProfiles();
    const profile = pm.getProfile('pipeline');
    if (profile && profile.user && profile.password) {
      return { user: profile.user, password: profile.password };
    }
  } catch (_) {
    // .secrets may not exist or may not have [pipeline]
  }
  return null;
}

const PIPELINE_OUTPUT_FORMATS = new Set(['table', 'json', 'csv']);

/**
 * @param {unknown} format
 * @returns {'table'|'json'|'csv'}
 */
function normalizePipelineOutputFormat(format) {
  const f = String(format == null ? 'table' : format).trim().toLowerCase();
  if (!PIPELINE_OUTPUT_FORMATS.has(f)) {
    throw new Error(`Invalid format: ${format}. Use table, json, or csv.`);
  }
  return /** @type {'table'|'json'|'csv'} */ (f);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function stripBuyratesRowForExport(row) {
  const copy = { ...row };
  delete copy._buyrates_highlight;
  delete copy._buyrates_highlight_prefix;
  delete copy._buyrates_group;
  delete copy._buyrates_feature_key;
  delete copy._buyrates_group_header;
  delete copy._buyrates_first_currency_for_product;
  delete copy._buyrates_currency;
  return copy;
}

/**
 * Rows for JSON/CSV (buyrates internal keys omitted).
 * @param {Record<string, unknown>[]} tableRowsRaw
 * @param {string|undefined} reportBaseName
 * @returns {Record<string, unknown>[]}
 */
function pipelineRowsForExport(tableRowsRaw, reportBaseName) {
  if (reportBaseName !== 'buyrates') return tableRowsRaw;
  return tableRowsRaw.map((r) => stripBuyratesRowForExport(r));
}

/**
 * @param {unknown} val
 * @returns {string}
 */
function escapeCsvField(val) {
  if (val == null) return '';
  if (val instanceof Date) return escapeCsvField(val.toISOString());
  const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * @param {{ name: string }[]} fields
 * @param {Record<string, unknown>[]} rows
 */
function printPipelineCsv(fields, rows) {
  const headers = fields.map((f) => f.name);
  const headerLine = headers.map((h) => escapeCsvField(h)).join(',');
  const lines = [headerLine];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvField(row[h])).join(','));
  }
  console.log(lines.join('\n'));
}

/**
 * When buyrates_fees entry is an object with display: false, omit those fee rows from the report.
 * @param {unknown} entry
 * @returns {boolean}
 */
function isBuyratesFeeConfigHidden(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    /** @type {Record<string, unknown>} */ (entry).display === false
  );
}

function isBuyratesFeeHighlight(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    /** @type {Record<string, unknown>} */ (entry).highlight === true
  );
}

/** Default marker before highlighted buyrates Product column (Unicode; use config e.g. to "?" or an emoji). */
const BUYRATES_DEFAULT_HIGHLIGHT_PREFIX = '\u26A0 ';

function buyratesDefaultHighlightPrefix(pipelineConfig) {
  const g =
    pipelineConfig && pipelineConfig.buyrates_highlight_prefix != null
      ? pipelineConfig.buyrates_highlight_prefix
      : null;
  if (g != null && String(g) !== '') {
    return String(g);
  }
  return BUYRATES_DEFAULT_HIGHLIGHT_PREFIX;
}

function buyratesHighlightPrefixForEntry(entry, pipelineConfig) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const rec = /** @type {Record<string, unknown>} */ (entry);
    if (Object.prototype.hasOwnProperty.call(rec, 'highlight_prefix')) {
      const p = rec.highlight_prefix;
      return p == null ? buyratesDefaultHighlightPrefix(pipelineConfig) : String(p);
    }
    if (Object.prototype.hasOwnProperty.call(rec, 'highlight_icon')) {
      const p = rec.highlight_icon;
      if (p != null && String(p) !== '') {
        return String(p);
      }
    }
  }
  return buyratesDefaultHighlightPrefix(pipelineConfig);
}

/** Half-up round for buyrates money (avoids float noise; matches table decimals). */
function roundBuyratesMoney(value, decimalPlaces) {
  const x = Number(value);
  if (value == null || value === '' || Number.isNaN(x) || !Number.isFinite(x)) return null;
  return Number.parseFloat(x.toFixed(decimalPlaces));
}

/** 100 × (median − configured USD-comparable value) ÷ that value (buyrates `buyrate fx` column); nil if missing or divisor is 0. */
function buyratesTargetVsBuyPct(targetUsd, median) {
  const t = Number(targetUsd);
  const m = Number(median);
  if (
    targetUsd == null ||
    targetUsd === '' ||
    median == null ||
    median === '' ||
    Number.isNaN(t) ||
    Number.isNaN(m) ||
    t === 0
  ) {
    return null;
  }
  return ((m - t) / t) * 100;
}

/** Table styling for buyrates % delta: green ~0, blue negative, red positive (same rules as median-vs-target column). */
function buyratesChalkStyleForDeltaPct(val) {
  if (val == null || val === '') return null;
  const num = Number(val);
  if (Number.isNaN(num)) return null;
  const rounded = Math.round(num);
  if (rounded === 0) {
    return (s) => chalk.green(s);
  }
  if (rounded < 0) {
    return (s) => chalk.blue(s);
  }
  return (s) => chalk.red(s);
}

/** Whole-word `good` (green) and `bad` (red) in buyrates note text (table output only). */
function buyratesStyleNoteKeywords(text) {
  const s = String(text);
  const parts = s.split(/(\bgood\b|\bbad\b)/gi);
  return parts
    .map((part) => {
      if (/^good$/i.test(part)) return chalk.green(part);
      if (/^bad$/i.test(part)) return chalk.red(part);
      return part;
    })
    .join('');
}

/** Optional string from buyrates_fees object entry; ignored for scalars. */
function buyratesNoteFromEntry(entry) {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const n = /** @type {Record<string, unknown>} */ (entry).note;
  if (n == null || n === '') return null;
  return String(n);
}

/** Default buyrates section when `group` is omitted (scalar entry, unknown fee, or object without `group`). */
const BUYRATES_DEFAULT_GROUP = 'Core';

/** Section title for clustering: explicit `group` on object entries, else {@link BUYRATES_DEFAULT_GROUP}. */
function buyratesGroupFromEntry(entry) {
  if (entry != null && typeof entry === 'object' && !Array.isArray(entry)) {
    const g = /** @type {Record<string, unknown>} */ (entry).group;
    if (g != null && g !== '') {
      const s = String(g).trim();
      if (s !== '') {
        return s;
      }
    }
  }
  return BUYRATES_DEFAULT_GROUP;
}

/**
 * @param {string} groupName
 * @param {string[]} fieldNames - enriched buyrates column names (product w/ currency suffix, note, …)
 * @returns {Record<string, unknown>}
 */
/**
 * Order: … buyrate fx, median, vs median, then max/min/….
 * Default enrichment puts `vs median` right after the currency splice; median stays in SQL order until we pull it forward.
 */
function reorderBuyratesFieldsMedianAfterTarget(newFields) {
  const names = newFields.map((f) => f.name);
  const medIdx = names.findIndex((n) => /^median$/i.test(String(n)));
  const tgtIdx = names.findIndex((n) => n === BUYRATES_BUYRATE_FX_COL);
  const hasVsMedian = names.includes(BUYRATES_VS_MEDIAN_COL);
  if (medIdx === -1 || tgtIdx === -1 || !hasVsMedian) {
    return newFields;
  }
  const medianField = newFields[medIdx];
  const rest = newFields.filter((_, i) => i !== medIdx);
  const tgtIdx2 = rest.map((f) => f.name).indexOf(BUYRATES_BUYRATE_FX_COL);
  return [...rest.slice(0, tgtIdx2 + 1), medianField, ...rest.slice(tgtIdx2 + 1)];
}

/** Insert computed est. savings column immediately after amount. */
function insertBuyratesEstSavingsAfterAmount(newFields) {
  const idx = newFields.findIndex((f) => f.name === BUYRATES_PERIOD_SUM_COL);
  if (idx === -1) return newFields;
  const out = [...newFields];
  out.splice(idx + 1, 0, { name: BUYRATES_EST_SAVINGS_COL });
  return out;
}

/**
 * @param {*} targetUsd - rounded buyrate fx (USD-comparable; same units as amount)
 * @param {*} amountVal - period amount sum
 * @param {*} countVal - fee line count
 * @returns {number|null} half-up rounded integer
 */
function buyratesEstSavings(targetUsd, amountVal, countVal) {
  if (targetUsd == null || targetUsd === '') return null;
  const t = Number(targetUsd);
  const a = Number(amountVal);
  const c = Number(countVal);
  if (Number.isNaN(t) || Number.isNaN(a) || Number.isNaN(c)) return null;
  return roundBuyratesMoney(a - t * c, 0);
}

function buyratesMakeGroupHeaderRow(groupName, fieldNames) {
  /** @type {Record<string, unknown>} */
  const o = { _buyrates_group_header: true, product: groupName };
  for (const name of fieldNames) {
    if (name === 'product') continue;
    if (name === 'currency' || name === 'note') {
      o[name] = '';
    } else {
      o[name] = null;
    }
  }
  return o;
}

/**
 * Cluster rows that share `_buyrates_group` (from config `group`, default Core); emit a header row per
 * cluster. Groups are sorted **alphabetically** (locale-aware `localeCompare`).
 * @param {Record<string, unknown>[]} rows
 * @param {string[]} fieldNames
 * @returns {Record<string, unknown>[]}
 */
function injectBuyratesGroupHeaders(rows, fieldNames) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const byGroup = new Map();
  for (const row of rows) {
    const gs = String(row._buyrates_group || BUYRATES_DEFAULT_GROUP);
    if (!byGroup.has(gs)) {
      byGroup.set(gs, []);
    }
    byGroup.get(gs).push(row);
  }
  if (byGroup.size === 0) {
    return rows;
  }
  const sortWithin = (a, b) => {
    const fa = String(a._buyrates_feature_key || '');
    const fb = String(b._buyrates_feature_key || '');
    if (fa !== fb) {
      return fa.localeCompare(fb);
    }
    const ca = String(a._buyrates_currency ?? a.currency ?? '').trim().toLowerCase();
    const cb = String(b._buyrates_currency ?? b.currency ?? '').trim().toLowerCase();
    const usdA = ca === 'usd' ? 0 : 1;
    const usdB = cb === 'usd' ? 0 : 1;
    if (usdA !== usdB) {
      return usdA - usdB;
    }
    return ca.localeCompare(cb);
  };
  const groupNames = [...byGroup.keys()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const name of groupNames) {
    const members = /** @type {Record<string, unknown>[]} */ (byGroup.get(name));
    members.sort(sortWithin);
    out.push(buyratesMakeGroupHeaderRow(name, fieldNames));
    out.push(...members);
  }
  return out;
}

function pickBuyrateForCurrency(entry, rowCurrency) {
  if (entry == null || entry === '') return null;
  if (typeof entry === 'number' && !Number.isNaN(entry)) {
    return entry;
  }
  if (typeof entry === 'string') {
    const n = Number(entry);
    return Number.isNaN(n) ? null : n;
  }
  if (typeof entry !== 'object' || Array.isArray(entry)) return null;
  const cur = rowCurrency != null ? String(rowCurrency).trim().toLowerCase() : '';
  if (!cur) return null;
  if (Object.prototype.hasOwnProperty.call(entry, cur)) {
    const v = /** @type {Record<string, unknown>} */ (entry)[cur];
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  for (const k of Object.keys(entry)) {
    if (String(k).trim().toLowerCase() !== cur) continue;
    const v = /** @type {Record<string, unknown>} */ (entry)[k];
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** True if `name` is the buyrates FX column from SQL (`"usd fx"`; driver may vary casing). */
function isBuyratesUsdFxSqlFieldName(name) {
  return /^usd\s*fx$/i.test(String(name == null ? '' : name).trim());
}

/** Read FX from row; pg/Redshift may use `usd fx` while we emit {@link BUYRATES_USD_FX_COL}. */
function buyratesRowUsdFxValue(row) {
  if (row == null || typeof row !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(row, BUYRATES_USD_FX_COL)) {
    return row[BUYRATES_USD_FX_COL];
  }
  const key = Object.keys(row).find((k) => isBuyratesUsdFxSqlFieldName(k));
  return key != null ? row[key] : undefined;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{ name: string }[]} fields
 * @param {Record<string, unknown>|null|undefined} buyratesFeeMap - commands.pipeline.buyrates_fees or buyrates_fee_usd
 * @param {Record<string, unknown>|null|undefined} pipelineConfig - commands.pipeline (for buyrates_highlight_prefix)
 * @returns {{ rows: Record<string, unknown>[], fields: { name: string }[], dataRowCount: number }}
 */
function enrichBuyratesRowsWithTargets(rows, fields, buyratesFeeMap, pipelineConfig) {
  const map = buyratesFeeMap && typeof buyratesFeeMap === 'object' ? buyratesFeeMap : {};
  const fieldNames = fields.map((f) => f.name);
  const hasFeatureKey = fieldNames.includes('feature_key');

  const normalizeBuyratesFeatureKey = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  const resolveEntry = (featureKey) => {
    if (featureKey == null || featureKey === '') return null;
    const key = String(featureKey);
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      return map[key];
    }
    const trimmed = key.trim();
    for (const k of Object.keys(map)) {
      if (String(k).trim() === trimmed) return map[k];
    }
    const norm = normalizeBuyratesFeatureKey(key);
    for (const k of Object.keys(map)) {
      if (normalizeBuyratesFeatureKey(k) === norm) return map[k];
    }
    return null;
  };

  const withoutKey = fields.filter((f) => f.name !== 'feature_key');
  /** @type {{ name: string }[]} */
  let newFields = [];
  let buyrateAfterCurrency = false;
  for (const f of withoutKey) {
    if (/^currency$/i.test(String(f.name))) {
      newFields.push(
        { name: BUYRATES_BUYRATE_COL },
        { name: BUYRATES_USD_FX_COL },
        { name: BUYRATES_BUYRATE_FX_COL },
        { name: BUYRATES_VS_MEDIAN_COL }
      );
      buyrateAfterCurrency = true;
      continue;
    }
    if (isBuyratesUsdFxSqlFieldName(f.name)) {
      continue;
    }
    newFields.push(f);
  }
  if (!buyrateAfterCurrency) {
    newFields.push(
      { name: BUYRATES_BUYRATE_COL },
      { name: BUYRATES_USD_FX_COL },
      { name: BUYRATES_BUYRATE_FX_COL },
      { name: BUYRATES_VS_MEDIAN_COL }
    );
  }
  newFields = reorderBuyratesFieldsMedianAfterTarget(newFields);
  newFields = insertBuyratesEstSavingsAfterAmount(newFields);
  newFields.push({ name: 'note' });

  const buyratesRowResolveKey = (row) => {
    if (hasFeatureKey) return row.feature_key;
    const label = row.product != null ? row.product : row.feature_name;
    return label;
  };

  const visibleRows = rows.filter((row) => {
    const fk = buyratesRowResolveKey(row);
    const entry = resolveEntry(fk);
    return !isBuyratesFeeConfigHidden(entry);
  });

  let prevBuyratesFeatureKey = /** @type {string|null} */ (null);
  const newRows = visibleRows.map((row) => {
    const fk = buyratesRowResolveKey(row);
    const fkStr = fk != null && fk !== '' ? String(fk) : '';
    const isFirstCurrencyForFeature = prevBuyratesFeatureKey !== fkStr;
    prevBuyratesFeatureKey = fkStr;

    const entry = resolveEntry(fk);
    const buyrate = pickBuyrateForCurrency(entry, row.currency);
    const fxNum = Number(buyratesRowUsdFxValue(row));
    const curLc = String(row.currency || '').trim().toLowerCase();

    const usdBuyFromNested =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? pickBuyrateForCurrency(entry, 'usd')
        : null;

    let targetUsd = null;
    if (buyrate != null && buyrate !== '' && !Number.isNaN(Number(buyrate)) && !Number.isNaN(fxNum) && fxNum !== 0) {
      targetUsd = Number(buyrate) / fxNum;
    } else if (
      (buyrate == null || buyrate === '') &&
      curLc !== '' &&
      curLc !== 'usd' &&
      usdBuyFromNested != null &&
      usdBuyFromNested !== '' &&
      !Number.isNaN(Number(usdBuyFromNested)) &&
      !Number.isNaN(fxNum)
    ) {
      /** No per-currency buyrate: compare config `usd` × row `usd fx` to `median` (same units as local median). */
      targetUsd = Number(usdBuyFromNested) * fxNum;
    }
    /** Match table formatting (3 dp, half-up); same value used for median-vs-target % so pct aligns with buyrate fx. */
    if (targetUsd != null && !Number.isNaN(Number(targetUsd))) {
      targetUsd = roundBuyratesMoney(targetUsd, 3);
    }
    const estSavings = buyratesEstSavings(targetUsd, row[BUYRATES_PERIOD_SUM_COL], row.count);
    const out = {};
    const deltaPct = buyratesTargetVsBuyPct(targetUsd, row.median);
    const noteFromConfig = buyratesNoteFromEntry(entry);
    let noteOut = noteFromConfig;
    if (
      deltaPct != null &&
      !Number.isNaN(Number(deltaPct)) &&
      Math.round(Number(deltaPct)) === 0
    ) {
      noteOut =
        noteFromConfig != null && String(noteFromConfig).trim() !== ''
          ? `ok · ${String(noteFromConfig).trim()}`
          : 'ok';
    }

    for (const f of newFields) {
      if (f.name === BUYRATES_BUYRATE_COL) {
        out[BUYRATES_BUYRATE_COL] = buyrate;
      } else if (f.name === BUYRATES_BUYRATE_FX_COL) {
        out[BUYRATES_BUYRATE_FX_COL] = targetUsd;
      } else if (f.name === BUYRATES_VS_MEDIAN_COL) {
        out[BUYRATES_VS_MEDIAN_COL] = deltaPct;
      } else if (f.name === BUYRATES_EST_SAVINGS_COL) {
        out[BUYRATES_EST_SAVINGS_COL] = estSavings;
      } else if (f.name === 'note') {
        out.note = noteOut;
      } else if (f.name === BUYRATES_USD_FX_COL) {
        out[BUYRATES_USD_FX_COL] = buyratesRowUsdFxValue(row);
      } else if (/^product$/i.test(String(f.name))) {
        const rawName = row[f.name] != null ? String(row[f.name]).trim() : '';
        out[f.name] =
          rawName !== '' && curLc !== '' ? `${rawName} (${curLc})` : rawName;
      } else {
        out[f.name] = row[f.name];
      }
    }
    out._buyrates_currency = curLc;
    if (isBuyratesFeeHighlight(entry)) {
      out._buyrates_highlight = true;
      out._buyrates_highlight_prefix = buyratesHighlightPrefixForEntry(entry, pipelineConfig);
    }
    out._buyrates_group = buyratesGroupFromEntry(entry);
    out._buyrates_feature_key = String(fk);
    out._buyrates_first_currency_for_product = isFirstCurrencyForFeature;
    return out;
  });

  const outputFieldNames = newFields.map((f) => f.name);
  const injected = injectBuyratesGroupHeaders(newRows, outputFieldNames);

  return { rows: injected, fields: newFields, dataRowCount: visibleRows.length };
}

/**
 * Run a SQL query against the Stripe Data Pipeline Redshift database
 * @param {Object} options - Command options: query, file, format, host, port, database
 * @returns {Promise<void>}
 */
async function runPipelineQuery(options) {
  const config = getPipelineConfig();
  if (!config || !config.host) {
    throw new Error('Pipeline not configured. Add host, port, database under commands.pipeline in config.yml.');
  }

  const credentials = getPipelineCredentials();
  if (!credentials) {
    throw new Error(
      'Pipeline credentials required. Set PIPELINE_USER and PIPELINE_PASSWORD env vars, ' +
      'or add [pipeline] section with user= and password= in .secrets.'
    );
  }

  let query = options.query;
  if (options.file) {
    const filePath = path.isAbsolute(options.file) ? options.file : path.resolve(process.cwd(), options.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Query file not found: ${filePath}`);
    }
    query = fs.readFileSync(filePath, 'utf8');
  }
  if (!query || !String(query).trim()) {
    throw new Error('Query required. Use --query "SELECT ..." or --file path/to/query.sql');
  }

  const host = options.host || config.host;
  const port = options.port != null ? Number(options.port) : (config.port || 5439);
  const database = options.database || config.database || 'warehouse';
  const noSslVerify = options.noSslVerify === true || config.no_ssl_verify === true;

  const { Client } = require('pg');
  const client = new Client({
    host,
    port,
    database,
    user: credentials.user,
    password: credentials.password,
    ssl: noSslVerify ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
    keepAlive: true
  });

  try {
    options.format = normalizePipelineOutputFormat(options.format);
    await client.connect();
    const result = await client.query(query);

    let tableRowsRaw = result.rows;
    let tableFieldsRaw = result.fields || [];
    let buyratesDataRowCount = /** @type {number|null} */ (null);
    if (options.reportBaseName === 'buyrates') {
      const buyratesFeeMap =
        config.buyrates_fees != null && typeof config.buyrates_fees === 'object'
          ? config.buyrates_fees
          : config.buyrates_fee_usd;
      const enriched = enrichBuyratesRowsWithTargets(result.rows, result.fields || [], buyratesFeeMap, config);
      tableRowsRaw = enriched.rows;
      tableFieldsRaw = enriched.fields;
      buyratesDataRowCount = enriched.dataRowCount;
    }

    if (options.format === 'json') {
      const payload = pipelineRowsForExport(tableRowsRaw, options.reportBaseName);
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    if (options.format === 'csv') {
      const exportRows = pipelineRowsForExport(tableRowsRaw, options.reportBaseName);
      printPipelineCsv(tableFieldsRaw, exportRows);
      await maybePrintReportFooter(client, options, config, {
        rows: tableRowsRaw,
        fields: tableFieldsRaw
      });
      return;
    }

    if (tableRowsRaw.length === 0) {
      console.log(chalk.gray('(0 rows)'));
      await maybePrintReportFooter(client, options, config, {
        rows: tableRowsRaw,
        fields: tableFieldsRaw
      });
      return;
    }

    const { table } = require('table');
    const headers = tableFieldsRaw.map((f) => f.name);
    const isBuyratesReport = options.reportBaseName === 'buyrates';
    const buyratesTableHeaders = isBuyratesReport
      ? headers.map((h) => (/^product$/i.test(String(h)) ? 'Product' : h))
      : headers;
    const moneyColPattern = /volume|amount|fee|total|sum|net|balance|activity|median/i;
    /** buyrates fee stats — avoid matching e.g. "admin" via /min/ */
    const isBuyratesFeeStat = (h) => /^(min|median|max)$/i.test(String(h));
    const isBuyratesUsdNorm = (h) => /^median_usd$/i.test(String(h));
    const isBuyratesBuyrateCol = (h) => String(h) === BUYRATES_BUYRATE_COL;
    const isBuyratesBuyrateFxCol = (h) => String(h) === BUYRATES_BUYRATE_FX_COL;
    const isBuyratesVsMedianCol = (h) => String(h) === BUYRATES_VS_MEDIAN_COL;
    const isBuyratesPeriodTotalCol = (h) => String(h) === BUYRATES_PERIOD_SUM_COL;
    const isBuyratesEstSavingsCol = (h) => String(h) === BUYRATES_EST_SAVINGS_COL;
    const isFeeLineCountCol = (h) => /^fee_line_count$|^count$/i.test(String(h));
    const isBuyratesUsdFxCol = (h) => String(h) === BUYRATES_USD_FX_COL;
    const useMoneyFormat = (h) => {
      if (isBuyratesReport && isFeeLineCountCol(h)) return false;
      return (
        isBuyratesFeeStat(h) ||
        isBuyratesUsdNorm(h) ||
        isBuyratesBuyrateCol(h) ||
        isBuyratesBuyrateFxCol(h) ||
        (isBuyratesReport && isBuyratesVsMedianCol(h)) ||
        (isBuyratesReport && isBuyratesPeriodTotalCol(h)) ||
        (isBuyratesReport && isBuyratesEstSavingsCol(h)) ||
        isBuyratesUsdFxCol(h) ||
        moneyColPattern.test(h)
      );
    };
    const summableColPattern = /_count|volume|amount|fee|total|sum|net|balance|activity/i;
    const emptyCellDisplay = () => chalk.gray('nil');
    const formatCell = (val, header, forceDecimals = false, row = null) => {
      const curLc =
        row != null
          ? String(row._buyrates_currency ?? row.currency ?? '').trim().toLowerCase()
          : '';
      const usdBuyrateUnsetNil =
        isBuyratesReport &&
        curLc === 'usd' &&
        isBuyratesBuyrateCol(header) &&
        (val == null || val === '');
      if (isBuyratesReport && row != null && row._buyrates_group_header === true) {
        if (/^product$/i.test(String(header))) {
          return chalk.cyan.bold(String(row.product || ''));
        }
        return '';
      }
      if (isBuyratesReport && /^product$/i.test(String(header)) && row != null) {
        const pctStyle = buyratesChalkStyleForDeltaPct(row[BUYRATES_VS_MEDIAN_COL]);
        if (val != null && val !== '') {
          const base = String(val);
          const cell =
            row._buyrates_highlight === true
              ? `${
                  row._buyrates_highlight_prefix != null &&
                  String(row._buyrates_highlight_prefix) !== ''
                    ? String(row._buyrates_highlight_prefix)
                    : buyratesDefaultHighlightPrefix(config)
                }${base}`
              : base;
          const display = `  ${cell}`;
          if (pctStyle) return pctStyle(display);
          if (row._buyrates_highlight === true) return chalk.yellow(display);
          return display;
        }
        return '';
      }
      if (
        isBuyratesReport &&
        /^note$/i.test(String(header)) &&
        row != null &&
        val != null &&
        val !== ''
      ) {
        const ns = String(val);
        if (ns === 'ok') {
          return chalk.green('ok');
        }
        if (ns.startsWith('ok · ')) {
          return chalk.green('ok') + ' · ' + buyratesStyleNoteKeywords(ns.slice(5));
        }
        return buyratesStyleNoteKeywords(ns);
      }
      if (val == null || val === '') {
        if (
          isBuyratesReport &&
          /^note$/i.test(String(header)) &&
          row != null &&
          row._buyrates_first_currency_for_product !== true
        ) {
          return '';
        }
        return usdBuyrateUnsetNil ? chalk.yellow('nil') : emptyCellDisplay();
      }
      const num = Number(val);
      if (!Number.isNaN(num)) {
        if (isBuyratesReport && isFeeLineCountCol(header)) {
          return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
        if (isBuyratesUsdFxCol(header)) {
          if (isBuyratesReport) {
            return num.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 8 });
          }
          return num.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 });
        }
        if (isBuyratesReport && isBuyratesVsMedianCol(header)) {
          const styler = buyratesChalkStyleForDeltaPct(val);
          if (!styler) {
            return emptyCellDisplay();
          }
          const rounded = Math.round(num);
          const formatted = `${rounded.toLocaleString('en-US')}%`;
          return styler(formatted);
        }
        const useDecimals = forceDecimals || useMoneyFormat(header);
        if (!useDecimals) return num.toLocaleString('en-US');
        if (
          isBuyratesReport &&
          (isBuyratesFeeStat(header) ||
            isBuyratesUsdNorm(header) ||
            isBuyratesBuyrateCol(header) ||
            isBuyratesBuyrateFxCol(header))
        ) {
          return num.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
        }
        if (isBuyratesReport && isBuyratesPeriodTotalCol(header)) {
          return Math.round(num).toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
        if (isBuyratesReport && isBuyratesEstSavingsCol(header)) {
          return Math.round(num).toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      return String(val);
    };
    const rows = tableRowsRaw.map((row) =>
      headers.map((h) => formatCell(row[h], h, useMoneyFormat(h), row))
    );
    const totals = headers.map((h) => {
      if (!summableColPattern.test(h)) return emptyCellDisplay();
      const sum = tableRowsRaw.reduce(
        (acc, row) => (row._buyrates_group_header === true ? acc : acc + (Number(row[h]) || 0)),
        0
      );
      return formatCell(sum, h, useMoneyFormat(h));
    });
    const labelColIndices = headers.map((h, i) => i).filter((i) => !summableColPattern.test(headers[i]));
    const totalLabelCol = labelColIndices.length > 0 ? labelColIndices[labelColIndices.length - 1] : -1;
    const totalRow = headers.map((h, i) => (i === totalLabelCol ? 'Total' : totals[i]));
    const numericColPattern = (h) =>
      isBuyratesFeeStat(h) ||
      isBuyratesUsdNorm(h) ||
      isBuyratesBuyrateCol(h) ||
      isBuyratesBuyrateFxCol(h) ||
      (isBuyratesReport && isBuyratesVsMedianCol(h)) ||
      (isBuyratesReport && isBuyratesPeriodTotalCol(h)) ||
      (isBuyratesReport && isBuyratesEstSavingsCol(h)) ||
      (isBuyratesReport && isFeeLineCountCol(h)) ||
      isBuyratesUsdFxCol(h) ||
      /_count|volume|amount|fee|total|sum|net|balance|activity|median/i.test(h);
    const suppressTotalRow = options.reportBaseName === 'buyrates';
    const buyratesColumnAlignment = (h) => {
      if (isBuyratesReport && /^note$/i.test(String(h))) {
        return 'center';
      }
      return numericColPattern(h) ? 'right' : 'left';
    };
    const tableConfig = {
      columns: headers.map((h) => ({
        alignment: buyratesColumnAlignment(h)
      }))
    };
    const tableRows = suppressTotalRow
      ? [buyratesTableHeaders, ...rows]
      : [buyratesTableHeaders, ...rows, totalRow];
    const output = table(tableRows, tableConfig);
    console.log(output);
    const rowNote =
      options.reportBaseName === 'buyrates' &&
      buyratesDataRowCount != null &&
      result.rows.length !== buyratesDataRowCount
        ? ` (${result.rows.length - buyratesDataRowCount} omitted by buyrates_fees display: false)`
        : '';
    console.log(chalk.gray(`(${tableRowsRaw.length} row${tableRowsRaw.length === 1 ? '' : 's'})${rowNote}`));
    await maybePrintReportFooter(client, options, config, {
      rows: tableRowsRaw,
      fields: tableFieldsRaw
    });
  } finally {
    await client.end();
  }
}

/**
 * Get path to reports directory (project root / reports)
 * @returns {string}
 */
function getReportsDir() {
  const root = path.join(__dirname, '..', '..');
  return path.join(root, 'reports');
}

/**
 * Parse --period into SQL date expressions for start_date and end_date.
 * Supported: mtd, yesterday, today, prior_month, last7, last30, last90, 7d, 30d, 90d,
 * YYYY-MM (calendar month), YYYY-MM-DD (single day), YYYY-MM-DD..YYYY-MM-DD (range)
 * @param {string} period - Period string
 * @returns {{ startDateExpr: string, endDateExpr: string }}
 */
function parsePeriod(period) {
  const p = String(period || '').trim().toLowerCase();
  const rangeMatch = p.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  const singleMatch = p.match(/^(\d{4}-\d{2}-\d{2})$/);
  const monthOnlyMatch = p.match(/^(\d{4})-(\d{2})$/);
  const lastMatch = p.match(/^last(\d+)$/);
  const daysMatch = p.match(/^(\d+)d$/);
  const monthsMatch = p.match(/^last(\d+)m$/);
  const weeksMatch = p.match(/^last(\d+)w$/);

  if (rangeMatch) {
    return {
      startDateExpr: `'${rangeMatch[1]}'::date`,
      endDateExpr: `'${rangeMatch[2]}'::date + interval '1 day'`
    };
  }
  if (singleMatch) {
    return {
      startDateExpr: `'${singleMatch[1]}'::date`,
      endDateExpr: `'${singleMatch[1]}'::date + interval '1 day'`
    };
  }
  if (monthOnlyMatch) {
    const y = parseInt(monthOnlyMatch[1], 10);
    const mo = parseInt(monthOnlyMatch[2], 10);
    if (mo < 1 || mo > 12) {
      throw new Error(
        `Invalid --period "${period}": month must be 01–12 (use YYYY-MM, e.g. 2026-02)`
      );
    }
    const startStr = `${y}-${String(mo).padStart(2, '0')}-01`;
    return {
      startDateExpr: `'${startStr}'::date`,
      endDateExpr: `'${startStr}'::date + interval '1 month'`
    };
  }
  if (lastMatch) {
    const n = parseInt(lastMatch[1], 10);
    return {
      startDateExpr: `CURRENT_DATE - ${n}`,
      endDateExpr: `CURRENT_DATE + interval '1 day'`
    };
  }
  if (daysMatch) {
    const n = parseInt(daysMatch[1], 10);
    return {
      startDateExpr: `CURRENT_DATE - ${n}`,
      endDateExpr: `CURRENT_DATE + interval '1 day'`
    };
  }
  if (monthsMatch) {
    const n = parseInt(monthsMatch[1], 10);
    return {
      startDateExpr: `CURRENT_DATE - interval '${n} months'`,
      endDateExpr: `CURRENT_DATE + interval '1 day'`
    };
  }
  if (weeksMatch) {
    const n = parseInt(weeksMatch[1], 10);
    return {
      startDateExpr: `CURRENT_DATE - ${n * 7}`,
      endDateExpr: `CURRENT_DATE + interval '1 day'`
    };
  }
  switch (p) {
    case 'mtd':
      return {
        startDateExpr: "date_trunc('month', CURRENT_DATE)::date",
        endDateExpr: `CURRENT_DATE + interval '1 day'`
      };
    case 'yesterday':
      return {
        startDateExpr: 'CURRENT_DATE - 1',
        endDateExpr: 'CURRENT_DATE'
      };
    case 'today':
      return {
        startDateExpr: 'CURRENT_DATE',
        endDateExpr: `CURRENT_DATE + interval '1 day'`
      };
    case 'last7':
      return { startDateExpr: 'CURRENT_DATE - 7', endDateExpr: `CURRENT_DATE + interval '1 day'` };
    case 'last30':
      return { startDateExpr: 'CURRENT_DATE - 30', endDateExpr: `CURRENT_DATE + interval '1 day'` };
    case 'last90':
      return { startDateExpr: 'CURRENT_DATE - 90', endDateExpr: `CURRENT_DATE + interval '1 day'` };
    case 'prior_month':
    case 'prev_month':
    case 'lastmonth':
      return {
        startDateExpr: `date_trunc('month', CURRENT_DATE - interval '1 month')`,
        endDateExpr: `date_trunc('month', CURRENT_DATE)`
      };
    default:
      throw new Error(
        `Invalid --period "${period}". Use: mtd, yesterday, today, prior_month, last7, last30, last90, last12m, last6m, 7d, 30d, 90d, YYYY-MM (calendar month), YYYY-MM-DD, or YYYY-MM-DD..YYYY-MM-DD`
      );
  }
}

/**
 * Substitute placeholders in report SQL
 * @param {string} sql - Raw SQL with {{placeholder}} tokens
 * @param {Object} params - { days, limit, schema, normalize, start_date, end_date }
 * @returns {string}
 */
function substituteReportParams(sql, params) {
  let result = sql;
  const schemaPrefix = params.schema ? `${params.schema}.` : '';
  const normalize = params.normalize === true;

  result = result.replace(/\{\{schema\}\}/g, schemaPrefix);
  const rawBuyratesCol = params.buyrates_date_column;
  const buyratesDateCol =
    rawBuyratesCol && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(rawBuyratesCol))
      ? String(rawBuyratesCol)
      : 'activity_at';
  result = result.replace(/\{\{buyrates_date_col\}\}/g, buyratesDateCol);
  result = result.replace(/\{\{limit\}\}/g, String(params.limit));
  result = result.replace(/\{\{start_date\}\}/g, params.start_date);
  result = result.replace(/\{\{end_date\}\}/g, params.end_date);
  // Last calendar day inside [start_date, end_date) — for exchange_rates_from_usd lookup (buyrates usd fx, etc.)
  const fxRateDateExpr = `DATEADD(day, -1, CAST((${params.end_date}) AS DATE))`;
  result = result.replace(/\{\{fx_rate_date\}\}/g, fxRateDateExpr);
  result = result.replace(/\{\{days\}\}/g, String(params.days));
  const startDatePrev = `(${params.start_date}) - interval '1 day'`;
  result = result.replace(/\{\{start_date_prev\}\}/g, startDatePrev);
  const alias = params.table_alias || 'bt';
  const paymentMethodType = params.payment_method_type ? String(params.payment_method_type).toLowerCase() : '';
  const typeAllExplicit = paymentMethodType === 'all';
  const typeUnspecified = !params.payment_method_type;
  if (typeAllExplicit) {
    result = result.replace(/\{\{payment_method_filter\}\}/g, '');
    result = result.replace(/\{\{type_select\}\}/g, `${alias}.payment_method_type AS type,`);
    result = result.replace(/\{\{type_group\}\}/g, `, ${alias}.payment_method_type`);
    result = result.replace(/\{\{type_order\}\}/g, 'type, ');
  } else if (typeUnspecified) {
    result = result.replace(/\{\{payment_method_filter\}\}/g, '');
    result = result.replace(/\{\{type_select\}\}/g, '');
    result = result.replace(/\{\{type_group\}\}/g, '');
    result = result.replace(/\{\{type_order\}\}/g, '');
  } else if (/^[a-z0-9_]+$/i.test(paymentMethodType)) {
    result = result.replace(/\{\{payment_method_filter\}\}/g, `AND ${alias}.payment_method_type = '${paymentMethodType}'`);
    result = result.replace(/\{\{type_select\}\}/g, '');
    result = result.replace(/\{\{type_group\}\}/g, '');
    result = result.replace(/\{\{type_order\}\}/g, '');
  } else {
    result = result.replace(/\{\{payment_method_filter\}\}/g, '');
    result = result.replace(/\{\{type_select\}\}/g, '');
    result = result.replace(/\{\{type_group\}\}/g, '');
    result = result.replace(/\{\{type_order\}\}/g, '');
  }

  // Normalize placeholders: convert all currencies to USD via exchange_rates_from_usd
  // tableAlias: bt for balance_transactions, ch for charges
  const useNetVolume = params.use_net_volume === true;
  const amountCol = useNetVolume ? `(${alias}.amount - COALESCE(${alias}.amount_refunded, 0))` : `${alias}.amount`;
  result = result.replace(/\{\{currency_select\}\}/g, normalize ? '' : `${alias}.currency,`);
  result = result.replace(/\{\{currency_group\}\}/g, normalize ? '' : `, ${alias}.currency`);
  result = result.replace(
    /\{\{amount_expr\}\}/g,
    normalize
      ? `SUM(${amountCol} / 100.0 / COALESCE(CAST(NULLIF(JSON_EXTRACT_PATH_TEXT(er.buy_currency_exchange_rates, ${alias}.currency), '') AS FLOAT), 1)) AS volume_usd`
      : `SUM(${amountCol}) / 100.0 AS volume`
  );
  const dateCol = params.date_column || 'created';
  result = result.replace(
    /\{\{exchange_join\}\}/g,
    normalize
      ? `LEFT JOIN ${schemaPrefix}exchange_rates_from_usd er ON er.date = date_trunc('day', ${alias}.${dateCol})`
      : ''
  );
  const typeOrder = params.payment_method_type && String(params.payment_method_type).toLowerCase() === 'all' ? 'type, ' : '';
  result = result.replace(
    /\{\{order_by\}\}/g,
    normalize ? `a.display_name, ${typeOrder}volume_usd DESC` : `a.display_name, ${typeOrder}${alias}.currency, volume DESC`
  );

  return result;
}

/**
 * Run a canned report from reports/<name>.sql
 * @param {string} reportName - Report name (e.g. connect_volume)
 * @param {Object} options - Command options: days, limit, format, schema
 * @returns {Promise<void>}
 */
async function runPipelineReport(reportName, options) {
  const reportsDir = getReportsDir();
  const baseName = reportName.replace(/\.sql$/i, '');
  const sqlPath = path.join(reportsDir, `${baseName}.sql`);

  if (!fs.existsSync(sqlPath)) {
    const available = fs.existsSync(reportsDir)
      ? fs.readdirSync(reportsDir).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/i, '')).join(', ')
      : '(none)';
    throw new Error(
      `Report not found: ${reportName}. Looked for ${sqlPath}. Available reports: ${available || '(reports/ folder empty)'}`
    );
  }

  const config = getPipelineConfig();
  const schema = options.schema || (config && config.schema) || 'stripe';
  const limit = options.limit != null ? Number(options.limit) : 100;
  const normalize = options.normalize === true;

  let startDateExpr;
  let endDateExpr;
  let days = 30;
  if (baseName === 'reserves' && !options.period && options.days == null) {
    days = 90;
  }
  if (options.period) {
    const parsed = parsePeriod(options.period);
    startDateExpr = parsed.startDateExpr;
    endDateExpr = parsed.endDateExpr;
  } else if (baseName === 'buyrates' && options.days == null) {
    startDateExpr = `date_trunc('month', CURRENT_DATE - interval '1 month')`;
    endDateExpr = `date_trunc('month', CURRENT_DATE)`;
  } else {
    days = options.days != null ? Number(options.days) : days;
    startDateExpr = `CURRENT_DATE - ${days}`;
    endDateExpr = `CURRENT_DATE + interval '1 day'`;
  }

  const tableAlias = baseName === 'connect_volume' ? 'ch' : 'bt';
  const useNetVolume = baseName === 'connect_volume';
  const dateColumn = baseName === 'connect_volume' ? 'captured_at' : 'created';

  let sql = fs.readFileSync(sqlPath, 'utf8');
  const paymentMethodType = options.type;
  const buyratesDateColumnOpt =
    options.buyratesDateColumn ||
    (config && config.buyrates_date_column) ||
    'activity_at';
  sql = substituteReportParams(sql, {
    days,
    limit,
    schema,
    normalize,
    start_date: startDateExpr,
    end_date: endDateExpr,
    table_alias: tableAlias,
    use_net_volume: useNetVolume,
    date_column: dateColumn,
    payment_method_type: paymentMethodType,
    buyrates_date_column: baseName === 'buyrates' ? buyratesDateColumnOpt : undefined
  });

  const dataLoadTables =
    options.skipDataLoadTimes === true ? [] : getReportDataLoadTimeTables(baseName, normalize);

  return runPipelineQuery({
    ...options,
    query: sql,
    dataLoadTimesTables: dataLoadTables,
    dataLoadTimesSchema: options.dataLoadTimesSchema,
    reportPeriod: options.period,
    reportBaseName: baseName,
    schema,
    normalize
  });
}

/**
 * List available canned reports
 * @returns {string[]} Report names (without .sql)
 */
function listPipelineReports() {
  const reportsDir = getReportsDir();
  if (!fs.existsSync(reportsDir)) return [];
  return fs.readdirSync(reportsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/i, ''));
}

/**
 * Print available canned report names to stdout (same listing as pipeline.report with no name).
 */
function printAvailablePipelineReports() {
  const reports = listPipelineReports();
  if (reports.length === 0) {
    console.log(chalk.gray('No reports found in reports/ folder.'));
    return;
  }
  console.log('Available reports:');
  for (const r of reports) {
    console.log(`  ${r}`);
  }
}

module.exports = {
  runPipelineQuery,
  runPipelineReport,
  listPipelineReports,
  printAvailablePipelineReports
};
