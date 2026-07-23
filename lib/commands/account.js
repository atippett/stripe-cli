const chalk = require('chalk');
const { table } = require('table');
const { createStripeClient, getStripeKey } = require('../stripe-client');
const { printSettingsTree } = require('../output');

/**
 * Lists the first 50 Connect accounts
 * @param {Object} options - Command options
 */
async function listAccounts(options) {
  const secretKey = getStripeKey(options, 'account.list');
  const stripe = createStripeClient(secretKey, options);

  try {
    console.log(chalk.blue('Fetching Connect accounts...'));
    
    const accounts = await stripe.accounts.list({
      limit: 50
    });

    if (accounts.data.length === 0) {
      console.log(chalk.yellow('No Connect accounts found.'));
      return;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(accounts.data, null, 2));
      return;
    }

    // Format as table
    const tableData = [
      [
        chalk.bold('ID'),
        chalk.bold('Email'),
        chalk.bold('Country'),
        chalk.bold('Type'),
        chalk.bold('Charges Enabled'),
        chalk.bold('Payouts Enabled'),
        chalk.bold('Created')
      ]
    ];

    accounts.data.forEach(account => {
      const createdDate = new Date(account.created * 1000).toLocaleDateString();
      
      tableData.push([
        account.id,
        account.email || 'N/A',
        account.country || 'N/A',
        account.type || 'N/A',
        account.charges_enabled ? chalk.green('✓') : chalk.red('✗'),
        account.payouts_enabled ? chalk.green('✓') : chalk.red('✗'),
        createdDate
      ]);
    });

    const tableConfig = {
      border: {
        topBody: '─',
        topJoin: '┬',
        topLeft: '┌',
        topRight: '┐',
        bottomBody: '─',
        bottomJoin: '┴',
        bottomLeft: '└',
        bottomRight: '┘',
        bodyLeft: '│',
        bodyRight: '│',
        bodyJoin: '│',
        joinBody: '─',
        joinLeft: '├',
        joinRight: '┤',
        joinJoin: '┼'
      },
      columnDefault: {
        paddingLeft: 1,
        paddingRight: 1
      }
    };

    console.log(table(tableData, tableConfig));
    console.log(chalk.gray(`\nTotal accounts: ${accounts.data.length}`));

  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to fetch accounts: ${error.message}`);
    }
  }
}

/**
 * Searches Connect accounts using fuzzy matching
 * @param {Object} options - Command options
 */
async function searchAccounts(options) {
  const secretKey = getStripeKey(options, 'account.search');
  const stripe = createStripeClient(secretKey, options);

  try {
    console.log(chalk.blue('Searching Connect accounts...'));
    
    // Get all accounts (we'll need to paginate through them)
    let allAccounts = [];
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) {
        params.starting_after = startingAfter;
      }

      const accounts = await stripe.accounts.list(params);
      allAccounts = allAccounts.concat(accounts.data);
      
      hasMore = accounts.has_more;
      if (hasMore && accounts.data.length > 0) {
        startingAfter = accounts.data[accounts.data.length - 1].id;
      }
    }

    if (allAccounts.length === 0) {
      console.log(chalk.yellow('No Connect accounts found.'));
      return;
    }

    // Perform fuzzy search
    const searchTerm = options.searchTerm.toLowerCase();
    const searchResults = allAccounts.filter(account => {
      const searchableFields = [
        account.id,
        account.email,
        account.business_profile?.name,
        account.business_profile?.dba,
        account.settings?.dashboard?.display_name,
        account.metadata?.name,
        account.metadata?.dba,
        account.metadata?.descriptor
      ].filter(Boolean).map(field => field.toLowerCase());

      // Support wildcard matching with *
      if (searchTerm.includes('*')) {
        const pattern = searchTerm.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`, 'i');
        return searchableFields.some(field => regex.test(field));
      } else {
        // Fuzzy matching - check if search term is contained in any field
        return searchableFields.some(field => field.includes(searchTerm));
      }
    });

    if (searchResults.length === 0) {
      console.log(chalk.yellow(`No accounts found matching "${options.searchTerm}"`));
      return;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(searchResults, null, 2));
      return;
    }

    // Format as table
    const tableData = [
      [
        chalk.bold('ID'),
        chalk.bold('Email'),
        chalk.bold('Business Name'),
        chalk.bold('DBA'),
        chalk.bold('Display Name'),
        chalk.bold('Country'),
        chalk.bold('Type'),
        chalk.bold('Charges Enabled'),
        chalk.bold('Payouts Enabled'),
        chalk.bold('Created')
      ]
    ];

    searchResults.forEach(account => {
      const createdDate = new Date(account.created * 1000).toLocaleDateString();
      const businessName = account.business_profile?.name || 'N/A';
      const dba = account.business_profile?.dba || 'N/A';
      const displayName = account.settings?.dashboard?.display_name || 'N/A';
      
      tableData.push([
        account.id,
        account.email || 'N/A',
        businessName,
        dba,
        displayName,
        account.country || 'N/A',
        account.type || 'N/A',
        account.charges_enabled ? chalk.green('✓') : chalk.red('✗'),
        account.payouts_enabled ? chalk.green('✓') : chalk.red('✗'),
        createdDate
      ]);
    });

    const tableConfig = {
      border: {
        topBody: '─',
        topJoin: '┬',
        topLeft: '┌',
        topRight: '┐',
        bottomBody: '─',
        bottomJoin: '┴',
        bottomLeft: '└',
        bottomRight: '┘',
        bodyLeft: '│',
        bodyRight: '│',
        bodyJoin: '│',
        joinBody: '─',
        joinLeft: '├',
        joinRight: '┤',
        joinJoin: '┼'
      },
      columnDefault: {
        paddingLeft: 1,
        paddingRight: 1
      }
    };

    console.log(table(tableData, tableConfig));
    console.log(chalk.gray(`\nFound ${searchResults.length} account(s) matching "${options.searchTerm}"`));

  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to search accounts: ${error.message}`);
    }
  }
}

/**
 * Creates a Stripe account link (Connect onboarding flow).
 * See https://docs.stripe.com/api/account_links/create
 * Account comes from -a, or from the profile's account in config.yml when using -p (or default platform).
 * @param {Object} options - Command options
 */
async function createAccountLink(options) {
  let accountId = options.account;

  if (!accountId) {
    try {
      const ProfileManager = require('../profile-manager');
      const profileManager = new ProfileManager();
      profileManager.loadProfiles();
      const platform = options.platform || profileManager.getDefaultProfile();
      if (platform) {
        accountId = profileManager.getProfileAccount(platform);
      }
    } catch (_) {
      // Profile error, continue and error below if still no accountId
    }
  }

  if (!accountId) {
    throw new Error(
      'Account is required. Use -a <acct_xxx> or -p <platform> with a profile that has account in config.yml.'
    );
  }

  const refreshUrl = options.refreshUrl || 'https://example.com/reauth';
  const returnUrl = options.returnUrl || 'https://example.com/return';
  const type = options.type === 'account_update' ? 'account_update' : 'account_onboarding';

  const secretKey = getStripeKey(options, 'account.link');
  const stripe = createStripeClient(secretKey, options);

  const params = {
    account: accountId,
    type,
    refresh_url: refreshUrl,
    return_url: returnUrl
  };

  if (options.collectionFields || options.collectionFutureRequirements) {
    params.collection_options = {};
    if (options.collectionFields === 'eventually_due' || options.collectionFields === 'currently_due') {
      params.collection_options.fields = options.collectionFields;
    }
    if (options.collectionFutureRequirements === 'include' || options.collectionFutureRequirements === 'omit') {
      params.collection_options.future_requirements = options.collectionFutureRequirements;
    }
  }

  try {
    const accountLink = await stripe.accountLinks.create(params);

    if (options.format === 'json') {
      console.log(JSON.stringify({
        url: accountLink.url,
        expires_at: accountLink.expires_at,
        object: accountLink.object
      }, null, 2));
      return;
    }

    console.log(chalk.green('Account link created (single-use, expires shortly):'));
    console.log(chalk.blue(accountLink.url));
    console.log(chalk.gray(`Expires at: ${new Date(accountLink.expires_at * 1000).toISOString()}`));
  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeInvalidRequestError') {
      throw new Error(`Invalid request: ${error.message}`);
    } else if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to create account link: ${error.message}`);
    }
  }
}

