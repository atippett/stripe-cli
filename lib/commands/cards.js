const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const chalk = require('chalk');
const { createStripeClient, getStripeKey, detectEnvironment } = require('../stripe-client');

/**
 * Normalize a CSV header key for mapping (trim, lowercase)
 * @param {string} key - Raw header key
 * @returns {string}
 */
function normalizeHeaderKey(key) {
  return String(key || '').trim().toLowerCase();
}

/**
 * Map a row from CardPointe CSV format to internal card row format
 * @param {Object} rawRow - Row as parsed from CSV (keys may have spaces/casing)
 * @returns {Object} - Row with keys: card, exp, first, last, zip, token, name, address, address2, city, state, country, phone, email, company
 */
function normalizeCardPointeRow(rawRow) {
  const keyMap = {};
  Object.keys(rawRow).forEach(k => {
    keyMap[normalizeHeaderKey(k)] = k;
  });

  const get = (... names) => {
    for (const n of names) {
      const rawKey = keyMap[normalizeHeaderKey(n)];
      if (rawKey != null && rawRow[rawKey] != null && String(rawRow[rawKey]).trim() !== '') {
        return String(rawRow[rawKey]).trim();
      }
    }
    return '';
  };

  const cardNumber = get('card number', 'card number');
  const expiry = get('expiry', 'exp');
  let exp = expiry;
  if (exp && exp.length === 4 && !exp.includes('/')) {
    exp = `${exp.substring(0, 2)}/${exp.substring(2, 4)}`;
  }

  const name = get('name');
  let first = '';
  let last = '';
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      first = parts[0];
      last = parts.slice(1).join(' ');
    } else {
      first = name;
    }
  }

  return {
    card: cardNumber,
    exp,
    first,
    last,
    zip: get('postal'),
    token: get('token'),
    name,
    address: get('address'),
    address2: get('address2'),
    city: get('city'),
    state: get('state'),
    country: get('country'),
    phone: get('phone'),
    email: get('email'),
    company: get('company')
  };
}

/**
 * Validates a card number using Luhn algorithm
 * @param {string} cardNumber - Card number to validate
 * @returns {boolean} - True if valid
 */
