const readline = require('readline');
const chalk = require('chalk');
const { createStripeClient, getStripeKey, detectEnvironment } = require('../stripe-client');

/**
 * Prompt yes/no on stderr; resolves true for y/yes, false otherwise
 * @param {string} message - Prompt message (e.g. "Delete cus_xxx? (y/n) ")
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
 * Prompt yes/no/ALL on stderr. Returns 'yes' | 'no' | 'all'.
 * Typing ALL (case-insensitive) means delete all remaining without further prompts.
 * @param {string} message - Prompt message
 * @returns {Promise<'yes'|'no'|'all'>}
 */
function promptYesNoOrAll(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      const normalized = (answer || '').trim().toUpperCase();
      if (normalized === 'ALL') {
        resolve('all');
      } else {
        const lower = normalized.toLowerCase();
        resolve(lower === 'y' || lower === 'yes' ? 'yes' : 'no');
      }
    });
  });
}

/**
 * Resolve Stripe client and request options (connected account) from options
 * @param {Object} options - Command options (key, platform, connectedAccount, account)
 * @returns {{ stripe: Object, requestOptions: Object }}
 */
async function getStripeAndRequestOptions(options) {
  const secretKey = getStripeKey(options, 'account.customer.delete');
  const stripe = createStripeClient(secretKey);
  let connectedAccount = options.connectedAccount || options.account;

  try {
    const ProfileManager = require('../profile-manager');
    const profileManager = new ProfileManager();
    profileManager.loadProfiles();

    if (!connectedAccount && options.platform) {
      const environment = detectEnvironment(options);
      connectedAccount = profileManager.getProfileConnectedAccount(options.platform, environment);
    } else if (!connectedAccount) {
      const defaultProfile = profileManager.getDefaultProfile();
      if (defaultProfile) {
        const environment = detectEnvironment(options);
        connectedAccount = profileManager.getProfileConnectedAccount(defaultProfile, environment);
      }
    }
  } catch (_) {
    // No profile, use only command-line options
  }

  const requestOptions = connectedAccount ? { stripeAccount: connectedAccount } : {};
  return { stripe, requestOptions };
}

/**
 * Parse --metadata key=value into { key, value }; throws if invalid
 * @param {string} raw - e.g. "import_date=2026-01-30T23:44:00.000Z"
 * @returns {{ key: string, value: string }}
 */
function parseMetadataKeyValue(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('--metadata requires key=value (e.g. --metadata import_date=2026-01-30T23:44:00.000Z).');
  }
  const eq = raw.indexOf('=');
  if (eq <= 0) {
    throw new Error('--metadata must be key=value (e.g. --metadata import_date=2026-01-30T23:44:00.000Z).');
  }
  const key = raw.slice(0, eq).trim();
  const value = raw.slice(eq + 1).trim();
  if (!key) {
    throw new Error('--metadata key cannot be empty.');
  }
  return { key, value };
}

/**
 * Build Stripe search query for metadata exact match (escape single quotes in key/value)
 * @param {string} metaKey
 * @param {string} metaValue
 * @returns {string} e.g. "metadata['import_date']:'2026-01-30T23:44:00.000Z'"
 */
