const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const chalk = require('chalk');
const { trimRow, maskCardNumber } = require('./cards');

const META_COLUMN_KEYS = ['match_status', 'stripe_connected_account'];

// Sniff acct_* from Stripe migration filenames like
// import_acct_1SzNOXF8jXW0haeO_card_pms_migreq_…csv
const STRIPE_IMPORT_ACCT_PATTERN = /import_(acct_[A-Za-z0-9]+)_card_pms/;

// Column aliases keyed by the canonical field we need. Each alias is matched
// after aggressive normalization (lowercase, strip all non-alphanumerics), so
// "Profile ID", "profile_id" and "profileid" all resolve to the same field.
// This lets us accept both the legacy CardConnect export (single `expiry`
// column, last4 derived from `token`) and the newer export (split
// `Expiry Month`/`Expiry Year` columns plus a dedicated `Last 4`).
const CC_COLUMN_SPECS = {
  profileId: ['profileid'],
  acctId: ['acctid', 'accountid'],
  token: ['token'],
  last4: ['last4', 'lastfour'],
  expiry: ['expiry', 'exp', 'expiration', 'expdate'],
  expiryMonth: ['expirymonth', 'expmonth', 'expirationmonth'],
  expiryYear: ['expiryyear', 'expyear', 'expirationyear']
};

const STRIPE_COLUMN_SPECS = {
  oldId: ['oldid'],
  createdCustomer: ['createdcustomer'],
  sourceNewId: ['sourcenewid'],
  last4: ['cardlast4', 'last4', 'lastfour'],
  expMonth: ['cardexpmonth', 'expmonth', 'expirationmonth'],
  expYear: ['cardexpyear', 'expyear', 'expirationyear']
};

function escapeCsv(val) {
  const s = String(val ?? '');
  if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Aggressive header normalization: lowercase + drop everything that isn't a
// letter or digit. "Profile ID" -> "profileid", "card_exp_month" -> "cardexpmonth".
function normKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Map canonical field names -> the actual header string present in the file.
// First header wins on collision so we stay deterministic.
function resolveColumns(headers, specs) {
  const normToOriginal = new Map();
  for (const h of headers || []) {
    const nk = normKey(h);
    if (nk && !normToOriginal.has(nk)) normToOriginal.set(nk, h);
  }
  const resolved = {};
  for (const [field, aliases] of Object.entries(specs)) {
    for (const alias of aliases) {
      const nk = normKey(alias);
      if (normToOriginal.has(nk)) {
        resolved[field] = normToOriginal.get(nk);
        break;
      }
    }
  }
  return resolved;
}

// Normalize any last-4 representation to a zero-padded 4-digit string so the
// CardConnect and Stripe sides compare identically (e.g. "42" -> "0042").
function normalizeLast4(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.slice(-4).padStart(4, '0');
}

// Parse a single combined expiry value ("MM/YY", "MM/YYYY", or "MMYY").
function parseCcExpiry(expiry) {
  if (!expiry) return { month: null, year: null };
  const s = String(expiry).trim();
  if (s.includes('/')) {
    const [m, y] = s.split('/');
    return parseExpiryParts(m, y);
  }
  if (/^\d{4}$/.test(s)) {
    return parseExpiryParts(s.slice(0, 2), s.slice(2, 4));
  }
  return { month: null, year: null };
}

// Parse separate month/year values, coercing 2-digit years to 20xx.
function parseExpiryParts(monthRaw, yearRaw) {
  let month = parseInt(monthRaw, 10);
  let year = parseInt(yearRaw, 10);
  if (isNaN(month)) month = null;
  if (isNaN(year)) year = null;
  else if (year < 100) year += 2000;
  return { month, year };
}

function joinKey(profileId, last4, month, year) {
  return `${profileId}|${last4 || ''}|${month || ''}|${year || ''}`;
}

function ccLast4(cc, cols) {
  if (cols.last4) {
    const v = normalizeLast4(cc[cols.last4]);
    if (v) return v;
  }
  if (cols.token) return normalizeLast4(cc[cols.token]);
  return '';
}

function ccExpiry(cc, cols) {
  if (cols.expiryMonth || cols.expiryYear) {
    return parseExpiryParts(
      cols.expiryMonth ? cc[cols.expiryMonth] : null,
      cols.expiryYear ? cc[cols.expiryYear] : null
    );
  }
  if (cols.expiry) return parseCcExpiry(cc[cols.expiry]);
  return { month: null, year: null };
}

function ccRowJoinKey(cc, cols) {
  const profileId = String(cols.profileId ? cc[cols.profileId] : '').trim();
  if (!profileId) return null;
  const last4 = ccLast4(cc, cols);
  const { month, year } = ccExpiry(cc, cols);
  return joinKey(profileId, last4, month, year);
}

function stripeRowJoinKey(stripeRow, cols) {
  const oldId = String(cols.oldId ? stripeRow[cols.oldId] : '').trim();
  if (!oldId) return null;
  const last4 = normalizeLast4(cols.last4 ? stripeRow[cols.last4] : '');
  const { month, year } = parseExpiryParts(
    cols.expMonth ? stripeRow[cols.expMonth] : null,
    cols.expYear ? stripeRow[cols.expYear] : null
  );
  return joinKey(oldId, last4, month, year);
}

async function readCsvFile(filePath) {
  const rows = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => rows.push(trimRow(row)))
      .on('end', resolve)
      .on('error', reject);
  });
  return rows;
}

