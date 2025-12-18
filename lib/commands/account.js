const chalk = require('chalk');
const { table } = require('table');
const { createStripeClient, getStripeKey } = require('../stripe-client');

/**
 * Lists the first 50 Connect accounts
 * @param {Object} options - Command options
 */
async function listAccounts(options) {
  const secretKey = getStripeKey(options);
  const stripe = createStripeClient(secretKey);

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
  const secretKey = getStripeKey(options);
  const stripe = createStripeClient(secretKey);

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

module.exports = {
  listAccounts,
  searchAccounts
};