function buildMetadataSearchQuery(metaKey, metaValue) {
  const escape = (s) => String(s).replace(/'/g, "\\'");
  return `metadata['${escape(metaKey)}']:'${escape(metaValue)}'`;
}

/**
 * Deletes a Stripe customer by ID (platform or connected account). Prompts y/n before deleting.
 * @param {Object} options - Command options (delete: customer id, key, platform, connectedAccount, account)
 */
async function deleteCustomer(options) {
  const customerId = options.delete;
  if (!customerId || typeof customerId !== 'string') {
    throw new Error('Customer ID is required. Use account.customer.delete <customer_id> (e.g. cus_xxx).');
  }

  const trimmedId = customerId.trim();
  if (!trimmedId.startsWith('cus_')) {
    throw new Error('Invalid customer ID. Must start with cus_.');
  }

  const { stripe, requestOptions } = await getStripeAndRequestOptions(options);

  try {
    const customer = await stripe.customers.retrieve(trimmedId, requestOptions);
    const nameLabel = (customer.name && String(customer.name).trim()) || '(no name)';
    const confirm = await promptYesNo(chalk.yellow(`Delete customer ${trimmedId} (${nameLabel})? (y/n) `));
    if (!confirm) {
      console.error(chalk.gray('Skipped.'));
      return;
    }
  } catch (retrieveError) {
    if (retrieveError.type === 'StripeInvalidRequestError' && retrieveError.code === 'resource_missing') {
      throw new Error(`Customer not found: ${trimmedId}. It may have been deleted already or the ID may be wrong.`);
    }
    throw retrieveError;
  }

  try {
    const deleted = await stripe.customers.del(trimmedId, requestOptions);
    console.log(chalk.green('Customer deleted successfully.'));
    console.log(chalk.blue(`ID: ${deleted.id}`));
    if (deleted.deleted) {
      console.log(chalk.blue('Deleted: true'));
    }
    if (options.format === 'json') {
      console.log(JSON.stringify(deleted, null, 2));
    }
  } catch (error) {
    if (error.type === 'StripeInvalidRequestError' && error.code === 'resource_missing') {
      throw new Error(`Customer not found: ${trimmedId}. It may have been deleted already or the ID may be wrong.`);
    }
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    }
    if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Your key may not have permission to delete customers.');
    }
    throw error;
  }
}

/**
 * Search for customers by metadata key=value, then prompt y/n for each and delete if yes.
 * @param {Object} options - Command options (metadata: key=value, key, platform, connectedAccount, account)
 */
async function deleteCustomersByMetadata(options) {
  const { key: metaKey, value: metaValue } = parseMetadataKeyValue(options.metadata);
  const { stripe, requestOptions } = await getStripeAndRequestOptions(options);

  const query = buildMetadataSearchQuery(metaKey, metaValue);
  console.error(chalk.yellow(`Searching customers with metadata ${metaKey}=${metaValue}...`));

  const allCustomers = [];
  let page = null;

  do {
    const params = { query, limit: 100 };
    if (page) params.page = page;
    const result = await stripe.customers.search(params, requestOptions);
    allCustomers.push(...result.data);
    page = result.next_page || null;
  } while (page);

  const total = allCustomers.length;
  if (total === 0) {
    console.error(chalk.blue('No customers found with that metadata.'));
    if (options.format === 'json') {
      console.log(JSON.stringify({ deleted: 0, total: 0 }, null, 2));
    }
    return;
  }

  console.error(chalk.yellow(`Found ${total} customer(s). You will be prompted for each (or type ALL to delete all without further prompts)...`));

  let deletedCount = 0;
  let failed = 0;
  const errors = [];
  let deleteAllRemaining = false;

  for (const customer of allCustomers) {
    let shouldDelete = deleteAllRemaining;
    if (!shouldDelete) {
      const nameLabel = (customer.name && String(customer.name).trim()) || '(no name)';
      const answer = await promptYesNoOrAll(chalk.yellow(`Delete customer ${customer.id} (${nameLabel})? (y/n/ALL) `));
      if (answer === 'all') {
        deleteAllRemaining = true;
        shouldDelete = true;
        if (options.format !== 'json') {
          console.error(chalk.gray('  Deleting all remaining without further prompts...'));
        }
      } else {
        shouldDelete = answer === 'yes';
      }
    }
    if (!shouldDelete) {
      if (options.format !== 'json') {
        console.error(chalk.gray(`  Skipped ${customer.id}`));
      }
      continue;
    }
    try {
      await stripe.customers.del(customer.id, requestOptions);
      deletedCount++;
      if (options.format !== 'json') {
        console.error(chalk.gray(`  Deleted ${customer.id}`));
      }
    } catch (error) {
      failed++;
      const msg = error.message || String(error.code || error.type);
      errors.push({ id: customer.id, error: msg });
      console.error(chalk.red(`  Failed ${customer.id}: ${msg}`));
    }
  }

  console.error(chalk.green(`Deleted: ${deletedCount}`));
  if (failed > 0) {
    console.error(chalk.red(`Failed: ${failed}`));
  }

  if (options.format === 'json') {
    console.log(JSON.stringify({
      deleted: deletedCount,
      failed,
      total,
      errors: errors.length ? errors : undefined
    }, null, 2));
  }
}

/**
 * Returns true if the key is a Stripe test key (sk_test_* or rk_test_*)
 * @param {string} secretKey
 * @returns {boolean}
 */
