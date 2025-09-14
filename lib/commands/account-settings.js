const chalk = require('chalk');
const { createStripeClient, getStripeKey } = require('../stripe-client');

/**
 * Enable network cost passthrough for a connected account
 * @param {Object} options - Command options
 */
async function enableNetworkCostPassthrough(options) {
  const secretKey = getStripeKey(options);
  const stripe = createStripeClient(secretKey);

  if (!options.account) {
    throw new Error('Connected account ID is required. Use --account option.');
  }

  try {
    console.log(chalk.blue(`Enabling network cost passthrough for account: ${options.account}`));
    
    const scheme = await stripe.pricingConfigs.networkCosts.schemes.create({
      enabled: true,
      starts_at: options.startsAt || undefined
    }, {
      stripeAccount: options.account,
      apiVersion: '2025-07-30.preview; network_costs_private_preview=v1'
    });

    console.log(chalk.green('✅ Network cost passthrough enabled successfully!'));
    console.log(chalk.gray(`Scheme ID: ${scheme.id}`));
    console.log(chalk.gray(`Starts at: ${scheme.starts_at ? new Date(scheme.starts_at * 1000).toISOString() : 'Immediately'}`));
    
    if (options.format === 'json') {
      console.log(JSON.stringify(scheme, null, 2));
    }

  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeAPIError') {
      if (error.code === 'resource_already_exists') {
        throw new Error('A network cost passthrough scheme already exists for this account. Delete the existing scheme first.');
      }
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to enable network cost passthrough: ${error.message}`);
    }
  }
}

/**
 * Disable network cost passthrough for a connected account
 * @param {Object} options - Command options
 */
async function disableNetworkCostPassthrough(options) {
  const secretKey = getStripeKey(options);
  const stripe = createStripeClient(secretKey);

  if (!options.account) {
    throw new Error('Connected account ID is required. Use --account option.');
  }

  try {
    console.log(chalk.blue(`Disabling network cost passthrough for account: ${options.account}`));
    
    const scheme = await stripe.pricingConfigs.networkCosts.schemes.create({
      enabled: false,
      starts_at: options.startsAt || undefined
    }, {
      stripeAccount: options.account,
      apiVersion: '2025-07-30.preview; network_costs_private_preview=v1'
    });

    console.log(chalk.green('✅ Network cost passthrough disabled successfully!'));
    console.log(chalk.gray(`Scheme ID: ${scheme.id}`));
    console.log(chalk.gray(`Starts at: ${scheme.starts_at ? new Date(scheme.starts_at * 1000).toISOString() : 'Immediately'}`));
    
    if (options.format === 'json') {
      console.log(JSON.stringify(scheme, null, 2));
    }

  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeAPIError') {
      if (error.code === 'resource_already_exists') {
        throw new Error('A network cost passthrough scheme already exists for this account. Delete the existing scheme first.');
      }
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to disable network cost passthrough: ${error.message}`);
    }
  }
}

/**
 * Get network cost passthrough status for a connected account
 * @param {Object} options - Command options
 */
async function getNetworkCostPassthroughStatus(options) {
  const secretKey = getStripeKey(options);
  const stripe = createStripeClient(secretKey);

  if (!options.account) {
    throw new Error('Connected account ID is required. Use --account option.');
  }

  try {
    console.log(chalk.blue(`Getting network cost passthrough status for account: ${options.account}`));
    
    const pricingConfig = await stripe.pricingConfigs.networkCosts.retrieve({
      expand: ['current_scheme', 'next_scheme']
    }, {
      stripeAccount: options.account,
      apiVersion: '2025-07-30.preview; network_costs_private_preview=v1'
    });

    if (options.format === 'json') {
      console.log(JSON.stringify(pricingConfig, null, 2));
      return;
    }

    // Display current status
    console.log(chalk.bold('\n📊 Network Cost Passthrough Status:'));
    console.log('');

    if (pricingConfig.current_scheme) {
      const current = pricingConfig.current_scheme;
      const status = current.enabled ? chalk.green('ENABLED') : chalk.red('DISABLED');
      const startDate = new Date(current.starts_at * 1000).toISOString();
      const endDate = current.ends_at ? new Date(current.ends_at * 1000).toISOString() : 'No end date';
      
      console.log(chalk.bold('Current Scheme:'));
      console.log(`  Status: ${status}`);
      console.log(`  Scheme ID: ${current.id}`);
      console.log(`  Started: ${startDate}`);
      console.log(`  Ends: ${endDate}`);
      console.log('');
    } else {
      console.log(chalk.yellow('No current scheme active'));
      console.log('');
    }

    if (pricingConfig.next_scheme) {
      const next = pricingConfig.next_scheme;
      const status = next.enabled ? chalk.green('ENABLED') : chalk.red('DISABLED');
      const startDate = new Date(next.starts_at * 1000).toISOString();
      
      console.log(chalk.bold('Scheduled Scheme:'));
      console.log(`  Status: ${status}`);
      console.log(`  Scheme ID: ${next.id}`);
      console.log(`  Starts: ${startDate}`);
      console.log('');
    } else {
      console.log(chalk.gray('No scheduled scheme'));
    }

  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to get network cost passthrough status: ${error.message}`);
    }
  }
}

/**
 * Delete a scheduled network cost passthrough scheme
 * @param {Object} options - Command options
 */
async function deleteNetworkCostPassthroughScheme(options) {
  const secretKey = getStripeKey(options);
  const stripe = createStripeClient(secretKey);

  if (!options.account) {
    throw new Error('Connected account ID is required. Use --account option.');
  }

  if (!options.schemeId) {
    throw new Error('Scheme ID is required. Use --scheme-id option.');
  }

  try {
    console.log(chalk.blue(`Deleting network cost passthrough scheme: ${options.schemeId}`));
    
    const deletedScheme = await stripe.pricingConfigs.networkCosts.schemes.del(options.schemeId, {
      stripeAccount: options.account,
      apiVersion: '2025-07-30.preview; network_costs_private_preview=v1'
    });

    console.log(chalk.green('✅ Network cost passthrough scheme deleted successfully!'));
    console.log(chalk.gray(`Deleted scheme ID: ${deletedScheme.id}`));
    
    if (options.format === 'json') {
      console.log(JSON.stringify(deletedScheme, null, 2));
    }

  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeAPIError') {
      if (error.code === 'resource_missing') {
        throw new Error('Scheme not found or already deleted.');
      }
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to delete network cost passthrough scheme: ${error.message}`);
    }
  }
}

module.exports = {
  enableNetworkCostPassthrough,
  disableNetworkCostPassthrough,
  getNetworkCostPassthroughStatus,
  deleteNetworkCostPassthroughScheme
};
