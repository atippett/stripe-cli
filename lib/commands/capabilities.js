const readline = require('readline');
const chalk = require('chalk');
const { createStripeClient, getStripeKey } = require('../stripe-client');
const { printSettingsTree } = require('../output');

/**
 * Prompt yes/no on stderr; resolves true for y/yes, false otherwise
 * @param {string} message - Prompt message
 * @returns {Promise<boolean>}
 */
function promptYesNo(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      const normalized = (answer || '').trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * @param {Object} options - Command options
 * @returns {string} Connected account ID
 */
function requireAccount(options) {
  if (!options.account) {
    throw new Error('Connected account ID is required. Use --account option.');
  }
  return options.account;
}

/**
 * @param {Object} options - Command options
 * @returns {string} Capability ID
 */
function requireCapability(options) {
  if (!options.capability) {
    throw new Error('Capability ID is required. Use --capability option (e.g., card_payments).');
  }
  return options.capability;
}

/**
 * Shape a Stripe capability into printable `key: value` fields.
 *
 * Stripe reports the account's full outstanding KYC set against every
 * capability, including ones that were never requested, so listing them all
 * buries the signal. In list output requirements are shown only for
 * capabilities that were actually requested; `-f json` always has everything.
 *
 * @param {Object} capability - Stripe capability object
 * @param {boolean} alwaysShowRequirements - Print requirements even when nothing is due
 * @returns {Object} Fields for printSettingsTree
 */
function capabilityFields(capability, alwaysShowRequirements = false) {
  const fields = {
    status: capability.status,
    requested: capability.requested
  };

  if (capability.requested_at) {
    fields.requested_at = new Date(capability.requested_at * 1000).toISOString();
  }

  const requirements = capability.requirements || {};
  const currentlyDue = requirements.currently_due || [];
  const eventuallyDue = requirements.eventually_due || [];
  const pastDue = requirements.past_due || [];
  const anyDue = currentlyDue.length > 0 || eventuallyDue.length > 0 || pastDue.length > 0;

  if (alwaysShowRequirements || (capability.requested && anyDue)) {
    fields.requirements = {
      currently_due: currentlyDue,
      eventually_due: eventuallyDue,
      past_due: pastDue
    };
  }

  return fields;
}

/**
 * Map Stripe SDK errors onto user-facing messages.
 * @param {Error} error - Error thrown by the Stripe SDK
 * @param {string} action - What failed, e.g. 'list capabilities'
 * @returns {Error} Error to surface
 */
function stripeError(error, action) {
  if (error.type === 'StripeAuthenticationError') {
    return new Error('Invalid Stripe API key. Please check your API key.');
  }
  if (error.type === 'StripePermissionError') {
    return new Error('Insufficient permissions. Make sure your API key has the required permissions.');
  }
  if (error.type === 'StripeAPIError') {
    return new Error(`Stripe API error: ${error.message}`);
  }
  return new Error(`Failed to ${action}: ${error.message}`);
}

/**
 * List all capabilities for a connected account
 * @param {Object} options - Command options
 */
async function listCapabilities(options) {
  const accountId = requireAccount(options);
  const secretKey = getStripeKey(options, 'account.capabilities.list');
  const stripe = createStripeClient(secretKey, options);

  console.error(chalk.gray(`Fetching capabilities for account: ${accountId}`));

  let capabilities;
  try {
    capabilities = await stripe.accounts.listCapabilities(accountId);
  } catch (error) {
    throw stripeError(error, 'list capabilities');
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(capabilities.data, null, 2));
    return;
  }

  if (capabilities.data.length === 0) {
    console.log('capabilities:');
    console.log(`  ${chalk.gray('(none)')}`);
    return;
  }

  const tree = {};
  capabilities.data.forEach((capability) => {
    tree[capability.id] = capabilityFields(capability);
  });

  console.log(chalk.bold('capabilities:'));
  printSettingsTree(tree, 2);
  console.log('');
  console.log(`total: ${capabilities.data.length}`);
}

/**
 * Request (add) a capability for a connected account
 * @param {Object} options - Command options
 */
async function requestCapability(options) {
  const accountId = requireAccount(options);
  const capabilityId = requireCapability(options);
  const secretKey = getStripeKey(options, 'account.capabilities.request');
  const stripe = createStripeClient(secretKey, options);

  console.error(chalk.gray(`Requesting capability "${capabilityId}" for account: ${accountId}`));

  let capability;
  try {
    capability = await stripe.accounts.updateCapability(accountId, capabilityId, { requested: true });
  } catch (error) {
    throw stripeError(error, 'request capability');
  }

  printCapability(capability, options);
}

/**
 * Remove (un-request) a capability for a connected account. Stripe has no
 * delete endpoint for capabilities; clearing `requested` leaves the capability
 * on the account as inactive.
 * @param {Object} options - Command options
 */
async function removeCapability(options) {
  const accountId = requireAccount(options);
  const capabilityId = requireCapability(options);
  const secretKey = getStripeKey(options, 'account.capabilities.remove');
  const stripe = createStripeClient(secretKey, options);

  if (!options.yes) {
    const confirmed = await promptYesNo(
      chalk.yellow(`Remove capability "${capabilityId}" from ${accountId}? This sets requested=false. (y/n) `)
    );
    if (!confirmed) {
      console.error('Aborted.');
      return;
    }
  }

  console.error(chalk.gray(`Removing capability "${capabilityId}" for account: ${accountId}`));

  let capability;
  try {
    capability = await stripe.accounts.updateCapability(accountId, capabilityId, { requested: false });
  } catch (error) {
    throw stripeError(error, 'remove capability');
  }

  printCapability(capability, options);
}

/**
 * Print a single capability as JSON or a `key: value` tree.
 * @param {Object} capability - Stripe capability object
 * @param {Object} options - Command options
 */
function printCapability(capability, options) {
  if (options.format === 'json') {
    console.log(JSON.stringify(capability, null, 2));
    return;
  }

  console.log(chalk.bold('capability:'));
  printSettingsTree({ id: capability.id, ...capabilityFields(capability, true) }, 2);
}

module.exports = {
  listCapabilities,
  requestCapability,
  removeCapability
};
