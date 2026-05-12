const fs = require('fs');
const csv = require('csv-parser');
const chalk = require('chalk');
const { normalizeHeaderKey, trimRow, maskCardNumber } = require('./cards');

const ACCT_ID_PATTERN = /^acct_[A-Za-z0-9]+$/;

const META_COLUMN_KEYS = ['match_status', 'stripe_connected_account'];

function escapeCsv(val) {
  const s = String(val ?? '');
  if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function lastFourDigits(value) {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  return digits.slice(-4);
}

function parseCcExpiry(expiry) {
  if (!expiry) return { month: null, year: null };
  const s = String(expiry).trim();
  if (s.includes('/')) {
    const [m, y] = s.split('/');
    const month = parseInt(m, 10);
    const year = parseInt(y, 10);
    return {
      month: isNaN(month) ? null : month,
      year: isNaN(year) ? null : (year < 100 ? 2000 + year : year)
    };
  }
  if (s.length === 4) {
    const month = parseInt(s.slice(0, 2), 10);
    const yy = parseInt(s.slice(2, 4), 10);
    return {
      month: isNaN(month) ? null : month,
      year: isNaN(yy) ? null : 2000 + yy
    };
  }
  return { month: null, year: null };
}

function joinKey(profileId, last4, month, year) {
  return `${profileId}|${last4 || ''}|${month || ''}|${year || ''}`;
}

function ccRowJoinKey(ccRow) {
  const profileId = String(ccRow.profileid || '').trim();
  if (!profileId) return null;
  const last4 = lastFourDigits(ccRow.token);
  const { month, year } = parseCcExpiry(ccRow.expiry);
  return joinKey(profileId, last4, month, year);
}

function stripeRowJoinKey(stripeRow) {
  const oldId = String(stripeRow.old_id || '').trim();
  if (!oldId) return null;
  const last4 = String(stripeRow.card_last4 || '').padStart(4, '0').slice(-4);
  const month = parseInt(stripeRow.card_exp_month, 10);
  const year = parseInt(stripeRow.card_exp_year, 10);
  return joinKey(
    oldId,
    last4,
    isNaN(month) ? null : month,
    isNaN(year) ? null : year
  );
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

function requireHeaders(rows, requiredHeaders, fileLabel) {
  const headers = new Set(Object.keys(rows[0] || {}).map(normalizeHeaderKey));
  const missing = requiredHeaders.filter(h => !headers.has(h));
  if (missing.length) {
    throw new Error(
      `${fileLabel} is missing required column(s): ${missing.join(', ')}. ` +
      `Found: ${[...headers].join(', ')}`
    );
  }
}

function maskCardInRow(row) {
  const cardNumberHeaders = ['card', 'card number'];
  const out = { ...row };
  for (const key of Object.keys(out)) {
    const normalized = String(key).toLowerCase().trim();
    if (cardNumberHeaders.includes(normalized) && out[key]) {
      out[key] = maskCardNumber(out[key]);
    }
  }
  return out;
}

async function mapCardConnect(connectedAccount, options) {
  if (!connectedAccount || !ACCT_ID_PATTERN.test(connectedAccount)) {
    throw new Error(
      `Invalid Stripe connected account ID: "${connectedAccount || ''}". Expected: acct_*`
    );
  }

  const ccFile = options.cardconnect;
  const stripeFile = options.stripe;

  if (!fs.existsSync(ccFile)) throw new Error(`CardConnect file not found: ${ccFile}`);
  if (!fs.existsSync(stripeFile)) throw new Error(`Stripe file not found: ${stripeFile}`);

  console.error(chalk.gray('────────────────────────────────────────'));
  console.error(chalk.bold('  CardConnect ↔ Stripe Map'));
  console.error(chalk.gray('────────────────────────────────────────'));
  console.error(chalk.blue(`  Connected acct     ${connectedAccount}`));
  console.error(chalk.blue(`  CardConnect        ${ccFile}`));
  console.error(chalk.blue(`  Stripe             ${stripeFile}`));
  console.error(chalk.gray('────────────────────────────────────────'));
  console.error('');

  const ccRows = await readCsvFile(ccFile);
  const stripeRows = await readCsvFile(stripeFile);
  if (ccRows.length === 0) throw new Error('CardConnect file is empty');
  if (stripeRows.length === 0) throw new Error('Stripe file is empty');

  requireHeaders(ccRows, ['profileid', 'token', 'expiry'], 'CardConnect file');
  requireHeaders(stripeRows, ['old_id', 'created_customer', 'source_new_id'], 'Stripe file');

  const ccHeaders = Object.keys(ccRows[0] || {});
  const stripeHeaders = Object.keys(stripeRows[0] || {});
  const prefixedStripeHeaders = stripeHeaders.map(h => `stripe_${h}`);

  const prefixStripe = (row) => {
    const out = {};
    for (const h of stripeHeaders) out[`stripe_${h}`] = row[h];
    return out;
  };

  // Index Stripe rows by join key for fast lookup
  const stripeByKey = new Map();
  for (const r of stripeRows) {
    const k = stripeRowJoinKey(r);
    if (k) stripeByKey.set(k, r);
  }

  const matchedStripeKeys = new Set();
  const results = [];
  let matched = 0;
  let cardconnectOnly = 0;
  let stripeOnly = 0;

  const emptyCc = Object.fromEntries(ccHeaders.map(h => [h, '']));
  const emptyStripe = Object.fromEntries(prefixedStripeHeaders.map(h => [h, '']));

  // Walk CC rows: matched or cardconnect_only
  for (const cc of ccRows) {
    const key = ccRowJoinKey(cc);
    const hit = key ? stripeByKey.get(key) : null;
    if (hit) {
      matchedStripeKeys.add(key);
      results.push({
        match_status: 'matched',
        stripe_connected_account: connectedAccount,
        ...cc,
        ...prefixStripe(hit)
      });
      matched++;
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

  // Walk Stripe rows: stripe_only for anything we didn't already match
  for (const sr of stripeRows) {
    const key = stripeRowJoinKey(sr);
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

  console.error(chalk.gray('────────────────────────────────────────'));
  console.error(chalk.bold('  Map Summary'));
  console.error(chalk.gray('────────────────────────────────────────'));
  console.error(chalk.blue(`  Connected acct     ${connectedAccount}`));
  console.error('');
  console.error(chalk.green(`  ✅ Matched              ${matched}`));
  if (cardconnectOnly > 0) {
    console.error(chalk.yellow(`  ⚠️  CardConnect only    ${cardconnectOnly}`));
  }
  if (stripeOnly > 0) {
    console.error(chalk.yellow(`  ⚠️  Stripe only         ${stripeOnly}`));
  }
  console.error(chalk.gray('────────────────────────────────────────'));
  console.error('');

  const allHeaders = [...META_COLUMN_KEYS, ...ccHeaders, ...prefixedStripeHeaders];

  if (options.format === 'json') {
    process.stdout.write(JSON.stringify({
      summary: {
        connected_account: connectedAccount,
        matched,
        cardconnect_only: cardconnectOnly,
        stripe_only: stripeOnly,
        total: results.length
      },
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
  mapCardConnect
};
