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

module.exports = {
  listAccounts
};