function validateCardNumber(cardNumber) {
  if (!/^\d{13,19}$/.test(cardNumber)) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  for (let i = cardNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cardNumber[i]);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Validates expiration date format and ensures it's in the future
 * @param {string} expDate - Expiration date in MM/YY or MMYY format
 * @returns {boolean} - True if valid
 */
function validateExpirationDate(expDate) {
  if (!expDate) return false;

  let month, year;
  
  // Handle MM/YY format
  if (expDate.includes('/')) {
    const parts = expDate.split('/');
    if (parts.length !== 2) return false;
    month = parseInt(parts[0]);
    year = parseInt(parts[1]);
  } else {
    // Handle MMYY format
    if (expDate.length !== 4) return false;
    month = parseInt(expDate.substring(0, 2));
    year = parseInt(expDate.substring(2, 4));
  }

  if (month < 1 || month > 12) return false;

  // Convert YY to full year
  const currentYear = new Date().getFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;
  const fullYear = currentCentury + year;

  // Check if date is in the future
  const expDateObj = new Date(fullYear, month - 1);
  const now = new Date();
  
  return expDateObj > now;
}

/**
 * Validates a single row of card data
 * @param {Object} row - Row data from CSV
 * @param {number} rowNumber - Row number for error reporting
 * @returns {Object} - Validation result with errors array
 */
function validateCardRow(row, rowNumber) {
  const errors = [];

  // Validate card number
  if (!row.card) {
    errors.push('Card number is required');
  } else if (!validateCardNumber(row.card)) {
    errors.push('Invalid card number format or Luhn check failed');
  }

  // Validate expiration date
  if (!row.exp) {
    errors.push('Expiration date is required');
  } else if (!validateExpirationDate(row.exp)) {
    errors.push('Invalid expiration date format or date is in the past');
  }

  // Validate optional fields if provided
  if (row.first && (row.first.length < 1 || row.first.length > 50)) {
    errors.push('First name must be 1-50 characters');
  }

  if (row.last && (row.last.length < 1 || row.last.length > 50)) {
    errors.push('Last name must be 1-50 characters');
  }

  if (row.zip && (row.zip.length < 3 || row.zip.length > 10)) {
    errors.push('ZIP code must be 3-10 characters');
  }

  if (row.token && (row.token.length < 1 || row.token.length > 100)) {
    errors.push('Token must be 1-100 characters');
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    rowNumber: rowNumber
  };
}

/**
 * Masks a card number to show only the last 4 digits
 * @param {string} cardNumber - Full card number
 * @returns {string} - Masked card number
 */
function maskCardNumber(cardNumber) {
  if (!cardNumber || cardNumber.length < 4) {
    return cardNumber;
  }
  const last4 = cardNumber.slice(-4);
  const masked = '*'.repeat(cardNumber.length - 4);
  return masked + last4;
}

/**
 * Creates a customer and saves a card using SetupIntent with off_session option
 * @param {Object} cardData - Card data
 * @param {Object} stripe - Stripe client
 * @param {string} accountId - Connected account ID
 * @returns {Object} - Created customer, payment method, and setup intent objects
 */
function parseExpYear(expStr) {
  const year2 = expStr.includes('/') ? expStr.split('/')[1] : expStr.substring(2, 4);
  const y = parseInt(year2, 10);
  return y >= 0 && y <= 99 ? 2000 + y : y;
}

function parseExpMonth(expStr) {
  return parseInt(expStr.includes('/') ? expStr.split('/')[0] : expStr.substring(0, 2), 10);
}

async function createStripeCustomerAndSaveCard(cardData, stripe, accountId, metadata = {}) {
  // Create customer first
  const customerParams = {};
  const displayName = (cardData.name && cardData.name.trim()) || `${(cardData.first || '').trim()} ${(cardData.last || '').trim()}`.trim();
  if (displayName) {
    customerParams.name = displayName;
  }
  if (cardData.email) {
    customerParams.email = cardData.email;
  }
  if (cardData.phone) {
    customerParams.phone = cardData.phone;
  }
  if (cardData.address || cardData.city || cardData.state || cardData.zip || cardData.country) {
    customerParams.address = {
      line1: cardData.address || undefined,
      line2: cardData.address2 || undefined,
      city: cardData.city || undefined,
      state: cardData.state || undefined,
      postal_code: cardData.zip || undefined,
      country: cardData.country || undefined
    };
  }
  if (Object.keys(metadata).length > 0) {
    customerParams.metadata = metadata;
  }

  const customer = await stripe.customers.create(customerParams, {
    stripeAccount: accountId
  });

  // Create payment method
  const paymentMethodParams = {
    type: 'card',
    card: cardData.token ? cardData.token : {
      number: cardData.card,
      exp_month: parseExpMonth(cardData.exp),
      exp_year: parseExpYear(cardData.exp)
    }
  };

  const billingDetails = {};
  if (displayName) {
    billingDetails.name = displayName;
  }
  if (cardData.email) {
    billingDetails.email = cardData.email;
  }
  if (cardData.phone) {
    billingDetails.phone = cardData.phone;
  }
  if (cardData.address || cardData.city || cardData.state || cardData.zip || cardData.country) {
    billingDetails.address = {
      line1: cardData.address || undefined,
      line2: cardData.address2 || undefined,
      city: cardData.city || undefined,
      state: cardData.state || undefined,
      postal_code: cardData.zip || undefined,
      country: cardData.country || undefined
    };
  } else if (cardData.zip) {
    billingDetails.address = { postal_code: cardData.zip };
  }
  if (Object.keys(billingDetails).length > 0) {
    paymentMethodParams.billing_details = billingDetails;
  }

  const paymentMethod = await stripe.paymentMethods.create(paymentMethodParams, {
    stripeAccount: accountId
  });

  // Create SetupIntent to save the card for future use
  const setupIntentParams = {
    customer: customer.id,
    payment_method: paymentMethod.id,
    usage: 'off_session',
    confirm: true,
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: 'never'
    }
  };

  const setupIntent = await stripe.setupIntents.create(setupIntentParams, {
    stripeAccount: accountId
  });

  return {
    customer,
    paymentMethod,
    setupIntent
  };
}

/**
 * Imports cards from CSV file to Stripe connected account
 * @param {Object} options - Command options
 */
