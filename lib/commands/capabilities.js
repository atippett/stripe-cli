const chalk = require('chalk');
const { table } = require('table');
const { createStripeClient, getStripeKey } = require('../stripe-client');

/**
 * Request a capability for a connected account
 * @param {Object} options - Command options
 */
async function requestCapability(options) {
  const secretKey = getStripeKey(options, 'account.capabilities.request');
  const stripe = createStripeClient(secretKey);

  if (!options.account) {
    throw new Error('Connected account ID is required. Use --account option.');
  }

  if (!options.capability) {
    throw new Error('Capability ID is required. Use --capability option (e.g., card_payments).');
  }

  try {
    console.log(chalk.blue(`Requesting capability "${options.capability}" for account: ${options.account}`));
    
    const capability = await stripe.accounts.updateCapability(
      options.account,
      options.capability,
      {
        requested: true
      }
    );

    if (options.format === 'json') {
      console.log(JSON.stringify(capability, null, 2));
      return;
    }

    // Display capability information
    console.log(chalk.green('✅ Capability requested successfully!'));
    console.log('');
    console.log(chalk.bold('Capability Details:'));
    console.log(`  ID: ${capability.id}`);
    console.log(`  Status: ${formatStatus(capability.status)}`);
    console.log(`  Requested: ${capability.requested ? chalk.green('Yes') : chalk.red('No')}`);
    
    if (capability.requested_at) {
      const requestedDate = new Date(capability.requested_at * 1000).toISOString();
      console.log(`  Requested At: ${requestedDate}`);
    }

    // Display requirements if present
    if (capability.requirements && (
      capability.requirements.currently_due?.length > 0 ||
      capability.requirements.eventually_due?.length > 0 ||
      capability.requirements.past_due?.length > 0
    )) {
      console.log('');
      console.log(chalk.bold('Requirements:'));
      
      if (capability.requirements.currently_due?.length > 0) {
        console.log(chalk.yellow(`  Currently Due: ${capability.requirements.currently_due.join(', ')}`));
      }
      
      if (capability.requirements.eventually_due?.length > 0) {
        console.log(chalk.gray(`  Eventually Due: ${capability.requirements.eventually_due.join(', ')}`));
      }
      
      if (capability.requirements.past_due?.length > 0) {
        console.log(chalk.red(`  Past Due: ${capability.requirements.past_due.join(', ')}`));
      }
    }

  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to request capability: ${error.message}`);
    }
  }
}

/**
 * List all capabilities for a connected account
 * @param {Object} options - Command options
 */
async function listCapabilities(options) {
  const secretKey = getStripeKey(options, 'account.capabilities.list');
  const stripe = createStripeClient(secretKey);

  if (!options.account) {
    throw new Error('Connected account ID is required. Use --account option.');
  }

  try {
    console.log(chalk.blue(`Fetching capabilities for account: ${options.account}`));
    
    const capabilities = await stripe.accounts.listCapabilities(options.account);

    if (capabilities.data.length === 0) {
      console.log(chalk.yellow('No capabilities found for this account.'));
      return;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(capabilities.data, null, 2));
      return;
    }

    // Format as table
    const tableData = [
      [
        chalk.bold('ID'),
        chalk.bold('Status'),
        chalk.bold('Requested'),
        chalk.bold('Requested At'),
        chalk.bold('Currently Due'),
        chalk.bold('Past Due')
      ]
    ];

    capabilities.data.forEach(capability => {
      const requestedAt = capability.requested_at 
        ? new Date(capability.requested_at * 1000).toLocaleDateString()
        : 'N/A';
      
      const currentlyDue = capability.requirements?.currently_due?.length > 0
        ? capability.requirements.currently_due.length.toString()
        : '0';
      
      const pastDue = capability.requirements?.past_due?.length > 0
        ? capability.requirements.past_due.length.toString()
        : '0';

      tableData.push([
        capability.id,
        formatStatus(capability.status),
        capability.requested ? chalk.green('Yes') : chalk.red('No'),
        requestedAt,
        currentlyDue === '0' ? chalk.gray('0') : chalk.yellow(currentlyDue),
        pastDue === '0' ? chalk.gray('0') : chalk.red(pastDue)
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
    console.log(chalk.gray(`\nTotal capabilities: ${capabilities.data.length}`));

  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to list capabilities: ${error.message}`);
    }
  }
}

/**
 * Format capability status with color
 * @param {string} status - Capability status
 * @returns {string} Formatted status
 */
function formatStatus(status) {
  switch (status) {
    case 'active':
      return chalk.green('Active');
    case 'inactive':
      return chalk.yellow('Inactive');
    case 'pending':
      return chalk.blue('Pending');
    default:
      return status;
  }
}

module.exports = {
  requestCapability,
  listCapabilities
};