/**
 * Resolve the account ID from --account, or from the profile's account/connected_account.
 * @param {Object} options - Command options
 * @returns {string|null} Account ID or null if not resolvable
 */
function resolveAccountId(options) {
  if (options.account) return options.account;
  try {
    const ProfileManager = require('../profile-manager');
    const profileManager = new ProfileManager();
    profileManager.loadProfiles();
    const platform = options.platform || profileManager.getDefaultProfile();
    if (platform) {
      return profileManager.getProfileAccount(platform) || null;
    }
  } catch (_) {
    // fall through
  }
  return null;
}

/**
 * Show all settings for a connected account: the Account `settings` hash plus
 * Balance Settings (customized start of day). Read-only.
 * @param {Object} options - Command options
 */
async function getAccountSettings(options) {
  const accountId = resolveAccountId(options);
  if (!accountId) {
    throw new Error(
      'Account is required. Use -a <acct_xxx> or -p <platform> with a profile that has account in config.yml.'
    );
  }

  const secretKey = getStripeKey(options, 'account.settings');
  const stripe = createStripeClient(secretKey, options);

  try {
    const account = await stripe.accounts.retrieve(accountId);

    // Balance Settings (start of day) live on a separate endpoint; best-effort.
    let balanceSettings = null;
    let balanceSettingsError = null;
    try {
      const { makeStripeRequest } = require('./balance-settings');
      const { getStripeApiVersion } = require('../config-loader');
      balanceSettings = await makeStripeRequest(
        secretKey,
        'GET',
        '/v1/balance_settings',
        null,
        accountId,
        options.apiVersion || getStripeApiVersion()
      );
    } catch (e) {
      balanceSettingsError = e.message;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify({
        id: account.id,
        settings: account.settings,
        balance_settings: balanceSettings,
        balance_settings_error: balanceSettingsError || undefined
      }, null, 2));
      return;
    }

    console.log(chalk.bold(`account: ${account.id}`));
    const label = account.business_profile?.name || account.email || account.country;
    if (label) console.log(chalk.gray(`# ${label}`));
    console.log('');

    console.log(chalk.bold('account_settings:'));
    printSettingsTree(account.settings, 2);

    console.log('');
    console.log(chalk.bold('balance_settings:'));
    if (balanceSettings) {
      // Reads return settlement_timing/payouts at the top level; skip the
      // redundant `object` field.
      const { object, ...balanceFields } = balanceSettings;
      printSettingsTree(balanceFields, 2);
    } else {
      console.log(`  ${chalk.yellow('Unavailable')}${balanceSettingsError ? chalk.gray(` (${balanceSettingsError})`) : ''}`);
    }
    console.log('');
  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeInvalidRequestError') {
      throw new Error(`Invalid request: ${error.message}`);
    } else if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to fetch account settings: ${error.message}`);
    }
  }
}

module.exports = {
  listAccounts,
  searchAccounts,
  createAccountLink,
  getAccountSettings
};