function validateCcColumns(cols) {
  const missing = [];
  if (!cols.profileId) missing.push('profileid');
  if (!cols.last4 && !cols.token) missing.push('last4 (or token)');
  if (!cols.expiry && !cols.expiryMonth && !cols.expiryYear) {
    missing.push('expiry (or expiry month + expiry year)');
  }
  return missing;
}

function validateStripeColumns(cols) {
  const missing = [];
  if (!cols.oldId) missing.push('old_id');
  if (!cols.createdCustomer) missing.push('created_customer');
  if (!cols.sourceNewId) missing.push('source_new_id');
  return missing;
}

function maskCardInRow(row) {
  const cardNumberHeaders = new Set(['card', 'cardnumber']);
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (cardNumberHeaders.has(normKey(key)) && out[key]) {
      out[key] = maskCardNumber(out[key]);
    }
  }
  return out;
}

// Pure join: no file/stdout IO. Returns the merged rows plus a summary and the
// header layout so the caller can render CSV/JSON. Collects non-fatal warnings.
function buildMap(ccRows, stripeRows, connectedAccount) {
  if (!ccRows || ccRows.length === 0) throw new Error('CardConnect file is empty');
  if (!stripeRows || stripeRows.length === 0) throw new Error('Stripe file is empty');

  const ccCols = resolveColumns(Object.keys(ccRows[0]), CC_COLUMN_SPECS);
  const stripeCols = resolveColumns(Object.keys(stripeRows[0]), STRIPE_COLUMN_SPECS);

  const ccMissing = validateCcColumns(ccCols);
  if (ccMissing.length) {
    throw new Error(
      `CardConnect file is missing required column(s): ${ccMissing.join(', ')}. ` +
      `Found: ${Object.keys(ccRows[0]).join(', ')}`
    );
  }
  const stripeMissing = validateStripeColumns(stripeCols);
  if (stripeMissing.length) {
    throw new Error(
      `Stripe file is missing required column(s): ${stripeMissing.join(', ')}. ` +
      `Found: ${Object.keys(stripeRows[0]).join(', ')}`
    );
  }

  const warnings = [];
  if (!stripeCols.last4 || !stripeCols.expMonth || !stripeCols.expYear) {
    warnings.push(
      'Stripe file is missing card_last4/card_exp_month/card_exp_year; matches may be incomplete.'
    );
  }

  // Optional acctid data-quality guard: only when the column exists.
  if (ccCols.acctId) {
    const badAcctIds = [];
    for (let i = 0; i < ccRows.length; i++) {
      const val = String(ccRows[i][ccCols.acctId] ?? '').trim();
      if (val && !/^\d+$/.test(val)) {
        badAcctIds.push({ row: i + 2, value: val });
        if (badAcctIds.length >= 10) break;
      }
    }
    if (badAcctIds.length) {
      const sample = badAcctIds
        .map(b => `  row ${b.row}: ${JSON.stringify(b.value)}`)
        .join('\n');
      throw new Error(
        `CardConnect file has non-numeric acctid value(s):\n${sample}` +
        (badAcctIds.length === 10 ? '\n  …(showing first 10)' : '')
      );
    }
  }

  const ccHeaders = Object.keys(ccRows[0]);
  const stripeHeaders = Object.keys(stripeRows[0]);
  const prefixedStripeHeaders = stripeHeaders.map(h => `stripe_${h}`);

  const prefixStripe = (row) => {
    const out = {};
    for (const h of stripeHeaders) out[`stripe_${h}`] = row[h];
    return out;
  };

  // Index Stripe rows by join key. A single key can legitimately map to
  // multiple Stripe rows (dupes); keep them so each gets emitted.
  const stripeByKey = new Map();
  for (const r of stripeRows) {
    const k = stripeRowJoinKey(r, stripeCols);
    if (!k) continue;
    if (!stripeByKey.has(k)) stripeByKey.set(k, []);
    stripeByKey.get(k).push(r);
  }

  const matchedStripeKeys = new Set();
  const results = [];
  let matched = 0;
  let cardconnectOnly = 0;
  let stripeOnly = 0;

  const emptyStripe = Object.fromEntries(prefixedStripeHeaders.map(h => [h, '']));
  const emptyCc = Object.fromEntries(ccHeaders.map(h => [h, '']));

  // Walk CC rows: matched (one row per matching Stripe row) or cardconnect_only.
  for (const cc of ccRows) {
    const key = ccRowJoinKey(cc, ccCols);
    const hits = key ? stripeByKey.get(key) : null;
    if (hits && hits.length) {
      matchedStripeKeys.add(key);
      for (const hit of hits) {
        results.push({
          match_status: 'matched',
          stripe_connected_account: connectedAccount,
          ...cc,
          ...prefixStripe(hit)
        });
        matched++;
      }
    } else {
      results.push({
        match_status: 'cardconnect_only',
        stripe_connected_account: connectedAccount,
        ...cc,
        ...emptyStripe
      });
      cardconnectOnly++;
    }
  }

  // Walk Stripe rows: stripe_only for anything we didn't already match.
  for (const sr of stripeRows) {
    const key = stripeRowJoinKey(sr, stripeCols);
    if (!key || !matchedStripeKeys.has(key)) {
      results.push({
        match_status: 'stripe_only',
        stripe_connected_account: connectedAccount,
        ...emptyCc,
        ...prefixStripe(sr)
      });
      stripeOnly++;
    }
  }

  return {
    results,
    warnings,
    ccHeaders,
    prefixedStripeHeaders,
    ccCols,
    stripeCols,
    summary: {
      connected_account: connectedAccount,
      matched,
      cardconnect_only: cardconnectOnly,
      stripe_only: stripeOnly,
      total: results.length
    }
  };
}

