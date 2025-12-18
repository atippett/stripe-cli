const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const chalk = require('chalk');
const { createStripeClient, getStripeKey } = require('../stripe-client');

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
async function createStripeCustomerAndSaveCard(cardData, stripe, accountId) {
  // Create customer first
  const customerParams = {};
  
  // Add customer name if provided
  if (cardData.first || cardData.last) {
    customerParams.name = `${cardData.first || ''} ${cardData.last || ''}`.trim();
  }

  const customer = await stripe.customers.create(customerParams, {
    stripeAccount: accountId
  });

  // Create payment method
  const paymentMethodParams = {
    type: 'card',
    card: {
      number: cardData.card,
      exp_month: parseInt(cardData.exp.includes('/') ? cardData.exp.split('/')[0] : cardData.exp.substring(0, 2)),
      exp_year: parseInt(cardData.exp.includes('/') ? cardData.exp.split('/')[1] : cardData.exp.substring(2, 4)) + 2000
    }
  };

  // Add optional fields if provided
  if (cardData.first || cardData.last) {
    paymentMethodParams.billing_details = {
      name: `${cardData.first || ''} ${cardData.last || ''}`.trim()
    };
  }

  if (cardData.zip) {
    if (!paymentMethodParams.billing_details) {
      paymentMethodParams.billing_details = {};
    }
    paymentMethodParams.billing_details.address = {
      postal_code: cardData.zip
    };
  }

  // If token is provided, use it instead of card details
  if (cardData.token) {
    paymentMethodParams.card = cardData.token;
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
async function importCards(options) {
  const secretKey = getStripeKey(options);
  const stripe = createStripeClient(secretKey);

  if (!options.file) {
    throw new Error('CSV file is required. Use --file option.');
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
    if (!connectedAccount) {
      if (options.platform) {
        connectedAccount = profileManager.getProfileConnectedAccount(options.platform);
      } else {
        // Try to get from default profile
        const defaultProfile = profileManager.getDefaultProfile();
        if (defaultProfile) {
          connectedAccount = profileManager.getProfileConnectedAccount(defaultProfile);
        }
      }
    }
  } catch (error) {
    // Profile error, continue with command line options only
  }

  if (!platformAccount) {
    throw new Error('Platform account ID is required. Use --account option or set account in profile.');
  }

  if (!fs.existsSync(options.file)) {
    throw new Error(`CSV file not found: ${options.file}`);
  }

  const delimiter = options.delimiter || ',';
  const isDryRun = options.dryRun || false;
  const isVerbose = options.verbose || false;

  console.log(chalk.blue(`Importing cards from: ${options.file}`));
  console.log(chalk.blue(`Platform account: ${platformAccount}`));
  if (connectedAccount) {
    console.log(chalk.blue(`Connected account: ${connectedAccount}`));
  }
  console.log(chalk.blue(`Mode: ${isDryRun ? 'DRY RUN (validation only)' : 'LIVE IMPORT'}`));
  console.log('');

  const cards = [];
  const errors = [];
  const results = [];

  try {
    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(options.file)
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

    console.log(chalk.blue(`Found ${cards.length} cards to process`));
    console.log('');

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

    console.log(chalk.green(`✅ Valid cards: ${validCards}`));
    console.log(chalk.red(`❌ Invalid cards: ${errors.length}`));

    if (errors.length > 0) {
      console.log('');
      console.log(chalk.red('Validation Errors:'));
      errors.forEach(error => {
        console.log(chalk.red(`  Row ${error.row} (${error.card}): ${error.errors.join(', ')}`));
      });
      console.log('');
    }

    if (validCards === 0) {
      throw new Error('No valid cards found to import');
    }

    if (isDryRun) {
      console.log('');
      console.log(chalk.bold('📊 Dry Run Summary:'));
      console.log(chalk.blue(`🏢 Platform account: ${platformAccount}`));
      if (connectedAccount) {
        console.log(chalk.blue(`🔗 Connected account: ${connectedAccount}`));
      }
      console.log(chalk.green(`✅ Valid cards: ${validCards}`));
      console.log(chalk.red(`❌ Invalid cards: ${errors.length}`));
      console.log(chalk.yellow('🔍 Dry run completed - no cards were imported'));
      return;
    }

    // Import valid cards
    console.log(chalk.blue('Starting card import...'));
    console.log('');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const validation = validateCardRow(card, i + 2);

      if (!validation.isValid) {
        failCount++;
        continue;
      }

      try {
        if (isVerbose) {
          console.log(chalk.gray(`Processing card ${i + 1}/${cards.length}: ${maskCardNumber(card.card)}`));
        }

        const { customer, paymentMethod, setupIntent } = await createStripeCustomerAndSaveCard(card, stripe, connectedAccount || platformAccount);
        
        results.push({
          card_masked: maskCardNumber(card.card),
          exp: card.exp,
          first: card.first || '',
          last: card.last || '',
          zip: card.zip || '',
          token: card.token || '',
          platform_account: platformAccount,
          connected_account: connectedAccount || '',
          stripe_payment_method_id: paymentMethod.id,
          stripe_customer_id: customer.id,
          stripe_setup_intent_id: setupIntent.id,
          stripe_setup_intent_payment_method_id: setupIntent.payment_method,
          stripe_card_brand: paymentMethod.card.brand,
          stripe_card_last4: paymentMethod.card.last4,
          stripe_card_exp_month: paymentMethod.card.exp_month,
          stripe_card_exp_year: paymentMethod.card.exp_year,
          status: 'success'
        });

        successCount++;

        if (isVerbose) {
          console.log(chalk.green(`  ✅ Created customer: ${customer.id}, payment method: ${paymentMethod.id}, setup intent: ${setupIntent.id}`));
        }

      } catch (error) {
        failCount++;
        results.push({
          card_masked: maskCardNumber(card.card),
          exp: card.exp,
          first: card.first || '',
          last: card.last || '',
          zip: card.zip || '',
          token: card.token || '',
          platform_account: platformAccount,
          connected_account: connectedAccount || '',
          stripe_payment_method_id: '',
          stripe_customer_id: '',
          stripe_setup_intent_id: '',
          stripe_setup_intent_payment_method_id: '',
          stripe_card_brand: '',
          stripe_card_last4: '',
          stripe_card_exp_month: '',
          stripe_card_exp_year: '',
          status: 'failed',
          error: error.message
        });

        if (isVerbose) {
          console.log(chalk.red(`  ❌ Failed: ${error.message}`));
        }
      }
    }

    // Generate output CSV
    const outputFile = options.output || `imported_cards_${Date.now()}.csv`;
    const csvWriter = createCsvWriter({
      path: outputFile,
      header: [
        // Original data from input CSV
        { id: 'card_masked', title: 'card_last_4' },
        { id: 'exp', title: 'exp' },
        { id: 'first', title: 'first' },
        { id: 'last', title: 'last' },
        { id: 'zip', title: 'zip' },
        { id: 'token', title: 'token' },
        // Account information used for import
        { id: 'platform_account', title: 'platform_account' },
        { id: 'connected_account', title: 'connected_account' },
        // Stripe data created by import
        { id: 'stripe_payment_method_id', title: 'stripe_payment_method_id' },
        { id: 'stripe_customer_id', title: 'stripe_customer_id' },
        { id: 'stripe_setup_intent_id', title: 'stripe_setup_intent_id' },
        { id: 'stripe_setup_intent_payment_method_id', title: 'stripe_setup_intent_payment_method_id' },
        { id: 'stripe_card_brand', title: 'stripe_card_brand' },
        { id: 'stripe_card_last4', title: 'stripe_card_last4' },
        { id: 'stripe_card_exp_month', title: 'stripe_card_exp_month' },
        { id: 'stripe_card_exp_year', title: 'stripe_card_exp_year' },
        // Import results
        { id: 'status', title: 'status' },
        { id: 'error', title: 'error' }
      ]
    });

    await csvWriter.writeRecords(results);

    // Summary
    console.log('');
    console.log(chalk.bold('📊 Import Summary:'));
    console.log(chalk.blue(`🏢 Platform account: ${platformAccount}`));
    if (connectedAccount) {
      console.log(chalk.blue(`🔗 Connected account: ${connectedAccount}`));
    }
    console.log(chalk.green(`✅ Successfully imported: ${successCount} cards`));
    console.log(chalk.red(`❌ Failed imports: ${failCount} cards`));
    console.log(chalk.blue(`📁 Output file: ${outputFile}`));

    if (options.format === 'json') {
      console.log('');
      console.log(JSON.stringify({
        summary: {
          platform_account: platformAccount,
          connected_account: connectedAccount || null,
          total_cards: cards.length,
          successful_imports: successCount,
          failed_imports: failCount,
          output_file: outputFile
        },
        results: results
      }, null, 2));
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