function isTestKey(secretKey) {
  return !!secretKey && (secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_'));
}

/**
 * Deletes all customers on the account. Only allowed with Stripe test keys.
 * @param {Object} options - Command options (key, platform, connectedAccount, account)
 */
async function deleteAllCustomers(options) {
  const secretKey = getStripeKey(options, 'account.customer.delete');

  if (!isTestKey(secretKey)) {
    throw new Error('account.customer.delete --all is only allowed with Stripe test keys (sk_test_* or rk_test_*). Use a test key to delete all customers.');
  }

  const stripe = createStripeClient(secretKey);
  let connectedAccount = options.connectedAccount || options.account;

  try {
    const ProfileManager = require('../profile-manager');
    const profileManager = new ProfileManager();
    profileManager.loadProfiles();

    if (!connectedAccount && options.platform) {
      const environment = detectEnvironment(options);
      connectedAccount = profileManager.getProfileConnectedAccount(options.platform, environment);
    } else if (!connectedAccount) {
      const defaultProfile = profileManager.getDefaultProfile();
      if (defaultProfile) {
        const environment = detectEnvironment(options);
        connectedAccount = profileManager.getProfileConnectedAccount(defaultProfile, environment);
      }
    }
  } catch (_) {
    // No profile, use only command-line options
  }

  const requestOptions = connectedAccount ? { stripeAccount: connectedAccount } : {};

  const accountLabel = connectedAccount ? `connected account ${connectedAccount}` : 'platform account';
  console.error(chalk.yellow(`Listing all customers on ${accountLabel}...`));

  const customers = await stripe.customers.list({ limit: 100 }, requestOptions);
  const allCustomers = [...customers.data];
  let hasMore = customers.has_more;
  let lastId = customers.data.length ? customers.data[customers.data.length - 1].id : null;

  while (hasMore && lastId) {
    const next = await stripe.customers.list({ limit: 100, starting_after: lastId }, requestOptions);
    allCustomers.push(...next.data);
    hasMore = next.has_more;
    lastId = next.data.length ? next.data[next.data.length - 1].id : null;
  }

  const total = allCustomers.length;
  if (total === 0) {
    console.error(chalk.blue('No customers found.'));
    if (options.format === 'json') {
      console.log(JSON.stringify({ deleted: 0, customers: [] }, null, 2));
    }
    return;
  }

  console.error(chalk.yellow(`Deleting ${total} customer(s) (you will be prompted for each, or type ALL to delete all without further prompts)...`));

  let deletedCount = 0;
  let failed = 0;
  const errors = [];
  let deleteAllRemaining = false;

  for (const customer of allCustomers) {
    let shouldDelete = deleteAllRemaining;
    if (!shouldDelete) {
      const nameLabel = (customer.name && String(customer.name).trim()) || '(no name)';
      const answer = await promptYesNoOrAll(chalk.yellow(`Delete customer ${customer.id} (${nameLabel})? (y/n/ALL) `));
      if (answer === 'all') {
        deleteAllRemaining = true;
        shouldDelete = true;
        if (options.format !== 'json') {
          console.error(chalk.gray('  Deleting all remaining without further prompts...'));
        }
      } else {
        shouldDelete = answer === 'yes';
      }
    }
    if (!shouldDelete) {
      if (options.format !== 'json') {
        console.error(chalk.gray(`  Skipped ${customer.id}`));
      }
      continue;
    }
    try {
      await stripe.customers.del(customer.id, requestOptions);
      deletedCount++;
      if (options.format !== 'json') {
        console.error(chalk.gray(`  Deleted ${customer.id}`));
      }
    } catch (error) {
      failed++;
      const msg = error.message || String(error.code || error.type);
      errors.push({ id: customer.id, error: msg });
      console.error(chalk.red(`  Failed ${customer.id}: ${msg}`));
    }
  }

  console.error(chalk.green(`Deleted: ${deletedCount}`));
  if (failed > 0) {
    console.error(chalk.red(`Failed: ${failed}`));
  }

  if (options.format === 'json') {
    console.log(JSON.stringify({
      deleted: deletedCount,
      failed,
      total,
      errors: errors.length ? errors : undefined
    }, null, 2));
  }
}

module.exports = {
  deleteCustomer,
  deleteAllCustomers,
  deleteCustomersByMetadata,
  isTestKey
};