// Build a human-readable results report: summary, reconciliation, and the
// specific CardConnect-only and Stripe-only accounts that didn't match.
function formatResultsReport(build, meta = {}) {
  const { results, summary, ccCols, stripeCols } = build;
  const lines = [];

  lines.push('CardConnect ↔ Stripe Token Map — Results');
  lines.push(`Generated:         ${new Date().toISOString()}`);
  if (meta.connectedAccount) lines.push(`Connected account: ${meta.connectedAccount}`);
  if (meta.ccFile) lines.push(`CardConnect file:  ${meta.ccFile}`);
  if (meta.stripeFile) lines.push(`Stripe file:       ${meta.stripeFile}`);
  lines.push('');

  const ccInputRows = summary.matched + summary.cardconnect_only;
  lines.push('Summary');
  lines.push(`  Matched:          ${summary.matched}`);
  lines.push(`  CardConnect only: ${summary.cardconnect_only}`);
  lines.push(`  Stripe only:      ${summary.stripe_only}`);
  lines.push(`  Total rows:       ${summary.total}`);
  lines.push(`  Reconciliation:   CardConnect ${ccInputRows} = ${summary.matched} matched + ${summary.cardconnect_only} cardconnect_only`);
  lines.push('');

  const ccOnly = results.filter(r => r.match_status === 'cardconnect_only');
  lines.push(`CardConnect-only (no Stripe match) — ${ccOnly.length}`);
  if (ccOnly.length === 0) {
    lines.push('  (none)');
  } else {
    for (const r of ccOnly) {
      const parts = [];
      if (ccCols.profileId) parts.push(`profileid=${r[ccCols.profileId] || ''}`);
      if (ccCols.acctId) parts.push(`acctid=${r[ccCols.acctId] || ''}`);
      const last4 = ccLast4(r, ccCols);
      if (last4) parts.push(`last4=${last4}`);
      const { month, year } = ccExpiry(r, ccCols);
      if (month || year) parts.push(`exp=${month || '?'}/${year || '?'}`);
      lines.push(`  ${parts.join('  ')}`);
    }
  }
  lines.push('');

  const stripeOnly = results.filter(r => r.match_status === 'stripe_only');
  lines.push(`Stripe-only (no CardConnect match) — ${stripeOnly.length}`);
  if (stripeOnly.length === 0) {
    lines.push('  (none)');
  } else {
    const oldIdKey = stripeCols.oldId ? `stripe_${stripeCols.oldId}` : null;
    const custKey = stripeCols.createdCustomer ? `stripe_${stripeCols.createdCustomer}` : null;
    const pmKey = stripeCols.sourceNewId ? `stripe_${stripeCols.sourceNewId}` : null;
    const last4Key = stripeCols.last4 ? `stripe_${stripeCols.last4}` : null;
    for (const r of stripeOnly) {
      const parts = [];
      if (oldIdKey) parts.push(`old_id=${r[oldIdKey] || ''}`);
      if (custKey) parts.push(`customer=${r[custKey] || ''}`);
      if (pmKey) parts.push(`payment_method=${r[pmKey] || ''}`);
      if (last4Key) parts.push(`last4=${normalizeLast4(r[last4Key])}`);
      lines.push(`  ${parts.join('  ')}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

async function mapCardConnect(options) {
  const ccFile = options.cardconnect;
  const stripeFile = options.stripe;

  if (!fs.existsSync(ccFile)) throw new Error(`CardConnect file not found: ${ccFile}`);
  if (!fs.existsSync(stripeFile)) throw new Error(`Stripe file not found: ${stripeFile}`);

  // Derive connected account from Stripe filename for traceability; blank if not derivable.
  const acctMatch = stripeFile.match(STRIPE_IMPORT_ACCT_PATTERN);
  const connectedAccount = acctMatch ? acctMatch[1] : '';

  console.error(chalk.gray('────────────────────────────────────────'));
  console.error(chalk.bold('  CardConnect ↔ Stripe Map'));
  console.error(chalk.gray('────────────────────────────────────────'));
  if (connectedAccount) {
    console.error(chalk.blue(`  Connected acct     ${connectedAccount} (from Stripe filename)`));
  }
  console.error(chalk.blue(`  CardConnect        ${ccFile}`));
  console.error(chalk.blue(`  Stripe             ${stripeFile}`));
  console.error(chalk.gray('────────────────────────────────────────'));
  console.error('');

  const ccRows = await readCsvFile(ccFile);
  const stripeRows = await readCsvFile(stripeFile);

  const build = buildMap(ccRows, stripeRows, connectedAccount);
  const { results, warnings, ccHeaders, prefixedStripeHeaders, summary } = build;

  for (const w of warnings) console.error(chalk.yellow(`  ⚠️  ${w}`));
  if (warnings.length) console.error('');

  console.error(chalk.gray('────────────────────────────────────────'));
  console.error(chalk.bold('  Map Summary'));
  console.error(chalk.gray('────────────────────────────────────────'));
  console.error(chalk.green(`  ✅ Matched              ${summary.matched}`));
  if (summary.cardconnect_only > 0) {
    console.error(chalk.yellow(`  ⚠️  CardConnect only    ${summary.cardconnect_only}`));
  }
  if (summary.stripe_only > 0) {
    console.error(chalk.yellow(`  ⚠️  Stripe only         ${summary.stripe_only}`));
  }
  console.error(chalk.gray('────────────────────────────────────────'));
  console.error('');

  if (options.results) {
    const report = formatResultsReport(build, {
      connectedAccount,
      ccFile: path.basename(ccFile),
      stripeFile: path.basename(stripeFile)
    });
    fs.writeFileSync(options.results, report);
    console.error(chalk.blue(`  📄 Results report      ${options.results}`));
    console.error('');
  }

  const allHeaders = [...META_COLUMN_KEYS, ...ccHeaders, ...prefixedStripeHeaders];

  if (options.format === 'json') {
    process.stdout.write(JSON.stringify({
      summary,
      results: results.map(maskCardInRow)
    }, null, 2) + '\n');
    return;
  }

  const headerLine = allHeaders.join(',');
  const dataLines = results.map(r => {
    const masked = maskCardInRow(r);
    return allHeaders.map(h => escapeCsv(masked[h] ?? '')).join(',');
  });
  process.stdout.write([headerLine, ...dataLines].join('\n') + '\n');
}

module.exports = {
  mapCardConnect,
  // Exported for unit testing.
  buildMap,
  formatResultsReport,
  resolveColumns,
  normKey,
  normalizeLast4,
  parseCcExpiry,
  parseExpiryParts,
  ccRowJoinKey,
  stripeRowJoinKey,
  CC_COLUMN_SPECS,
  STRIPE_COLUMN_SPECS
};