/**
 * Parse --metadata key=value options into an object
 * @param {string|string[]} raw - Option value(s) from Commander (e.g. ['env=uat', 'source=cli'] or single string)
 * @returns {Object}
 */
function parseMetadataOption(raw) {
  const result = {};
  if (raw == null) return result;
  const pairs = Array.isArray(raw) ? raw : [raw];
  for (const pair of pairs) {
    const eq = String(pair).indexOf('=');
    if (eq > 0) {
      const key = String(pair).slice(0, eq).trim();
      const value = String(pair).slice(eq + 1).trim();
      if (key) result[key] = value;
    }
  }
  return result;
}

async function importCards(options) {
  const secretKey = getStripeKey(options, 'account.import.card');
  const stripe = createStripeClient(secretKey);
  const customerMetadata = parseMetadataOption(options.metadata);
  if (Object.keys(customerMetadata).length === 0) {
    customerMetadata.import_date = new Date().toISOString();
  }

  const readFromStdin = !options.file;
  if (readFromStdin && process.stdin.isTTY) {
    throw new Error('CSV file is required. Use --file option or redirect input: account.import.card -a <acct> < file.csv');
  }

  // Get account from options or profile
  let platformAccount = options.account;
  let connectedAccount = options.connectedAccount;

  // Try to get account and connected_account from profile (either specified or default)
  try {
    const ProfileManager = require('../profile-manager');
    const profileManager = new ProfileManager();
    profileManager.loadProfiles();
    
    // Get account from profile if not provided via command line
    if (!platformAccount) {
      if (options.platform) {
        platformAccount = profileManager.getProfileAccount(options.platform);
      } else {
        // Try to get from default profile
        const defaultProfile = profileManager.getDefaultProfile();
        if (defaultProfile) {
          platformAccount = profileManager.getProfileAccount(defaultProfile);
        }
      }
    }
    
    // Get connected_account from profile if not provided via command line
    const environment = detectEnvironment(options);
    if (!connectedAccount) {
      if (options.platform) {
        connectedAccount = profileManager.getProfileConnectedAccount(options.platform, environment);
      } else {
        // Try to get from default profile
        const defaultProfile = profileManager.getDefaultProfile();
        if (defaultProfile) {
          connectedAccount = profileManager.getProfileConnectedAccount(defaultProfile, environment);
        }
      }
    }
  } catch (error) {
    // Profile error, continue with command line options only
  }

  if (!platformAccount) {
    throw new Error('Platform account ID is required. Use --account option or set account in profile.');
  }

  if (!readFromStdin && !fs.existsSync(options.file)) {
    throw new Error(`CSV file not found: ${options.file}`);
  }

  const delimiter = options.delimiter || ',';
  const isDryRun = options.dryRun || false;
  const isVerbose = options.verbose || false;

  const inputLabel = readFromStdin ? 'stdin' : options.file;
  console.error(chalk.gray('────────────────────────────────────────'));
  console.error(chalk.bold('  Card Import'));
  console.error(chalk.gray('────────────────────────────────────────'));
  console.error(chalk.blue(`  Input        ${inputLabel}`));
  console.error(chalk.blue(`  Platform     ${platformAccount}`));
  if (connectedAccount) {
    console.error(chalk.blue(`  Connected    ${connectedAccount}`));
  }
  console.error(chalk.blue(`  Mode         ${isDryRun ? 'DRY RUN (validation only)' : 'LIVE IMPORT'}`));
  console.error(chalk.gray('────────────────────────────────────────'));
  console.error('');

  const cards = [];
  const errors = [];
  const results = [];

  const sourceFormat = (options.source || (options.sourceCardpointe ? 'cardpointe' : '') || 'default').toLowerCase();

  try {
    // Parse CSV from file or stdin
    const inputStream = readFromStdin ? process.stdin : fs.createReadStream(options.file);
    await new Promise((resolve, reject) => {
      inputStream
        .pipe(csv({ separator: delimiter }))
        .on('data', (row) => {
          cards.push(row);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    if (cards.length === 0) {
      throw new Error('No data found in CSV file');
    }

    // Preserve original row data for CSV output (before normalization overwrites)
    const originalRows = cards.map(r => ({ ...r }));
    const originalHeaders = Object.keys(originalRows[0] || {});

    if (sourceFormat === 'cardpointe') {
      for (let i = 0; i < cards.length; i++) {
        cards[i] = normalizeCardPointeRow(cards[i]);
      }
      console.error(chalk.blue('Input format: CardPointe (columns normalized)'));
    }

    console.error(chalk.bold(`  Found ${cards.length} cards to process`));
    console.error('');

    // Validate all cards first
    let validCards = 0;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const validation = validateCardRow(card, i + 2); // +2 because CSV is 1-indexed and has header

      if (!validation.isValid) {
        errors.push({
          row: i + 2,
          card: maskCardNumber(card.card) || 'N/A',
          errors: validation.errors
        });
      } else {
        validCards++;
      }
    }

    console.error(chalk.green(`✅ Valid cards: ${validCards}`));
    if (errors.length > 0) {
      console.error(chalk.red(`❌ Invalid cards: ${errors.length}`));
    }

    if (errors.length > 0) {
      console.error('');
      console.error(chalk.red('Validation Errors:'));
      errors.forEach(error => {
        console.error(chalk.red(`  Row ${error.row} (${error.card}): ${error.errors.join(', ')}`));
      });
      console.error('');
    }

    if (validCards === 0) {
      throw new Error('No valid cards found to import');
    }

    if (isDryRun) {
      console.error('');
      console.error(chalk.bold('📊 Dry Run Summary:'));
      console.error(chalk.blue(`🏢 Platform account: ${platformAccount}`));
      if (connectedAccount) {
        console.error(chalk.blue(`🔗 Connected account: ${connectedAccount}`));
      }
      console.error(chalk.green(`✅ Valid cards: ${validCards}`));
      if (errors.length > 0) {
        console.error(chalk.red(`❌ Invalid cards: ${errors.length}`));
      }
      console.error(chalk.yellow('🔍 Dry run completed - no cards were imported'));
      return;
    }

    // Import valid cards
    const totalToImport = cards.length;
    const progressBarWidth = 24;
    const updateProgress = (processed, last4OrMasked) => {
      const pct = totalToImport ? Math.round((processed / totalToImport) * 100) : 0;
      const maxFill = progressBarWidth - 2;
      const filled = totalToImport ? Math.min(maxFill, Math.round((processed / totalToImport) * maxFill)) : 0;
      const spaces = Math.max(0, maxFill - filled);
      const bar = '='.repeat(filled) + (filled < progressBarWidth - 1 ? '>' : '') + ' '.repeat(spaces);
      const msg = chalk.blue(`Importing: [${bar}] ${processed}/${totalToImport} (${pct}%)`) + (last4OrMasked ? chalk.gray(` ${last4OrMasked}`) : '');
      process.stderr.write('\r' + msg + ' '.repeat(Math.max(0, 60 - msg.length)));
    };

    console.error(chalk.blue(`Starting card import (${totalToImport} cards)...`));
    console.error('');

    let successCount = 0;
    let failCount = 0;
    let processedCount = 0;

    const stripeColumnKeys = [
      'stripe_platform_account',
      'stripe_connected_account',
      'stripe_payment_method_id',
      'stripe_customer_id',
      'stripe_setup_intent_id',
      'stripe_setup_intent_payment_method_id',
      'stripe_card_brand',
      'stripe_card_last4',
      'stripe_card_exp_month',
      'stripe_card_exp_year',
      'stripe_status',
      'stripe_error'
    ];

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const validation = validateCardRow(card, i + 2);
      const originalRow = originalRows[i] || {};

      if (!validation.isValid) {
        failCount++;
        processedCount++;
        if (!isVerbose) updateProgress(processedCount, maskCardNumber(card.card));
        results.push({
          ...originalRow,
          stripe_platform_account: '',
          stripe_connected_account: '',
          stripe_payment_method_id: '',
          stripe_customer_id: '',
          stripe_setup_intent_id: '',
          stripe_setup_intent_payment_method_id: '',
          stripe_card_brand: '',
          stripe_card_last4: '',
          stripe_card_exp_month: '',
          stripe_card_exp_year: '',
          stripe_status: 'invalid',
          stripe_error: validation.errors.join('; ')
        });
        continue;
      }

      try {
        if (isVerbose) {
          console.error(chalk.gray(`Processing card ${i + 1}/${cards.length}: ${maskCardNumber(card.card)}`));
        } else {
          updateProgress(processedCount + 1, maskCardNumber(card.card));
        }

        const { customer, paymentMethod, setupIntent } = await createStripeCustomerAndSaveCard(card, stripe, connectedAccount || platformAccount, customerMetadata);
        processedCount++;

        results.push({
          ...originalRow,
          stripe_platform_account: platformAccount,
          stripe_connected_account: connectedAccount || '',
          stripe_payment_method_id: paymentMethod.id,
          stripe_customer_id: customer.id,
          stripe_setup_intent_id: setupIntent.id,
          stripe_setup_intent_payment_method_id: setupIntent.payment_method,
          stripe_card_brand: paymentMethod.card.brand,
          stripe_card_last4: paymentMethod.card.last4,
          stripe_card_exp_month: paymentMethod.card.exp_month,
          stripe_card_exp_year: paymentMethod.card.exp_year,
          stripe_status: 'success',
          stripe_error: ''
        });

        successCount++;

        if (isVerbose) {
          console.error(chalk.green(`  ✅ Created customer: ${customer.id}, payment method: ${paymentMethod.id}, setup intent: ${setupIntent.id}`));
        } else {
          updateProgress(processedCount + 1, maskCardNumber(card.card) + ' ✓');
        }

      } catch (error) {
        failCount++;
        processedCount++;
        if (!isVerbose) updateProgress(processedCount, maskCardNumber(card.card) + ' ✗');
        results.push({
          ...originalRow,
          stripe_platform_account: platformAccount,
          stripe_connected_account: connectedAccount || '',
          stripe_payment_method_id: '',
          stripe_customer_id: '',
          stripe_setup_intent_id: '',
          stripe_setup_intent_payment_method_id: '',
          stripe_card_brand: '',
          stripe_card_last4: '',
          stripe_card_exp_month: '',
          stripe_card_exp_year: '',
          stripe_status: 'failed',
          stripe_error: error.message
        });

        if (isVerbose) {
          console.error(chalk.red(`  ❌ Failed: ${error.message}`));
        }
      }
    }

    // Clear progress line and move to next line
    if (!isVerbose && totalToImport > 0) {
      process.stderr.write('\r' + ' '.repeat(80) + '\r');
    }

    // Summary to stderr (clear layout)
    console.error('');
    console.error(chalk.gray('────────────────────────────────────────'));
    console.error(chalk.bold('  📊 Import Summary'));
    console.error(chalk.gray('────────────────────────────────────────'));
    console.error(chalk.blue(`  Platform account   ${platformAccount}`));
    if (connectedAccount) {
      console.error(chalk.blue(`  Connected account  ${connectedAccount}`));
    }
    console.error('');
    console.error(chalk.green(`  ✅ Successfully imported   ${successCount} cards`));
    if (failCount > 0) {
      console.error(chalk.red(`  ❌ Failed imports          ${failCount} cards`));
    }
    const firstFailure = results.find(r => r.stripe_status === 'failed' && r.stripe_error);
    if (firstFailure) {
      console.error(chalk.red(`  First error: ${firstFailure.stripe_error}`));
    }
    console.error(chalk.gray('────────────────────────────────────────'));
    console.error('');
    console.error(chalk.gray('  Results (CSV):'));
    console.error('');

    // Results to stdout (CSV or JSON)
    if (options.format === 'json') {
      process.stdout.write(JSON.stringify({
        summary: {
          platform_account: platformAccount,
          connected_account: connectedAccount || null,
          total_cards: cards.length,
          successful_imports: successCount,
          failed_imports: failCount
        },
        results: results
      }, null, 2) + '\n');
    } else {
      const escapeCsv = (val) => {
        const s = String(val ?? '');
        if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };
      const headerLine = [...originalHeaders, ...stripeColumnKeys].join(',');
      const dataLines = results.map(r =>
        [...originalHeaders.map(h => escapeCsv(r[h] ?? '')), ...stripeColumnKeys.map(k => escapeCsv(r[k] ?? ''))].join(',')
      );
      process.stdout.write([headerLine, ...dataLines].join('\n') + '\n');
    }

  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Import failed: ${error.message}`);
    }
  }
}

module.exports = {
  importCards
};
